//go:build core

// Package scheduler is not compiled into the core build; this stub keeps the
// API layer compiling.
package scheduler

import (
	"context"

	"curlui/server/internal/models"
)

// Runner runs a scheduled request.
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

// Notify is called when a run fails.
type Notify func(models.ScheduleJob, models.ScheduleResult)

// Scheduler is a no-op in the core build.
type Scheduler struct{}

// New returns a no-op scheduler.
func New(run Runner, persist Persist, notify Notify) *Scheduler { return &Scheduler{} }

// Load is a no-op.
func (s *Scheduler) Load(jobs []models.ScheduleJob) {}

// Add, List, Remove, RunNow, Cancel and Results exist so the (full-only)
// handlers compile when the package is present.
func (s *Scheduler) Add(job models.ScheduleJob) models.ScheduleJob { return job }
func (s *Scheduler) List() []models.ScheduleJob                    { return nil }
func (s *Scheduler) Remove(id string) bool                         { return false }
func (s *Scheduler) RunNow(id string) bool                         { return false }
func (s *Scheduler) Cancel(id string) bool                         { return false }
func (s *Scheduler) Results(id string) []models.ScheduleResult     { return nil }
