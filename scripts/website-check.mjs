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

  for (const route of ["/", "/commands", "/changelog", "/status", "/404.html"]) {
    const html = await (await fetch(`${base}${route}`)).text();
    assert.ok(html.indexOf('id="theme-bootstrap"') < html.indexOf('href="/site.css?v=4"'), `${route} applies theme before CSS`);
  }

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
  const avatarFixture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#5865f2"/><path d="M5 12 11 14 14 8 16 12 18 8 21 14 27 12 25 21 20 18 16 24 12 18 7 21Z" fill="white"/></svg>')}`;
  await themePage.route("**/api/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ avatarUrl: avatarFixture, botOnline: true, currentTime: new Date().toISOString(), serverCount: 0, discordPingMs: 1 }) }));
  await themePage.addInitScript(() => {
    if (!sessionStorage.getItem("theme-check-set")) {
      localStorage.setItem("dea-theme", "light");
      sessionStorage.setItem("theme-check-set", "1");
    }
    document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(() => { window.__themeAtFirstFrame = document.documentElement.dataset.theme; }), { once: true });
  });
  await themePage.goto(`${base}/`);
  assert.equal(await themePage.evaluate(() => window.__themeAtFirstFrame), "light", "saved theme should be applied before the first rendered frame");
  assert.equal(await themePage.locator("html").getAttribute("data-theme"), "light");
  await themePage.waitForFunction(() => document.querySelector("#hero-command-count")?.textContent.match(/^\d+ commands · slash and prefix$/));
  assert.equal(await themePage.locator("#hero-command-count").textContent(), "12 commands · slash and prefix");
  assert.equal(await themePage.locator(".mini-avatars").count(), 0);
  assert.equal(await themePage.locator(".voice-card").count(), 1, "hero voice channel card should render");
  await themePage.waitForFunction(() => { const img = document.querySelector(".voice-bot-avatar img"); return img?.complete && img.naturalWidth > 0; });
  assert.equal(await themePage.locator(".voice-bot-avatar img").getAttribute("src"), avatarFixture, "hero card should use the shared bot pfp URL");
  const voiceRows = themePage.locator(".voice-player");
  assert.deepEqual(await voiceRows.evaluateAll((rows) => rows.map((row) => row.dataset.playerName)), ["Turhan", "Arian", "Sanuar", "Sabbir"]);
  assert.ok(await voiceRows.evaluateAll((rows) => rows.every((row) => row.querySelector(".mic-icon").getAttribute("aria-label") === "Microphone muted")), "Playing should mute everyone");
  await themePage.locator('[data-game-state="meeting"]').click();
  assert.equal(await themePage.locator('[data-game-state="meeting"]').getAttribute("aria-pressed"), "true");
  assert.equal(await themePage.locator('[data-game-state="playing"]').getAttribute("aria-pressed"), "false");
  assert.equal(await themePage.locator("[data-voice-status]").textContent(), "Server unmuted everyone");
  assert.equal(await voiceRows.nth(1).locator(".mic-icon").getAttribute("aria-label"), "Microphone on", "Meeting should unmute alive players");
  assert.equal(await voiceRows.first().locator(".mic-icon").getAttribute("aria-label"), "Microphone muted", "dead players stay muted in a meeting");
  await voiceRows.nth(1).click();
  assert.equal(await voiceRows.nth(1).getAttribute("data-dead"), "true");
  assert.equal(await voiceRows.nth(1).getAttribute("aria-label"), "Mark Arian as alive");
  assert.equal(await themePage.locator("[data-voice-status]").textContent(), "Marked Arian as dead and server-muted them.");
  assert.equal(await voiceRows.nth(1).locator(".mic-icon").getAttribute("aria-label"), "Microphone muted");
  await voiceRows.nth(1).click();
  assert.equal(await voiceRows.nth(1).getAttribute("data-dead"), "false");
  assert.equal(await themePage.locator("[data-voice-status]").textContent(), "Cleared Arian from the dead list.");
  await themePage.locator("[data-new-round]").click();
  assert.equal(await voiceRows.evaluateAll((rows) => rows.every((row) => row.dataset.dead === "false")), true);
  assert.equal(await voiceRows.first().locator(".dead-label").isHidden(), true);
  assert.equal(await themePage.locator("[data-voice-status]").textContent(), "Started a new round.");
  const phonePage = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await phonePage.route("**/api/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ avatarUrl: avatarFixture, botOnline: true, currentTime: new Date().toISOString(), serverCount: 0, discordPingMs: 1 }) }));
  await phonePage.goto(`${base}/`, { waitUntil: "networkidle" });
  assert.equal(await phonePage.locator(".voice-bot-avatar img").evaluate((img) => img.complete && img.naturalWidth > 0), true, "hero pfp should load at phone width");
  await phonePage.locator('[data-game-state="meeting"]').click();
  await phonePage.waitForFunction(() => { const button = document.querySelector('[data-game-state="meeting"]'); const probe = document.createElement("span"); probe.style.color = "var(--red)"; document.body.append(probe); const expected = getComputedStyle(probe).color; probe.remove(); return button?.classList.contains("is-selected") && getComputedStyle(button).color === expected; });
  assert.equal(await phonePage.locator('[data-game-state="meeting"]').evaluate((button) => button.classList.contains("is-selected")), true, "Meeting state should use the theme's red accent in light mode");
  assert.equal(await phonePage.locator(".voice-player").evaluateAll((rows) => rows.every((row) => { const card = row.closest(".voice-card").getBoundingClientRect(); const bounds = row.getBoundingClientRect(); return bounds.left >= card.left && bounds.right <= card.right; })), true, "voice rows should not be clipped at phone width");
  assert.equal(await phonePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "home page should have no horizontal scroll at 390px");
  await phonePage.close();
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
  await themePage.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await themePage.reload();
  assert.equal(await themePage.locator("html").getAttribute("data-theme"), "dark");
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
  assert.equal(await commandPage.evaluate(() => navigator.clipboard.readText()), ".dead @Turhan");
  await commandPage.close();

  const changePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  changePage.on("pageerror", (error) => consoleErrors.push(`changelog: ${error.message}`));
  listenConsole(changePage, "changelog");
  await changePage.goto(`${base}/changelog`, { waitUntil: "networkidle" });
  await changePage.waitForFunction(() => document.querySelectorAll(".timeline-entry").length > 0);
  const changelogEntryCount = await changePage.evaluate(async () => (await (await fetch("/changelog.json")).json()).length);
  assert.equal(await changePage.locator(".timeline-entry").count(), changelogEntryCount);
  assert.match(await changePage.locator(".entry-date").first().textContent(), /ago/);
  assert.equal(await changePage.locator(".latest-badge").count(), 1);
  const changelogWidth = await changePage.locator(".timeline-entry").first().evaluate((node) => node.getBoundingClientRect().width / document.querySelector("main").getBoundingClientRect().width);
  assert.ok(changelogWidth > .95, `changelog cards should fill the content width, got ${changelogWidth}`);
  assert.equal(await changePage.locator(".entry-arrow svg").count(), changelogEntryCount);
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
  assert.equal(await changePage.locator(".timeline-entry[aria-expanded=true]").count(), changelogEntryCount);
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

  const navigationPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  navigationPage.on("pageerror", (error) => consoleErrors.push(`navigation: ${error.message}`));
  listenConsole(navigationPage, "navigation");
  await navigationPage.goto(`${base}/commands`, { waitUntil: "networkidle" });
  assert.equal(await navigationPage.evaluate(() => history.scrollRestoration), "auto", "browser history should restore page scroll positions");
  assert.equal(await navigationPage.locator('.desktop-links a[aria-current="page"]').textContent(), "Commands");
  await navigationPage.evaluate(() => scrollTo({ top: 500, behavior: "instant" }));
  await navigationPage.waitForFunction(() => scrollY > 300);
  await navigationPage.locator('.desktop-links a[href="/changelog"]').click();
  await navigationPage.waitForLoadState("networkidle");
  assert.ok(await navigationPage.evaluate(() => scrollY < 5), "normal navigation starts at the top");
  assert.equal(await navigationPage.locator('.desktop-links a[aria-current="page"]').textContent(), "Changelog");
  await navigationPage.goBack({ waitUntil: "networkidle" });
  assert.equal(await navigationPage.locator('.desktop-links a[aria-current="page"]').textContent(), "Commands", "back navigation restores the previous page");
  await navigationPage.locator('.desktop-links a[href="/status"]').click();
  await navigationPage.waitForLoadState("networkidle");
  assert.equal(await navigationPage.locator('.desktop-links a[aria-current="page"]').textContent(), "Bot status");
  await navigationPage.locator('.desktop-links a[href="/#features"]').click();
  await navigationPage.waitForLoadState("networkidle");
  await navigationPage.waitForFunction(() => location.pathname === "/" && location.hash === "#features");
  await pause(800);
  const featureAnchor = await navigationPage.locator("#features").evaluate((node) => ({ top: node.getBoundingClientRect().top, scrollY, href: location.href }));
  assert.ok(featureAnchor.top >= 80 && featureAnchor.top < 220, `feature anchor should land below the sticky nav: ${JSON.stringify(featureAnchor)}`);
  await navigationPage.close();

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
