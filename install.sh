#!/bin/sh
# curlui one-line installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/holihur/curlui/main/install.sh | sh
#
# Environment overrides:
#   CURLUI_VERSION      install a specific tag (e.g. v1.3.0)
#   CURLUI_INSTALL_DIR  target directory (default: /usr/local/bin or ~/.local/bin)
set -eu

REPO="holihur/curlui"
BIN="curlui"

say() { printf '%s\n' "$*" >&2; }
die() { say "error: $*"; exit 1; }

# --- detect platform -------------------------------------------------------
os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  linux | darwin) ;;
  *) die "unsupported operating system: $os (use the Windows installer instead)" ;;
esac

arch=$(uname -m)
case "$arch" in
  x86_64 | amd64) arch="amd64" ;;
  aarch64 | arm64) arch="arm64" ;;
  *) die "unsupported architecture: $arch" ;;
esac

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$1"; }
  download() { curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO- --tries=5 --waitretry=2 "$1"; }
  download() { wget -qO "$2" --tries=5 --waitretry=2 "$1"; }
else
  die "either curl or wget is required"
fi

# --- resolve version -------------------------------------------------------
version="${CURLUI_VERSION:-}"
if [ -z "$version" ]; then
  say "Resolving the latest release ..."
  version=$(fetch "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n1)
fi
[ -n "$version" ] || die "could not determine the latest version (set CURLUI_VERSION)"

asset="${BIN}_${version}_${os}_${arch}"
# core variant: a leaner build without gRPC, PostgreSQL, proxy, MCP, jobs, PDF.
if [ "${CURLUI_VARIANT:-}" = "core" ]; then
  asset="${BIN}-core_${version}_${os}_${arch}"
fi
url="https://github.com/${REPO}/releases/download/${version}/${asset}"

# --- choose install dir ----------------------------------------------------
dir="${CURLUI_INSTALL_DIR:-}"
if [ -z "$dir" ]; then
  if [ -w /usr/local/bin ] 2>/dev/null; then
    dir="/usr/local/bin"
  elif [ "$(id -u)" = "0" ]; then
    dir="/usr/local/bin"
  else
    dir="${HOME}/.local/bin"
  fi
fi
mkdir -p "$dir" || die "could not create $dir"

# --- download --------------------------------------------------------------
target="${dir}/${BIN}"
tmp="${target}.tmp.$$"
say "Downloading ${asset} ..."
if ! download "$url" "$tmp"; then
  rm -f "$tmp"
  die "download failed: $url"
fi
chmod +x "$tmp"
mv "$tmp" "$target"

say ""
say "  curlui ${version} installed to ${target}"
say ""

case ":${PATH}:" in
  *":${dir}:"*) ;;
  *) say "  note: add ${dir} to your PATH, e.g.  export PATH=\"${dir}:\$PATH\"" ; say "" ;;
esac

"$target" -version 2>/dev/null || true
say "Run it with:  curlui -addr :8080   then open http://localhost:8080"
