package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"

	"curlui/server/internal/models"
	"curlui/server/internal/variables"
)

// fuzzCategories holds the built-in payloads, grouped by attack class. The
// category is reported with each finding so the UI can explain the intent.
var fuzzCategories = map[string][]string{
	"sqli": {
		"'", "\"", "')", "';", "' OR '1'='1", "' OR 1=1--", "1' AND SLEEP(0)--",
		"admin'--", "\" OR \"\"=\"", "' UNION SELECT NULL--",
	},
	"xss": {
		"<script>alert(1)</script>", "\"><script>alert(1)</script>",
		"<img src=x onerror=alert(1)>", "javascript:alert(1)", "'\"><svg/onload=alert(1)>",
	},
	"ssti": {
		"{{7*7}}", "${7*7}", "#{7*7}", "{{7*'7'}}", "<%= 7*7 %>", "${{7*7}}",
	},
	"traversal": {
		"../../../../etc/passwd", "..%2f..%2f..%2fetc%2fpasswd", "/etc/passwd",
		"....//....//etc/passwd", "..\\..\\windows\\win.ini",
	},
	"cmdi": {
		";id", "|id", "`id`", "$(id)", "&whoami", "\n/bin/id",
	},
	"format": {
		"%s%s%s%s", "%x%x%x%x", "%n", "%d%d%d",
	},
	"crlf": {
		"%0d%0aX-Injected: 1", "\r\nX-Injected: 1", "%0aSet-Cookie: x=1",
	},
	"nosql": {
		"{\"$ne\":null}", "{\"$gt\":\"\"}", "true, $where: '1==1'", "[$ne]=1",
	},
	"type": {
		"0", "-1", "9999999999999999999999", "NaN", "Infinity", "[]", "{}", "null",
		"true", "false", "\x00", "%00",
	},
	"overflow": {
		strings.Repeat("A", 4096), strings.Repeat("A", 65535),
	},
}

