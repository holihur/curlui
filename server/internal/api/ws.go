package api

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"curlui/server/internal/store"
)

// wsFrame is the JSON envelope exchanged with the browser over /api/ws.
// Browser -> server: connect | send | close
// Server -> browser: open | message | close | error
type wsFrame struct {
	Type    string            `json:"type"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"` // request headers (connect)
	// WebSocket negotiation
	Subprotocols []string `json:"subprotocols,omitempty"`
	Subprotocol  string   `json:"subprotocol,omitempty"`
	// gRPC streaming mode (protocol == "grpc")
	Protocol     string            `json:"protocol,omitempty"`
	DescriptorID string            `json:"descriptorId,omitempty"`
	Target       string            `json:"target,omitempty"`
	Service      string            `json:"service,omitempty"`
	Method       string            `json:"method,omitempty"`
	Plaintext    bool              `json:"plaintext,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	// Payloads
	Data      string `json:"data,omitempty"`
	Binary    bool   `json:"binary,omitempty"`
	Code      string `json:"code,omitempty"`
	CloseCode int    `json:"closeCode,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Error     string `json:"error,omitempty"`
	// gRPC metadata (multi-valued)
	HeaderMD map[string][]string `json:"headerMd,omitempty"`
	Trailers map[string][]string `json:"trailers,omitempty"`
}

// wsGrpcHandler is installed by the full build (grpc.go) to bridge interactive
// gRPC streams over the WebSocket endpoint.
var wsGrpcHandler func(ctx context.Context, st *store.Store, c *websocket.Conn, first wsFrame, write func(wsFrame) error) error

// wsBridge lets the browser open a WebSocket to any target through the server.
// The browser speaks JSON frames to us; we relay to the upstream socket. This
// avoids mixed-content / CORS restrictions and lets us attach custom headers.
func (s *Server) wsBridge(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		OriginPatterns:     []string{"*"},
	})
	if err != nil {
		return
	}
	defer c.CloseNow()

	ctx := r.Context()

	var mu sync.Mutex
	write := func(f wsFrame) error {
		mu.Lock()
		defer mu.Unlock()
		return wsjson.Write(ctx, c, f)
	}

	var first wsFrame
	if err := wsjson.Read(ctx, c, &first); err != nil {
		return
	}
	if first.Type != "connect" {
		_ = write(wsFrame{Type: "error", Error: "expected a connect frame"})
		return
	}
	// gRPC streaming is bridged over the same socket (full build only).
	if first.Protocol == "grpc" {
		if wsGrpcHandler == nil {
			_ = write(wsFrame{Type: "error", Error: "gRPC is not available in this build"})
			return
		}
		if err := wsGrpcHandler(ctx, s.db(r), c, first, write); err != nil {
			_ = write(wsFrame{Type: "error", Error: err.Error()})
		}
		return
	}
	if strings.TrimSpace(first.URL) == "" {
		_ = write(wsFrame{Type: "error", Error: "expected a connect frame with a url"})
		return
	}
	header := http.Header{}
	for k, v := range first.Headers {
		if strings.TrimSpace(k) != "" {
			header.Set(k, v)
		}
	}

	dialCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	tc, _, err := websocket.Dial(dialCtx, first.URL, &websocket.DialOptions{
		Subprotocols: first.Subprotocols,
		HTTPHeader:   header,
		HTTPClient: &http.Client{
			Transport: &http.Transport{
				Proxy:           http.ProxyFromEnvironment,
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	})
	cancel()
	if err != nil {
		_ = write(wsFrame{Type: "error", Error: err.Error()})
		return
	}
	defer tc.CloseNow()
	_ = write(wsFrame{Type: "open", URL: first.URL, Subprotocol: tc.Subprotocol()})

	// Upstream -> browser.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			typ, data, err := tc.Read(ctx)
			if err != nil {
				st := websocket.CloseStatus(err)
				_ = write(wsFrame{Type: "close", CloseCode: int(st), Reason: err.Error()})
				_ = c.Close(websocket.StatusNormalClosure, "")
				return
			}
			frame := wsFrame{Type: "message", Binary: typ == websocket.MessageBinary}
			if frame.Binary {
				frame.Data = base64.StdEncoding.EncodeToString(data)
			} else {
				frame.Data = string(data)
			}
			if err := write(frame); err != nil {
				return
			}
		}
	}()

	// Browser -> upstream.
	for {
		select {
		case <-done:
			return
		default:
		}
		var f wsFrame
		if err := wsjson.Read(ctx, c, &f); err != nil {
			return
		}
		switch f.Type {
		case "send":
			mt := websocket.MessageText
			payload := []byte(f.Data)
			if f.Binary {
				mt = websocket.MessageBinary
				raw, derr := base64.StdEncoding.DecodeString(f.Data)
				if derr != nil {
					_ = write(wsFrame{Type: "error", Error: "binary payload must be base64"})
					continue
				}
				payload = raw
			}
			if err := tc.Write(ctx, mt, payload); err != nil {
				_ = write(wsFrame{Type: "error", Error: err.Error()})
			}
		case "close":
			_ = tc.Close(websocket.StatusNormalClosure, f.Reason)
			_ = write(wsFrame{Type: "close", Code: f.Code, Reason: f.Reason})
			return
		}
	}
}
