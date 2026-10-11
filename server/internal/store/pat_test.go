package store

import "testing"

func TestPATLifecycle(t *testing.T) {
	st, err := Open(Options{Path: t.TempDir() + "/store.json"})
	if err != nil {
		t.Fatal(err)
	}
	u, err := st.CreateUser("alice", "Alice", "pw", "admin")
	if err != nil {
		t.Fatal(err)
	}

	pat, token, err := st.CreatePAT(u.ID, "agent", []string{ScopeRead, ScopeMCP}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || pat.ID == "" {
		t.Fatal("empty token/id")
	}
	if pat.Hash == token {
		t.Error("token must be stored hashed")
	}

	got, gu, ok := st.PATByToken(token)
	if !ok || gu.ID != u.ID {
		t.Fatal("PATByToken failed")
	}
	if !got.Has(ScopeRead) || !got.Has(ScopeMCP) {
		t.Errorf("scopes = %v", got.Scopes)
	}
	if got.Has(ScopeWrite) {
		t.Error("read+mcp token must not grant write")
	}
	if !got.Has(ScopeWrite) && got.Has(ScopeAdmin) {
		t.Error("admin implied unexpectedly")
	}

	// A bogus token must not resolve.
	if _, _, ok := st.PATByToken(PATPrefix + "deadbeef"); ok {
		t.Error("bogus token resolved")
	}
	if _, _, ok := st.PATByToken("not-a-pat"); ok {
		t.Error("non-PAT token resolved")
	}

	if err := st.DeletePAT(pat.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := st.PATByToken(token); ok {
		t.Error("revoked token still resolves")
	}
}

func TestPATScopeValidation(t *testing.T) {
	st, err := Open(Options{Path: t.TempDir() + "/store.json"})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := st.CreateUser("bob", "Bob", "pw", "member")
	// Unknown scopes are dropped; an empty result falls back to read.
	pat, _, err := st.CreatePAT(u.ID, "", []string{"bogus"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pat.Scopes) != 1 || pat.Scopes[0] != ScopeRead {
		t.Errorf("scopes = %v, want [read]", pat.Scopes)
	}
	if pat.Name != "token" {
		t.Errorf("name = %q", pat.Name)
	}
}

func TestPATAdminImpliesAll(t *testing.T) {
	st, err := Open(Options{Path: t.TempDir() + "/store.json"})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := st.CreateUser("carol", "Carol", "pw", "admin")
	pat, _, _ := st.CreatePAT(u.ID, "root", []string{ScopeAdmin}, 0)
	for _, sc := range []string{ScopeRead, ScopeWrite, ScopeSend, ScopeMCP, ScopeAI, ScopeAdmin} {
		if !pat.Has(sc) {
			t.Errorf("admin token should grant %s", sc)
		}
	}
}

// A store that has a project but no metadata (older files) must still grant
// access — this was the cause of a spurious "no access to project" 403.
func TestDefaultProjectMetaIsRepaired(t *testing.T) {
	st, err := Open(Options{Path: t.TempDir() + "/store.json"})
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a legacy file: project present, metadata missing.
	st.mu.Lock()
	delete(st.root.Meta, DefaultProjectID)
	st.mu.Unlock()
	st.ensureDefaultProject()

	if _, ok := st.Role(DefaultProjectID, "someone", true); !ok {
		t.Error("admin should always have access to the default project")
	}
	if _, ok := st.Role(DefaultProjectID, "someone", false); !ok {
		t.Error("default project should be open to members")
	}
}
