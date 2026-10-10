#!/usr/bin/env bash
# Regenerates the documentation screenshots.
#
#   bash scripts/screenshots.sh
#
# Builds the frontend + server, starts a throwaway instance (its own data file),
# captures every screen with Playwright and writes docs/screenshots/*.png.
#
# Env:
#   SKIP_BUILD=1      reuse the existing ./server/curlui-server binary
#   CURLUI_SHOT_PORT  port for the throwaway server (default 8091)
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${CURLUI_SHOT_PORT:-8091}"
TMP="$(mktemp -d)"
DATA="$TMP/store.json"
LOG="$TMP/server.log"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "== building =="
  bash scripts/build.sh
fi

if [ ! -x ./server/curlui-server ]; then
  echo "server binary missing; run without SKIP_BUILD" >&2
  exit 1
fi

echo "== starting server on :$PORT =="
./server/curlui-server -addr ":$PORT" -data "$DATA" >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT

for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

echo "== capturing =="
CURLUI_URL="http://localhost:$PORT" node scripts/screenshots.mjs
