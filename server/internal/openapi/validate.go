package openapi

import (
	"fmt"
	"regexp"
	"strings"

	"curlui/server/internal/models"
)

var leftoverPathVar = regexp.MustCompile(`\{[^}]+\}`)

// Validate reports how a request deviates from the OpenAPI operation it was
// imported from. It never mutates the request.
func Validate(meta models.OpenAPIMeta, req models.RequestDef) []models.ValidationIssue {
	issues := []models.ValidationIssue{}
	add := func(level, field, format string, args ...any) {
		issues = append(issues, models.ValidationIssue{
			Level: level, Field: field, Message: fmt.Sprintf(format, args...),
		})
	}

	// Method
	if meta.Method != "" && !strings.EqualFold(meta.Method, req.Method) {
		add("error", "method", "the specification declares %s but the request uses %s", meta.Method, req.Method)
	}

	// Path parameters must be filled in
	if vars := leftoverPathVar.FindAllString(req.URL, -1); len(vars) > 0 {
		add("error", "url", "unresolved path parameter(s): %s", strings.Join(vars, ", "))
	}
	for _, v := range meta.PathVars {
		if strings.Contains(req.URL, "{{"+v+"}}") {
			add("error", "url", "path parameter %q has no value", v)
		}
	}

	// Required query parameters
	for _, name := range meta.Query {
		kv, ok := findKV(req.Params, name)
		if !ok {
			add("error", "query", "required query parameter %q is missing", name)
		} else if !kv.Enabled || strings.TrimSpace(kv.Value) == "" {
			add("error", "query", "required query parameter %q has no value", name)
		}
	}

	// Required headers
	for _, name := range meta.Header {
		kv, ok := findKV(req.Headers, name)
		if !ok {
			add("error", "header", "required header %q is missing", name)
		} else if !kv.Enabled || strings.TrimSpace(kv.Value) == "" {
			add("error", "header", "required header %q has no value", name)
		}
	}

	// A body is expected but none is set
	if bodyRequired(meta) && strings.TrimSpace(req.Body.Raw) == "" && req.Body.Type == "none" {
		add("warning", "body", "the operation accepts a request body but this request sends none")
	}

	// The path should still line up with the specification
	if meta.Path != "" && !pathMatches(meta.Path, req.URL) {
		add("warning", "url", "the URL does not follow the documented path %s", meta.Path)
	}
	return issues
}

// bodyRequired is true when the importer recorded a body for the operation.
func bodyRequired(meta models.OpenAPIMeta) bool {
	return meta.Method == "POST" || meta.Method == "PUT" || meta.Method == "PATCH"
}

func findKV(list []models.KeyValue, name string) (models.KeyValue, bool) {
	for _, kv := range list {
		if strings.EqualFold(kv.Key, name) {
			return kv, true
		}
	}
	return models.KeyValue{}, false
}

// pathMatches compares a request URL with a template like /pets/{id}, ignoring
// the host, the query string and template segments.
func pathMatches(template, rawURL string) bool {
	u := rawURL
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
		if j := strings.IndexByte(u, '/'); j >= 0 {
			u = u[j:]
		} else {
			u = "/"
		}
	}
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	want := strings.Split(strings.Trim(template, "/"), "/")
	got := strings.Split(strings.Trim(u, "/"), "/")
	if len(want) != len(got) {
		return false
	}
	for i := range want {
		w := want[i]
		if strings.HasPrefix(w, "{") && strings.HasSuffix(w, "}") {
			continue // any value is fine
		}
		if !strings.EqualFold(w, got[i]) {
			return false
		}
	}
	return true
}
