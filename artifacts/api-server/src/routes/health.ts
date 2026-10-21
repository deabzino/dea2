import { Router, type IRouter } from "express";
import { getDiscordBotHealth } from "../discord/bot";

const router: IRouter = Router();

export const healthPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#090d13">
  <meta name="description" content="Live health and uptime dashboard for dea, the Among Us Discord bot.">
  <title>System status · dea</title>
  <style>
    :root{color-scheme:dark;--bg:#090d13;--panel:rgba(19,27,36,.78);--line:rgba(189,211,224,.11);--muted:#8796a5;--text:#edf5f7;--mint:#80f0c0;--blue:#8dbdff;--amber:#f2c879}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 12% 2%,rgba(28,104,96,.19),transparent 34%),radial-gradient(ellipse at 92% 35%,rgba(47,74,128,.17),transparent 36%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow-x:hidden}
    body:before{position:fixed;inset:0;z-index:-1;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:48px 48px;content:"";mask-image:linear-gradient(to bottom,black,transparent 85%)}
    .wrap{width:min(1040px,calc(100% - 40px));margin:0 auto;padding:46px 0 30px}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:62px;animation:rise .65s both}
    .brand{display:flex;align-items:center;gap:12px;font-size:15px;font-weight:700;letter-spacing:.02em}.brandmark{width:38px;height:38px;display:grid;place-items:center;border:1px solid rgba(128,240,192,.3);border-radius:13px;background:linear-gradient(145deg,rgba(128,240,192,.16),rgba(128,240,192,.035));color:var(--mint);font-size:18px;box-shadow:0 0 30px rgba(128,240,192,.08)}
    .live-pill{display:flex;align-items:center;gap:9px;padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:rgba(16,23,31,.68);color:#bdc9d2;font-size:12px}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 4px rgba(128,240,192,.1);animation:pulse 2s infinite}
    .hero{max-width:700px;margin-bottom:34px;animation:rise .75s .08s both}.eyebrow{display:flex;align-items:center;gap:9px;color:var(--mint);font-size:11px;font-weight:700;letter-spacing:.17em;text-transform:uppercase}.eyebrow:before{width:20px;height:1px;background:currentColor;content:""}
    h1{margin:16px 0 13px;font-size:clamp(40px,7vw,68px);line-height:1.03;letter-spacing:-.055em;font-weight:650}.hero p{max-width:570px;margin:0;color:#96a6b3;font-size:16px;line-height:1.7}
    .grid{display:grid;grid-template-columns:1.25fr .75fr;gap:16px}.card{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,rgba(24,34,45,.82),rgba(13,19,27,.82));box-shadow:0 20px 70px rgba(0,0,0,.17);backdrop-filter:blur(14px);animation:rise .7s both}.card:nth-child(2){animation-delay:.1s}.card:nth-child(3){animation-delay:.18s}.card:nth-child(4){animation-delay:.26s}.card:after{position:absolute;top:-100px;right:-100px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(128,240,192,.07),transparent 70%);content:"";pointer-events:none}
    .primary{min-height:252px;padding:26px 28px}.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.label{color:#9aa9b5;font-size:12px;font-weight:600;letter-spacing:.09em;text-transform:uppercase}.status-tag{display:flex;align-items:center;gap:8px;color:var(--mint);font-size:12px;font-weight:650}.status-tag .dot{width:7px;height:7px}
    .uptime{margin:25px 0 9px;font-variant-numeric:tabular-nums;font-size:clamp(43px,7vw,64px);font-weight:600;letter-spacing:-.055em;line-height:1}.sub{color:var(--muted);font-size:13px}
    .uptime-rail{height:3px;margin-top:29px;overflow:hidden;border-radius:4px;background:rgba(255,255,255,.07)}.uptime-rail span{display:block;width:48%;height:100%;border-radius:4px;background:linear-gradient(90deg,var(--mint),var(--blue));animation:scan 4s ease-in-out infinite alternate}
    .small{min-height:252px;padding:26px 25px}.big-number{margin-top:34px;font-size:54px;line-height:1;font-weight:600;letter-spacing:-.05em}.small .sub{margin-top:10px}
    .info{padding:21px 24px}.info-row{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:31px;color:var(--muted);font-size:13px}.info-row+.info-row{margin-top:9px}.value{color:#e0e8ed;text-align:right;font-variant-numeric:tabular-nums}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
    .service-dot{display:inline-block;width:7px;height:7px;margin-right:8px;border-radius:50%;background:var(--amber);vertical-align:1px}.service-dot.up{background:var(--mint);box-shadow:0 0 12px rgba(128,240,192,.45)}.service-dot.off{background:#73808d}
    footer{display:flex;justify-content:space-between;gap:20px;margin-top:28px;padding:0 3px;color:#687785;font-size:11px;animation:rise .7s .3s both}.footlink{color:#9aaab6;text-decoration:none}.footlink:hover{color:var(--mint)}
    @keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{50%{box-shadow:0 0 0 7px rgba(128,240,192,0)}}@keyframes scan{from{transform:translateX(-45%)}to{transform:translateX(155%)}}
    @media(max-width:700px){.wrap{padding-top:27px}header{margin-bottom:45px}.grid{grid-template-columns:1fr 1fr}.primary{grid-column:1/-1;min-height:225px}.small{min-height:185px;padding:22px}.big-number{margin-top:26px;font-size:45px}.info{grid-column:1/-1}.uptime{font-size:clamp(41px,12vw,59px)}}
    @media(max-width:430px){.wrap{width:calc(100% - 28px)}.grid{gap:10px}.primary,.small{padding:20px 18px}.card{border-radius:16px}.small .label{font-size:10px}.big-number{font-size:39px}.live-pill{font-size:11px;padding:8px 10px}footer{font-size:10px}}
    @media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  </style>
</head>
<body>
  <main class="wrap">
    <header>
      <div class="brand"><span class="brandmark">d</span><span>dea <span style="color:#83929f;font-weight:500">/ system status</span></span></div>
      <div class="live-pill"><span class="dot" id="header-dot"></span><span id="header-status">Checking live status</span></div>
    </header>
    <section class="hero">
      <div class="eyebrow">Service monitor</div>
      <h1>All systems,<br>in their element.</h1>
      <p>A live look at dea's API and Discord connection. Everything here refreshes automatically, so you can get back to the game.</p>
    </section>
    <section class="grid" aria-label="Live service information">
      <article class="card primary">
        <div class="card-head"><span class="label">This session has been up</span><span class="status-tag"><span class="dot"></span>LIVE</span></div>
        <div class="uptime" id="uptime">--:--:--</div>
        <div class="sub">Process uptime · counting in real time</div>
        <div class="uptime-rail"><span></span></div>
      </article>
      <article class="card small">
        <div class="label">Discord bot</div>
        <div class="big-number" id="bot-status">...</div>
        <div class="sub" id="bot-detail">Checking connection</div>
      </article>
      <article class="card info">
        <div class="info-row"><span>API service</span><span class="value" id="api-status"><i class="service-dot up"></i>Operational</span></div>
        <div class="info-row"><span>Discord servers</span><span class="value" id="guild-count">—</span></div>
        <div class="info-row"><span>Gateway latency</span><span class="value" id="gateway-ping">—</span></div>
      </article>
      <article class="card info">
        <div class="info-row"><span>Runtime</span><span class="value mono" id="runtime">Node.js</span></div>
        <div class="info-row"><span>Server time</span><span class="value mono" id="clock">—</span></div>
        <div class="info-row"><span>Last checked</span><span class="value" id="checked">Just now</span></div>
      </article>
    </section>
    <footer><span>Made for the moments between rounds.</span><a class="footlink" href="/api/healthz">Health check API ↗</a></footer>
  </main>
  <script>
    (() => {
      const $ = (id) => document.getElementById(id);
      let uptimeBase = 0;
      let fetchedAt = Date.now();
      const duration = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor(seconds % 86400 / 3600);
        const minutes = Math.floor(seconds % 3600 / 60);
        const secs = Math.floor(seconds % 60);
        const pad = (value) => String(value).padStart(2, "0");
        return days ? days + "d " + pad(hours) + ":" + pad(minutes) + ":" + pad(secs) : pad(hours) + ":" + pad(minutes) + ":" + pad(secs);
      };
      const tick = () => {
        $("uptime").textContent = duration(uptimeBase + Math.floor((Date.now() - fetchedAt) / 1000));
        $("clock").textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
      };
      const refresh = async () => {
        try {
          const response = await fetch("/api/health", { cache: "no-store" });
          if (!response.ok) throw new Error("Health endpoint returned " + response.status);
          const data = await response.json();
          uptimeBase = data.uptimeSeconds;
          fetchedAt = Date.now();
          const online = data.discord.status === "online";
          const disabled = data.discord.status === "disabled";
          $("header-status").textContent = data.status === "ok" ? "API service operational" : "Service issue detected";
          $("header-dot").style.background = data.status === "ok" ? "var(--mint)" : "#f27676";
          $("bot-status").textContent = online ? "Online" : disabled ? "Offline" : "Starting";
          $("bot-status").style.color = online ? "var(--mint)" : disabled ? "var(--muted)" : "var(--amber)";
          $("bot-detail").textContent = online ? data.discord.username : disabled ? "Bot token not configured" : "Connecting to Discord gateway";
          $("guild-count").textContent = online ? data.discord.guildCount.toLocaleString() : "—";
          $("gateway-ping").textContent = data.discord.pingMs === null ? "—" : data.discord.pingMs + " ms";
          $("runtime").textContent = data.nodeVersion;
          $("api-status").innerHTML = '<i class="service-dot ' + (data.status === "ok" ? "up" : "off") + '"></i>' + (data.status === "ok" ? "Operational" : "Degraded");
          $("checked").textContent = "Just now";
          tick();
        } catch {
          $("header-status").textContent = "Health check unavailable";
          $("header-dot").style.background = "#f27676";
          $("api-status").innerHTML = '<i class="service-dot off"></i>Unreachable';
          $("checked").textContent = "Retrying";
        }
      };
      tick();
      refresh();
      setInterval(tick, 1000);
      setInterval(refresh, 15000);
    })();
  </script>
</body>
</html>`;

router.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    discord: getDiscordBotHealth(),
  });
});

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
