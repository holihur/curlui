// Package mcp implements a minimal Model Context Protocol server (JSON-RPC 2.0)
// that exposes curlui as tools an AI agent can call. Tools are split into a
// read group and a write group; both are gated by settings so the UI can toggle
// MCP on/off and allow or block write tools.
package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"curlui/server/internal/models"
	"curlui/server/internal/proxy"
)

// Backend is what the MCP tools operate on (implemented by the API server).
type Backend interface {
	Execute(ctx context.Context, req models.RequestDef, envID string, vars map[string]string, parents []models.RequestDef, mock bool) models.Response
	Collections() []*models.Node
	Environments() []models.Environment
	FindNode(id string) (*models.Node, bool)
	History() []models.HistoryEntry
	Captures() []models.CaptureEntry
	ClearCaptures() error
	AddRequest(parentID, name string, req models.RequestDef) (*models.Node, error)
	Settings() map[string]string
	SaveSettings(map[string]string) error
	Intercepts() []proxy.PendingInfo
	ResolveIntercept(id string, res proxy.Resolution) bool
	ReplayCapture(ctx context.Context, id string) (models.CaptureEntry, error)
}

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type toolDef struct {
	name   string
	write  bool
	schema map[string]any
}

// Serve runs the MCP server over stdio until stdin closes.
func Serve(in io.Reader, out io.Writer, version string, backend Backend) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 8<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		res, respond := Handle([]byte(line), version, backend)
		if !respond {
			continue
		}
		if _, err := out.Write(append(res, '\n')); err != nil {
			return err
		}
	}
	return scanner.Err()
}

// Handle processes a single JSON-RPC message and returns the response bytes.
func Handle(raw []byte, version string, backend Backend) ([]byte, bool) {
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, false
	}
	res, respond := dispatch(req, version, backend)
	if !respond {
		return nil, false
	}
	res.JSONRPC = "2.0"
	res.ID = req.ID
	b, err := json.Marshal(res)
	if err != nil {
		return nil, false
	}
	return b, true
}

func mcpEnabled(backend Backend) bool {
	return backend.Settings()["mcpEnabled"] != "0"
}

func mcpWrite(backend Backend) bool {
	return backend.Settings()["mcpWrite"] == "1"
}

func dispatch(req request, version string, backend Backend) (response, bool) {
	switch req.Method {
	case "initialize":
		return response{Result: map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "curlui", "version": version},
		}}, true
	case "notifications/initialized", "initialized":
		return response{}, false
	case "ping":
		return response{Result: map[string]any{}}, true
	case "tools/list":
		if !mcpEnabled(backend) {
			return response{Result: map[string]any{"tools": []any{}}}, true
		}
		return response{Result: map[string]any{"tools": tools(backend)}}, true
	case "tools/call":
		if !mcpEnabled(backend) {
			return response{Error: &rpcError{Code: -32000, Message: "MCP is disabled — enable it in curlui Settings"}}, true
		}
		return callTool(req.Params, backend), true
	default:
		return response{Error: &rpcError{Code: -32601, Message: "method not found: " + req.Method}}, true
	}
}

type toolCall struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

