// Package ai adds the AI assistant: a Google ADK agent whose tools are curlui's
// own operations, backed by the user's own API key (BYOK).
package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"iter"
	"net/http"
	"strings"
	"time"

	"google.golang.org/adk/model"
	"google.golang.org/genai"
)

// Config is a BYOK provider configuration.
type Config struct {
	Provider string // "anthropic" | "openai"
	APIKey   string
	BaseURL  string
	Model    string
}

// NewLLM builds the model adapter for the configured provider.
func NewLLM(cfg Config) (model.LLM, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("no API key configured")
	}
	switch strings.ToLower(cfg.Provider) {
	case "", "anthropic":
		base := strings.TrimRight(cfg.BaseURL, "/")
		if base == "" {
			base = "https://api.anthropic.com"
		}
		return &anthropicLLM{cfg: cfg, base: base, client: httpClient()}, nil
	case "openai":
		base := strings.TrimRight(cfg.BaseURL, "/")
		if base == "" {
			base = "https://api.openai.com/v1"
		}
		return &openaiLLM{cfg: cfg, base: base, client: httpClient()}, nil
	default:
		return nil, fmt.Errorf("unsupported provider %q", cfg.Provider)
	}
}

func httpClient() *http.Client { return &http.Client{Timeout: 5 * time.Minute} }

// --- shared conversion helpers ---------------------------------------------

// schemaToJSON turns a genai.Schema (from a tool declaration) into JSON Schema.
func schemaToJSON(s *genai.Schema) map[string]any {
	if s == nil {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}
	out := map[string]any{}
	if s.Type != "" {
		out["type"] = strings.ToLower(string(s.Type))
	}
	if s.Description != "" {
		out["description"] = s.Description
	}
	if len(s.Enum) > 0 {
		out["enum"] = s.Enum
	}
	if len(s.Required) > 0 {
		out["required"] = s.Required
	}
	if len(s.Properties) > 0 {
		props := map[string]any{}
		for k, v := range s.Properties {
			props[k] = schemaToJSON(v)
		}
		out["properties"] = props
	}
	if s.Items != nil {
		out["items"] = schemaToJSON(s.Items)
	}
	return out
}

// toolDecls collects the function declarations from the LLM request.
func toolDecls(req *model.LLMRequest) []*genai.FunctionDeclaration {
	if req.Config == nil {
		return nil
	}
	var out []*genai.FunctionDeclaration
	for _, t := range req.Config.Tools {
		out = append(out, t.FunctionDeclarations...)
	}
	return out
}

