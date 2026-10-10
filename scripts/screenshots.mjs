// Captures the documentation screenshots by driving the running curlui server
// with Playwright. It seeds a demo dataset first so the shots are deterministic.
//
// Usage:  CURLUI_URL=http://localhost:8080 node scripts/screenshots.mjs
// Env:    CURLUI_URL  base URL of a running server (default http://localhost:8080)
//         SHOT_OUT    output directory (default <repo>/docs/screenshots)
//         CHROME_PATH explicit Chromium binary (optional)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.CURLUI_URL || "http://localhost:8080";
const OUT = process.env.SHOT_OUT || path.join(ROOT, "docs/screenshots");

function loadChromium() {
  for (const mod of ["playwright", "playwright-core"]) {
    try {
      const m = require(mod);
      if (m.chromium) return m.chromium;
    } catch {
      /* try next */
    }
  }
  throw new Error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
}

const api = async (p, data, method) => {
  const res = await fetch(BASE + p, {
    method: method || (data !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  return res.json().catch(() => ({}));
};

// run a capture step, but never let a flaky network call abort the whole run
async function step(name, fn) {
  try {
    await fn();
    console.log("· " + name);
  } catch (err) {
    console.warn("! skipped " + name + ": " + (err?.message ?? err));
  }
}

const req = (name, method, url, extra = {}) => ({
  parentId: "",
  type: "request",
  name,
  request: {
    method,
    url,
    params: [],
    headers: [],
    body: { type: "none", raw: "", form: [] },
    auth: { type: "none" },
    options: { timeout: 20000, followRedirects: true, verifyTLS: true, maxRedirects: 10, sendVia: "server" },
    scripts: { pre: { enabled: false, command: "" }, post: { enabled: false, command: "" } },
    assertions: [],
    ...extra,
  },
});

async function seed() {
  await api("/api/settings", { language: "en", theme: "dark" });
  for (const c of (await api("/api/collections")).collections ?? []) {
    await api(`/api/collections/${c.id}`, undefined, "DELETE");
  }
  for (const j of (await api("/api/schedule")).jobs ?? []) {
    await api(`/api/schedule/${j.id}`, undefined, "DELETE");
  }
  for (const e of (await api("/api/environments")).environments ?? []) {
    await api(`/api/environments/${e.id}`, undefined, "DELETE");
  }

  await api("/api/environments", {
    name: "Petstore",
    variables: [
      { id: "1", key: "base_url", value: "https://petstore3.swagger.io/api/v3", enabled: true },
      { id: "2", key: "petId", value: "1", enabled: true },
    ],
  });

  const petstore = await api("/api/collections", { type: "folder", name: "Petstore" });
  await api("/api/collections", {
    ...req("List pets", "GET", "{{base_url}}/pet/findByStatus", {
      params: [{ id: "p", key: "status", value: "available", enabled: true }],
      assertions: [
        { id: "a1", enabled: true, source: "status", operator: "eq", value: "200" },
        { id: "a2", enabled: true, source: "jsonpath", key: "$[0].name", operator: "exists", value: "" },
      ],
    }),
    parentId: petstore.id,
  });
  await api("/api/collections", {
    ...req("Get pet by id", "GET", "{{base_url}}/pet/{{petId}}", {
      assertions: [{ id: "b1", enabled: true, source: "status", operator: "eq", value: "200" }],
    }),
    parentId: petstore.id,
  });
  await api("/api/collections", {
    ...req("Add a pet", "POST", "{{base_url}}/pet", {
      headers: [{ id: "h", key: "Content-Type", value: "application/json", enabled: true }],
      body: { type: "json", raw: '{\n  "name": "doggie",\n  "status": "available"\n}', form: [] },
      auth: { type: "bearer", token: "{{token}}" },
    }),
    parentId: petstore.id,
  });

  const httpbin = await api("/api/collections", { type: "folder", name: "HTTPBin" });
  await api("/api/collections", {
    ...req("Echo GET", "GET", "https://httpbin.org/get", {
      assertions: [
        { id: "c1", enabled: true, source: "status", operator: "eq", value: "200" },
        { id: "c2", enabled: true, source: "jsonpath", key: "$.url", operator: "contains", value: "httpbin" },
      ],
      mocks: [
        {
          id: "m1",
          name: "Example",
          enabled: true,
          status: 200,
          headers: [{ id: "mh", key: "Content-Type", value: "application/json", enabled: true }],
          body: '{\n  "mocked": true,\n  "url": "https://httpbin.org/get"\n}',
          delayMs: 0,
        },
      ],
    }),
    parentId: httpbin.id,
  });
  await api("/api/collections", {
    ...req("Echo POST", "POST", "https://httpbin.org/post", {
      headers: [{ id: "h2", key: "Content-Type", value: "application/json", enabled: true }],
      body: { type: "json", raw: '{\n  "hello": "world"\n}', form: [] },
      assertions: [{ id: "d1", enabled: true, source: "status", operator: "eq", value: "200" }],
      scripts: {
        pre: { enabled: true, command: "printf '{\"variables\":{\"ts\":\"%s\"}}' \"$(date +%s)\"", timeout: 5000 },
        post: { enabled: false, command: "" },
      },
      dependsOn: [],
      extract: [{ name: "echoed", path: "$.json.hello", enabled: true }],
    }),
    parentId: httpbin.id,
  });
  await api("/api/collections", {
    ...req("Slow endpoint", "GET", "https://httpbin.org/delay/1"),
    parentId: httpbin.id,
  });

  await api("/api/send", { envId: "", request: req("Echo GET", "GET", "https://httpbin.org/get").request });
  await api("/api/send", { envId: "", request: req("Echo POST", "POST", "https://httpbin.org/post").request });
  await api("/api/schedule", {
    name: "List pets every minute",
    request: req("List pets", "GET", "{{base_url}}/pet/findByStatus").request,
    intervalMs: 60000,
    count: 0,
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await seed();

  const chromium = loadChromium();
  const executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await page.addInitScript(() => localStorage.setItem("curlui.locale", "en"));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Petstore", { timeout: 15000 });

  await step("hero.png", async () => {
    await page.locator("aside").getByText("Echo GET", { exact: true }).click();
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForSelector("text=200 OK", { timeout: 25000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, "hero.png") });
  });

  await step("automation.png", async () => {
    await page.getByRole("tab", { name: "Automation" }).click();
    await page.getByRole("button", { name: /Assertions/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "automation.png") });
  });

  await step("mock.png", async () => {
    await page.getByRole("button", { name: /Mock/ }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "mock.png") });
  });

  await step("scheduler.png", async () => {
    await page.getByRole("button", { name: "Jobs" }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "scheduler.png") });
  });

  await step("openapi-import.png", async () => {
    await page.getByRole("button", { name: "Import OpenAPI" }).click();
    await page.getByPlaceholder(/petstore3/).fill("https://petstore3.swagger.io/api/v3/openapi.json");
    await page.getByRole("button", { name: "Fetch & Preview" }).click();
    await page.waitForSelector("text=Add to Collections", { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "openapi-import.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "APIs" }).click();
  });

  await step("hero-light.png", async () => {
    await page.locator("header button:has(svg.lucide-sun)").first().click();
    await page.locator("aside").getByText("Echo GET", { exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "hero-light.png") });
  });

  // Responsive views.
  await step("tablet.png", async () => {
    const t = await browser.newPage({ viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1.5 });
    await t.addInitScript(() => localStorage.setItem("curlui.locale", "en"));
    await t.goto(BASE, { waitUntil: "networkidle" });
    await t.waitForSelector("text=Petstore", { timeout: 15000 });
    await t.locator("aside").getByText("Echo GET", { exact: true }).click();
    await t.waitForTimeout(500);
    await t.screenshot({ path: path.join(OUT, "tablet.png") });
    await t.close();
  });

  await step("mobile.png", async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await m.addInitScript(() => localStorage.setItem("curlui.locale", "en"));
    await m.goto(BASE, { waitUntil: "networkidle" });
    await m.waitForSelector("text=Petstore", { timeout: 15000 });
    // open the drawer, pick a request (the drawer closes automatically)
    await m.locator("header button:has(svg.lucide-menu)").click();
    await m.waitForTimeout(400);
    await m.locator("aside").getByText("Echo GET", { exact: true }).click();
    await m.waitForTimeout(600);
    await m.screenshot({ path: path.join(OUT, "mobile.png") });
    // and the drawer itself
    await m.locator("header button:has(svg.lucide-menu)").click();
    await m.waitForTimeout(400);
    await m.screenshot({ path: path.join(OUT, "mobile-drawer.png") });
    await m.close();
  });

  await browser.close();
  console.log("screenshots written to " + OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
