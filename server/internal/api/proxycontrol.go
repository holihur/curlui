package api

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"

	"curlui/server/internal/models"
	"curlui/server/internal/proxy"
)

// StartProxy starts the capture proxy at runtime (address like ":8899").
func (s *Server) StartProxy(addr string) error {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		addr = ":8899"
	}
	s.mu.Lock()
	if s.proxyRunning {
		s.mu.Unlock()
		return fmt.Errorf("the proxy is already running")
	}
	ca := s.ca
	s.mu.Unlock()

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("cannot listen on %s: %w", addr, err)
	}

	st := s.store
	p := proxy.New(addr, func(c models.CaptureEntry) {
		settings := st.Settings()
		if settings["proxyCapture"] == "0" {
			return
		}
		if !matchCaptureFilter(settings["proxyCaptureFilter"], c.URL) {
			return
		}
		_ = st.AddCapture(c)
	}, proxy.Options{
		CA:                   ca,
		RequestBreakEnabled:  func() bool { return st.Settings()["proxyBreak"] == "1" },
		RequestBreakFilter:   func(url string) bool { return matchCaptureFilter(st.Settings()["proxyBreakFilter"], url) },
		ResponseBreakEnabled: func() bool { return st.Settings()["proxyBreakResponse"] == "1" },
		ResponseBreakFilter:  func(url string) bool { return matchCaptureFilter(st.Settings()["proxyBreakResponseFilter"], url) },
		MITMEnabled:          func() bool { return st.Settings()["proxyMITM"] != "0" },
		MITMFilter:           func(host string) bool { return matchCaptureFilter(st.Settings()["proxyMITMFilter"], host) },
	})

	go func() {
		if err := p.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("proxy stopped: %v", err)
		}
	}()

	s.mu.Lock()
	s.proxySrv = p
	s.proxyRunning = true
	s.proxyAddr = addr
	s.mu.Unlock()
	s.SetInterceptor(p.Interceptor())
	_ = st.SaveSettings(map[string]string{"proxyEnabled": "1", "proxyAddr": addr})
	log.Printf("capture proxy listening on %s (HTTPS interception: %v)", addr, ca != nil)
	return nil
}

// StopProxy stops the capture proxy.
func (s *Server) StopProxy() {
	s.mu.Lock()
	p := s.proxySrv
	s.proxySrv = nil
	s.proxyRunning = false
	s.proxyAddr = ""
	s.mu.Unlock()
	if p != nil {
		_ = p.Close()
	}
	s.SetInterceptor(nil)
	_ = s.store.SaveSettings(map[string]string{"proxyEnabled": "0"})
	log.Printf("capture proxy stopped")
}

// MaybeStartProxy starts the proxy when it was left enabled in settings.
func (s *Server) MaybeStartProxy() {
	set := s.store.Settings()
	if set["proxyEnabled"] != "1" {
		return
	}
	addr := set["proxyAddr"]
	if addr == "" {
		addr = ":8899"
	}
	if err := s.StartProxy(addr); err != nil {
		log.Printf("proxy autostart failed: %v", err)
	}
}

// proxyServerControl turns the capture proxy on or off from the UI.
func (s *Server) proxyServerControl(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Enabled bool   `json:"enabled"`
		Addr    string `json:"addr"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if payload.Enabled {
		if err := s.StartProxy(payload.Addr); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	} else {
		s.StopProxy()
	}
	s.listProxy(w, r)
}

// matchCaptureFilter reports whether a URL/host matches any newline-separated
// pattern (* wildcards, case-insensitive). Empty patterns match everything.
func matchCaptureFilter(patterns, url string) bool {
	patterns = strings.TrimSpace(patterns)
	if patterns == "" {
		return true
	}
	for _, line := range strings.Split(patterns, "\n") {
		p := strings.TrimSpace(line)
		if p == "" {
			continue
		}
		expr := "(?i)" + strings.ReplaceAll(regexp.QuoteMeta(p), `\*`, ".*")
		if re, err := regexp.Compile(expr); err == nil && re.MatchString(url) {
			return true
		}
	}
	return false
}
