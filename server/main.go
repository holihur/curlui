// Command curlui runs the curlui HTTP server: a self-hosted HTTP client whose
// requests are executed server-side by Go.
//
// It ships as a single self-contained binary — the built web UI is embedded,
// so running one file is all that is required.
package main

import (
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/http/pprof"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"curlui/server/internal/api"
	"curlui/server/internal/mitm"
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
	mcpMode := flag.Bool("mcp", false, "run an MCP (Model Context Protocol) server over stdio and exit")
	pprofAddr := flag.String("pprof", envOr("CURLUI_PPROF", ""), "enable pprof: an address like :6060, or 'main' to serve /debug/pprof on the main port")
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

	if runMCPServer(apiServer, version, *mcpMode) {
		return
	}

	// HTTPS interception CA (the capture proxy is toggled from the UI).
	if ca, err := mitm.LoadOrCreate(filepath.Dir(absOr(*dataPath))); err != nil {
		log.Printf("HTTPS interception disabled: %v", err)
	} else {
		apiServer.SetProxyCA(ca)
	}
	apiServer.MaybeStartProxy()

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

	// Profiling (off by default).
	switch *pprofAddr {
	case "":
		// disabled
	case "main", "on", "1":
		registerPprof(mux)
		log.Printf("pprof enabled on the main port at /debug/pprof/")
	default:
		go func() {
			log.Printf("pprof listening on %s", *pprofAddr)
			if err := http.ListenAndServe(*pprofAddr, nil); err != nil {
				log.Printf("pprof stopped: %v", err)
			}
		}()
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
// client-side routes. When a pre-compressed sibling (.br/.gz) exists it is
// served with the matching Content-Encoding, and hashed assets get long-lived
// immutable caching.
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
			if serveCompressed(w, r, fsys, name) {
				return
			}
			setCacheHeaders(w, name)
			fileServer.ServeHTTP(w, r)
			return
		}
		if _, err := fsys.Open("index.html"); err != nil {
			http.Error(w, "frontend assets are missing from this build", http.StatusNotFound)
			return
		}
		// Serve index.html directly: http.FileServer would 301-redirect
		// "/index.html" -> "./", which breaks client-side routes.
		if serveCompressed(w, r, fsys, "index.html") {
			return
		}
		data, err := fs.ReadFile(fsys, "index.html")
		if err != nil {
			http.Error(w, "frontend assets are missing from this build", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	})
}

// serveCompressed writes a pre-compressed variant of name when the client
// accepts it. It reports whether it handled the response.
func serveCompressed(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	ae := r.Header.Get("Accept-Encoding")
	var variant, encoding string
	switch {
	case strings.Contains(ae, "br"):
		variant, encoding = name+".br", "br"
	case strings.Contains(ae, "gzip"):
		variant, encoding = name+".gz", "gzip"
	default:
		return false
	}
	data, err := fs.ReadFile(fsys, variant)
	if err != nil {
		return false
	}
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Content-Encoding", encoding)
	w.Header().Set("Vary", "Accept-Encoding")
	setCacheHeaders(w, name)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
	return true
}

// setCacheHeaders marks hashed build assets as immutable and everything else
// (index.html, favicons) as revalidated.
func setCacheHeaders(w http.ResponseWriter, name string) {
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
}

// spaHandler serves static files from disk and falls back to index.html for
// client side routes (development mode).
func spaHandler(dir string) http.Handler {
	if _, err := os.Stat(filepath.Join(dir, "index.html")); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend not built yet.\n\nRun:  cd web && npm install && npm run build\nOr start the dev server:  npm run dev", http.StatusNotFound)
		})
	}
	return spaFS(os.DirFS(dir))
}

// matchCaptureFilter reports whether url passes the capture filter. The filter
// is a newline-separated list of patterns ('*' wildcards, case-insensitive); an
// empty filter captures everything.
// registerPprof mounts the standard pprof handlers on a custom mux.
func registerPprof(mux *http.ServeMux) {
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
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
