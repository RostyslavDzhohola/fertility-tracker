// Ranking listbox (desktop column and the All countries dialog), chips, and the dialog (DESIGN §3.7, §4.3).

import { h, setText, focusNoScroll, keepInView, media } from "./dom.js";
import { orderPlaces, colorFor, fmtTfr, fmtPct, tfrValue, normalizeText } from "./logic.js";

function swatch(rec, mode) {
  const sw = h("span", { class: "swatch", "aria-hidden": "true" });
  const c = colorFor(rec, mode);
  if (c) sw.style.setProperty("--sw", c);
  else sw.setAttribute("data-nodata", "");
  return sw;
}

// A single-select listbox with a roving tabindex. Selection does not follow focus.
export function createListbox(container, { prefix, onSelect, label }) {
  let rows = new Map(); // iso3 -> row element
  let order = [];
  let selected = null;
  let mode = "risk";
  let typed = "";
  let typedTimer = 0;

  function build(records, m) {
    mode = m;
    const { ranked, unranked } = orderPlaces(records, mode);
    container.setAttribute("aria-label", label(mode));
    rows = new Map();
    order = [];
    const make = (rec, num) => {
      const tfr = tfrValue(rec);
      const pct = rec.projection?.change2100Pct;
      const row = h(
        "div",
        {
          role: "option",
          id: `${prefix}-${rec.iso3.toLowerCase()}`,
          class: "row",
          tabindex: "-1",
          "aria-selected": "false",
          "data-iso3": rec.iso3,
          title: rec.name,
          "aria-label": `${num != null ? `${num}. ` : ""}${rec.name}, ${fmtTfr(tfr)} births per woman${mode === "risk" && pct != null ? `, ${fmtPct(pct)} by 2100` : ""}`,
        },
        h("span", { class: "rank-num", "aria-hidden": "true" }, num != null ? String(num) : ""),
        swatch(rec, mode),
        h("span", { class: "row-name", "aria-hidden": "true" }, rec.name),
        h("span", { class: "row-tfr", "aria-hidden": "true" }, fmtTfr(tfr)),
        h("span", { class: "row-2100", "aria-hidden": "true" }, pct != null ? fmtPct(pct) : "–"),
      );
      const c = colorFor(rec, mode);
      if (c) row.style.setProperty("--sw", c);
      rows.set(rec.iso3, row);
      order.push(rec.iso3);
      return row;
    };
    const gRankedLabel = h("div", { class: "visually-hidden", id: `${prefix}-grp-ranked` }, mode === "risk" ? "Ranked by decline-risk score" : "Places with 100,000+ people");
    const gRanked = h(
      "div",
      { role: "group", "aria-labelledby": `${prefix}-grp-ranked` },
      gRankedLabel,
      ranked.map((r, i) => make(r, mode === "risk" ? r.risk.rank : i + 1)),
    );
    const parts = [gRanked];
    if (unranked.length) {
      parts.push(
        h(
          "div",
          { role: "group", "aria-labelledby": `${prefix}-grp-unranked` },
          h("div", { class: "group-label", id: `${prefix}-grp-unranked` }, "Not ranked: under 100,000 people or incomplete data"),
          unranked.map((r) => make(r, null)),
        ),
      );
    }
    container.replaceChildren(...parts);
    setSelected(selected, { keep: true });
  }

  function setSelected(iso3, { keep = true } = {}) {
    const prev = rows.get(selected);
    if (prev) {
      prev.setAttribute("aria-selected", "false");
    }
    selected = iso3;
    const row = rows.get(iso3);
    if (row) row.setAttribute("aria-selected", "true");
    // Roving tabindex: the selected row (or the first) is the tab stop, unless focus is already inside.
    if (!container.contains(document.activeElement)) {
      for (const r of rows.values()) r.tabIndex = -1;
      const stop = row ?? rows.get(order[0]);
      if (stop) stop.tabIndex = 0;
    }
    if (keep && row) keepInView(container, row, 8);
  }

  function visibleOrder() {
    return order.filter((iso3) => rows.get(iso3)?.style.display !== "none");
  }

  function focusRow(iso3) {
    const row = rows.get(iso3);
    if (!row) return;
    for (const r of rows.values()) r.tabIndex = -1;
    row.tabIndex = 0;
    focusNoScroll(row);
    keepInView(container, row, 8);
  }

  container.addEventListener("click", (e) => {
    const row = e.target.closest('[role="option"]');
    if (!row) return;
    focusRow(row.dataset.iso3);
    onSelect(row.dataset.iso3);
  });

  container.addEventListener("keydown", (e) => {
    const row = e.target.closest('[role="option"]');
    const vis = visibleOrder();
    if (!vis.length) return;
    const i = row ? vis.indexOf(row.dataset.iso3) : -1;
    const page = Math.max(1, Math.floor(container.clientHeight / 36) - 1);
    let next = null;
    switch (e.key) {
      case "ArrowDown":
        next = vis[Math.min(vis.length - 1, i + 1)];
        break;
      case "ArrowUp":
        next = vis[Math.max(0, i - 1)];
        break;
      case "Home":
        next = vis[0];
        break;
      case "End":
        next = vis[vis.length - 1];
        break;
      case "PageDown":
        next = vis[Math.min(vis.length - 1, i + page)];
        break;
      case "PageUp":
        next = vis[Math.max(0, i - page)];
        break;
      case "Enter":
      case " ":
        if (row) {
          e.preventDefault();
          onSelect(row.dataset.iso3);
        }
        return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          clearTimeout(typedTimer);
          typed += e.key.toLowerCase();
          typedTimer = setTimeout(() => (typed = ""), 700);
          const q = normalizeText(typed);
          const start = typed.length === 1 ? i + 1 : Math.max(0, i);
          const n = vis.length;
          for (let k = 0; k < n; k++) {
            const iso3 = vis[(start + k) % n];
            const name = normalizeText(rows.get(iso3).title);
            if (name.startsWith(q)) {
              next = iso3;
              break;
            }
          }
          if (!next) return;
        } else return;
    }
    e.preventDefault();
    if (next) focusRow(next);
  });

  function filter(text) {
    const q = normalizeText(text);
    for (const [iso3, row] of rows) {
      const show = !q || normalizeText(row.title).includes(q) || iso3.toLowerCase() === q;
      row.style.display = show ? "" : "none";
    }
    for (const g of container.querySelectorAll('[role="group"]')) {
      const any = [...g.querySelectorAll('[role="option"]')].some((r) => r.style.display !== "none");
      g.style.display = any ? "" : "none";
    }
    // Keep the tab stop on a visible row.
    const vis = visibleOrder();
    if (vis.length && !container.contains(document.activeElement)) {
      for (const r of rows.values()) r.tabIndex = -1;
      const stop = rows.get(vis.includes(selected) ? selected : vis[0]);
      if (stop) stop.tabIndex = 0;
    }
    container.scrollTop = 0;
  }

  return {
    build,
    setSelected,
    filter,
    revealSelected: () => {
      const row = rows.get(selected);
      if (row) keepInView(container, row, 8);
    },
    focusSelected: () => {
      const vis = visibleOrder();
      focusRow(vis.includes(selected) ? selected : vis[0]);
    },
  };
}

