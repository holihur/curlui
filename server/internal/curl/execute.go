package curl

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"curlui/server/internal/assert"
	hookspkg "curlui/server/internal/hooks"
	"curlui/server/internal/models"
	"curlui/server/internal/variables"
)

// maxBodyBytes caps how much of a response body we read into memory.
const maxBodyBytes = 25 << 20 // 25 MiB

// Executor performs HTTP requests.
type Executor struct {
	// AllowPrivate permits requests to loopback/private addresses. The API
	// layer enables this since the tool is meant to be run locally.
	AllowPrivate bool
	// UserAgent, when set, provides the default User-Agent header for requests
	// that don't specify one.
	UserAgent func() string
}

// Execute runs the request definition. Variables are resolved internally so
// that pre-request hooks can add or override them first. When mock is true a
// configured mock response is returned instead of hitting the network.
func (e *Executor) Execute(ctx context.Context, def models.RequestDef, vars variables.Set, mock bool) models.Response {
	def.WithDefaults()
	if vars == nil {
		vars = variables.Set{}
	}
	resp := models.Response{
		Headers: map[string][]string{},
		Request: models.SentRequest{Headers: map[string][]string{}},
	}

	// Pre-request hook: may patch the request and/or set variables.
	if hook := def.Scripts.Pre; hook.Enabled && strings.TrimSpace(hook.Command) != "" {
		result, output := e.runHook(ctx, "pre", &def, nil, vars)
		resp.Hooks = append(resp.Hooks, result)
		if result.Error != "" {
			resp.Error = "pre-request hook: " + result.Error
			return resp
		}
		if output.Abort {
			resp.Error = "request aborted by pre-request hook"
			return resp
		}
		if len(output.Request) > 0 {
			updated, err := hookspkg.ApplyRequest(def, output.Request)
			if err != nil {
				resp.Error = "pre-request hook: invalid request patch: " + err.Error()
				return resp
			}
			def = updated
		}
		if len(output.Variables) > 0 {
			vars = vars.Merge(variables.Set(output.Variables))
		}
		if output.Error != "" {
			resp.Error = output.Error
			return resp
		}
	}

	// Resolve {{variables}} after the pre-request hook has run.
	def = vars.ResolveRequest(def)

	if mock {
		return e.runMock(ctx, def, vars)
	}

	// Build the final URL with query params.
	finalURL, err := buildURL(def)
	if err != nil {
		resp.Error = err.Error()
		return resp
	}

	// Assemble headers and body.
	header := http.Header{}
	for _, h := range def.Headers {
		if !h.Enabled || h.Key == "" {
			continue
		}
		header.Add(h.Key, h.Value)
	}

	bodyReader, contentType, err := buildBody(def)
	if err != nil {
		resp.Error = err.Error()
		return resp
	}
	if contentType != "" && header.Get("Content-Type") == "" {
		header.Set("Content-Type", contentType)
	}

	// Authentication.
	applyAuth(&def, header, &finalURL)

	// Default User-Agent / Accept when not supplied.
	if header.Get("User-Agent") == "" {
		ua := "curlui/1.0"
		if e.UserAgent != nil {
			if v := strings.TrimSpace(e.UserAgent()); v != "" {
				ua = v
			}
		}
		header.Set("User-Agent", ua)
	}
	if header.Get("Accept") == "" {
		header.Set("Accept", "*/*")
	}

	timeout := time.Duration(def.Options.Timeout) * time.Millisecond
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, strings.ToUpper(def.Method), finalURL, bodyReader)
	if err != nil {
		resp.Error = err.Error()
		return resp
	}
	req.Header = header

	// Trace detailed timings.
	var (
		start          = time.Now()
		dnsStart       time.Time
		connectStart   time.Time
		tlsStart       time.Time
		timing         models.Timing
		gotFirstByteAt time.Time
	)
	trace := &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone: func(httptrace.DNSDoneInfo) {
			if !dnsStart.IsZero() {
				timing.DNS = time.Since(dnsStart).Milliseconds()
			}
		},
		ConnectStart: func(_, _ string) {
			if connectStart.IsZero() {
				connectStart = time.Now()
			}
		},
		ConnectDone: func(_, _ string, err error) {
			if err == nil && !connectStart.IsZero() {
				timing.Connect = time.Since(connectStart).Milliseconds()
			}
		},
		TLSHandshakeStart: func() { tlsStart = time.Now() },
		TLSHandshakeDone: func(tls.ConnectionState, error) {
			if !tlsStart.IsZero() {
				timing.TLS = time.Since(tlsStart).Milliseconds()
			}
		},
		GotFirstResponseByte: func() {
			gotFirstByteAt = time.Now()
			timing.FirstByte = gotFirstByteAt.Sub(start).Milliseconds()
		},
	}
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

	// Build the HTTP client with the requested options.
	client := e.newClient(def)
	resp.Request = models.SentRequest{
		Method:  req.Method,
		URL:     finalURL,
		Headers: cloneHeader(header),
	}
	if def.Body.Type != "none" {
		resp.Request.Body = def.Body.Raw
	}

	httpResp, err := client.Do(req)
	timing.Total = time.Since(start).Milliseconds()
	resp.Timing = timing
	resp.Duration = timing.Total
	if err != nil {
		resp.Error = friendlyError(err)
		return resp
	}
	defer httpResp.Body.Close()

	data, truncated, err := readLimited(httpResp.Body, maxBodyBytes)
	if err != nil {
		resp.Error = friendlyError(err)
	}

	resp.Status = httpResp.StatusCode
	resp.StatusText = statusText(httpResp)
	resp.Headers = cloneHeader(httpResp.Header)
	resp.Size = len(data)
	if truncated {
		resp.Size = len(data)
	}

	ct := httpResp.Header.Get("Content-Type")
	resp.ContentType = ct

	// Detect binary content.
	if isBinary(ct, data) {
		resp.IsBinary = true
		resp.BodyBase64 = base64.StdEncoding.EncodeToString(data)
		resp.Body = fmt.Sprintf("[binary content: %d bytes]", len(data))
	} else {
		resp.Body = string(data)
	}

	for _, c := range httpResp.Cookies() {
		rc := models.Cookie{
			Name: c.Name, Value: c.Value, Domain: c.Domain, Path: c.Path,
			HTTPOnly: c.HttpOnly, Secure: c.Secure,
		}
		if !c.Expires.IsZero() {
			rc.Expires = c.Expires.Format(time.RFC3339)
		}
		resp.Cookies = append(resp.Cookies, rc)
	}

	// Response assertions (status / time / header / body / JSON path).
	if len(def.Assertions) > 0 {
		resp.Assertions = assert.Evaluate(&resp, def.Assertions)
	}

	// Post-response hook: may set variables and report test results.
	if hook := def.Scripts.Post; hook.Enabled && strings.TrimSpace(hook.Command) != "" {
		result, output := e.runHook(ctx, "post", &def, &resp, vars)
		resp.Hooks = append(resp.Hooks, result)
		if output.Error != "" && resp.Error == "" {
			resp.Error = output.Error
		}
	}
	return resp
}

