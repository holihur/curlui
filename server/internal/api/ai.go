//go:build !core

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"curlui/server/internal/ai"
	"curlui/server/internal/models"
	"curlui/server/internal/store"
)

// aiConfig reads the *calling user's* BYOK settings. Keys are per-user and are
// only ever used server-side; they are never returned to the browser.
func (s *Server) aiConfig(r *http.Request) ai.Config {
	user := userFrom(r)
	cfg := s.store.AIConfigFor(user.ID)
	return ai.Config{
		Provider: cfg.Provider,
		APIKey:   cfg.APIKey,
		BaseURL:  cfg.BaseURL,
		Model:    cfg.Model,
	}
}

// getAISettings returns the caller's BYOK configuration without the secret.
func (s *Server) getAISettings(w http.ResponseWriter, r *http.Request) {
	cfg := s.store.AIConfigFor(userFrom(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": cfg.Configured(),
		"provider":   cfg.Provider,
		"model":      cfg.Model,
		"baseUrl":    cfg.BaseURL,
		"allow":      cfg.Allow,
		"deny":       cfg.Deny,
	})
}

// saveAISettings stores the caller's BYOK configuration. An empty key keeps the
// existing secret so it never has to travel back to the browser.
func (s *Server) saveAISettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Provider string    `json:"provider"`
		APIKey   string    `json:"apiKey"`
		BaseURL  string    `json:"baseUrl"`
		Model    string    `json:"model"`
		Allow    *[]string `json:"allow"`
		Deny     *[]string `json:"deny"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	user := userFrom(r)
	cfg := store.UserAI{
		Provider: in.Provider,
		APIKey:   in.APIKey,
		BaseURL:  strings.TrimRight(in.BaseURL, "/"),
		Model:    in.Model,
	}
	// Only touch the lists when the client actually sends them.
	if in.Allow != nil {
		cfg.Allow = *in.Allow
	}
	if in.Deny != nil {
		cfg.Deny = *in.Deny
	}
	if err := s.store.SetAIConfig(user.ID, cfg); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := s.store.AIConfigFor(user.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": out.Configured(),
		"provider":   out.Provider,
		"model":      out.Model,
		"baseUrl":    out.BaseURL,
		"allow":      out.Allow,
		"deny":       out.Deny,
	})
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

// --- human-in-the-loop approval ---------------------------------------------

type pending struct {
	user string
	ch   chan string
}

// confirmRegistry holds the tool calls waiting for a human decision.
var (
	confirmMu  sync.Mutex
	confirmReg = map[string]*pending{}
)

func registerConfirm(id, user string) chan string {
	ch := make(chan string, 1)
	confirmMu.Lock()
	confirmReg[id] = &pending{user: user, ch: ch}
	confirmMu.Unlock()
	return ch
}

func resolveConfirm(id, user, decision string) bool {
	confirmMu.Lock()
	p, ok := confirmReg[id]
	if ok && p.user == user {
		delete(confirmReg, id)
	}
	confirmMu.Unlock()
	if !ok || p.user != user {
		return false
	}
	select {
	case p.ch <- decision:
	default:
	}
	return true
}

// sseGuard enforces the user's allow/deny rules and asks the browser to approve
// anything else, blocking the tool call until the human answers.
type sseGuard struct {
	s     *Server
	rules ai.Rules
	user  string
	emit  func(ai.Event) error
}

func (g *sseGuard) Approve(ctx context.Context, tool, subject string, args map[string]any) error {
	if !ai.NeedsApproval(tool) {
		return nil
	}
	if allowed, reason := g.rules.Decide(tool, subject); allowed != nil {
		if *allowed {
			return nil
		}
		return fmt.Errorf("refused: %s", reason)
	}
	id := models.NewID()
	ch := registerConfirm(id, g.user)
	rule := ai.RuleFor(tool, subject)
	if err := g.emit(ai.Event{Confirm: &ai.Confirm{ID: id, Tool: tool, Subject: subject, Args: args, Rule: rule}}); err != nil {
		return err
	}
	select {
	case decision := <-ch:
		switch decision {
		case "once", "always":
			if decision == "always" {
				_ = g.s.store.AddAIRule(g.user, "allow", rule)
			}
			return nil
		default:
			return fmt.Errorf("the user denied this action")
		}
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(5 * time.Minute):
		return fmt.Errorf("no confirmation was received")
	}
}

// confirmAI resolves a pending tool approval.
func (s *Server) confirmAI(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID       string `json:"id"`
		Decision string `json:"decision"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	user := userFrom(r)
	if !resolveConfirm(in.ID, user.ID, in.Decision) {
		writeErr(w, http.StatusNotFound, "no such pending confirmation")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// aiScope gates the assistant behind the token scope when a PAT is used.

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
	var writeMu sync.Mutex
	send := func(ev ai.Event) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		ev.SessionID = sessionID
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
		return nil
	}
	ucfg := s.store.AIConfigFor(user.ID)
	guard := &sseGuard{
		s:     s,
		user:  user.ID,
		rules: ai.Rules{Allow: ucfg.Allow, Deny: ucfg.Deny},
		emit:  send,
	}
	agent, err := ai.NewAgent(cfg, s, scopesFrom(r), guard)
	if err != nil {
		_ = send(ai.Event{Error: err.Error()})
		return
	}

	if err := agent.Chat(r.Context(), user.ID, sessionID, in.Message, send); err != nil {
		_ = send(ai.Event{Error: err.Error()})
	}
}

func (s *Server) registerAIRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/ai/status", s.aiStatus)
	mux.HandleFunc("GET /api/ai/settings", s.getAISettings)
	mux.HandleFunc("PUT /api/ai/settings", s.saveAISettings)
	mux.HandleFunc("POST /api/ai/chat", s.aiChat)
	mux.HandleFunc("POST /api/ai/confirm", s.confirmAI)
}
