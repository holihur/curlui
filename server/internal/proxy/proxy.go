// Package proxy implements a recording HTTP forward proxy. Plain HTTP traffic
// is captured in full (request and response); HTTPS/CONNECT is tunnelled and
// recorded as a host-level entry.
package proxy

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"curlui/server/internal/mitm"
	"curlui/server/internal/models"
)

const maxCaptureBody = 2 << 20 // 2 MiB per side

// Proxy is a recording forward proxy.
type Proxy struct {
	addr      string
	record    func(models.CaptureEntry)
	transport *http.Transport
	ca        *mitm.CA
}

// New creates a proxy that reports captures through record. When ca is nil,
// HTTPS/CONNECT is tunnelled instead of intercepted.
func New(addr string, record func(models.CaptureEntry), ca *mitm.CA) *Proxy {
	return &Proxy{
		addr:   addr,
		record: record,
		ca:     ca,
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

// ListenAndServe blocks serving the proxy.
func (p *Proxy) ListenAndServe() error {
	srv := &http.Server{
		Addr:              p.addr,
		Handler:           http.HandlerFunc(p.handle),
		ReadHeaderTimeout: 15 * time.Second,
	}
	return srv.ListenAndServe()
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

	outReq, err := http.NewRequest(r.Method, r.URL.String(), bytes.NewReader(reqBody))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	copyHeaders(outReq.Header, r.Header)
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

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)

	p.recordCapture(r, reqBody, resp.StatusCode, resp.Header, respBody, start, nil)
}

func (p *Proxy) tunnel(w http.ResponseWriter, r *http.Request) {
	if p.ca != nil {
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

		p.record(models.CaptureEntry{
			At:              start.UnixMilli(),
			Method:          req.Method,
			URL:             url,
			RequestHeaders:  cloneHeader(req.Header),
			RequestBody:     string(reqBody),
			Status:          resp.StatusCode,
			ResponseHeaders: cloneHeader(resp.Header),
			ResponseBody:    string(respBody),
			ContentType:     resp.Header.Get("Content-Type"),
			Duration:        time.Since(start).Milliseconds(),
		})

		out := &http.Response{
			StatusCode:    resp.StatusCode,
			Status:        resp.Status,
			Proto:         "HTTP/1.1",
			ProtoMajor:    1,
			ProtoMinor:    1,
			Header:        resp.Header,
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
