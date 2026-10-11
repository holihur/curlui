package ai

import (
	"context"
	"fmt"

	"google.golang.org/adk/agent"
	"google.golang.org/adk/agent/llmagent"
	"google.golang.org/adk/runner"
	"google.golang.org/adk/session"
	"google.golang.org/genai"
)

const instruction = `You are the built-in assistant of curlui, a self-hosted HTTP client.

You can inspect and operate the user's workspace with your tools:
- list_collections / get_request: discover saved requests and folders
- list_environments: see variables
- list_history: see what was sent recently
- send_request / run_saved_request: actually perform HTTP calls
- create_request: save a new request

Rules:
- Prefer run_saved_request or get_request over inventing URLs.
- Always report the HTTP status and a short summary of the body.
- If a tool is refused because of a missing scope, explain that the current
  access token does not allow that action and stop; never try to work around it.
- Keep answers short and concrete. Use Markdown.`

// Event is one step of an assistant turn.
type Event struct {
	Text      string `json:"text,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Tool      string `json:"tool,omitempty"`
	Args      any    `json:"args,omitempty"`
	Error     string `json:"error,omitempty"`
	Final     bool   `json:"final,omitempty"`
}

// Agent runs an ADK agent bound to an in-memory session service. Tools are
// built from the caller's scopes, so the agent inherits exactly the caller's
// permissions.
type Agent struct {
	runner *runner.Runner
}

// NewAgent builds the assistant for one BYOK configuration and scope set.
func NewAgent(cfg Config, backend Backend, scopes []string) (*Agent, error) {
	llm, err := NewLLM(cfg)
	if err != nil {
		return nil, err
	}
	tools, err := BuildTools(backend, scopes)
	if err != nil {
		return nil, err
	}
	ag, err := llmagent.New(llmagent.Config{
		Name:        "curlui",
		Description: "curlui workspace assistant",
		Model:       llm,
		Tools:       tools,
		Instruction: instruction,
	})
	if err != nil {
		return nil, fmt.Errorf("cannot create the agent: %w", err)
	}
	r, err := runner.New(runner.Config{
		AppName:           "curlui",
		Agent:             ag,
		SessionService:    session.InMemoryService(),
		AutoCreateSession: true,
	})
	if err != nil {
		return nil, fmt.Errorf("cannot create the runner: %w", err)
	}
	return &Agent{runner: r}, nil
}

// Chat runs one user turn and streams each step to emit.
func (a *Agent) Chat(ctx context.Context, userID, sessionID, message string, emit func(Event) error) error {
	msg := genai.NewContentFromText(message, genai.RoleUser)
	for ev, err := range a.runner.Run(ctx, userID, sessionID, msg, agent.RunConfig{}) {
		if err != nil {
			return err
		}
		if ev.Content == nil {
			continue
		}
		for _, p := range ev.Content.Parts {
			if p.Text != "" {
				if err := emit(Event{Text: p.Text}); err != nil {
					return err
				}
			}
			if p.FunctionCall != nil {
				if err := emit(Event{Tool: p.FunctionCall.Name, Args: p.FunctionCall.Args}); err != nil {
					return err
				}
			}
		}
	}
	return emit(Event{Final: true})
}
