package ai

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// Guard decides whether a mutating tool call may run. Implementations may block
// while a human approves it.
type Guard interface {
	Approve(ctx context.Context, tool, subject string, args map[string]any) error
}

// allowAll is used when no guard is configured.
type allowAll struct{}

func (allowAll) Approve(context.Context, string, string, map[string]any) error { return nil }

// Rules is a user's allow/deny configuration.
type Rules struct {
	Allow []string
	Deny  []string
}

// SubjectFor returns the string a rule is matched against for a tool call.
func SubjectFor(tool string, args map[string]any) string {
	str := func(k string) string {
		if v, ok := args[k].(string); ok {
			return v
		}
		return ""
	}
	switch tool {
	case "send_request":
		return strings.ToUpper(str("method")) + " " + str("url")
	case "create_request":
		return str("name") + " " + str("url")
	case "run_saved_request":
		return str("name") + str("id")
	default:
		for _, k := range []string{"url", "name", "id", "path"} {
			if v := str(k); v != "" {
				return v
			}
		}
		return ""
	}
}

// Match reports whether a rule matches a tool call. Accepted forms:
//
//   - everything
//     send_request           every call of that tool
//     send_request:glob      that tool, when "<tool> <subject>" matches glob
//     glob                   matched against "<tool> <subject>"
//
// glob supports "*" (any run of characters).
func Match(rule, tool, subject string) bool {
	rule = strings.TrimSpace(strings.ToLower(rule))
	if rule == "" {
		return false
	}
	if rule == "*" {
		return true
	}
	hay := strings.ToLower(tool + " " + subject)
	if !strings.ContainsAny(rule, "*:") {
		return rule == strings.ToLower(tool)
	}
	if i := strings.Index(rule, ":"); i >= 0 {
		if rule[:i] != strings.ToLower(tool) {
			return false
		}
		rule = rule[i+1:]
	}
	return globMatch(rule, hay)
}

// globMatch matches a "*"-glob against s.
func globMatch(pattern, s string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == s
	}
	if !strings.HasPrefix(s, parts[0]) {
		return false
	}
	s = s[len(parts[0]):]
	for i := 1; i < len(parts)-1; i++ {
		idx := strings.Index(s, parts[i])
		if idx < 0 {
			return false
		}
		s = s[idx+len(parts[i]):]
	}
	return strings.HasSuffix(s, parts[len(parts)-1])
}

// Decide applies the deny/allow lists. It returns (nil, nil) when the lists do
// not settle the question and a human should be asked.
func (r Rules) Decide(tool, subject string) (allowed *bool, reason string) {
	for _, rule := range r.Deny {
		if Match(rule, tool, subject) {
			no := false
			return &no, fmt.Sprintf("blocked by rule %q", rule)
		}
	}
	for _, rule := range r.Allow {
		if Match(rule, tool, subject) {
			yes := true
			return &yes, ""
		}
	}
	return nil, ""
}

// RuleFor builds the rule to remember when a user chooses "always allow".
// For URL-based tools it is scoped to the host, otherwise to the whole tool.
func RuleFor(tool, subject string) string {
	if i := strings.Index(subject, "://"); i >= 0 {
		// Include the scheme: walk back to the start of the URL token.
		start := strings.LastIndexByte(subject[:i], ' ') + 1
		rest := subject[start:]
		if sp := strings.IndexByte(rest, ' '); sp >= 0 {
			rest = rest[:sp]
		}
		if u, err := url.Parse(rest); err == nil && u.Host != "" {
			return tool + ":*" + u.Host + "*"
		}
	}
	return tool
}

// NeedsApproval reports whether a tool mutates state and therefore needs a
// human decision (subject to the lists).
func NeedsApproval(tool string) bool {
	switch tool {
	case "send_request", "run_saved_request", "create_request":
		return true
	default:
		return false
	}
}
