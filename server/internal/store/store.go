package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"curlui/server/internal/models"
)

// ErrNotFound is returned when an entity cannot be located.
var ErrNotFound = errors.New("not found")

// Data is the persisted document.
type Data struct {
	Collections  []*models.Node              `json:"collections"`
	Environments []models.Environment        `json:"environments"`
	History      []models.HistoryEntry       `json:"history"`
	Schedules    []models.ScheduleJob        `json:"schedules,omitempty"`
	MockHits     map[string][]models.MockHit `json:"mockHits,omitempty"`
	Captures     []models.CaptureEntry       `json:"captures,omitempty"`
	Settings     map[string]string           `json:"settings"`
}

// Store is a concurrency-safe JSON file store.
type Store struct {
	mu       sync.RWMutex
	path     string
	data     Data
	historyN int // max history entries to retain
}

// Open loads (or creates) the store at path.
func Open(path string) (*Store, error) {
	s := &Store{path: path, historyN: 500}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			s.data = Data{Settings: map[string]string{}}
			return s, s.persist()
		}
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &s.data); err != nil {
			// Corrupt file: back it up rather than losing data.
			_ = os.WriteFile(path+".bak", raw, 0o644)
			s.data = Data{Settings: map[string]string{}}
		}
	}
	if s.data.Settings == nil {
		s.data.Settings = map[string]string{}
	}
	return s, nil
}

// persist must be called with the lock held.
func (s *Store) persist() error {
	raw, err := json.MarshalIndent(&s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Snapshot returns a copy of the whole document.
func (s *Store) Snapshot() Data {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data
}

// --- Collections -----------------------------------------------------------

// Collections returns the collection tree.
func (s *Store) Collections() []*models.Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
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

// --- Settings --------------------------------------------------------------

// Settings returns application settings.
func (s *Store) Settings() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := map[string]string{}
	for k, v := range s.data.Settings {
		out[k] = v
	}
	return out
}

// SaveSettings merges settings.
func (s *Store) SaveSettings(in map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range in {
		s.data.Settings[k] = v
	}
	return s.persist()
}
