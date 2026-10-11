package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"testing"
)

func TestIsNewer(t *testing.T) {
	cases := []struct {
		cur, latest string
		want        bool
	}{
		{"v1.2.3", "v1.2.4", true},
		{"v1.2.3", "v1.2.3", false},
		{"v1.2.3", "v1.3.0", true},
		{"v2.0.0", "v1.9.9", false},
		{"v1.2.3-rc1", "v1.2.3", false},
		{"dev", "v1.0.0", true},
		{"v1.0.0", "not-a-version", false},
	}
	for _, c := range cases {
		if got := IsNewer(c.cur, c.latest); got != c.want {
			t.Errorf("IsNewer(%q, %q) = %v, want %v", c.cur, c.latest, got, c.want)
		}
	}
}

func TestAssetName(t *testing.T) {
	if got := AssetName("v1.0.0", "linux", "amd64"); got != "curlui_v1.0.0_linux_amd64" {
		t.Errorf("linux asset name = %q", got)
	}
	if got := AssetName("v1.0.0", "windows", "amd64"); got != "curlui_v1.0.0_windows_amd64.exe" {
		t.Errorf("windows asset name = %q", got)
	}
}

func TestAssetURLsOrder(t *testing.T) {
	rel := &Release{Tag: "v1.0.0", Assets: []Asset{
		{Name: "curlui_v1.0.0_linux_amd64.tar.gz", URL: "tar"},
		{Name: "curlui_v1.0.0_linux_amd64", URL: "raw"},
	}}
	got := AssetURLs(rel)
	if len(got) != 2 || got[0] != "raw" || got[1] != "tar" {
		t.Fatalf("AssetURLs = %v, want [raw tar] (raw binary must come first)", got)
	}
}

func TestIsArchive(t *testing.T) {
	for _, name := range []string{"a.zip", "a.tar.gz", "a.tgz", "a.tar"} {
		if !IsArchive(name) {
			t.Errorf("IsArchive(%q) = false", name)
		}
	}
	for _, name := range []string{"curlui_linux_amd64", "a.exe"} {
		if IsArchive(name) {
			t.Errorf("IsArchive(%q) = true", name)
		}
	}
}

func TestExtractZip(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("curlui_v1.0.0_linux_amd64")
	_, _ = w.Write([]byte("BINARY"))
	_ = zw.Close()

	got, err := Extract(buf.Bytes(), "x.zip")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "BINARY" {
		t.Fatalf("Extract zip = %q", got)
	}
}

func TestExtractTarGz(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	body := []byte("BINARY")
	_ = tw.WriteHeader(&tar.Header{Name: "curlui_v1.0.0_linux_amd64", Mode: 0o755, Size: int64(len(body))})
	_, _ = tw.Write(body)
	_ = tw.Close()
	_ = gz.Close()

	got, err := Extract(buf.Bytes(), "x.tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "BINARY" {
		t.Fatalf("Extract tar.gz = %q", got)
	}
}

func TestExtractPassthrough(t *testing.T) {
	got, err := Extract([]byte("RAW"), "curlui_linux_amd64")
	if err != nil || string(got) != "RAW" {
		t.Fatalf("Extract raw = %q, %v", got, err)
	}
}
