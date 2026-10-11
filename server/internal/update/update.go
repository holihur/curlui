// Package update checks GitHub Releases and can replace the running binary.
package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Repo is the GitHub repository that publishes curlui releases.
const Repo = "holihur/curlui"

// Release is the subset of the GitHub release API we use.
type Release struct {
	Tag    string  `json:"tag_name"`
	URL    string  `json:"html_url"`
	Assets []Asset `json:"assets"`
}

// Asset is a release asset.
type Asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

// Info is the result of an update check.
type Info struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	HasUpdate bool   `json:"hasUpdate"`
	URL       string `json:"url"`
}

// LatestRelease fetches the latest release metadata.
func LatestRelease() (*Release, error) {
	req, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/"+Repo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("github returned HTTP %d", resp.StatusCode)
	}
	var rel Release
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&rel); err != nil {
		return nil, err
	}
	return &rel, nil
}

// AssetName is the expected asset filename for the current platform.
func AssetName(tag, goos, goarch string) string {
	ext := ""
	if goos == "windows" {
		ext = ".exe"
	}
	return fmt.Sprintf("curlui_%s_%s_%s%s", tag, goos, goarch, ext)
}

// AssetURL finds the download URL for the current platform in a release.
func AssetURL(rel *Release) string {
	want := AssetName(rel.Tag, runtime.GOOS, runtime.GOARCH)
	for _, a := range rel.Assets {
		if a.Name == want {
			return a.URL
		}
	}
	return ""
}

// AssetURLs returns candidate download URLs for the current platform, best
// first: the raw binary, then an archive that contains it. Releases may ship
// either form (Windows ships a .zip), so the updater tries each in turn.
func AssetURLs(rel *Release) []string {
	want := AssetName(rel.Tag, runtime.GOOS, runtime.GOARCH)
	var out []string
	add := func(name string) {
		for _, a := range rel.Assets {
			if a.Name == name {
				out = append(out, a.URL)
				return
			}
		}
	}
	add(want)
	add(want + ".zip")
	add(want + ".tar.gz")
	add(want + ".tgz")
	return out
}

// IsArchive reports whether a filename looks like a compressed archive.
func IsArchive(name string) bool {
	lower := strings.ToLower(name)
	for _, suf := range []string{".zip", ".tar.gz", ".tgz", ".tar"} {
		if strings.HasSuffix(lower, suf) {
			return true
		}
	}
	return false
}

// Extract pulls the executable out of an archive (zip, tar.gz, tgz or tar).
// Non-archive input is returned unchanged.
func Extract(data []byte, name string) ([]byte, error) {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		return extractZip(data)
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return extractTar(data, true)
	case strings.HasSuffix(lower, ".tar"):
		return extractTar(data, false)
	}
	return data, nil
}

func pickBinary(name string, isDir bool, size int64) bool {
	if isDir || size == 0 {
		return false
	}
	base := strings.ToLower(filepath.Base(name))
	if strings.HasPrefix(base, ".") || strings.Contains(base, "sha256") {
		return false
	}
	return true
}

func extractZip(data []byte) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	for _, f := range zr.File {
		if !pickBinary(f.Name, f.FileInfo().IsDir(), int64(f.UncompressedSize64)) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(io.LimitReader(rc, 64<<20))
	}
	return nil, fmt.Errorf("no executable inside %s", filepath.Base("archive"))
}

func extractTar(data []byte, gzipped bool) ([]byte, error) {
	var r io.Reader = bytes.NewReader(data)
	if gzipped {
		gz, err := gzip.NewReader(r)
		if err != nil {
			return nil, err
		}
		defer gz.Close()
		r = gz
	}
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if !pickBinary(hdr.Name, hdr.FileInfo().IsDir(), hdr.Size) {
			continue
		}
		return io.ReadAll(io.LimitReader(tr, 64<<20))
	}
	return nil, fmt.Errorf("no executable inside archive")
}

// Download fetches a URL into memory.
func Download(url string) ([]byte, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 64<<20))
}

// Apply replaces the running executable with new data. The change takes effect
// on the next start.
func Apply(data []byte) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dir := filepath.Dir(exe)
	tmp, err := os.CreateTemp(dir, ".curlui-new-*")
	if err != nil {
		return fmt.Errorf("cannot write next to %s: %w", exe, err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Chmod(0o755); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	tmp.Close()

	if runtime.GOOS == "windows" {
		_ = os.Rename(exe, exe+".old")
	}
	if err := os.Rename(tmpName, exe); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("cannot replace %s: %w", exe, err)
	}
	_ = os.Remove(exe + ".old")
	return nil
}

// IsNewer reports whether latest is a newer version than current.
func IsNewer(current, latest string) bool {
	c, cok := parse(current)
	l, lok := parse(latest)
	if !lok {
		return false
	}
	if !cok {
		// Unparseable current (e.g. "dev") — treat any real tag as newer.
		return true
	}
	for i := 0; i < 3; i++ {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}

func parse(v string) ([3]int, bool) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+ "); i >= 0 {
		v = v[:i]
	}
	var out [3]int
	if v == "" {
		return out, false
	}
	for i, part := range strings.Split(v, ".") {
		if i >= 3 {
			break
		}
		n, err := strconv.Atoi(part)
		if err != nil {
			return out, false
		}
		out[i] = n
	}
	return out, true
}