func systemText(req *model.LLMRequest) string {
	if req.Config == nil || req.Config.SystemInstruction == nil {
		return ""
	}
	var b strings.Builder
	for _, p := range req.Config.SystemInstruction.Parts {
		if p.Text != "" {
			if b.Len() > 0 {
				b.WriteString("\n")
			}
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

func jsonBytes(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func readBody(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	return data, nil
}

// --- Anthropic --------------------------------------------------------------

type anthropicLLM struct {
	cfg    Config
	base   string
	client *http.Client
}

func (m *anthropicLLM) Name() string { return m.cfg.Model }

type anthropicMessage struct {
	Role    string `json:"role"`
	Content []any  `json:"content"`
}

func (m *anthropicLLM) buildRequest(req *model.LLMRequest, stream bool) map[string]any {
	body := map[string]any{
		"model":      firstNonEmpty(req.Model, m.cfg.Model),
		"max_tokens": 4096,
		"messages":   anthropicMessages(req.Contents),
	}
	if stream {
		body["stream"] = true
	}
	if sys := systemText(req); sys != "" {
		body["system"] = sys
	}
	if req.Config != nil && req.Config.Temperature != nil {
		body["temperature"] = *req.Config.Temperature
	}
	if decls := toolDecls(req); len(decls) > 0 {
		tools := make([]map[string]any, 0, len(decls))
		for _, d := range decls {
			tools = append(tools, map[string]any{
				"name":         d.Name,
				"description":  d.Description,
				"input_schema": schemaToJSON(d.Parameters),
			})
		}
		body["tools"] = tools
	}
	return body
}

func anthropicMessages(contents []*genai.Content) []anthropicMessage {
	out := []anthropicMessage{}
	for _, c := range contents {
		role := c.Role
		if role == "model" {
			role = "assistant"
		}
		if role == "" {
			role = "user"
		}
		blocks := []any{}
		for _, p := range c.Parts {
			switch {
			case p.FunctionCall != nil:
				blocks = append(blocks, map[string]any{
					"type": "tool_use", "id": p.FunctionCall.ID,
					"name": p.FunctionCall.Name, "input": p.FunctionCall.Args,
				})
			case p.FunctionResponse != nil:
				blocks = append(blocks, map[string]any{
					"type": "tool_result", "tool_use_id": p.FunctionResponse.ID,
					"content": string(jsonBytes(p.FunctionResponse.Response)),
				})
			case p.Text != "":
				blocks = append(blocks, map[string]any{"type": "text", "text": p.Text})
			}
		}
		if len(blocks) == 0 {
			continue
		}
		out = append(out, anthropicMessage{Role: role, Content: blocks})
	}
	return out
}

func (m *anthropicLLM) GenerateContent(ctx context.Context, req *model.LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error] {
	return func(yield func(*model.LLMResponse, error) bool) {
		payload := jsonBytes(m.buildRequest(req, stream))
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, m.base+"/v1/messages", bytes.NewReader(payload))
		if err != nil {
			yield(nil, err)
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+m.cfg.APIKey)
		httpReq.Header.Set("x-api-key", m.cfg.APIKey)
		httpReq.Header.Set("anthropic-version", "2023-06-01")
		resp, err := m.client.Do(httpReq)
		if err != nil {
			yield(nil, err)
			return
		}
		if stream && resp.StatusCode < 400 {
			m.streamResponse(resp, yield)
			return
		}
		data, err := readBody(resp)
		if err != nil {
			yield(nil, err)
			return
		}
		out, err := parseAnthropicMessage(data)
		if err != nil {
			yield(nil, err)
			return
		}
		yield(out, nil)
	}
}

func (m *anthropicLLM) streamResponse(resp *http.Response, yield func(*model.LLMResponse, error) bool) {
	defer resp.Body.Close()
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var text strings.Builder
	finish := genai.FinishReasonStop
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var ev struct {
			Type  string `json:"type"`
			Delta struct {
				Type       string `json:"type"`
				Text       string `json:"text"`
				StopReason string `json:"stop_reason"`
			} `json:"delta"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
		}
		if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &ev); err != nil {
			continue
		}
		switch ev.Type {
		case "content_block_delta":
			if ev.Delta.Text != "" {
				text.WriteString(ev.Delta.Text)
				if !yield(&model.LLMResponse{
					Content: genai.NewContentFromText(ev.Delta.Text, genai.RoleModel),
					Partial: true,
				}, nil) {
					return
				}
			}
		case "message_delta":
			if ev.Delta.StopReason == "tool_use" {
				finish = genai.FinishReasonStop
			}
		}
	}
	// Tool calls arrive as their own blocks; a streaming turn ends here and the
	// agent loop will re-issue the request if it needs the tools executed.
	if text.Len() > 0 {
		yield(&model.LLMResponse{
			Content:      genai.NewContentFromText(text.String(), genai.RoleModel),
			TurnComplete: true,
			FinishReason: finish,
		}, nil)
	}
}

func parseAnthropicMessage(data []byte) (*model.LLMResponse, error) {
	var msg struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			InputTokens  int32 `json:"input_tokens"`
			OutputTokens int32 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("cannot parse model response: %w", err)
	}
	parts := []*genai.Part{}
	for _, c := range msg.Content {
		switch c.Type {
		case "text":
			if c.Text != "" {
				parts = append(parts, &genai.Part{Text: c.Text})
			}
		case "tool_use":
			args := map[string]any{}
			if len(c.Input) > 0 {
				_ = json.Unmarshal(c.Input, &args)
			}
			parts = append(parts, &genai.Part{FunctionCall: &genai.FunctionCall{ID: c.ID, Name: c.Name, Args: args}})
		}
	}
	return &model.LLMResponse{
		Content:      &genai.Content{Role: genai.RoleModel, Parts: parts},
		TurnComplete: true,
		FinishReason: genai.FinishReasonStop,
		UsageMetadata: &genai.GenerateContentResponseUsageMetadata{
			PromptTokenCount:     msg.Usage.InputTokens,
			CandidatesTokenCount: msg.Usage.OutputTokens,
		},
	}, nil
}

// --- OpenAI (chat completions) ---------------------------------------------

type openaiLLM struct {
	cfg    Config
	base   string
	client *http.Client
}

func (m *openaiLLM) Name() string { return m.cfg.Model }

func (m *openaiLLM) GenerateContent(ctx context.Context, req *model.LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error] {
	return func(yield func(*model.LLMResponse, error) bool) {
		body := map[string]any{
			"model":    firstNonEmpty(req.Model, m.cfg.Model),
			"messages": openaiMessages(req),
		}
		if sys := systemText(req); sys != "" {
			body["messages"] = append([]map[string]any{{"role": "system", "content": sys}}, body["messages"].([]map[string]any)...)
		}
		if decls := toolDecls(req); len(decls) > 0 {
			tools := make([]map[string]any, 0, len(decls))
			for _, d := range decls {
				tools = append(tools, map[string]any{
					"type": "function",
					"function": map[string]any{
						"name":        d.Name,
						"description": d.Description,
						"parameters":  schemaToJSON(d.Parameters),
					},
				})
			}
			body["tools"] = tools
		}
		payload := jsonBytes(body)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, m.base+"/chat/completions", bytes.NewReader(payload))
		if err != nil {
			yield(nil, err)
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+m.cfg.APIKey)
		resp, err := m.client.Do(httpReq)
		if err != nil {
			yield(nil, err)
			return
		}
		data, err := readBody(resp)
		if err != nil {
			yield(nil, err)
			return
		}
		out, err := parseOpenAI(data)
		if err != nil {
			yield(nil, err)
			return
		}
		yield(out, nil)
	}
}

func openaiMessages(req *model.LLMRequest) []map[string]any {
	out := []map[string]any{}
	for _, c := range req.Contents {
		role := c.Role
		if role == "model" {
			role = "assistant"
		}
		if role == "" {
			role = "user"
		}
		text := ""
		calls := []map[string]any{}
		for _, p := range c.Parts {
			switch {
			case p.Text != "":
				text += p.Text
			case p.FunctionCall != nil:
				calls = append(calls, map[string]any{
					"id": p.FunctionCall.ID, "type": "function",
					"function": map[string]any{"name": p.FunctionCall.Name, "arguments": string(jsonBytes(p.FunctionCall.Args))},
				})
			case p.FunctionResponse != nil:
				out = append(out, map[string]any{
					"role": "tool", "tool_call_id": p.FunctionResponse.ID,
					"content": string(jsonBytes(p.FunctionResponse.Response)),
				})
			}
		}
		if text == "" && len(calls) == 0 {
			continue
		}
		msg := map[string]any{"role": role, "content": text}
		if len(calls) > 0 {
			msg["tool_calls"] = calls
		}
		out = append(out, msg)
	}
	return out
}

func parseOpenAI(data []byte) (*model.LLMResponse, error) {
	var res struct {
		Choices []struct {
			Message struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, fmt.Errorf("cannot parse model response: %w", err)
	}
	parts := []*genai.Part{}
	if len(res.Choices) > 0 {
		msg := res.Choices[0].Message
		if msg.Content != "" {
			parts = append(parts, &genai.Part{Text: msg.Content})
		}
		for _, tc := range msg.ToolCalls {
			args := map[string]any{}
			if tc.Function.Arguments != "" {
				_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
			}
			parts = append(parts, &genai.Part{FunctionCall: &genai.FunctionCall{ID: tc.ID, Name: tc.Function.Name, Args: args}})
		}
	}
	return &model.LLMResponse{
		Content:      &genai.Content{Role: genai.RoleModel, Parts: parts},
		TurnComplete: true,
		FinishReason: genai.FinishReasonStop,
	}, nil
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}
