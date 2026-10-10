package proxy

import (
	"context"
	"sync"
	"time"

	"curlui/server/internal/models"
)

// PendingInfo describes a request paused at a breakpoint.
type PendingInfo struct {
	ID        string              `json:"id"`
	Method    string              `json:"method"`
	URL       string              `json:"url"`
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
	Headers map[string][]string
	Body    []byte
}

type pending struct {
	info PendingInfo
	ch   chan Resolution
}

// Interceptor pauses matching requests until the UI resolves them.
type Interceptor struct {
	mu      sync.Mutex
	items   map[string]*pending
	enabled func() bool
	filter  func(string) bool
}

// NewInterceptor creates an interceptor. enabled reports whether breakpoints are
// on; filter decides which URLs are intercepted (nil = all).
func NewInterceptor(enabled func() bool, filter func(string) bool) *Interceptor {
	return &Interceptor{items: map[string]*pending{}, enabled: enabled, filter: filter}
}

// Intercept pauses the request and waits for a resolution or timeout. The
// second return value reports whether the request was intercepted at all.
func (i *Interceptor) Intercept(ctx context.Context, method, url string, headers map[string][]string, body []byte, timeout time.Duration) (Resolution, bool) {
	original := Resolution{Method: method, URL: url, Headers: headers, Body: body}
	if i == nil || i.enabled == nil || !i.enabled() {
		return original, false
	}
	if i.filter != nil && !i.filter(url) {
		return original, false
	}
	id := models.NewID()
	p := &pending{
		info: PendingInfo{ID: id, Method: method, URL: url, Headers: headers, Body: string(body), CreatedAt: time.Now().UnixMilli()},
		ch:   make(chan Resolution, 1),
	}
	i.mu.Lock()
	i.items[id] = p
	i.mu.Unlock()
	defer func() {
		i.mu.Lock()
		delete(i.items, id)
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

// List returns the currently paused requests (newest first).
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

// Resolve delivers a decision to a paused request.
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
