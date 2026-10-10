// Package hooks runs pre-request and post-response scripts as child
// processes. The context is written to the process's stdin as JSON and the
// result is read back from stdout as JSON — so hooks can be written in any
// language (shell, Python, Node, Go, …).
package hooks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"curlui/server/internal/models"
)

const maxOutput = 8 << 20 // 8 MiB per stream

// Input is the JSON document written to a hook's stdin.
type Input struct {
	Phase       string             `json:"phase"`
	Request     *models.RequestDef `json:"request,omitempty"`
	Response    *ResponseView      `json:"response,omitempty"`
	Variables   map[string]string  `json:"variables"`
	Environment *EnvView           `json:"environment,omitempty"`
}

// ResponseView is a trimmed response for post-response hooks.
type ResponseView struct {
	Status     int                 `json:"status"`
	StatusText string              `json:"statusText"`
	Headers    map[string][]string `json:"headers"`
	Body       string              `json:"body"`
	Duration   int64               `json:"duration"`
}

// EnvView describes the selected environment.
type EnvView struct {
	Name      string            `json:"name"`
	Variables map[string]string `json:"variables"`
}

// Output is the JSON document a hook may write to stdout.
type Output struct {
	// Request is an optional (partial) request patch applied before sending.
	Request   map[string]any    `json:"request,omitempty"`
	Variables map[string]string `json:"variables,omitempty"`
	Log       string            `json:"log,omitempty"`
	Abort     bool              `json:"abort,omitempty"`
	Error     string            `json:"error,omitempty"`
	Tests     []models.HookTest `json:"tests,omitempty"`
}

// Result is the raw outcome of running a hook.
type Result struct {
	Output   Output
	Stdout   string
	Stderr   string
	ExitCode int
	Duration int64
	Err      error
}

// Run executes a hook. It always returns a Result; check Result.Err.
func Run(ctx context.Context, hook models.Hook, input Input) Result {
	res := Result{ExitCode: -1}

	command := strings.TrimSpace(hook.Command)
	if command == "" {
		res.Err = fmt.Errorf("hook command is empty")
		return res
	}

	timeout := time.Duration(hook.Timeout) * time.Millisecond
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", "/C", command)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", command)
	}

	env := os.Environ()
	for _, kv := range hook.Env {
		if kv.Enabled && kv.Key != "" {
			env = append(env, kv.Key+"="+kv.Value)
		}
	}
	cmd.Env = env

	payload, err := json.Marshal(input)
	if err != nil {
		res.Err = err
		return res
	}
	cmd.Stdin = bytes.NewReader(payload)

	var stdout, stderr limitedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	runErr := cmd.Run()
	res.Duration = time.Since(start).Milliseconds()
	res.Stdout = stdout.String()
	res.Stderr = stderr.String()
	if cmd.ProcessState != nil {
		res.ExitCode = cmd.ProcessState.ExitCode()
	}
	if runErr != nil {
		if ctx.Err() == context.DeadlineExceeded {
			res.Err = fmt.Errorf("hook timed out after %s", timeout)
		} else {
			res.Err = runErr
		}
	}

	if trimmed := strings.TrimSpace(res.Stdout); trimmed != "" {
		var out Output
		if json.Unmarshal([]byte(trimmed), &out) == nil {
			res.Output = out
		} else {
			// Non-JSON stdout is surfaced as a log line.
			res.Output.Log = trimmed
		}
	}
	return res
}

// ApplyRequest deep-merges a partial request patch returned by a hook onto the
// current request definition, so scripts only need to emit the fields they
// change.
func ApplyRequest(current models.RequestDef, patch map[string]any) (models.RequestDef, error) {
	if len(patch) == 0 {
		return current, nil
	}
	baseBytes, err := json.Marshal(current)
	if err != nil {
		return current, err
	}
	var base map[string]any
	if err := json.Unmarshal(baseBytes, &base); err != nil {
		return current, err
	}
	merged := mergeMap(base, patch)
	outBytes, err := json.Marshal(merged)
	if err != nil {
		return current, err
	}
	var out models.RequestDef
	if err := json.Unmarshal(outBytes, &out); err != nil {
		return current, err
	}
	return out, nil
}

func mergeMap(base, patch map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(patch))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range patch {
		if pm, ok := v.(map[string]any); ok {
			if bm, ok := out[k].(map[string]any); ok {
				out[k] = mergeMap(bm, pm)
				continue
			}
		}
		out[k] = v
	}
	return out
}

type limitedBuffer struct {
	buf bytes.Buffer
	n   int
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	if l.n >= maxOutput {
		return len(p), nil
	}
	room := maxOutput - l.n
	if len(p) > room {
		p = p[:room]
	}
	m, err := l.buf.Write(p)
	l.n += m
	return m, err
}

func (l *limitedBuffer) String() string { return l.buf.String() }

func (l *limitedBuffer) Len() int { return l.buf.Len() }
