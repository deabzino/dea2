(() => {
  const $ = (id) => document.getElementById(id);
  const voiceCard = document.querySelector(".voice-card");
  const voicePlayers = document.querySelector(".voice-players");
  const voiceStatus = document.querySelector("[data-voice-status]");
  let voiceTimer = null;
  let resumeTimer = null;
  let meeting = false;
  let cardVisible = false;
  let pausedUntil = 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const setMic = (row) => {
    const dead = row.dataset.dead === "true";
    const muted = !meeting || dead;
    const icon = row.querySelector(".mic-icon");
    icon.setAttribute("aria-label", muted ? "Microphone muted" : "Microphone on");
    icon.innerHTML = muted
      ? '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-4 0h8m-1-14 7 7m0-7-7 7"/>'
      : '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-4 0h8"/>';
  };
  const renderPlayers = () => voicePlayers.querySelectorAll(".voice-player").forEach((row) => {
    const dead = row.dataset.dead === "true";
    row.classList.toggle("dead-player", dead);
    row.setAttribute("aria-label", `Mark ${row.dataset.playerName} as ${dead ? "alive" : "dead"}`);
    row.querySelector(".dead-label").hidden = !dead;
    setMic(row);
  });
  const updateState = (nextMeeting, announce = true) => {
    meeting = nextMeeting;
    voiceCard.dataset.voiceState = meeting ? "meeting" : "playing";
    voicePlayers.dataset.voiceMode = meeting ? "meeting" : "playing";
    voiceCard.querySelectorAll("[data-game-state]").forEach((button) => {
      const selected = button.dataset.gameState === (meeting ? "meeting" : "playing");
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
    });
    renderPlayers();
    if (announce) voiceStatus.textContent = meeting ? "Server unmuted everyone" : "Server muted everyone";
  };
  const stopLoop = () => { clearInterval(voiceTimer); voiceTimer = null; };
  const startLoop = () => {
    stopLoop();
    if (!reducedMotion.matches && !document.hidden && cardVisible && Date.now() >= pausedUntil) {
      voiceTimer = setInterval(() => updateState(!meeting), 4800);
    }
  };
  const pauseForInteraction = () => {
    pausedUntil = Date.now() + 15000;
    stopLoop();
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(startLoop, 15000);
  };
  if (voiceCard) {
    voiceCard.dataset.voiceState = "playing";
    renderPlayers();
    voiceCard.addEventListener("pointerdown", pauseForInteraction);
    voiceCard.addEventListener("keydown", pauseForInteraction);
    voiceCard.addEventListener("click", (event) => {
      const stateButton = event.target.closest("[data-game-state]");
      if (stateButton) {
        updateState(stateButton.dataset.gameState === "meeting");
        return;
      }
      const row = event.target.closest(".voice-player");
      if (row) {
        const dead = row.dataset.dead !== "true";
        row.dataset.dead = String(dead);
        renderPlayers();
        voiceStatus.textContent = dead
          ? `Marked ${row.dataset.playerName} as dead and server-muted them.`
          : `Cleared ${row.dataset.playerName} from the dead list.`;
        return;
      }
      if (event.target.closest("[data-new-round]")) {
        voicePlayers.querySelectorAll(".voice-player").forEach((player) => { player.dataset.dead = "false"; });
        renderPlayers();
        voiceStatus.textContent = "Started a new round.";
      }
    });
    document.addEventListener("visibilitychange", startLoop);
    reducedMotion.addEventListener("change", startLoop);
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(([entry]) => { cardVisible = entry.isIntersecting; startLoop(); }, { threshold: 0.15 });
      observer.observe(voiceCard);
    } else { cardVisible = true; startLoop(); }
  }
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
      ["user", ".dead @Turhan"],
      ["bot", "Marked @Turhan as dead and server-muted them."],
      ["user", ".mute"],
      ["bot", "Server muted everyone in Voice 1 (2 members changed)."],
      ["user", ".list"],
      ["embed", "Dead Players", "Players currently marked dead are shown below. · Turhan · Voice channel: Voice 1 · Mute state: Server muted"],
      ["user", ".unmute"],
      ["bot", "Server unmuted everyone in Voice 1 (1 member changed)."],
    ],
    lobby: [
      ["user", ".code ABCDEF"],
      ["bot", "The code is ABCDEF. I’ll remember it for this server."],
      ["user", ".code"],
      ["bot", "The code is ABCDEF."],
      ["user", ".mute"],
      ["bot", "Server muted everyone in Voice 1 (3 members changed)."],
      ["user", ".unmute"],
      ["bot", "Server unmuted everyone in Voice 1 (3 members changed)."],
    ],
  };
  let timer = null;
  let kind = "round";
  let turn = 0;
  let charIndex = 0;
  let active = false;
  let demoVisible = false;
  let typingRow = null;
  const demoWindow = document.querySelector(".discord-window");
  const inputText = document.querySelector(".chat-typed");
  const inputPlaceholder = document.querySelector(".chat-placeholder");
  const sendButton = document.querySelector(".chat-send");
  const canPlay = () => active && !document.hidden && demoVisible && !reducedMotion.matches;
  const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const makeMessage = (message) => {
    const user = message[0] === "user";
    const embed = message[0] === "embed";
    if (embed) return `<div class="chat-message bot-message"><span class="chat-avatar bot-avatar"><img data-bot-avatar alt="" hidden><span>d</span></span><div><div class="chat-name">dea <span class="app-badge">APP</span><time>now</time></div><div class="chat-embed"><b>${esc(message[1])}</b>${esc(message[2])}</div></div></div>`;
    return `<div class="chat-message ${user ? "" : "bot-message"}"><span class="chat-avatar ${user ? "" : "bot-avatar"}">${user ? "" : '<img data-bot-avatar alt="" hidden><span>d</span>'}</span><div><div class="chat-name">${user ? "Arian" : 'dea <span class="app-badge">APP</span>'}<time>now</time></div><div class="chat-text">${esc(message[1])}</div></div></div>`;
  };
  const clearTimer = () => { clearTimeout(timer); timer = null; };
  const setCompose = (value) => {
    inputText.textContent = value;
    const hasText = value.length > 0;
    inputPlaceholder.hidden = hasText;
    demoWindow.classList.toggle("has-draft", hasText);
  };
  const clearTyping = () => { if (typingRow) typingRow.remove(); typingRow = null; };
  const scrollNewest = () => { messagesRoot.scrollTop = messagesRoot.scrollHeight; };
  const appendMessage = (message) => {
    messagesRoot.insertAdjacentHTML("beforeend", makeMessage(message));
    const avatar = window.deaAvatarUrl;
    if (avatar) messagesRoot.querySelectorAll("img[data-bot-avatar]").forEach((img) => {
      if (img.src) return;
      img.src = avatar; img.hidden = false;
      img.addEventListener("error", () => { img.hidden = true; img.nextElementSibling.hidden = false; }, { once: true });
      img.nextElementSibling.hidden = true;
    });
    scrollNewest();
  };
  const finishedTranscript = (which) => demos[which].map((message) => message[0] === "user" ? `Arian: ${message[1]}` : message[0] === "embed" ? `dea: ${message[1]}. ${message[2]}` : `dea: ${message[1]}`).join(" ");
  const setTab = (which) => {
    kind = which;
    if (!document.hidden) { demoVisible = true; active = true; }
    turn = 0; charIndex = 0;
    clearTimer(); clearTyping();
    setCompose("");
    messagesRoot.replaceChildren();
    $("chat-transcript").textContent = finishedTranscript(kind);
    if (reducedMotion.matches) {
      demos[kind].forEach(appendMessage);
      return;
    }
    if (!document.hidden && !reducedMotion.matches) {
      clearTimer();
      timer = setTimeout(() => { timer = null; if (!document.hidden && !reducedMotion.matches) beginTurn(); }, 180);
    }
  };
  const schedule = (delay, callback) => {
    clearTimer();
    if (!canPlay()) return;
    timer = setTimeout(() => { timer = null; if (canPlay()) callback(); }, delay);
  };
  const beginTurn = () => {
    const messages = demos[kind];
    if (turn >= messages.length) {
      schedule(1800, () => {
        messagesRoot.classList.add("is-fading");
        schedule(500, () => { messagesRoot.replaceChildren(); messagesRoot.classList.remove("is-fading"); turn = 0; beginTurn(); });
      });
      return;
    }
    const message = messages[turn];
    if (message[0] !== "user") {
      typingRow = document.createElement("div");
      typingRow.className = "typing";
      typingRow.innerHTML = '<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span> dea is typing…';
      messagesRoot.append(typingRow); scrollNewest();
      schedule(700 + Math.random() * 400, () => {
        clearTyping(); appendMessage(message); turn++;
        schedule(800, beginTurn);
      });
      return;
    }
    charIndex = 0;
    const typeNext = () => {
      const command = message[1];
      charIndex++;
      setCompose(command.slice(0, charIndex));
      if (charIndex < command.length) { schedule(45 + Math.random() * 30, typeNext); return; }
      schedule(360, () => {
        sendButton.classList.add("is-pressed");
        schedule(120, () => {
          sendButton.classList.remove("is-pressed"); setCompose(""); appendMessage(message); turn++;
          schedule(320, beginTurn);
        });
      });
    };
    typeNext();
  };
  const resetForPause = () => {
    clearTimer(); clearTyping(); setCompose(""); turn = 0;
    messagesRoot.replaceChildren();
  };
  const updateActivity = () => {
    if (reducedMotion.matches) return;
    const shouldRun = !document.hidden && demoVisible;
    if (!shouldRun) { active = false; resetForPause(); return; }
    if (active) return;
    active = true;
    if (!reducedMotion.matches && messagesRoot.childElementCount === 0) schedule(180, beginTurn);
  };
  const demoTabs = [...document.querySelectorAll("[data-demo]")];
  demoTabs.forEach((button) => button.addEventListener("click", () => {
    demoTabs.forEach((item) => { const selected = item === button; item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1; });
    setTab(button.dataset.demo);
  }));
  demoTabs.forEach((button, index) => button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = demoTabs[(index + offset + demoTabs.length) % demoTabs.length];
    next.focus(); next.click();
  }));
  document.addEventListener("visibilitychange", updateActivity);
  reducedMotion.addEventListener("change", () => {
    clearTimer(); clearTyping(); setCompose(""); messagesRoot.replaceChildren();
    if (reducedMotion.matches) demos[kind].forEach(appendMessage);
    else { active = false; updateActivity(); }
  });
  if ("IntersectionObserver" in window) {
    const demoObserver = new IntersectionObserver(([entry]) => { demoVisible = entry.isIntersecting; updateActivity(); }, { threshold: 0.15 });
    demoObserver.observe(demoWindow);
  } else demoVisible = true;
  active = false;
  $("chat-transcript").textContent = finishedTranscript(kind);
  if (reducedMotion.matches) demos[kind].forEach(appendMessage);
  else updateActivity();

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
