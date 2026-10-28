// The globe page `/` (DESIGN-v3 §2): full-viewport globe, bottom dock (year slider, Play, scenario, world counter),
// legend, zoom controls, "Most at risk", hover tooltip and the country card.

import { $, h, setText, setAttr, media, focusNoScroll, announce, idle } from "./dom.js";
import * as L from "./logic.js";
import { data, state, subscribe, popNow, ratioNow, pctNow, fetchJson, setYear, play, yearInt } from "./store.js";
import { createGlobe } from "./globe.js";
import { createTimeControls } from "./controls.js";
import { peopleRow } from "./people.js";
import { riskChip } from "./ui.js";

const SEEN_KEY = "ft.seenIntro";

export function createHome({ navigate, onFocusChange }) {
  const el = {
    view: $("view-globe"),
    canvas: $("globe"),
    tip: $("globe-tip"),
    note: $("globe-note"),
    zoomIn: $("zoom-in"),
    zoomOut: $("zoom-out"),
    zoomReset: $("zoom-reset"),
    zoomCtrl: $("zoom-ctrl"),
    modeBtns: [...document.querySelectorAll("#view-mode button")],
    dockWrap: $("dock-wrap"),
    dockTime: $("dock-time"),
    counter: $("world-counter"),
    wcYear: $("wc-year"),
    wcNum: $("wc-num"),
    wcUnit: $("wc-unit"),
    wcPct: $("wc-pct"),
    wcSw: $("wc-swatch"),
    riskBtn: $("risk-btn"),
    riskPanel: $("risk-panel"),
    riskList: $("risk-list"),
    card: $("card"),
    cardClose: $("card-close"),
    cardRegion: $("card-region"),
    cardName: $("card-name"),
    cardRisk: $("card-risk"),
    cardNum: $("card-num"),
    cardUnit: $("card-unit"),
    cardYear: $("card-year"),
    cardPct: $("card-pct"),
    cardPeople: $("card-people"),
    cardPeopleCap: $("card-people-cap"),
    cardReasons: $("card-reasons"),
    cardCta: $("card-cta"),
    topbar: document.querySelector(".topbar"),
  };

  let selected = null;
  let started = false;
  let visible = false;
  let colorMemo = new Map();
  let colorKey = "";

  // ---------------------------------------------------------------- globe

  function colorOf(iso3) {
    const key = `${state.year.toFixed(3)}|${state.mix.toFixed(3)}`;
    if (key !== colorKey) {
      colorKey = key;
      colorMemo = new Map();
    }
    let c = colorMemo.get(iso3);
    if (c === undefined) {
      c = L.changeColor(pctNow(iso3)) ?? null;
      colorMemo.set(iso3, c);
    }
    return c;
  }

  function labelOf(iso3) {
    const rec = data.records.get(iso3);
    const v = popNow(iso3);
    if (!rec || v == null) return null;
    return { name: rec.name, line: `${L.fmtCompact(v)} · ${L.fmtPct(pctNow(iso3))}` };
  }

  let occ = [];
  function measureOccluders() {
    const rects = [];
    for (const node of [el.topbar?.querySelector(".search"), el.dockWrap, el.zoomCtrl, el.card.hidden ? null : el.card, el.riskPanel.hidden ? null : el.riskPanel]) {
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.width && r.height) rects.push(r);
    }
    occ = rects;
  }

  function frame(W, H) {
    const top = el.topbar ? Math.round(el.topbar.getBoundingClientRect().bottom) : 64;
    const dockTop = el.dockWrap ? Math.round(el.dockWrap.getBoundingClientRect().top) : H - 140;
    const bottom = Math.max(top + 200, Math.min(H, dockTop));
    const avail = bottom - top;
    const mobile = W < 700;
    const r = Math.max(120, Math.min(W / 2 - (mobile ? 8 : 24), avail / 2 + (mobile ? 18 : 40)));
    return { cx: Math.round(W / 2), cy: Math.round(top + avail / 2 + (mobile ? 4 : 6)), r: Math.round(r) };
  }

  const globe = createGlobe(el.canvas, {
    colorOf,
    labelOf,
    frame,
    occluders: () => occ,
    reducedMotion: () => media.reduced(),
    onHover: showTip,
    onPick: (hit, at) => {
      if (!hit) return;
      if (!hit.rec) {
        toast(`No data for ${hit.name ?? "this place"}`);
        return;
      }
      select(hit.iso3, { source: at.source });
    },
    onInteract: () => {
      closeRiskPanel();
    },
    onViewChange: () => {
      if (!el.tip.hidden && !media.finePointer()) el.tip.hidden = true;
      syncZoomButtons();
    },
  });

  function syncZoomButtons() {
    el.zoomIn.disabled = globe.k >= 15.99;
    el.zoomOut.disabled = globe.k <= 1.001;
  }

  // ---------------------------------------------------------------- tooltip

  function showTip(hit, at) {
    if (!hit || !at || !media.finePointer()) {
      el.tip.hidden = true;
      return;
    }
    const rec = hit.rec;
    el.tip.replaceChildren();
    if (!rec) {
      el.tip.append(h("p", { class: "tip-name" }, hit.name ?? "No data"), h("p", { class: "tip-line" }, "No data in our sources"));
    } else {
      const v = popNow(rec.iso3);
      const pct = pctNow(rec.iso3);
      const sw = h("span", { class: "swatch" });
      const c = L.changeColor(pct);
      if (c) sw.style.setProperty("--sw", c);
      el.tip.append(
        h("p", { class: "tip-name" }, rec.name),
        h("p", { class: "tip-big" }, `${L.fmtWords(v)} in ${yearInt()}`),
        h("p", { class: "tip-line" }, sw, pct == null ? "No forecast" : `${L.fmtPct(pct)} vs today`),
        h("p", { class: "tip-hint" }, "Click to see more"),
      );
    }
    el.tip.hidden = false;
    const vw = el.view.clientWidth;
    const vh = el.view.clientHeight;
    const tw = el.tip.offsetWidth;
    const th = el.tip.offsetHeight;
    let x = at.x + 16;
    let y = at.y + 16;
    if (x + tw > vw - 8) x = at.x - 16 - tw;
    if (y + th > vh - 8) y = at.y - 16 - th;
    el.tip.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px)`;
  }

  let toastTimer = 0;
  function toast(msg) {
    clearTimeout(toastTimer);
    el.note.textContent = msg;
    el.note.classList.add("show");
    toastTimer = setTimeout(() => el.note.classList.remove("show"), 2600);
  }

  // ---------------------------------------------------------------- dock: controls + world counter

  const controls = createTimeControls({
    prefix: "globe",
    valueText: (y) => `${y}, world ${L.fmtWords(popNow("WLD", y))}`,
  });
  el.dockTime.replaceChildren(controls.root);

  function renderCounter() {
    const y = yearInt();
    const v = popNow("WLD");
    const pct = pctNow("WLD");
    const sp = L.splitWords(v);
    setText(el.wcYear, String(y));
    setText(el.wcNum, sp.num);
    setText(el.wcUnit, sp.unit || "people");
    setText(el.wcPct, y === data.today ? "today" : pct == null ? "" : `${L.fmtPct(pct)} vs today`);
    const c = L.changeColor(pct);
    if (c) el.wcSw.style.setProperty("--sw", c);
  }

  // ---------------------------------------------------------------- legend is static HTML; "Most at risk"

  function topRisk(n = 10) {
    return data.list
      .filter((r) => Number.isInteger(r.risk?.rank))
      .sort((a, b) => a.risk.rank - b.risk.rank)
      .slice(0, n);
  }

  function renderRiskList() {
    const y = yearInt();
    el.riskList.replaceChildren(
      ...topRisk(10).map((r, i) => {
        const pct = pctNow(r.iso3);
        const sw = h("span", { class: "swatch", "aria-hidden": "true" });
        const c = L.changeColor(pct);
        if (c) sw.style.setProperty("--sw", c);
        return h(
          "li",
          null,
          h(
            "button",
            { type: "button", class: "risk-row", "data-iso3": r.iso3 },
            h("span", { class: "rr-rank" }, String(i + 1)),
            sw,
            h("span", { class: "rr-name" }, r.name),
            h("span", { class: "rr-pct" }, pct == null ? "" : `${L.fmtPct(pct)} by ${y}`),
          ),
        );
      }),
    );
  }

  function openRiskPanel() {
    renderRiskList();
    el.riskPanel.hidden = false;
    setAttr(el.riskBtn, "aria-expanded", "true");
    measureOccluders();
    setTimeout(() => document.addEventListener("pointerdown", outsideRisk, true), 0);
  }
  function closeRiskPanel(returnFocus = false) {
    if (el.riskPanel.hidden) return;
    el.riskPanel.hidden = true;
    setAttr(el.riskBtn, "aria-expanded", "false");
    document.removeEventListener("pointerdown", outsideRisk, true);
    measureOccluders();
    if (returnFocus) focusNoScroll(el.riskBtn);
  }
  function outsideRisk(e) {
    if (!el.riskPanel.contains(e.target) && !el.riskBtn.contains(e.target)) closeRiskPanel();
  }
  el.riskBtn.addEventListener("click", () => (el.riskPanel.hidden ? openRiskPanel() : closeRiskPanel()));
  el.riskList.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-iso3]");
    if (!b) return;
    closeRiskPanel();
    select(b.dataset.iso3, { source: "list" });
  });
  el.riskPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeRiskPanel(true);
    }
  });

  // ---------------------------------------------------------------- the card

  function cardOffset() {
    if (el.card.hidden) return { x: 0, y: 0 };
    if (window.innerWidth < 700) {
      const r = el.card.getBoundingClientRect();
      const top = el.topbar?.getBoundingClientRect().bottom ?? 60;
      // Center the place in the strip between the top bar and the sheet.
      const mid = (top + r.top) / 2;
      const f = globe.frame;
      return { x: 0, y: mid - f.cy };
    }
    return { x: -(el.card.offsetWidth + 24) / 2, y: 0 };
  }

  const people = peopleRow(el.cardPeople, { per: 10, maxExtra: 10 });

  function renderCard() {
    const rec = data.records.get(selected);
    if (!rec) return;
    const y = yearInt();
    const v = popNow(rec.iso3);
    const pct = pctNow(rec.iso3);
    const sp = L.splitWords(v);
    setText(el.cardNum, sp.num);
    setText(el.cardUnit, sp.unit || "people");
    setText(el.cardYear, y === data.today ? "today" : `in ${y}`);
    setText(el.cardPct, y === data.today || pct == null ? "" : `${L.fmtPct(pct)} vs today`);
    el.cardPct.dataset.band = L.changeBand(pct) ?? "";
    people.update(ratioNow(rec.iso3));
    const r = ratioNow(rec.iso3);
    const n = r == null ? null : Math.round(r * 10);
    setText(
      el.cardPeopleCap,
      r == null
        ? "No forecast for this place."
        : y === data.today
          ? "Each figure is one tenth of today's people. Move the slider."
          : r < 0.995
            ? `${n === 10 ? "Almost all" : `${Math.max(0, n)} of 10`} still here in ${y}.`
            : r > 1.005
              ? `${n} for every 10 today.`
              : `About the same as today.`,
    );
  }

  function renderCardStatic(rec) {
    setText(el.cardRegion, rec.iso3 === "WLD" ? "Whole world" : rec.region ?? "");
    setText(el.cardName, rec.name);
    el.cardRisk.replaceChildren(riskChip(rec));
    const reasons = [L.tfrReason(rec), L.birthsDeathsReason(rec, data.latestEstimateYear)].filter(Boolean);
    el.cardReasons.replaceChildren(...reasons.map((t) => h("li", null, t)));
    setAttr(el.cardCta, "href", L.countryPath(rec.iso3) + currentQuery());
    el.cardCta.replaceChildren(rec.iso3 === "WLD" ? "See the world's story" : `See ${L.possessive(rec.name)} story`, h("span", { class: "arrow", "aria-hidden": "true" }, " →"));
  }

  function currentQuery() {
    return L.buildQuery({ year: yearInt(), scenario: state.scenario }, { defaultYear: data.end });
  }

  function openCard(rec) {
    renderCardStatic(rec);
    renderCard();
    const wasHidden = el.card.hidden;
    el.card.hidden = false;
    el.view.classList.add("card-open");
    if (wasHidden && !media.reduced()) {
      el.card.classList.remove("enter");
      void el.card.offsetWidth;
      el.card.classList.add("enter");
    }
    measureOccluders();
  }

  function closeCard({ returnFocus = true } = {}) {
    if (el.card.hidden) return;
    el.card.hidden = true;
    el.view.classList.remove("card-open");
    selected = null;
    globe.setSelected(null);
    measureOccluders();
    onFocusChange(null);
    if (returnFocus) focusNoScroll(el.canvas);
  }

  el.cardClose.addEventListener("click", () => closeCard());
  el.cardCta.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(L.countryPath(selected));
  });

  function select(iso3, { source = "map", fly = true } = {}) {
    const rec = data.records.get(iso3);
    if (!rec) return;
    selected = iso3;
    globe.stopSpin();
    openCard(rec);
    if (iso3 === "WLD") {
      globe.setSelected(null);
      globe.reset();
    } else {
      globe.setSelected(iso3);
      if (fly) {
        // Measure the card after it is laid out so the fly-to can keep the place clear of it.
        requestAnimationFrame(() => globe.flyTo(iso3, { offset: cardOffset() }));
      }
    }
    onFocusChange(iso3);
    if (source !== "init") announce(`${rec.name}. ${L.fmtWords(popNow(iso3))} people in ${yearInt()}, ${L.fmtPct(pctNow(iso3))} compared with today.`);
    if (source === "keyboard" || source === "list") focusNoScroll(el.cardName);
  }

  // ---------------------------------------------------------------- zoom controls, view mode

  el.zoomIn.addEventListener("click", () => globe.zoomBy(2));
  el.zoomOut.addEventListener("click", () => globe.zoomBy(0.5));
  el.zoomReset.addEventListener("click", () => globe.reset());
  for (const b of el.modeBtns) {
    b.addEventListener("click", () => {
      const m = b.dataset.mode;
      globe.setMode(m);
      for (const x of el.modeBtns) setAttr(x, "aria-pressed", String(x.dataset.mode === m));
      try {
        localStorage.setItem("ft.view", m);
      } catch {}
      if (selected && selected !== "WLD") requestAnimationFrame(() => globe.flyTo(selected, { offset: cardOffset() }));
    });
  }

  document.addEventListener("keydown", (e) => {
    if (!visible || e.defaultPrevented) return;
    const t = e.target;
    const typing = t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (e.key === "Escape") {
      if (!el.riskPanel.hidden) return;
      if (!typing && !el.card.hidden) {
        e.preventDefault();
        closeCard();
      }
      return;
    }
    if (typing || t === el.canvas || e.metaKey || e.ctrlKey || e.altKey) return;
    if (t instanceof HTMLElement && t.closest("button, a, [role=slider]") && (e.key === " " || e.key === "Enter")) return;
    if (e.key === "+" || e.key === "=") globe.zoomBy(2);
    else if (e.key === "-" || e.key === "_") globe.zoomBy(0.5);
  });

  // ---------------------------------------------------------------- state → view

  subscribe((what) => {
    if (!started) return;
    if (what === "year" || what === "mix" || what === "data") {
      globe.recolor();
      renderCounter();
      if (selected) renderCard();
      if (!el.riskPanel.hidden && what !== "mix") renderRiskList();
    }
    if (what === "scenario" || what === "play" || what === "touched") globe.stopSpin();
  });

  const ro = new ResizeObserver(() => {
    document.documentElement.style.setProperty("--dock-h", `${Math.round(el.dockWrap.getBoundingClientRect().height)}px`);
    measureOccluders();
    globe.relayout();
  });
  ro.observe(el.dockWrap);
  window.addEventListener("resize", () => {
    measureOccluders();
    globe.relayout();
  });

  // ---------------------------------------------------------------- lifecycle

  let geoLoaded = false;
  async function loadGeo() {
    if (geoLoaded) return;
    geoLoaded = true;
    const [t110, pts] = await Promise.all([fetchJson("/geo/countries-110m.json"), fetchJson("/geo/world-points.json").catch(() => ({}))]);
    globe.setData({ topology110: t110, worldPoints: pts, records: data.records });
    // The detailed outlines load once the page is idle (or right away when zoomed in).
    idle(() => {
      fetchJson("/geo/countries-50m.json")
        .then((t50) => globe.setData({ topology50: t50 }))
        .catch((err) => console.warn("[globe] 50m outlines unavailable", err));
    });
  }

  function startIntro(route) {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    const skip = media.reduced() || route.year != null || seen || state.touched;
    if (!route.focus && !media.reduced()) globe.startSpin();
    if (skip) return;
    setYear(data.today, { source: "auto" });
    setTimeout(() => {
      if (!state.touched && visible) play({ from: data.today, duration: 5200, source: "auto" });
    }, 900);
  }

  return {
    async show(route, { first = false } = {}) {
      visible = true;
      el.view.hidden = false;
      document.body.classList.add("page-globe");
      globe.setVisible(true);
      measureOccluders();
      globe.relayout();
      try {
        const m = localStorage.getItem("ft.view");
        if (m === "flat" || m === "globe") {
          globe.setMode(m);
          for (const x of el.modeBtns) setAttr(x, "aria-pressed", String(x.dataset.mode === m));
        }
      } catch {}
      if (!started) {
        started = true;
        await loadGeo();
        renderCounter();
        if (first) startIntro(route);
      } else {
        globe.recolor();
        renderCounter();
      }
      if (route.focus && data.records.has(route.focus)) {
        if (route.focus !== selected) select(route.focus, { source: "init" });
      } else if (!route.focus && selected) closeCard({ returnFocus: false });
      syncZoomButtons();
    },
    hide() {
      visible = false;
      el.view.hidden = true;
      el.tip.hidden = true;
      closeRiskPanel();
      document.body.classList.remove("page-globe");
      globe.setVisible(false);
    },
    selectFromSearch(iso3) {
      select(iso3, { source: "search" });
    },
    get selected() {
      return selected;
    },
    globe,
  };
}
