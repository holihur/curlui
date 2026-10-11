package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"curlui/server/internal/variables"
)

// maxStreamBytes caps a single streamed response to keep memory bounded.
const maxStreamBytes = 32 << 20

// streamRequest executes an HTTP request and forwards the response to the
// browser incrementally as Server-Sent Events. It powers live SSE, chunked and
// long-polling views in the UI.
func (s *Server) streamRequest(w http.ResponseWriter, r *http.Request) {
	var payload sendPayload
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming is not supported by this connection")
		return
	}
	if payload.Request.Protocol == "grpc" {
		writeErr(w, http.StatusBadRequest, "use /api/grpc/call for gRPC requests")
		return
	}

	st := s.db(r)
	envSet := variables.Set{}
	if payload.EnvID != "" {
		for _, env := range st.Environments() {
			if env.ID == payload.EnvID {
				envSet = variables.FromEnvironment(&env)
				break
			}
		}
	}
	if len(payload.Variables) > 0 {
		envSet = envSet.Merge(variables.Set(payload.Variables))
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	send := func(event string, v any) {
		b, _ := json.Marshal(v)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
		flusher.Flush()
	}

	resp, sent, timing, cancel, err := s.executor.ExecuteStream(r.Context(), payload.Request, envSet)
	defer cancel()
	if err != nil {
		send("error", map[string]any{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	send("meta", map[string]any{
		"status":      resp.StatusCode,
		"statusText":  resp.Status,
		"headers":     resp.Header,
		"contentType": resp.Header.Get("Content-Type"),
		"timing":      timing,
		"request":     sent,
	})

	buf := make([]byte, 16*1024)
	total := 0
	started := time.Now()
	for {
		select {
		case <-r.Context().Done():
			send("done", map[string]any{"size": total, "cancelled": true})
			return
		default:
		}
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			total += n
			send("chunk", map[string]any{"text": string(buf[:n]), "size": total})
			if total >= maxStreamBytes {
				send("done", map[string]any{"size": total, "truncated": true})
				return
			}
		}
		if rerr != nil {
			if rerr != io.EOF {
				send("error", map[string]any{"error": rerr.Error()})
			}
			break
		}
	}
	send("done", map[string]any{"size": total, "duration": time.Since(started).Milliseconds()})
}
