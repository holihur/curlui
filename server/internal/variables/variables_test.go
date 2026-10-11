package variables

import (
	"strings"
	"testing"

	"curlui/server/internal/models"
)

func TestResolve(t *testing.T) {
	s := Set{"base": "http://x", "id": "7"}
	if got := s.Resolve("{{base}}/pets/{{id}}"); got != "http://x/pets/7" {
		t.Errorf("Resolve = %q", got)
	}
	// Unknown placeholders are left untouched.
	if got := s.Resolve("{{nope}}"); got != "{{nope}}" {
		t.Errorf("unknown placeholder = %q", got)
	}
	if got := s.Resolve("plain"); got != "plain" {
		t.Errorf("plain = %q", got)
	}
}

func TestMergeOverrides(t *testing.T) {
	base := Set{"id": "1", "keep": "x"}
	got := base.Merge(Set{"id": "2"})
	if got.Resolve("{{id}}-{{keep}}") != "2-x" {
		t.Errorf("Merge = %v", got)
	}
	if base["id"] != "1" {
		t.Error("Merge mutated the receiver")
	}
}

func TestDynamicVariables(t *testing.T) {
	s := Set{}
	if v := s.Resolve("{{$uuid}}"); len(v) != 36 || strings.Count(v, "-") != 4 {
		t.Errorf("$uuid = %q", v)
	}
	if v := s.Resolve("{{$timestamp}}"); len(v) < 9 {
		t.Errorf("$timestamp = %q", v)
	}
}

func TestResolveRequest(t *testing.T) {
	s := Set{"h": "v", "u": "http://svc"}
	in := models.RequestDef{
		URL:     "{{u}}/a",
		Headers: []models.KeyValue{{Key: "X-{{h}}", Value: "{{h}}"}},
		Body:    models.Body{Raw: "id={{h}}"},
	}
	out := s.ResolveRequest(in)
	if out.URL != "http://svc/a" {
		t.Errorf("URL = %q", out.URL)
	}
	if out.Headers[0].Key != "X-v" || out.Headers[0].Value != "v" {
		t.Errorf("headers = %+v", out.Headers[0])
	}
	if out.Body.Raw != "id=v" {
		t.Errorf("body = %q", out.Body.Raw)
	}
	// The original must not be mutated.
	if in.URL != "{{u}}/a" {
		t.Error("ResolveRequest mutated its input")
	}
}
