(() => {
  const timeline = document.getElementById("timeline");
  if (!timeline) return;
  const search = document.getElementById("change-search");
  const empty = document.getElementById("changelog-empty");
  const error = document.getElementById("changelog-error");
  let entries = [];
  let filter = "all";
  let query = "";
  const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const dateText = (date) => {
    const stamp = new Date(date);
    const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(stamp);
    const delta = Date.now() - stamp.getTime();
    if (delta >= 0 && delta < 7 * 86400000) {
      const unit = delta < 3600000 ? "minute" : delta < 86400000 ? "hour" : "day";
      const size = unit === "minute" ? 60000 : unit === "hour" ? 3600000 : 86400000;
      const amount = Math.max(1, Math.floor(delta / size));
      return `${absolute} · ${new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-amount, unit)}`;
    }
    return absolute;
  };
  const render = () => {
    const shown = entries.filter((entry) => {
      if (filter !== "all" && !entry.changes.some((change) => change.type.toLowerCase() === filter)) return false;
      return `${entry.title} ${entry.changes.map((change) => `${change.type} ${change.text}`).join(" ")}`.toLowerCase().includes(query.toLowerCase());
    });
    timeline.innerHTML = shown.map((entry, index) => {
      const changes = entry.changes || [];
      const types = [...new Set(changes.map((change) => change.type))];
      const expanded = index === 0 || changes.length <= 5;
      return `<article class="timeline-entry" data-entry aria-expanded="${expanded}"><div class="entry-head"><div class="entry-title-wrap"><time class="entry-date" datetime="${esc(entry.date)}">${esc(dateText(entry.date))}</time><h2 class="entry-title">${esc(entry.title)}${index === 0 && !query && filter === "all" ? '<span class="latest-badge">Latest</span>' : ""}</h2><div class="entry-tags">${types.map((type) => `<span class="change-tag ${type.toLowerCase()}">${esc(type)}</span>`).join("")}</div></div><button class="entry-arrow" type="button" aria-label="${expanded ? "Collapse" : "Expand"} ${esc(entry.title)}" aria-expanded="${expanded}">⌄</button></div><div class="entry-changes"><div class="entry-changes-inner"><ul>${changes.map((change) => `<li><span class="change-tag ${change.type.toLowerCase()}">${esc(change.type)}</span> ${esc(change.text)}</li>`).join("")}</ul></div></div></article>`;
    }).join("");
    empty.hidden = shown.length > 0;
  };
  document.querySelectorAll("[data-change-filter]").forEach((button) => button.addEventListener("click", () => {
    filter = button.dataset.changeFilter.toLowerCase();
    document.querySelectorAll("[data-change-filter]").forEach((item) => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active)); });
    render();
  }));
  search.addEventListener("input", () => { query = search.value.trim(); render(); });
  timeline.addEventListener("click", (event) => {
    const button = event.target.closest(".entry-arrow");
    if (!button) return;
    const entry = button.closest("[data-entry]");
    const expanded = entry.getAttribute("aria-expanded") !== "true";
    entry.setAttribute("aria-expanded", String(expanded)); button.setAttribute("aria-expanded", String(expanded)); button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${entry.querySelector(".entry-title").textContent}`);
  });
  const setAll = (expanded) => timeline.querySelectorAll("[data-entry]").forEach((entry) => { entry.setAttribute("aria-expanded", String(expanded)); const button = entry.querySelector(".entry-arrow"); button.setAttribute("aria-expanded", String(expanded)); button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${entry.querySelector(".entry-title").textContent}`); });
  document.getElementById("expand-all").addEventListener("click", () => setAll(true));
  document.getElementById("collapse-all").addEventListener("click", () => setAll(false));
  fetch("/changelog.json", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((data) => { entries = Array.isArray(data) ? data.sort((a, b) => new Date(b.date) - new Date(a.date)) : []; render(); }).catch(() => { error.hidden = false; });
})();
