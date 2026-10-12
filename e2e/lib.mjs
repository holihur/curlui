// Shared helpers for the curlui end-to-end suite.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PORT = Number(process.env.CURLUI_PORT || 8091);
export const BASE = `http://127.0.0.1:${PORT}`;
export const ORIGIN_PORT = PORT + 1;
export const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
export const BIN =
  process.env.CURLUI_BIN || join(root, "server", "curlui-server");

// CHROME_PATH wins; otherwise use whatever playwright-core installed, falling
// back to the local cache path used on the dev machine.
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    /* playwright has no browser installed */
  }
  candidates.push("/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome");
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  throw new Error("no chromium found — run `npx playwright install chromium`");
}

let failures = 0;
export function step(msg) {
  console.log("  • " + msg);
}
export function check(cond, msg) {
  if (cond) {
    console.log("    ✓ " + msg);
  } else {
    failures++;
    console.log("    ✗ " + msg);
  }
}
export function failCount() {
  return failures;
}

/** startOrigin serves the endpoints the tests send requests to. */
export function startOrigin() {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      let i = 0;
      const timer = setInterval(() => {
        res.write(`id: ${i}\nevent: tick\ndata: {"n": ${i}}\n\n`);
        if (++i >= 3) {
          clearInterval(timer);
          res.end();
        }
      }, 150);
      req.on("close", () => clearInterval(timer));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ method: req.method, url: req.url, body, ok: true }));
    });
  });
  return new Promise((resolve) => server.listen(ORIGIN_PORT, "127.0.0.1", () => resolve(server)));
}

/** startCurlui launches the binary against a throwaway data file. */
export function startCurlui() {
  const data = join(mkdtempSync(join(tmpdir(), "curlui-e2e-")), "store.json");
  const proc = spawn(BIN, ["-addr", `:${PORT}`, "-data", data], { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  return new Promise(async (resolve, reject) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.ok) return resolve(proc);
      } catch {
        /* not up yet */
      }
      await sleep(200);
    }
    reject(new Error("curlui did not start"));
  });
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** seed creates a couple of saved requests so the UI has something to show. */
export async function seed() {
  const post = (path, body) =>
    fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  await post("/api/settings", { language: "en", theme: "dark" });
  const folder = await (await post("/api/collections", { type: "folder", name: "E2E" })).json();
  await post("/api/collections", {
    parentId: folder.id,
    type: "request",
    name: "Echo GET",
    request: { method: "GET", url: `${ORIGIN}/echo?hello=1`, headers: [], params: [] },
  });
  await post("/api/collections", {
    parentId: folder.id,
    type: "request",
    name: "SSE events",
    request: { method: "GET", url: `${ORIGIN}/events`, headers: [], params: [] },
  });
}

export async function launch() {
  return chromium.launch({
    executablePath: chromePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });
}

/** newPage returns a page with a clean localStorage and English UI. `prefs`
 * seeds extra localStorage keys (the app reads its preferences from there). */
export async function newPage(browser, viewport = { width: 1440, height: 900 }, prefs = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((seed) => {
    localStorage.clear();
    localStorage.setItem("curlui.locale", "en");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, prefs);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! pageerror: " + e.message.slice(0, 160)));
  return page;
}

export async function gotoApp(page) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=E2E", { timeout: 30000 });
}