export function createChips(list, label, { onSelect, onOpenAll }) {
  let selected = null;
  let buttons = new Map();
  let allBtn = null;

  function build(records, mode, total) {
    const { ranked } = orderPlaces(records, mode);
    const top = ranked.slice(0, 10);
    buttons = new Map();
    const items = top.map((rec, i) => {
      const num = mode === "risk" ? rec.risk.rank : i + 1;
      const b = h(
        "button",
        { type: "button", class: "chip", id: `chip-${rec.iso3.toLowerCase()}`, "aria-pressed": "false", "data-iso3": rec.iso3, "aria-label": `${num}. ${rec.name}, ${fmtTfr(tfrValue(rec))} births per woman` },
        h("span", { class: "chip-rank", "aria-hidden": "true" }, String(num)),
        swatch(rec, mode),
        h("span", { "aria-hidden": "true" }, rec.name),
        h("span", { class: "chip-tfr", "aria-hidden": "true" }, fmtTfr(tfrValue(rec))),
      );
      buttons.set(rec.iso3, b);
      return h("li", null, b);
    });
    allBtn = h("button", { type: "button", class: "chip chip-all", "aria-haspopup": "dialog" }, `All ${total} →`);
    items.push(h("li", null, allBtn));
    list.replaceChildren(...items);
    setText(label, mode === "risk" ? "Highest risk:" : "Lowest births per woman:");
    list.setAttribute("aria-label", mode === "risk" ? "Highest risk" : "Lowest births per woman");
    setSelected(selected);
  }

  function setSelected(iso3) {
    buttons.get(selected)?.setAttribute("aria-pressed", "false");
    selected = iso3;
    const b = buttons.get(iso3);
    if (b) {
      b.setAttribute("aria-pressed", "true");
      // Keep it visible by scrolling the strip itself, never the window.
      const li = b.parentElement;
      const left = li.offsetLeft - list.offsetLeft;
      if (left < list.scrollLeft) list.scrollLeft = left - 8;
      else if (left + li.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + li.offsetWidth - list.clientWidth + 16;
    }
  }

  list.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b === allBtn) onOpenAll(b);
    else onSelect(b.dataset.iso3);
  });

  return { build, setSelected };
}

export function createDialog(dialog, { listbox, filterInput, closeBtn }) {
  let opener = null;

  function open(from) {
    opener = from ?? document.activeElement;
    filterInput.value = "";
    listbox.filter("");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    listbox.revealSelected();
    // Fine pointers land in the filter box; touch lands on the selected row (no on-screen keyboard).
    if (media.coarse()) listbox.focusSelected();
    else focusNoScroll(filterInput);
  }

  function close() {
    if (!dialog.open) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  dialog.addEventListener("close", () => {
    // Return focus to the opener without scrolling (DESIGN §3.3).
    const o = opener;
    opener = null;
    if (o && document.contains(o)) requestAnimationFrame(() => focusNoScroll(o));
  });
  closeBtn.addEventListener("click", close);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close(); // backdrop click
  });
  filterInput.addEventListener("input", () => listbox.filter(filterInput.value));
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      listbox.focusSelected();
    }
  });

  return { open, close, get isOpen() { return dialog.open; } };
}
