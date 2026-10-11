//go:build !core

package api

import (
	"net/http"
	"time"

	"curlui/server/internal/models"
)

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

func (s *Server) listSchedules(w http.ResponseWriter, r *http.Request) {
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

// registerScheduleRoutes mounts the scheduler endpoints.
func (s *Server) registerScheduleRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/schedule", s.createSchedule)
	mux.HandleFunc("GET /api/schedule", s.listSchedules)
	mux.HandleFunc("DELETE /api/schedule/{id}", s.deleteSchedule)
	mux.HandleFunc("POST /api/schedule/{id}/run", s.runSchedule)
	mux.HandleFunc("POST /api/schedule/{id}/cancel", s.cancelSchedule)
	mux.HandleFunc("GET /api/schedule/{id}/results", s.scheduleResults)
}
