//go:build core

package api

import "net/http"

// Two-factor authentication and password reset belong to the auth subsystem,
// which is not part of the core build.
func (s *Server) registerTwoFARoutes(mux *http.ServeMux) {}
