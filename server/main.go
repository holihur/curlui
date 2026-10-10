// Command curlui runs the curlui HTTP server: a Postman/Navicat-style HTTP
// client whose requests are executed server-side by Go.
//
// It ships as a single self-contained binary — the built web UI is embedded,
// so running one file is all that is required.
package main

import (
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"curlui/server/internal/api"
	"curlui/server/internal/mcp"
	"curlui/server/internal/mitm"
	"curlui/server/internal/models"
	"curlui/server/internal/proxy"
	"curlui/server/internal/store"
	"curlui/server/internal/webui"
)

// version is injected at build time:
//
//	go build -ldflags "-X main.version=v1.2.3"
var version = "dev"

func main() {
	addr := flag.String("addr", envOr("CURLUI_ADDR", ":8080"), "listen address")
	dataPath := flag.String("data", envOr("CURLUI_DATA", "data/store.json"), "path to the JSON data store (used when -db is empty)")
	dbDSN := flag.String("db", envOr("CURLUI_DATABASE_URL", ""), "PostgreSQL DSN for the GORM backend (e.g. postgres://user:pass@localhost:5432/curlui)")
	staticDir := flag.String("static", envOr("CURLUI_STATIC", "web/dist"), "directory with the built frontend (fallback when not embedded)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	service := flag.String("service", "", "manage a system service: install | uninstall | status | print")
	proxyAddr := flag.String("proxy", envOr("CURLUI_PROXY", ""), "run an HTTP capture proxy on this address (e.g. :8899); empty disables")
	proxyMITM := flag.Bool("proxy-mitm", envOr("CURLUI_PROXY_MITM", "1") != "0", "intercept HTTPS through the capture proxy (clients must trust the CA)")
	mcpMode := flag.Bool("mcp", false, "run an MCP (Model Context Protocol) server over stdio and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("curlui " + version)
		return
	}

	if *service != "" {
		runService(*service, *addr, *dataPath)
		return
	}

	st, err := store.Open(store.Options{Path: *dataPath, DSN: *dbDSN})
	if err != nil {
		log.Fatalf("failed to open store: %v", err)
	}

	apiServer := api.New(st, version)

	if *mcpMode {
		if err := mcp.Serve(os.Stdin, os.Stdout, version, apiServer); err != nil {
			log.Fatalf("mcp server: %v", err)
		}
		return
	}

	if *proxyAddr != "" {
		var ca *mitm.CA
		if c, err := mitm.LoadOrCreate(filepath.Dir(absOr(*dataPath))); err != nil {
			log.Printf("HTTPS interception disabled: %v", err)
		} else {
			ca = c
			apiServer.SetProxyCA(c.CertPEM())
			if st.Settings()["proxyMITM"] == "" {
				v := "0"
				if *proxyMITM {
					v = "1"
				}
				_ = st.SaveSettings(map[string]string{"proxyMITM": v})
			}
		}
		p := proxy.New(*proxyAddr, func(c models.CaptureEntry) {
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
		apiServer.SetInterceptor(p.Interceptor())
		go func() {
			log.Printf("capture proxy listening on %s (HTTPS interception: %v)", *proxyAddr, ca != nil)
			if err := p.ListenAndServe(); err != nil {
				log.Printf("proxy stopped: %v", err)
			}
		}()
		apiServer.SetProxy(*proxyAddr, true)

		// Expire captures past the configured TTL.
		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				if secs, _ := strconv.Atoi(st.Settings()["proxyTTL"]); secs > 0 {
					_ = st.PurgeCaptures(time.Duration(secs) * time.Second)
				}
			}
		}()
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", apiServer.Handler())
	// Public mock server (same handler, mounted at the root).
	mux.Handle("/mock/", apiServer.Handler())
	// MCP over HTTP (JSON-RPC 2.0).
	mux.Handle("/mcp", apiServer.Handler())

	if fsys, ok := webui.FS(); ok {
		log.Printf("serving embedded frontend")
		mux.Handle("/", spaFS(fsys))
	} else {
		log.Printf("serving frontend from %s", absOr(*staticDir))
		mux.Handle("/", spaHandler(*staticDir))
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("curlui %s listening on http://%s", version, *addr)
	if *dbDSN != "" {
		log.Printf("data store: PostgreSQL (GORM)")
	} else {
		log.Printf("data store: %s", absOr(*dataPath))
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

// spaFS serves a frontend from an fs.FS, falling back to index.html for
// client-side routes.
func spaFS(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if f, err := fsys.Open(name); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := fsys.Open("index.html"); err != nil {
			http.Error(w, "frontend assets are missing from this build", http.StatusNotFound)
			return
		}
		// Serve index.html directly: http.FileServer would 301-redirect
		// "/index.html" -> "./", which breaks client-side routes.
		data, err := fs.ReadFile(fsys, "index.html")
		if err != nil {
			http.Error(w, "frontend assets are missing from this build", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	})
}

// spaHandler serves static files from disk and falls back to index.html for
// client side routes (development mode).
func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		clean := filepath.Clean(r.URL.Path)
		full := filepath.Join(dir, clean)
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		index := filepath.Join(dir, "index.html")
		if _, err := os.Stat(index); err != nil {
			http.Error(w, "frontend not built yet.\n\nRun:  cd web && npm install && npm run build\nOr start the dev server:  npm run dev", http.StatusNotFound)
			return
		}
		http.ServeFile(w, r, index)
	})
}

// matchCaptureFilter reports whether url passes the capture filter. The filter
// is a newline-separated list of patterns ('*' wildcards, case-insensitive); an
// empty filter captures everything.
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

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func absOr(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		return abs
	}
	return path
}
