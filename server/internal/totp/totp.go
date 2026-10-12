// Package totp implements time-based one-time passwords (RFC 6238) with no
// external dependencies, plus the recovery codes that go with them.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	digits = 6
	period = 30 * time.Second
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateSecret returns a fresh base32 secret (160 bits, as recommended).
func GenerateSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return b32.EncodeToString(buf), nil
}

// normalize accepts secrets with spaces/dashes and any case.
func normalize(secret string) string {
	s := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(secret, " ", ""), "-", ""))
	return strings.TrimRight(s, "=")
}

// Code returns the 6-digit code for a secret at time t.
func Code(secret string, t time.Time) (string, error) {
	key, err := b32.DecodeString(normalize(secret))
	if err != nil {
		return "", fmt.Errorf("invalid secret: %w", err)
	}
	counter := uint64(t.Unix() / int64(period.Seconds()))

	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", digits, value%1_000_000), nil
}

// Validate checks a code against the secret, allowing ±window steps for clock
// skew (window=1 means the previous, current and next step are accepted).
func Validate(secret, code string, window int) bool {
	code = strings.TrimSpace(code)
	if len(code) != digits {
		return false
	}
	now := time.Now()
	for i := -window; i <= window; i++ {
		want, err := Code(secret, now.Add(time.Duration(i)*period))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// ProvisioningURL is the otpauth:// URI authenticator apps scan.
func ProvisioningURL(issuer, account, secret string) string {
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprint(digits))
	q.Set("period", fmt.Sprint(int(period.Seconds())))
	return "otpauth://totp/" + url.PathEscape(issuer+":"+account) + "?" + q.Encode()
}

// RecoveryCodes returns n single-use codes of the form xxxx-xxxx.
func RecoveryCodes(n int) []string {
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789" // no look-alikes
	out := make([]string, 0, n)
	buf := make([]byte, 8)
	for i := 0; i < n; i++ {
		if _, err := rand.Read(buf); err != nil {
			return out
		}
		var b strings.Builder
		for j, c := range buf {
			if j == 4 {
				b.WriteByte('-')
			}
			b.WriteByte(alphabet[int(c)%len(alphabet)])
		}
		out = append(out, b.String())
	}
	return out
}