func callTool(raw json.RawMessage, backend Backend) response {
	var call toolCall
	if err := json.Unmarshal(raw, &call); err != nil {
		return response{Error: &rpcError{Code: -32602, Message: "invalid params"}}
	}
	def := findTool(call.Name)
	if def == nil {
		return response{Error: &rpcError{Code: -32601, Message: "unknown tool: " + call.Name}}
	}
	if def.write && !mcpWrite(backend) {
		return response{Error: &rpcError{Code: -32000, Message: "write tools are disabled — enable them in curlui Settings"}}
	}

	switch call.Name {
	case "list_collections":
		return textResult(mustJSON(backend.Collections()))
	case "list_environments":
		return textResult(mustJSON(backend.Environments()))
	case "list_history":
		return textResult(mustJSON(limitHistory(backend.History(), 30)))
	case "list_captures":
		return textResult(mustJSON(limitCaptures(backend.Captures(), 50)))
	case "get_request":
		return toolGetRequest(call.Arguments, backend)
	case "http_request":
		return toolHTTPRequest(call.Arguments, backend)
	case "run_saved_request":
		return toolRunSaved(call.Arguments, backend)
	case "create_request":
		return toolCreateRequest(call.Arguments, backend)
	case "clear_captures":
		if err := backend.ClearCaptures(); err != nil {
			return textResult("error: " + err.Error())
		}
		return textResult("captures cleared")
	case "list_intercepts":
		return textResult(mustJSON(backend.Intercepts()))
	case "replay_capture":
		return toolReplayCapture(call.Arguments, backend)
	case "resolve_intercept":
		return toolResolveIntercept(call.Arguments, backend)
	case "proxy_config":
		return toolProxyConfig(call.Arguments, backend)
	default:
		return response{Error: &rpcError{Code: -32601, Message: "unknown tool: " + call.Name}}
	}
}

func toolGetRequest(raw json.RawMessage, backend Backend) response {
	var args struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &args)
	node, ok := backend.FindNode(args.ID)
	if !ok {
		return textResult("error: request not found: " + args.ID)
	}
	return textResult(mustJSON(node))
}

func toolHTTPRequest(raw json.RawMessage, backend Backend) response {
	var args struct {
		Method    string            `json:"method"`
		URL       string            `json:"url"`
		Headers   map[string]string `json:"headers"`
		Body      string            `json:"body"`
		TimeoutMs int               `json:"timeout_ms"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return response{Error: &rpcError{Code: -32602, Message: "invalid arguments"}}
	}
	req := BuildRequest(args.Method, args.URL, args.Headers, args.Body, args.TimeoutMs)
	if strings.TrimSpace(args.URL) == "" {
		return textResult("error: url is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp := backend.Execute(ctx, req, "", nil, nil, false)
	return textResult(mustJSON(map[string]any{
		"status":  resp.Status,
		"headers": resp.Headers,
		"body":    truncate(resp.Body, 20000),
		"error":   resp.Error,
	}))
}

func toolRunSaved(raw json.RawMessage, backend Backend) response {
	var args struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &args)
	node, ok := backend.FindNode(args.ID)
	if !ok || node.Request == nil {
		return textResult("error: request not found: " + args.ID)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp := backend.Execute(ctx, *node.Request, "", nil, nil, false)
	return textResult(mustJSON(map[string]any{
		"name":    node.Name,
		"status":  resp.Status,
		"headers": resp.Headers,
		"body":    truncate(resp.Body, 20000),
		"error":   resp.Error,
	}))
}

func toolCreateRequest(raw json.RawMessage, backend Backend) response {
	var args struct {
		ParentID string            `json:"parent_id"`
		Name     string            `json:"name"`
		Method   string            `json:"method"`
		URL      string            `json:"url"`
		Headers  map[string]string `json:"headers"`
		Body     string            `json:"body"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return response{Error: &rpcError{Code: -32602, Message: "invalid arguments"}}
	}
	if strings.TrimSpace(args.URL) == "" {
		return textResult("error: url is required")
	}
	if args.Name == "" {
		args.Name = args.Method + " " + args.URL
	}
	req := BuildRequest(args.Method, args.URL, args.Headers, args.Body, 0)
	node, err := backend.AddRequest(args.ParentID, args.Name, req)
	if err != nil {
		return textResult("error: " + err.Error())
	}
	return textResult(mustJSON(map[string]any{"id": node.ID, "name": node.Name}))
}

func toolReplayCapture(raw json.RawMessage, backend Backend) response {
	var args struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &args)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	entry, err := backend.ReplayCapture(ctx, args.ID)
	if err != nil {
		return textResult("error: " + err.Error())
	}
	return textResult(mustJSON(map[string]any{
		"status": entry.Status,
		"url":    entry.URL,
		"body":   truncate(entry.ResponseBody, 20000),
		"error":  entry.Error,
	}))
}