// firstMock returns the enabled mock matching name (or the first enabled one).
func firstMock(mocks []models.MockResponse, name string) *models.MockResponse {
	var first *models.MockResponse
	for i := range mocks {
		if !mocks[i].Enabled {
			continue
		}
		if name != "" && mocks[i].Name == name {
			return &mocks[i]
		}
		if first == nil {
			first = &mocks[i]
		}
	}
	return first
}

// runMock builds a response from a configured mock.
func (e *Executor) runMock(ctx context.Context, def models.RequestDef, vars variables.Set) models.Response {
	resp := models.Response{
		Headers: map[string][]string{},
		Request: models.SentRequest{Method: def.Method, URL: "(mock) " + def.URL, Headers: map[string][]string{}},
	}
	mock := firstMock(def.Mocks, "")
	if mock == nil {
		resp.Error = "no mock response configured for this request"
		return resp
	}
	if mock.DelayMs > 0 {
		select {
		case <-time.After(time.Duration(mock.DelayMs) * time.Millisecond):
		case <-ctx.Done():
			resp.Error = "mock delay cancelled"
			return resp
		}
	}
	status := mock.Status
	if status == 0 {
		status = http.StatusOK
	}
	resp.Status = status
	resp.StatusText = http.StatusText(status)
	for _, h := range mock.Headers {
		if h.Enabled && h.Key != "" {
			k := http.CanonicalHeaderKey(h.Key)
			resp.Headers[k] = append(resp.Headers[k], vars.Resolve(h.Value))
		}
	}
	body := vars.Resolve(mock.Body)
	resp.Body = body
	resp.Size = len(body)
	if ct := resp.Headers["Content-Type"]; len(ct) > 0 {
		resp.ContentType = ct[0]
	} else {
		resp.ContentType = "application/json"
	}
	resp.Duration = int64(mock.DelayMs)
	resp.Timing = models.Timing{FirstByte: int64(mock.DelayMs), Total: int64(mock.DelayMs)}
	if len(def.Assertions) > 0 {
		resp.Assertions = assert.Evaluate(&resp, def.Assertions)
	}
	return resp
}

