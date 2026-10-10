package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"curlui/server/internal/oidc"
	"curlui/server/internal/store"
)

type ctxKey int

const (
	ctxUser ctxKey = iota
	ctxProject
	ctxToken
)

const (
	sessionCookie = "curlui_session"
	projectCookie = "curlui_project"
	sessionTTL    = 30 * 24 * time.Hour
)

// anonymousUser is the implicit identity when authentication is disabled, so
// every feature keeps working without logging in.
func anonymousUser() *store.User {
	return &store.User{ID: store.AnonymousUserID, Username: "local", Name: "Local user", Role: "admin"}
}

// authEnabled reports whether login is required.
func (s *Server) authEnabled() bool {
	return s.store.Settings()["authEnabled"] == "1"
}

// db returns the store view for the request's active project.
func (s *Server) db(r *http.Request) *store.Store {
	return s.store.Project(projectIDFrom(r))
}

func userFrom(r *http.Request) *store.User {
	if u, ok := r.Context().Value(ctxUser).(*store.User); ok && u != nil {
		return u
	}
	return anonymousUser()
}

func projectIDFrom(r *http.Request) string {
	if p, ok := r.Context().Value(ctxProject).(string); ok && p != "" {
		return p
	}
	return store.DefaultProjectID
}

func tokenFrom(r *http.Request) string {
	if t, ok := r.Context().Value(ctxToken).(string); ok {
		return t
	}
	return ""
}

func isAdmin(r *http.Request) bool {
	return userFrom(r).Role == "admin"
}

// listAudit returns the audit trail (admins only).
func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": s.store.Audit(200)})
}

func isWriteMethod(m string) bool {
	switch m {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

func randToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// --- OpenID Connect (SSO) --------------------------------------------------

type oidcState struct {
	nonce   string
	created time.Time
}

var oidcStates = struct {
	sync.Mutex
	m map[string]oidcState
}{m: map[string]oidcState{}}

func (s *Server) oidcConfigured() (issuer, clientID, clientSecret, scopes, label string, ok bool) {
	st := s.store.Settings()
	issuer = strings.TrimSpace(st["oidcIssuer"])
	clientID = strings.TrimSpace(st["oidcClientId"])
	clientSecret = st["oidcClientSecret"]
	scopes = strings.TrimSpace(st["oidcScopes"])
	if scopes == "" {
		scopes = "openid email profile"
	}
	label = strings.TrimSpace(st["oidcButtonLabel"])
	if label == "" {
		label = "SSO"
	}
	ok = st["oidcEnabled"] == "1" && issuer != "" && clientID != ""
	return
}

// oidcConfig is public so the login screen can show the SSO button.
func (s *Server) oidcConfig(w http.ResponseWriter, r *http.Request) {
	_, _, _, _, label, ok := s.oidcConfigured()
	writeJSON(w, http.StatusOK, map[string]any{"enabled": ok, "label": label})
}

func (s *Server) oidcStart(w http.ResponseWriter, r *http.Request) {
	issuer, clientID, _, scopes, _, ok := s.oidcConfigured()
	if !ok {
		writeErr(w, http.StatusBadRequest, "oidc is not configured")
		return
	}
	p, err := oidc.Discover(r.Context(), issuer)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	state := randToken(16)
	nonce := randToken(16)
	oidcStates.Lock()
	for k, v := range oidcStates.m {
		if time.Since(v.created) > 10*time.Minute {
			delete(oidcStates.m, k)
		}
	}
	oidcStates.m[state] = oidcState{nonce: nonce, created: time.Now()}
	oidcStates.Unlock()

	http.Redirect(w, r, p.AuthURL(clientID, baseURL(r)+"/api/auth/oidc/callback", scopes, state, nonce), http.StatusFound)
}

func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	issuer, clientID, clientSecret, scopes, _, ok := s.oidcConfigured()
	if !ok {
		writeErr(w, http.StatusBadRequest, "oidc is not configured")
		return
	}
	_ = scopes
	state := r.URL.Query().Get("state")
	oidcStates.Lock()
	st, found := oidcStates.m[state]
	delete(oidcStates.m, state)
	oidcStates.Unlock()
	if !found || time.Since(st.created) > 10*time.Minute {
		writeErr(w, http.StatusBadRequest, "invalid or expired state")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		writeErr(w, http.StatusBadRequest, "missing authorization code")
		return
	}
	p, err := oidc.Discover(r.Context(), issuer)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	tokens, err := p.Exchange(r.Context(), clientID, clientSecret, baseURL(r)+"/api/auth/oidc/callback", code)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}

	claims := &oidc.Claims{}
	if tokens.IDToken != "" {
		claims, err = oidc.ParseIDToken(r.Context(), p, tokens.IDToken, clientID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
	} else if tokens.AccessToken != "" && p.UserinfoEndpoint != "" {
		// Fall back to the userinfo endpoint when there is no ID token.
		claims, err = userinfo(r.Context(), p.UserinfoEndpoint, tokens.AccessToken)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
	}

	username := firstNonEmpty(claims.PreferredUsername, claims.Email, claims.Sub)
	if username == "" {
		writeErr(w, http.StatusBadGateway, "oidc: no username claim")
		return
	}
	settings := s.store.Settings()
	user, found := s.store.FindByUsername(username)
	if !found && claims.Email != "" {
		user, found = s.store.FindByUsername(claims.Email)
	}
	if !found {
		if settings["oidcAutoCreate"] == "0" {
			writeErr(w, http.StatusForbidden, "no account for "+username)
			return
		}
		role := settings["oidcDefaultRole"]
		if role == "" {
			role = "member"
		}
		created, cerr := s.store.CreateUser(username, firstNonEmpty(claims.Name, username), "oidc!"+randToken(12), role)
		if cerr != nil {
			writeErr(w, http.StatusBadRequest, cerr.Error())
			return
		}
		user = &created
	}

	se, err := s.store.CreateSession(user.ID, sessionTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: se.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
	s.store.AddAudit(store.AuditEntry{User: user.Username, Action: "login.oidc", Target: user.ID})
	http.Redirect(w, r, "/", http.StatusFound)
}

func userinfo(ctx context.Context, endpoint, accessToken string) (*oidc.Claims, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var claims oidc.Claims
	if err := json.NewDecoder(resp.Body).Decode(&claims); err != nil {
		return nil, err
	}
	return &claims, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// baseURL reconstructs the externally visible base URL for redirects.
func baseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		scheme = strings.Split(p, ",")[0]
	}
	host := r.Host
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		host = strings.Split(h, ",")[0]
	}
	return scheme + "://" + host
}

