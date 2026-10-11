package api

import (
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"strings"

	"curlui/server/internal/feedback"
)

// envFooter records the build/runtime so issues are self-describing.
func envFooter(version, variant string) string {
	return fmt.Sprintf("\n\n---\n_Filed from **curlui %s** · %s build · %s/%s · %s_",
		version, variant, runtime.GOOS, runtime.GOARCH, runtime.Version())
}

const defaultFeedbackRepo = "holihur/curlui"

func (s *Server) feedbackRepo() string {
	if r := strings.TrimSpace(s.store.Settings()["feedbackRepo"]); r != "" {
		return r
	}
	return defaultFeedbackRepo
}

// feedbackStatus reports whether the `gh` CLI is usable.
func (s *Server) feedbackStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"available": feedback.Available(),
		"repo":      s.feedbackRepo(),
	})
}

// listFeedback lists recent issues for the configured repository.
func (s *Server) listFeedback(w http.ResponseWriter, r *http.Request) {
	if !feedback.Available() {
		writeErr(w, http.StatusServiceUnavailable, "the `gh` CLI is not installed")
		return
	}
	issues, err := feedback.List(r.Context(), s.feedbackRepo(), 50)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"issues": issues, "repo": s.feedbackRepo()})
}

// createFeedback files a new issue.
func (s *Server) createFeedback(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		writeErr(w, http.StatusBadRequest, "a title is required")
		return
	}
	if !feedback.Available() {
		writeErr(w, http.StatusServiceUnavailable, "the `gh` CLI is not installed")
		return
	}
	issue, err := feedback.Create(r.Context(), s.feedbackRepo(), in.Title, in.Body+envFooter(s.version, buildVariant()))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, issue)
}

// getFeedback returns one issue with its replies.
func (s *Server) getFeedback(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.PathValue("number"))
	if n <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid issue number")
		return
	}
	issue, err := feedback.View(r.Context(), s.feedbackRepo(), n)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, issue)
}

// setFeedbackState closes or reopens an issue.
func (s *Server) setFeedbackState(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.PathValue("number"))
	if n <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid issue number")
		return
	}
	var in struct {
		Closed bool `json:"closed"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if err := feedback.SetState(r.Context(), s.feedbackRepo(), n, in.Closed); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	issue, err := feedback.View(r.Context(), s.feedbackRepo(), n)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, issue)
}

// commentFeedback adds a reply to an issue.
func (s *Server) commentFeedback(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.PathValue("number"))
	if n <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid issue number")
		return
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if strings.TrimSpace(in.Body) == "" {
		writeErr(w, http.StatusBadRequest, "the reply is empty")
		return
	}
	if err := feedback.AddComment(r.Context(), s.feedbackRepo(), n, in.Body); err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	issue, err := feedback.View(r.Context(), s.feedbackRepo(), n)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, issue)
}
