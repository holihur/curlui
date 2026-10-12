package totp

import (
	"testing"
	"time"
)

func TestCodeIsStableAndValid(t *testing.T) {
	secret, err := GenerateSecret()
	if err != nil {
		t.Fatal(err)
	}
	code, err := Code(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatalf("code = %q", code)
	}
	if !Validate(secret, code, 1) {
		t.Error("the current code must validate")
	}
	if Validate(secret, "000000", 0) && code != "000000" {
		t.Error("a wrong code validated")
	}
	if Validate(secret, "12345", 1) {
		t.Error("a short code validated")
	}
}

// RFC 6238 test vector (SHA-1, 8 digits truncated to 6): the 59s step.
func TestRFC6238Vector(t *testing.T) {
	// The RFC uses the ASCII secret "12345678901234567890".
	secret := b32.EncodeToString([]byte("12345678901234567890"))
	code, err := Code(secret, time.Unix(59, 0))
	if err != nil {
		t.Fatal(err)
	}
	if code != "287082" {
		t.Fatalf("code at t=59 = %q, want 287082", code)
	}
}

func TestNormalizeAcceptsFormatting(t *testing.T) {
	secret, _ := GenerateSecret()
	spaced := ""
	for i, c := range secret {
		if i > 0 && i%4 == 0 {
			spaced += " "
		}
		spaced += string(c)
	}
	now := time.Now()
	a, _ := Code(secret, now)
	b, err := Code(spaced, now)
	if err != nil || a != b {
		t.Fatalf("formatted secret produced %q (%v), want %q", b, err, a)
	}
}

func TestProvisioningURL(t *testing.T) {
	u := ProvisioningURL("curlui", "alice", "ABCDEF")
	for _, want := range []string{"otpauth://totp/", "secret=ABCDEF", "issuer=curlui", "curlui:alice"} {
		if !contains(u, want) {
			t.Errorf("provisioning URL %q is missing %q", u, want)
		}
	}
}

func TestRecoveryCodes(t *testing.T) {
	codes := RecoveryCodes(10)
	if len(codes) != 10 {
		t.Fatalf("got %d codes", len(codes))
	}
	seen := map[string]bool{}
	for _, c := range codes {
		if len(c) != 9 || c[4] != '-' {
			t.Errorf("code %q has the wrong shape", c)
		}
		if seen[c] {
			t.Errorf("duplicate code %q", c)
		}
		seen[c] = true
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
