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
	"strings"
	"time"

	"curlui/server/internal/api"
	"curlui/server/internal/store"
	"curlui/server/internal/webui"
)

// version is injected at build time:
//
//	go build -ldflags "-X main.version=v1.2.3"
var version = "dev"

func main() {
	addr := flag.String("addr", envOr("CURLUI_ADDR", ":8080"), "listen address")
	dataPath := flag.String("data", envOr("CURLUI_DATA", "data/store.json"), "path to the JSON data store")
	staticDir := flag.String("static", envOr("CURLUI_STATIC", "web/dist"), "directory with the built frontend (fallback when not embedded)")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("curlui " + version)
		return
	}

	st, err := store.Open(*dataPath)
	if err != nil {
		log.Fatalf("failed to open store: %v", err)
	}

	apiServer := api.New(st)

	mux := http.NewServeMux()
	mux.Handle("/api/", apiServer.Handler())

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
	log.Printf("data store: %s", absOr(*dataPath))
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
