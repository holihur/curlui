// Package webui embeds the built frontend so curlui ships as a single
// self-contained binary. The build pipeline copies web/dist into
// internal/webui/dist before compiling; when it is absent (e.g. during
// development) the server transparently falls back to serving from disk.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// FS returns the embedded frontend filesystem, and whether it actually
// contains a built index.html.
func FS() (fs.FS, bool) {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return sub, false
	}
	return sub, true
}
