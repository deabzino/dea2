(() => {
  const $ = (id) => document.getElementById(id);
  const heroCommandCount = $("hero-command-count");
  if (heroCommandCount) fetch("/api/commands", { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error();
    return response.json();
  }).then((data) => {
    if (!Array.isArray(data)) throw new Error();
    const count = data.filter((command) => command.hiddenFromWebsite !== true).length;
    heroCommandCount.textContent = `${count} commands · slash and prefix`;
  }).catch(() => { heroCommandCount.textContent = "Commands · slash and prefix"; });
  const messagesRoot = document.getElementById("chat-messages");
  if (!messagesRoot) return;
  const demos = {
    round: [
      ["user", ".dead @Jess"],
      ["bot", "Marked @Jess as dead and server-muted them."],
      ["user", ".mute"],
      ["bot", "Server muted everyone in Voice 1 (2 members changed)."],
      ["user", ".list"],
      ["embed", "Dead Players", "Players currently marked dead are shown below. · Jess · Voice channel: Voice 1 · Mute state: Server muted"],
      ["user", ".unmute"],
      ["bot", "Unserver muted everyone in Voice 1 (1 member changed)."],
    ],
    lobby: [
      ["user", ".code ABCDEF"],
      ["bot", "The code is ABCDEF. I’ll remember it for this server."],
      ["user", ".code"],
      ["bot", "The code is ABCDEF."],
      ["user", ".mute"],
      ["bot", "Server muted everyone in Voice 1 (3 members changed)."],
      ["user", ".unmute"],
      ["bot", "Unserver muted everyone in Voice 1 (3 members changed)."],
    ],
  };
  let timer = null;
  let sequence = 0;
  const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const makeMessage = (message) => {
    const user = message[0] === "user";
    const embed = message[0] === "embed";
    if (embed) return `<div class="chat-message bot-message"><span class="chat-avatar bot-avatar"><img data-bot-avatar alt="" hidden><span>d</span></span><div><div class="chat-name">dea <span class="app-badge">APP</span><time>now</time></div><div class="chat-embed"><b>${esc(message[1])}</b>${esc(message[2])}</div></div></div>`;
    return `<div class="chat-message ${user ? "" : "bot-message"}"><span class="chat-avatar ${user ? "" : "bot-avatar"}">${user ? "" : '<img data-bot-avatar alt="" hidden><span>d</span>'}</span><div><div class="chat-name">${user ? "Arian" : 'dea <span class="app-badge">APP</span>'}<time>now</time></div><div class="chat-text">${esc(message[1])}</div></div></div>`;
  };
  const play = (kind) => {
    clearTimeout(timer);
    const run = ++sequence;
    messagesRoot.innerHTML = "";
    const messages = demos[kind];
    let index = 0;
    const next = () => {
      if (run !== sequence || document.hidden) return;
      if (index >= messages.length) {
        timer = setTimeout(() => play(kind), 6500);
        return;
      }
      const typing = document.createElement("div");
      typing.className = "typing";
      typing.innerHTML = '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span> dea is typing';
      messagesRoot.append(typing);
      timer = setTimeout(() => {
        typing.remove();
        messagesRoot.insertAdjacentHTML("beforeend", makeMessage(messages[index++]));
        const imgs = messagesRoot.querySelectorAll("img[data-bot-avatar]");
        const avatar = window.deaAvatarUrl;
        if (avatar) imgs.forEach((img) => { if (!img.src) { img.src = avatar; img.hidden = false; img.addEventListener("error", () => { img.hidden = true; img.nextElementSibling.hidden = false; }, { once: true }); img.nextElementSibling.hidden = true; } });
        messagesRoot.scrollTop = messagesRoot.scrollHeight;
        timer = setTimeout(next, 470);
      }, 650);
    };
    next();
  };
  const demoTabs = [...document.querySelectorAll("[data-demo]")];
  demoTabs.forEach((button) => button.addEventListener("click", () => {
    demoTabs.forEach((item) => { const selected = item === button; item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1; });
    play(button.dataset.demo);
  }));
  demoTabs.forEach((button, index) => button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = demoTabs[(index + offset + demoTabs.length) % demoTabs.length];
    next.focus(); next.click();
  }));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { sequence++; clearTimeout(timer); } else play(document.querySelector('[data-demo][aria-selected="true"]')?.dataset.demo || "round"); });
  play("round");

  const refreshStatus = () => fetch("/api/status", { cache: "no-store" }).then((response) => response.json()).then((data) => {
    window.deaAvatarUrl = data.avatarUrl || null;
    $("home-status-title").textContent = data.botOnline ? "All systems operational" : "Bot is offline";
    $("home-status-detail").textContent = `Live status · updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(data.currentTime))}`;
    $("home-server-count").textContent = Number(data.serverCount || 0).toLocaleString();
    $("home-ping").textContent = Number.isFinite(data.discordPingMs) && data.discordPingMs > 0 ? `${data.discordPingMs} ms` : "Measuring…";
    if (window.deaAvatarUrl) document.querySelectorAll(".chat-avatar img[data-bot-avatar]").forEach((img) => { img.src = window.deaAvatarUrl; img.hidden = false; img.addEventListener("error", () => { img.hidden = true; img.nextElementSibling.hidden = false; }, { once: true }); img.nextElementSibling.hidden = true; });
  }).catch(() => { $("home-status-title").textContent = "Status is taking a moment"; $("home-status-detail").textContent = "Check the live status page for updates."; $("home-ping").textContent = "Measuring…"; });
  refreshStatus();
  let statusTimer = setInterval(() => { if (!document.hidden) refreshStatus(); }, 15000);
  document.addEventListener("visibilitychange", () => { clearInterval(statusTimer); if (!document.hidden) { refreshStatus(); statusTimer = setInterval(refreshStatus, 15000); } });
})();
