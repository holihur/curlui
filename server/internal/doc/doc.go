//go:build !core

// Package doc renders collections into documentation in Markdown, HTML, Word
// (.doc) or PDF, using either a built-in template or a user-provided one.
package doc

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"
	"time"

	"curlui/server/internal/models"
)

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

// BuildModel flattens a collection tree into a document model.
func BuildModel(title string, nodes []*models.Node) Model {
	m := Model{Title: title, GeneratedAt: time.Now().Format("2006-01-02 15:04")}
	var walk func(prefix string, ns []*models.Node)
	walk = func(prefix string, ns []*models.Node) {
		for _, n := range ns {
			if n.Type == "request" && n.Request != nil {
				r := n.Request
				req := Request{Name: prefix + n.Name, Method: r.Method, URL: r.URL, Body: r.Body.Raw}
				for _, p := range r.Params {
					if p.Key != "" {
						req.Params = append(req.Params, KV{Name: p.Key, Value: p.Value, Enabled: p.Enabled})
					}
				}
				for _, h := range r.Headers {
					if h.Key != "" {
						req.Headers = append(req.Headers, KV{Name: h.Key, Value: h.Value, Enabled: h.Enabled})
					}
				}
				m.Requests = append(m.Requests, req)
			}
			if len(n.Children) > 0 {
				walk(prefix+n.Name+" / ", n.Children)
			}
		}
	}
	walk("", nodes)
	return m
}

// DefaultMarkdown is the built-in Markdown template.
const DefaultMarkdown = `# {{.Title}}

_Generated {{.GeneratedAt}}_

{{range .Requests -}}
## {{.Name}}

` + "`{{.Method}} {{.URL}}`" + `

{{if .Params -}}
**Query parameters**

| Name | Value |
| --- | --- |
{{range .Params}}| {{.Name}} | {{.Value}} |
{{end}}
{{end -}}
{{if .Headers -}}
**Headers**

| Name | Value |
| --- | --- |
{{range .Headers}}| {{.Name}} | {{.Value}} |
{{end}}
{{end -}}
{{if .Body -}}
**Body**

` + "```" + `
{{.Body}}
` + "```" + `
{{end}}
{{end -}}
`

// DefaultHTML is the built-in HTML body template (wrapped by RenderHTML).
const DefaultHTML = `<h1>{{.Title}}</h1>
<p class="meta">Generated {{.GeneratedAt}}</p>
{{range .Requests -}}
<section>
  <h2>{{.Name}}</h2>
  <pre class="req">{{.Method}} {{.URL}}</pre>
  {{if .Params -}}
  <h3>Query parameters</h3>
  <table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>
  {{range .Params}}<tr><td>{{.Name}}</td><td>{{.Value}}</td></tr>{{end}}
  </tbody></table>
  {{end -}}
  {{if .Headers -}}
  <h3>Headers</h3>
  <table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>
  {{range .Headers}}<tr><td>{{.Name}}</td><td>{{.Value}}</td></tr>{{end}}
  </tbody></table>
  {{end -}}
  {{if .Body -}}
  <h3>Body</h3>
  <pre>{{.Body}}</pre>
  {{end -}}
</section>
{{end -}}`

const htmlShell = `<!doctype html>
<html><head><meta charset="utf-8"><title>%s</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1f2328;line-height:1.55}
 h1{border-bottom:2px solid #eaecef;padding-bottom:.3em}
 h2{margin-top:1.4em}
 h3{margin:.8em 0 .3em;font-size:100%%}
 .meta{color:#6a737d;font-size:90%%}
 pre{background:#f6f8fa;padding:10px 12px;border-radius:6px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:90%%}
 .req{background:#eef2ff;color:#1d4ed8}
 table{border-collapse:collapse;width:100%%;font-size:92%%}
 th,td{border:1px solid #eaecef;padding:6px 10px;text-align:left}
 th{background:#f6f8fa}
 section{margin-bottom:24px}
</style></head><body>
%s
</body></html>`

func renderTemplate(tmplText string, model Model) (string, error) {
	t, err := template.New("doc").Parse(tmplText)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, model); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// RenderMarkdown renders the model to Markdown.
func RenderMarkdown(model Model, tmplText string) ([]byte, error) {
	if strings.TrimSpace(tmplText) == "" {
		tmplText = DefaultMarkdown
	}
	out, err := renderTemplate(tmplText, model)
	return []byte(out), err
}

// RenderHTML renders the model to a complete HTML document.
func RenderHTML(model Model, tmplText string) ([]byte, error) {
	if strings.TrimSpace(tmplText) == "" {
		tmplText = DefaultHTML
	}
	body, err := renderTemplate(tmplText, model)
	if err != nil {
		return nil, err
	}
	return []byte(fmt.Sprintf(htmlShell, model.Title, body)), nil
}
