package store

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"curlui/server/internal/models"
)

// ErrNotFound is returned when an entity cannot be located.
var ErrNotFound = errors.New("not found")

// ErrConflict is returned for duplicate usernames/slugs.
var ErrConflict = errors.New("already exists")

// ErrForbidden is returned when a user lacks access.
var ErrForbidden = errors.New("forbidden")

// DefaultProjectID is the workspace used in anonymous (no-login) mode.
const DefaultProjectID = "local"

// AnonymousUserID is the implicit user when authentication is disabled.
const AnonymousUserID = "local"

// Data is the persisted workspace document (one per project).
type Data struct {
	Collections  []*models.Node              `json:"collections"`
	Environments []models.Environment        `json:"environments"`
	History      []models.HistoryEntry       `json:"history"`
	Schedules    []models.ScheduleJob        `json:"schedules,omitempty"`
	MockHits     map[string][]models.MockHit `json:"mockHits,omitempty"`
	Captures     []models.CaptureEntry       `json:"captures,omitempty"`
	Settings     map[string]string           `json:"settings,omitempty"`
}

// User is a team member.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"passwordHash,omitempty"`
	Role         string    `json:"role"` // admin | member | viewer
	CreatedAt    time.Time `json:"createdAt"`
}

// Session is a logged-in session.
type Session struct {
	Token     string    `json:"token"`
	UserID    string    `json:"userId"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// ProjectMeta describes a project (workspace) and its membership.
type ProjectMeta struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	OwnerID   string            `json:"ownerId"`
	Members   map[string]string `json:"members"` // userID -> role
	CreatedAt time.Time         `json:"createdAt"`
	UpdatedAt time.Time         `json:"updatedAt"`
	Version   int64             `json:"version"`
}

// Root is the whole in-memory database.
type Root struct {
	Projects map[string]*Data
	Meta     map[string]*ProjectMeta
	Users    map[string]*User
	Sessions map[string]*Session
	Global   map[string]string
	Version  int64
}

// Options configures the store backend.
type Options struct {
	Path string // JSON file path (used when DSN is empty)
	DSN  string // PostgreSQL DSN; enables the GORM backend
}

// Store is a concurrency-safe workspace store. Shared state (root, mutex, db)
// is common to all project views; a view points at one project's data.
type Store struct {
	mu       *sync.RWMutex
	historyN int
	path     string
	db       *gorm.DB
	root     *Root
	pid      string
	data     *Data
}

// --- GORM rows -------------------------------------------------------------

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

// Open loads (or creates) the store. With a DSN it uses PostgreSQL via GORM,
// otherwise it falls back to a JSON file.
func Open(opts Options) (*Store, error) {
	root := newRoot()
	s := &Store{mu: &sync.RWMutex{}, historyN: 500, path: opts.Path, root: root}

	if opts.DSN != "" {
		db, err := gorm.Open(postgres.Open(opts.DSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			return nil, err
		}
		if err := db.AutoMigrate(&userRow{}, &sessionRow{}, &projectRow{}, &memberRow{}, &settingRow{}); err != nil {
			return nil, err
		}
		s.db = db
		if err := s.loadPG(); err != nil {
			return nil, err
		}
	} else if err := s.loadFile(); err != nil {
		return nil, err
	}

	s.ensureDefaultProject()
	if opts.DSN != "" && s.root.Global["pgMigrated"] == "" {
		if err := s.importLegacyFile(opts.Path); err == nil && len(s.root.Projects[DefaultProjectID].Collections) > 0 {
			if err := s.saveProjectRow(DefaultProjectID); err != nil {
				return nil, err
			}
			s.root.Global["pgMigrated"] = "1"
			if err := s.db.Save(&settingRow{Key: "pgMigrated", Value: "1"}).Error; err != nil {
				return nil, err
			}
			log.Printf("imported existing JSON data into PostgreSQL")
		}
	}
	s.pid = DefaultProjectID
	s.data = root.Projects[DefaultProjectID]
	return s, nil
}

// importLegacyFile loads a previously used JSON document into the default
// project (used once when switching a fresh PostgreSQL database to GORM).
func (s *Store) importLegacyFile(path string) error {
	if path == "" {
		return os.ErrNotExist
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	f := &Store{mu: &sync.RWMutex{}, historyN: s.historyN, path: path, root: newRoot()}
	if err := f.loadFile(); err != nil {
		return err
	}
	if d := f.root.Projects[DefaultProjectID]; d != nil {
		s.root.Projects[DefaultProjectID] = d
		if m := f.root.Meta[DefaultProjectID]; m != nil {
			s.root.Meta[DefaultProjectID] = m
		}
	}
	for k, v := range f.root.Global {
		if _, ok := s.root.Global[k]; !ok {
			s.root.Global[k] = v
		}
	}
	return nil
}

func newRoot() *Root {
	return &Root{
		Projects: map[string]*Data{},
		Meta:     map[string]*ProjectMeta{},
		Users:    map[string]*User{},
		Sessions: map[string]*Session{},
		Global:   map[string]string{},
	}
}

func newData() *Data {
	return &Data{Settings: map[string]string{}}
}

func (s *Store) ensureDefaultProject() {
	if _, ok := s.root.Projects[DefaultProjectID]; !ok {
		s.root.Projects[DefaultProjectID] = newData()
		s.root.Meta[DefaultProjectID] = &ProjectMeta{
			ID:        DefaultProjectID,
			Name:      "Personal",
			OwnerID:   AnonymousUserID,
			Members:   map[string]string{},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
	}
	if s.db != nil {
		if _, ok := s.root.Meta[DefaultProjectID]; ok {
			_ = s.saveProjectRow(DefaultProjectID)
		}
	}
}

// loadFile reads the JSON document, migrating a legacy flat file.
func (s *Store) loadFile() error {
	if s.path == "" {
		s.path = filepath.Join("data", "store.json")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		_ = os.WriteFile(s.path+".bak", raw, 0o644)
		return nil
	}
	if _, ok := probe["projects"]; ok {
		var root struct {
			Projects map[string]*Data        `json:"projects"`
			Meta     map[string]*ProjectMeta `json:"projectMeta"`
			Users    map[string]*User        `json:"users"`
			Sessions map[string]*Session     `json:"sessions"`
			Global   map[string]string       `json:"global"`
		}
		if err := json.Unmarshal(raw, &root); err != nil {
			_ = os.WriteFile(s.path+".bak", raw, 0o644)
			return nil
		}
		if root.Projects != nil {
			s.root.Projects = root.Projects
		}
		for id, m := range root.Meta {
			if m == nil {
				continue
			}
			if m.Members == nil {
				m.Members = map[string]string{}
			}
			s.root.Meta[id] = m
		}
		for id, u := range root.Users {
			s.root.Users[id] = u
		}
		for t, se := range root.Sessions {
			s.root.Sessions[t] = se
		}
		if root.Global != nil {
			s.root.Global = root.Global
		}
		return nil
	}
	// Legacy flat file: becomes the default project.
	var d Data
	if err := json.Unmarshal(raw, &d); err != nil {
		_ = os.WriteFile(s.path+".bak", raw, 0o644)
		return nil
	}
	if d.Settings == nil {
		d.Settings = map[string]string{}
	}
	s.root.Global = d.Settings
	d.Settings = nil
	s.root.Projects[DefaultProjectID] = &d
	return nil
}

// loadPG reads every table into memory.
func (s *Store) loadPG() error {
	var pros []projectRow
	if err := s.db.Find(&pros).Error; err != nil {
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
	if err := s.db.Find(&members).Error; err != nil {
		return err
	}
	for _, m := range members {
		if meta := s.root.Meta[m.ProjectID]; meta != nil {
			meta.Members[m.UserID] = m.Role
		}
	}
	var urs []userRow
	if err := s.db.Find(&urs).Error; err != nil {
		return err
	}
	for _, u := range urs {
		s.root.Users[u.ID] = &User{ID: u.ID, Username: u.Username, Name: u.Name, PasswordHash: u.Password, Role: u.Role, CreatedAt: u.CreatedAt}
	}
	var sessions []sessionRow
	if err := s.db.Where("expires_at > ?", time.Now()).Find(&sessions).Error; err != nil {
		return err
	}
	for _, se := range sessions {
		s.root.Sessions[se.Token] = &Session{Token: se.Token, UserID: se.UserID, CreatedAt: se.CreatedAt, ExpiresAt: se.ExpiresAt}
	}
	var sets []settingRow
	if err := s.db.Find(&sets).Error; err != nil {
		return err
	}
	for _, st := range sets {
		s.root.Global[st.Key] = st.Value
	}
	return nil
}

// persist writes the active project (and, in file mode, everything).
func (s *Store) persist() error {
	if s.db != nil {
		return s.saveProjectRow(s.pid)
	}
	return s.persistFile()
}

func (s *Store) persistFile() error {
	raw, err := json.MarshalIndent(s.dumpRoot(), "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) dumpRoot() map[string]any {
	return map[string]any{
		"projects":    s.root.Projects,
		"projectMeta": s.root.Meta,
		"users":       s.root.Users,
		"sessions":    s.root.Sessions,
		"global":      s.root.Global,
	}
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
	return s.db.Save(&row).Error
}

// --- Project views ---------------------------------------------------------

// Project returns a view scoped to a project id (falls back to the default).
func (s *Store) Project(id string) *Store {
	if id == "" {
		id = DefaultProjectID
	}
	if _, ok := s.root.Projects[id]; !ok {
		id = DefaultProjectID
	}
	return &Store{mu: s.mu, historyN: s.historyN, path: s.path, db: s.db, root: s.root, pid: id, data: s.root.Projects[id]}
}

// ProjectID returns the id of this view's project.
func (s *Store) ProjectID() string { return s.pid }

// Version returns the project's change counter (bumped on every write).
func (s *Store) Version() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if m := s.root.Meta[s.pid]; m != nil {
		return m.Version
	}
	return 0
}

// Projects lists all projects the given user may access.
func (s *Store) Projects(userID string, isAdmin bool) []ProjectMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ProjectMeta, 0, len(s.root.Meta))
	for _, m := range s.root.Meta {
		if !isAdmin && !canAccess(m, userID) {
			continue
		}
		cp := *m
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

func canAccess(m *ProjectMeta, userID string) bool {
	if m.ID == DefaultProjectID {
		return true // anonymous / shared default workspace
	}
	if m.OwnerID == userID {
		return true
	}
	_, ok := m.Members[userID]
	return ok
}

// Role returns the caller's role in a project ("", false when no access).
func (s *Store) Role(projectID, userID string, isAdmin bool) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := s.root.Meta[projectID]
	if m == nil {
		return "", false
	}
	if isAdmin {
		return "admin", true
	}
	if m.OwnerID == userID {
		return "owner", true
	}
	if r, ok := m.Members[userID]; ok {
		return r, true
	}
	if projectID == DefaultProjectID {
		return "member", true
	}
	return "", false
}

// CreateProject creates a project owned by ownerID.
func (s *Store) CreateProject(id, name, ownerID string) (ProjectMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id == "" {
		id = models.NewID()
	}
	if _, ok := s.root.Projects[id]; ok {
		return ProjectMeta{}, ErrConflict
	}
	if name == "" {
		name = "Untitled project"
	}
	now := time.Now()
	meta := &ProjectMeta{ID: id, Name: name, OwnerID: ownerID, Members: map[string]string{}, CreatedAt: now, UpdatedAt: now}
	s.root.Projects[id] = newData()
	s.root.Meta[id] = meta
	if s.db != nil {
		row := projectRow{ID: id, Name: name, OwnerID: ownerID, Data: "{}", CreatedAt: now, UpdatedAt: now}
		if err := s.db.Create(&row).Error; err != nil {
			return ProjectMeta{}, err
		}
	} else if err := s.persistFile(); err != nil {
		return ProjectMeta{}, err
	}
	return *meta, nil
}

// RenameProject updates a project's display name.
func (s *Store) RenameProject(id, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.root.Meta[id]
	if m == nil {
		return ErrNotFound
	}
	m.Name = name
	m.UpdatedAt = time.Now()
	if s.db != nil {
		return s.db.Model(&projectRow{}).Where("id = ?", id).Update("name", name).Error
	}
	return s.persistFile()
}

// DeleteProject removes a project (the default project cannot be deleted).
func (s *Store) DeleteProject(id string) error {
	if id == DefaultProjectID {
		return ErrForbidden
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.root.Meta[id]; !ok {
		return ErrNotFound
	}
	delete(s.root.Meta, id)
	delete(s.root.Projects, id)
	if s.db != nil {
		if err := s.db.Delete(&projectRow{}, "id = ?", id).Error; err != nil {
			return err
		}
		return s.db.Delete(&memberRow{}, "project_id = ?", id).Error
	}
	return s.persistFile()
}

// SetMember adds or updates a member's role.
func (s *Store) SetMember(projectID, userID, role string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.root.Meta[projectID]
	if m == nil {
		return ErrNotFound
	}
	if m.Members == nil {
		m.Members = map[string]string{}
	}
	m.Members[userID] = role
	m.UpdatedAt = time.Now()
	if s.db != nil {
		return s.db.Save(&memberRow{ProjectID: projectID, UserID: userID, Role: role}).Error
	}
	return s.persistFile()
}

// RemoveMember revokes a member's access.
func (s *Store) RemoveMember(projectID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.root.Meta[projectID]
	if m == nil {
		return ErrNotFound
	}
	delete(m.Members, userID)
	if s.db != nil {
		return s.db.Delete(&memberRow{}, "project_id = ? AND user_id = ?", projectID, userID).Error
	}
	return s.persistFile()
}

// --- Users -----------------------------------------------------------------

// Users returns all users (without password hashes).
func (s *Store) Users() []User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]User, 0, len(s.root.Users))
	for _, u := range s.root.Users {
		cp := *u
		cp.PasswordHash = ""
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// FindUser returns a user by id.
func (s *Store) FindUser(id string) (*User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.root.Users[id]
	return u, ok
}

// UserCount returns the number of registered users.
func (s *Store) UserCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.root.Users)
}

// FindByUsername returns a user by username.
func (s *Store) FindByUsername(username string) (*User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.root.Users {
		if strings.EqualFold(u.Username, username) {
			return u, true
		}
	}
	return nil, false
}

// CreateUser registers a user.
func (s *Store) CreateUser(username, name, password, role string) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return User{}, errors.New("username and password are required")
	}
	if role == "" {
		role = "member"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.root.Users {
		if strings.EqualFold(u.Username, username) {
			return User{}, ErrConflict
		}
	}
	u := &User{ID: models.NewID(), Username: username, Name: name, PasswordHash: HashPassword(password), Role: role, CreatedAt: time.Now()}
	s.root.Users[u.ID] = u
	if s.db != nil {
		row := userRow{ID: u.ID, Username: u.Username, Name: u.Name, Password: u.PasswordHash, Role: u.Role, CreatedAt: u.CreatedAt}
		if err := s.db.Create(&row).Error; err != nil {
			delete(s.root.Users, u.ID)
			return User{}, err
		}
	} else if err := s.persistFile(); err != nil {
		return User{}, err
	}
	cp := *u
	cp.PasswordHash = ""
	return cp, nil
}

// UpdateUser edits a user's name, role and (optionally) password.
func (s *Store) UpdateUser(id, name, role, password string) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.root.Users[id]
	if u == nil {
		return User{}, ErrNotFound
	}
	if name != "" {
		u.Name = name
	}
	if role != "" {
		u.Role = role
	}
	if password != "" {
		u.PasswordHash = HashPassword(password)
	}
	if s.db != nil {
		if err := s.db.Model(&userRow{}).Where("id = ?", id).Updates(map[string]any{"name": u.Name, "role": u.Role, "password": u.PasswordHash}).Error; err != nil {
			return User{}, err
		}
	} else if err := s.persistFile(); err != nil {
		return User{}, err
	}
	cp := *u
	cp.PasswordHash = ""
	return cp, nil
}

// DeleteUser removes a user and their sessions.
func (s *Store) DeleteUser(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.root.Users[id]; !ok {
		return ErrNotFound
	}
	delete(s.root.Users, id)
	for t, se := range s.root.Sessions {
		if se.UserID == id {
			delete(s.root.Sessions, t)
		}
	}
	if s.db != nil {
		if err := s.db.Delete(&userRow{}, "id = ?", id).Error; err != nil {
			return err
		}
		if err := s.db.Delete(&sessionRow{}, "user_id = ?", id).Error; err != nil {
			return err
		}
		return s.db.Delete(&memberRow{}, "user_id = ?", id).Error
	}
	return s.persistFile()
}

// Authenticate verifies credentials, returning the user on success.
func (s *Store) Authenticate(username, password string) (*User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.root.Users {
		if strings.EqualFold(u.Username, username) {
			if VerifyPassword(password, u.PasswordHash) {
				return u, true
			}
			return nil, false
		}
	}
	return nil, false
}

// --- Sessions --------------------------------------------------------------

// CreateSession issues a session token for a user.
func (s *Store) CreateSession(userID string, ttl time.Duration) (Session, error) {
	if ttl <= 0 {
		ttl = 30 * 24 * time.Hour
	}
	tok := randomToken()
	se := &Session{Token: tok, UserID: userID, CreatedAt: time.Now(), ExpiresAt: time.Now().Add(ttl)}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.root.Sessions[tok] = se
	if s.db != nil {
		row := sessionRow{Token: se.Token, UserID: se.UserID, CreatedAt: se.CreatedAt, ExpiresAt: se.ExpiresAt}
		if err := s.db.Create(&row).Error; err != nil {
			delete(s.root.Sessions, tok)
			return Session{}, err
		}
	} else if err := s.persistFile(); err != nil {
		return Session{}, err
	}
	return *se, nil
}

// SessionUser resolves a session token to its user.
func (s *Store) SessionUser(token string) (*User, bool) {
	if token == "" {
		return nil, false
	}
	s.mu.RLock()
	se, ok := s.root.Sessions[token]
	if !ok || time.Now().After(se.ExpiresAt) {
		s.mu.RUnlock()
		return nil, false
	}
	u, ok := s.root.Users[se.UserID]
	s.mu.RUnlock()
	return u, ok
}

// DeleteSession logs a session out.
func (s *Store) DeleteSession(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.root.Sessions, token)
	if s.db != nil {
		return s.db.Delete(&sessionRow{}, "token = ?", token).Error
	}
	return s.persistFile()
}

// PurgeSessions removes expired sessions.
func (s *Store) PurgeSessions() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for t, se := range s.root.Sessions {
		if now.After(se.ExpiresAt) {
			delete(s.root.Sessions, t)
		}
	}
	if s.db != nil {
		_ = s.db.Delete(&sessionRow{}, "expires_at < ?", now).Error
	}
}

// randomToken returns a URL-safe random hex token.
func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// --- Password hashing (PBKDF2-HMAC-SHA256) ---------------------------------

const pbkdf2Iter = 100000

// HashPassword returns a salted PBKDF2 hash string.
func HashPassword(pw string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	key := pbkdf2SHA256([]byte(pw), salt, pbkdf2Iter, 32)
	return "pbkdf2$" + strconv.Itoa(pbkdf2Iter) + "$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(key)
}

// VerifyPassword checks a password against an encoded hash.
func VerifyPassword(pw, enc string) bool {
	parts := strings.Split(enc, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter <= 0 {
		return false
	}
	salt, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := pbkdf2SHA256([]byte(pw), salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hashLen := prf.Size()
	numBlocks := (keyLen + hashLen - 1) / hashLen
	var buf [4]byte
	dk := make([]byte, 0, numBlocks*hashLen)
	u := make([]byte, hashLen)
	for block := 1; block <= numBlocks; block++ {
		prf.Reset()
		prf.Write(salt)
		buf[0] = byte(block >> 24)
		buf[1] = byte(block >> 16)
		buf[2] = byte(block >> 8)
		buf[3] = byte(block)
		prf.Write(buf[:])
		t := prf.Sum(nil)
		copy(u, t)
		for n := 2; n <= iter; n++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(u[:0])
			for x := range u {
				t[x] ^= u[x]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

// --- Collections -----------------------------------------------------------

// Collections returns the collection tree.
func (s *Store) Collections() []*models.Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.data.Collections == nil {
		return []*models.Node{}
	}
	return s.data.Collections
}

// AddNode inserts a node. If parentID is non-empty the node is added as a
// child of that folder, otherwise at the root.
func (s *Store) AddNode(parentID string, node *models.Node) (*models.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if node.ID == "" {
		node.ID = models.NewID()
	}
	if parentID == "" {
		s.data.Collections = append(s.data.Collections, node)
	} else {
		parent := findNode(s.data.Collections, parentID)
		if parent == nil || parent.Type != "folder" {
			return nil, ErrNotFound
		}
		parent.Children = append(parent.Children, node)
	}
	return node, s.persist()
}

// UpdateNode replaces the fields of an existing node.
func (s *Store) UpdateNode(id string, update *models.Node) (*models.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := findNode(s.data.Collections, id)
	if n == nil {
		return nil, ErrNotFound
	}
	if update.Name != "" {
		n.Name = update.Name
	}
	if update.Request != nil {
		update.Request.ID = n.ID
		n.Request = update.Request
	}
	if update.Type != "" {
		n.Type = update.Type
	}
	return n, s.persist()
}

// DeleteNode removes a node (and its subtree) anywhere in the tree.
func (s *Store) DeleteNode(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !deleteNode(&s.data.Collections, id) {
		return ErrNotFound
	}
	return s.persist()
}

// MoveNode re-parents a node. When siblingID is set the node is inserted
// relative to that sibling (position "before" or "after"); otherwise it is
// appended to the target parent.
func (s *Store) MoveNode(id, newParentID, siblingID, position string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := findNode(s.data.Collections, id)
	if n == nil {
		return ErrNotFound
	}
	if newParentID != "" && isDescendant(n, newParentID) {
		return errors.New("cannot move a folder into itself")
	}
	if siblingID == id {
		return nil
	}
	deleteNode(&s.data.Collections, id)

	if newParentID == "" {
		s.data.Collections = insertRelative(s.data.Collections, siblingID, position, n)
	} else {
		parent := findNode(s.data.Collections, newParentID)
		if parent == nil || parent.Type != "folder" {
			return ErrNotFound
		}
		parent.Children = insertRelative(parent.Children, siblingID, position, n)
	}
	return s.persist()
}

// insertRelative inserts node before/after sibling, or appends when the sibling
// is absent.
func insertRelative(list []*models.Node, siblingID, position string, node *models.Node) []*models.Node {
	idx := len(list)
	if siblingID != "" {
		if i := indexOf(list, siblingID); i >= 0 {
			idx = i
			if position != "before" {
				idx = i + 1
			}
		}
	}
	if idx < 0 {
		idx = 0
	}
	if idx > len(list) {
		idx = len(list)
	}
	out := make([]*models.Node, 0, len(list)+1)
	out = append(out, list[:idx]...)
	out = append(out, node)
	out = append(out, list[idx:]...)
	return out
}

// DuplicateNode deep-copies a node (and its subtree) as a sibling, with a
// " copy" suffix and fresh IDs.
func (s *Store) DuplicateNode(id string) (*models.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	node := findNode(s.data.Collections, id)
	if node == nil {
		return nil, ErrNotFound
	}
	clone := cloneNode(node)
	clone.Name = node.Name + " copy"
	count := 0
	clone = reid(clone, &count)

	if parent := findParent(s.data.Collections, id); parent != nil {
		idx := indexOf(parent.Children, id)
		parent.Children = insertAfter(parent.Children, idx, clone)
	} else {
		idx := indexOf(s.data.Collections, id)
		s.data.Collections = insertAfter(s.data.Collections, idx, clone)
	}
	return clone, s.persist()
}

func cloneNode(n *models.Node) *models.Node {
	b, err := json.Marshal(n)
	if err != nil {
		return &models.Node{Type: n.Type, Name: n.Name}
	}
	var out models.Node
	if err := json.Unmarshal(b, &out); err != nil {
		return &models.Node{Type: n.Type, Name: n.Name}
	}
	return &out
}

func findParent(nodes []*models.Node, id string) *models.Node {
	for _, n := range nodes {
		for _, c := range n.Children {
			if c.ID == id {
				return n
			}
		}
		if p := findParent(n.Children, id); p != nil {
			return p
		}
	}
	return nil
}

func indexOf(list []*models.Node, id string) int {
	for i, n := range list {
		if n.ID == id {
			return i
		}
	}
	return -1
}

func insertAfter(list []*models.Node, idx int, node *models.Node) []*models.Node {
	if idx < 0 || idx >= len(list) {
		return append(list, node)
	}
	out := make([]*models.Node, 0, len(list)+1)
	out = append(out, list[:idx+1]...)
	out = append(out, node)
	out = append(out, list[idx+1:]...)
	return out
}

func findNode(nodes []*models.Node, id string) *models.Node {
	for _, n := range nodes {
		if n.ID == id {
			return n
		}
		if found := findNode(n.Children, id); found != nil {
			return found
		}
	}
	return nil
}

func isDescendant(n *models.Node, id string) bool {
	for _, c := range n.Children {
		if c.ID == id || isDescendant(c, id) {
			return true
		}
	}
	return false
}

func deleteNode(nodes *[]*models.Node, id string) bool {
	list := *nodes
	for i, n := range list {
		if n.ID == id {
			*nodes = append(list[:i:i], list[i+1:]...)
			return true
		}
		if deleteNode(&n.Children, id) {
			return true
		}
	}
	return false
}

// ImportNodes appends a parsed subtree (e.g. from an OpenAPI import) to the
// collection tree, assigning fresh IDs recursively. It returns the created
// top-level nodes and the total number of requests created.
func (s *Store) ImportNodes(parentID string, nodes []*models.Node) ([]*models.Node, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	prepared := make([]*models.Node, 0, len(nodes))
	for _, n := range nodes {
		prepared = append(prepared, reid(n, &count))
	}
	if parentID == "" {
		s.data.Collections = append(s.data.Collections, prepared...)
	} else {
		parent := findNode(s.data.Collections, parentID)
		if parent == nil || parent.Type != "folder" {
			return nil, 0, ErrNotFound
		}
		parent.Children = append(parent.Children, prepared...)
	}
	return prepared, count, s.persist()
}

func reid(n *models.Node, count *int) *models.Node {
	n.ID = models.NewID()
	if n.Request != nil {
		n.Request.ID = n.ID
	}
	for i, c := range n.Children {
		n.Children[i] = reid(c, count)
	}
	if n.Type == "request" {
		*count = *count + 1
	}
	return n
}

// FindNode returns a node by id.
func (s *Store) FindNode(id string) (*models.Node, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := findNode(s.data.Collections, id)
	return n, n != nil
}

// SetFolderConfig updates a folder's hierarchy settings: its variables, the
// setup request used to produce inherited values, and the extraction rules
// applied to that setup request's response.
func (s *Store) SetFolderConfig(id string, variables []models.KeyValue, setupNodeID string, extract []models.ExtractRule) (*models.Node, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := findNode(s.data.Collections, id)
	if n == nil {
		return nil, ErrNotFound
	}
	if n.Type != "folder" {
		return nil, errors.New("node is not a folder")
	}
	if setupNodeID != "" {
		target := findNode(s.data.Collections, setupNodeID)
		if target == nil || target.Type != "request" {
			return nil, errors.New("setup request not found")
		}
	}
	n.Variables = variables
	n.SetupNodeID = setupNodeID
	n.Extract = extract
	return n, s.persist()
}

// --- History ---------------------------------------------------------------

// History returns entries newest-first.
func (s *Store) History() []models.HistoryEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]models.HistoryEntry, len(s.data.History))
	copy(out, s.data.History)
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

// AddHistory prepends an entry and trims to the retention limit.
func (s *Store) AddHistory(e models.HistoryEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e.ID == "" {
		e.ID = models.NewID()
	}
	s.data.History = append([]models.HistoryEntry{e}, s.data.History...)
	if len(s.data.History) > s.historyN {
		s.data.History = s.data.History[:s.historyN]
	}
	return s.persist()
}

// ClearHistory removes all history.
func (s *Store) ClearHistory() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.History = nil
	return s.persist()
}

// DeleteHistory removes a single entry.
func (s *Store) DeleteHistory(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.data.History {
		if e.ID == id {
			s.data.History = append(s.data.History[:i], s.data.History[i+1:]...)
			return s.persist()
		}
	}
	return ErrNotFound
}

// --- Environments ----------------------------------------------------------

// Environments returns all environments.
func (s *Store) Environments() []models.Environment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.data.Environments == nil {
		return []models.Environment{}
	}
	return s.data.Environments
}

// SaveEnvironment creates or updates an environment.
func (s *Store) SaveEnvironment(env models.Environment) (models.Environment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if env.ID == "" {
		env.ID = models.NewID()
		s.data.Environments = append(s.data.Environments, env)
	} else {
		found := false
		for i := range s.data.Environments {
			if s.data.Environments[i].ID == env.ID {
				s.data.Environments[i] = env
				found = true
				break
			}
		}
		if !found {
			return env, ErrNotFound
		}
	}
	return env, s.persist()
}

// DeleteEnvironment removes an environment.
func (s *Store) DeleteEnvironment(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, e := range s.data.Environments {
		if e.ID == id {
			s.data.Environments = append(s.data.Environments[:i], s.data.Environments[i+1:]...)
			return s.persist()
		}
	}
	return ErrNotFound
}

// Schedules returns persisted schedule jobs.
func (s *Store) Schedules() []models.ScheduleJob {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]models.ScheduleJob, len(s.data.Schedules))
	copy(out, s.data.Schedules)
	return out
}

// SaveSchedules replaces the persisted schedule jobs.
func (s *Store) SaveSchedules(jobs []models.ScheduleJob) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Schedules = jobs
	return s.persist()
}

// --- captures (proxy) ------------------------------------------------------

// Captures returns recorded proxy traffic, newest first.
func (s *Store) Captures() []models.CaptureEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.data.Captures == nil {
		return []models.CaptureEntry{}
	}
	out := make([]models.CaptureEntry, len(s.data.Captures))
	copy(out, s.data.Captures)
	return out
}

// AddCapture prepends a capture and trims the retained history.
func (s *Store) AddCapture(entry models.CaptureEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry.ID == "" {
		entry.ID = models.NewID()
	}
	s.data.Captures = append([]models.CaptureEntry{entry}, s.data.Captures...)
	if len(s.data.Captures) > 300 {
		s.data.Captures = s.data.Captures[:300]
	}
	return s.persist()
}

// ClearCaptures removes all captured traffic.
func (s *Store) ClearCaptures() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Captures = nil
	return s.persist()
}

// PurgeCaptures deletes captures older than ttl (ttl <= 0 disables expiry).
func (s *Store) PurgeCaptures(ttl time.Duration) error {
	if ttl <= 0 {
		return nil
	}
	cutoff := time.Now().Add(-ttl).UnixMilli()
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := make([]models.CaptureEntry, 0, len(s.data.Captures))
	changed := false
	for _, c := range s.data.Captures {
		if c.At >= cutoff {
			kept = append(kept, c)
		} else {
			changed = true
		}
	}
	if !changed {
		return nil
	}
	s.data.Captures = kept
	return s.persist()
}

// MockHits returns persisted mock access history.
func (s *Store) MockHits() map[string][]models.MockHit {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string][]models.MockHit, len(s.data.MockHits))
	for k, v := range s.data.MockHits {
		cp := make([]models.MockHit, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

// SaveMockHits replaces the persisted mock hit history.
func (s *Store) SaveMockHits(hits map[string][]models.MockHit) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.MockHits = hits
	return s.persist()
}

// --- Settings (global, shared across projects) -----------------------------

// Settings returns application settings.
func (s *Store) Settings() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]string{}
	for k, v := range s.root.Global {
		out[k] = v
	}
	return out
}

// SaveSettings merges settings.
func (s *Store) SaveSettings(in map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range in {
		s.root.Global[k] = v
	}
	if s.db != nil {
		for k, v := range in {
			if err := s.db.Save(&settingRow{Key: k, Value: v}).Error; err != nil {
				return err
			}
		}
		return nil
	}
	return s.persistFile()
}

// Snapshot returns a copy of the active project's document.
func (s *Store) Snapshot() Data {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return *s.data
}
