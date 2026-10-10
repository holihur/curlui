package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	curlpkg "curlui/server/internal/curl"
	"curlui/server/internal/jsonpath"
	"curlui/server/internal/models"
	"curlui/server/internal/openapi"
	"curlui/server/internal/store"
	"curlui/server/internal/variables"
)

// Server wires the HTTP handlers to a store and executor.
type Server struct {
	store    *store.Store
	executor *curlpkg.Executor
}

// New returns a new API server.
func New(st *store.Store) *Server {
	return &Server{
		store:    st,
		executor: &curlpkg.Executor{AllowPrivate: true},
	}
}

// Handler returns the fully configured http.Handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("POST /api/send", s.send)

	mux.HandleFunc("GET /api/collections", s.listCollections)
	mux.HandleFunc("POST /api/collections", s.createNode)
	mux.HandleFunc("PUT /api/collections/{id}", s.updateNode)
	mux.HandleFunc("PUT /api/collections/{id}/folder", s.updateFolder)
	mux.HandleFunc("DELETE /api/collections/{id}", s.deleteNode)
	mux.HandleFunc("POST /api/collections/{id}/move", s.moveNode)
	mux.HandleFunc("POST /api/collections/{id}/duplicate", s.duplicateNode)

	mux.HandleFunc("GET /api/history", s.listHistory)
	mux.HandleFunc("DELETE /api/history", s.clearHistory)
	mux.HandleFunc("DELETE /api/history/{id}", s.deleteHistory)

	mux.HandleFunc("GET /api/environments", s.listEnvironments)
	mux.HandleFunc("POST /api/environments", s.saveEnvironment)
	mux.HandleFunc("DELETE /api/environments/{id}", s.deleteEnvironment)

	mux.HandleFunc("GET /api/settings", s.getSettings)
	mux.HandleFunc("POST /api/settings", s.saveSettings)

	mux.HandleFunc("POST /api/curl/parse", s.parseCurl)
	mux.HandleFunc("POST /api/curl/generate", s.generateCurl)

	mux.HandleFunc("POST /api/openapi/parse", s.parseOpenAPI)
	mux.HandleFunc("POST /api/collections/import", s.importCollections)

	return withCORS(withLogging(mux))
}

// --- middleware ------------------------------------------------------------

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
	})
}

// --- helpers ---------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	if err := enc.Encode(v); err != nil {
		log.Printf("encode error: %v", err)
	}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decode(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// --- handlers --------------------------------------------------------------

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "time": time.Now().Unix()})
}

type sendPayload struct {
	Request   models.RequestDef   `json:"request"`
	EnvID     string              `json:"envId"`
	Variables map[string]string   `json:"variables"`
	Parents   []models.RequestDef `json:"parents"`
}

type sendResult struct {
	Response  models.Response   `json:"response"`
	HistoryID string            `json:"historyId"`
	Variables map[string]string `json:"variables,omitempty"`
}

func (s *Server) send(w http.ResponseWriter, r *http.Request) {
	var payload sendPayload
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	// Resolve variables from the selected environment.
	envSet := variables.Set{}
	if payload.EnvID != "" {
		for _, env := range s.store.Environments() {
			if env.ID == payload.EnvID {
				envSet = variables.FromEnvironment(&env)
				break
			}
		}
	}
	if len(payload.Variables) > 0 {
		envSet = envSet.Merge(variables.Set(payload.Variables))
	}

	// Run parent (ancestor) requests first so their responses can be
	// referenced by this request. Values are extracted into variables.
	for _, parent := range payload.Parents {
		parentResp := s.executor.Execute(r.Context(), parent, envSet)
		for _, rule := range parent.Extract {
			if !rule.Enabled || rule.Name == "" {
				continue
			}
			if v, ok := jsonpath.Get([]byte(parentResp.Body), rule.Path); ok {
				envSet = envSet.Merge(variables.Set{rule.Name: stringifyValue(v)})
			}
		}
		for _, h := range parentResp.Hooks {
			if len(h.Vars) > 0 {
				envSet = envSet.Merge(variables.Set(h.Vars))
			}
		}
	}

	resp := s.executor.Execute(r.Context(), payload.Request, envSet)

	entry := models.HistoryEntry{
		ID:         models.NewID(),
		Request:    payload.Request,
		Status:     resp.Status,
		StatusText: resp.StatusText,
		Duration:   resp.Duration,
		Size:       resp.Size,
		Error:      resp.Error,
		EnvID:      payload.EnvID,
		CreatedAt:  time.Now().UnixMilli(),
	}
	if err := s.store.AddHistory(entry); err != nil {
		log.Printf("history save failed: %v", err)
	}

	writeJSON(w, http.StatusOK, sendResult{Response: resp, HistoryID: entry.ID, Variables: envSet})
}

