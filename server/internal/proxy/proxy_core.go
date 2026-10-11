//go:build core

// Package proxy is not compiled into the core build; these stubs keep the API
// layer compiling (the capture proxy UI is hidden in core).
package proxy

import (
	"net"

	"curlui/server/internal/mitm"
	"curlui/server/internal/models"
)

// PendingInfo describes a paused breakpoint item.
type PendingInfo struct {
	ID        string              `json:"id"`
	Phase     string              `json:"phase"`
	Method    string              `json:"method"`
	URL       string              `json:"url"`
	Status    int                 `json:"status,omitempty"`
	Headers   map[string][]string `json:"headers"`
	Body      string              `json:"body"`
	CreatedAt int64               `json:"createdAt"`
}

// Resolution is how a paused item is resolved.
type Resolution struct {
	Abort   bool
	Method  string
	URL     string
	Status  int
	Headers map[string][]string
	Body    []byte
}

// Interceptor is a no-op in the core build.
type Interceptor struct{}

func (i *Interceptor) List() []PendingInfo                  { return nil }
func (i *Interceptor) Resolve(id string, r Resolution) bool { return false }

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

// Proxy is a no-op in the core build.
type Proxy struct{ interceptor Interceptor }

func New(addr string, record func(models.CaptureEntry), opts Options) *Proxy { return &Proxy{} }
func (p *Proxy) Interceptor() *Interceptor                                   { return &p.interceptor }
func (p *Proxy) Serve(ln net.Listener) error                                 { return nil }
func (p *Proxy) Close() error                                                { return nil }
