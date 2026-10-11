//go:build core

package webui

import (
	"embed"
	"io/fs"
)

// The core build embeds a smaller frontend bundle (no pdf.js).
//
//go:embed all:dist_core
var embeddedCore embed.FS

// FS returns the embedded frontend filesystem, and whether it actually
// contains a built index.html.
func FS() (fs.FS, bool) {
	sub, err := fs.Sub(embeddedCore, "dist_core")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return sub, false
	}
	return sub, true
}