func stringifyValue(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case nil:
		return ""
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(s)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprint(v)
		}
		return string(b)
	}
}

// --- collections -----------------------------------------------------------

type createNodePayload struct {
	ParentID string             `json:"parentId"`
	Type     string             `json:"type"`
	Name     string             `json:"name"`
	Request  *models.RequestDef `json:"request"`
}

func (s *Server) listCollections(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"collections": s.store.Collections()})
}

func (s *Server) createNode(w http.ResponseWriter, r *http.Request) {
	var payload createNodePayload
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if payload.Type == "" {
		payload.Type = "request"
	}
	node := &models.Node{ID: models.NewID(), Type: payload.Type, Name: payload.Name}
	if payload.Type == "request" {
		req := payload.Request
		if req == nil {
			req = &models.RequestDef{Method: "GET", Body: models.Body{Type: "none"}, Auth: models.Auth{Type: "none"},
				Options: models.Options{Timeout: 30000, FollowRedirects: true, VerifyTLS: true, MaxRedirects: 10}}
		}
		req.ID = node.ID
		node.Request = req
	}
	saved, err := s.store.AddNode(payload.ParentID, node)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

type updateNodePayload struct {
	Name    string             `json:"name"`
	Type    string             `json:"type"`
	Request *models.RequestDef `json:"request"`
}

func (s *Server) updateNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var payload updateNodePayload
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	node, err := s.store.UpdateNode(id, &models.Node{Name: payload.Name, Type: payload.Type, Request: payload.Request})
	if err != nil {
		writeErr(w, http.StatusNotFound, "node not found")
		return
	}
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) deleteNode(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteNode(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, "node not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) updateFolder(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Variables   []models.KeyValue    `json:"variables"`
		SetupNodeID string               `json:"setupNodeId"`
		Extract     []models.ExtractRule `json:"extract"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	node, err := s.store.SetFolderConfig(r.PathValue("id"), payload.Variables, payload.SetupNodeID, payload.Extract)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, node)
}

func (s *Server) duplicateNode(w http.ResponseWriter, r *http.Request) {
	node, err := s.store.DuplicateNode(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "node not found")
		return
	}
	writeJSON(w, http.StatusCreated, node)
}

func (s *Server) moveNode(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ParentID  string `json:"parentId"`
		SiblingID string `json:"siblingId"`
		Position  string `json:"position"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := s.store.MoveNode(r.PathValue("id"), payload.ParentID, payload.SiblingID, payload.Position); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- history ---------------------------------------------------------------

func (s *Server) listHistory(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"history": s.store.History()})
}

func (s *Server) clearHistory(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.ClearHistory(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) deleteHistory(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteHistory(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, "entry not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- environments ----------------------------------------------------------

func (s *Server) listEnvironments(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"environments": s.store.Environments()})
}

func (s *Server) saveEnvironment(w http.ResponseWriter, r *http.Request) {
	var env models.Environment
	if err := decode(r, &env); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	saved, err := s.store.SaveEnvironment(env)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteEnvironment(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteEnvironment(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, "environment not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- settings --------------------------------------------------------------

func (s *Server) getSettings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.store.Settings())
}

func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := s.store.SaveSettings(in); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.store.Settings())
}

// --- curl import/export ----------------------------------------------------

func (s *Server) parseCurl(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Command string `json:"command"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if strings.TrimSpace(payload.Command) == "" {
		writeErr(w, http.StatusBadRequest, "command is empty")
		return
	}
	req, err := curlpkg.Parse(payload.Command)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, req)
}

func (s *Server) generateCurl(w http.ResponseWriter, r *http.Request) {
	var req models.RequestDef
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"command": curlpkg.Generate(req)})
}

// --- OpenAPI / Swagger import ---------------------------------------------

func (s *Server) parseOpenAPI(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL     string            `json:"url"`
		Content string            `json:"content"`
		Headers map[string]string `json:"headers"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	var raw []byte
	switch {
	case strings.TrimSpace(payload.URL) != "":
		data, err := openapi.Fetch(strings.TrimSpace(payload.URL), payload.Headers)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		raw = data
	case strings.TrimSpace(payload.Content) != "":
		raw = []byte(payload.Content)
	default:
		writeErr(w, http.StatusBadRequest, "provide either a spec URL or content")
		return
	}

	result, err := openapi.Parse(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) importCollections(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ParentID string         `json:"parentId"`
		Nodes    []*models.Node `json:"nodes"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if len(payload.Nodes) == 0 {
		writeErr(w, http.StatusBadRequest, "no nodes to import")
		return
	}
	saved, count, err := s.store.ImportNodes(payload.ParentID, payload.Nodes)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"collections": saved, "count": count})
}
