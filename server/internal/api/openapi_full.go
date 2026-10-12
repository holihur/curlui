//go:build !core

package api

import (
	"net/http"
	"strings"

	"curlui/server/internal/openapi"
)

func (s *Server) parseOpenAPI(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL     string            `json:"url"`
		Content string            `json:"content"`
		Headers map[string]string `json:"headers"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	var raw []byte
	switch {
	case strings.TrimSpace(payload.URL) != "":
		data, err := openapi.Fetch(strings.TrimSpace(payload.URL), payload.Headers)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		raw = data
	case strings.TrimSpace(payload.Content) != "":
		raw = []byte(payload.Content)
	default:
		writeErr(w, http.StatusBadRequest, "provide either a spec URL or content")
		return
	}

	result, err := openapi.Parse(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// registerOpenAPIRoutes mounts the OpenAPI import endpoint.
func (s *Server) registerOpenAPIRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/openapi/parse", s.parseOpenAPI)
	mux.HandleFunc("POST /api/openapi/validate", s.validateOpenAPIRequest)
}
