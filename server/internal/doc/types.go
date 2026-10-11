// Package doc types shared by the full and core builds.
package doc

// KV is a rendered key/value pair.
type KV struct {
	Name    string
	Value   string
	Enabled bool
}

// Request is one documented request.
type Request struct {
	Name        string
	Method      string
	URL         string
	Description string
	Params      []KV
	Headers     []KV
	Body        string
}

// Model is the template context.
type Model struct {
	Title       string
	GeneratedAt string
	Requests    []Request
}
