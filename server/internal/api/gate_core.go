//go:build core

package api

import "net/http"

func (s *Server) registerMCPRoutes(mux *http.ServeMux)      {}
func (s *Server) registerOpenAPIRoutes(mux *http.ServeMux)  {}
func (s *Server) registerScheduleRoutes(mux *http.ServeMux) {}