// requestToken extracts the session token from the Authorization header or
// the session cookie.
func requestToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		return c.Value
	}
	return ""
}

// withAuth resolves the caller and active project, then enforces access when
// authentication is enabled. Public endpoints (health, auth, mock server) and
// non-API paths are passed through.
func (s *Server) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		public := path == "/api/health" || strings.HasPrefix(path, "/api/auth/") ||
			strings.HasPrefix(path, "/mock/") || path == "/mcp" || !strings.HasPrefix(path, "/api/")

		token := requestToken(r)
		var user *store.User
		if token != "" {
			if u, ok := s.store.SessionUser(token); ok {
				user = u
			}
		}
		if user == nil && !s.authEnabled() {
			user = anonymousUser()
		}
		if user == nil && !public {
			writeErr(w, http.StatusUnauthorized, "authentication required")
			return
		}

		ctx := r.Context()
		if user != nil {
			ctx = context.WithValue(ctx, ctxUser, user)
		}
		ctx = context.WithValue(ctx, ctxToken, token)

		// Resolve the active project.
		pid := strings.TrimSpace(r.Header.Get("X-Project"))
		if pid == "" {
			if c, err := r.Cookie(projectCookie); err == nil {
				pid = c.Value
			}
		}
		if pid == "" {
			pid = store.DefaultProjectID
		}
		if user != nil {
			if _, ok := s.store.Role(pid, user.ID, user.Role == "admin"); !ok {
				if s.authEnabled() {
					writeErr(w, http.StatusForbidden, "no access to project")
					return
				}
				pid = store.DefaultProjectID
			}
		}
		ctx = context.WithValue(ctx, ctxProject, pid)

		// Viewers are read-only across the data API.
		if user != nil && !public && isWriteMethod(r.Method) && strings.HasPrefix(path, "/api/") &&
			!strings.HasPrefix(path, "/api/auth/") {
			if role, ok := s.store.Role(pid, user.ID, user.Role == "admin"); ok && role == "viewer" {
				writeErr(w, http.StatusForbidden, "viewer role is read-only")
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// --- auth endpoints --------------------------------------------------------

func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r)
	pid := projectIDFrom(r)
	projects := s.store.Projects(user.ID, user.Role == "admin")
	role, _ := s.store.Role(pid, user.ID, user.Role == "admin")
	authed := !s.authEnabled() || tokenFrom(r) != ""
	out := map[string]any{
		"authEnabled":   s.authEnabled(),
		"authenticated": authed,
		"userCount":     s.store.UserCount(),
		"user":          publicUser(user),
		"project":       pid,
		"role":          role,
		"projects":      projects,
	}
	writeJSON(w, http.StatusOK, out)
}

