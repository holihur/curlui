//go:build !core

package mcp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"curlui/server/internal/models"
	"curlui/server/internal/proxy"
)

type fakeBackend struct{ write bool }

func (f *fakeBackend) Execute(context.Context, models.RequestDef, string, map[string]string, []models.RequestDef, bool) models.Response {
	return models.Response{Status: 200, Body: `{"ok":true}`}
}
func (f *fakeBackend) Collections() []*models.Node { return nil }
func (f *fakeBackend) Environments() []models.Environment {
	return nil
}
func (f *fakeBackend) FindNode(string) (*models.Node, bool) { return nil, false }
func (f *fakeBackend) History() []models.HistoryEntry       { return nil }
func (f *fakeBackend) Captures() []models.CaptureEntry      { return nil }
func (f *fakeBackend) ClearCaptures() error                 { return nil }
func (f *fakeBackend) AddRequest(string, string, models.RequestDef) (*models.Node, error) {
	return &models.Node{ID: "n1"}, nil
}
func (f *fakeBackend) Settings() map[string]string {
	m := map[string]string{}
	if f.write {
		m["mcpWrite"] = "1"
	}
	return m
}
func (f *fakeBackend) SaveSettings(map[string]string) error           { return nil }
func (f *fakeBackend) Intercepts() []proxy.PendingInfo                { return nil }
func (f *fakeBackend) ResolveIntercept(string, proxy.Resolution) bool { return false }
func (f *fakeBackend) ReplayCapture(context.Context, string) (models.CaptureEntry, error) {
	return models.CaptureEntry{}, nil
}

func call(t *testing.T, b Backend, raw string) map[string]any {
	t.Helper()
	out, respond := Handle([]byte(raw), "test", b)
	if !respond {
		t.Fatalf("no response for %s", raw)
	}
	var res map[string]any
	if err := json.Unmarshal(out, &res); err != nil {
		t.Fatalf("bad response %s: %v", out, err)
	}
	return res
}

func TestInitializeNegotiatesVersion(t *testing.T) {
	b := &fakeBackend{}
	for _, want := range SupportedProtocols {
		res := call(t, b, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"`+want+`"}}`)
		got := res["result"].(map[string]any)["protocolVersion"]
		if got != want {
			t.Errorf("protocolVersion = %v, want %v", got, want)
		}
	}
	// An unknown revision falls back to the newest supported one.
	res := call(t, b, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`)
	if got := res["result"].(map[string]any)["protocolVersion"]; got != SupportedProtocols[0] {
		t.Errorf("fallback = %v, want %v", got, SupportedProtocols[0])
	}
}

func TestEmptyResourceLists(t *testing.T) {
	b := &fakeBackend{}
	for _, method := range []string{"resources/list", "resources/templates/list", "prompts/list"} {
		res := call(t, b, `{"jsonrpc":"2.0","id":1,"method":"`+method+`"}`)
		if res["error"] != nil {
			t.Errorf("%s returned an error: %v", method, res["error"])
		}
	}
}

func TestNotificationsProduceNoResponse(t *testing.T) {
	b := &fakeBackend{}
	for _, raw := range []string{
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}`,
	} {
		if _, respond := Handle([]byte(raw), "test", b); respond {
			t.Errorf("%s should not produce a response", raw)
		}
	}
}

func TestBatch(t *testing.T) {
	b := &fakeBackend{}
	out, respond := Handle([]byte(`[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]`), "test", b)
	if !respond {
		t.Fatal("batch produced no response")
	}
	if !strings.HasPrefix(strings.TrimSpace(string(out)), "[") {
		t.Fatalf("batch response is not an array: %s", out)
	}
}

func TestParseError(t *testing.T) {
	b := &fakeBackend{}
	res := call(t, b, `{not json`)
	if res["error"] == nil {
		t.Fatal("expected a parse error")
	}
	if code := res["error"].(map[string]any)["code"].(float64); code != -32700 {
		t.Errorf("code = %v, want -32700", code)
	}
}

func TestToolCallIsErrorWhenWriteDisabled(t *testing.T) {
	b := &fakeBackend{write: false}
	res := call(t, b, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_request","arguments":{"name":"x","url":"http://x"}}}`)
	result, ok := res["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected a tool result, got %v", res)
	}
	if result["isError"] != true {
		t.Errorf("isError = %v, want true", result["isError"])
	}
}

func TestToolsListRespectsWriteGate(t *testing.T) {
	ro := call(t, &fakeBackend{}, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	rw := call(t, &fakeBackend{write: true}, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	n := func(res map[string]any) int {
		return len(res["result"].(map[string]any)["tools"].([]any))
	}
	if n(rw) <= n(ro) {
		t.Errorf("write tools should add to the list: ro=%d rw=%d", n(ro), n(rw))
	}
}

func TestUnknownMethod(t *testing.T) {
	res := call(t, &fakeBackend{}, `{"jsonrpc":"2.0","id":1,"method":"does/not/exist"}`)
	if res["error"] == nil {
		t.Fatal("expected method-not-found")
	}
	if code := res["error"].(map[string]any)["code"].(float64); code != -32601 {
		t.Errorf("code = %v, want -32601", code)
	}
}