func toolResolveIntercept(raw json.RawMessage, backend Backend) response {
	var args struct {
		ID      string              `json:"id"`
		Action  string              `json:"action"`
		Method  string              `json:"method"`
		URL     string              `json:"url"`
		Status  int                 `json:"status"`
		Headers map[string][]string `json:"headers"`
		Body    string              `json:"body"`
	}
	_ = json.Unmarshal(raw, &args)
	ok := backend.ResolveIntercept(args.ID, proxy.Resolution{
		Abort:   args.Action == "abort",
		Method:  args.Method,
		URL:     args.URL,
		Status:  args.Status,
		Headers: args.Headers,
		Body:    []byte(args.Body),
	})
	if !ok {
		return textResult("error: intercept not found: " + args.ID)
	}
	return textResult("ok")
}

func toolProxyConfig(raw json.RawMessage, backend Backend) response {
	var args struct {
		Capture             *bool   `json:"capture"`
		TTLSeconds          *int    `json:"ttl_seconds"`
		Filter              *string `json:"filter"`
		Break               *bool   `json:"break"`
		BreakFilter         *string `json:"break_filter"`
		BreakResponse       *bool   `json:"break_response"`
		BreakResponseFilter *string `json:"break_response_filter"`
		MITM                *bool   `json:"mitm"`
		MITMFilter          *string `json:"mitm_filter"`
	}
	_ = json.Unmarshal(raw, &args)
	m := map[string]string{}
	if args.Capture != nil {
		m["proxyCapture"] = boolStr(*args.Capture)
	}
	if args.TTLSeconds != nil {
		m["proxyTTL"] = fmt.Sprint(*args.TTLSeconds)
	}
	if args.Filter != nil {
		m["proxyCaptureFilter"] = *args.Filter
	}
	if args.Break != nil {
		m["proxyBreak"] = boolStr(*args.Break)
	}
	if args.BreakFilter != nil {
		m["proxyBreakFilter"] = *args.BreakFilter
	}
	if args.BreakResponse != nil {
		m["proxyBreakResponse"] = boolStr(*args.BreakResponse)
	}
	if args.BreakResponseFilter != nil {
		m["proxyBreakResponseFilter"] = *args.BreakResponseFilter
	}
	if args.MITM != nil {
		m["proxyMITM"] = boolStr(*args.MITM)
	}
	if args.MITMFilter != nil {
		m["proxyMITMFilter"] = *args.MITMFilter
	}
	if len(m) == 0 {
		return textResult("nothing to change")
	}
	if err := backend.SaveSettings(m); err != nil {
		return textResult("error: " + err.Error())
	}
	return textResult("settings updated")
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

// BuildRequest constructs a RequestDef from simple tool arguments.
func BuildRequest(method, url string, headers map[string]string, body string, timeoutMs int) models.RequestDef {
	if method == "" {
		method = "GET"
	}
	req := models.RequestDef{
		Name:    method + " " + url,
		Method:  method,
		URL:     url,
		Headers: []models.KeyValue{},
		Params:  []models.KeyValue{},
		Body:    models.Body{Type: "none", Form: []models.KeyValue{}},
		Auth:    models.Auth{Type: "none"},
		Options: models.Options{Timeout: 30000, FollowRedirects: true, VerifyTLS: true, MaxRedirects: 10},
	}
	if timeoutMs > 0 {
		req.Options.Timeout = timeoutMs
	}
	for k, v := range headers {
		req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: k, Value: v, Enabled: true})
	}
	if body != "" {
		req.Body.Raw = body
		if strings.Contains(strings.ToLower(headers["Content-Type"]), "json") || strings.HasPrefix(strings.TrimSpace(body), "{") {
			req.Body.Type = "json"
		} else {
			req.Body.Type = "text"
		}
	}
	return req
}

func limitHistory(h []models.HistoryEntry, n int) []models.HistoryEntry {
	if len(h) > n {
		return h[:n]
	}
	return h
}

func limitCaptures(c []models.CaptureEntry, n int) []models.CaptureEntry {
	if len(c) > n {
		return c[:n]
	}
	return c
}