// errorSignatures flag responses that leak internals or throw errors.
var errorSignatures = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(SQL syntax|mysql_|mysqli_|ORA-\d{5}|SQLSTATE|PostgreSQL.{0,20}ERROR|sqlite3?\.|unclosed quotation mark|quoted string not properly terminated)`),
	regexp.MustCompile(`(?i)(traceback \(most recent call last\)|exception in thread|panic:|goroutine \d+ \[running\]|\.java:\d+\)|System\.Exception|at [\w.$]+\([\w.]+\.java)`),
	regexp.MustCompile(`(?i)(root:x:0:0|/bin/(ba)?sh:|Warning: include\(|Warning: mysql|Undefined (index|variable)|Fatal error:|Notice:)`),
	regexp.MustCompile(`(?i)(TemplateSyntaxError|jinja2\.|Twig\\|Freemarker|Velocity|Smarty)`),
	regexp.MustCompile(`(?i)(stack trace|stacktrace|debug mode|werkzeug|django\.core\.exceptions)`),
}

type fuzzPayload struct {
	category string
	value    string
}

type fuzzMutation struct {
	kind    string // param | header | cookie | body | path
	target  string // the field name / path segment
	payload fuzzPayload
	req     models.RequestDef
}

type fuzzFinding struct {
	Kind     string   `json:"kind"`
	Target   string   `json:"target"`
	Payload  string   `json:"payload"`
	Category string   `json:"category"`
	Status   int      `json:"status"`
	Size     int      `json:"size"`
	Duration int64    `json:"duration"`
	Error    string   `json:"error,omitempty"`
	Severity string   `json:"severity,omitempty"` // high | medium | low
	Issues   []string `json:"issues,omitempty"`
	Evidence []string `json:"evidence,omitempty"`
	Count    int      `json:"count,omitempty"` // collapsed duplicates
}

func (s *Server) runFuzz(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Request     models.RequestDef `json:"request"`
		EnvID       string            `json:"envId"`
		Variables   map[string]string `json:"variables"`
		Concurrency int               `json:"concurrency"`
		Payloads    []string          `json:"payloads"`
		Categories  []string          `json:"categories"`
		Kinds       []string          `json:"kinds"`
		MaxCases    int               `json:"maxCases"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	payloads := buildPayloads(payload.Payloads, payload.Categories)
	if len(payloads) == 0 {
		writeErr(w, http.StatusBadRequest, "no payloads selected")
		return
	}
	concurrency := clamp(payload.Concurrency, 1, 32)
	if payload.Concurrency < 1 {
		concurrency = 8
	}
	maxCases := clamp(payload.MaxCases, 1, 1000)
	if payload.MaxCases < 1 {
		maxCases = 400
	}

	envSet := variables.Set{}
	if payload.EnvID != "" {
		for _, env := range s.db(r).Environments() {
			if env.ID == payload.EnvID {
				envSet = variables.FromEnvironment(&env)
				break
			}
		}
	}
	if len(payload.Variables) > 0 {
		envSet = envSet.Merge(variables.Set(payload.Variables))
	}

	baseline := s.executor.Execute(r.Context(), payload.Request, envSet, false)
	mutations := buildMutations(payload.Request, payloads, payload.Kinds, maxCases)

	findings := make([]fuzzFinding, len(mutations))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i, mu := range mutations {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, mu fuzzMutation) {
			defer wg.Done()
			defer func() { <-sem }()
			resp := s.executor.Execute(r.Context(), mu.req, envSet, false)
			findings[i] = analyzeFinding(mu, resp, baseline)
		}(i, mu)
	}
	wg.Wait()

	collapsed, deduped, clean := collapseFindings(findings)
	summary := summarize(collapsed, len(findings), deduped, clean)
	writeJSON(w, http.StatusOK, map[string]any{
		"baseline": map[string]any{
			"status": baseline.Status, "size": baseline.Size,
			"duration": baseline.Duration, "error": baseline.Error,
		},
		"results": collapsed,
		"summary": summary,
	})
}

// buildPayloads merges the built-in categories (or all) with custom payloads.
func buildPayloads(custom, categories []string) []fuzzPayload {
	want := map[string]bool{}
	for _, c := range categories {
		want[c] = true
	}
	var out []fuzzPayload
	seen := map[string]bool{}
	for cat, list := range fuzzCategories {
		if len(want) > 0 && !want[cat] {
			continue
		}
		for _, v := range list {
			if seen[v] {
				continue
			}
			seen[v] = true
			out = append(out, fuzzPayload{category: cat, value: v})
		}
	}
	for _, v := range custom {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, fuzzPayload{category: "custom", value: v})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].category < out[j].category })
	return out
}

