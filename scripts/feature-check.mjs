#!/usr/bin/env node
// Feature-parity check: the full and core builds must advertise the same set of
// feature keys, and every `features.<key>` used in the UI must exist. This
// catches "the UI offers something the binary cannot do".
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function featureKeys(file) {
  const src = readFileSync(join(root, file), "utf8");
  const keys = new Set();
  for (const m of src.matchAll(/"([a-z][a-zA-Z0-9_]*)":\s*(?:true|false)/g)) keys.add(m[1]);
  return keys;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const full = featureKeys("server/internal/api/build_full.go");
const core = featureKeys("server/internal/api/build_core.go");

let failed = false;
const onlyFull = [...full].filter((k) => !core.has(k));
const onlyCore = [...core].filter((k) => !full.has(k));
if (onlyFull.length || onlyCore.length) {
  failed = true;
  console.error("✗ build_full.go and build_core.go disagree on keys");
  if (onlyFull.length) console.error("  only in full: " + onlyFull.join(", "));
  if (onlyCore.length) console.error("  only in core: " + onlyCore.join(", "));
}

const used = new Set();
for (const file of walk(join(root, "web", "src"))) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bfeatures\.([a-zA-Z][a-zA-Z0-9_]*)/g)) used.add(m[1]);
}
const unknown = [...used].filter((k) => !full.has(k)).sort();
if (unknown.length) {
  failed = true;
  console.error("✗ UI references unknown feature flag(s): " + unknown.join(", "));
}

if (failed) process.exit(1);
console.log(`✓ feature parity ok (${full.size} flags, ${used.size} used by the UI)`);
