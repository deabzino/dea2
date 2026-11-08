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
const listenConsole = (page, label) => page.on("console", (message) => {
  if (message.type() !== "error") return;
  const expected404 = ["/not-a-page", "/route-does-not-exist"].includes(new URL(page.url()).pathname) && /404/.test(message.text());
  if (!expected404) consoleErrors.push(`${label}: ${message.text()}`);
});

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
    listenConsole(page, route);
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
  listenConsole(themePage, "theme");
  await themePage.goto(`${base}/`);
  assert.equal(await themePage.locator("html").getAttribute("data-theme"), "dark");
  await themePage.waitForFunction(() => document.querySelector("#hero-command-count")?.textContent.match(/^\d+ commands · slash and prefix$/));
  assert.equal(await themePage.locator("#hero-command-count").textContent(), "12 commands · slash and prefix");
  assert.equal(await themePage.locator(".mini-avatars").count(), 0);
  assert.equal(await themePage.locator(".window-users").textContent(), "#", "the chat header should not show fake user avatars");
  const featureMetrics = await themePage.locator(".feature-card").evaluateAll((cards) => {
    const boxes = cards.map((card) => ({ card: card.getBoundingClientRect(), chip: card.querySelector(".feature-link").getBoundingClientRect() }));
    return { heights: boxes.map(({ card }) => card.height), bottoms: boxes.map(({ card, chip }) => card.bottom - chip.bottom) };
  });
  assert.ok(Math.max(...featureMetrics.heights) - Math.min(...featureMetrics.heights) < 1, "home feature cards should have equal height");
  assert.ok(Math.max(...featureMetrics.bottoms) - Math.min(...featureMetrics.bottoms) < 1, "feature command chips should align at the bottom");
  const desktopCta = await themePage.locator(".final-cta").evaluate((box) => {
    const card = box.getBoundingClientRect();
    const ring = box.querySelector(".cta-orb").getBoundingClientRect();
    return ring.left >= card.left && ring.top >= card.top && ring.right <= card.right && ring.bottom <= card.bottom;
  });
  assert.equal(desktopCta, true, "decorative CTA ring should fit inside the card on desktop");
  await themePage.locator(".theme-toggle").click();
  await themePage.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await themePage.reload();
  assert.equal(await themePage.locator("html").getAttribute("data-theme"), "light");
  await themePage.close();

  const commandPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  commandPage.on("pageerror", (error) => consoleErrors.push(`commands: ${error.message}`));
  listenConsole(commandPage, "commands");
  await commandPage.goto(`${base}/commands`, { waitUntil: "networkidle" });
  await commandPage.waitForFunction(() => document.querySelectorAll(".command-card").length > 0);
  assert.equal(await commandPage.locator(".command-card").count(), 12);
  assert.ok(await commandPage.locator(".command-symbol svg").count() > 0);
  assert.ok(await commandPage.locator(".command-symbol svg").evaluateAll((icons) => new Set(icons.map((icon) => icon.querySelector("path")?.getAttribute("d"))).size >= 3), "each command category should have its own icon");
  const desktopPills = commandPage.locator(".category-scroll-wrap");
  assert.equal(await desktopPills.evaluate((node) => node.classList.contains("can-scroll-left") || node.classList.contains("can-scroll-right")), false, "category fade and arrows should be hidden when all pills fit");
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
  assert.equal(await deadCard.locator(".expand-arrow svg").evaluate((node) => getComputedStyle(node).transform), "none");
  await deadCard.locator(".command-summary").click();
  assert.equal(await deadCard.getAttribute("aria-expanded"), "true");
  assert.notEqual(await deadCard.locator(".expand-arrow svg").evaluate((node) => getComputedStyle(node).transform), "none", "command chevron should rotate open");
  const copyButton = deadCard.locator(".copy-button");
  await copyButton.click();
  await assert.doesNotReject(() => commandPage.waitForFunction(() => document.querySelector('.command-card[aria-expanded="true"] .copy-button')?.textContent === "Copied!"));
  assert.equal(await commandPage.evaluate(() => navigator.clipboard.readText()), ".dead @Jess");
  await commandPage.close();

  const changePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  changePage.on("pageerror", (error) => consoleErrors.push(`changelog: ${error.message}`));
  listenConsole(changePage, "changelog");
  await changePage.goto(`${base}/changelog`, { waitUntil: "networkidle" });
  await changePage.waitForFunction(() => document.querySelectorAll(".timeline-entry").length > 0);
  assert.equal(await changePage.locator(".timeline-entry").count(), 7);
  assert.equal(await changePage.locator(".latest-badge").count(), 1);
  const changelogWidth = await changePage.locator(".timeline-entry").first().evaluate((node) => node.getBoundingClientRect().width / document.querySelector("main").getBoundingClientRect().width);
  assert.ok(changelogWidth > .95, `changelog cards should fill the content width, got ${changelogWidth}`);
  assert.equal(await changePage.locator(".entry-arrow svg").count(), 7);
  assert.notEqual(await changePage.locator(".entry-arrow svg").first().evaluate((node) => getComputedStyle(node).transform), "none", "expanded changelog chevron should be rotated");
  await changePage.locator(".entry-arrow").first().click();
  await changePage.waitForFunction(() => getComputedStyle(document.querySelector(".entry-arrow svg")).transform === "none");
  assert.equal(await changePage.locator(".entry-arrow svg").first().evaluate((node) => getComputedStyle(node).transform), "none", "collapsed changelog chevron should return to its closed position");
  await changePage.locator('[data-change-filter="Fixed"]').click();
  assert.ok(await changePage.locator(".timeline-entry").count() > 0);
  await changePage.locator('[data-change-filter="all"]').click();
  await changePage.locator("#collapse-all").click();
  assert.equal(await changePage.locator(".timeline-entry[aria-expanded=true]").count(), 0);
  await changePage.locator("#expand-all").click();
  assert.equal(await changePage.locator(".timeline-entry[aria-expanded=true]").count(), 7);
  await changePage.locator("#change-search").fill("restart");
  assert.ok(await changePage.locator(".timeline-entry").count() > 0);
  await changePage.close();

  const phone = await browser.newPage({ viewport: { width: 375, height: 812 }, colorScheme: "dark" });
  phone.on("pageerror", (error) => consoleErrors.push(`mobile: ${error.message}`));
  listenConsole(phone, "mobile");
  await phone.goto(`${base}/commands`, { waitUntil: "networkidle" });
  const phonePills = phone.locator(".category-scroll-wrap");
  await phone.waitForFunction(() => document.querySelector(".category-scroll-wrap")?.classList.contains("can-scroll-right"));
  assert.equal(await phonePills.evaluate((node) => node.classList.contains("can-scroll-left")), false);
  await phone.locator(".category-pills").evaluate((node) => { node.scrollLeft = node.scrollWidth; });
  await phone.waitForFunction(() => document.querySelector(".category-scroll-wrap")?.classList.contains("can-scroll-left") && !document.querySelector(".category-scroll-wrap")?.classList.contains("can-scroll-right"));
  await phone.goto(`${base}/changelog`, { waitUntil: "networkidle" });
  assert.ok(await phone.locator("#expand-all").evaluate((node) => node.getBoundingClientRect().height >= 44));
  assert.ok(await phone.locator("#collapse-all").evaluate((node) => node.getBoundingClientRect().height >= 44));
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
  const phoneCta = await phone.locator(".final-cta").evaluate((box) => {
    const card = box.getBoundingClientRect();
    const ring = box.querySelector(".cta-orb").getBoundingClientRect();
    return ring.left >= card.left && ring.top >= card.top && ring.right <= card.right && ring.bottom <= card.bottom;
  });
  assert.equal(phoneCta, true, "decorative CTA ring should fit inside the card on phones");
  await phone.locator('[data-demo="lobby"]').click();
  await phone.waitForFunction(() => document.querySelector("#chat-messages")?.textContent.includes(".code ABCDEF"), { timeout: 6000 });
  await phone.close();

  const widthPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  widthPage.on("pageerror", (error) => consoleErrors.push(`width: ${error.message}`));
  listenConsole(widthPage, "width");
  await widthPage.goto(`${base}/commands`, { waitUntil: "networkidle" });
  const commandsShell = await widthPage.locator("main").boundingBox();
  await widthPage.goto(`${base}/status`, { waitUntil: "networkidle" });
  const statusShell = await widthPage.locator("main").boundingBox();
  assert.ok(Math.abs(commandsShell.x - statusShell.x) < 1 && Math.abs(commandsShell.width - statusShell.width) < 1, "status page should align with the other page containers");
  assert.equal(await widthPage.locator(".uptime-rail").count(), 0, "the decorative uptime rail should be removed");
  assert.equal(await widthPage.locator(".desktop-links a").filter({ hasText: "Bot status" }).count(), 1);
  assert.equal(await widthPage.locator(".site-footer nav a").filter({ hasText: "Bot status" }).count(), 1);
  await widthPage.close();

  const shots = [
    ["home", "/"], ["commands", "/commands"], ["changelog", "/changelog"], ["status", "/status"],
    ["not-found", "/route-does-not-exist"], ["healthz-html", "/api/healthz?html=1"],
  ];
  for (const width of [375, 1440]) for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 }, colorScheme: theme, reducedMotion: "reduce" });
    await page.addInitScript((value) => localStorage.setItem("dea-theme", value), theme);
    page.on("pageerror", (error) => consoleErrors.push(`screenshot ${width} ${theme}: ${error.message}`));
    listenConsole(page, `screenshot ${width} ${theme}`);
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