func publicUser(u *store.User) map[string]any {
	if u == nil {
		return nil
	}
	return map[string]any{"id": u.ID, "username": u.Username, "name": u.Name, "role": u.Role}
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u, ok := s.store.Authenticate(in.Username, in.Password)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	se, err := s.store.CreateSession(u.ID, sessionTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: se.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
	s.store.AddAudit(store.AuditEntry{User: u.Username, Action: "login", Target: u.ID})
	writeJSON(w, http.StatusOK, map[string]any{"token": se.Token, "user": publicUser(u)})
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	if t := tokenFrom(r); t != "" {
		_ = s.store.DeleteSession(t)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// authBootstrap creates the first admin account (only when no users exist).
func (s *Server) authBootstrap(w http.ResponseWriter, r *http.Request) {
	if s.store.UserCount() > 0 {
		writeErr(w, http.StatusConflict, "already initialised")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u, err := s.store.CreateUser(in.Username, in.Name, in.Password, "admin")
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	se, err := s.store.CreateSession(u.ID, sessionTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: se.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
	writeJSON(w, http.StatusOK, map[string]any{"token": se.Token, "user": publicUser(&u)})
}

// --- user management -------------------------------------------------------

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if !isAdmin(r) {
		writeErr(w, http.StatusForbidden, "admin role required")
		return false
	}
	return true
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": s.store.Users()})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Role     string `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u, err := s.store.CreateUser(in.Username, in.Name, in.Password, in.Role)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: userFrom(r).Username, Action: "user.create", Target: u.ID, Detail: u.Username})
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var in struct {
		Name     string `json:"name"`
		Role     string `json:"role"`
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u, err := s.store.UpdateUser(r.PathValue("id"), in.Name, in.Role, in.Password)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	if err := s.store.DeleteUser(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- project management ----------------------------------------------------

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	writeJSON(w, http.StatusOK, map[string]any{"projects": s.store.Projects(u.ID, u.Role == "admin")})
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		ID   string `json:"id"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u := userFrom(r)
	meta, err := s.store.CreateProject(in.ID, in.Name, u.ID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: u.Username, Action: "project.create", Target: meta.ID, Detail: meta.Name})
	writeJSON(w, http.StatusCreated, meta)
}

func (s *Server) updateProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.canManageProject(r, id) {
		writeErr(w, http.StatusForbidden, "not allowed")
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.RenameProject(id, in.Name); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.canManageProject(r, id) {
		writeErr(w, http.StatusForbidden, "not allowed")
		return
	}
	if err := s.store.DeleteProject(id); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) setProjectMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.canManageProject(r, id) {
		writeErr(w, http.StatusForbidden, "not allowed")
		return
	}
	var in struct {
		UserID string `json:"userId"`
		Role   string `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, ok := s.store.FindUser(in.UserID); !ok {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if in.Role == "" {
		in.Role = "member"
	}
	if err := s.store.SetMember(id, in.UserID, in.Role); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: userFrom(r).Username, Action: "member.add", Target: id, Detail: in.UserID + ":" + in.Role})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) removeProjectMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.canManageProject(r, id) {
		writeErr(w, http.StatusForbidden, "not allowed")
		return
	}
	if err := s.store.RemoveMember(id, r.PathValue("userId")); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// canManageProject reports whether the caller may change a project's settings.
func (s *Server) canManageProject(r *http.Request, id string) bool {
	u := userFrom(r)
	if u.Role == "admin" {
		return true
	}
	role, ok := s.store.Role(id, u.ID, false)
	return ok && (role == "owner" || role == "admin")
}
