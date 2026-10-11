//go:build !core

package api

import (
	"io"
	"net/http"

	"curlui/server/internal/mcp"
)

// handleMCP serves the MCP protocol over HTTP (JSON-RPC 2.0).
func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	out, respond := mcp.Handle(body, s.version, s)
	if !respond {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(out)
}

// registerMCPRoutes mounts the MCP endpoint.
func (s *Server) registerMCPRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /mcp", s.handleMCP)
}
