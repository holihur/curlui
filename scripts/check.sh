#!/usr/bin/env bash
# One command that runs every quality gate locally (the same ones CI runs).
# Usage:  bash scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

GOFLAGS_LOCAL="-p=1"
export GOMAXPROCS="${GOMAXPROCS:-2}"

step() { printf "\n\033[1m== %s ==\033[0m\n" "$1"; }
ok()   { printf "\033[32m✓ %s\033[0m\n" "$1"; }
die()  { printf "\033[31m✗ %s\033[0m\n" "$1"; exit 1; }

step "gofmt"
drift=$(gofmt -l server || true)
[ -z "$drift" ] || die "gofmt needed: $drift"
ok "gofmt clean"

# //go:embed all:dist needs at least one file, even before the frontend is built.
mkdir -p server/internal/webui/dist server/internal/webui/dist_core
touch server/internal/webui/dist/.gitkeep server/internal/webui/dist_core/.gitkeep

step "go vet (full)"
(cd server && GOFLAGS="$GOFLAGS_LOCAL" go vet ./...)
ok "vet full"

step "go vet (core)"
(cd server && GOFLAGS="$GOFLAGS_LOCAL" go vet -tags core ./...)
ok "vet core"

step "go test (full + core)"
(cd server && GOFLAGS="$GOFLAGS_LOCAL" go test ./...)
(cd server && GOFLAGS="$GOFLAGS_LOCAL" go test -tags core ./...)
ok "tests pass"

step "TypeScript"
(cd web && npx tsc --noEmit)
ok "tsc clean"

step "i18n parity"
node scripts/i18n-check.mjs
ok "i18n parity"

step "feature parity"
node scripts/feature-check.mjs
ok "feature parity"

step "build (full + core) + size budget"
bash scripts/build.sh > /tmp/curlui-check-build.log 2>&1 || { tail -30 /tmp/curlui-check-build.log; die "build failed"; }
core_bytes=$(stat -c%s server/curlui-server-core)
full_bytes=$(stat -c%s server/curlui-server)
limit=$((10 * 1024 * 1024))
[ "$core_bytes" -lt "$limit" ] || die "core is $(numfmt --to=iec "$core_bytes") — over the 10 MB budget"
ok "full $(numfmt --to=iec "$full_bytes")  ·  core $(numfmt --to=iec "$core_bytes") (< 10 MB)"

printf "\n\033[1;32mALL QUALITY GATES PASSED\033[0m\n"
