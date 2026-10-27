#!/usr/bin/env bash
# Development: run the Go API server and the Vite dev server together.
set -euo pipefail
cd "$(dirname "$0")/.."

cd server
GOMAXPROCS="${GOMAXPROCS:-2}" go build -o curlui-server .
cd ..

./server/curlui-server -addr :8080 &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT INT TERM

echo
echo "  API  : http://localhost:8080"
echo "  Web  : http://localhost:5173  (Vite proxies /api -> :8080)"
echo

cd web
pnpm run dev