// runHook executes one hook, feeding it the request/response context on stdin.
func (e *Executor) runHook(ctx context.Context, phase string, def *models.RequestDef, resp *models.Response, vars variables.Set) (models.HookResult, hookspkg.Output) {
	hook := def.Scripts.Pre
	if phase == "post" {
		hook = def.Scripts.Post
	}
	input := hookspkg.Input{
		Phase:     phase,
		Request:   def,
		Variables: vars,
	}
	if resp != nil {
		input.Response = &hookspkg.ResponseView{
			Status:     resp.Status,
			StatusText: resp.StatusText,
			Headers:    resp.Headers,
			Body:       resp.Body,
			Duration:   resp.Duration,
		}
	}

	r := hookspkg.Run(ctx, hook, input)
	out := models.HookResult{
		Phase:    phase,
		Command:  hook.Command,
		Ran:      true,
		ExitCode: r.ExitCode,
		Stdout:   r.Stdout,
		Stderr:   r.Stderr,
		Log:      r.Output.Log,
		Tests:    r.Output.Tests,
		Vars:     r.Output.Variables,
		Duration: r.Duration,
	}
	if r.Err != nil {
		out.Error = r.Err.Error()
	}
	return out, r.Output
}

func (e *Executor) newClient(def models.RequestDef) *http.Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: 2 * time.Second,
		ResponseHeaderTimeout: 0,
	}
	if !def.Options.VerifyTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	}
	if p := strings.TrimSpace(def.Options.Proxy); p != "" {
		if pu, err := url.Parse(p); err == nil {
			transport.Proxy = http.ProxyURL(pu)
		}
	}

	client := &http.Client{Transport: transport}
	if !def.Options.FollowRedirects {
		client.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
	} else if def.Options.MaxRedirects > 0 {
		max := def.Options.MaxRedirects
		client.CheckRedirect = func(_ *http.Request, via []*http.Request) error {
			if len(via) >= max {
				return errors.New("stopped after too many redirects")
			}
			return nil
		}
	}
	return client
}

