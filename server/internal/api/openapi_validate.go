//go:build !core

package api

import (
	"net/http"

	"curlui/server/internal/models"
	"curlui/server/internal/openapi"
)

// validateOpenAPIRequest checks a request against the OpenAPI operation it was
// imported from and reports every deviation.
func (s *Server) validateOpenAPIRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Request models.RequestDef `json:"request"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if in.Request.OpenAPI == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"issues": []models.ValidationIssue{},
			"source": "",
			"note":   "this request was not imported from an OpenAPI document",
		})
		return
	}
	issues := openapi.Validate(*in.Request.OpenAPI, in.Request)
	writeJSON(w, http.StatusOK, map[string]any{
		"issues": issues,
		"source": in.Request.OpenAPI.Title,
		"path":   in.Request.OpenAPI.Path,
	})
}
