(() => {
  const $ = (id) => document.getElementById(id);
  const banner = $("status-banner");
  if (!banner) return;
  let latest = null;
  let fetchedAt = Date.now();
  let first = true;
  let timer = null;
  let wakingTimer = null;
  let inFlight = false;
  const duration = (milliseconds) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const rest = seconds % 60;
    const pad = (number) => String(number).padStart(2, "0");
    return days ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(rest)}` : `${pad(hours)}:${pad(minutes)}:${pad(rest)}`;
  };
  const countUp = (node, target, suffix = "") => {
    if (!Number.isFinite(target)) return;
    const start = performance.now();
    const tick = (now) => { const progress = Math.min(1, (now - start) / 700); node.textContent = `${Math.round(target * (1 - (1 - progress) ** 3))}${suffix}`; if (progress < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  const setBanner = (kind, text) => { banner.className = `status-banner is-${kind}`; $("banner-text").textContent = text; };
  const tick = () => {
    if (!latest || document.hidden) return;
    $("uptime-value").textContent = duration(latest.webUptimeMs + Date.now() - fetchedAt);
    $("server-time").textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(Date.parse(latest.currentTime) + Date.now() - fetchedAt));
  };
  const render = (data) => {
    latest = data;
    fetchedAt = Date.now();
    const botOnline = data.botOnline === true;
    setBanner(botOnline ? "online" : "offline", botOnline ? "All systems operational" : "Bot is offline");
    $("bot-state").textContent = botOnline ? "Online" : "Offline";
    $("bot-detail").textContent = botOnline ? `Connected · uptime ${duration(data.botUptimeMs)}` : "The Discord connection is currently unavailable";
    $("bot-state").style.color = botOnline ? "var(--accent)" : "var(--red)";
    $("api-state").innerHTML = '<i class="service-dot up"></i>Operational';
    $("gateway-ping").textContent = Number.isFinite(data.discordPingMs) && data.discordPingMs > 0 ? `${data.discordPingMs} ms` : "Measuring…";
    $("server-count").textContent = first ? "0" : Number(data.serverCount || 0).toLocaleString();
    $("last-restart").textContent = data.lastRestart ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.lastRestart)) : "Not available";
    $("last-checked").textContent = "Just now";
    if (first) {
      countUp($("server-count"), Number(data.serverCount || 0));
      if (Number.isFinite(data.discordPingMs) && data.discordPingMs > 0) countUp($("gateway-ping"), data.discordPingMs, " ms");
      first = false;
    }
    tick();
  };
  const refresh = async () => {
    if (document.hidden || inFlight) return;
    inFlight = true;
    if (!latest) wakingTimer = setTimeout(() => setBanner("waking", "Waking up the service, this can take a minute"), 900);
    try {
      const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error("Status request failed");
      render(await response.json());
    } catch {
      $("last-checked").textContent = "Retrying";
      if (latest) setBanner("error", "Can’t reach the service");
      else setBanner("waking", "Waking up the service, this can take a minute");
    } finally {
      clearTimeout(wakingTimer);
      inFlight = false;
      clearTimeout(timer);
      timer = setTimeout(refresh, latest ? 15000 : 2500);
    }
  };
  const start = () => { clearTimeout(timer); refresh(); };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearTimeout(timer); clearTimeout(wakingTimer); }
    else { tick(); start(); }
  });
  setInterval(tick, 1000);
  refresh();
})();
