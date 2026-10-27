// World map: flat Equal Earth by default, orthographic globe on demand (DESIGN §2).
// Uses the vendored UMD globals d3 (d3-array + d3-geo) and topojson (topojson-client).

import { s, h, setAttr, media, focusNoScroll } from "./dom.js";
import { nearestInDirection, tooltipLines, cursorAnnouncement, legendKey, colorFor, NODATA } from "./logic.js";

const d3 = () => globalThis.d3;
const topo = () => globalThis.topojson;

// world-atlas 110m features without an ISO numeric id, and the code the data uses for them (UN convention).
const NAME_FALLBACK = { Kosovo: "XKX", Somaliland: "SOM", "N. Cyprus": "CYP" };
const DROP_IDS = new Set(["010", "260"]); // Antarctica, Fr. S. Antarctic Lands
const FLAT_RATIO_FALLBACK = 0.4385;
const DOT_AREA = 6; // px²: polygons smaller than this get a dot
const RING_AREA = 150; // px²: polygons smaller than this get the locator ring
const CHOOSER_AREA = 400; // px²
const CHOOSER_RADIUS = 22;
const DOT_HIT = 6;

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Join the topology to the data: isoNumeric first, then the name fallback. Returns { places, featureCollection }.
export function buildPlaces(topology, points, records) {
  const D3 = d3();
  const T = topo();
  const byNumeric = new Map();
  for (const r of records.values()) if (r.isoNumeric) byNumeric.set(String(r.isoNumeric).padStart(3, "0"), r.iso3);

  const groups = new Map();
  for (const g of topology.objects.countries.geometries) {
    const id = g.id == null ? null : String(g.id).padStart(3, "0");
    if (id && DROP_IDS.has(id)) continue;
    let key = id ? byNumeric.get(id) : null;
    if (!key) key = NAME_FALLBACK[g.properties?.name] ?? null;
    if (!key) key = `nodata-${id ?? g.properties?.name ?? groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }

  const places = new Map();
  const features = [];
  for (const [key, geoms] of groups) {
    const geometry = geoms.length === 1 ? T.feature(topology, geoms[0]).geometry : T.merge(topology, geoms);
    if (!geometry) continue;
    const rec = records.get(key) ?? null;
    const feature = { type: "Feature", id: key, properties: { name: rec?.name ?? geoms[0].properties?.name ?? key }, geometry };
    features.push(feature);
    let largest = geometry;
    if (geometry.type === "MultiPolygon") {
      let best = -1;
      for (const coords of geometry.coordinates) {
        const poly = { type: "Polygon", coordinates: coords };
        const a = D3.geoArea(poly);
        if (a > best) {
          best = a;
          largest = poly;
        }
      }
    }
    places.set(key, { iso3: key, name: feature.properties.name, kind: "poly", feature, lonlat: D3.geoCentroid(largest), rec });
  }

  for (const [iso3, lonlat] of Object.entries(points ?? {})) {
    const rec = records.get(iso3);
    if (!rec || places.has(iso3)) continue;
    places.set(iso3, { iso3, name: rec.name, kind: "point", lonlat, rec, isDot: true });
  }

  for (const r of records.values()) {
    if (r.iso3 === "WLD") continue;
    if (!places.has(r.iso3)) console.warn(`[map] ${r.iso3} (${r.name}) has no polygon or point; reachable through search and the list.`);
  }
  return { places, featureCollection: { type: "FeatureCollection", features } };
}

export function createMap(opts) {
  const {
    frame,
    svg,
    tooltip,
    chooser,
    chooserRows,
    note,
    cursorStatus,
    onSelect,
    onNoData,
    onEscape,
    onSearchRequest,
    rankedCount,
    firstRanked,
  } = opts;

  const D3 = d3();
  let places = new Map();
  let fc = { type: "FeatureCollection", features: [] };
  let records = new Map();
  let colorMode = "risk";
  let view = "flat";
  let selected = null;
  let isolate = null;
  let hover = null;
  let cursor = null;
  let W = 0;
  let H = 0;
  let proj = null;
  let path = null;
  let flatPath = null;
  let rotation = [0, -15];
  let turnRaf = 0;
  let renderRaf = 0;
  let refPoints = [];
  let hideTipTimer = 0;
  let noteTimer = 0;
  let hasData = false;

  // ------------------------------------------------------------ SVG scaffold
  svg.replaceChildren();
  const defs = s(
    "defs",
    null,
    s(
      "pattern",
      { id: "map-hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      s("rect", { width: 4, height: 4, fill: "#1A1F2A" }),
      s("line", { x1: 0.5, y1: 0, x2: 0.5, y2: 4, stroke: "#2E3544", "stroke-width": 1 }),
    ),
    s(
      "radialGradient",
      { id: "globe-fill", cx: "40%", cy: "36%", r: "70%" },
      s("stop", { offset: "0%", "stop-color": "#18213A" }),
      s("stop", { offset: "100%", "stop-color": "#0D1220" }),
    ),
    s(
      "radialGradient",
      { id: "globe-halo", cx: "50%", cy: "50%", r: "50%" },
      s("stop", { offset: "92%", "stop-color": "rgba(110,150,255,0)" }),
      s("stop", { offset: "96%", "stop-color": "rgba(110,150,255,.12)" }),
      s("stop", { offset: "100%", "stop-color": "rgba(110,150,255,0)" }),
    ),
  );
  const decoBack = s("g", { class: "globe-deco" });
  const halo = s("circle", { fill: "url(#globe-halo)" });
  const sphere = s("circle", { fill: "url(#globe-fill)" });
  const graticule = s("path", { class: "graticule" });
  decoBack.append(halo, sphere, graticule);
  const land = s("g", { class: "land" });
  const dotsG = s("g", { class: "dots" });
  const hoverG = s("g", { class: "hover-layer" });
  const hoverPath = s("path", { visibility: "hidden" });
  hoverG.append(hoverPath);
  const selG = s("g", { class: "sel-layer" });
  const selHalo = s("path", { class: "sel-halo" });
  const selLine = s("path", { class: "sel-line" });
  const selDotHalo = s("circle", { class: "sel-dot-halo", r: 5 });
  const selDot = s("circle", { class: "sel-dot", r: 5 });
  const ringHalo = s("circle", { class: "ring-halo", r: 12 });
  const ringLine = s("circle", { class: "ring-line", r: 12 });
  const ringPulse = s("circle", { class: "ring-pulse", r: 12 });
  selG.append(selHalo, selLine, selDotHalo, selDot, ringHalo, ringLine, ringPulse);
  const decoFront = s("g", { class: "globe-deco" });
  const rim = s("circle", { class: "globe-rim" });
  decoFront.append(rim);
  svg.append(defs, decoBack, land, dotsG, hoverG, selG, decoFront);

  // ------------------------------------------------------------ data
  function setTopology(topology, points, recs) {
    records = recs ?? new Map();
    hasData = records.size > 0;
    const built = buildPlaces(topology, points, records);
    places = built.places;
    fc = built.featureCollection;
    land.replaceChildren();
    dotsG.replaceChildren();
    for (const p of places.values()) {
      if (p.kind === "poly") {
        p.pathEl = s("path", { "data-iso3": p.iso3, "aria-hidden": "true" });
        land.append(p.pathEl);
      }
    }
    for (const p of places.values()) {
      p.dotEl = s("circle", { "data-iso3": p.iso3, "aria-hidden": "true", r: 3 });
      dotsG.append(p.dotEl);
    }
    svg.classList.toggle("no-data", !hasData);
    // Equal Earth reference points for keyboard navigation, the same in both views.
    const ref = D3.geoEqualEarth().fitWidth(1000, fc);
    refPoints = [];
    for (const p of places.values()) {
      if (!p.rec) continue;
      const xy = ref(p.lonlat);
      if (xy) refPoints.push({ iso3: p.iso3, x: xy[0], y: xy[1] });
    }
    layout();
    applyColors();
  }

  function setRecords(recs) {
    records = recs;
    hasData = records.size > 0;
    for (const p of places.values()) p.rec = records.get(p.iso3) ?? null;
    svg.classList.toggle("no-data", !hasData);
    applyColors();
  }

  // ------------------------------------------------------------ layout
  // Width from the column, never from the frame itself: the frame's CSS aspect-ratio plus an inline height (left over
  // from the globe) would otherwise derive a wider width from that height. On phones the frame bleeds into the gutters.
  function flatWidth() {
    const colW = frame.parentElement.getBoundingClientRect().width || 320;
    return Math.max(260, Math.round(colW + (media.mobile() ? 2 * gutter() : 0)));
  }

  function globeSide() {
    const col = frame.parentElement;
    const colW = Math.round(col.getBoundingClientRect().width);
    if (media.desktop()) return Math.max(260, Math.round(Math.min(colW, 560, window.innerHeight - 368)));
    // Mobile: the full-bleed frame width. Tablet: the column width, capped so the globe fits a screen.
    if (media.mobile()) return flatWidth();
    return Math.max(260, Math.round(Math.min(colW, 600)));
  }

  function gutter() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gutter")) || 16;
  }

  function layout() {
    cancelAnimationFrame(turnRaf);
    // From here on the script owns the frame's size; the CSS aspect-ratio only reserves space before first paint.
    frame.style.aspectRatio = "auto";
    if (view === "globe") {
      const side = globeSide();
      frame.classList.add("globe");
      frame.style.width = media.mobile() ? "" : `${side}px`;
      frame.style.marginLeft = media.mobile() ? "" : "auto";
      frame.style.marginRight = media.mobile() ? "" : "auto";
      W = media.mobile() ? flatWidth() : side;
      H = side;
      proj = D3.geoOrthographic()
        .clipAngle(90)
        .precision(0.5)
        .fitExtent(
          [
            [8 + (W - side) / 2, 8],
            [W - 8 - (W - side) / 2, side - 8],
          ],
          { type: "Sphere" },
        )
        .rotate(rotation);
    } else {
      frame.classList.remove("globe");
      frame.style.width = "";
      frame.style.marginLeft = "";
      frame.style.marginRight = "";
      W = flatWidth();
      proj = D3.geoEqualEarth().rotate([0, 0]);
      if (fc.features.length) {
        proj.fitWidth(W, fc);
        const b = D3.geoPath(proj).bounds(fc);
        H = Math.ceil(b[1][1] + 1);
      } else {
        H = Math.round(W * FLAT_RATIO_FALLBACK);
      }
    }
    path = D3.geoPath(proj);
    // Flat metrics drive the dot set and chooser areas in both views.
    const flat = D3.geoEqualEarth();
    if (fc.features.length) flat.fitWidth(flatWidth(), fc);
    flatPath = D3.geoPath(flat);
    for (const p of places.values()) {
      if (p.kind === "poly") {
        p.flatArea = flatPath.area(p.feature);
        p.isDot = p.flatArea < DOT_AREA;
      }
      if (view === "flat") p.xy = proj(p.lonlat);
    }
    frame.style.height = `${H}px`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    const dotR = W >= 700 ? 3 : 2.5;
    for (const p of places.values()) {
      if (p.dotEl) {
        p.dotR = dotR;
        p.dotEl.setAttribute("r", p === places.get(hover) && p.isDot ? dotR + 1 : dotR);
        p.dotEl.style.display = p.isDot ? "" : "none";
      }
    }
    decoBack.style.display = view === "globe" ? "" : "none";
    decoFront.style.display = view === "globe" ? "" : "none";
    if (view === "globe") {
      graticule.setAttribute("d", path(D3.geoGraticule().step([30, 30])()) ?? "");
    }
    render();
  }

  // ------------------------------------------------------------ rendering
  function center() {
    return [-rotation[0], -rotation[1]];
  }

  function visible(p) {
    if (view !== "globe") return true;
    return D3.geoDistance(p.lonlat, center()) <= Math.PI / 2 - 0.02;
  }

  function screenPos(p) {
    if (!p) return null;
    if (view === "flat") return p.xy ?? proj(p.lonlat);
    if (!visible(p)) return null;
    return proj(p.lonlat);
  }

  function areaNow(p) {
    if (p.kind !== "poly") return 0;
    if (view === "flat") return p.flatArea ?? 0;
    return path.area(p.feature) || 0;
  }

  function render() {
    if (!proj) return;
    if (view === "globe") {
      proj.rotate(rotation);
      const [cx, cy] = proj.translate();
      const r = proj.scale();
      for (const c of [sphere, rim]) {
        c.setAttribute("cx", cx);
        c.setAttribute("cy", cy);
        c.setAttribute("r", r);
      }
      halo.setAttribute("cx", cx);
      halo.setAttribute("cy", cy);
      halo.setAttribute("r", r * 1.06);
      graticule.setAttribute("d", path(D3.geoGraticule().step([30, 30])()) ?? "");
    }
    for (const p of places.values()) {
      if (p.pathEl) p.pathEl.setAttribute("d", path(p.feature) ?? "");
      if (p.dotEl && p.isDot) {
        const xy = screenPos(p);
        if (xy) {
          p.dotEl.setAttribute("cx", xy[0].toFixed(1));
          p.dotEl.setAttribute("cy", xy[1].toFixed(1));
          p.dotEl.style.display = "";
        } else {
          p.dotEl.style.display = "none";
        }
      }
    }
    renderSelection();
    renderHover();
  }

  function scheduleRender() {
    if (renderRaf) return;
    renderRaf = requestAnimationFrame(() => {
      renderRaf = 0;
      render();
    });
  }

  function fillFor(p) {
    if (!p.rec) return "url(#map-hatch)";
    return colorFor(p.rec, colorMode) ?? "url(#map-hatch)";
  }

  function applyColors() {
    for (const p of places.values()) {
      const f = hasData ? fillFor(p) : "#171C26";
      if (p.pathEl) p.pathEl.setAttribute("fill", f);
      if (p.dotEl) p.dotEl.setAttribute("fill", f);
    }
    applyIsolation();
    renderSelection();
    svg.setAttribute(
      "aria-label",
      `World map colored by ${colorMode === "tfr" ? "births per woman" : "decline risk"}. Arrow keys move between countries. Enter selects.`,
    );
  }

  function applyIsolation() {
    for (const p of places.values()) {
      const key = p.rec ? legendKey(p.rec, colorMode) : NODATA;
      const faded = isolate != null && key !== isolate && p.iso3 !== selected;
      p.pathEl?.classList.toggle("faded", faded);
      p.dotEl?.classList.toggle("faded", faded);
    }
  }

  function hideSel() {
    for (const el of [selHalo, selLine]) el.setAttribute("d", "");
    for (const el of [selDotHalo, selDot, ringHalo, ringLine, ringPulse]) el.setAttribute("visibility", "hidden");
  }

  function renderSelection() {
    hideSel();
    const p = places.get(selected);
    if (!p || !proj) return;
    if (p.kind === "poly") {
      const d = path(p.feature) ?? "";
      selHalo.setAttribute("d", d);
      selLine.setAttribute("d", d);
    }
    const xy = screenPos(p);
    if (!xy) return;
    const showRing = p.isDot || areaNow(p) < RING_AREA;
    if (p.isDot) {
      for (const el of [selDotHalo, selDot]) {
        el.setAttribute("cx", xy[0]);
        el.setAttribute("cy", xy[1]);
        el.setAttribute("visibility", "visible");
      }
      selDot.setAttribute("fill", hasData ? fillFor(p) : "#171C26");
    }
    for (const el of [ringHalo, ringLine, ringPulse]) {
      el.setAttribute("cx", xy[0]);
      el.setAttribute("cy", xy[1]);
    }
    ringHalo.setAttribute("visibility", showRing ? "visible" : "hidden");
    ringLine.setAttribute("visibility", showRing ? "visible" : "hidden");
    ringPulse.setAttribute("visibility", "visible");
  }

  function pulse() {
    if (media.reduced() || typeof ringPulse.animate !== "function") return;
    if (!places.get(selected) || ringPulse.getAttribute("visibility") === "hidden") return;
    ringPulse.getAnimations?.().forEach((a) => a.cancel());
    ringPulse.animate(
      [
        { transform: "scale(1)", opacity: 0.9 },
        { transform: "scale(1.8333)", opacity: 0 },
      ],
      { duration: 700, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
  }

  function renderHover() {
    const target = cursor ?? hover;
    for (const p of places.values()) {
      if (p.dotEl?.classList.contains("hovered") && p.iso3 !== target) {
        p.dotEl.classList.remove("hovered");
        p.dotEl.setAttribute("r", p.dotR ?? 3);
      }
    }
    const p = places.get(target);
    if (!p || !p.rec) {
      hoverPath.setAttribute("visibility", "hidden");
      return;
    }
    if (p.kind === "poly" && !p.isDot) {
      hoverPath.setAttribute("d", path(p.feature) ?? "");
      hoverPath.setAttribute("visibility", "visible");
    } else {
      hoverPath.setAttribute("visibility", "hidden");
    }
    if (p.isDot && p.dotEl) {
      p.dotEl.classList.add("hovered");
      p.dotEl.setAttribute("r", (p.dotR ?? 3) + 1);
    }
  }

  // ------------------------------------------------------------ tooltip
  function tipContent(p, keyboard = false) {
    tooltip.replaceChildren();
    if (!p.rec) {
      tooltip.append(h("div", { class: "tt-name" }, h("span", { class: "swatch", "data-nodata": "" }), p.name));
      tooltip.append(h("div", { class: "tt-line" }, "No data in our sources"));
      return;
    }
    const lines = tooltipLines(p.rec, rankedCount());
    const sw = h("span", { class: "swatch" });
    const col = colorFor(p.rec, colorMode);
    if (col) sw.style.setProperty("--sw", col);
    else sw.setAttribute("data-nodata", "");
    tooltip.append(h("div", { class: "tt-name" }, sw, lines[0]));
    for (const l of lines.slice(1)) tooltip.append(h("div", { class: "tt-line" }, l));
    tooltip.append(h("div", { class: "tt-hint" }, keyboard ? "Press Enter for details" : "Click for details"));
  }

  function showTip(p, x, y, anchored = false) {
    clearTimeout(hideTipTimer);
    tipContent(p, anchored);
    tooltip.hidden = false;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const off = anchored ? 16 : 14;
    let left = x + off;
    let top = y + off;
    if (left + tw > fw) left = x - off - tw;
    if (top + th > fh) top = y - off - th;
    left = clamp(left, 0, Math.max(0, fw - tw));
    top = clamp(top, -th + 24, Math.max(0, fh - 24));
    tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function hideTip(delay = 100) {
    clearTimeout(hideTipTimer);
    hideTipTimer = setTimeout(() => (tooltip.hidden = true), delay);
  }

  // ------------------------------------------------------------ hit testing
  function localPoint(e) {
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / (r.width || W), ((e.clientY - r.top) * H) / (r.height || H)];
  }

  function polygonAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const path = el?.closest?.("path[data-iso3]");
    if (!path || !land.contains(path)) return null;
    return places.get(path.getAttribute("data-iso3")) ?? null;
  }

  function nearestDot(x, y, radius) {
    let best = null;
    let bd = radius;
    for (const p of places.values()) {
      if (!p.isDot || !p.rec) continue;
      const xy = screenPos(p);
      if (!xy) continue;
      const d = Math.hypot(xy[0] - x, xy[1] - y);
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function hitAt(e) {
    const [x, y] = localPoint(e);
    return nearestDot(x, y, DOT_HIT) ?? polygonAt(e.clientX, e.clientY);
  }

  function tapCandidates(e) {
    const [x, y] = localPoint(e);
    const P = polygonAt(e.clientX, e.clientY);
    const out = new Map();
    if (P?.rec) {
      const big = areaNow(P) >= CHOOSER_AREA;
      const xy = screenPos(P);
      out.set(P.iso3, { p: P, d: big ? -1 : xy ? Math.min(Math.hypot(xy[0] - x, xy[1] - y), CHOOSER_RADIUS) : 0 });
    }
    for (const p of places.values()) {
      if (!p.rec || out.has(p.iso3)) continue;
      if (!(p.isDot || (p.kind === "poly" && areaNow(p) < CHOOSER_AREA))) continue;
      const xy = screenPos(p);
      if (!xy) continue;
      const d = Math.hypot(xy[0] - x, xy[1] - y);
      if (d <= CHOOSER_RADIUS) out.set(p.iso3, { p, d });
    }
    return { P, list: [...out.values()].sort((a, b) => a.d - b.d).map((c) => c.p), x, y };
  }

  // ------------------------------------------------------------ chooser ("Which place?")
  let chooserOpen = false;
  function openChooser(list, x, y) {
    chooserRows.replaceChildren();
    const max = 6;
    const shown = list.length > max ? list.slice(0, max - 1) : list;
    for (const p of shown) {
      const sw = h("span", { class: "swatch" });
      const col = colorFor(p.rec, colorMode);
      if (col) sw.style.setProperty("--sw", col);
      else sw.setAttribute("data-nodata", "");
      const tfr = p.rec?.tfr?.value;
      chooserRows.append(
        h(
          "button",
          { type: "button", "data-iso3": p.iso3 },
          sw,
          h("span", { class: "c-name" }, p.rec.name),
          h("span", { class: "c-tfr" }, tfr != null ? (Math.round(tfr * 100) / 100).toFixed(2) : "–"),
        ),
      );
    }
    if (list.length > max) {
      chooserRows.append(h("button", { type: "button", "data-search": "1" }, h("span", { class: "c-name c-search" }, "Search for a place")));
    }
    chooser.hidden = false;
    chooserOpen = true;
    const fw = frame.clientWidth;
    const cw = chooser.offsetWidth;
    const ch = chooser.offsetHeight;
    let left = clamp(x - cw / 2, 4, Math.max(4, fw - cw - 4));
    let top = y + 12;
    if (top + ch > H + 120) top = Math.max(-ch + 40, y - 12 - ch);
    chooser.style.left = `${Math.round(left)}px`;
    chooser.style.top = `${Math.round(top)}px`;
    focusNoScroll(chooserRows.querySelector("button"));
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  }

  function closeChooser(returnFocus = true) {
    if (!chooserOpen) return;
    chooserOpen = false;
    chooser.hidden = true;
    document.removeEventListener("pointerdown", outside, true);
    if (returnFocus) focusNoScroll(svg);
  }

  function outside(e) {
    if (!chooser.contains(e.target)) closeChooser(chooser.contains(document.activeElement));
  }

  chooserRows.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.search) {
      closeChooser(false);
      onSearchRequest?.();
      return;
    }
    const iso3 = b.dataset.iso3;
    closeChooser(true);
    onSelect(iso3, "chooser");
  });
  chooser.addEventListener("keydown", (e) => {
    const btns = [...chooserRows.querySelectorAll("button")];
    const i = btns.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeChooser(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusNoScroll(btns[(i + 1) % btns.length]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusNoScroll(btns[(i - 1 + btns.length) % btns.length]);
    } else if (e.key === "Tab") {
      closeChooser(false);
    }
  });

  function showNote(text) {
    clearTimeout(noteTimer);
    note.textContent = text;
    noteTimer = setTimeout(() => (note.textContent = ""), 3000);
  }

  // ------------------------------------------------------------ pointer input
  let down = null; // { id, type, x, y, t, scrollY, moved, rot0 }

  svg.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0 && e.pointerType === "mouse") return;
    // Focus the map ourselves, without scrolling (G3), instead of the browser's click focus.
    e.preventDefault();
    if (document.activeElement !== svg) focusNoScroll(svg);
    down = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, t: performance.now(), scrollY: window.scrollY, moved: false, rot0: rotation.slice() };
    if (view === "globe" && e.pointerType === "mouse") {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {}
    }
  });

  svg.addEventListener("pointermove", (e) => {
    if (down && e.pointerId === down.id) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      const limit = down.type === "touch" ? 8 : 5;
      if (!down.moved && Math.hypot(dx, dy) > limit) {
        down.moved = true;
        if (view === "globe") {
          cancelAnimationFrame(turnRaf);
          frame.classList.add("dragging");
          tooltip.hidden = true;
        }
      }
      if (down.moved && view === "globe") {
        const r = proj.scale();
        const k = 57.3 / r;
        const lambda = down.rot0[0] + dx * k;
        const phi = down.type === "touch" ? down.rot0[1] : clamp(down.rot0[1] - dy * k, -60, 60);
        rotation = [lambda, phi];
        scheduleRender();
        return;
      }
    }
    if (e.pointerType !== "mouse" || !media.finePointer()) return;
    if (down?.moved) return;
    const p = hitAt(e);
    const iso3 = p?.iso3 ?? null;
    if (iso3 !== hover) {
      hover = iso3;
      if (!cursor) renderHover();
    }
    svg.style.cursor = p?.rec ? "pointer" : "";
    if (p) {
      const fr = frame.getBoundingClientRect();
      showTip(p, e.clientX - fr.left, e.clientY - fr.top);
    } else hideTip();
  });

  svg.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") {
      hover = null;
      if (!cursor) renderHover();
      hideTip();
    }
  });

  function endDrag() {
    frame.classList.remove("dragging");
  }

  svg.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id) return;
    endDrag();
    if (d.moved) return;
    if (d.type === "touch" || d.type === "pen") {
      const quick = performance.now() - d.t < 500;
      if (!quick || window.scrollY !== d.scrollY) return;
      handleTap(e);
    } else {
      handleClick(e);
    }
  });

  svg.addEventListener("pointercancel", () => {
    down = null;
    endDrag();
  });
  svg.addEventListener("lostpointercapture", () => endDrag());

  function handleClick(e) {
    const p = hitAt(e);
    if (!p) return;
    if (!p.rec) {
      onNoData?.(p.name);
      showNote(`No data for ${p.name}`);
      return;
    }
    onSelect(p.iso3, "map");
  }

  function handleTap(e) {
    const { P, list, x, y } = tapCandidates(e);
    if (list.length === 0) {
      if (P && !P.rec) {
        onNoData?.(P.name);
        showNote(`No data for ${P.name}`);
      }
      return;
    }
    if (list.length === 1) {
      onSelect(list[0].iso3, "map");
      return;
    }
    const fr = frame.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    openChooser(list, x * (sr.width / W) + (sr.left - fr.left), y * (sr.height / H) + (sr.top - fr.top));
  }

  // ------------------------------------------------------------ keyboard
  svg.addEventListener("focus", () => {
    // Only keyboard focus shows the cursor; a click or tap focuses the map without a tooltip.
    if (!svg.matches(":focus-visible")) return;
    frame.classList.add("focus-ring");
    cursor = selected && places.get(selected)?.rec ? selected : firstRanked?.() ?? null;
    showCursor(false);
  });
  svg.addEventListener("blur", () => {
    frame.classList.remove("focus-ring");
    cursor = null;
    renderHover();
    hideTip(0);
  });

  function showCursor(announceIt = true) {
    renderHover();
    const p = places.get(cursor);
    if (!p?.rec) return;
    if (view === "globe" && D3.geoDistance(p.lonlat, center()) > (60 * Math.PI) / 180) turnTo(p.lonlat, 300);
    const xy = screenPos(p) ?? proj(p.lonlat);
    if (xy) {
      const sr = svg.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      showTip(p, xy[0] * (sr.width / W) + (sr.left - fr.left), xy[1] * (sr.height / H) + (sr.top - fr.top), true);
    }
    if (announceIt) cursorStatus.textContent = cursorAnnouncement(p.rec);
  }

  svg.addEventListener("keydown", (e) => {
    const dirs = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (dirs[e.key]) {
      e.preventDefault();
      if (!cursor) {
        cursor = selected;
        frame.classList.add("focus-ring");
      }
      const from = refPoints.find((r) => r.iso3 === cursor) ?? refPoints[0];
      const next = nearestInDirection(refPoints, from, dirs[e.key]);
      if (next) {
        cursor = next.iso3;
        showCursor(true);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (cursor && places.get(cursor)?.rec) onSelect(cursor, "keyboard-map");
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = firstRanked?.();
      if (first) {
        cursor = first;
        showCursor(true);
      }
    } else if (e.key === "Escape") {
      if (chooserOpen) closeChooser(true);
      else onEscape?.();
    }
  });

  // ------------------------------------------------------------ globe turning
  function setCenter(lonlat) {
    rotation = [-lonlat[0], -lonlat[1]];
  }

  function turnTo(lonlat, ms = 750) {
    cancelAnimationFrame(turnRaf);
    const target = [lonlat[0], clamp(lonlat[1], -45, 45)];
    if (media.reduced() || ms <= 0) {
      setCenter(target);
      render();
      return;
    }
    const interp = D3.geoInterpolate(center(), target);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      setCenter(interp(easeInOutCubic(t)));
      render();
      if (t < 1) turnRaf = requestAnimationFrame(step);
    };
    turnRaf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ public API
  function setSelected(iso3, { animate = true } = {}) {
    const changed = iso3 !== selected;
    selected = iso3;
    applyIsolation();
    const p = places.get(iso3);
    if (view === "globe" && p && changed) {
      if (animate) turnTo(p.lonlat, 750);
      else {
        setCenter([p.lonlat[0], clamp(p.lonlat[1], -45, 45)]);
        render();
      }
    } else {
      renderSelection();
    }
    if (changed && animate) {
      // Pulse after the globe settles its first frame so the ring is in place.
      requestAnimationFrame(() => pulse());
    }
  }

  function setColorMode(mode) {
    colorMode = mode;
    applyColors();
    if (!tooltip.hidden) {
      const p = places.get(cursor ?? hover);
      if (p) tipContent(p, cursor != null);
    }
  }

  function setView(v) {
    if (v === view) return;
    view = v;
    closeChooser(false);
    tooltip.hidden = true;
    if (view === "globe") {
      const p = places.get(selected);
      if (p) setCenter([p.lonlat[0], clamp(p.lonlat[1], -45, 45)]);
    }
    layout();
    if (!media.reduced()) {
      svg.classList.remove("fade-in");
      void svg.getBoundingClientRect();
      svg.classList.add("fade-in");
    }
  }

  function setIsolate(key) {
    isolate = key;
    applyIsolation();
  }

  let lastWidth = 0;
  const ro = new ResizeObserver(
    (() => {
      let t = 0;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const w = Math.round(frame.parentElement.getBoundingClientRect().width);
          if (w !== lastWidth) {
            lastWidth = w;
            closeChooser(false);
            layout();
          }
        }, 100);
      };
    })(),
  );
  ro.observe(frame.parentElement);
  window.addEventListener(
    "resize",
    (() => {
      let t = 0;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => view === "globe" && layout(), 150);
      };
    })(),
  );

  return {
    setTopology,
    setRecords,
    setSelected,
    setColorMode,
    setView,
    setIsolate,
    closeChooser,
    get view() {
      return view;
    },
    get chooserOpen() {
      return chooserOpen;
    },
    hasPlace: (iso3) => places.has(iso3),
    noDataCount: () => [...places.values()].filter((p) => !p.rec).length,
  };
}

// Non-interactive flat map for the social card (og.html).
export function drawStaticMap(svg, topology, points, records, width, mode = "risk") {
  const D3 = d3();
  const { places, featureCollection } = buildPlaces(topology, points, records);
  const proj = D3.geoEqualEarth().fitWidth(width, featureCollection);
  const path = D3.geoPath(proj);
  const H = Math.ceil(path.bounds(featureCollection)[1][1] + 1);
  svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", H);
  const land = s("g", { class: "land" });
  const dots = s("g", { class: "dots" });
  for (const p of places.values()) {
    const fill = p.rec ? colorFor(p.rec, mode) ?? "#1A1F2A" : "#1A1F2A";
    if (p.kind === "poly") {
      land.append(s("path", { d: path(p.feature) ?? "", fill }));
      if (path.area(p.feature) < DOT_AREA * 2) {
        const xy = proj(p.lonlat);
        dots.append(s("circle", { cx: xy[0], cy: xy[1], r: 3.5, fill }));
      }
    } else {
      const xy = proj(p.lonlat);
      if (xy) dots.append(s("circle", { cx: xy[0], cy: xy[1], r: 3.5, fill }));
    }
  }
  svg.append(land, dots);
  return H;
}