func buildURL(def models.RequestDef) (string, error) {
	raw := strings.TrimSpace(def.URL)
	if raw == "" {
		return "", errors.New("URL is empty")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	q := u.Query()
	for _, p := range def.Params {
		if p.Enabled && p.Key != "" {
			q.Add(p.Key, p.Value)
		}
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func buildBody(def models.RequestDef) (io.Reader, string, error) {
	switch def.Body.Type {
	case "", "none":
		return nil, "", nil
	case "json":
		return strings.NewReader(def.Body.Raw), "application/json", nil
	case "xml":
		return strings.NewReader(def.Body.Raw), "application/xml", nil
	case "html":
		return strings.NewReader(def.Body.Raw), "text/html", nil
	case "text":
		return strings.NewReader(def.Body.Raw), "text/plain", nil
	case "form-urlencoded":
		vals := url.Values{}
		for _, f := range def.Body.Form {
			if f.Enabled && f.Key != "" {
				vals.Add(f.Key, f.Value)
			}
		}
		return strings.NewReader(vals.Encode()), "application/x-www-form-urlencoded", nil
	case "form-data":
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		for _, f := range def.Body.Form {
			if !f.Enabled || f.Key == "" {
				continue
			}
			if f.Type == "file" || f.FilePath != "" {
				if err := addFilePart(w, f); err != nil {
					return nil, "", err
				}
				continue
			}
			_ = w.WriteField(f.Key, f.Value)
		}
		if err := w.Close(); err != nil {
			return nil, "", err
		}
		return &buf, w.FormDataContentType(), nil
	case "binary":
		f, err := os.Open(def.Body.FilePath)
		if err != nil {
			return nil, "", fmt.Errorf("cannot open file %q: %w", def.Body.FilePath, err)
		}
		return f, "application/octet-stream", nil
	default:
		return strings.NewReader(def.Body.Raw), "text/plain", nil
	}
}

func addFilePart(w *multipart.Writer, f models.KeyValue) error {
	data, err := os.ReadFile(f.FilePath)
	if err != nil {
		return fmt.Errorf("cannot open file %q: %w", f.FilePath, err)
	}
	filename := filepath.Base(f.FilePath)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, f.Key, filename))
	h.Set("Content-Type", detectMIME(f.FilePath, data))
	part, err := w.CreatePart(h)
	if err != nil {
		return err
	}
	_, err = part.Write(data)
	return err
}

func applyAuth(def *models.RequestDef, header http.Header, finalURL *string) {
	switch def.Auth.Type {
	case "basic":
		token := base64.StdEncoding.EncodeToString([]byte(def.Auth.Username + ":" + def.Auth.Password))
		header.Set("Authorization", "Basic "+token)
	case "bearer":
		if def.Auth.Token != "" {
			header.Set("Authorization", "Bearer "+def.Auth.Token)
		}
	case "apikey":
		if def.Auth.Key == "" {
			return
		}
		if def.Auth.AddTo == "query" {
			u, err := url.Parse(*finalURL)
			if err == nil {
				q := u.Query()
				q.Set(def.Auth.Key, def.Auth.Value)
				u.RawQuery = q.Encode()
				*finalURL = u.String()
			}
		} else {
			header.Set(def.Auth.Key, def.Auth.Value)
		}
	}
}

func readLimited(r io.Reader, limit int64) ([]byte, bool, error) {
	var buf bytes.Buffer
	n, err := io.Copy(&buf, io.LimitReader(r, limit+1))
	if err != nil {
		return buf.Bytes(), false, err
	}
	if n > limit {
		return buf.Bytes()[:limit], true, nil
	}
	return buf.Bytes(), false, nil
}

func isBinary(contentType string, data []byte) bool {
	ct := strings.ToLower(contentType)
	for _, b := range []string{"image/", "audio/", "video/", "application/octet-stream",
		"application/pdf", "application/zip", "application/gzip", "font/", "application/x-"} {
		if strings.Contains(ct, b) {
			return true
		}
	}
	if strings.Contains(ct, "text/") || strings.Contains(ct, "json") ||
		strings.Contains(ct, "xml") || strings.Contains(ct, "html") ||
		strings.Contains(ct, "javascript") {
		return false
	}
	// Sniff: NUL byte or invalid UTF-8 suggests binary.
	sample := data
	if len(sample) > 1024 {
		sample = sample[:1024]
	}
	if bytes.IndexByte(sample, 0) >= 0 {
		return true
	}
	return len(sample) > 0 && !utf8.Valid(sample)
}

func detectMIME(path string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".json":
		return "application/json"
	case ".txt", ".log", ".md", ".csv":
		return "text/plain"
	case ".xml":
		return "application/xml"
	case ".html", ".htm":
		return "text/html"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".pdf":
		return "application/pdf"
	}
	if len(data) > 0 {
		return http.DetectContentType(data)
	}
	return "application/octet-stream"
}

func statusText(resp *http.Response) string {
	if resp.Status != "" {
		if i := strings.IndexByte(resp.Status, ' '); i > 0 {
			return resp.Status[i+1:]
		}
	}
	return http.StatusText(resp.StatusCode)
}

func cloneHeader(h http.Header) map[string][]string {
	out := make(map[string][]string, len(h))
	for k, v := range h {
		cp := make([]string, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

func friendlyError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case errors.Is(err, context.DeadlineExceeded) || strings.Contains(msg, "context deadline exceeded"):
		return "request timed out"
	case strings.Contains(msg, "no such host"):
		return "DNS lookup failed: " + msg
	case strings.Contains(msg, "connection refused"):
		return "connection refused: " + msg
	case strings.Contains(msg, "certificate"):
		return "TLS certificate error: " + msg + " (try disabling TLS verification)"
	}
	return msg
}
