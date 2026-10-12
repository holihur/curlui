package curl

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"curlui/server/internal/models"
	"curlui/server/internal/variables"
)

// An environment can pin a hostname to a fixed IP; the Host header and TLS SNI
// must still use the original name.
func TestExecuteHonoursDNSOverride(t *testing.T) {
	var seenHost string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenHost = r.Host
		_, _ = w.Write([]byte("pong"))
	}))
	defer srv.Close()

	port := strings.TrimPrefix(srv.URL, "http://127.0.0.1:")
	const fakeHost = "staging.internal.invalid"

	e := &Executor{}
	def := models.RequestDef{
		Method:  "GET",
		URL:     "http://" + fakeHost + ":" + port + "/ping",
		Options: models.Options{DNS: map[string]string{fakeHost: "127.0.0.1"}},
	}
	resp := e.Execute(context.Background(), def, variables.Set{}, false)
	if resp.Error != "" {
		t.Fatalf("request failed: %s", resp.Error)
	}
	if resp.Status != 200 || resp.Body != "pong" {
		t.Fatalf("status=%d body=%q", resp.Status, resp.Body)
	}
	if seenHost != fakeHost+":"+port {
		t.Errorf("Host header = %q, want %q", seenHost, fakeHost+":"+port)
	}
}

// Without an override the name is resolved normally, so an unresolvable host
// must fail (proving the override is what made the test above work).
func TestExecuteWithoutOverrideFails(t *testing.T) {
	e := &Executor{}
	def := models.RequestDef{
		Method:  "GET",
		URL:     "http://staging.internal.invalid:9/ping",
		Options: models.Options{Timeout: 2000},
	}
	resp := e.Execute(context.Background(), def, variables.Set{}, false)
	if resp.Error == "" {
		t.Fatal("expected a DNS failure without an override")
	}
}

func TestSplitHostPort(t *testing.T) {
	host, port, err := net.SplitHostPort("example.com:8080")
	if err != nil || host != "example.com" || port != "8080" {
		t.Fatalf("SplitHostPort = %q %q %v", host, port, err)
	}
}
