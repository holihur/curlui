package store

import "testing"

func TestUserAIConfigIsPerUser(t *testing.T) {
	st, err := Open(Options{Path: t.TempDir() + "/store.json"})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := st.CreateUser("a", "A", "pw", "member")
	b, _ := st.CreateUser("b", "B", "pw", "member")

	if err := st.SetAIConfig(a.ID, UserAI{Provider: "anthropic", APIKey: "key-a", BaseURL: "https://a", Model: "m-a"}); err != nil {
		t.Fatal(err)
	}
	if cfg := st.AIConfigFor(a.ID); !cfg.Configured() || cfg.APIKey != "key-a" {
		t.Errorf("user A config = %+v", cfg)
	}
	// User B must not see user A's key.
	if cfg := st.AIConfigFor(b.ID); cfg.Configured() || cfg.APIKey != "" {
		t.Errorf("user B leaked A's config: %+v", cfg)
	}

	// An empty key keeps the stored secret (the browser never round-trips it).
	if err := st.SetAIConfig(a.ID, UserAI{Provider: "openai", BaseURL: "https://b", Model: "m-b"}); err != nil {
		t.Fatal(err)
	}
	cfg := st.AIConfigFor(a.ID)
	if cfg.APIKey != "key-a" {
		t.Errorf("secret was cleared: %+v", cfg)
	}
	if cfg.Provider != "openai" || cfg.Model != "m-b" || cfg.BaseURL != "https://b" {
		t.Errorf("non-secret fields not updated: %+v", cfg)
	}

	// A new key replaces the old one.
	st.SetAIConfig(a.ID, UserAI{Provider: "openai", APIKey: "key-a2", Model: "m-b"})
	if got := st.AIConfigFor(a.ID).APIKey; got != "key-a2" {
		t.Errorf("key = %q, want key-a2", got)
	}
	if err := st.SetAIConfig("nope", UserAI{}); err == nil {
		t.Error("expected an error for an unknown user")
	}
}
