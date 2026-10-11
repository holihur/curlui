//go:build !core

// Package mitm provides a tiny certificate authority used to intercept HTTPS
// traffic in the capture proxy. Certificates are generated on demand and
// cached per host.
package mitm

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CA is an in-memory certificate authority, optionally persisted to disk.
type CA struct {
	certPEM []byte
	cert    *x509.Certificate
	key     *ecdsa.PrivateKey

	mu    sync.Mutex
	cache map[string]*tls.Certificate
}

// LoadOrCreate loads a CA from dir (ca.crt/ca.key) or creates and persists one.
func LoadOrCreate(dir string) (*CA, error) {
	certPath := filepath.Join(dir, "ca.crt")
	keyPath := filepath.Join(dir, "ca.key")

	if certPEM, err := os.ReadFile(certPath); err == nil {
		if keyPEM, err := os.ReadFile(keyPath); err == nil {
			if ca, err := parse(certPEM, keyPEM); err == nil {
				return ca, nil
			}
		}
	}

	ca, err := create()
	if err != nil {
		return nil, err
	}
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(certPath, ca.certPEM, 0o644)
	keyDER, _ := x509.MarshalECPrivateKey(ca.key)
	_ = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600)
	return ca, nil
}

func create() (*CA, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "curlui CA", Organization: []string{"curlui"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	cert, _ := x509.ParseCertificate(der)
	return &CA{
		certPEM: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		cert:    cert,
		key:     key,
		cache:   map[string]*tls.Certificate{},
	}, nil
}

func parse(certPEM, keyPEM []byte) (*CA, error) {
	cb, _ := pem.Decode(certPEM)
	kb, _ := pem.Decode(keyPEM)
	if cb == nil || kb == nil {
		return nil, fmt.Errorf("invalid CA files")
	}
	cert, err := x509.ParseCertificate(cb.Bytes)
	if err != nil {
		return nil, err
	}
	key, err := x509.ParseECPrivateKey(kb.Bytes)
	if err != nil {
		return nil, err
	}
	return &CA{certPEM: certPEM, cert: cert, key: key, cache: map[string]*tls.Certificate{}}, nil
}

// CertPEM returns the CA certificate in PEM form (for clients to trust).
func (ca *CA) CertPEM() []byte { return ca.certPEM }

// CertFor returns a server certificate for the given host, signed by the CA.
func (ca *CA) CertFor(host string) (*tls.Certificate, error) {
	host = strings.TrimSpace(host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	ca.mu.Lock()
	if c, ok := ca.cache[host]; ok {
		ca.mu.Unlock()
		return c, nil
	}
	ca.mu.Unlock()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: host},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(2, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ip := net.ParseIP(host); ip != nil {
		tmpl.IPAddresses = []net.IP{ip}
	} else {
		tmpl.DNSNames = []string{host}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		return nil, err
	}
	cert := &tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
	ca.mu.Lock()
	ca.cache[host] = cert
	ca.mu.Unlock()
	return cert, nil
}
