package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	curlpkg "curlui/server/internal/curl"
	"curlui/server/internal/jsonpath"
	"curlui/server/internal/models"
	"curlui/server/internal/openapi"
	"curlui/server/internal/proxy"
	"curlui/server/internal/scheduler"
	"curlui/server/internal/store"
	"curlui/server/internal/update"
	"curlui/server/internal/variables"
)

// Server wires the HTTP handlers to a store and executor.
type Server struct {
	store     *store.Store
	executor  *curlpkg.Executor
	scheduler *scheduler.Scheduler
	version   string

	mu           sync.Mutex
	mockHits     map[string][]models.MockHit
	proxyAddr    string
	proxyRunning bool
	proxyCA      []byte
	interceptor  *proxy.Interceptor
}

// SetInterceptor wires the proxy breakpoint controller.
func (s *Server) SetInterceptor(i *proxy.Interceptor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.interceptor = i
}

// SetProxy records whether the capture proxy is running.
func (s *Server) SetProxy(addr string, running bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.proxyAddr = addr
	s.proxyRunning = running
}

// SetProxyCA stores the CA certificate offered to clients for HTTPS interception.
func (s *Server) SetProxyCA(pem []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.proxyCA = pem
}

// --- Backend implementation for the MCP server -----------------------------

// Execute runs a request and returns its response.
func (s *Server) Execute(ctx context.Context, req models.RequestDef, envID string, vars map[string]string, parents []models.RequestDef, mock bool) models.Response {
	resp, _ := s.runRequest(ctx, sendPayload{Request: req, EnvID: envID, Variables: vars, Parents: parents, Mock: mock})
	return resp
}

// Collections returns the saved tree.
func (s *Server) Collections() []*models.Node { return s.store.Collections() }

// Environments returns the saved environments.
func (s *Server) Environments() []models.Environment { return s.store.Environments() }

// FindNode looks up a node by id.
func (s *Server) FindNode(id string) (*models.Node, bool) { return s.store.FindNode(id) }

// New returns a new API server.
func New(st *store.Store, version string) *Server {
	s := &Server{store: st, executor: &curlpkg.Executor{AllowPrivate: true}, mockHits: st.MockHits(), version: version}
	if s.mockHits == nil {
		s.mockHits = map[string][]models.MockHit{}
	}
	s.scheduler = scheduler.New(
		func(ctx context.Context, req models.RequestDef, envID string, vars map[string]string, parents []models.RequestDef, mock bool) models.Response {
			resp, _ := s.runRequest(ctx, sendPayload{Request: req, EnvID: envID, Variables: vars, Parents: parents, Mock: mock})
			return resp
		},
		func(jobs []models.ScheduleJob) { _ = st.SaveSchedules(jobs) },
		func(job models.ScheduleJob, res models.ScheduleResult) { s.notifyFailure(st, job, res) },
	)
	s.scheduler.Load(st.Schedules())
	return s
}

// notifyFailure POSTs a JSON payload to the configured webhook when a
// scheduled run fails.
func (s *Server) notifyFailure(st *store.Store, job models.ScheduleJob, res models.ScheduleResult) {
	url := strings.TrimSpace(st.Settings()["notifyWebhook"])
	if url == "" {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"job":    job.Name,
		"jobId":  job.ID,
		"method": job.Request.Method,
		"url":    job.Request.URL,
		"status": res.Status,
		"error":  res.Error,
		"at":     res.At,
	})
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		log.Printf("notify: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("notify failed: %v", err)
		return
	}
	_ = resp.Body.Close()
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

	mux.HandleFunc("GET /api/export", s.exportNodes)
	mux.HandleFunc("POST /api/batch", s.runBatch)
	mux.HandleFunc("POST /api/fuzz", s.runFuzz)

	mux.HandleFunc("GET /api/proxy", s.listProxy)
	mux.HandleFunc("POST /api/proxy/config", s.proxyConfig)
	mux.HandleFunc("GET /api/proxy/export", s.exportCaptures)
	mux.HandleFunc("POST /api/proxy/save", s.saveCaptures)
	mux.HandleFunc("GET /api/intercept", s.listIntercepts)
	mux.HandleFunc("POST /api/intercept/{id}", s.resolveIntercept)
	mux.HandleFunc("GET /api/proxy/ca", s.proxyCAHandler)
	mux.HandleFunc("DELETE /api/proxy", s.clearProxy)
	mux.HandleFunc("POST /api/proxy/{id}/replay", s.replayCapture)
	mux.HandleFunc("GET /api/update/check", s.checkUpdate)
	mux.HandleFunc("POST /api/update", s.applyUpdate)

	mux.HandleFunc("POST /api/schedule", s.createSchedule)
	mux.HandleFunc("GET /api/schedule", s.listSchedules)
	mux.HandleFunc("DELETE /api/schedule/{id}", s.deleteSchedule)
	mux.HandleFunc("POST /api/schedule/{id}/run", s.runSchedule)
	mux.HandleFunc("POST /api/schedule/{id}/cancel", s.cancelSchedule)
	mux.HandleFunc("GET /api/schedule/{id}/results", s.scheduleResults)

	// Public mock server: GET/POST/… /mock/{nodeId}
	mux.HandleFunc("/mock/", s.mockServer)
	mux.HandleFunc("GET /api/mock/{id}/hits", s.mockHitsHandler)

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
	Mock      bool                `json:"mock"`
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
	resp, envSet := s.runRequest(r.Context(), payload)
	writeJSON(w, http.StatusOK, sendResult{Response: resp, Variables: envSet})
}