func textResult(text string) response {
	return response{Result: map[string]any{
		"content": []map[string]any{{"type": "text", "text": text}},
	}}
}

func mustJSON(v any) string {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(b)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…(truncated)"
}

func allToolDefs() []toolDef {
	return []toolDef{
		// read group
		{"list_collections", false, map[string]any{"type": "object", "properties": map[string]any{}}},
		{"list_environments", false, map[string]any{"type": "object", "properties": map[string]any{}}},
		{"list_history", false, map[string]any{"type": "object", "properties": map[string]any{}}},
		{"list_captures", false, map[string]any{"type": "object", "properties": map[string]any{}}},
		{"get_request", false, map[string]any{
			"type":       "object",
			"properties": map[string]any{"id": map[string]any{"type": "string"}},
			"required":   []string{"id"},
		}},
		// write group
		{"http_request", true, map[string]any{
			"type": "object",
			"properties": map[string]any{
				"method":     map[string]any{"type": "string", "description": "HTTP method (default GET)"},
				"url":        map[string]any{"type": "string", "description": "Absolute URL"},
				"headers":    map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
				"body":       map[string]any{"type": "string"},
				"timeout_ms": map[string]any{"type": "integer"},
			},
			"required": []string{"url"},
		}},
		{"run_saved_request", true, map[string]any{
			"type":       "object",
			"properties": map[string]any{"id": map[string]any{"type": "string"}},
			"required":   []string{"id"},
		}},
		{"create_request", true, map[string]any{
			"type": "object",
			"properties": map[string]any{
				"parent_id": map[string]any{"type": "string"},
				"name":      map[string]any{"type": "string"},
				"method":    map[string]any{"type": "string"},
				"url":       map[string]any{"type": "string"},
				"headers":   map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
				"body":      map[string]any{"type": "string"},
			},
			"required": []string{"url"},
		}},
		{"clear_captures", true, map[string]any{"type": "object", "properties": map[string]any{}}},
		{"list_intercepts", false, map[string]any{"type": "object", "properties": map[string]any{}}},
		{"replay_capture", true, map[string]any{
			"type":       "object",
			"properties": map[string]any{"id": map[string]any{"type": "string"}},
			"required":   []string{"id"},
		}},
		{"resolve_intercept", true, map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":      map[string]any{"type": "string"},
				"action":  map[string]any{"type": "string", "enum": []string{"continue", "abort"}},
				"method":  map[string]any{"type": "string"},
				"url":     map[string]any{"type": "string"},
				"status":  map[string]any{"type": "integer"},
				"headers": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}},
				"body":    map[string]any{"type": "string"},
			},
			"required": []string{"id", "action"},
		}},
		{"proxy_config", true, map[string]any{
			"type": "object",
			"properties": map[string]any{
				"capture":               map[string]any{"type": "boolean"},
				"ttl_seconds":           map[string]any{"type": "integer"},
				"filter":                map[string]any{"type": "string"},
				"break":                 map[string]any{"type": "boolean"},
				"break_filter":          map[string]any{"type": "string"},
				"break_response":        map[string]any{"type": "boolean"},
				"break_response_filter": map[string]any{"type": "string"},
				"mitm":                  map[string]any{"type": "boolean"},
				"mitm_filter":           map[string]any{"type": "string"},
			},
		}},
	}
}

func findTool(name string) *toolDef {
	defs := allToolDefs()
	for i := range defs {
		if defs[i].name == name {
			return &defs[i]
		}
	}
	return nil
}

func tools(backend Backend) []map[string]any {
	write := mcpWrite(backend)
	out := []map[string]any{}
	for _, d := range allToolDefs() {
		if d.write && !write {
			continue
		}
		group := "read"
		if d.write {
			group = "write"
		}
		out = append(out, map[string]any{
			"name":        d.name,
			"description": "[" + group + "] curlui tool",
			"group":       group,
			"inputSchema": d.schema,
		})
	}
	return out
}
