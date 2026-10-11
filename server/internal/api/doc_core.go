//go:build core

package api

import "net/http"

// registerDocRoutes is a no-op in the core build.
func (s *Server) registerDocRoutes(mux *http.ServeMux) {}
