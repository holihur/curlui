//go:build !core

package api

import (
	"net/http"
	"sync"
	"time"

	"curlui/server/internal/store"
	"curlui/server/internal/totp"
)

// --- two-factor authentication (TOTP) ---------------------------------------

// Pending a login that passed the password step but still needs a TOTP code.
type totpChallenge struct {
	userID  string
	expires time.Time
}

var (
	challengeMu sync.Mutex
	challenges  = map[string]totpChallenge{}
)

func newChallenge(userID string) string {
	id := store.NewToken()
	challengeMu.Lock()
	defer challengeMu.Unlock()
	// Opportunistically drop expired challenges.
	for k, c := range challenges {
		if time.Now().After(c.expires) {
			delete(challenges, k)
		}
	}
	challenges[id] = totpChallenge{userID: userID, expires: time.Now().Add(5 * time.Minute)}
	return id
}

func takeChallenge(id string) (string, bool) {
	challengeMu.Lock()
	defer challengeMu.Unlock()
	c, ok := challenges[id]
	if !ok || time.Now().After(c.expires) {
		delete(challenges, id)
		return "", false
	}
	delete(challenges, id)
	return c.userID, true
}

// authLogin2FA completes a login that required a second factor.
func (s *Server) authLogin2FA(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	userID, ok := takeChallenge(in.Challenge)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "this login attempt expired — start again")
		return
	}
	u, ok := s.store.FindUser(userID)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if !s.verifySecondFactor(u, in.Code) {
		s.store.AddAudit(store.AuditEntry{User: u.Username, Action: "login.2fa.failed", Target: u.ID})
		writeErr(w, http.StatusUnauthorized, "invalid authentication code")
		return
	}
	s.issueSession(w, u, "login.2fa")
}

// verifySecondFactor accepts a TOTP code or a recovery code.
func (s *Server) verifySecondFactor(u *store.User, code string) bool {
	if u.TOTPSecret != "" && totp.Validate(u.TOTPSecret, code, 1) {
		return true
	}
	return s.store.ConsumeRecoveryCode(u.ID, code)
}

// issueSession creates the session cookie and returns the login payload.
func (s *Server) issueSession(w http.ResponseWriter, u *store.User, action string) {
	se, err := s.store.CreateSession(u.ID, sessionTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: se.Token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds()),
	})
	s.store.AddAudit(store.AuditEntry{User: u.Username, Action: action, Target: u.ID})
	writeJSON(w, http.StatusOK, map[string]any{"token": se.Token, "user": publicUser(u)})
}

// twoFASetup generates a secret and the recovery codes (not yet enabled).
func (s *Server) twoFASetup(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	secret, err := totp.GenerateSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	codes := totp.RecoveryCodes(10)
	hashed := make([]string, 0, len(codes))
	for _, c := range codes {
		hashed = append(hashed, store.HashToken(c))
	}
	// Store the secret but leave 2FA disabled until a code is confirmed.
	if err := s.store.SetTOTP(u.ID, secret, false, hashed); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"secret":        secret,
		"otpauth":       totp.ProvisioningURL("curlui", u.Username, secret),
		"recoveryCodes": codes,
	})
}

// twoFAEnable turns 2FA on once the user proves they can generate a code.
func (s *Server) twoFAEnable(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var in struct {
		Code string `json:"code"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if u.TOTPSecret == "" {
		writeErr(w, http.StatusBadRequest, "run the setup step first")
		return
	}
	if !totp.Validate(u.TOTPSecret, in.Code, 1) {
		writeErr(w, http.StatusUnauthorized, "that code is not valid — check your authenticator's clock")
		return
	}
	if err := s.store.SetTOTP(u.ID, u.TOTPSecret, true, nil); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: u.Username, Action: "2fa.enable", Target: u.ID})
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true})
}

// twoFADisable turns 2FA off (requires a valid code or the password).
func (s *Server) twoFADisable(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var in struct {
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	ok := false
	if in.Password != "" {
		_, ok = s.store.Authenticate(u.Username, in.Password)
	}
	if !ok && in.Code != "" {
		ok = s.verifySecondFactor(u, in.Code)
	}
	if !ok {
		writeErr(w, http.StatusUnauthorized, "enter your password or a valid code")
		return
	}
	if err := s.store.SetTOTP(u.ID, "", false, nil); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: u.Username, Action: "2fa.disable", Target: u.ID})
	writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
}

// --- passwords --------------------------------------------------------------

// changePassword lets a signed-in user rotate their own password.
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var in struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(in.New) < 8 {
		writeErr(w, http.StatusBadRequest, "the new password must be at least 8 characters")
		return
	}
	if _, ok := s.store.Authenticate(u.Username, in.Current); !ok {
		writeErr(w, http.StatusUnauthorized, "the current password is wrong")
		return
	}
	if err := s.store.SetPassword(u.ID, in.New); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: u.Username, Action: "password.change", Target: u.ID})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// adminResetPassword issues a single-use reset token for another user. Without
// an SMTP setup the admin hands the link over out of band.
func (s *Server) adminResetPassword(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		writeErr(w, http.StatusForbidden, "admin role required")
		return
	}
	id := r.PathValue("id")
	target, ok := s.store.FindUser(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	token, err := s.store.CreatePasswordReset(id, time.Hour)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.store.AddAudit(store.AuditEntry{User: userFrom(r).Username, Action: "password.reset.issue", Target: id, Detail: target.Username})
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"expiresIn": 3600,
		"link":      "/?reset=" + token,
	})
}

// resetPassword redeems a reset token and sets a new password.
func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
		New   string `json:"new"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(in.New) < 8 {
		writeErr(w, http.StatusBadRequest, "the new password must be at least 8 characters")
		return
	}
	userID, ok := s.store.ConsumePasswordReset(in.Token)
	if !ok {
		writeErr(w, http.StatusBadRequest, "this reset link is invalid or has expired")
		return
	}
	if err := s.store.SetPassword(userID, in.New); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Changing a password invalidates every existing session for that user.
	s.store.DeleteUserSessions(userID)
	if u, ok := s.store.FindUser(userID); ok {
		s.store.AddAudit(store.AuditEntry{User: u.Username, Action: "password.reset", Target: userID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) registerTwoFARoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/login/2fa", s.authLogin2FA)
	mux.HandleFunc("POST /api/auth/2fa/setup", s.twoFASetup)
	mux.HandleFunc("POST /api/auth/2fa/enable", s.twoFAEnable)
	mux.HandleFunc("POST /api/auth/2fa/disable", s.twoFADisable)
	mux.HandleFunc("POST /api/auth/change-password", s.changePassword)
	mux.HandleFunc("POST /api/auth/reset", s.resetPassword)
	mux.HandleFunc("POST /api/users/{id}/reset", s.adminResetPassword)
}
