//go:build core

package store

import (
	"fmt"
	"time"
)

// PostgreSQL is not compiled into the core build; the JSON file store is used.

func (s *Store) pgOpen(dsn string) error {
	return fmt.Errorf("PostgreSQL support is not included in this core build")
}

func (s *Store) loadPG() error { return nil }

func (s *Store) saveProjectRow(pid string) error { return nil }

func (s *Store) pgSaveSetting(key, value string) error                       { return nil }
func (s *Store) pgCreateProject(id, name, owner string, now time.Time) error { return nil }
func (s *Store) pgRenameProject(id, name string) error                       { return nil }
func (s *Store) pgDeleteProject(id string) error                             { return nil }
func (s *Store) pgSaveMember(pid, uid, role string) error                    { return nil }
func (s *Store) pgDeleteMember(pid, uid string) error                        { return nil }
func (s *Store) pgCreateUser(u *User) error                                  { return nil }
func (s *Store) pgUpdateUser(u *User) error                                  { return nil }
func (s *Store) pgDeleteUser(id string) error                                { return nil }
func (s *Store) pgCreateSession(se *Session) error                           { return nil }
func (s *Store) pgCreatePAT(p *PAT) error                                    { return nil }
func (s *Store) pgDeletePAT(id string) error                                 { return nil }
func (s *Store) pgTouchPAT(id string, at time.Time) error                    { return nil }
func (s *Store) pgDeleteSession(token string) error                          { return nil }
func (s *Store) pgPurgeSessions(before time.Time) error                      { return nil }
func (s *Store) pgAddAudit(e AuditEntry) error                               { return nil }
