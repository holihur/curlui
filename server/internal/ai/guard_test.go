package ai

import "testing"

func TestMatch(t *testing.T) {
	cases := []struct {
		rule, tool, subject string
		want                bool
	}{
		{"*", "send_request", "GET https://a/x", true},
		{"send_request", "send_request", "GET https://a/x", true},
		{"send_request", "create_request", "n https://a/x", false},
		{"send_request:*example.com*", "send_request", "GET https://api.example.com/x", true},
		{"send_request:*example.com*", "send_request", "GET https://other.com/x", false},
		{"send_request:*example.com*", "create_request", "n https://api.example.com", false},
		{"*example.com*", "send_request", "GET https://api.example.com/x", true},
		{"", "send_request", "GET https://a", false},
	}
	for _, c := range cases {
		if got := Match(c.rule, c.tool, c.subject); got != c.want {
			t.Errorf("Match(%q,%q,%q) = %v, want %v", c.rule, c.tool, c.subject, got, c.want)
		}
	}
}

func TestDecide(t *testing.T) {
	r := Rules{Allow: []string{"run_saved_request"}, Deny: []string{"create_request"}}

	if allowed, _ := r.Decide("run_saved_request", "List pets"); allowed == nil || !*allowed {
		t.Error("allow rule should approve")
	}
	if allowed, reason := r.Decide("create_request", "x https://a"); allowed == nil || *allowed || reason == "" {
		t.Errorf("deny rule should refuse, got allowed=%v reason=%q", allowed, reason)
	}
	if allowed, _ := r.Decide("send_request", "GET https://a"); allowed != nil {
		t.Error("an unlisted tool should be undecided (ask the human)")
	}
	// Deny wins over allow.
	both := Rules{Allow: []string{"*"}, Deny: []string{"send_request"}}
	if allowed, _ := both.Decide("send_request", "GET https://a"); allowed == nil || *allowed {
		t.Error("deny must take precedence over allow")
	}
}

func TestRuleForScopesToHost(t *testing.T) {
	if got := RuleFor("send_request", "GET https://api.example.com/pets"); got != "send_request:*api.example.com*" {
		t.Errorf("RuleFor = %q", got)
	}
	if got := RuleFor("create_request", "My request"); got != "create_request" {
		t.Errorf("RuleFor = %q", got)
	}
}

func TestNeedsApproval(t *testing.T) {
	for _, tool := range []string{"send_request", "run_saved_request", "create_request"} {
		if !NeedsApproval(tool) {
			t.Errorf("%s should need approval", tool)
		}
	}
	for _, tool := range []string{"list_collections", "get_request", "list_history"} {
		if NeedsApproval(tool) {
			t.Errorf("%s should not need approval", tool)
		}
	}
}

func TestSubjectFor(t *testing.T) {
	got := SubjectFor("send_request", map[string]any{"method": "post", "url": "https://a/x"})
	if got != "POST https://a/x" {
		t.Errorf("SubjectFor = %q", got)
	}
}
