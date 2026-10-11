// Pre-compresses the built frontend so the Go server can serve .br/.gz
// variants with zero runtime cost. Uses only Node's built-in zlib.
//
//   node scripts/precompress.mjs [distDir]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIST = path.resolve(process.argv[2] || "web/dist");
const MIN = 1024; // skip tiny files where compression is not worth it
const EXT = new Set([".js", ".css", ".html", ".svg", ".json", ".map", ".txt", ".webmanifest"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (!fs.existsSync(DIST)) {
  console.error("dist not found: " + DIST);
  process.exit(1);
}

let saved = 0;
let count = 0;
for (const file of walk(DIST)) {
  const ext = path.extname(file).toLowerCase();
  if (!EXT.has(ext)) continue;
  const buf = fs.readFileSync(file);
  if (buf.length < MIN) continue;

  const br = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(file + ".br", br);
  fs.writeFileSync(file + ".gz", gz);

  saved += buf.length - br.length;
  count++;
  const rel = path.relative(DIST, file);
  console.log(
    `  ${rel.padEnd(34)} ${(buf.length / 1024).toFixed(0).padStart(5)}K → br ${(br.length / 1024).toFixed(0).padStart(4)}K / gz ${(gz.length / 1024).toFixed(0).padStart(4)}K`,
  );
}
console.log(`precompressed ${count} files, ~${(saved / 1024).toFixed(0)}K saved on the wire`);
