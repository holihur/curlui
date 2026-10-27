#!/usr/bin/env bash
# Build both frontends, embed each into its own Go binary, and produce the two
# self-contained executables:
#   server/curlui-server       (full  — includes pdf.js for the PDF preview)
#   server/curlui-server-core  (core  — smaller, no pdf.js)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo dev)}"

cd web
if [ ! -d node_modules ]; then
  pnpm install --frozen-lockfile
fi

echo "==> Building frontend (full)"
CURLUI_DIST=dist pnpm run build
cd ..
node scripts/precompress.mjs web/dist
rm -rf server/internal/webui/dist
mkdir -p server/internal/webui/dist
cp -r web/dist/. server/internal/webui/dist/
touch server/internal/webui/dist/.gitkeep

echo "==> Building frontend (core, no pdf.js)"
cd web
CURLUI_PDF=0 CURLUI_DIST=dist-core pnpm run build
cd ..
node scripts/precompress.mjs web/dist-core
rm -rf server/internal/webui/dist_core
mkdir -p server/internal/webui/dist_core
cp -r web/dist-core/. server/internal/webui/dist_core/
touch server/internal/webui/dist_core/.gitkeep

echo "==> Building servers ($VERSION)"
cd server
GOMAXPROCS="${GOMAXPROCS:-2}" CGO_ENABLED=0 go build \
  -ldflags "-s -w -X main.version=${VERSION}" -o curlui-server .
GOMAXPROCS="${GOMAXPROCS:-2}" CGO_ENABLED=0 go build -tags core \
  -ldflags "-s -w -X main.version=${VERSION}" -o curlui-server-core .
cd ..

echo
echo "Done:"
ls -lh server/curlui-server server/curlui-server-core | awk '{print "  "$9"  "$5}'
