package variables

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"curlui/server/internal/models"
)

var placeholder = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

// Set holds variable values for substitution.
type Set map[string]string

// FromEnvironment builds a Set from enabled environment variables.
func FromEnvironment(env *models.Environment) Set {
	s := Set{}
	if env == nil {
		return s
	}
	for _, v := range env.Variables {
		if v.Enabled && v.Key != "" {
			s[v.Key] = v.Value
		}
	}
	return s
}

// Merge overlays other on top of s (other wins).
func (s Set) Merge(other Set) Set {
	out := Set{}
	for k, v := range s {
		out[k] = v
	}
	for k, v := range other {
		out[k] = v
	}
	return out
}

// Resolve replaces {{name}} placeholders. Unknown names are left intact so
// the user can see what is missing. Dynamic {{$...}} variables are expanded
// every call.
func (s Set) Resolve(input string) string {
	if !strings.Contains(input, "{{") {
		return input
	}
	return placeholder.ReplaceAllStringFunc(input, func(m string) string {
		name := strings.TrimSpace(placeholder.FindStringSubmatch(m)[1])
		if strings.HasPrefix(name, "$") {
			if v := dynamic(name); v != "" {
				return v
			}
		}
		if v, ok := s[name]; ok {
			return v
		}
		return m
	})
}

// ResolveRequest returns a deep-ish copy with all strings substituted.
func (s Set) ResolveRequest(r models.RequestDef) models.RequestDef {
	out := r
	out.URL = s.Resolve(r.URL)
	out.Headers = s.resolveKV(r.Headers)
	out.Params = s.resolveKV(r.Params)
	out.Auth.Username = s.Resolve(r.Auth.Username)
	out.Auth.Password = s.Resolve(r.Auth.Password)
	out.Auth.Token = s.Resolve(r.Auth.Token)
	out.Auth.Key = s.Resolve(r.Auth.Key)
	out.Auth.Value = s.Resolve(r.Auth.Value)
	out.Body.Raw = s.Resolve(r.Body.Raw)
	out.Body.FilePath = s.Resolve(r.Body.FilePath)
	out.Body.Form = s.resolveKV(r.Body.Form)
	return out
}

func (s Set) resolveKV(in []models.KeyValue) []models.KeyValue {
	out := make([]models.KeyValue, len(in))
	for i, kv := range in {
		out[i] = kv
		out[i].Key = s.Resolve(kv.Key)
		out[i].Value = s.Resolve(kv.Value)
		out[i].FilePath = s.Resolve(kv.FilePath)
	}
	return out
}

func dynamic(name string) string {
	switch name {
	case "$timestamp":
		return fmt.Sprintf("%d", time.Now().Unix())
	case "$isoTimestamp":
		return time.Now().UTC().Format(time.RFC3339)
	case "$uuid":
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		b[6] = (b[6] & 0x0f) | 0x40
		b[8] = (b[8] & 0x3f) | 0x80
		h := hex.EncodeToString(b)
		return fmt.Sprintf("%s-%s-%s-%s-%s", h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])
	case "$randomInt":
		n, err := rand.Int(rand.Reader, big.NewInt(1000))
		if err != nil {
			return "0"
		}
		return n.String()
	}
	return ""
}
