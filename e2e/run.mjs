// curlui end-to-end runner.
//
//   node run.mjs                      # full build
//   CURLUI_BIN=../server/curlui-server-core node run.mjs
//
// It starts a throwaway origin server (echo + SSE) and a throwaway curlui
// instance, then drives the real UI with Playwright.
import {
  BASE,
  ORIGIN,
  failCount,
  gotoApp,
  launch,
  newPage,
  seed,
  sleep,
  startCurlui,
  startOrigin,
  step,
  check,
} from "./lib.mjs";

const isCore = (process.env.CURLUI_BIN || "").includes("core");

async function smoke(browser) {
  console.log("\nsmoke");
  const page = await newPage(browser);
  await gotoApp(page);
  check(await page.locator("text=E2E").count() > 0, "collections render");
  check(await page.locator("text=Echo GET").count() > 0, "saved requests listed");

  step("send a request from the editor");
  await page.locator("input.font-mono").first().fill(`${ORIGIN}/echo?from=ui`);
  await page.locator("button[title='Send']").click();
  await page.waitForSelector("text=/\"ok\": true/", { timeout: 20000 });
  check(true, "response body rendered");
  check(await page.locator("text=/200/").count() > 0, "status shown");
  await page.context().close();
}

async function streaming(browser) {
  console.log("\nstreaming (SSE)");
  const page = await newPage(browser);
  await gotoApp(page);
  step("enable Stream and target the SSE endpoint");
  await page.locator("button[title*='Stream']").click();
  await page.locator("input.font-mono").first().fill(`${ORIGIN}/events`);
  await page.locator("button[title='Send']").click();
  await sleep(300);
  const first = (await page.locator("body").innerText()).match(/"n": \d/g)?.length || 0;
  await sleep(1200);
  const later = (await page.locator("body").innerText()).match(/"n": \d/g)?.length || 0;
  check(later > first, `chunks arrive incrementally (${first} → ${later})`);
  check(await page.getByRole("tab", { name: /Chunks/ }).count() > 0, "Chunks tab appears");
  check(await page.getByRole("tab", { name: /Events/ }).count() > 0, "Events tab appears");
  await page.getByRole("tab", { name: /Events/ }).click();
  await sleep(300);
  const ticks = ((await page.locator("body").innerText()).match(/tick/g) || []).length;
  check(ticks >= 3, `structured SSE events parsed (${ticks})`);
  await page.context().close();
}

async function settings(browser) {
  console.log("\nsettings");
  const page = await newPage(browser);
  await gotoApp(page);
  await page.locator("button[title='More']:visible").first().click();
  await page.getByText("Settings", { exact: true }).click();
  await page.waitForSelector("text=Appearance", { timeout: 10000 });
  const tabs = await page.locator("[role=tab]").allInnerTexts();
  for (const want of ["General", "Appearance", "View", "Updates"]) {
    check(tabs.includes(want), `tab: ${want}`);
  }
  if (!isCore) {
    check(tabs.includes("AI assistant"), "tab: AI assistant (full build)");
    check(tabs.includes("Access tokens"), "tab: Access tokens (full build)");
  }
  await page.context().close();

  step("mobile layout");
  const phone = await newPage(browser, { width: 390, height: 844 });
  await gotoApp(phone);
  await phone.locator("button[title='More']:visible").first().click();
  await phone.getByText("Settings", { exact: true }).click();
  await phone.waitForSelector("text=Appearance", { timeout: 10000 });
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  const width = Math.round(
    (await phone.locator("[role=dialog]").first().boundingBox()).width,
  );
  check(overflow <= 2, `no horizontal overflow (${overflow}px)`);
  check(width <= 390, `dialog fits the phone (${width}px)`);
  await phone.context().close();
}

async function gating(browser) {
  console.log(isCore ? "\ncore build gating" : "\nfull build features");
  const page = await newPage(browser);
  await gotoApp(page);
  await page.locator("button[title='More']:visible").first().click();
  await page.waitForTimeout(400);
  const items = await page.locator("[role=menuitem]").allInnerTexts();
  const joined = items.join("|");
  if (isCore) {
    check(!/AI assistant/.test(joined), "no AI entry in the core menu");
    check(!/Export docs/.test(joined), "no docs export in the core menu");
  } else {
    check(/Export docs/.test(joined), "docs export present in the full menu");
    check(/WebSocket console/.test(joined), "WebSocket console present");
  }
  await page.context().close();
}

async function main() {
  console.log(`curlui e2e → ${BASE} (${isCore ? "core" : "full"} build)`);
  const origin = await startOrigin();
  const server = await startCurlui();
  try {
    await seed();
    const browser = await launch();
    await smoke(browser);
    await streaming(browser);
    await settings(browser);
    await gating(browser);
    await browser.close();
  } finally {
    server.kill();
    origin.close();
  }
  const bad = failCount();
  console.log(bad === 0 ? "\nE2E PASSED" : `\nE2E FAILED (${bad} checks)`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e crashed:", err);
  process.exit(1);
});
