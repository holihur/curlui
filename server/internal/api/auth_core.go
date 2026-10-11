//go:build core

package api

import (
	"net/http"

	"curlui/server/internal/store"
)

// The core build is single-user: no login, no projects, no OIDC.

func anonymousUser() *store.User {
	return &store.User{ID: store.AnonymousUserID, Username: "local", Name: "Local user", Role: "admin"}
}

func (s *Server) authEnabled() bool { return false }

// db returns the (only) workspace.
func (s *Server) db(r *http.Request) *store.Store { return s.store }

func userFrom(r *http.Request) *store.User { return anonymousUser() }
func projectIDFrom(r *http.Request) string { return store.DefaultProjectID }
func tokenFrom(r *http.Request) string     { return "" }
func isAdmin(r *http.Request) bool         { return true }

// withAuth is a no-op in the core build.
func (s *Server) withAuth(next http.Handler) http.Handler { return next }

func publicUser(u *store.User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "name": u.Name, "role": u.Role}
}

func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"authEnabled":   false,
		"authenticated": true,
		"userCount":     0,
		"user":          publicUser(anonymousUser()),
		"project":       store.DefaultProjectID,
		"role":          "admin",
		"projects":      []map[string]any{{"id": store.DefaultProjectID, "name": "Personal"}},
	})
}

// registerAuthRoutes exposes only the status endpoint in the core build.
func (s *Server) registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/status", s.authStatus)
	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}
