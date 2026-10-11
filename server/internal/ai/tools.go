package ai

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/functiontool"

	"curlui/server/internal/models"
	"curlui/server/internal/store"
)

// Backend is the slice of curlui the agent may operate on (the API server
// implements it, reusing the same code paths as the MCP tools).
type Backend interface {
	Collections() []*models.Node
	Environments() []models.Environment
	History() []models.HistoryEntry
	FindNode(id string) (*models.Node, bool)
	Execute(ctx context.Context, req models.RequestDef, envID string, vars map[string]string, parents []models.RequestDef, mock bool) models.Response
	AddRequest(parentID, name string, req models.RequestDef) (*models.Node, error)
}

// allow reports whether the calling token grants a scope. A nil scope list
// means an unscoped session login, which may do everything.
func allow(scopes []string, need string) bool {
	if scopes == nil {
		return true
	}
	for _, s := range scopes {
		if s == need || s == store.ScopeAdmin {
			return true
		}
	}
	return false
}

func denied(need string) error {
	return fmt.Errorf("this token is missing the %q scope", need)
}

// BuildTools exposes curlui operations to the model. Every tool re-checks the
// caller's scopes, so a read-only token can never mutate anything.
func BuildTools(b Backend, scopes []string) ([]tool.Tool, error) {
	read := func(name, desc string, fn func(tool.Context, map[string]any) (any, error)) (tool.Tool, error) {
		return functiontool.New(functiontool.Config{Name: name, Description: desc},
			func(ctx tool.Context, args map[string]any) (any, error) {
				if !allow(scopes, store.ScopeRead) {
					return nil, denied(store.ScopeRead)
				}
				return fn(ctx, args)
			})
	}
	send := func(name, desc string, fn func(tool.Context, map[string]any) (any, error)) (tool.Tool, error) {
		return functiontool.New(functiontool.Config{Name: name, Description: desc},
			func(ctx tool.Context, args map[string]any) (any, error) {
				if !allow(scopes, store.ScopeSend) {
					return nil, denied(store.ScopeSend)
				}
				return fn(ctx, args)
			})
	}
	write := func(name, desc string, fn func(tool.Context, map[string]any) (any, error)) (tool.Tool, error) {
		return functiontool.New(functiontool.Config{Name: name, Description: desc},
			func(ctx tool.Context, args map[string]any) (any, error) {
				if !allow(scopes, store.ScopeWrite) {
					return nil, denied(store.ScopeWrite)
				}
				return fn(ctx, args)
			})
	}

	var tools []tool.Tool
	add := func(t tool.Tool, err error) {
		if err == nil {
			tools = append(tools, t)
		}
	}

	add(read("list_collections", "List every saved request and folder in the active project.",
		func(_ tool.Context, _ map[string]any) (any, error) {
			return map[string]any{"collections": b.Collections()}, nil
		}))

	add(read("list_environments", "List environments and their variables.",
		func(_ tool.Context, _ map[string]any) (any, error) {
			return map[string]any{"environments": b.Environments()}, nil
		}))

	add(read("list_history", "List the most recent requests that were sent.",
		func(_ tool.Context, _ map[string]any) (any, error) {
			h := b.History()
			if len(h) > 30 {
				h = h[:30]
			}
			return map[string]any{"history": h}, nil
		}))

	add(read("get_request", "Fetch a saved request by id.",
		func(_ tool.Context, args map[string]any) (any, error) {
			id, _ := args["id"].(string)
			n, ok := b.FindNode(id)
			if !ok {
				return nil, fmt.Errorf("request %q not found", id)
			}
			return n, nil
		}))

	add(send("send_request", "Send an HTTP request and return the status, headers and body.",
		func(ctx tool.Context, args map[string]any) (any, error) {
			method, _ := args["method"].(string)
			url, _ := args["url"].(string)
			if strings.TrimSpace(url) == "" {
				return nil, fmt.Errorf("url is required")
			}
			if method == "" {
				method = "GET"
			}
			req := models.RequestDef{Method: strings.ToUpper(method), URL: url}
			if body, ok := args["body"].(string); ok {
				req.Body = models.Body{Raw: body, Type: "json"}
			}
			if hdrs, ok := args["headers"].(map[string]any); ok {
				for k, v := range hdrs {
					req.Headers = append(req.Headers, models.KeyValue{Key: k, Value: fmt.Sprint(v), Enabled: true})
				}
			}
			resp := b.Execute(ctx, req, "", nil, nil, false)
			return summarise(resp), nil
		}))

	add(send("run_saved_request", "Run a saved request by name (or id) and return its response.",
		func(ctx tool.Context, args map[string]any) (any, error) {
			key, _ := args["name"].(string)
			if key == "" {
				key, _ = args["id"].(string)
			}
			n := findByName(b.Collections(), key)
			if n == nil || n.Request == nil {
				return nil, fmt.Errorf("saved request %q not found", key)
			}
			resp := b.Execute(ctx, *n.Request, "", nil, nil, false)
			return summarise(resp), nil
		}))

	add(write("create_request", "Save a new request into a collection.",
		func(_ tool.Context, args map[string]any) (any, error) {
			name, _ := args["name"].(string)
			url, _ := args["url"].(string)
			method, _ := args["method"].(string)
			if name == "" || url == "" {
				return nil, fmt.Errorf("name and url are required")
			}
			if method == "" {
				method = "GET"
			}
			parent, _ := args["parentId"].(string)
			node, err := b.AddRequest(parent, name, models.RequestDef{Method: strings.ToUpper(method), URL: url})
			if err != nil {
				return nil, err
			}
			return map[string]any{"id": node.ID, "name": node.Name}, nil
		}))

	return tools, nil
}

// summarise trims a response down to what is useful for a model.
func summarise(r models.Response) map[string]any {
	body := r.Body
	if len(body) > 20000 {
		body = body[:20000] + "\n…(truncated)"
	}
	out := map[string]any{
		"status":  r.Status,
		"headers": r.Headers,
		"body":    body,
	}
	if r.Error != "" {
		out["error"] = r.Error
	}
	return out
}

func findByName(nodes []*models.Node, name string) *models.Node {
	for _, n := range nodes {
		if n == nil {
			continue
		}
		if n.ID == name || strings.EqualFold(n.Name, name) {
			return n
		}
		if found := findByName(n.Children, name); found != nil {
			return found
		}
	}
	return nil
}
