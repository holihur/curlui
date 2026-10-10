package models

import (
	"crypto/rand"
	"encoding/hex"
)

// NewID returns a short random hex identifier.
func NewID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "000000000000000000000000"
	}
	return hex.EncodeToString(b)
}

// KeyValue is a generic enabled/disabled key/value row used for params,
// headers, form fields and environment variables.
type KeyValue struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
	Desc    string `json:"description,omitempty"`
	// Type is used by form-data fields: "text" (default) or "file".
	Type string `json:"type,omitempty"`
	// FilePath is a server-local path for file fields / binary bodies.
	FilePath string `json:"filePath,omitempty"`
}

// Body describes a request body.
type Body struct {
	// Type is one of: none, json, text, xml, html, form-urlencoded,
	// form-data, binary.
	Type     string     `json:"type"`
	Raw      string     `json:"raw"`
	Form     []KeyValue `json:"form"`
	FilePath string     `json:"filePath,omitempty"`
}

// Auth describes request authentication.
type Auth struct {
	// Type is one of: none, basic, bearer, apikey.
	Type     string `json:"type"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Token    string `json:"token,omitempty"`
	Key      string `json:"key,omitempty"`
	Value    string `json:"value,omitempty"`
	// AddTo is "header" (default) or "query" for apikey.
	AddTo string `json:"addTo,omitempty"`
}

// Options controls how the request is executed.
type Options struct {
	Timeout         int    `json:"timeout"`         // milliseconds
	FollowRedirects bool   `json:"followRedirects"` // default true
	VerifyTLS       bool   `json:"verifyTLS"`       // default true
	Proxy           string `json:"proxy,omitempty"`
	MaxRedirects    int    `json:"maxRedirects,omitempty"`
}

// RequestDef is a saved/edited HTTP request.
type RequestDef struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Method  string     `json:"method"`
	URL     string     `json:"url"`
	Params  []KeyValue `json:"params"`
	Headers []KeyValue `json:"headers"`
	Body    Body       `json:"body"`
	Auth    Auth       `json:"auth"`
	Options Options    `json:"options"`
	Scripts Scripts    `json:"scripts"`
	// DependsOn lists collection node IDs of parent requests that must run
	// before this one. Their response values can be referenced via Extract.
	DependsOn []string `json:"dependsOn,omitempty"`
	// Extract pulls values out of this request's response into named
	// variables, available to child requests as {{name}}.
	Extract    []ExtractRule `json:"extract,omitempty"`
	Assertions []Assertion   `json:"assertions,omitempty"`
}

// Assertion is a single response check.
type Assertion struct {
	ID       string `json:"id"`
	Enabled  bool   `json:"enabled"`
	Source   string `json:"source"`   // status | time | header | body | jsonpath
	Key      string `json:"key"`      // header name or JSON path
	Operator string `json:"operator"` // eq | ne | contains | gt | lt | exists | matches
	Value    string `json:"value"`
}

// AssertionResult is the outcome of one assertion.
type AssertionResult struct {
	ID      string `json:"id"`
	Passed  bool   `json:"passed"`
	Message string `json:"message"`
}

// ExtractRule binds a response value (JSON path) to a variable name.
type ExtractRule struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Enabled bool   `json:"enabled"`
}

// Scripts holds the optional pre-request and post-response hooks.
type Scripts struct {
	Pre  Hook `json:"pre"`
	Post Hook `json:"post"`
}

// Hook is a shell command executed around a request. The request/response
// context is written to its stdin as JSON; it replies on stdout with JSON.
type Hook struct {
	Enabled bool       `json:"enabled"`
	Command string     `json:"command"`
	Timeout int        `json:"timeout,omitempty"` // ms, default 10000
	Env     []KeyValue `json:"env,omitempty"`     // extra environment variables
}

// WithDefaults fills in zero-value options so the request can run.
func (r *RequestDef) WithDefaults() {
	if r.Method == "" {
		r.Method = "GET"
	}
	if r.Body.Type == "" {
		r.Body.Type = "none"
	}
	if r.Auth.Type == "" {
		r.Auth.Type = "none"
	}
	if r.Options.Timeout <= 0 {
		r.Options.Timeout = 30000
	}
	if r.Options.MaxRedirects <= 0 {
		r.Options.MaxRedirects = 10
	}
}

// Environment is a named set of variables substituted as {{name}}.
type Environment struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Variables []KeyValue `json:"variables"`
}

// Node is an item in the collections tree. Folders may carry their own
// variables and an optional "setup" request whose extracted response values
// are inherited by every descendant request.
type Node struct {
	ID       string      `json:"id"`
	Type     string      `json:"type"` // folder | request
	Name     string      `json:"name"`
	Request  *RequestDef `json:"request,omitempty"`
	Children []*Node     `json:"children,omitempty"`

	// Folder-only fields (hierarchy).
	Variables   []KeyValue    `json:"variables,omitempty"`
	SetupNodeID string        `json:"setupNodeId,omitempty"`
	Extract     []ExtractRule `json:"extract,omitempty"`
}

// HistoryEntry records an executed request.
type HistoryEntry struct {
	ID         string     `json:"id"`
	Request    RequestDef `json:"request"`
	Status     int        `json:"status"`
	StatusText string     `json:"statusText"`
	Duration   int64      `json:"duration"`
	Size       int        `json:"size"`
	Error      string     `json:"error,omitempty"`
	EnvID      string     `json:"envId,omitempty"`
	CreatedAt  int64      `json:"createdAt"`
}

// Timing holds phase durations in milliseconds.
type Timing struct {
	DNS       int64 `json:"dns"`
	Connect   int64 `json:"connect"`
	TLS       int64 `json:"tls"`
	FirstByte int64 `json:"firstByte"`
	Total     int64 `json:"total"`
}

// Cookie is a response cookie.
type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Expires  string `json:"expires,omitempty"`
	HTTPOnly bool   `json:"httpOnly"`
	Secure   bool   `json:"secure"`
}

// SentRequest is an echo of what was actually sent after variable
// substitution — handy for the UI.
type SentRequest struct {
	Method  string              `json:"method"`
	URL     string              `json:"url"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body"`
}

// HookTest is a single assertion produced by a post-response hook.
type HookTest struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
}

// HookResult records the outcome of running one hook.
type HookResult struct {
	Phase    string            `json:"phase"` // pre | post
	Command  string            `json:"command"`
	Ran      bool              `json:"ran"`
	ExitCode int               `json:"exitCode"`
	Stdout   string            `json:"stdout,omitempty"`
	Stderr   string            `json:"stderr,omitempty"`
	Error    string            `json:"error,omitempty"`
	Log      string            `json:"log,omitempty"`
	Tests    []HookTest        `json:"tests,omitempty"`
	Vars     map[string]string `json:"variables,omitempty"`
	Duration int64             `json:"duration"`
}

// Response is the result of executing a request.
type Response struct {
	Status      int                 `json:"status"`
	StatusText  string              `json:"statusText"`
	Headers     map[string][]string `json:"headers"`
	Cookies     []Cookie            `json:"cookies"`
	Body        string              `json:"body"`
	BodyBase64  string              `json:"bodyBase64,omitempty"`
	ContentType string              `json:"contentType"`
	IsBinary    bool                `json:"isBinary"`
	Size        int                 `json:"size"`
	Duration    int64               `json:"duration"`
	Timing      Timing              `json:"timing"`
	Request     SentRequest         `json:"request"`
	Hooks       []HookResult        `json:"hooks,omitempty"`
	Assertions  []AssertionResult   `json:"assertions,omitempty"`
	Error       string              `json:"error,omitempty"`
}
