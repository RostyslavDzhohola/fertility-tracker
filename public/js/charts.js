// The country page's population chart, 1950–2100 (DESIGN-v3 §3 block 3): past as a solid line, the two futures labelled
// at their ends, the peak annotated, and a marker that follows the shared year. Press and drag
// (or tap) moves the year; a pointer just passing over it does nothing, so a resting mouse can't stop Play.
// Plain SVG; viewBox in CSS pixels, re-rendered on resize.

import { s } from "./dom.js";
import { niceTicks, axisUnit, fmtCompact, fmtWords, spreadLabels, SCENARIO_LABELS, SCENARIO_SHORT } from "./logic.js";

const Y0 = 1950;
const Y1 = 2100;

function pathFrom(points, x, y) {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p || p[1] == null || !Number.isFinite(p[1])) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function valueAt(points, year) {
  if (!points?.length) return null;
  if (year <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [y1, v1] = points[i];
    if (year <= y1) {
      const [y0, v0] = points[i - 1];
      if (v0 == null || v1 == null) return v0 ?? v1;
      return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0 || 1);
    }
  }
  return points[points.length - 1][1];
}

// opts: { onScrub(year) }: any year 1950–2100.
export function createPopChart(container, { onScrub } = {}) {
  let model = null; // { past, medium, constant, today, peak, name }
  let geo = null;
  let svg = null;
  let marker = null;
  let dragging = null; // the pointer pressed on the chart
  let lastYear = null;
  let lastMix = 0;

  function width() {
    return Math.max(280, Math.round(container.getBoundingClientRect().width || 320));
  }

  function render() {
    if (!model) return;
    const W = width();
    const narrow = W < 560;
    const H = narrow ? 300 : 380;
    const m = { top: 34, right: narrow ? 96 : 150, bottom: 34, left: narrow ? 34 : 44 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;
    const all = [...model.past, ...model.medium, ...model.constant].map((p) => p[1]).filter((v) => v != null);
    const maxV = Math.max(...all, 1);
    const unit = axisUnit(maxV);
    const ticks = niceTicks(0, maxV / unit.div, 4).map((t) => t * unit.div);
    const top = ticks[ticks.length - 1] || maxV;
    const x = (yr) => m.left + ((yr - Y0) / (Y1 - Y0)) * iw;
    const y = (v) => m.top + ih - (v / top) * ih;
    geo = { W, H, m, iw, ih, x, y, top, unit, narrow };

    svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart-svg", role: "img", "aria-label": ariaLabel() });
    // Forecast zone.
    const tx = x(model.today);
    svg.append(s("rect", { class: "zone", x: tx, y: m.top - 8, width: x(Y1) - tx, height: ih + 8 }));
    svg.append(s("text", { class: "zone-label", x: tx + 8, y: m.top + ih - 8 }, "Forecast"));
    // Grid and y ticks.
    const grid = s("g", { class: "grid" });
    ticks.forEach((t, i) => {
      const yy = Math.round(y(t)) + 0.5;
      grid.append(s("line", { x1: m.left, x2: m.left + iw, y1: yy, y2: yy }));
      const lab = t === 0 ? "0" : i === ticks.length - 1 ? `${trim(t / unit.div)} ${unit.unit}` : trim(t / unit.div);
      grid.append(s("text", { class: "tick y", x: m.left - 8, y: yy + 4, "text-anchor": "end" }, lab));
    });
    // The top tick's unit runs to the right of the axis so it never clips.
    const lastTick = grid.lastChild;
    if (lastTick) {
      lastTick.setAttribute("x", m.left);
      lastTick.setAttribute("y", Math.round(y(top)) - 8);
      lastTick.setAttribute("text-anchor", "start");
      lastTick.classList.add("unit");
    }
    svg.append(grid);
    // X ticks.
    const xt = s("g", { class: "xaxis" });
    for (const yr of narrow ? [1950, model.today, 2100] : [1950, 2000, model.today, 2050, 2100]) {
      const t = s("text", { class: `tick x${yr === model.today ? " today" : ""}`, x: x(yr), y: H - 10, "text-anchor": yr === 1950 ? "start" : yr === 2100 ? "end" : "middle" }, yr === model.today ? "Today" : String(yr));
      xt.append(t);
    }
    svg.append(xt);

    // Lines.
    const lines = s("g", { class: "lines" });
    const pastPts = model.past.filter((p) => p[0] <= model.today);
    const join = valueAt(model.medium, model.today);
    if (join != null && pastPts.length && pastPts[pastPts.length - 1][0] < model.today) pastPts.push([model.today, join]);
    const futM = model.medium.filter((p) => p[0] >= model.today);
    const futC = model.constant.filter((p) => p[0] >= model.today);
    lines.append(s("path", { class: "line constant", d: pathFrom(futC, x, y), "data-s": "constant" }));
    lines.append(s("path", { class: "line medium", d: pathFrom(futM, x, y), "data-s": "medium" }));
    lines.append(s("path", { class: "line past", d: pathFrom(pastPts, x, y) }));
    svg.append(lines);

    // End labels (no legend lookup).
    const endM = futM[futM.length - 1];
    const endC = futC[futC.length - 1];
    const names = narrow ? SCENARIO_SHORT : SCENARIO_LABELS;
    const ends = [];
    if (endM) ends.push({ key: "medium", y: y(endM[1]), v: endM[1], name: names.medium });
    if (endC) ends.push({ key: "constant", y: y(endC[1]), v: endC[1], name: names.constant });
    const nLines = ends.map((e) => wrapWords(e.name, narrow ? 12 : 22).length);
    const ys = spreadLabels(
      ends.map((e) => e.y),
      Math.max(...nLines, 1) * 14 + 24,
      m.top,
      m.top + ih,
    );
    const lab = s("g", { class: "end-labels" });
    ends.forEach((e, i) => {
      const g = s("g", { class: `end ${e.key}`, transform: `translate(${x(Y1) + 10},${ys[i]})` });
      const words = wrapWords(e.name, narrow ? 12 : 22);
      words.forEach((w, j) => g.append(s("text", { class: "end-name", y: -4 + j * 14 - (words.length - 1) * 7 }, w)));
      g.append(s("text", { class: "end-val", y: 12 + (words.length - 1) * 7 }, fmtCompact(e.v)));
      lab.append(g);
    });
    svg.append(lab);

    // Year marker.
    marker = s("g", { class: "marker" });
    marker.append(
      s("line", { class: "m-line", y1: m.top - 8, y2: m.top + ih }),
      s("circle", { class: "m-dot other", r: 4 }),
      s("circle", { class: "m-dot main", r: 6 }),
      s("g", { class: "m-bubble" }, s("rect", { rx: 8, height: 26 }), s("text", { y: 17 })),
    );
    svg.append(marker);

    // Peak annotation, drawn over the year marker so the line never strikes through it.
    const pk = model.peak;
    if (pk && pk[0] > Y0 + 2 && pk[0] < Y1 - 2) {
      const px = x(pk[0]);
      const py = y(pk[1]);
      const g = s("g", { class: "peak" });
      g.append(s("circle", { cx: px, cy: py, r: 4.5 }));
      const left = px > m.left + iw * 0.6;
      g.append(s("text", { x: left ? px - 10 : px + 10, y: py - 10, "text-anchor": left ? "end" : "start" }, `Peak: ${fmtCompact(pk[1])} in ${pk[0]}`));
      svg.append(g);
    }

    const hit = s("rect", { class: "hit", x: m.left, y: 0, width: iw, height: H });
    svg.append(hit);
    hit.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = e.pointerId;
      try {
        hit.setPointerCapture(e.pointerId);
      } catch {}
      scrub(e);
    });
    hit.addEventListener("pointermove", (e) => {
      if (dragging === e.pointerId) scrub(e);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      hit.addEventListener(type, (e) => {
        if (dragging === e.pointerId) dragging = null;
      });

    container.replaceChildren(svg);
    lastYear = null;
    update(model.year ?? model.today, model.mix ?? 0, true);
  }

  function scrub(e) {
    if (!geo) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) * geo.W) / r.width;
    const yr = Math.round(Y0 + ((px - geo.m.left) / geo.iw) * (Y1 - Y0));
    onScrub?.(Math.max(Y0, Math.min(Y1, yr)));
  }

  function placeBubble(g, cx, cy, text) {
    const t = g.querySelector(".m-bubble text");
    const rect = g.querySelector(".m-bubble rect");
    t.textContent = text;
    const w = Math.ceil(text.length * 7.4) + 18;
    let bx = cx - w / 2;
    bx = Math.max(geo.m.left - 4, Math.min(geo.W - w - 2, bx));
    const by = Math.max(2, Math.min(cy - 40, geo.m.top - 34 + 2));
    rect.setAttribute("x", bx);
    rect.setAttribute("y", by);
    rect.setAttribute("width", w);
    t.setAttribute("x", bx + w / 2);
    t.setAttribute("y", by + 17);
    t.setAttribute("text-anchor", "middle");
  }

  function update(year, mix, force = false) {
    if (!geo || !marker) return;
    if (!force && year === lastYear && mix === lastMix) return;
    lastYear = year;
    lastMix = mix;
    const yr = Math.max(Y0, Math.min(Y1, year));
    // Before today there is one line (the UN's estimates and its path up to today), so one dot.
    const past = yr < model.today;
    const vm = past ? valueAt(model.past, yr) : valueAt(model.medium, yr);
    const vc = past ? vm : valueAt(model.constant, yr);
    const v = vm == null ? vc : vc == null ? vm : vm + (vc - vm) * mix;
    const vo = past ? null : mix < 0.5 ? vc : vm;
    const xx = geo.x(yr);
    const line = marker.querySelector(".m-line");
    line.setAttribute("x1", xx);
    line.setAttribute("x2", xx);
    const main = marker.querySelector(".m-dot.main");
    const other = marker.querySelector(".m-dot.other");
    if (v != null) {
      main.setAttribute("cx", xx);
      main.setAttribute("cy", geo.y(v));
    }
    other.setAttribute("visibility", vo == null ? "hidden" : "visible");
    if (vo != null) {
      other.setAttribute("cx", xx);
      other.setAttribute("cy", geo.y(vo));
    }
    placeBubble(marker, xx, v != null ? geo.y(v) : geo.m.top, `${Math.round(yr)}: ${fmtCompact(v)}`);
    svg.classList.toggle("constant", mix >= 0.5);
    for (const p of svg.querySelectorAll(".line[data-s]")) p.style.opacity = p.dataset.s === "medium" ? String(1 - 0.45 * mix) : String(0.55 + 0.45 * mix);
  }

  function ariaLabel() {
    const pk = model.peak;
    const last = model.medium[model.medium.length - 1];
    const lastC = model.constant[model.constant.length - 1];
    return `Population of ${model.name}, 1950 to 2100.${pk ? ` Peak ${fmtWords(pk[1])} in ${pk[0]}.` : ""}${last ? ` UN forecast for 2100: ${fmtWords(last[1])}.` : ""}${lastC ? ` If birth rates stay the same: ${fmtWords(lastC[1])}.` : ""}`;
  }

  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = width();
    if (w !== lastW) {
      lastW = w;
      render();
    }
  });
  ro.observe(container);

  return {
    setData(m) {
      model = m;
      lastW = width();
      render();
    },
    update(year, mix) {
      if (model) {
        model.year = year;
        model.mix = mix;
      }
      update(year, mix);
    },
  };
}

function trim(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function wrapWords(text, max) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

export { valueAt };
