// Package scheduler runs requests on a delay, at a specific time, or on a
// repeating interval (like Postman's collection runner / monitors).
package scheduler

import (
	"context"
	"sort"
	"sync"
	"time"

	"curlui/server/internal/models"
)

// Runner executes one request and returns its response.
type Runner func(
	ctx context.Context,
	req models.RequestDef,
	envID string,
	vars map[string]string,
	parents []models.RequestDef,
	mock bool,
) models.Response

// Job is a scheduled request.
type Job struct {
	ID         string              `json:"id"`
	Name       string              `json:"name"`
	Request    models.RequestDef   `json:"request"`
	EnvID      string              `json:"envId,omitempty"`
	Variables  map[string]string   `json:"variables,omitempty"`
	Parents    []models.RequestDef `json:"parents,omitempty"`
	Mock       bool                `json:"mock,omitempty"`
	StartAt    int64               `json:"startAt,omitempty"`    // unix ms
	IntervalMs int64               `json:"intervalMs,omitempty"` // 0 = one-shot
	Total      int                 `json:"count,omitempty"`      // 0 = unlimited (interval only)

	Runs       int    `json:"runs"`
	LastStatus int    `json:"lastStatus"`
	LastError  string `json:"lastError,omitempty"`
	LastRun    int64  `json:"lastRun,omitempty"`
	NextRun    int64  `json:"nextRun,omitempty"`
	Active     bool   `json:"active"`
	CreatedAt  int64  `json:"createdAt"`
}

// Result is one execution outcome.
type Result struct {
	At       int64  `json:"at"`
	Status   int    `json:"status"`
	Duration int64  `json:"duration"`
	Error    string `json:"error,omitempty"`
}

// Scheduler manages jobs with a background ticker.
type Scheduler struct {
	mu      sync.Mutex
	jobs    map[string]*Job
	results map[string][]Result
	run     Runner
}

// New creates a scheduler and starts its background loop.
func New(run Runner) *Scheduler {
	s := &Scheduler{jobs: map[string]*Job{}, results: map[string][]Result{}, run: run}
	go s.loop()
	return s
}

func (s *Scheduler) loop() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		s.tick()
	}
}

func (s *Scheduler) tick() {
	now := time.Now().UnixMilli()
	var due []string
	s.mu.Lock()
	for id, j := range s.jobs {
		if j.Active && j.NextRun > 0 && j.NextRun <= now {
			due = append(due, id)
		}
	}
	s.mu.Unlock()
	for _, id := range due {
		s.execute(id, true)
	}
}

// execute runs a job. scheduled=true advances the schedule (interval/count);
// scheduled=false is an ad-hoc "run now".
func (s *Scheduler) execute(id string, scheduled bool) {
	s.mu.Lock()
	j := s.jobs[id]
	if j == nil {
		s.mu.Unlock()
		return
	}
	if scheduled {
		if !j.Active || j.NextRun == 0 || j.NextRun > time.Now().UnixMilli() {
			s.mu.Unlock()
			return
		}
		j.Runs++
		if (j.Total > 0 && j.Runs >= j.Total) || j.IntervalMs <= 0 {
			j.Active = false
			j.NextRun = 0
		} else {
			j.NextRun = time.Now().UnixMilli() + j.IntervalMs
		}
	}
	req, envID, vars, parents, mock := j.Request, j.EnvID, j.Variables, j.Parents, j.Mock
	s.mu.Unlock()

	resp := s.run(context.Background(), req, envID, vars, parents, mock)

	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UnixMilli()
	j.LastRun = now
	j.LastStatus = resp.Status
	j.LastError = resp.Error
	s.results[id] = append([]Result{{At: now, Status: resp.Status, Duration: resp.Duration, Error: resp.Error}}, s.results[id]...)
	if len(s.results[id]) > 50 {
		s.results[id] = s.results[id][:50]
	}
}

// Add registers a new job.
func (s *Scheduler) Add(job Job) *Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	if job.ID == "" {
		job.ID = models.NewID()
	}
	if job.Name == "" {
		job.Name = job.Request.Name
	}
	if job.CreatedAt == 0 {
		job.CreatedAt = time.Now().UnixMilli()
	}
	now := time.Now().UnixMilli()
	if job.StartAt <= 0 {
		job.StartAt = now
	}
	job.NextRun = job.StartAt
	job.Active = true
	stored := job
	s.jobs[job.ID] = &stored
	out := stored
	return &out
}

// List returns all jobs newest-first.
func (s *Scheduler) List() []*Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		cp := *j
		out = append(out, &cp)
	}
	sort.Slice(out, func(i, k int) bool { return out[i].CreatedAt > out[k].CreatedAt })
	return out
}

// Cancel stops a job's future runs.
func (s *Scheduler) Cancel(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	j := s.jobs[id]
	if j == nil {
		return false
	}
	j.Active = false
	j.NextRun = 0
	return true
}

// Remove deletes a job and its results.
func (s *Scheduler) Remove(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[id]; !ok {
		return false
	}
	delete(s.jobs, id)
	delete(s.results, id)
	return true
}

// RunNow executes a job immediately (without affecting its schedule).
func (s *Scheduler) RunNow(id string) bool {
	s.mu.Lock()
	_, ok := s.jobs[id]
	s.mu.Unlock()
	if !ok {
		return false
	}
	go s.execute(id, false)
	return true
}

// Results returns recent results for a job.
func (s *Scheduler) Results(id string) []Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Result, len(s.results[id]))
	copy(out, s.results[id])
	return out
}
