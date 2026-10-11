package ai

import (
	"context"
	"os"
	"testing"

	"google.golang.org/adk/model"
	"google.golang.org/genai"
)

// TestLiveModelCall is an opt-in integration test: it only runs when real BYOK
// credentials are present in the environment.
func TestLiveModelCall(t *testing.T) {
	key := os.Getenv("LLM_APIKEY")
	base := os.Getenv("LLM_BASE_URL")
	name := os.Getenv("LLM_MODEL")
	if key == "" || base == "" {
		t.Skip("LLM_APIKEY / LLM_BASE_URL not set")
	}
	provider := os.Getenv("LLM_PROVIDER")
	if provider == "" {
		provider = "anthropic"
	}
	m, err := NewLLM(Config{Provider: provider, APIKey: key, BaseURL: base, Model: name})
	if err != nil {
		t.Fatal(err)
	}

	// 1) plain completion
	req := &model.LLMRequest{
		Contents: []*genai.Content{genai.NewContentFromText("Reply with exactly: pong", genai.RoleUser)},
		Config:   &genai.GenerateContentConfig{},
	}
	var got string
	for resp, err := range m.GenerateContent(context.Background(), req, false) {
		if err != nil {
			t.Fatal(err)
		}
		if resp.Content != nil {
			for _, p := range resp.Content.Parts {
				got += p.Text
			}
		}
	}
	t.Logf("completion: %q", got)
	if got == "" {
		t.Fatal("empty completion")
	}

	// 2) tool calling
	req2 := &model.LLMRequest{
		Contents: []*genai.Content{genai.NewContentFromText("What is the weather in Tokyo? Use the tool.", genai.RoleUser)},
		Config: &genai.GenerateContentConfig{Tools: []*genai.Tool{{
			FunctionDeclarations: []*genai.FunctionDeclaration{{
				Name:        "get_weather",
				Description: "Get the weather for a city",
				Parameters: &genai.Schema{
					Type:       genai.TypeObject,
					Properties: map[string]*genai.Schema{"city": {Type: genai.TypeString}},
					Required:   []string{"city"},
				},
			}},
		}}},
	}
	var calls []string
	for resp, err := range m.GenerateContent(context.Background(), req2, false) {
		if err != nil {
			t.Fatal(err)
		}
		if resp.Content == nil {
			continue
		}
		for _, p := range resp.Content.Parts {
			if p.FunctionCall != nil {
				calls = append(calls, p.FunctionCall.Name+"("+string(jsonBytes(p.FunctionCall.Args))+")")
			}
		}
	}
	t.Logf("tool calls: %v", calls)
	if len(calls) == 0 {
		t.Fatal("model did not call the tool")
	}
}
