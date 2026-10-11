//go:build !core

package api

import (
	"net/http"
	"strings"
	"time"

	"curlui/server/internal/store"
)

// --- personal access tokens -------------------------------------------------

func (s *Server) listScopes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"scopes": store.AllScopes})
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r)
	writeJSON(w, http.StatusOK, map[string]any{"tokens": s.store.ListPATs(user.ID)})
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r)
	var in struct {
		Name       string   `json:"name"`
		Scopes     []string `json:"scopes"`
		ExpiresDay int      `json:"expiresInDays"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	// A token can never grant more than the user already has.
	if user.Role != "admin" {
		filtered := in.Scopes[:0]
		for _, sc := range in.Scopes {
			if sc != store.ScopeAdmin {
				filtered = append(filtered, sc)
			}
		}
		in.Scopes = filtered
	}
	ttl := time.Duration(in.ExpiresDay) * 24 * time.Hour
	pat, token, err := s.store.CreatePAT(user.ID, in.Name, in.Scopes, ttl)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: user.Username, Action: "token.create", Target: pat.ID, Detail: pat.Name + " [" + strings.Join(pat.Scopes, ",") + "]"})
	// The plaintext token is returned exactly once.
	writeJSON(w, http.StatusOK, map[string]any{"token": pat, "secret": token})
}

func (s *Server) deleteToken(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r)
	id := r.PathValue("id")
	for _, t := range s.store.ListPATs(user.ID) {
		if t.ID == id {
			if err := s.store.DeletePAT(id); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			s.store.AddAudit(store.AuditEntry{User: user.Username, Action: "token.revoke", Target: t.ID, Detail: t.Name})
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
	}
	writeErr(w, http.StatusNotFound, "token not found")
}

// scopeFor maps a request to the scope a personal access token must hold.
// Session logins are not scoped — this only constrains tokens.
func scopeFor(method, path string) string {
	switch {
	case path == "/mcp" || strings.HasPrefix(path, "/mcp/"):
		return store.ScopeMCP
	case strings.HasPrefix(path, "/api/ai/"):
		return store.ScopeAI
	case strings.HasPrefix(path, "/api/tokens"), strings.HasPrefix(path, "/api/users"),
		strings.HasPrefix(path, "/api/projects"), strings.HasPrefix(path, "/api/audit"):
		return store.ScopeAdmin
	case path == "/api/send", path == "/api/stream",
		strings.HasPrefix(path, "/api/grpc"), strings.HasPrefix(path, "/api/fuzz"),
		strings.HasPrefix(path, "/api/run"), strings.HasPrefix(path, "/api/schedule"):
		return store.ScopeSend
	case strings.HasPrefix(path, "/api/export"):
		return store.ScopeRead
	case method == http.MethodGet, method == http.MethodHead:
		return store.ScopeRead
	default:
		return store.ScopeWrite
	}
}

func (s *Server) registerTokenRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/tokens/scopes", s.listScopes)
	mux.HandleFunc("GET /api/tokens", s.listTokens)
	mux.HandleFunc("POST /api/tokens", s.createToken)
	mux.HandleFunc("DELETE /api/tokens/{id}", s.deleteToken)
}