// buildMutations generates every (field × payload) case across the requested
// injection points.
func buildMutations(req models.RequestDef, payloads []fuzzPayload, kinds []string, maxCases int) []fuzzMutation {
	enabled := map[string]bool{}
	for _, k := range kinds {
		enabled[k] = true
	}
	all := len(kinds) == 0
	use := func(k string) bool { return all || enabled[k] }

	clone := func() models.RequestDef {
		b, _ := json.Marshal(req)
		var out models.RequestDef
		_ = json.Unmarshal(b, &out)
		return out
	}

	var out []fuzzMutation
	add := func(kind, target string, p fuzzPayload, m models.RequestDef) {
		if len(out) >= maxCases {
			return
		}
		out = append(out, fuzzMutation{kind: kind, target: target, payload: p, req: m})
	}

	for _, p := range payloads {
		if use("param") {
			for i := range req.Params {
				if !req.Params[i].Enabled || req.Params[i].Key == "" {
					continue
				}
				m := clone()
				m.Params[i].Value = p.value
				add("param", req.Params[i].Key, p, m)
			}
			if len(req.Params) == 0 {
				m := clone()
				m.Params = append(m.Params, models.KeyValue{Key: "fuzz", Value: p.value, Enabled: true})
				add("param", "fuzz (added)", p, m)
			}
		}
		if use("header") {
			for i := range req.Headers {
				h := req.Headers[i]
				if !h.Enabled || h.Key == "" {
					continue
				}
				switch strings.ToLower(h.Key) {
				case "content-length", "host", "cookie":
					continue
				}
				m := clone()
				m.Headers[i].Value = p.value
				add("header", h.Key, p, m)
			}
		}
		if use("cookie") {
			for i := range req.Headers {
				if !strings.EqualFold(req.Headers[i].Key, "Cookie") || !req.Headers[i].Enabled {
					continue
				}
				for _, c := range splitCookies(req.Headers[i].Value) {
					m := clone()
					m.Headers[i].Value = strings.Replace(req.Headers[i].Value, c, c[:strings.Index(c, "=")+1]+p.value, 1)
					add("cookie", c[:strings.Index(c, "=")], p, m)
				}
			}
		}
		if use("body") {
			if req.Body.Type == "json" && req.Body.Raw != "" {
				if mutated := mutateJSONStrings(req.Body.Raw, p.value); mutated != "" {
					m := clone()
					m.Body.Raw = mutated
					add("body", "json value", p, m)
				}
			} else if req.Body.Raw != "" {
				m := clone()
				m.Body.Raw = p.value
				add("body", req.Body.Type, p, m)
			}
		}
		if use("path") {
			segs, base := pathSegments(req.URL)
			for i := range segs {
				m := clone()
				m.URL = base + joinPath(segs, i, url.PathEscape(p.value))
				add("path", "segment "+(segs[i].orig), p, m)
			}
		}
	}
	return out
}

type pathSeg struct {
	raw  string // original text
	orig string
}

func pathSegments(rawURL string) ([]pathSeg, string) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, rawURL
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	segs := make([]pathSeg, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			continue
		}
		segs = append(segs, pathSeg{raw: p, orig: p})
	}
	base := u.Scheme + "://" + u.Host + "/"
	return segs, base
}

func joinPath(segs []pathSeg, replace int, with string) string {
	parts := make([]string, len(segs))
	for i, s := range segs {
		if i == replace {
			parts[i] = with
		} else {
			parts[i] = url.PathEscape(s.orig)
		}
	}
	return strings.Join(parts, "/")
}

func splitCookies(v string) []string {
	var out []string
	for _, part := range strings.Split(v, ";") {
		part = strings.TrimSpace(part)
		if strings.Contains(part, "=") {
			out = append(out, part)
		}
	}
	return out
}

