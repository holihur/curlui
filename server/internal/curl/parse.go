package curl

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"curlui/server/internal/models"
)

// Parse converts a curl command string into a RequestDef.
func Parse(command string) (*models.RequestDef, error) {
	tokens, err := tokenize(command)
	if err != nil {
		return nil, err
	}
	if len(tokens) == 0 {
		return nil, errors.New("empty curl command")
	}
	// Drop a leading "curl" / "curl.exe".
	if base := strings.ToLower(tokens[0]); base == "curl" || base == "curl.exe" {
		tokens = tokens[1:]
	}

	req := &models.RequestDef{
		Method:  "",
		Headers: []models.KeyValue{},
		Params:  []models.KeyValue{},
		Body:    models.Body{Type: "none"},
		Auth:    models.Auth{Type: "none"},
		Options: models.Options{Timeout: 30000, FollowRedirects: true, VerifyTLS: true, MaxRedirects: 10},
	}

	var (
		rawURL      string
		dataParts   []string
		urlencoded  [][2]string
		formFields  []models.KeyValue
		cookies     []string
		contentType string
	)

	next := func(i *int) string {
		*i++
		if *i < len(tokens) {
			return tokens[*i]
		}
		return ""
	}

	for i := 0; i < len(tokens); i++ {
		t := tokens[i]
		switch t {
		case "-X", "--request":
			req.Method = strings.ToUpper(next(&i))
		case "-H", "--header":
			hv := next(&i)
			if k, v, ok := splitHeader(hv); ok {
				if strings.EqualFold(k, "content-type") {
					contentType = v
				}
				req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: k, Value: v, Enabled: true})
			}
		case "-d", "--data", "--data-raw", "--data-ascii":
			dataParts = append(dataParts, next(&i))
		case "--data-binary":
			dataParts = append(dataParts, next(&i))
		case "--data-urlencode":
			v := next(&i)
			if k, val, ok := strings.Cut(v, "="); ok {
				urlencoded = append(urlencoded, [2]string{k, val})
			} else {
				urlencoded = append(urlencoded, [2]string{v, ""})
			}
		case "-F", "--form":
			v := next(&i)
			k, val, _ := strings.Cut(v, "=")
			f := models.KeyValue{ID: models.NewID(), Key: k, Enabled: true}
			switch {
			case strings.HasPrefix(val, "@"):
				f.Type = "file"
				f.FilePath = val[1:]
			case strings.HasPrefix(val, "<"):
				f.Type = "file"
				f.FilePath = val[1:]
			default:
				f.Type = "text"
				f.Value = val
			}
			formFields = append(formFields, f)
		case "-u", "--user":
			cred := next(&i)
			user, pass, _ := strings.Cut(cred, ":")
			req.Auth = models.Auth{Type: "basic", Username: user, Password: pass}
		case "-b", "--cookie":
			cookies = append(cookies, next(&i))
		case "-A", "--user-agent":
			req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: "User-Agent", Value: next(&i), Enabled: true})
		case "-e", "--referer":
			req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: "Referer", Value: next(&i), Enabled: true})
		case "-L", "--location":
			req.Options.FollowRedirects = true
		case "-k", "--insecure":
			req.Options.VerifyTLS = false
		case "--compressed":
			// nothing to configure; Go handles gzip transparently
		case "-I", "--head":
			req.Method = "HEAD"
		case "-G", "--get":
			req.Method = "GET"
		case "-o", "--output", "-w", "--write-out", "-s", "--silent", "-v", "--verbose", "-i", "--include":
			// flags with no argument, or whose argument we ignore
			if t == "-o" || t == "--output" || t == "-w" || t == "--write-out" {
				next(&i)
			}
		case "--url":
			rawURL = next(&i)
		case "--proxy", "-x":
			req.Options.Proxy = next(&i)
		case "--max-time":
			var secs int
			_, _ = fmt.Sscanf(next(&i), "%d", &secs)
			if secs > 0 {
				req.Options.Timeout = secs * 1000
			}
		default:
			if strings.HasPrefix(t, "-") {
				// Unknown flag: if the next token does not look like a
				// flag or URL, consume it as its argument.
				if i+1 < len(tokens) && !strings.HasPrefix(tokens[i+1], "-") && !looksLikeURL(tokens[i+1]) {
					i++
				}
				continue
			}
			if rawURL == "" {
				rawURL = t
			}
		}
	}

	if rawURL == "" {
		return nil, errors.New("no URL found in curl command")
	}
	// Merge any query string from the URL into params.
	if u, err := url.Parse(rawURL); err == nil && u.RawQuery != "" {
		for k, vals := range u.Query() {
			for _, v := range vals {
				req.Params = append(req.Params, models.KeyValue{ID: models.NewID(), Key: k, Value: v, Enabled: true})
			}
		}
		u.RawQuery = ""
		rawURL = u.String()
	}
	req.URL = rawURL

	if len(formFields) > 0 {
		req.Body.Type = "form-data"
		req.Body.Form = formFields
	} else if len(urlencoded) > 0 {
		req.Body.Type = "form-urlencoded"
		for _, kv := range urlencoded {
			req.Body.Form = append(req.Body.Form, models.KeyValue{ID: models.NewID(), Key: kv[0], Value: kv[1], Enabled: true})
		}
	} else if len(dataParts) > 0 {
		raw := strings.Join(dataParts, "&")
		req.Body.Raw = raw
		req.Body.Type = inferBodyType(contentType, raw)
	}

	for _, c := range cookies {
		req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: "Cookie", Value: c, Enabled: true})
	}

	if req.Method == "" {
		if req.Body.Type != "none" && req.Body.Type != "" {
			req.Method = "POST"
		} else {
			req.Method = "GET"
		}
	}
	return req, nil
}

