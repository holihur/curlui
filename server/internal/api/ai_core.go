//go:build core

package api

import "net/http"

// The AI assistant is only part of the full build.
func (s *Server) registerAIRoutes(mux *http.ServeMux) {}
