//go:build core

package api

import "net/http"

// Personal access tokens belong to the team/auth subsystem, which is not part
// of the core build.
func (s *Server) registerTokenRoutes(mux *http.ServeMux) {}
