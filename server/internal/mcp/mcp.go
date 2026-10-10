// Package mcp implements a minimal Model Context Protocol server (JSON-RPC 2.0
// over stdio) that exposes curlui as tools an AI agent can call.
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
)

// Backend is what the MCP tools operate on (implemented by the API server).
type Backend interface {
	Execute(ctx context.Context, req models.RequestDef, envID string, vars map[string]string, parents []models.RequestDef, mock bool) models.Response
	Collections() []*models.Node
	Environments() []models.Environment
	FindNode(id string) (*models.Node, bool)
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

// Serve runs the MCP server until stdin closes.
func Serve(in io.Reader, out io.Writer, version string, backend Backend) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 8<<20)
	enc := json.NewEncoder(out)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			continue
		}
		res, respond := dispatch(req, version, backend)
		if !respond {
			continue
		}
		res.JSONRPC = "2.0"
		res.ID = req.ID
		if err := enc.Encode(res); err != nil {
			return err
		}
	}
	return scanner.Err()
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
		return response{Result: map[string]any{"tools": tools()}}, true
	case "tools/call":
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
	switch call.Name {
	case "http_request":
		return toolHTTPRequest(call.Arguments, backend)
	case "list_collections":
		return textResult(mustJSON(backend.Collections()))
	case "list_environments":
		return textResult(mustJSON(backend.Environments()))
	case "run_saved_request":
		return toolRunSaved(call.Arguments, backend)
	default:
		return response{Error: &rpcError{Code: -32601, Message: "unknown tool: " + call.Name}}
	}
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
	if args.Method == "" {
		args.Method = "GET"
	}
	if strings.TrimSpace(args.URL) == "" {
		return textResult("error: url is required")
	}
	req := models.RequestDef{
		Name:    args.Method + " " + args.URL,
		Method:  args.Method,
		URL:     args.URL,
		Headers: []models.KeyValue{},
		Body:    models.Body{Type: "none", Form: []models.KeyValue{}},
		Auth:    models.Auth{Type: "none"},
		Options: models.Options{Timeout: 30000, FollowRedirects: true, VerifyTLS: true, MaxRedirects: 10},
	}
	if args.TimeoutMs > 0 {
		req.Options.Timeout = args.TimeoutMs
	}
	for k, v := range args.Headers {
		req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: k, Value: v, Enabled: true})
	}
	if args.Body != "" {
		req.Body.Raw = args.Body
		if strings.Contains(strings.ToLower(args.Headers["Content-Type"]), "json") || strings.HasPrefix(strings.TrimSpace(args.Body), "{") {
			req.Body.Type = "json"
		} else {
			req.Body.Type = "text"
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resp := backend.Execute(ctx, req, "", nil, nil, false)
	body := resp.Body
	if len(body) > 20000 {
		body = body[:20000] + "\n…(truncated)"
	}
	return textResult(mustJSON(map[string]any{
		"status":  resp.Status,
		"headers": resp.Headers,
		"body":    body,
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

func tools() []map[string]any {
	return []map[string]any{
		{
			"name":        "http_request",
			"description": "Send an HTTP request from the curlui server and return the status, headers and body.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"method":     map[string]any{"type": "string", "description": "HTTP method (default GET)"},
					"url":        map[string]any{"type": "string", "description": "Absolute URL"},
					"headers":    map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
					"body":       map[string]any{"type": "string"},
					"timeout_ms": map[string]any{"type": "integer"},
				},
				"required": []string{"url"},
			},
		},
		{
			"name":        "list_collections",
			"description": "List the saved collections tree (folders and requests).",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name":        "list_environments",
			"description": "List environments and their variables.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name":        "run_saved_request",
			"description": "Run a saved request by its node id.",
			"inputSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{"id": map[string]any{"type": "string"}},
				"required":   []string{"id"},
			},
		},
	}
}