// runRequest resolves variables, runs parent requests, executes the request and
// records it in history. Shared by the send handler and the scheduler.
func (s *Server) runRequest(ctx context.Context, payload sendPayload) (models.Response, variables.Set) {
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
		parentResp := s.executor.Execute(ctx, parent, envSet, false)
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

	resp := s.executor.Execute(ctx, payload.Request, envSet, payload.Mock)
	if payload.Mock {
		s.recordMockHit(payload.Request.ID, payload.Request.Method, payload.Request.URL, "editor")
	}

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

	return resp, envSet
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

// mockServer serves a saved request's mock response to any HTTP client.
//
//	GET/POST/... /mock/{nodeId}?example={mockName}
func (s *Server) mockServer(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/mock/"), "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	node, ok := s.store.FindNode(id)
	if !ok || node.Request == nil {
		http.Error(w, "mock not found", http.StatusNotFound)
		return
	}
	mock := firstMockOf(node.Request.Mocks, r.URL.Query().Get("example"))
	if mock == nil {
		http.Error(w, "no enabled mock for this request", http.StatusNotFound)
		return
	}
	if mock.DelayMs > 0 {
		select {
		case <-time.After(time.Duration(mock.DelayMs) * time.Millisecond):
		case <-r.Context().Done():
			return
		}
	}
	for _, h := range mock.Headers {
		if h.Enabled && h.Key != "" {
			w.Header().Add(h.Key, h.Value)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.Header().Set("X-Mock", "curlui")
	status := mock.Status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = io.WriteString(w, mock.Body)
	s.recordMockHit(id, r.Method, r.URL.Path, "server")
}

func (s *Server) recordMockHit(id, method, path, source string) {
	if id == "" {
		return
	}
	s.mu.Lock()
	s.mockHits[id] = append([]models.MockHit{{At: time.Now().UnixMilli(), Method: method, Path: path, Source: source}}, s.mockHits[id]...)
	if len(s.mockHits[id]) > 100 {
		s.mockHits[id] = s.mockHits[id][:100]
	}
	snap := make(map[string][]models.MockHit, len(s.mockHits))
	for k, v := range s.mockHits {
		snap[k] = v
	}
	s.mu.Unlock()
	_ = s.store.SaveMockHits(snap)
}

func (s *Server) mockHitsHandler(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	hits := append([]models.MockHit{}, s.mockHits[r.PathValue("id")]...)
	s.mu.Unlock()
	var lastAt int64
	if len(hits) > 0 {
		lastAt = hits[0].At
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": len(hits), "hits": hits, "lastAt": lastAt})
}

func firstMockOf(mocks []models.MockResponse, name string) *models.MockResponse {
	var first *models.MockResponse
	for i := range mocks {
		if !mocks[i].Enabled {
			continue
		}
		if name != "" && mocks[i].Name == name {
			return &mocks[i]
		}
		if first == nil {
			first = &mocks[i]
		}
	}
	return first
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

// --- scheduler -------------------------------------------------------------

func (s *Server) createSchedule(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Name       string              `json:"name"`
		Request    models.RequestDef   `json:"request"`
		EnvID      string              `json:"envId"`
		Variables  map[string]string   `json:"variables"`
		Parents    []models.RequestDef `json:"parents"`
		Mock       bool                `json:"mock"`
		StartAt    int64               `json:"startAt"`
		DelayMs    int64               `json:"delayMs"`
		IntervalMs int64               `json:"intervalMs"`
		Count      int                 `json:"count"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	startAt := payload.StartAt
	if startAt <= 0 && payload.DelayMs > 0 {
		startAt = time.Now().UnixMilli() + payload.DelayMs
	}
	job := s.scheduler.Add(models.ScheduleJob{
		Name:       payload.Name,
		Request:    payload.Request,
		EnvID:      payload.EnvID,
		Variables:  payload.Variables,
		Parents:    payload.Parents,
		Mock:       payload.Mock,
		StartAt:    startAt,
		IntervalMs: payload.IntervalMs,
		Total:      payload.Count,
	})
	writeJSON(w, http.StatusCreated, job)
}

func (s *Server) listSchedules(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"jobs": s.scheduler.List()})
}

func (s *Server) deleteSchedule(w http.ResponseWriter, r *http.Request) {
	if !s.scheduler.Remove(r.PathValue("id")) {
		writeErr(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) runSchedule(w http.ResponseWriter, r *http.Request) {
	if !s.scheduler.RunNow(r.PathValue("id")) {
		writeErr(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) cancelSchedule(w http.ResponseWriter, r *http.Request) {
	if !s.scheduler.Cancel(r.PathValue("id")) {
		writeErr(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) scheduleResults(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"results": s.scheduler.Results(r.PathValue("id"))})
}

// --- export ----------------------------------------------------------------

func (s *Server) exportNodes(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	format := r.URL.Query().Get("format")

	var nodes []*models.Node
	if id != "" {
		n, ok := s.store.FindNode(id)
		if !ok {
			writeErr(w, http.StatusNotFound, "node not found")
			return
		}
		nodes = []*models.Node{n}
	} else {
		nodes = s.store.Collections()
	}

	if format == "curl" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="curlui-export.sh"`)
		for _, n := range nodes {
			writeCurlNode(w, n, "")
		}
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="curlui-export.json"`)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"format":      "curlui",
		"version":     1,
		"exportedAt":  time.Now().UnixMilli(),
		"collections": nodes,
	})
}

func writeCurlNode(w io.Writer, n *models.Node, prefix string) {
	if n.Type == "request" && n.Request != nil {
		fmt.Fprintf(w, "# %s%s\n%s\n\n", prefix, n.Name, curlpkg.Generate(*n.Request))
	}
	for _, c := range n.Children {
		writeCurlNode(w, c, prefix+n.Name+" / ")
	}
}

// --- update ----------------------------------------------------------------

func (s *Server) checkUpdate(w http.ResponseWriter, _ *http.Request) {
	rel, err := update.LatestRelease()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, update.Info{
		Current:   s.version,
		Latest:    rel.Tag,
		HasUpdate: update.IsNewer(s.version, rel.Tag),
		URL:       rel.URL,
	})
}

func (s *Server) applyUpdate(w http.ResponseWriter, _ *http.Request) {
	rel, err := update.LatestRelease()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if !update.IsNewer(s.version, rel.Tag) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": false, "version": s.version})
		return
	}
	url := update.AssetURL(rel)
	if url == "" {
		writeErr(w, http.StatusNotFound, "no build for this platform in "+rel.Tag)
		return
	}
	data, err := update.Download(url)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if err := update.Apply(data); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	log.Printf("updated to %s — restart to apply", rel.Tag)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": true, "version": rel.Tag, "restartRequired": true})
}

// --- batch / concurrent runner --------------------------------------------

type batchItem struct {
	Name    string            `json:"name"`
	Request models.RequestDef `json:"request"`
	Repeat  int               `json:"repeat"`
}

type batchResult struct {
	Name             string `json:"name"`
	Method           string `json:"method"`
	URL              string `json:"url"`
	Index            int    `json:"index"`
	Status           int    `json:"status"`
	Duration         int64  `json:"duration"`
	Error            string `json:"error,omitempty"`
	AssertionsFailed int    `json:"assertionsFailed"`
}

// runBatch executes many requests concurrently with a bounded worker pool.
func (s *Server) runBatch(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Items       []batchItem       `json:"items"`
		Concurrency int               `json:"concurrency"`
		EnvID       string            `json:"envId"`
		Variables   map[string]string `json:"variables"`
		Mock        bool              `json:"mock"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if len(payload.Items) == 0 {
		writeErr(w, http.StatusBadRequest, "no requests to run")
		return
	}

	concurrency := payload.Concurrency
	if concurrency < 1 {
		concurrency = 5
	}
	if concurrency > 64 {
		concurrency = 64
	}

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

	// Expand repeats into a flat job list.
	type job struct {
		item batchItem
		idx  int
	}
	var jobs []job
	for _, it := range payload.Items {
		repeat := it.Repeat
		if repeat < 1 {
			repeat = 1
		}
		if repeat > 1000 {
			repeat = 1000
		}
		for i := 0; i < repeat; i++ {
			jobs = append(jobs, job{item: it, idx: i})
		}
	}

	results := make([]batchResult, len(jobs))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	start := time.Now()
	for i, jb := range jobs {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, jb job) {
			defer wg.Done()
			defer func() { <-sem }()
			resp := s.executor.Execute(r.Context(), jb.item.Request, envSet, payload.Mock)
			fails := 0
			for _, a := range resp.Assertions {
				if !a.Passed {
					fails++
				}
			}
			results[i] = batchResult{
				Name:             jb.item.Name,
				Method:           jb.item.Request.Method,
				URL:              jb.item.Request.URL,
				Index:            jb.idx,
				Status:           resp.Status,
				Duration:         resp.Duration,
				Error:            resp.Error,
				AssertionsFailed: fails,
			}
		}(i, jb)
	}
	wg.Wait()

	var ok, failed int
	var totalMs, minMs, maxMs int64
	for i, res := range results {
		if res.Error == "" && res.Status >= 200 && res.Status < 400 && res.AssertionsFailed == 0 {
			ok++
		} else {
			failed++
		}
		totalMs += res.Duration
		if i == 0 || res.Duration < minMs {
			minMs = res.Duration
		}
		if res.Duration > maxMs {
			maxMs = res.Duration
		}
	}
	avg := int64(0)
	if len(results) > 0 {
		avg = totalMs / int64(len(results))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"results": results,
		"summary": map[string]any{
			"total":      len(results),
			"ok":         ok,
			"failed":     failed,
			"avgMs":      avg,
			"minMs":      minMs,
			"maxMs":      maxMs,
			"durationMs": time.Since(start).Milliseconds(),
		},
	})
}

// --- fuzzing ----------------------------------------------------------------

var defaultFuzzPayloads = []string{
	"'", "\"", "`", ";", "--", "' OR '1'='1", "<script>alert(1)</script>",
	"../../../../etc/passwd", "{{7*7}}", "${7*7}", "%00", "\x00", "null",
	"0", "-1", "9999999999999999999999", "NaN", "[]", "{}",
	strings.Repeat("A", 4096),
}

type fuzzFinding struct {
	Name     string   `json:"name"`
	Status   int      `json:"status"`
	Size     int      `json:"size"`
	Duration int64    `json:"duration"`
	Error    string   `json:"error,omitempty"`
	Issues   []string `json:"issues"`
}

// runFuzz mutates a request's inputs with a payload list, sends them
// concurrently, and flags anomalies against the baseline response.
func (s *Server) runFuzz(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Request     models.RequestDef `json:"request"`
		EnvID       string            `json:"envId"`
		Variables   map[string]string `json:"variables"`
		Concurrency int               `json:"concurrency"`
		Payloads    []string          `json:"payloads"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	payloads := payload.Payloads
	if len(payloads) == 0 {
		payloads = defaultFuzzPayloads
	}
	if len(payloads) > 60 {
		payloads = payloads[:60]
	}
	concurrency := payload.Concurrency
	if concurrency < 1 {
		concurrency = 8
	}
	if concurrency > 32 {
		concurrency = 32
	}

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

	baseline := s.executor.Execute(r.Context(), payload.Request, envSet, false)

	type mut struct {
		name string
		req  models.RequestDef
	}
	var mutations []mut
	add := func(name string, req models.RequestDef) {
		if len(mutations) < 200 {
			mutations = append(mutations, mut{name: name, req: req})
		}
	}
	clone := func() models.RequestDef {
		b, _ := json.Marshal(payload.Request)
		var out models.RequestDef
		_ = json.Unmarshal(b, &out)
		return out
	}

	for _, p := range payloads {
		for i := range payload.Request.Params {
			if !payload.Request.Params[i].Enabled || payload.Request.Params[i].Key == "" {
				continue
			}
			m := clone()
			m.Params[i].Value = p
			add("param "+payload.Request.Params[i].Key+"="+short(p), m)
		}
		for i := range payload.Request.Headers {
			h := payload.Request.Headers[i]
			if !h.Enabled || h.Key == "" || strings.EqualFold(h.Key, "Content-Length") {
				continue
			}
			m := clone()
			m.Headers[i].Value = p
			add("header "+h.Key+": "+short(p), m)
		}
		if payload.Request.Body.Type == "json" && payload.Request.Body.Raw != "" {
			if mutated := mutateJSONStrings(payload.Request.Body.Raw, p); mutated != "" {
				m := clone()
				m.Body.Raw = mutated
				add("body "+short(p), m)
			}
		} else if payload.Request.Body.Raw != "" || payload.Request.Body.Type == "text" || payload.Request.Body.Type == "form-urlencoded" {
			m := clone()
			m.Body.Raw = p
			add("body "+short(p), m)
		}
	}

	findings := make([]fuzzFinding, len(mutations))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i, mu := range mutations {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, mu mut) {
			defer wg.Done()
			defer func() { <-sem }()
			resp := s.executor.Execute(r.Context(), mu.req, envSet, false)
			f := fuzzFinding{Name: mu.name, Status: resp.Status, Size: resp.Size, Duration: resp.Duration, Error: resp.Error}
			switch {
			case resp.Error != "":
				f.Issues = append(f.Issues, "request error")
			case resp.Status >= 500:
				f.Issues = append(f.Issues, "server error 5xx")
			}
			if resp.Error == "" {
				if baseline.Error == "" && resp.Status != baseline.Status {
					f.Issues = append(f.Issues, fmt.Sprintf("status %d → %d", baseline.Status, resp.Status))
				}
				if baseline.Size > 0 && (resp.Size > baseline.Size*3 || resp.Size*3 < baseline.Size) {
					f.Issues = append(f.Issues, "unexpected body size")
				}
			}
			findings[i] = f
		}(i, mu)
	}
	wg.Wait()

	issues := 0
	for _, f := range findings {
		if len(f.Issues) > 0 {
			issues++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"baseline": map[string]any{"status": baseline.Status, "size": baseline.Size, "duration": baseline.Duration, "error": baseline.Error},
		"results":  findings,
		"summary":  map[string]any{"total": len(findings), "issues": issues},
	})
}

func short(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 24 {
		return s[:24] + "…"
	}
	return s
}

func mutateJSONStrings(raw, payload string) string {
	var v any
	if json.Unmarshal([]byte(raw), &v) != nil {
		return ""
	}
	mutated := replaceStrings(v, payload)
	b, err := json.Marshal(mutated)
	if err != nil {
		return ""
	}
	return string(b)
}

func replaceStrings(v any, payload string) any {
	switch t := v.(type) {
	case string:
		return payload
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, vv := range t {
			out[k] = replaceStrings(vv, payload)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, vv := range t {
			out[i] = replaceStrings(vv, payload)
		}
		return out
	default:
		return v
	}
}

// --- save captures as a collection -----------------------------------------

func (s *Server) saveCaptures(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		IDs  []string `json:"ids"`
		Name string   `json:"name"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	set := map[string]bool{}
	for _, id := range payload.IDs {
		set[id] = true
	}
	var chosen []models.CaptureEntry
	for _, c := range s.store.Captures() {
		if len(set) == 0 || set[c.ID] {
			chosen = append(chosen, c)
		}
	}
	if len(chosen) == 0 {
		writeErr(w, http.StatusBadRequest, "no captures to save")
		return
	}
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		name = "Captured " + time.Now().Format("2006-01-02 15:04:05")
	}
	folder := &models.Node{ID: models.NewID(), Type: "folder", Name: name}
	for i := len(chosen) - 1; i >= 0; i-- { // keep chronological order
		req := captureToRequest(chosen[i])
		node := &models.Node{ID: models.NewID(), Type: "request", Name: req.Name, Request: &req}
		folder.Children = append(folder.Children, node)
	}
	saved, count, err := s.store.ImportNodes("", []*models.Node{folder})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	folderID := ""
	if len(saved) > 0 {
		folderID = saved[0].ID
	}
	writeJSON(w, http.StatusCreated, map[string]any{"count": count, "folderId": folderID})
}

// --- capture proxy ---------------------------------------------------------

func (s *Server) listProxy(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	running, addr := s.proxyRunning, s.proxyAddr
	s.mu.Unlock()
	settings := s.store.Settings()
	ttl := atoiSafe(settings["proxyTTL"])
	if ttl > 0 {
		_ = s.store.PurgeCaptures(time.Duration(ttl) * time.Second)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"running":     running,
		"addr":        addr,
		"capture":     settings["proxyCapture"] != "0",
		"ttlSeconds":  ttl,
		"filter":      settings["proxyCaptureFilter"],
		"break":       settings["proxyBreak"] == "1",
		"breakFilter": settings["proxyBreakFilter"],
		"entries":     s.store.Captures(),
	})
}

