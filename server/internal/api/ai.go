//go:build !core

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"curlui/server/internal/ai"
	"curlui/server/internal/models"
)

// aiConfig reads the BYOK settings. The API key is used server-side only and
// is never returned to the browser.
func (s *Server) aiConfig(r *http.Request) ai.Config {
	// BYOK credentials are server-wide, stored in the global settings.
	st := s.store.Settings()
	return ai.Config{
		Provider: st["aiProvider"],
		APIKey:   st["aiApiKey"],
		BaseURL:  st["aiBaseUrl"],
		Model:    st["aiModel"],
	}
}

// aiStatus reports whether BYOK is configured (without leaking the key).
func (s *Server) aiStatus(w http.ResponseWriter, r *http.Request) {
	cfg := s.aiConfig(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": strings.TrimSpace(cfg.APIKey) != "" && strings.TrimSpace(cfg.Model) != "",
		"provider":   cfg.Provider,
		"model":      cfg.Model,
		"baseUrl":    cfg.BaseURL,
	})
}

// aiChat runs one assistant turn and streams the steps as Server-Sent Events.
// The agent is built from the caller's scopes, so it can never do more than the
// token (or session) allows.
func (s *Server) aiChat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Message   string `json:"message"`
		SessionID string `json:"sessionId"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if strings.TrimSpace(in.Message) == "" {
		writeErr(w, http.StatusBadRequest, "message is required")
		return
	}
	cfg := s.aiConfig(r)
	if strings.TrimSpace(cfg.APIKey) == "" || strings.TrimSpace(cfg.Model) == "" {
		writeErr(w, http.StatusBadRequest, "no model configured — add your API key in Settings → AI")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming is not supported by this connection")
		return
	}

	agent, err := ai.NewAgent(cfg, s, scopesFrom(r))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	sessionID := strings.TrimSpace(in.SessionID)
	if sessionID == "" {
		sessionID = models.NewID()
	}
	user := userFrom(r)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	send := func(ev ai.Event) error {
		ev.SessionID = sessionID
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
		return nil
	}
	if err := agent.Chat(r.Context(), user.ID, sessionID, in.Message, send); err != nil {
		_ = send(ai.Event{Error: err.Error()})
	}
}

func (s *Server) registerAIRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/ai/status", s.aiStatus)
	mux.HandleFunc("POST /api/ai/chat", s.aiChat)
}
