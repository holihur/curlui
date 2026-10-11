// Package proxy implements a recording HTTP forward proxy. Plain HTTP traffic
// is captured in full (request and response); HTTPS/CONNECT is tunnelled and
// recorded as a host-level entry.
package proxy

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"curlui/server/internal/mitm"
	"curlui/server/internal/models"
)

const maxCaptureBody = 2 << 20 // 2 MiB per side

// Proxy is a recording forward proxy.
type Proxy struct {
	addr        string
	record      func(models.CaptureEntry)
	transport   *http.Transport
	ca          *mitm.CA
	interceptor *Interceptor
	mitmEnabled func() bool
	mitmFilter  func(string) bool

	mu  sync.Mutex
	srv *http.Server
	ln  net.Listener
}

// Options configures the proxy.
type Options struct {
	CA                   *mitm.CA
	RequestBreakEnabled  func() bool
	RequestBreakFilter   func(string) bool
	ResponseBreakEnabled func() bool
	ResponseBreakFilter  func(string) bool
	MITMEnabled          func() bool
	MITMFilter           func(string) bool
}

// New creates a proxy that reports captures through record.
func New(addr string, record func(models.CaptureEntry), opts Options) *Proxy {
	return &Proxy{
		addr:        addr,
		record:      record,
		ca:          opts.CA,
		interceptor: NewInterceptor(opts.RequestBreakEnabled, opts.RequestBreakFilter, opts.ResponseBreakEnabled, opts.ResponseBreakFilter),
		mitmEnabled: opts.MITMEnabled,
		mitmFilter:  opts.MITMFilter,
		transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   20 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     false,
			MaxIdleConns:          50,
			IdleConnTimeout:       60 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ExpectContinueTimeout: 2 * time.Second,
		},
	}
}

// CAPEM returns the CA certificate so clients can trust it.
func (p *Proxy) CAPEM() []byte {
	if p.ca == nil {
		return nil
	}
	return p.ca.CertPEM()
}

// Interceptor exposes the request breakpoint controller.
func (p *Proxy) Interceptor() *Interceptor { return p.interceptor }

// mitm reports whether a CONNECT to host should be decrypted.
func (p *Proxy) mitm(host string) bool {
	if p.ca == nil {
		return false
	}
	if p.mitmEnabled != nil && !p.mitmEnabled() {
		return false
	}
	if p.mitmFilter != nil && !p.mitmFilter(host) {
		return false
	}
	return true
}

// ListenAndServe blocks serving the proxy.
func (p *Proxy) ListenAndServe() error {
	ln, err := net.Listen("tcp", p.addr)
	if err != nil {
		return err
	}
	return p.Serve(ln)
}

// Serve serves the proxy on an existing listener (blocks until Close).
func (p *Proxy) Serve(ln net.Listener) error {
	srv := &http.Server{
		Handler:           http.HandlerFunc(p.handle),
		ReadHeaderTimeout: 15 * time.Second,
	}
	p.mu.Lock()
	p.srv = srv
	p.ln = ln
	p.mu.Unlock()
	return srv.Serve(ln)
}

// Close stops the proxy.
func (p *Proxy) Close() error {
	p.mu.Lock()
	srv, ln := p.srv, p.ln
	p.srv, p.ln = nil, nil
	p.mu.Unlock()
	if srv != nil {
		return srv.Close()
	}
	if ln != nil {
		return ln.Close()
	}
	return nil
}

func (p *Proxy) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		p.tunnel(w, r)
		return
	}
	p.forward(w, r)
}

