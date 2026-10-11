//go:build !core

package proxy

import (
	"context"
	"sync"
	"time"

	"curlui/server/internal/models"
)

// PendingInfo describes a request or response paused at a breakpoint.
type PendingInfo struct {
	ID        string              `json:"id"`
	Phase     string              `json:"phase"` // "request" | "response"
	Method    string              `json:"method"`
	URL       string              `json:"url"`
	Status    int                 `json:"status,omitempty"` // response phase
	Headers   map[string][]string `json:"headers"`
	Body      string              `json:"body"`
	CreatedAt int64               `json:"createdAt"`
}

// Resolution is the outcome of a breakpoint: continue (optionally modified) or
// abort.
type Resolution struct {
	Abort   bool
	Method  string
	URL     string
	Status  int
	Headers map[string][]string
	Body    []byte
}

type pending struct {
	info PendingInfo
	ch   chan Resolution
}

// Interceptor pauses matching requests/responses until the UI resolves them.
type Interceptor struct {
	mu          sync.Mutex
	items       map[string]*pending
	reqEnabled  func() bool
	reqFilter   func(string) bool
	respEnabled func() bool
	respFilter  func(string) bool
}

// NewInterceptor creates an interceptor. The enabled funcs report whether the
// request/response breakpoints are on; the filters decide which URLs pause
// (nil = all).
func NewInterceptor(reqEnabled func() bool, reqFilter func(string) bool, respEnabled func() bool, respFilter func(string) bool) *Interceptor {
	return &Interceptor{
		items:       map[string]*pending{},
		reqEnabled:  reqEnabled,
		reqFilter:   reqFilter,
		respEnabled: respEnabled,
		respFilter:  respFilter,
	}
}

func enabled(fn func() bool) bool { return fn != nil && fn() }
func matches(fn func(string) bool, url string) bool {
	return fn == nil || fn(url)
}

// Intercept pauses a request and waits for a resolution or timeout. The second
// return value reports whether it was intercepted.
func (i *Interceptor) Intercept(ctx context.Context, method, url string, headers map[string][]string, body []byte, timeout time.Duration) (Resolution, bool) {
	original := Resolution{Method: method, URL: url, Headers: headers, Body: body}
	if i == nil || !enabled(i.reqEnabled) || !matches(i.reqFilter, url) {
		return original, false
	}
	return i.pause(ctx, PendingInfo{Phase: "request", Method: method, URL: url, Headers: headers, Body: string(body)}, original, timeout)
}

// InterceptResponse pauses an upstream response before it is returned to the
// client.
func (i *Interceptor) InterceptResponse(ctx context.Context, method, url string, status int, headers map[string][]string, body []byte, timeout time.Duration) (Resolution, bool) {
	original := Resolution{Status: status, Headers: headers, Body: body}
	if i == nil || !enabled(i.respEnabled) || !matches(i.respFilter, url) {
		return original, false
	}
	return i.pause(ctx, PendingInfo{Phase: "response", Method: method, URL: url, Status: status, Headers: headers, Body: string(body)}, original, timeout)
}

func (i *Interceptor) pause(ctx context.Context, info PendingInfo, original Resolution, timeout time.Duration) (Resolution, bool) {
	info.ID = models.NewID()
	info.CreatedAt = time.Now().UnixMilli()
	p := &pending{info: info, ch: make(chan Resolution, 1)}

	i.mu.Lock()
	i.items[info.ID] = p
	i.mu.Unlock()
	defer func() {
		i.mu.Lock()
		delete(i.items, info.ID)
		i.mu.Unlock()
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case res := <-p.ch:
		return res, true
	case <-timer.C:
		return original, true // timed out: proceed unchanged
	case <-ctx.Done():
		return original, true
	}
}

// List returns the currently paused items.
func (i *Interceptor) List() []PendingInfo {
	if i == nil {
		return nil
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	out := make([]PendingInfo, 0, len(i.items))
	for _, p := range i.items {
		out = append(out, p.info)
	}
	return out
}

// Resolve delivers a decision to a paused item.
func (i *Interceptor) Resolve(id string, res Resolution) bool {
	if i == nil {
		return false
	}
	i.mu.Lock()
	p := i.items[id]
	i.mu.Unlock()
	if p == nil {
		return false
	}
	select {
	case p.ch <- res:
		return true
	default:
		return false
	}
}
