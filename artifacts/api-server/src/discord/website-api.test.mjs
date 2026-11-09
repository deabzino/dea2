import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { commandCatalog } from "./commandCatalog.ts";

let child;
let base;
let sourceBodies = "";

before(async () => {
  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), WEBSITE_PREVIEW: "true", DATABASE_URL: "postgresql://preview:preview@127.0.0.1:5432/preview", DISCORD_BOT_TOKEN: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Preview server exited before listening: ${stderr}`);
    try { const response = await fetch(`${base}/api/healthz`, { headers: { accept: "application/json" } }); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview server did not start: ${stderr}`);
});

after(() => { if (child && child.exitCode === null) child.kill("SIGTERM"); });

test("registered commands stay synchronized with the single catalog", async () => {
  const bot = await readFile("artifacts/api-server/src/discord/bot.ts", "utf8");
  const block = bot.match(/const COMMAND_NAMES = \[([\s\S]*?)\] as const;/)?.[1];
  assert.ok(block, "bot command declaration should be present");
  const registered = [...block.matchAll(/"([a-z]+)"/g)].map((match) => match[1]).sort();
  const catalog = commandCatalog.map((command) => command.name).sort();
  assert.deepEqual(catalog, registered);
});

test("production preview serves direct pages and safe public data", async () => {
  const routes = ["/", "/commands", "/changelog", "/status", "/404", "/health"];
  for (const route of routes) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, `${route} should load directly`);
    assert.equal(response.headers.get("x-robots-tag"), "noindex", `${route} should be excluded from indexing`);
    const body = await response.text();
    assert.match(body, /name="robots" content="noindex"/);
    assert.match(body, /site\.css\?v=6/);
    assert.match(body, /og:image/);
    assert.match(body, /twitter:card.*summary_large_image/);
    assert.doesNotMatch(body, /__SITE_URL__/);
    sourceBodies += body;
  }
  const page404 = await fetch(`${base}/not-a-page`);
  assert.equal(page404.status, 404);
  assert.match(await page404.text(), /This page missed/);

  const [statusResponse, commandsResponse] = await Promise.all([fetch(`${base}/api/status`), fetch(`${base}/api/commands`)]);
  assert.equal(statusResponse.status, 200);
  assert.equal(commandsResponse.status, 200);
  assert.equal(statusResponse.headers.get("x-robots-tag"), "noindex");
  assert.equal(commandsResponse.headers.get("x-robots-tag"), "noindex");
  const status = await statusResponse.json();
  const commandsText = await commandsResponse.text();
  const commands = JSON.parse(commandsText);
  assert.deepEqual(Object.keys(status).sort(), ["avatarUrl", "botOnline", "botUptimeMs", "currentTime", "discordPingMs", "lastRestart", "publicCommandCount", "serverCount", "webUptimeMs"].sort());
  assert.equal(status.avatarUrl, null);
  assert.equal(status.discordPingMs, null);
  assert.equal(status.publicCommandCount, commands.length);
  assert.equal(commands.length, commandCatalog.filter((command) => !command.hiddenFromWebsite).length);
  assert.ok(commands.every((command) => command.hiddenFromWebsite !== true));
  sourceBodies += commandsText + JSON.stringify(status);

  for (const route of ["/", "/commands", "/changelog", "/status", "/404"]) {
    const html = await (await fetch(`${base}${route}`)).text();
    for (const href of ["/favicon.ico?v=4", "/favicon-16x16.png?v=4", "/favicon-32x32.png?v=4", "/favicon-48x48.png?v=4", "/favicon.svg?v=4", "/apple-touch-icon.png?v=4", "/icon-192.png?v=4", "/icon-512.png?v=4", "/site.webmanifest?v=4"]) assert.ok(html.includes(href), `${route} should link ${href}`);
  }
  for (const asset of ["/changelog.json", "/shared.js?v=4", "/home.js?v=4", "/commands.js?v=1", "/changelog.js?v=2", "/status.js?v=1", "/site.css?v=6", "/site.webmanifest?v=4", "/robots.txt", "/favicon.svg?v=4"]) {
    const response = await fetch(`${base}${asset}`);
    assert.equal(response.status, 200, `${asset} should be included in the deployed output`);
    assert.equal(response.headers.get("x-robots-tag"), "noindex", `${asset} should carry the noindex header`);
    if (asset === "/robots.txt") {
      assert.match(response.headers.get("content-type") ?? "", /^text\/plain\b/i);
      assert.equal((await response.text()).replace(/\r\n/g, "\n"), "User-agent: *\nAllow: /\n");
      continue;
    }
    if (asset.startsWith("/favicon.svg")) assert.match(response.headers.get("content-type") ?? "", /^image\/svg\+xml\b/i);
    if (asset.startsWith("/site.webmanifest")) assert.match(response.headers.get("content-type") ?? "", /^application\/(?:manifest\+json|json)\b/i);
    sourceBodies += await response.text();
  }
  for (const [asset, width, height] of [["favicon-16x16.png",16,16],["favicon-32x32.png",32,32],["favicon-48x48.png",48,48],["apple-touch-icon.png",180,180],["icon-192.png",192,192],["icon-512.png",512,512],["og-image.png",1200,630]]) {
    const response = await fetch(`${base}/${asset}`);
    assert.equal(response.status, 200, `${asset} should be present in the production output`);
    assert.match(response.headers.get("content-type") ?? "", /^image\/png\b/i, `${asset} content type`);
    const png = Buffer.from(await response.arrayBuffer());
    assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    assert.equal(png.readUInt32BE(16), width, `${asset} width`);
    assert.equal(png.readUInt32BE(20), height, `${asset} height`);
  }
  const manifest = await (await fetch(`${base}/site.webmanifest?v=4`)).json();
  assert.deepEqual(manifest.icons.map(({ src, sizes }) => [src, sizes]), [["/icon-192.png?v=4", "192x192"], ["/icon-512.png?v=4", "512x512"]]);
  const icoResponse = await fetch(`${base}/favicon.ico?v=4`);
  assert.match(icoResponse.headers.get("content-type") ?? "", /^image\/(?:vnd\.microsoft\.icon|x-icon)\b/i, "favicon.ico content type");
  const ico = Buffer.from(await icoResponse.arrayBuffer());
  assert.equal(ico.readUInt16LE(4), 3, "favicon.ico should contain 16, 32 and 48 px images");
  const healthzStart = performance.now();
  const healthz = await fetch(`${base}/api/healthz`, { headers: { accept: "application/json" } });
  assert.equal(healthz.headers.get("x-robots-tag"), "noindex");
  const healthzBody = await healthz.json();
  assert.deepEqual(healthzBody, { status: "ok" });
  sourceBodies += JSON.stringify(healthzBody);
  assert.ok(performance.now() - healthzStart < 500, "health check should remain fast");
  const healthStart = performance.now();
  const healthResponse = await fetch(`${base}/api/health`);
  assert.equal(healthResponse.headers.get("x-robots-tag"), "noindex");
  const health = await healthResponse.json();
  sourceBodies += JSON.stringify(health);
  assert.deepEqual(Object.keys(health).sort(), ["discord", "nodeVersion", "status", "uptimeSeconds"].sort());
  assert.deepEqual(Object.keys(health.discord).sort(), ["guildCount", "pingMs", "status", "username"].sort());
  assert.ok(performance.now() - healthStart < 500, "health API should remain fast");
  const htmlHealth = await fetch(`${base}/api/healthz`, { headers: { accept: "text/html" } });
  assert.equal(htmlHealth.status, 200);
  assert.equal(htmlHealth.headers.get("x-robots-tag"), "noindex");
  const htmlHealthBody = await htmlHealth.text();
  assert.match(htmlHealthBody, /data-shared-nav/);
  sourceBodies += htmlHealthBody;
});

test("public pages and responses do not disclose hidden command data or snowflake IDs", () => {
  assert.doesNotMatch(sourceBodies, /nword|ncount|nleaderboard|nclear|ncounter/i);
  assert.doesNotMatch(sourceBodies, /\b\d{17,20}\b/);
  assert.doesNotMatch(sourceBodies, /DISCORD_BOT_TOKEN|DATABASE_URL|postgresql:\/\//i);
});
