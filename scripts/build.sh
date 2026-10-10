#!/usr/bin/env bash
# Build the frontend, embed it into the Go binary, and produce a single
# self-contained executable at server/curlui-server.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"

echo "==> Building frontend"
cd web
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi
npm run build
cd ..

echo "==> Embedding frontend"
rm -rf server/internal/webui/dist
mkdir -p server/internal/webui/dist
cp -r web/dist/. server/internal/webui/dist/

echo "==> Building server ($VERSION)"
cd server
GOMAXPROCS="${GOMAXPROCS:-2}" CGO_ENABLED=0 go build \
  -ldflags "-s -w -X main.version=${VERSION}" \
  -o curlui-server .
cd ..

echo
echo "Done. Single binary:"
echo "  ./server/curlui-server -addr :8080"
