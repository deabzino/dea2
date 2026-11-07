(() => {
  const search = document.getElementById("command-search");
  if (!search) return;
  const grid = document.getElementById("command-grid");
  const pills = document.getElementById("category-pills");
  const error = document.getElementById("command-error");
  const empty = document.getElementById("command-empty");
  let commands = [];
  let category = new URLSearchParams(location.search).get("category") || "all";
  let mode = "all";
  let query = "";
  const categories = ["All", "Among Us & voice", "Utility", "Server logging"];
  const slug = (value) => value.toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const highlighted = (value) => {
    const text = esc(value);
    if (!query) return text;
    const matcher = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    return text.replace(matcher, "<mark>$1</mark>");
  };
  const countUp = (target) => {
    const node = document.querySelector("[data-total-count]");
    const start = performance.now();
    const tick = (now) => { const progress = Math.min(1, (now - start) / 650); node.textContent = String(Math.round(target * (1 - (1 - progress) ** 3))); if (progress < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  const updateUrl = () => {
    const params = new URLSearchParams(location.search);
    if (category === "all") params.delete("category"); else params.set("category", category);
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
  };
  const renderPills = () => {
    const counts = new Map(categories.map((item) => [item, item === "All" ? commands.length : commands.filter((command) => command.category === item).length]));
    pills.innerHTML = categories.map((name) => {
      const key = name === "All" ? "all" : slug(name);
      return `<button type="button" data-category="${key}" class="${category === key ? "active" : ""}" aria-pressed="${category === key}">${esc(name)}<span class="pill-count">${counts.get(name)}</span></button>`;
    }).join("");
  };
  const filtered = () => commands.filter((command) => {
    if (category !== "all" && slug(command.category) !== category) return false;
    if (mode === "prefix" && !["prefix", "both"].includes(command.type)) return false;
    if (mode === "slash" && !["slash", "both"].includes(command.type)) return false;
    const haystack = [command.name, command.category, command.description, command.usage, command.example, ...(command.aliases || [])].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const detailLine = (label, value) => value ? `<div class="detail-line"><b>${label}</b><span>${esc(value)}</span></div>` : "";
  const render = () => {
    const items = filtered();
    grid.innerHTML = items.map((command, index) => {
      const aliases = (command.aliases || []).map((alias) => `.${alias}`).join(", ");
      const permissions = (command.requiredPermissions || []).join(", ");
      const prefix = command.type !== "slash";
      const slash = command.type !== "prefix";
      const typeNames = [slash ? "Slash" : "", prefix ? "Prefix" : ""].filter(Boolean).join(" + ");
      const content = [command.name, command.category, command.description, command.usage, command.example, aliases, permissions].join(" ");
      const copy = esc(command.example || command.usage);
      return `<article class="command-card" aria-expanded="false" style="animation:chat-in .32s ${Math.min(index * 25, 180)}ms both"><button class="command-summary" type="button" aria-expanded="false"><span class="command-symbol">/</span><span class="command-summary-copy"><span class="command-name">${highlighted(`/${command.name}`)}</span><span class="command-desc">${highlighted(command.description)}</span><span class="command-cat">${esc(command.category)} · ${typeNames}</span></span><span class="expand-arrow" aria-hidden="true">⌄</span></button><div class="command-details"><div class="command-details-inner"><div class="command-extra">${detailLine("Usage", command.usage)}<div class="detail-line"><b>Example</b><div class="code-row"><code>${highlighted(command.example)}</code><button class="copy-button" type="button" data-copy="${copy}" aria-label="Copy example for ${esc(command.name)}">Copy</button></div></div>${detailLine("Aliases", aliases)}${detailLine("Required permissions", permissions)}${detailLine("Cooldown", command.cooldown)}</div></div></div></article>`;
    }).join("");
    empty.hidden = items.length > 0;
  };
  pills.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    category = button.dataset.category;
    updateUrl(); renderPills(); render();
  });
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    mode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
    render();
  }));
  search.addEventListener("input", () => { query = search.value.trim(); render(); });
  document.addEventListener("keydown", (event) => { if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) && !event.ctrlKey && !event.metaKey) { event.preventDefault(); search.focus(); } });
  grid.addEventListener("click", async (event) => {
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = "Copied!"; copy.classList.add("copied"); setTimeout(() => { copy.textContent = "Copy"; copy.classList.remove("copied"); }, 1200); } catch { copy.textContent = "Select example"; }
      return;
    }
    const summary = event.target.closest(".command-summary");
    if (!summary) return;
    const card = summary.closest(".command-card");
    const open = summary.getAttribute("aria-expanded") !== "true";
    summary.setAttribute("aria-expanded", String(open)); card.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("clear-filters").addEventListener("click", () => { query = ""; search.value = ""; category = "all"; mode = "all"; document.querySelectorAll("[data-mode]").forEach((item, i) => { item.classList.toggle("active", i === 0); item.setAttribute("aria-pressed", String(i === 0)); }); updateUrl(); renderPills(); render(); });
  const scroller = document.querySelector(".category-pills");
  document.querySelector(".pill-left").addEventListener("click", () => scroller.scrollBy({ left: -180, behavior: "smooth" }));
  document.querySelector(".pill-right").addEventListener("click", () => scroller.scrollBy({ left: 180, behavior: "smooth" }));
  fetch("/api/commands", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((data) => {
    commands = Array.isArray(data) ? data.filter((command) => command.hiddenFromWebsite !== true) : [];
    if (!categories.some((name) => name !== "All" && slug(name) === category)) category = "all";
    countUp(commands.length); renderPills(); render(); updateUrl();
  }).catch(() => { error.hidden = false; empty.hidden = true; });
})();