var hopHeaders = []string{
	"Connection", "Proxy-Connection", "Keep-Alive", "Proxy-Authenticate",
	"Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

func (p *Proxy) forward(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	reqBody, _ := io.ReadAll(io.LimitReader(r.Body, maxCaptureBody))
	_ = r.Body.Close()

	// Breakpoint: pause and let the UI review/modify before forwarding.
	method, target, hdr, body := r.Method, r.URL.String(), r.Header, reqBody
	if res, intercepted := p.interceptor.Intercept(r.Context(), method, target, cloneHeader(r.Header), reqBody, 10*time.Minute); intercepted {
		if res.Abort {
			p.recordCapture(r, reqBody, http.StatusForbidden, nil, []byte("blocked by curlui breakpoint"), start, nil)
			http.Error(w, "request blocked by curlui breakpoint", http.StatusForbidden)
			return
		}
		method, target, body = res.Method, res.URL, res.Body
		hdr = http.Header{}
		for k, values := range res.Headers {
			for _, v := range values {
				hdr.Add(k, v)
			}
		}
	}

	outReq, err := http.NewRequest(method, target, bytes.NewReader(body))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	copyHeaders(outReq.Header, hdr)
	for _, h := range hopHeaders {
		outReq.Header.Del(h)
	}

	resp, err := p.transport.RoundTrip(outReq)
	if err != nil {
		p.recordCapture(r, reqBody, 0, nil, nil, start, err)
		http.Error(w, "proxy error: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, maxCaptureBody))

	// Response breakpoint: let the UI edit the response before it is returned.
	status := resp.StatusCode
	respHeader := resp.Header
	if res, intercepted := p.interceptor.InterceptResponse(r.Context(), method, target, status, cloneHeader(resp.Header), respBody, 10*time.Minute); intercepted {
		if res.Abort {
			p.recordCapture(r, reqBody, http.StatusBadGateway, nil, []byte("response aborted by curlui breakpoint"), start, nil)
			http.Error(w, "response aborted by curlui breakpoint", http.StatusBadGateway)
			return
		}
		status = res.Status
		respBody = res.Body
		respHeader = http.Header{}
		for k, values := range res.Headers {
			for _, v := range values {
				respHeader.Add(k, v)
			}
		}
	}

	copyHeaders(w.Header(), respHeader)
	w.WriteHeader(status)
	_, _ = w.Write(respBody)

	p.recordCapture(r, reqBody, status, respHeader, respBody, start, nil)
}

func (p *Proxy) tunnel(w http.ResponseWriter, r *http.Request) {
	if p.mitm(r.Host) {
		p.mitmConnect(w, r)
		return
	}
	start := time.Now()
	dest, err := net.DialTimeout("tcp", r.Host, 20*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		dest.Close()
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}
	client, _, err := hj.Hijack()
	if err != nil {
		dest.Close()
		return
	}
	_, _ = client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	go func() {
		_, _ = io.Copy(dest, client)
		dest.Close()
	}()
	_, _ = io.Copy(client, dest)
	client.Close()

	p.record(models.CaptureEntry{
		At:             start.UnixMilli(),
		Method:         "CONNECT",
		URL:            r.Host,
		RequestHeaders: cloneHeader(r.Header),
		Tunnel:         true,
		Duration:       time.Since(start).Milliseconds(),
	})
}

func (p *Proxy) mitmConnect(w http.ResponseWriter, r *http.Request) {
	hj, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}
	client, _, err := hj.Hijack()
	if err != nil {
		return
	}
	_, _ = client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	go p.mitmTunnel(client, r.Host)
}

// mitmTunnel terminates TLS with a CA-signed certificate, captures the
// decrypted request/response, then writes the response back to the client.
func (p *Proxy) mitmTunnel(client net.Conn, target string) {
	host := target
	if h, _, err := net.SplitHostPort(target); err == nil {
		host = h
	}
	cert, err := p.ca.CertFor(host)
	if err != nil {
		client.Close()
		return
	}
	tlsConn := tls.Server(client, &tls.Config{Certificates: []tls.Certificate{*cert}})
	if err := tlsConn.Handshake(); err != nil {
		client.Close()
		return
	}
	defer tlsConn.Close()

	br := bufio.NewReader(tlsConn)
	for {
		req, err := http.ReadRequest(br)
		if err != nil {
			return
		}
		start := time.Now()
		reqBody, _ := io.ReadAll(io.LimitReader(req.Body, maxCaptureBody))
		_ = req.Body.Close()
		url := "https://" + target + req.URL.RequestURI()

		outReq, err := http.NewRequest(req.Method, url, bytes.NewReader(reqBody))
		if err != nil {
			return
		}
		copyHeaders(outReq.Header, req.Header)
		for _, h := range hopHeaders {
			outReq.Header.Del(h)
		}
		outReq.Header.Del("Accept-Encoding") // keep bodies readable

		resp, err := p.transport.RoundTrip(outReq)
		if err != nil {
			p.record(models.CaptureEntry{At: start.UnixMilli(), Method: req.Method, URL: url, RequestHeaders: cloneHeader(req.Header), RequestBody: string(reqBody), Duration: time.Since(start).Milliseconds(), Error: err.Error()})
			_, _ = fmt.Fprintf(tlsConn, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
			return
		}
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, maxCaptureBody))
		_ = resp.Body.Close()

		status := resp.StatusCode
		respHeader := resp.Header
		if res, intercepted := p.interceptor.InterceptResponse(context.Background(), req.Method, url, status, cloneHeader(resp.Header), respBody, 10*time.Minute); intercepted {
			if res.Abort {
				_, _ = fmt.Fprint(tlsConn, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
				return
			}
			status = res.Status
			respBody = res.Body
			respHeader = http.Header{}
			for k, values := range res.Headers {
				for _, v := range values {
					respHeader.Add(k, v)
				}
			}
		}

		p.record(models.CaptureEntry{
			At:              start.UnixMilli(),
			Method:          req.Method,
			URL:             url,
			RequestHeaders:  cloneHeader(req.Header),
			RequestBody:     string(reqBody),
			Status:          status,
			ResponseHeaders: cloneHeader(respHeader),
			ResponseBody:    string(respBody),
			ContentType:     respHeader.Get("Content-Type"),
			Duration:        time.Since(start).Milliseconds(),
		})

		out := &http.Response{
			StatusCode:    status,
			Status:        fmt.Sprintf("%d %s", status, http.StatusText(status)),
			Proto:         "HTTP/1.1",
			ProtoMajor:    1,
			ProtoMinor:    1,
			Header:        respHeader,
			Body:          io.NopCloser(bytes.NewReader(respBody)),
			ContentLength: int64(len(respBody)),
			Close:         req.Close,
		}
		out.Header.Del("Content-Length")
		out.Header.Del("Transfer-Encoding")
		out.Header.Del("Connection")
		if err := out.Write(tlsConn); err != nil {
			return
		}
		if req.Close {
			return
		}
	}
}

func (p *Proxy) recordCapture(r *http.Request, reqBody []byte, status int, respHeaders http.Header, respBody []byte, start time.Time, err error) {
	entry := models.CaptureEntry{
		At:             start.UnixMilli(),
		Method:         r.Method,
		URL:            r.URL.String(),
		RequestHeaders: cloneHeader(r.Header),
		RequestBody:    string(reqBody),
		Duration:       time.Since(start).Milliseconds(),
		Status:         status,
	}
	if respHeaders != nil {
		entry.ResponseHeaders = cloneHeader(respHeaders)
		entry.ContentType = respHeaders.Get("Content-Type")
	}
	if len(respBody) > 0 {
		entry.ResponseBody = string(respBody)
	}
	if err != nil {
		entry.Error = err.Error()
	}
	p.record(entry)
}

func copyHeaders(dst, src http.Header) {
	for k, values := range src {
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func cloneHeader(h http.Header) map[string][]string {
	out := make(map[string][]string, len(h))
	for k, v := range h {
		out[k] = append([]string{}, v...)
	}
	return out
}
