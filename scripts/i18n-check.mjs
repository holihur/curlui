#!/usr/bin/env node
// i18n parity check: every key used in the UI must exist in every locale, and
// every locale key should be used somewhere. Exits non-zero on drift.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web", "src");
const locales = ["en", "zh", "ja"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

// Keys defined in a locale file (top-level `key:` entries).
function definedKeys(lang) {
  const src = readFileSync(join(web, "lib", "locales", `${lang}.ts`), "utf8");
  const keys = new Set();
  for (const line of src.split("\n")) {
    const m = line.match(/^  ([A-Za-z0-9_]+):/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

// Keys referenced directly (t("k") / translate("k")) plus any string literal
// that matches a known key (covers indirect uses like { label: "bodyJson" }).
function usedKeys(known) {
  const direct = new Set();
  const literals = new Set();
  for (const file of walk(web)) {
    if (file.includes(`${join("lib", "locales")}`)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\b(?:t|translate)\("([A-Za-z0-9_]+)"/g)) direct.add(m[1]);
    for (const m of src.matchAll(/"([A-Za-z0-9_]+)"/g)) literals.add(m[1]);
  }
  for (const k of literals) if (known.has(k)) direct.add(k);
  return direct;
}

const defined = Object.fromEntries(locales.map((l) => [l, definedKeys(l)]));
const used = usedKeys(defined.en);
let failed = false;

for (const lang of locales) {
  const missing = [...used].filter((k) => !defined[lang].has(k)).sort();
  if (missing.length) {
    failed = true;
    console.error(`✗ ${lang}.ts is missing ${missing.length} used key(s):`);
    console.error("  " + missing.join(", "));
  }
}

// Orphans are only reported for the reference locale (en) to keep it readable.
const orphans = [...defined.en].filter((k) => !used.has(k)).sort();
if (orphans.length) {
  console.warn(`! en.ts has ${orphans.length} key(s) not referenced by t(): ${orphans.join(", ")}`);
}

if (failed) process.exit(1);
console.log(`✓ i18n parity ok (${used.size} keys × ${locales.length} locales)`);