func (s *Server) proxyConfig(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Capture     bool   `json:"capture"`
		TTLSeconds  int    `json:"ttlSeconds"`
		Filter      string `json:"filter"`
		Break       bool   `json:"break"`
		BreakFilter string `json:"breakFilter"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	capture := "0"
	if payload.Capture {
		capture = "1"
	}
	brk := "0"
	if payload.Break {
		brk = "1"
	}
	if payload.TTLSeconds < 0 {
		payload.TTLSeconds = 0
	}
	if err := s.store.SaveSettings(map[string]string{
		"proxyCapture":       capture,
		"proxyTTL":           strconv.Itoa(payload.TTLSeconds),
		"proxyCaptureFilter": payload.Filter,
		"proxyBreak":         brk,
		"proxyBreakFilter":   payload.BreakFilter,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- breakpoints -----------------------------------------------------------

func (s *Server) listIntercepts(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	i := s.interceptor
	s.mu.Unlock()
	pending := []proxy.PendingInfo{}
	if i != nil {
		if list := i.List(); list != nil {
			pending = list
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"pending": pending})
}

func (s *Server) resolveIntercept(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Action  string              `json:"action"`
		Method  string              `json:"method"`
		URL     string              `json:"url"`
		Headers map[string][]string `json:"headers"`
		Body    string              `json:"body"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	s.mu.Lock()
	i := s.interceptor
	s.mu.Unlock()
	if i == nil {
		writeErr(w, http.StatusNotImplemented, "breakpoints are not enabled")
		return
	}
	res := proxy.Resolution{
		Abort:   payload.Action == "abort",
		Method:  payload.Method,
		URL:     payload.URL,
		Headers: payload.Headers,
		Body:    []byte(payload.Body),
	}
	if !i.Resolve(r.PathValue("id"), res) {
		writeErr(w, http.StatusNotFound, "intercept not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func atoiSafe(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// --- capture export --------------------------------------------------------

func (s *Server) exportCaptures(w http.ResponseWriter, r *http.Request) {
	entries := s.store.Captures()
	if r.URL.Query().Get("format") == "curl" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="curlui-captures.sh"`)
		for _, c := range entries {
			fmt.Fprintf(w, "# %s %s\n%s\n\n", c.Method, c.URL, curlpkg.Generate(captureToRequest(c)))
		}
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="curlui-captures.har"`)
	harEntries := make([]map[string]any, 0, len(entries))
	for _, c := range entries {
		harEntries = append(harEntries, harEntry(c))
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"log": map[string]any{
			"version": "1.2",
			"creator": map[string]any{"name": "curlui", "version": s.version},
			"entries": harEntries,
		},
	})
}

func harEntry(c models.CaptureEntry) map[string]any {
	req := map[string]any{
		"method": c.Method, "url": c.URL, "httpVersion": "HTTP/1.1",
		"headers": headerList(c.RequestHeaders), "queryString": []any{}, "cookies": []any{},
		"headersSize": -1, "bodySize": len(c.RequestBody),
	}
	if c.RequestBody != "" {
		req["postData"] = map[string]any{"mimeType": headerVal(c.RequestHeaders, "Content-Type"), "text": c.RequestBody}
	}
	resp := map[string]any{
		"status": c.Status, "statusText": "", "httpVersion": "HTTP/1.1",
		"headers": headerList(c.ResponseHeaders), "cookies": []any{},
		"content":     map[string]any{"size": len(c.ResponseBody), "mimeType": c.ContentType, "text": c.ResponseBody},
		"redirectURL": "", "headersSize": -1, "bodySize": len(c.ResponseBody),
	}
	return map[string]any{
		"startedDateTime": time.UnixMilli(c.At).UTC().Format(time.RFC3339Nano),
		"time":            c.Duration,
		"request":         req,
		"response":        resp,
		"cache":           map[string]any{},
		"timings":         map[string]any{"send": 0, "wait": c.Duration, "receive": 0},
	}
}

func headerList(h map[string][]string) []map[string]string {
	out := []map[string]string{}
	for k, values := range h {
		for _, v := range values {
			out = append(out, map[string]string{"name": k, "value": v})
		}
	}
	return out
}

func headerVal(h map[string][]string, name string) string {
	for k, values := range h {
		if strings.EqualFold(k, name) && len(values) > 0 {
			return values[0]
		}
	}
	return ""
}

func (s *Server) proxyCAHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	pem := s.proxyCA
	s.mu.Unlock()
	if len(pem) == 0 {
		writeErr(w, http.StatusNotFound, "HTTPS interception is not enabled")
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="curlui-ca.crt"`)
	_, _ = w.Write(pem)
}

func (s *Server) clearProxy(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.ClearCaptures(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) replayCapture(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var found *models.CaptureEntry
	for _, c := range s.store.Captures() {
		if c.ID == id {
			cp := c
			found = &cp
			break
		}
	}
	if found == nil {
		writeErr(w, http.StatusNotFound, "capture not found")
		return
	}
	req := captureToRequest(*found)
	resp := s.executor.Execute(r.Context(), req, variables.Set{}, false)
	entry := models.CaptureEntry{
		At:              time.Now().UnixMilli(),
		Method:          req.Method,
		URL:             req.URL,
		RequestHeaders:  headerMap(req.Headers),
		RequestBody:     req.Body.Raw,
		Status:          resp.Status,
		ResponseHeaders: resp.Headers,
		ResponseBody:    resp.Body,
		ContentType:     resp.ContentType,
		Duration:        resp.Duration,
		Error:           resp.Error,
	}
	_ = s.store.AddCapture(entry)
	writeJSON(w, http.StatusOK, entry)
}

// captureToRequest rebuilds an editable request from a capture.
func captureToRequest(c models.CaptureEntry) models.RequestDef {
	req := models.RequestDef{
		Name:    c.Method + " " + c.URL,
		Method:  c.Method,
		URL:     c.URL,
		Headers: []models.KeyValue{},
		Params:  []models.KeyValue{},
		Body:    models.Body{Type: "none", Form: []models.KeyValue{}},
		Auth:    models.Auth{Type: "none"},
		Options: models.Options{Timeout: 30000, FollowRedirects: true, VerifyTLS: true, MaxRedirects: 10},
	}
	ct := ""
	for k, values := range c.RequestHeaders {
		if strings.EqualFold(k, "Content-Type") && len(values) > 0 {
			ct = values[0]
		}
		for _, v := range values {
			req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: k, Value: v, Enabled: true})
		}
	}
	if c.RequestBody != "" {
		req.Body.Raw = c.RequestBody
		switch {
		case strings.Contains(strings.ToLower(ct), "json"):
			req.Body.Type = "json"
		case strings.Contains(strings.ToLower(ct), "xml"):
			req.Body.Type = "xml"
		default:
			req.Body.Type = "text"
		}
	}
	return req
}

func headerMap(kvs []models.KeyValue) map[string][]string {
	out := map[string][]string{}
	for _, kv := range kvs {
		if kv.Enabled && kv.Key != "" {
			out[kv.Key] = append(out[kv.Key], kv.Value)
		}
	}
	return out
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
