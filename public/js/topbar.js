// The top bar on every page: wordmark, the big search, nav, and a small Feedback popover (DESIGN-v3 §2, §5).

import { $, h, setAttr, focusNoScroll, announce, copyText } from "./dom.js";
import * as L from "./logic.js";
import { createSearch } from "./search.js";

// opts: getPlaces, getRecord, getPct(iso3), getYear(), topPlaces(n), onSelect(iso3), getFeedback(), siteUrl()
export function createTopbar(opts) {
  const search = createSearch({
    wrap: $("search-wrap"),
    input: $("search"),
    list: $("search-results"),
    clearBtn: $("search-clear"),
    status: $("search-status"),
    getPlaces: opts.getPlaces,
    getRecord: opts.getRecord,
    getPct: opts.getPct,
    topPlaces: opts.topPlaces,
    onSelect: opts.onSelect,
  });

  // A shorter placeholder on phones, so it isn't cut off.
  const input = $("search");
  const mq = matchMedia("(max-width: 699px)");
  const tiny = matchMedia("(max-width: 379px)");
  const syncPlaceholder = () => input && (input.placeholder = tiny.matches ? "Search" : mq.matches ? "Search a country" : "Search any country or territory");
  syncPlaceholder();
  mq.addEventListener?.("change", syncPlaceholder);
  tiny.addEventListener?.("change", syncPlaceholder);

  // Mobile menu (nav collapses under 700px).
  const menuBtn = $("menu-btn");
  const nav = $("topnav");
  if (menuBtn && nav) {
    const close = () => {
      nav.classList.remove("open");
      setAttr(menuBtn, "aria-expanded", "false");
    };
    menuBtn.addEventListener("click", () => {
      const open = !nav.classList.contains("open");
      nav.classList.toggle("open", open);
      setAttr(menuBtn, "aria-expanded", String(open));
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) close();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!nav.contains(e.target) && !menuBtn.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        close();
        focusNoScroll(menuBtn);
      }
    });
  }

  // Feedback popover.
  const fbBtn = $("fb-btn");
  const fbPanel = $("fb-panel");
  function fillFeedback() {
    const fb = opts.getFeedback?.() ?? null;
    const site = opts.siteUrl?.() ?? L.SITE_URL;
    const gh = fb ? L.buildChooserUrl(fb, { siteUrl: site }) : null;
    const address = fb?.email?.address || L.FALLBACK_EMAIL;
    const copyBtn = h("button", { type: "button", class: "btn btn-secondary btn-small" }, "Copy");
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(address);
      copyBtn.textContent = ok ? "Copied" : "Copy failed";
      announce(ok ? "Copied to clipboard" : "Couldn't copy");
      setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
    });
    const x = L.xProfileUrl(fb);
    const handle = L.xHandle(fb);
    fbPanel.replaceChildren(
      h("p", { class: "fb-title" }, "Spot something wrong? Want something added?"),
      h("p", { class: "fb-sub" }, "Every message is read."),
      h(
        "div",
        { class: "fb-actions" },
        gh ? h("a", { class: "btn btn-primary", href: gh, target: "_blank", rel: "noopener", id: "fb-github" }, "Give feedback on GitHub") : "",
        h("a", { class: "btn btn-secondary", href: L.buildMailto(fb, { siteUrl: site }), id: "fb-email" }, "Email us"),
      ),
      h("p", { class: "fb-note" }, "GitHub issues are public; email stays private."),
      h("p", { class: "fb-address" }, h("span", { class: "email-text" }, address), copyBtn),
      x && handle ? h("p", { class: "fb-note" }, "Follow updates on X: ", h("a", { href: x, rel: "noopener" }, `@${handle}`)) : "",
    );
  }
  function openFb() {
    fillFeedback();
    fbPanel.hidden = false;
    setAttr(fbBtn, "aria-expanded", "true");
    setTimeout(() => document.addEventListener("pointerdown", outsideFb, true), 0);
  }
  function closeFb(focus = false) {
    if (fbPanel.hidden) return;
    fbPanel.hidden = true;
    setAttr(fbBtn, "aria-expanded", "false");
    document.removeEventListener("pointerdown", outsideFb, true);
    if (focus) focusNoScroll(fbBtn);
  }
  function outsideFb(e) {
    if (!fbPanel.contains(e.target) && !fbBtn.contains(e.target)) closeFb();
  }
  fbBtn?.addEventListener("click", () => (fbPanel.hidden ? openFb() : closeFb()));
  fbPanel?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeFb(true);
    }
  });

  function setPage(page) {
    for (const a of document.querySelectorAll("#topnav a[data-page]")) {
      if (a.dataset.page === page) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }

  return {
    search,
    setPage,
    refreshFeedback() {
      if (fbPanel && !fbPanel.hidden) fillFeedback();
    },
  };
}
