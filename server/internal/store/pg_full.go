//go:build !core

package store

import (
	"encoding/json"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type userRow struct {
	ID        string `gorm:"primaryKey"`
	Username  string `gorm:"uniqueIndex"`
	Name      string
	Password  string
	Role      string
	CreatedAt time.Time
}

func (userRow) TableName() string { return "users" }

type sessionRow struct {
	Token     string `gorm:"primaryKey"`
	UserID    string `gorm:"index"`
	CreatedAt time.Time
	ExpiresAt time.Time `gorm:"index"`
}

func (sessionRow) TableName() string { return "sessions" }

type projectRow struct {
	ID        string `gorm:"primaryKey"`
	Name      string
	OwnerID   string `gorm:"index"`
	Data      string `gorm:"type:jsonb"`
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (projectRow) TableName() string { return "projects" }

type memberRow struct {
	ProjectID string `gorm:"primaryKey"`
	UserID    string `gorm:"primaryKey"`
	Role      string
}

func (memberRow) TableName() string { return "project_members" }

type settingRow struct {
	Key   string `gorm:"primaryKey"`
	Value string
}

func (settingRow) TableName() string { return "settings" }

type auditRow struct {
	ID     string `gorm:"primaryKey"`
	At     time.Time
	User   string `gorm:"index"`
	Action string
	Target string
	Detail string
}

func (auditRow) TableName() string { return "audit_logs" }

// loadPG reads every table into memory.
func (s *Store) loadPG() error {
	db := s.db.(*gorm.DB)
	var pros []projectRow
	if err := db.Find(&pros).Error; err != nil {
		return err
	}
	for _, p := range pros {
		d := newData()
		if p.Data != "" {
			if err := json.Unmarshal([]byte(p.Data), d); err != nil {
				d = newData()
			}
		}
		s.root.Projects[p.ID] = d
		s.root.Meta[p.ID] = &ProjectMeta{
			ID:        p.ID,
			Name:      p.Name,
			OwnerID:   p.OwnerID,
			Members:   map[string]string{},
			CreatedAt: p.CreatedAt,
			UpdatedAt: p.UpdatedAt,
			Version:   p.Version,
		}
	}
	var members []memberRow
	if err := db.Find(&members).Error; err != nil {
		return err
	}
	for _, m := range members {
		if meta := s.root.Meta[m.ProjectID]; meta != nil {
			meta.Members[m.UserID] = m.Role
		}
	}
	var urs []userRow
	if err := db.Find(&urs).Error; err != nil {
		return err
	}
	for _, u := range urs {
		s.root.Users[u.ID] = &User{ID: u.ID, Username: u.Username, Name: u.Name, PasswordHash: u.Password, Role: u.Role, CreatedAt: u.CreatedAt}
	}
	var sessions []sessionRow
	if err := db.Where("expires_at > ?", time.Now()).Find(&sessions).Error; err != nil {
		return err
	}
	for _, se := range sessions {
		s.root.Sessions[se.Token] = &Session{Token: se.Token, UserID: se.UserID, CreatedAt: se.CreatedAt, ExpiresAt: se.ExpiresAt}
	}
	var sets []settingRow
	if err := db.Find(&sets).Error; err != nil {
		return err
	}
	for _, st := range sets {
		s.root.Global[st.Key] = st.Value
	}
	var audits []auditRow
	if err := db.Order("at desc").Limit(500).Find(&audits).Error; err != nil {
		return err
	}
	for _, a := range audits {
		s.root.Audit = append(s.root.Audit, AuditEntry{ID: a.ID, At: a.At, User: a.User, Action: a.Action, Target: a.Target, Detail: a.Detail})
	}
	return nil
}

// saveProjectRow upserts a project's JSONB blob and bumps its version.
// Must be called with the lock held.
func (s *Store) saveProjectRow(pid string) error {
	if s.db == nil || pid == "" {
		return nil
	}
	meta := s.root.Meta[pid]
	if meta == nil {
		return nil
	}
	d := s.root.Projects[pid]
	if d == nil {
		return nil
	}
	meta.Version++
	meta.UpdatedAt = time.Now()
	raw, err := json.Marshal(d)
	if err != nil {
		return err
	}
	row := projectRow{ID: pid, Name: meta.Name, OwnerID: meta.OwnerID, Data: string(raw), Version: meta.Version, CreatedAt: meta.CreatedAt, UpdatedAt: meta.UpdatedAt}
	return s.db.(*gorm.DB).Save(&row).Error
}

// pgOpen connects to PostgreSQL and runs migrations.
func (s *Store) pgOpen(dsn string) error {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return err
	}
	if err := db.AutoMigrate(&userRow{}, &sessionRow{}, &projectRow{}, &memberRow{}, &settingRow{}, &auditRow{}); err != nil {
		return err
	}
	s.db = db
	return nil
}

func (s *Store) pgSaveSetting(key, value string) error {
	return s.db.(*gorm.DB).Save(&settingRow{Key: key, Value: value}).Error
}

func (s *Store) pgCreateProject(id, name, ownerID string, now time.Time) error {
	row := projectRow{ID: id, Name: name, OwnerID: ownerID, Data: "{}", CreatedAt: now, UpdatedAt: now}
	return s.db.(*gorm.DB).Create(&row).Error
}

func (s *Store) pgRenameProject(id, name string) error {
	return s.db.(*gorm.DB).Model(&projectRow{}).Where("id = ?", id).Update("name", name).Error
}

func (s *Store) pgDeleteProject(id string) error {
	db := s.db.(*gorm.DB)
	if err := db.Delete(&projectRow{}, "id = ?", id).Error; err != nil {
		return err
	}
	return db.Delete(&memberRow{}, "project_id = ?", id).Error
}

func (s *Store) pgSaveMember(projectID, userID, role string) error {
	return s.db.(*gorm.DB).Save(&memberRow{ProjectID: projectID, UserID: userID, Role: role}).Error
}

func (s *Store) pgDeleteMember(projectID, userID string) error {
	return s.db.(*gorm.DB).Delete(&memberRow{}, "project_id = ? AND user_id = ?", projectID, userID).Error
}

func (s *Store) pgCreateUser(u *User) error {
	row := userRow{ID: u.ID, Username: u.Username, Name: u.Name, Password: u.PasswordHash, Role: u.Role, CreatedAt: u.CreatedAt}
	return s.db.(*gorm.DB).Create(&row).Error
}

func (s *Store) pgUpdateUser(u *User) error {
	return s.db.(*gorm.DB).Model(&userRow{}).Where("id = ?", u.ID).
		Updates(map[string]any{"name": u.Name, "role": u.Role, "password": u.PasswordHash}).Error
}

func (s *Store) pgDeleteUser(id string) error {
	db := s.db.(*gorm.DB)
	if err := db.Delete(&userRow{}, "id = ?", id).Error; err != nil {
		return err
	}
	if err := db.Delete(&sessionRow{}, "user_id = ?", id).Error; err != nil {
		return err
	}
	return db.Delete(&memberRow{}, "user_id = ?", id).Error
}

func (s *Store) pgCreateSession(se *Session) error {
	row := sessionRow{Token: se.Token, UserID: se.UserID, CreatedAt: se.CreatedAt, ExpiresAt: se.ExpiresAt}
	return s.db.(*gorm.DB).Create(&row).Error
}

func (s *Store) pgDeleteSession(token string) error {
	return s.db.(*gorm.DB).Delete(&sessionRow{}, "token = ?", token).Error
}

func (s *Store) pgPurgeSessions(before time.Time) error {
	return s.db.(*gorm.DB).Delete(&sessionRow{}, "expires_at < ?", before).Error
}

func (s *Store) pgAddAudit(e AuditEntry) error {
	return s.db.(*gorm.DB).Create(&auditRow{ID: e.ID, At: e.At, User: e.User, Action: e.Action, Target: e.Target, Detail: e.Detail}).Error
}
