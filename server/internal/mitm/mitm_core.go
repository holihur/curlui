//go:build core

// Package mitm is not compiled into the core build.
package mitm

import "fmt"

// CA is a stub in the core build.
type CA struct{}

func (c *CA) CertPEM() []byte { return nil }

// LoadOrCreate is unavailable in the core build.
func LoadOrCreate(dir string) (*CA, error) {
	return nil, fmt.Errorf("HTTPS interception is not included in this core build")
}
