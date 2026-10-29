// The globe page `/` (DESIGN-v3 §2): full-viewport globe, bottom dock (year slider, Play, scenario, world counter),
// legend, zoom controls, "Most at risk", hover tooltip and the country card.

import { $, h, setText, setAttr, media, focusNoScroll, announce, idle } from "./dom.js";
import * as L from "./logic.js";
import { data, state, subscribe, popNow, ratioNow, pctNow, trendNow, pct2100, outlookPct, fetchJson, setYear, play, yearInt } from "./store.js";
import { createGlobe, buildLayerIdle } from "./globe.js";
import { createTimeControls } from "./controls.js";
import { peopleRow } from "./people.js";
import { outlookChip } from "./ui.js";
import { openShare, renderSnapshot, globeVisual, shareOpen } from "./snapshot.js";

const SEEN_KEY = "ft.seenIntro";

export function createHome({ navigate, onFocusChange, siteUrl = () => L.SITE_URL, geoFetch = null }) {
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
    wcScen: $("wc-scen"),
    wcNum: $("wc-num"),
    wcUnit: $("wc-unit"),
    wcPct: $("wc-pct"),
    wcSw: $("wc-swatch"),
    riskBtn: $("risk-btn"),
    riskPanel: $("risk-panel"),
    riskList: $("risk-list"),
    riskTitle: $("risk-title"),
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
    cardShare: $("card-share"),
    shareView: $("share-view"),
    topbar: document.querySelector(".topbar"),
    geoError: $("geo-error"),
    geoRetry: $("geo-retry"),
  };

  let selected = null;
  let lastRoute = {};
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
      // How fast the place is growing or shrinking in the slider year (the last 5 years), so today has colors too.
      c = L.trendColor(trendNow(iso3)) ?? null;
      colorMemo.set(iso3, c);
    }
    return c;
  }

  // Zoomed-in labels: the name and how many people. No %: the number is what matters, and short labels fit more places.
  function labelOf(iso3) {
    const rec = data.records.get(iso3);
    const v = popNow(iso3);
    if (!rec || v == null) return null;
    return { name: rec.name, line: L.fmtCompact(v) };
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

  // Full view: the globe runs under the floating top bar and dock. Desktop: about 94% of the viewport height, centered.
  // Phones: wider than the screen, centered in the space between the top bar and the dock.
  function frame(W, H) {
    if (W < 700) {
      const top = el.topbar ? Math.round(el.topbar.getBoundingClientRect().bottom) : 62;
      const dockTop = el.dockWrap ? Math.round(el.dockWrap.getBoundingClientRect().top) : H - 170;
      const cy = Math.round((top + Math.max(top + 200, dockTop)) / 2);
      return { cx: Math.round(W / 2), cy, r: Math.round(Math.max(W * 0.62, Math.min(H * 0.36, W * 0.75))) };
    }
    const r = Math.min(H * 0.47, W * 0.47);
    return { cx: Math.round(W / 2), cy: Math.round(H * 0.485), r: Math.round(r) };
  }

  const globe = createGlobe(el.canvas, {
    colorOf,
    labelOf,
    frame,
    occluders: () => occ,
    reducedMotion: () => media.reduced(),
    onHover: showTip,
    onPick: (hit, at) => {
      el.tip.hidden = true;
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
      const y = yearInt();
      const v = popNow(rec.iso3);
      const pct = pctNow(rec.iso3);
      const rate = trendNow(rec.iso3);
      const sw = h("span", { class: "swatch" });
      const c = L.trendColor(rate);
      if (c) sw.style.setProperty("--sw", c);
      el.tip.append(
        h("p", { class: "tip-name" }, rec.name),
        h("p", { class: "tip-big" }, `${L.fmtWords(v)} in ${y}`),
        h("p", { class: "tip-line" }, sw, L.trendWords(rate)),
        y === data.today || pct == null ? "" : h("p", { class: "tip-sub" }, `${L.fmtPct(pct)} vs today`),
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
    valueText: (y) => `${y}, world ${L.fmtWords(popNow("WLD", y))}${state.scenario === "constant" ? ", if birth rates stay the same" : ""}`,
    hint: true,
  });
  el.dockTime.replaceChildren(controls.root);

  function renderCounter() {
    const y = yearInt();
    const v = popNow("WLD");
    const pct = pctNow("WLD");
    const sp = L.splitWords(v);
    setText(el.wcYear, String(y));
    const constant = state.scenario === "constant";
    el.wcScen.hidden = !constant;
    setText(el.wcNum, sp.num);
    setText(el.wcUnit, sp.unit || "people");
    setText(el.wcPct, y === data.today ? "today" : pct == null ? "" : `${L.fmtPct(pct)} vs today`);
    const c = L.trendColor(trendNow("WLD"));
    if (c) el.wcSw.style.setProperty("--sw", c);
    renderLegendCap(y);
  }

  // The legend names the years the colors compare: "Change 2021–26", with "forecast" once they run past the UN's last
  // count (at 1950, the first year's change).
  const legendCap = el.view.querySelector("#legend .lg-cap");
  const legend = $("legend");
  let lastCap = null;
  function renderLegendCap(y) {
    if (y === lastCap || !legendCap) return;
    lastCap = y;
    const to = Math.max(y, data.first + 1);
    const from = Math.max(data.first, to - L.TREND_YEARS);
    const fc = to > data.latestEstimateYear;
    setText(legendCap, `Change ${from}–${String(to).slice(-2)}${fc ? ", forecast" : ""}`);
    setAttr(
      legend,
      "aria-label",
      `Colors show how fast each country's population changed each year from ${from} to ${to}${fc ? " (UN forecast)" : ""}: green, growing; sand, about the same; orange, shrinking; red, shrinking fast, darker the faster.`,
    );
  }

  // ---------------------------------------------------------------- legend is static HTML; "Most at risk"

  // "Shrinking most": the 10 places (100,000 people or more) with the biggest fall by 2100 under the selected
  // scenario, sorted by the number each row shows.
  function shrinkingMost(n = 10) {
    const sc = state.scenario;
    return data.list
      .filter((r) => r.ranked === true && pct2100(r.iso3, sc) != null)
      .sort((a, b) => pct2100(a.iso3, sc) - pct2100(b.iso3, sc))
      .slice(0, n);
  }

  function renderRiskList() {
    const sc = state.scenario;
    setText(el.riskTitle, sc === "constant" ? "Shrinking most by 2100, if birth rates stay the same" : "Shrinking most by 2100");
    el.riskList.replaceChildren(
      ...shrinkingMost(10).map((r, i) => {
        const pct = pct2100(r.iso3, sc);
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
            h("span", { class: "rr-pct" }, pct == null ? "" : `${L.fmtPct(pct)} by 2100`),
          ),
        );
      }),
    );
  }

  function openRiskPanel() {
    // The card and the list share the left side: the list replaces the card, and picking a row opens that card.
    closeCard({ returnFocus: false });
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
    // The card sits on the left, so the place moves right of center.
    return { x: (el.card.offsetWidth + 24) / 2, y: 0 };
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
    setText(el.cardPeopleCap, L.peopleCaption(ratioNow(rec.iso3), y, data.today));
  }

  function renderCardStatic(rec) {
    setText(el.cardRegion, rec.iso3 === "WLD" ? "Whole world" : rec.region ?? "");
    setText(el.cardName, rec.name);
    el.cardRisk.replaceChildren(outlookChip(rec));
    const reasons = [L.tfrReason(rec), L.birthsDeathsReason(rec, data.latestEstimateYear)].filter(Boolean);
    el.cardReasons.replaceChildren(...reasons.map((t) => h("li", null, t)));
    setAttr(el.cardCta, "href", L.countryPath(rec.iso3) + currentQuery());
    const label = rec.name.length <= 12 ? `See ${L.possessiveOf(rec)} story` : "See the story";
    el.cardCta.replaceChildren(label, h("span", { class: "arrow", "aria-hidden": "true" }, " →"));
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
    // Keyboard, list and search picks move focus to the card: Escape then closes it and focus returns to the globe.
    if (source === "keyboard" || source === "list" || source === "search") focusNoScroll(el.cardName);
  }

  // ---------------------------------------------------------------- share a picture

  // The part of the canvas the picture shows, in CSS pixels. The whole globe when it fits on screen; on phones, a square
  // around the place; zoomed in (or on the flat map), the area you can see between the card and the controls, made
  // square from the canvas around it.
  function snapshotCrop() {
    const f = globe.frame;
    const phone = f.W < 700;
    const r = f.r * globe.k;
    if (globe.mode === "globe" && 2.1 * r <= Math.min(f.W, f.H) * 1.05) {
      const size = 2.12 * r;
      return { x: f.cx - size / 2, y: f.cy - size / 2, w: size, h: size };
    }
    const top = el.topbar?.getBoundingClientRect().bottom ?? 0;
    const bottom = el.dockWrap?.getBoundingClientRect().top ?? f.H;
    if (phone && globe.mode === "globe") {
      // The globe is wider than a phone: a square as wide as the screen, around the place (or the middle).
      const at = selected && selected !== "WLD" ? globe.screenOf(selected) : null;
      const size = f.W;
      const cy = at ? at.y : (top + bottom) / 2;
      return { x: 0, y: Math.max(0, Math.min(f.H - size, cy - size / 2)), w: size, h: size };
    }
    const left = !phone && !el.card.hidden ? el.card.getBoundingClientRect().right : 0;
    const right = !phone && el.zoomCtrl ? el.zoomCtrl.getBoundingClientRect().left : f.W;
    if (globe.mode === "flat" && globe.k < 1.5) return { x: 0, y: top, w: f.W, h: Math.max(1, bottom - top) };
    const size = Math.min(Math.max(right - left, bottom - top), f.H);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    return { x: cx - size / 2, y: Math.max(0, Math.min(f.H - size, cy - size / 2)), w: size, h: size };
  }

  // The picture copies the canvas, so it waits for the globe's first full frame (right after load, the map may still
  // be loading; on a slow phone that takes a while) and then for one more frame of whatever moved.
  async function globeDrawn(timeout = 30000) {
    const t0 = performance.now();
    while (!globe.ready && performance.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 50));
    globe.redraw();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!globe.ready) throw new Error("the globe has not drawn yet");
  }

  function shareView() {
    const iso3 = selected ?? "WLD";
    const rec = data.records.get(iso3);
    if (!rec) return;
    globe.stopSpin();
    closeRiskPanel();
    el.tip.hidden = true;
    const y = yearInt();
    const visual = (g, box, t) => globeVisual(el.canvas, snapshotCrop())(g, box, t);
    const q = L.buildQuery({ year: y, scenario: state.scenario, ...(iso3 !== "WLD" ? { focus: iso3 } : {}) }, { defaultYear: data.end });
    const base = siteUrl();
    const url = (base.endsWith("/") ? base : base + "/") + q;
    const m = { rec, year: y, today: data.today, lastEstimate: data.latestEstimateYear, scenario: state.scenario, pop: popNow(iso3), pct: pctNow(iso3), ratio: ratioNow(iso3), outlookPct: outlookPct(iso3), url, visual };
    openShare({
      make: async () => {
        await globeDrawn();
        return renderSnapshot(m);
      },
      text: L.snapshotPostText(m),
      url,
      fileName: `fertility-tracker-${L.slugOf(rec)}-${y}.png`,
      alt: `${L.displayName(rec)} on the globe in ${y}: ${L.fmtWords(m.pop)} people, ${L.fmtPct(m.pct)} vs today.`,
    });
  }
  el.shareView?.addEventListener("click", shareView);
  el.cardShare?.addEventListener("click", shareView);

  // ---------------------------------------------------------------- zoom controls, view mode

  el.zoomIn.addEventListener("click", () => globe.zoomToward(selected !== "WLD" ? selected : null, 2));
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
    if (!visible || e.defaultPrevented || shareOpen()) return;
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
    if (e.key === "+" || e.key === "=") globe.zoomToward(selected !== "WLD" ? selected : null, 2);
    else if (e.key === "-" || e.key === "_") globe.zoomBy(0.5);
  });

  // ---------------------------------------------------------------- state → view

  subscribe((what) => {
    if (!started) return;
    if (what === "year" || what === "mix" || what === "data") {
      globe.recolor();
      renderCounter();
      if (selected) renderCard();

    }
    if (what === "scenario") {
      const rec = data.records.get(selected);
      if (rec) el.cardRisk.replaceChildren(outlookChip(rec));
      if (!el.riskPanel.hidden) renderRiskList();
      renderCounter();
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

  // The outlines count as loaded only once they have arrived. A failure resets the state, shows "Couldn't load the
  // map. Retry", and the next visit to the globe (or the Retry button) tries again.
  let geoState = "idle"; // idle | loading | done
  let geoPromise = null;
  function loadGeo() {
    if (geoState === "done") return Promise.resolve(true);
    if (geoState === "loading") return geoPromise;
    geoState = "loading";
    el.geoError.hidden = true;
    const early = geoFetch;
    geoFetch = null; // the boot-time request is used once; retries fetch afresh
    geoPromise = (async () => {
      try {
        const t110 = await (early ? early.catch(() => fetchJson("/geo/countries-110m.json")) : fetchJson("/geo/countries-110m.json"));
        const pts = await fetchJson("/geo/world-points.json").catch(() => ({}));
        globe.setData({ topology110: t110, worldPoints: pts, records: data.records });
        geoState = "done";
        loadDetail50();
        return true;
      } catch (err) {
        console.warn("[globe] map outlines unavailable", err);
        geoState = "idle";
        el.geoError.hidden = !visible;
        return false;
      }
    })();
    return geoPromise;
  }

  function loadDetail50() {
    // The detailed outlines load once the page is idle and are prepared in small idle slices, so switching to them
    // never blocks a frame.
    idle(() => {
      fetchJson("/geo/countries-50m.json")
        .then((t50) => buildLayerIdle(t50, data.records))
        .then((layer50) => globe.setData({ layer50 }))
        .catch((err) => console.warn("[globe] 50m outlines unavailable", err));
    });
  }

  // First paint of the globe: outlines, counter, spin and (first visit) the intro. Runs again after a failed load.
  let introDecided = null;
  async function start(route, first) {
    if (introDecided == null) introDecided = first && introWanted(route);
    const intro = introDecided && !state.touched;
    const introFrom = Math.max(data.first, L.REPLAY_FROM);
    if (intro && !started) setYear(introFrom, { source: "auto" });
    const ok = await loadGeo();
    if (!ok || started) return ok;
    started = true;
    renderCounter();
    if (!lastRoute.focus && !media.reduced()) globe.startSpin();
    if (intro && !state.touched) requestAnimationFrame(() => visible && !state.touched && play({ from: introFrom, duration: 7000, source: "auto" }));
    if (lastRoute.focus && data.records.has(lastRoute.focus) && lastRoute.focus !== selected) select(lastRoute.focus, { source: "init" });
    return true;
  }

  el.geoRetry.addEventListener("click", () => start(lastRoute, false));

  // First visit: play 2000 → 2100 once (the recent past, then the forecast), starting with the first painted frame. Skipped with reduced motion, a ?year=
  // link, or later in the session. Any slider, Play or scenario touch stops it at once (store.touch).
  function introWanted(route) {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    return !(media.reduced() || route.year != null || seen || state.touched);
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
      lastRoute = route;
      if (!started) {
        if (!(await start(route, first))) return;
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
      el.geoError.hidden = true;
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
