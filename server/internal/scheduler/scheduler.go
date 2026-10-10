// Package scheduler runs requests on a delay, at a specific time, or on a
// repeating interval (like Postman's collection runner / monitors). Jobs are
// persisted through a callback so they survive restarts.
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

// Persist is called with the full job list whenever it changes.
type Persist func([]models.ScheduleJob)

// Notify is called when a run fails (error or status >= 400).
type Notify func(models.ScheduleJob, models.ScheduleResult)

// Scheduler manages jobs with a background ticker.
type Scheduler struct {
	mu      sync.Mutex
	jobs    map[string]*models.ScheduleJob
	results map[string][]models.ScheduleResult
	run     Runner
	persist Persist
	notify  Notify
}

// New creates a scheduler and starts its background loop.
func New(run Runner, persist Persist, notify Notify) *Scheduler {
	s := &Scheduler{jobs: map[string]*models.ScheduleJob{}, results: map[string][]models.ScheduleResult{}, run: run, persist: persist, notify: notify}
	go s.loop()
	return s
}

// Load restores persisted jobs (called once at startup).
func (s *Scheduler) Load(jobs []models.ScheduleJob) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UnixMilli()
	for i := range jobs {
		job := jobs[i]
		if !job.Active {
			continue
		}
		// Missed while the server was down: run soon rather than never.
		if job.NextRun == 0 || job.NextRun < now {
			job.NextRun = now
			job.StartAt = now
		}
		s.jobs[job.ID] = &job
	}
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
	now := time.Now().UnixMilli()
	j.LastRun = now
	j.LastStatus = resp.Status
	j.LastError = resp.Error
	s.results[id] = append([]models.ScheduleResult{{At: now, Status: resp.Status, Duration: resp.Duration, Error: resp.Error}}, s.results[id]...)
	if len(s.results[id]) > 50 {
		s.results[id] = s.results[id][:50]
	}
	s.mu.Unlock()

	result := models.ScheduleResult{At: now, Status: resp.Status, Duration: resp.Duration, Error: resp.Error}
	if (resp.Error != "" || resp.Status >= 400) && s.notify != nil {
		jobCopy := *j
		go s.notify(jobCopy, result)
	}
	s.save()
}

// Add registers a new job.
func (s *Scheduler) Add(job models.ScheduleJob) models.ScheduleJob {
	s.mu.Lock()
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
	s.mu.Unlock()
	s.save()
	return job
}

// List returns all jobs newest-first.
func (s *Scheduler) List() []models.ScheduleJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.ScheduleJob, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, *j)
	}
	sort.Slice(out, func(i, k int) bool { return out[i].CreatedAt > out[k].CreatedAt })
	return out
}

// Cancel stops a job's future runs.
func (s *Scheduler) Cancel(id string) bool {
	s.mu.Lock()
	j := s.jobs[id]
	if j == nil {
		s.mu.Unlock()
		return false
	}
	j.Active = false
	j.NextRun = 0
	s.mu.Unlock()
	s.save()
	return true
}

// Remove deletes a job and its results.
func (s *Scheduler) Remove(id string) bool {
	s.mu.Lock()
	if _, ok := s.jobs[id]; !ok {
		s.mu.Unlock()
		return false
	}
	delete(s.jobs, id)
	delete(s.results, id)
	s.mu.Unlock()
	s.save()
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
func (s *Scheduler) Results(id string) []models.ScheduleResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]models.ScheduleResult, len(s.results[id]))
	copy(out, s.results[id])
	return out
}

func (s *Scheduler) save() {
	if s.persist == nil {
		return
	}
	s.persist(s.List())
}
