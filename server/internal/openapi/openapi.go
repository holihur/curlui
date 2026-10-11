//go:build !core

// Package openapi parses Swagger 2.0 and OpenAPI 3.x documents into curlui
// collection trees.
package openapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"curlui/server/internal/models"

	"gopkg.in/yaml.v3"
)

const (
	maxSpecBytes = 20 << 20 // 20 MiB
	maxOps       = 1000
)

// Result is the parsed representation of a spec.
type Result struct {
	Title       string         `json:"title"`
	Version     string         `json:"version"`
	BaseURL     string         `json:"baseUrl"`
	SpecType    string         `json:"specType"` // swagger2 | openapi3
	Endpoints   int            `json:"endpoints"`
	Collections []*models.Node `json:"collections"`
}

// Fetch downloads a spec from a URL.
func Fetch(url string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json, application/yaml, text/yaml, */*")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("fetch failed: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSpecBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxSpecBytes {
		return nil, fmt.Errorf("spec is too large (limit %d bytes)", maxSpecBytes)
	}
	return data, nil
}

// Parse converts raw JSON/YAML spec bytes into a Result.
func Parse(raw []byte) (*Result, error) {
	root, err := decode(raw)
	if err != nil {
		return nil, err
	}
	p := &parser{root: root}
	switch {
	case strings.HasPrefix(strings.TrimSpace(stringOf(root["openapi"])), "3."):
		p.v3 = true
	case stringOf(root["swagger"]) != "":
		p.v3 = false
	default:
		return nil, fmt.Errorf("not a Swagger 2.0 or OpenAPI 3.x document")
	}

	info := mapOf(root["info"])
	title := stringOf(info["title"])
	if title == "" {
		title = "Imported API"
	}
	version := stringOf(info["version"])
	base := p.baseURL()

	res := &Result{
		Title:    title,
		Version:  version,
		BaseURL:  base,
		SpecType: map[bool]string{true: "openapi3", false: "swagger2"}[p.v3],
	}

	rootFolder := &models.Node{
		ID:   models.NewID(),
		Type: "folder",
		Name: folderName(title, version),
	}
	tagFolders := map[string]*models.Node{}
	var tagOrder []string

	paths := mapOf(root["paths"])
	for path, itemRaw := range paths {
		item := mapOf(itemRaw)
		if item == nil {
			continue
		}
		pathParams := parameters(item["parameters"])
		for _, method := range httpMethods {
			op := mapOf(item[method])
			if op == nil {
				continue
			}
			if res.Endpoints >= maxOps {
				break
			}
			req := p.buildRequest(method, path, op, pathParams, base)
			if req == nil {
				continue
			}
			node := &models.Node{ID: models.NewID(), Type: "request", Name: req.Name, Request: req}

			tag := firstTag(op)
			if tag == "" {
				rootFolder.Children = append(rootFolder.Children, node)
			} else {
				folder := tagFolders[tag]
				if folder == nil {
					folder = &models.Node{ID: models.NewID(), Type: "folder", Name: tag}
					tagFolders[tag] = folder
					tagOrder = append(tagOrder, tag)
				}
				folder.Children = append(folder.Children, node)
			}
			res.Endpoints++
		}
	}

	sort.Strings(tagOrder)
	for _, tag := range tagOrder {
		rootFolder.Children = append(rootFolder.Children, tagFolders[tag])
	}
	res.Collections = []*models.Node{rootFolder}
	return res, nil
}

var httpMethods = []string{"get", "post", "put", "patch", "delete", "head", "options", "trace"}

type parser struct {
	root map[string]any
	v3   bool
}

func (p *parser) lookup(ref string) map[string]any {
	if !strings.HasPrefix(ref, "#/") {
		return nil
	}
	parts := strings.Split(strings.TrimPrefix(ref, "#/"), "/")
	var cur any = p.root
	for _, part := range parts {
		part = strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		mm := mapOf(cur)
		if mm == nil {
			return nil
		}
		cur = mm[part]
	}
	return mapOf(cur)
}

func (p *parser) baseURL() string {
	if p.v3 {
		servers := sliceOf(p.root["servers"])
		if len(servers) == 0 {
			return "{{baseUrl}}"
		}
		srv := mapOf(servers[0])
		u := stringOf(srv["url"])
		u = substituteServerVars(u, srv)
		return normalizeBase(u)
	}
	host := stringOf(p.root["host"])
	basePath := stringOf(p.root["basePath"])
	scheme := "https"
	if schemes := sliceOf(p.root["schemes"]); len(schemes) > 0 {
		scheme = stringOf(schemes[0])
	}
	if host == "" {
		return normalizeBase(basePath)
	}
	return normalizeBase(scheme + "://" + host + basePath)
}

var serverVarRe = regexp.MustCompile(`\{([^}]+)\}`)

func substituteServerVars(u string, srv map[string]any) string {
	vars := mapOf(srv["variables"])
	if vars == nil {
		return u
	}
	return serverVarRe.ReplaceAllStringFunc(u, func(match string) string {
		name := match[1 : len(match)-1]
		if def := stringOf(mapOf(vars[name])["default"]); def != "" {
			return def
		}
		return match
	})
}

func normalizeBase(u string) string {
	u = strings.TrimSpace(u)
	switch {
	case u == "":
		return "{{baseUrl}}"
	case strings.HasPrefix(u, "http://"), strings.HasPrefix(u, "https://"):
		return strings.TrimRight(u, "/")
	case strings.HasPrefix(u, "/"):
		return strings.TrimRight("{{baseUrl}}"+u, "/")
	default:
		return strings.TrimRight("{{baseUrl}}/"+u, "/")
	}
}

var pathVarRe = regexp.MustCompile(`\{([^}]+)\}`)

func (p *parser) buildRequest(method, path string, op map[string]any, pathParams []map[string]any, base string) *models.RequestDef {
	req := &models.RequestDef{
		Method:  strings.ToUpper(method),
		URL:     strings.TrimRight(base, "/") + path,
		Params:  []models.KeyValue{},
		Headers: []models.KeyValue{},
		Body:    models.Body{Type: "none", Form: []models.KeyValue{}},
		Auth:    models.Auth{Type: "none"},
		Options: models.Options{Timeout: 30000, FollowRedirects: true, VerifyTLS: true, MaxRedirects: 10},
	}

	name := stringOf(op["summary"])
	if name == "" {
		name = stringOf(op["operationId"])
	}
	if name == "" {
		name = strings.ToUpper(method) + " " + path
	}
	req.Name = name

	// Merge path-level and operation-level parameters (operation wins).
	params := mergeParams(pathParams, parameters(op["parameters"]))

	pathValues := map[string]string{}
	for _, param := range params {
		pname := stringOf(param["name"])
		switch stringOf(param["in"]) {
		case "path":
			pathValues[pname] = paramExample(param)
		case "query":
			req.Params = append(req.Params, models.KeyValue{
				ID:      models.NewID(),
				Key:     pname,
				Value:   paramExample(param),
				Enabled: boolOf(param["required"]) || paramExample(param) != "",
				Desc:    stringOf(param["description"]),
			})
		case "header":
			req.Headers = append(req.Headers, models.KeyValue{
				ID:      models.NewID(),
				Key:     pname,
				Value:   paramExample(param),
				Enabled: boolOf(param["required"]),
				Desc:    stringOf(param["description"]),
			})
		}
	}

	// Substitute path variables on the path only, so a `{{baseUrl}}` prefix
	// in the base URL is never touched.
	finalPath := pathVarRe.ReplaceAllStringFunc(path, func(match string) string {
		pname := match[1 : len(match)-1]
		if v, ok := pathValues[pname]; ok && v != "" {
			return v
		}
		return "{{" + pname + "}}"
	})
	req.URL = strings.TrimRight(base, "/") + finalPath

	p.applyBody(req, op, params)
	p.applyAuth(req, op)
	return req
}

func (p *parser) applyBody(req *models.RequestDef, op map[string]any, params []map[string]any) {
	if p.v3 {
		body := mapOf(op["requestBody"])
		if body == nil {
			return
		}
		content := mapOf(body["content"])
		ct, media := pickContent(content)
		p.setBodyFromMedia(req, ct, media)
		return
	}

	// Swagger 2.0
	consumes := stringSlice(op["consumes"])
	if len(consumes) == 0 {
		consumes = stringSlice(p.root["consumes"])
	}
	var formFields []models.KeyValue
	var bodyParam map[string]any
	for _, param := range params {
		switch stringOf(param["in"]) {
		case "body":
			bodyParam = mapOf(param["schema"])
		case "formData":
			formFields = append(formFields, formField(param))
		}
	}
	if bodyParam != nil {
		sample := (&generator{p: p, seen: map[string]bool{}}).sample(bodyParam)
		ct := "application/json"
		if len(consumes) > 0 {
			ct = consumes[0]
		}
		if strings.Contains(ct, "json") || looksJSON(sample) {
			req.Body.Type = "json"
			req.Body.Raw = marshalPretty(sample)
		} else {
			req.Body.Type = "text"
			req.Body.Raw = fmt.Sprint(sample)
		}
		setContentType(req, ct)
		return
	}
	if len(formFields) > 0 {
		req.Body.Form = formFields
		ct := "application/x-www-form-urlencoded"
		if hasFile(formFields) {
			ct = "multipart/form-data"
		} else if len(consumes) > 0 {
			ct = consumes[0]
		}
		if strings.Contains(ct, "multipart") || hasFile(formFields) {
			req.Body.Type = "form-data"
		} else {
			req.Body.Type = "form-urlencoded"
		}
		setContentType(req, ct)
	}
}

func (p *parser) setBodyFromMedia(req *models.RequestDef, ct string, media map[string]any) {
	if media == nil {
		return
	}
	schema := mapOf(media["schema"])
	sample := (&generator{p: p, seen: map[string]bool{}}).sample(schema)
	if ex, ok := media["example"]; ok {
		sample = ex
	}

	switch {
	case strings.Contains(ct, "json") || strings.Contains(ct, "+json"):
		req.Body.Type = "json"
		req.Body.Raw = marshalPretty(sample)
	case strings.Contains(ct, "x-www-form-urlencoded"), strings.Contains(ct, "multipart/form-data"):
		fields := formFieldsFromSchema(p, schema)
		if len(fields) == 0 {
			return
		}
		req.Body.Form = fields
		if strings.Contains(ct, "multipart") || hasFile(fields) {
			req.Body.Type = "form-data"
		} else {
			req.Body.Type = "form-urlencoded"
		}
	case strings.Contains(ct, "xml"):
		req.Body.Type = "xml"
		req.Body.Raw = toXML(schema, p)
	case strings.HasPrefix(ct, "text/"):
		req.Body.Type = "text"
		req.Body.Raw = fmt.Sprint(sample)
	default:
		if sample == nil {
			return
		}
		req.Body.Type = "text"
		req.Body.Raw = marshalPretty(sample)
	}
	setContentType(req, ct)
}

func formFieldsFromSchema(p *parser, schema map[string]any) []models.KeyValue {
	schema = resolve(p, schema)
	props := mapOf(schema["properties"])
	if props == nil {
		return nil
	}
	var out []models.KeyValue
	for _, key := range sortedKeys(props) {
		ps := resolve(p, mapOf(props[key]))
		kv := models.KeyValue{ID: models.NewID(), Key: key, Enabled: true, Type: "text",
			Desc: stringOf(ps["description"])}
		if stringOf(ps["format"]) == "binary" || stringOf(ps["type"]) == "file" {
			kv.Type = "file"
			kv.Value = ""
		} else {
			kv.Value = fmt.Sprint(valueOrEmpty((&generator{p: p, seen: map[string]bool{}}).sample(ps)))
		}
		out = append(out, kv)
	}
	return out
}

func (p *parser) applyAuth(req *models.RequestDef, op map[string]any) {
	security := sliceOf(op["security"])
	if security == nil {
		security = sliceOf(p.root["security"])
	}
	if len(security) == 0 {
		return
	}
	requirement := mapOf(security[0])
	for name := range requirement {
		scheme := p.securityScheme(name)
		if scheme == nil {
			continue
		}
		typ := stringOf(scheme["type"])
		if p.v3 && typ == "http" {
			switch strings.ToLower(stringOf(scheme["scheme"])) {
			case "bearer":
				req.Auth = models.Auth{Type: "bearer", Token: ""}
			case "basic":
				req.Auth = models.Auth{Type: "basic"}
			}
			return
		}
		switch typ {
		case "basic":
			req.Auth = models.Auth{Type: "basic"}
		case "apiKey":
			addTo := "header"
			if stringOf(scheme["in"]) == "query" {
				addTo = "query"
			}
			req.Auth = models.Auth{Type: "apikey", Key: stringOf(scheme["name"]), AddTo: addTo}
		case "oauth2", "openIdConnect":
			req.Auth = models.Auth{Type: "bearer", Token: ""}
		}
		return
	}
}

func (p *parser) securityScheme(name string) map[string]any {
	if p.v3 {
		return mapOf(mapOf(mapOf(p.root["components"])["securitySchemes"])[name])
	}
	return mapOf(mapOf(p.root["securityDefinitions"])[name])
}

// --- schema sample generation ---------------------------------------------

type generator struct {
	p     *parser
	depth int
	seen  map[string]bool
}

func (g *generator) sample(schema map[string]any) any {
	if schema == nil || g.depth > 6 {
		return nil
	}
	if ref := stringOf(schema["$ref"]); ref != "" {
		if g.seen[ref] {
			return nil
		}
		g.seen[ref] = true
		defer delete(g.seen, ref)
		return g.sample(g.p.lookup(ref))
	}
	if v, ok := schema["example"]; ok {
		return v
	}
	if v, ok := schema["default"]; ok {
		return v
	}
	if enum := sliceOf(schema["enum"]); len(enum) > 0 {
		return enum[0]
	}
	if all := sliceOf(schema["allOf"]); len(all) > 0 {
		merged := map[string]any{}
		for _, sub := range all {
			if sm, ok := g.sample(mapOf(sub)).(map[string]any); ok {
				for k, v := range sm {
					merged[k] = v
				}
			}
		}
		return merged
	}
	for _, key := range []string{"oneOf", "anyOf"} {
		if one := sliceOf(schema[key]); len(one) > 0 {
			return g.sample(mapOf(one[0]))
		}
	}

	g.depth++
	defer func() { g.depth-- }()

	switch stringOf(schema["type"]) {
	case "object", "":
		props := mapOf(schema["properties"])
		if props == nil {
			if stringOf(schema["type"]) == "" {
				return nil
			}
			return map[string]any{}
		}
		out := map[string]any{}
		for k, v := range props {
			out[k] = g.sample(mapOf(v))
		}
		return out
	case "array":
		item := g.sample(mapOf(schema["items"]))
		if item == nil {
			return []any{}
		}
		return []any{item}
	case "string":
		switch stringOf(schema["format"]) {
		case "date-time":
			return "2024-01-01T00:00:00Z"
		case "date":
			return "2024-01-01"
		case "email":
			return "user@example.com"
		case "uuid":
			return "00000000-0000-0000-0000-000000000000"
		case "uri", "url":
			return "https://example.com"
		case "password":
			return "password"
		}
		return ""
	case "integer", "number":
		return 0
	case "boolean":
		return false
	}
	return nil
}

func resolve(p *parser, schema map[string]any) map[string]any {
	if ref := stringOf(schema["$ref"]); ref != "" {
		if r := p.lookup(ref); r != nil {
			return r
		}
	}
	return schema
}

// --- parameter helpers -----------------------------------------------------

func parameters(v any) []map[string]any {
	var out []map[string]any
	for _, raw := range sliceOf(v) {
		pm := mapOf(raw)
		if pm == nil {
			continue
		}
		if ref := stringOf(pm["$ref"]); ref != "" {
			pm = nil // resolved by caller via parser; refs in params are rare
		}
		if pm != nil {
			out = append(out, pm)
		}
	}
	return out
}

func mergeParams(base, override []map[string]any) []map[string]any {
	key := func(p map[string]any) string { return stringOf(p["in"]) + ":" + stringOf(p["name"]) }
	seen := map[string]int{}
	out := make([]map[string]any, len(base))
	copy(out, base)
	for i, p := range base {
		seen[key(p)] = i
	}
	for _, p := range override {
		if idx, ok := seen[key(p)]; ok {
			out[idx] = p
		} else {
			seen[key(p)] = len(out)
			out = append(out, p)
		}
	}
	return out
}

func paramExample(param map[string]any) string {
	if v, ok := param["example"]; ok && v != nil {
		return fmt.Sprint(v)
	}
	schema := mapOf(param["schema"])
	if schema == nil {
		schema = param // swagger2 puts type/default/enum directly on the param
	}
	if v, ok := schema["example"]; ok && v != nil {
		return fmt.Sprint(v)
	}
	if v, ok := schema["default"]; ok && v != nil {
		return fmt.Sprint(v)
	}
	if enum := sliceOf(schema["enum"]); len(enum) > 0 {
		return fmt.Sprint(enum[0])
	}
	return ""
}

func formField(param map[string]any) models.KeyValue {
	kv := models.KeyValue{
		ID:      models.NewID(),
		Key:     stringOf(param["name"]),
		Value:   paramExample(param),
		Enabled: boolOf(param["required"]),
		Type:    "text",
		Desc:    stringOf(param["description"]),
	}
	if stringOf(param["type"]) == "file" {
		kv.Type = "file"
		kv.Value = ""
	}
	return kv
}

func firstTag(op map[string]any) string {
	for _, t := range sliceOf(op["tags"]) {
		if s := stringOf(t); s != "" {
			return s
		}
	}
	return ""
}

// --- content negotiation ---------------------------------------------------

func pickContent(content map[string]any) (string, map[string]any) {
	if content == nil {
		return "", nil
	}
	preferred := []string{
		"application/json",
		"application/x-www-form-urlencoded",
		"multipart/form-data",
	}
	for _, ct := range preferred {
		if media := mapOf(content[ct]); media != nil {
			return ct, media
		}
	}
	// Any +json / xml / first key.
	for _, k := range sortedKeys(content) {
		if strings.Contains(k, "+json") || strings.Contains(k, "json") {
			return k, mapOf(content[k])
		}
	}
	keys := sortedKeys(content)
	if len(keys) == 0 {
		return "", nil
	}
	return keys[0], mapOf(content[keys[0]])
}

func setContentType(req *models.RequestDef, ct string) {
	if ct == "" {
		return
	}
	for _, h := range req.Headers {
		if strings.EqualFold(h.Key, "Content-Type") {
			return
		}
	}
	req.Headers = append(req.Headers, models.KeyValue{
		ID: models.NewID(), Key: "Content-Type", Value: ct, Enabled: true,
	})
}

// --- small utilities -------------------------------------------------------

func decode(raw []byte) (map[string]any, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, fmt.Errorf("empty document")
	}
	var m map[string]any
	if strings.HasPrefix(trimmed, "{") {
		if err := json.Unmarshal(raw, &m); err == nil {
			return m, nil
		}
	}
	// Try YAML (also handles JSON, but JSON path above is faster).
	var y any
	if err := yaml.Unmarshal(raw, &y); err != nil {
		return nil, fmt.Errorf("could not parse document as JSON or YAML: %w", err)
	}
	normalized := normalize(y)
	b, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if m == nil {
		return nil, fmt.Errorf("document is not an object")
	}
	return m, nil
}

func normalize(v any) any {
	switch t := v.(type) {
	case map[string]any:
		for k, vv := range t {
			t[k] = normalize(vv)
		}
		return t
	case map[any]any:
		out := make(map[string]any, len(t))
		for k, vv := range t {
			out[fmt.Sprint(k)] = normalize(vv)
		}
		return out
	case []any:
		for i := range t {
			t[i] = normalize(t[i])
		}
		return t
	default:
		return v
	}
}

func mapOf(v any) map[string]any {
	if x, ok := v.(map[string]any); ok {
		return x
	}
	return nil
}

func sliceOf(v any) []any {
	if x, ok := v.([]any); ok {
		return x
	}
	return nil
}

func stringOf(v any) string {
	if x, ok := v.(string); ok {
		return x
	}
	return ""
}

func boolOf(v any) bool {
	if x, ok := v.(bool); ok {
		return x
	}
	return false
}

func stringSlice(v any) []string {
	var out []string
	for _, item := range sliceOf(v) {
		if s := stringOf(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func marshalPretty(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(b)
}

func looksJSON(v any) bool {
	switch v.(type) {
	case map[string]any, []any:
		return true
	}
	return false
}

func hasFile(fields []models.KeyValue) bool {
	for _, f := range fields {
		if f.Type == "file" {
			return true
		}
	}
	return false
}

func folderName(title, version string) string {
	if version == "" || strings.Contains(title, version) {
		return title
	}
	return fmt.Sprintf("%s (%s)", title, version)
}

func valueOrEmpty(v any) any {
	if v == nil {
		return ""
	}
	return v
}

func toXML(schema map[string]any, p *parser) string {
	schema = resolve(p, schema)
	props := mapOf(schema["properties"])
	if props == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("<object>")
	for _, k := range sortedKeys(props) {
		v := (&generator{p: p, seen: map[string]bool{}}).sample(mapOf(props[k]))
		b.WriteString("<" + k + ">" + fmt.Sprint(valueOrEmpty(v)) + "</" + k + ">")
	}
	b.WriteString("</object>")
	return b.String()
}
