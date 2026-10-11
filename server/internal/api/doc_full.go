//go:build !core

package api

import (
	"fmt"
	"net/http"
	"strings"

	"curlui/server/internal/doc"
	"curlui/server/internal/models"
)

// exportDoc renders a collection to Markdown, HTML, Word or PDF, using the
// optional template query parameter or the saved docTemplate setting.
func (s *Server) exportDoc(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	format := strings.ToLower(r.URL.Query().Get("format"))
	tmpl := r.URL.Query().Get("template")
	if tmpl == "" {
		tmpl = s.db(r).Settings()["docTemplate"]
	}

	title := "API Documentation"
	var nodes []*models.Node
	if id != "" {
		n, ok := s.db(r).FindNode(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "node not found")
			return
		}
		nodes = []*models.Node{n}
		title = n.Name
	} else {
		nodes = s.db(r).Collections()
	}

	model := doc.BuildModel(title, nodes)

	var (
		data []byte
		err  error
		ct   string
		ext  string
	)
	switch format {
	case "html":
		data, err = doc.RenderHTML(model, tmpl)
		ct, ext = "text/html; charset=utf-8", "html"
	case "word", "doc", "docx":
		data, err = doc.RenderHTML(model, tmpl)
		ct, ext = "application/msword", "doc"
	case "pdf":
		data, err = doc.RenderPDF(model)
		ct, ext = "application/pdf", "pdf"
	default:
		data, err = doc.RenderMarkdown(model, tmpl)
		ct, ext = "text/markdown; charset=utf-8", "md"
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	base := "curlui-docs"
	if id != "" {
		if n, ok := s.db(r).FindNode(id); ok {
			base = safeFilename(n.Name)
		}
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", base+"."+ext))
	_, _ = w.Write(data)
}

func safeFilename(name string) string {
	repl := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "*", "-", "?", "-", "\"", "-", "<", "-", ">", "-", "|", "-")
	out := strings.TrimSpace(repl.Replace(name))
	if out == "" {
		return "curlui-docs"
	}
	return out
}

// registerDocRoutes mounts the documentation export endpoint.
func (s *Server) registerDocRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/export/doc", s.exportDoc)
}