func inferBodyType(contentType, raw string) string {
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "json"):
		return "json"
	case strings.Contains(ct, "xml"):
		return "xml"
	case strings.Contains(ct, "x-www-form-urlencoded"):
		return "form-urlencoded"
	case strings.Contains(ct, "html"):
		return "html"
	case strings.Contains(ct, "text/plain"):
		return "text"
	}
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		return "json"
	}
	if kvs := strings.Split(raw, "&"); len(kvs) > 1 {
		allPairs := true
		for _, kv := range kvs {
			if !strings.Contains(kv, "=") {
				allPairs = false
				break
			}
		}
		if allPairs {
			return "form-urlencoded"
		}
	}
	return "text"
}

func splitHeader(h string) (string, string, bool) {
	k, v, ok := strings.Cut(h, ":")
	if !ok {
		return "", "", false
	}
	return strings.TrimSpace(k), strings.TrimSpace(v), true
}

func looksLikeURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") || strings.Contains(s, ".")
}

// tokenize splits a shell-like command respecting quotes and line
// continuations.
func tokenize(s string) ([]string, error) {
	var tokens []string
	var cur strings.Builder
	var inSingle, inDouble, has bool
	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		switch {
		case inSingle:
			if c == '\'' {
				inSingle = false
			} else {
				cur.WriteRune(c)
			}
		case inDouble:
			if c == '\\' && i+1 < len(runes) {
				n := runes[i+1]
				if n == '"' || n == '\\' || n == '$' || n == '`' {
					cur.WriteRune(n)
					i++
				} else {
					cur.WriteRune(c)
				}
			} else if c == '"' {
				inDouble = false
			} else {
				cur.WriteRune(c)
			}
		default:
			switch c {
			case '\\':
				if i+1 < len(runes) {
					n := runes[i+1]
					switch n {
					case '\n':
						i++
					case '\r':
						if i+2 < len(runes) && runes[i+2] == '\n' {
							i += 2
						} else {
							i++
						}
					default:
						cur.WriteRune(n)
						i++
					}
				}
				has = true
			case '\'':
				inSingle = true
				has = true
			case '"':
				inDouble = true
				has = true
			case ' ', '\t', '\n', '\r':
				if has || cur.Len() > 0 {
					tokens = append(tokens, cur.String())
					cur.Reset()
					has = false
				}
			default:
				cur.WriteRune(c)
			}
		}
	}
	if inSingle || inDouble {
		return nil, errors.New("unterminated quote in curl command")
	}
	if has || cur.Len() > 0 {
		tokens = append(tokens, cur.String())
	}
	return tokens, nil
}

// Generate builds a cURL command string from a request definition.
func Generate(req models.RequestDef) string {
	var b strings.Builder
	b.WriteString("curl")
	if req.Method != "" && !strings.EqualFold(req.Method, "GET") {
		b.WriteString(" -X " + strings.ToUpper(req.Method))
	}

	// URL including enabled params.
	u := req.URL
	if len(req.Params) > 0 {
		if base, err := url.Parse(u); err == nil {
			q := base.Query()
			for _, p := range req.Params {
				if p.Enabled && p.Key != "" {
					q.Add(p.Key, p.Value)
				}
			}
			base.RawQuery = q.Encode()
			u = base.String()
		}
	}
	b.WriteString(" " + shellQuote(u))

	// Auth header.
	headers := append([]models.KeyValue{}, req.Headers...)
	switch req.Auth.Type {
	case "basic":
		b.WriteString(" -u " + shellQuote(req.Auth.Username+":"+req.Auth.Password))
	case "bearer":
		headers = append(headers, models.KeyValue{Enabled: true, Key: "Authorization", Value: "Bearer " + req.Auth.Token})
	case "apikey":
		if req.Auth.AddTo != "query" {
			headers = append(headers, models.KeyValue{Enabled: true, Key: req.Auth.Key, Value: req.Auth.Value})
		}
	}

	// Stable header ordering for readable output.
	sort.SliceStable(headers, func(i, j int) bool { return headers[i].Key < headers[j].Key })
	for _, h := range headers {
		if h.Enabled && h.Key != "" {
			b.WriteString(" \\\n  -H " + shellQuote(h.Key+": "+h.Value))
		}
	}

	switch req.Body.Type {
	case "form-data":
		for _, f := range req.Body.Form {
			if !f.Enabled || f.Key == "" {
				continue
			}
			if f.Type == "file" || f.FilePath != "" {
				b.WriteString(" \\\n  -F " + shellQuote(f.Key+"=@"+f.FilePath))
			} else {
				b.WriteString(" \\\n  -F " + shellQuote(f.Key+"="+f.Value))
			}
		}
	case "form-urlencoded":
		for _, f := range req.Body.Form {
			if f.Enabled && f.Key != "" {
				b.WriteString(" \\\n  --data-urlencode " + shellQuote(f.Key+"="+f.Value))
			}
		}
	case "binary":
		b.WriteString(" \\\n  --data-binary " + shellQuote("@"+req.Body.FilePath))
	case "none", "":
	default:
		if req.Body.Raw != "" {
			b.WriteString(" \\\n  --data-raw " + shellQuote(req.Body.Raw))
		}
	}

	if !req.Options.FollowRedirects {
		// cURL follows redirects only with -L.
	} else {
		b.WriteString(" \\\n  -L")
	}
	if !req.Options.VerifyTLS {
		b.WriteString(" \\\n  -k")
	}
	if req.Options.Proxy != "" {
		b.WriteString(" \\\n  -x " + shellQuote(req.Options.Proxy))
	}
	return b.String()
}

var shellSafe = regexp.MustCompile(`^[A-Za-z0-9_@%+=:,./-]+$`)

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	if shellSafe.MatchString(s) {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
