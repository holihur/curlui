package openapi

import (
	"strings"
	"testing"

	"curlui/server/internal/models"
)

func req(method, url string, params, headers []models.KeyValue) models.RequestDef {
	return models.RequestDef{Method: method, URL: url, Params: params, Headers: headers, Body: models.Body{Type: "none"}}
}

func meta() models.OpenAPIMeta {
	return models.OpenAPIMeta{
		Title:    "List pets",
		Method:   "GET",
		Path:     "/pets/{petId}",
		Query:    []string{"status"},
		Header:   []string{"X-Trace"},
		PathVars: []string{"petId"},
	}
}

func messages(issues []models.ValidationIssue) string {
	var b strings.Builder
	for _, i := range issues {
		b.WriteString(i.Message + "\n")
	}
	return b.String()
}

func TestValidateConformingRequest(t *testing.T) {
	r := req("GET", "https://api.example.com/pets/42?status=available",
		[]models.KeyValue{{Key: "status", Value: "available", Enabled: true}},
		[]models.KeyValue{{Key: "X-Trace", Value: "abc", Enabled: true}})
	if got := Validate(meta(), r); len(got) != 0 {
		t.Fatalf("expected no issues, got: %s", messages(got))
	}
}

func TestValidateReportsMissingRequired(t *testing.T) {
	r := req("GET", "https://api.example.com/pets/42", nil, nil)
	got := messages(Validate(meta(), r))
	for _, want := range []string{"required query parameter", "required header"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

func TestValidateReportsDisabledAndEmpty(t *testing.T) {
	r := req("GET", "https://api.example.com/pets/42?status=x",
		[]models.KeyValue{{Key: "status", Value: "x", Enabled: false}},
		[]models.KeyValue{{Key: "X-Trace", Value: "  ", Enabled: true}})
	got := messages(Validate(meta(), r))
	if !strings.Contains(got, `required query parameter "status" has no value`) {
		t.Errorf("disabled query param not reported:\n%s", got)
	}
	if !strings.Contains(got, `required header "X-Trace" has no value`) {
		t.Errorf("empty header not reported:\n%s", got)
	}
}

func TestValidateReportsUnresolvedPathVar(t *testing.T) {
	r := req("GET", "https://api.example.com/pets/{{petId}}", nil, nil)
	got := messages(Validate(meta(), r))
	if !strings.Contains(got, "path parameter") {
		t.Errorf("unresolved path var not reported:\n%s", got)
	}
}

func TestValidateReportsMethodAndPathMismatch(t *testing.T) {
	r := req("POST", "https://api.example.com/dogs/42", nil, nil)
	got := messages(Validate(meta(), r))
	if !strings.Contains(got, "declares GET") {
		t.Errorf("method mismatch not reported:\n%s", got)
	}
	if !strings.Contains(got, "does not follow the documented path") {
		t.Errorf("path mismatch not reported:\n%s", got)
	}
}

func TestPathMatchesIgnoresHostAndQuery(t *testing.T) {
	if !pathMatches("/pets/{id}", "http://127.0.0.1:8080/pets/7?x=1") {
		t.Error("a template segment should match any value")
	}
	if pathMatches("/pets/{id}", "http://x/pets/7/toys") {
		t.Error("a longer path must not match")
	}
}
