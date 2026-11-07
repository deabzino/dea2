(() => {
  const svg = (name) => name === "sun"
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.7 8.7 0 1 0 20.5 15.2Z"/><path d="m17.5 3 .6 1.5 1.4.5-1.4.6-.6 1.4-.5-1.4-1.5-.6 1.5-.5.5-1.5Z"/></svg>';
  const path = location.pathname.replace(/\/$/, "") || "/";
  const links = [
    ["Features", "/#features", path === "/"],
    ["Commands", "/commands", path === "/commands"],
    ["Changelog", "/changelog", path === "/changelog"],
    ["Status", "/status", path === "/status"],
  ];
  const navTarget = document.querySelector("[data-shared-nav]");
  if (navTarget) {
    navTarget.innerHTML = `<header class="site-nav"><div class="nav-inner shell"><a class="brand" href="/" aria-label="dea home"><span class="brand-logo"><img data-bot-avatar alt="" hidden><span data-logo-fallback>d</span></span><span>dea</span></a><nav class="desktop-links" aria-label="Main navigation">${links.map(([label, href, current]) => `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav><div class="nav-actions"><button class="theme-toggle" type="button" aria-label="Switch to light theme" title="Switch theme">${svg("sun")}</button><button class="menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu"><span></span><span></span></button></div><nav class="mobile-menu" id="mobile-menu" aria-label="Mobile navigation" inert>${links.map(([label, href, current]) => `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}<span aria-hidden="true">↗</span></a>`).join("")}<div class="mobile-menu-note">Your next round starts here.</div></nav></div></header>`;
  }
  const footerTarget = document.querySelector("[data-shared-footer]");
  if (footerTarget) footerTarget.innerHTML = `<footer class="site-footer"><div class="shell footer-main"><a class="brand footer-brand" href="/" aria-label="dea home"><span class="brand-logo"><img data-bot-avatar alt="" hidden><span data-logo-fallback>d</span></span><span>dea</span></a><p>For the moments between rounds.</p><nav aria-label="Footer navigation">${links.map(([label, href, current]) => `<a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav></div><div class="shell footer-bottom"><span>Made for your crew.</span><span>© <span id="year"></span> dea</span></div></footer>`;

  const root = document.documentElement;
  const color = () => {
    const light = root.dataset.theme === "light";
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.content = light ? "#f4f5f1" : "#090d13";
      meta.removeAttribute("media");
    });
    root.style.colorScheme = light ? "light" : "dark";
    const button = document.querySelector(".theme-toggle");
    if (button) {
      button.innerHTML = svg(light ? "moon" : "sun");
      button.setAttribute("aria-label", `Switch to ${light ? "dark" : "light"} theme`);
      button.title = `Switch to ${light ? "dark" : "light"} theme`;
    }
  };
  color();
  document.querySelector(".theme-toggle")?.addEventListener("click", (event) => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.style.setProperty("--theme-x", `${event.clientX}px`);
    root.style.setProperty("--theme-y", `${event.clientY}px`);
    const change = () => { root.dataset.theme = next; localStorage.setItem("dea-theme", next); color(); };
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(change);
    else change();
  });

  const menuButton = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".mobile-menu");
  const setMenu = (open) => {
    if (!menuButton || !menu) return;
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.inert = !open;
    document.body.classList.toggle("menu-open", open);
    if (open) menu.querySelector("a")?.focus({ preventScroll: true });
  };
  menuButton?.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  menu?.addEventListener("click", (event) => { if (event.target.closest("a")) setMenu(false); });
  document.addEventListener("click", (event) => { if (menuButton?.getAttribute("aria-expanded") === "true" && !event.target.closest(".nav-inner")) setMenu(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && menuButton?.getAttribute("aria-expanded") === "true") { setMenu(false); menuButton.focus(); } });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || menuButton?.getAttribute("aria-expanded") !== "true") return;
    const items = [...menu.querySelectorAll("a")];
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener("visibilitychange", () => document.body.classList.toggle("tab-hidden", document.hidden));
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }), { threshold: .12 });
    reveals.forEach((item) => observer.observe(item));
  } else reveals.forEach((item) => item.classList.add("is-visible"));

  fetch("/api/status", { cache: "no-store" }).then((response) => response.json()).then((data) => {
    if (!data.avatarUrl) return;
    window.deaAvatarUrl = data.avatarUrl;
    document.querySelectorAll("[data-bot-avatar]").forEach((img) => {
      img.src = data.avatarUrl;
      img.hidden = false;
      img.addEventListener("error", () => { img.hidden = true; img.nextElementSibling.hidden = false; }, { once: true });
      img.nextElementSibling.hidden = true;
    });
  }).catch(() => {});
})();