// analyzeFinding compares a mutated response against the baseline and assigns
// a severity plus human-readable evidence.
func analyzeFinding(mu fuzzMutation, resp, baseline models.Response) fuzzFinding {
	f := fuzzFinding{
		Kind: mu.kind, Target: mu.target, Payload: mu.payload.value,
		Category: mu.payload.category, Status: resp.Status, Size: resp.Size,
		Duration: resp.Duration, Error: resp.Error,
	}
	high := func(s string) { f.Severity = "high"; f.Issues = append(f.Issues, s) }
	med := func(s string) {
		if f.Severity != "high" {
			f.Severity = "medium"
		}
		f.Issues = append(f.Issues, s)
	}

	if resp.Error != "" {
		med("request error")
		return f
	}
	if resp.Status >= 500 {
		high(fmt.Sprintf("server error %d", resp.Status))
	}

	// Reflected / evaluated payloads.
	body := resp.Body
	payload := mu.payload.value
	if len(payload) >= 4 && !isBenign(payload) && strings.Contains(body, payload) {
		high("payload reflected unescaped")
		f.Evidence = append(f.Evidence, snippetAround(body, payload))
	}
	if strings.Contains(payload, "7*7") && strings.Contains(body, "49") && !strings.Contains(baseline.Body, "49") {
		high("template expression evaluated (SSTI)")
		f.Evidence = append(f.Evidence, snippetAround(body, "49"))
	}

	// Error / internal leakage.
	for _, re := range errorSignatures {
		if loc := re.FindStringIndex(body); loc != nil {
			start := loc[0] - 30
			if start < 0 {
				start = 0
			}
			end := loc[1] + 60
			if end > len(body) {
				end = len(body)
			}
			high("error/stack trace leaked")
			f.Evidence = append(f.Evidence, strings.TrimSpace(body[start:end]))
			break
		}
	}

	// Behavioural changes vs the baseline.
	if baseline.Error == "" && resp.Status != baseline.Status {
		med(fmt.Sprintf("status %d → %d", baseline.Status, resp.Status))
	}
	if baseline.Size > 0 && resp.Size > 0 {
		if resp.Size > baseline.Size*3 && resp.Size-baseline.Size > 512 {
			med("response much larger")
		} else if resp.Size*3 < baseline.Size {
			med("response much smaller")
		}
	}
	if baseline.Duration > 0 && resp.Duration > baseline.Duration*3 && resp.Duration-baseline.Duration > 700 {
		med("timing anomaly (possible blind injection)")
	}
	return f
}

func isBenign(p string) bool {
	switch p {
	case "0", "-1", "true", "false", "null", "[]", "{}", "NaN", "Infinity":
		return true
	}
	return false
}

func snippetAround(body, needle string) string {
	i := strings.Index(body, needle)
	if i < 0 {
		return ""
	}
	start := i - 40
	if start < 0 {
		start = 0
	}
	end := i + len(needle) + 40
	if end > len(body) {
		end = len(body)
	}
	return strings.TrimSpace(body[start:end])
}

// collapseFindings removes duplicate rows (same field/payload/result/issues)
// while keeping a representative and a count, then sorts by severity. It also
// reports how many cases were duplicates and how many were clean.
func collapseFindings(in []fuzzFinding) ([]fuzzFinding, int, int) {
	seen := map[string]int{}
	out := make([]fuzzFinding, 0, len(in))
	dup, clean := 0, 0
	for _, f := range in {
		if len(f.Issues) == 0 {
			clean++
			continue
		}
		key := fmt.Sprintf("%s|%s|%s|%d|%d|%s", f.Kind, f.Target, f.Payload, f.Status, f.Size, strings.Join(f.Issues, ","))
		if idx, ok := seen[key]; ok {
			out[idx].Count++
			dup++
			continue
		}
		f.Count = 1
		seen[key] = len(out)
		out = append(out, f)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return severityRank(out[i].Severity) > severityRank(out[j].Severity)
	})
	return out, dup, clean
}

func severityRank(s string) int {
	switch s {
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	}
	return 0
}

func summarize(findings []fuzzFinding, total, deduped, clean int) map[string]any {
	high, medium, low := 0, 0, 0
	for _, f := range findings {
		switch f.Severity {
		case "high":
			high++
		case "medium":
			medium++
		case "low":
			low++
		}
	}
	return map[string]any{
		"total": total, "issues": len(findings),
		"high": high, "medium": medium, "low": low,
		"deduped": deduped, "clean": clean,
	}
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func mutateJSONStrings(raw, payload string) string {
	var v any
	if json.Unmarshal([]byte(raw), &v) != nil {
		return ""
	}
	mutated := replaceStrings(v, payload)
	b, err := json.Marshal(mutated)
	if err != nil {
		return ""
	}
	return string(b)
}

func replaceStrings(v any, payload string) any {
	switch t := v.(type) {
	case string:
		return payload
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, vv := range t {
			out[k] = replaceStrings(vv, payload)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, vv := range t {
			out[i] = replaceStrings(vv, payload)
		}
		return out
	default:
		return v
	}
}
