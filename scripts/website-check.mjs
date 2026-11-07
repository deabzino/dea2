import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), WEBSITE_PREVIEW: "true", DATABASE_URL: "postgresql://preview:preview@127.0.0.1:5432/preview", DISCORD_BOT_TOKEN: "" },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
server.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
const browser = await chromium.launch({ headless: true });
const screenshotRoot = path.join(os.tmpdir(), "dea-website-review");
await fs.mkdir(screenshotRoot, { recursive: true });
const consoleErrors = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const deadline = Date.now() + 10_000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Website preview exited early: ${stderr}`);
    try { const response = await fetch(`${base}/api/healthz`); ready = response.ok; } catch {}
    if (!ready) await pause(100);
  }
  assert.ok(ready, `Website preview failed to start: ${stderr}`);

  for (const [route, title] of [["/", "dea"], ["/commands", "Commands"], ["/changelog", "Changelog"], ["/status", "System status"]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => consoleErrors.push(`${route}: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`${route}: ${message.text()}`); });
    await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    await assert.doesNotReject(() => page.title());
    assert.ok((await page.title()).includes(title), `${route} title`);
    assert.equal(await page.locator(".site-nav").count(), 1, `${route} shared navbar`);
    assert.equal(await page.locator(".site-footer").count(), 1, `${route} shared footer`);
    await page.reload({ waitUntil: "networkidle" });
    await page.close();
  }

  // Theme preference loads before first paint and survives reload.
  const themePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  themePage.on("pageerror", (error) => consoleErrors.push(`theme: ${error.message}`));
  await themePage.goto(`${base}/`);
  assert.equal(await themePage.locator("html").getAttribute("data-theme"), "dark");
  await themePage.locator(".theme-toggle").click();
  await themePage.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await themePage.reload();
  assert.equal(await themePage.locator("html").getAttribute("data-theme"), "light");
  await themePage.close();

  const commandPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  commandPage.on("pageerror", (error) => consoleErrors.push(`commands: ${error.message}`));
  commandPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`commands: ${message.text()}`); });
  await commandPage.goto(`${base}/commands`, { waitUntil: "networkidle" });
  await commandPage.waitForFunction(() => document.querySelectorAll(".command-card").length > 0);
  assert.equal(await commandPage.locator(".command-card").count(), 12);
  await commandPage.locator('[data-category="utility"]').click();
  assert.ok(await commandPage.locator(".command-card").count() > 0);
  assert.match(commandPage.url(), /category=utility/);
  await commandPage.locator('[data-category="all"]').click();
  await commandPage.locator('[data-mode="prefix"]').click();
  assert.equal(await commandPage.locator(".command-card").count(), 11);
  await commandPage.locator('[data-mode="slash"]').click();
  await commandPage.locator('[data-mode="all"]').click();
  await commandPage.keyboard.press("/");
  assert.equal(await commandPage.locator("#command-search").evaluate((node) => document.activeElement === node), true);
  await commandPage.locator("#command-search").fill("dead");
  assert.ok(await commandPage.locator(".command-card").count() >= 1);
  assert.ok(await commandPage.locator("mark").count() > 0);
  await commandPage.locator("#command-search").fill("");
  const deadCard = commandPage.locator(".command-card").filter({ hasText: "/dead" }).first();
  await deadCard.locator(".command-summary").click();
  assert.equal(await deadCard.getAttribute("aria-expanded"), "true");
  const copyButton = deadCard.locator(".copy-button");
  await copyButton.click();
  await assert.doesNotReject(() => commandPage.waitForFunction(() => document.querySelector('.command-card[aria-expanded="true"] .copy-button')?.textContent === "Copied!"));
  assert.equal(await commandPage.evaluate(() => navigator.clipboard.readText()), ".dead @Jess");
  await commandPage.close();

  const changePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  changePage.on("pageerror", (error) => consoleErrors.push(`changelog: ${error.message}`));
  changePage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(`changelog: ${message.text()}`); });
  await changePage.goto(`${base}/changelog`, { waitUntil: "networkidle" });
  await changePage.waitForFunction(() => document.querySelectorAll(".timeline-entry").length > 0);
  assert.equal(await changePage.locator(".timeline-entry").count(), 5);
  await changePage.locator('[data-change-filter="Fixed"]').click();
  assert.ok(await changePage.locator(".timeline-entry").count() > 0);
  await changePage.locator('[data-change-filter="all"]').click();
  await changePage.locator("#collapse-all").click();
  assert.equal(await changePage.locator(".timeline-entry[aria-expanded=true]").count(), 0);
  await changePage.locator("#expand-all").click();
  assert.equal(await changePage.locator(".timeline-entry[aria-expanded=true]").count(), 5);
  await changePage.locator("#change-search").fill("restart");
  assert.ok(await changePage.locator(".timeline-entry").count() > 0);
  await changePage.close();

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: "dark" });
  phone.on("pageerror", (error) => consoleErrors.push(`mobile: ${error.message}`));
  await phone.goto(`${base}/commands`, { waitUntil: "networkidle" });
  const menuButton = phone.locator(".menu-toggle");
  await menuButton.click();
  assert.equal(await menuButton.getAttribute("aria-expanded"), "true");
  assert.equal(await phone.locator("body").evaluate((body) => getComputedStyle(body).overflow), "hidden");
  await phone.keyboard.press("Escape");
  assert.equal(await menuButton.getAttribute("aria-expanded"), "false");
  await menuButton.click();
  await phone.mouse.click(8, 700);
  assert.equal(await menuButton.getAttribute("aria-expanded"), "false");
  for (const width of [320, 375]) {
    await phone.setViewportSize({ width, height: 812 });
    for (const route of ["/", "/commands", "/changelog", "/status", "/not-a-page", "/api/healthz"]) {
      await phone.goto(`${base}${route}`, { waitUntil: "networkidle" });
      const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const offenders = overflow ? await phone.evaluate(() => [...document.querySelectorAll("body *")].map((element) => ({ tag: element.tagName, className: element.className?.baseVal ?? element.className, text: element.textContent?.trim().slice(0, 45), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) })).filter((item) => item.right > innerWidth + 1 || item.left < -1).slice(0, 12)) : [];
      assert.equal(overflow, false, `${route} must not scroll horizontally at ${width}px. Offenders: ${JSON.stringify(offenders)}`);
    }
  }
  await phone.goto(`${base}/`);
  await phone.locator('[data-demo="lobby"]').click();
  await phone.waitForFunction(() => document.querySelector("#chat-messages")?.textContent.includes(".code ABCDEF"), { timeout: 6000 });
  await phone.close();

  const shots = [
    ["home", "/"], ["commands", "/commands"], ["changelog", "/changelog"], ["status", "/status"],
    ["not-found", "/route-does-not-exist"], ["healthz-html", "/api/healthz?html=1"],
  ];
  for (const width of [375, 1440]) for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 }, colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript((value) => localStorage.setItem("dea-theme", value), theme);
    page.on("pageerror", (error) => consoleErrors.push(`screenshot ${width} ${theme}: ${error.message}`));
    for (const [name, route] of shots) {
      const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
      if (name === "healthz-html") assert.equal(response.status(), 200);
      if (name === "home") await page.waitForFunction(() => document.querySelectorAll("#chat-messages .chat-message").length >= 8, { timeout: 9000 });
      await page.screenshot({ path: path.join(screenshotRoot, `${name}-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
    }
    await page.close();
  }
  assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
  console.log(`Website checks passed. Screenshots saved outside the repository at ${screenshotRoot}`);
} finally {
  await browser.close();
  if (server.exitCode === null) server.kill("SIGTERM");
}
