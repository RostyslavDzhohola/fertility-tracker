// SVG charts for the country view (DESIGN §5.1, §5.5–5.7, §5.10). viewBox in CSS pixels; re-rendered on resize.

import { s, h, media } from "./dom.js";
import { niceTicks, fmtTick, spreadLabels } from "./logic.js";

const Y0 = 1950;
const Y1 = 2100;
const CHAR_W = 6.9; // 12px semibold label, average glyph width
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function labelWidth(text) {
  return Math.ceil(String(text).length * CHAR_W);
}

function pathFrom(points) {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p == null || p[1] == null || !Number.isFinite(p[1])) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

function containerWidth(container) {
  return Math.max(240, Math.round(container.getBoundingClientRect().width || container.clientWidth || 320));
}

function mount(container, svg, fade) {
  const keep = [...container.children].filter((c) => c.classList?.contains("chart-error"));
  container.replaceChildren(svg, ...keep.map((k) => ((k.hidden = true), k)));
  if (fade && !media.reduced()) svg.classList.add("fade-in");
}

// ------------------------------------------------------------------ skeleton, error, empty

export function chartSkeleton(container, height) {
  const W = containerWidth(container);
  const m = { top: 22, right: 8, bottom: 22 };
  const ih = height - m.top - m.bottom;
  const svg = s("svg", { viewBox: `0 0 ${W} ${height}`, width: W, height, "aria-hidden": "true" });
  const grid = s("g", { class: "grid" });
  for (let i = 0; i <= 4; i++) {
    const y = Math.round(m.top + (ih * i) / 4) + 0.5;
    grid.append(s("line", { x1: 0, x2: W - m.right, y1: y, y2: y }));
  }
  svg.append(grid);
  svg.append(
    s("rect", {
      class: `skeleton-band${media.reduced() ? "" : " shimmer"}`,
      x: 0,
      y: m.top + ih * 0.35,
      width: W - m.right,
      height: ih * 0.3,
      rx: 6,
    }),
  );
  mount(container, svg, false);
}

export function chartMessage(container, height, text) {
  const W = containerWidth(container);
  const svg = s("svg", { viewBox: `0 0 ${W} ${height}`, width: W, height, role: "img", "aria-label": text });
  const grid = s("g", { class: "grid" });
  grid.append(s("line", { x1: 0, x2: W, y1: height - 21.5, y2: height - 21.5 }));
  svg.append(grid, s("text", { x: W / 2, y: height / 2, "text-anchor": "middle", class: "annot-muted" }, text));
  mount(container, svg, false);
}

export function chartError(container, height, text, onRetry) {
  chartSkeleton(container, height);
  container.querySelector("svg .shimmer")?.classList.remove("shimmer");
  let box = [...container.children].find((c) => c.classList?.contains("chart-error"));
  if (!box) {
    box = h("div", { class: "chart-error", role: "status" });
    container.append(box);
  }
  box.replaceChildren(h("span", null, text), h("button", { type: "button", class: "btn btn-secondary btn-small", onclick: onRetry }, "Try again"));
  box.hidden = false;
}

// ------------------------------------------------------------------ line chart

// cfg: {
//   height, boundary (last estimate year), ariaLabel, yKind: "count" | "tfr" | "flow",
//   yDomain: [min, max] (optional), series: [{ key, label, color, width, values: [[year, v]], area, endLabel, crossLabel }],
//   fillBetween: { a, b, aboveColor, belowColor }, refLines: [{ v, label, dash }], annotations: [{ year, v, text, dot }],
//   startLabel: { year, v, text }, fmt: (v, key) => string, emphasizeZero
// }
export function lineChart(container, cfg) {
  const W = containerWidth(container);
  const H = cfg.height;
  const ends = cfg.series.filter((sr) => sr.endLabel).map((sr) => sr.endLabel);
  const right = Math.min(110, Math.max(cfg.minRight ?? 8, ...ends.map((t) => labelWidth(t) + 10)));
  const m = { top: 22, right, bottom: 22, left: 0 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  let lo = Infinity;
  let hi = -Infinity;
  for (const sr of cfg.series)
    for (const [, v] of sr.values)
      if (v != null && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  for (const r of cfg.refLines ?? []) {
    lo = Math.min(lo, r.v);
    hi = Math.max(hi, r.v);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (cfg.yDomain) {
    lo = cfg.yDomain[0] ?? lo;
    hi = cfg.yDomain[1] ?? hi;
  }
  if (cfg.zeroBased !== false) lo = Math.min(0, lo);
  const ticks = niceTicks(lo, hi, cfg.tickCount ?? 4);
  const y0 = Math.min(ticks[0], lo);
  const y1 = Math.max(ticks[ticks.length - 1], hi);

  const x = (yr) => m.left + ((yr - Y0) / (Y1 - Y0)) * iw;
  const y = (v) => m.top + (1 - (v - y0) / (y1 - y0 || 1)) * ih;
  const xb = x(cfg.boundary + 0.5);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": cfg.ariaLabel ?? "" });

  // projection zone + boundary + zone labels
  svg.append(s("rect", { class: "proj-zone", x: xb, y: m.top, width: Math.max(0, x(Y1) - xb), height: ih }));

  // grid + y ticks (labels inside the plot, above their gridline)
  const grid = s("g", { class: "grid" });
  const axis = s("g", { class: "axis" });
  const tickLabels = [];
  for (const t of ticks) {
    const yy = Math.round(y(t)) + 0.5;
    if (t === 0 && cfg.emphasizeZero) svg.append(s("line", { class: "zero-line", x1: m.left, x2: m.left + iw, y1: yy, y2: yy }));
    else grid.append(s("line", { x1: m.left, x2: m.left + iw, y1: yy, y2: yy }));
    tickLabels.push({ t, y: yy - 4 });
  }
  svg.prepend(grid);

  // x ticks
  const xt = W >= 560 ? [1950, 1975, 2000, 2025, 2050, 2075, 2100] : [1950, 2000, 2050, 2100];
  for (const yr of xt) {
    const anchor = yr === Y0 ? "start" : yr === Y1 ? "end" : "middle";
    axis.append(s("text", { x: x(yr), y: H - 6, "text-anchor": anchor }, String(yr)));
  }

  svg.append(s("line", { class: "boundary", x1: Math.round(xb) + 0.5, x2: Math.round(xb) + 0.5, y1: m.top - 4, y2: m.top + ih }));
  svg.append(s("text", { class: "zone-label", x: xb - 5, y: 13, "text-anchor": "end" }, "Recorded"));
  svg.append(s("text", { class: "zone-label", x: xb + 5, y: 13, "text-anchor": "start" }, "UN projection"));

  // fill between two series
  if (cfg.fillBetween) {
    const A = cfg.series.find((sr) => sr.key === cfg.fillBetween.a)?.values ?? [];
    const B = cfg.series.find((sr) => sr.key === cfg.fillBetween.b)?.values ?? [];
    const bMap = new Map(B);
    let up = "";
    let dn = "";
    for (let i = 0; i < A.length - 1; i++) {
      const [ya, a0] = A[i];
      const [yb, a1] = A[i + 1];
      const b0 = bMap.get(ya);
      const b1 = bMap.get(yb);
      if ([a0, a1, b0, b1].some((v) => v == null)) continue;
      const X0 = x(ya);
      const X1 = x(yb);
      const d0 = a0 - b0;
      const d1 = a1 - b1;
      const quad = (xa, ya1, xb1, yb1, xc, yc, xd, yd) =>
        `M${xa.toFixed(1)},${ya1.toFixed(1)}L${xb1.toFixed(1)},${yb1.toFixed(1)}L${xc.toFixed(1)},${yc.toFixed(1)}L${xd.toFixed(1)},${yd.toFixed(1)}Z`;
      if (d0 >= 0 && d1 >= 0) up += quad(X0, y(a0), X1, y(a1), X1, y(b1), X0, y(b0));
      else if (d0 <= 0 && d1 <= 0) dn += quad(X0, y(a0), X1, y(a1), X1, y(b1), X0, y(b0));
      else {
        const t = d0 / (d0 - d1);
        const xc = X0 + t * (X1 - X0);
        const yc = y(a0 + t * (a1 - a0));
        const tri = (pts) => `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}Z`;
        const first = tri([
          [X0, y(a0)],
          [xc, yc],
          [X0, y(b0)],
        ]);
        const second = tri([
          [xc, yc],
          [X1, y(a1)],
          [X1, y(b1)],
        ]);
        if (d0 > 0) {
          up += first;
          dn += second;
        } else {
          dn += first;
          up += second;
        }
      }
    }
    svg.append(s("path", { d: up, fill: cfg.fillBetween.aboveColor, stroke: "none" }));
    svg.append(s("path", { d: dn, fill: cfg.fillBetween.belowColor, stroke: "none" }));
  }

  // reference lines
  for (const r of cfg.refLines ?? []) {
    const yy = Math.round(y(r.v)) + 0.5;
    svg.append(s("line", { x1: m.left, x2: m.left + iw, y1: yy, y2: yy, stroke: "var(--text-muted)", "stroke-width": 1, "stroke-dasharray": r.dash ?? "2 4" }));
    if (r.label) svg.append(s("text", { class: "annot-muted", x: m.left + iw - 4, y: yy - 5, "text-anchor": "end" }, r.label));
  }

  // series (areas first, then lines; solid up to the boundary, dashed after)
  for (const sr of cfg.series) {
    if (!sr.area) continue;
    const pts = sr.values.filter(([, v]) => v != null);
    if (!pts.length) continue;
    const top = pts.map(([yr, v]) => `${x(yr).toFixed(1)},${y(v).toFixed(1)}`).join("L");
    const base = y(Math.max(y0, 0));
    svg.append(s("path", { d: `M${x(pts[0][0]).toFixed(1)},${base}L${top}L${x(pts[pts.length - 1][0]).toFixed(1)},${base}Z`, fill: sr.area }));
  }
  const lineG = s("g", { class: "lines" });
  for (const sr of cfg.series) {
    const rec = sr.values.filter(([yr]) => yr <= cfg.boundary).map(([yr, v]) => [x(yr), v == null ? null : y(v)]);
    const proj = sr.values.filter(([yr]) => yr >= cfg.boundary).map(([yr, v]) => [x(yr), v == null ? null : y(v)]);
    const common = { class: "line", stroke: sr.color, "stroke-width": sr.width ?? 2 };
    lineG.append(s("path", { ...common, d: pathFrom(rec) }));
    lineG.append(s("path", { ...common, d: pathFrom(proj), "stroke-dasharray": "5 4" }));
  }
  svg.append(lineG);

  // annotations
  for (const a of cfg.annotations ?? []) {
    if (a.v == null) continue;
    const ax = x(a.year);
    const ay = y(a.v);
    if (a.dot) svg.append(s("circle", { cx: ax, cy: ay, r: a.r ?? 3.5, fill: a.dotColor ?? "var(--text)", stroke: "var(--bg)", "stroke-width": 1.5 }));
    if (a.text) {
      const tw = labelWidth(a.text);
      let anchor = "middle";
      let tx = ax;
      if (ax - tw / 2 < m.left + 2) {
        anchor = "start";
        tx = Math.max(m.left + 2, ax - 6);
      } else if (ax + tw / 2 > m.left + iw - 2) {
        anchor = "end";
        tx = Math.min(m.left + iw - 2, ax + 6);
      }
      let ty = a.below ? ay + 18 : ay - 9;
      ty = clamp(ty, m.top + 10, m.top + ih - 4);
      svg.append(s("text", { class: "annot", x: tx, y: ty, "text-anchor": anchor }, a.text));
      a._box = { x0: anchor === "start" ? tx : anchor === "end" ? tx - tw : tx - tw / 2, y: ty };
    }
  }
  const start = cfg.startLabel;
  let startBox = null;
  if (start && start.v != null) {
    const sy = clamp(y(start.v) - 7, m.top + 10, m.top + ih - 4);
    svg.append(s("text", { class: "direct-label", x: x(start.year) + 2, y: sy, fill: start.color ?? "var(--text)" }, start.text));
    startBox = { x0: 0, x1: labelWidth(start.text) + 4, y: sy };
  }

  // y tick labels, skipping any that would collide with the start label
  for (const tl of tickLabels) {
    if (startBox && Math.abs(tl.y - startBox.y) < 14) continue;
    axis.append(s("text", { x: m.left + 2, y: tl.y }, fmtTick(tl.t, { kind: cfg.yKind === "tfr" ? "tfr" : "count" })));
  }
  svg.append(axis);

  // direct labels at the line ends, at least 14px apart
  const endItems = cfg.series.filter((sr) => sr.endLabel).map((sr) => {
    const last = [...sr.values].reverse().find(([, v]) => v != null);
    return { sr, y: last ? y(last[1]) + 4 : m.top + ih / 2 };
  });
  const ys = spreadLabels(
    endItems.map((e) => e.y),
    14,
    m.top + 8,
    m.top + ih + 4,
  );
  endItems.forEach((e, i) => {
    svg.append(s("text", { class: "direct-label", x: m.left + iw + 6, y: ys[i], fill: e.sr.labelColor ?? e.sr.color }, e.sr.endLabel));
  });

  // crosshair
  attachCrosshair(svg, { x, y, m, iw, ih, W, cfg });
  mount(container, svg, cfg.fade);
  return svg;
}

function attachCrosshair(svg, { x, y, m, iw, ih, W, cfg }) {
  const g = s("g", { class: "xh", visibility: "hidden", "pointer-events": "none" });
  const line = s("line", { class: "xh-line", y1: m.top, y2: m.top + ih });
  const dots = cfg.series.map((sr) => s("circle", { r: 3.5, fill: sr.color, stroke: "var(--bg)", "stroke-width": 1.5 }));
  const box = s("g", { class: "xh-box" });
  const rect = s("rect", { rx: 6, height: 22, y: 0 });
  const text = s("text", { y: 15 });
  box.append(rect, text);
  g.append(line, ...dots, box);
  svg.append(g);
  const overlay = s("rect", { x: m.left, y: 0, width: iw, height: m.top + ih, fill: "transparent", "pointer-events": "all" });
  svg.append(overlay);

  const maps = cfg.series.map((sr) => new Map(sr.values));
  let hideT = 0;

  function show(clientX) {
    clearTimeout(hideT);
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) * W) / (r.width || W);
    const yr = clamp(Math.round(Y0 + ((px - m.left) / iw) * (Y1 - Y0)), Y0, Y1);
    const xx = Math.round(x(yr)) + 0.5;
    line.setAttribute("x1", xx);
    line.setAttribute("x2", xx);
    text.replaceChildren(s("tspan", { "font-weight": "600" }, String(yr)));
    cfg.series.forEach((sr, i) => {
      const v = maps[i].get(yr);
      if (v == null) {
        dots[i].setAttribute("visibility", "hidden");
        return;
      }
      dots[i].setAttribute("visibility", "visible");
      dots[i].setAttribute("cx", xx);
      dots[i].setAttribute("cy", y(v));
      const label = cfg.fmt ? cfg.fmt(v, sr.key) : String(v);
      if (cfg.series.length > 1) text.append(s("tspan", { fill: sr.color, dx: 8 }, "●"), s("tspan", { dx: 3 }, label));
      else text.append(s("tspan", null, ` · ${label}`));
    });
    g.setAttribute("visibility", "visible");
    let tw = 80;
    try {
      tw = text.getComputedTextLength() + 16;
    } catch {}
    const bx = clamp(xx - tw / 2, 0, W - tw);
    rect.setAttribute("x", bx);
    rect.setAttribute("width", tw);
    text.setAttribute("x", bx + 8);
  }
  function hide(delay = 0) {
    clearTimeout(hideT);
    hideT = setTimeout(() => g.setAttribute("visibility", "hidden"), delay);
  }
  overlay.addEventListener("pointermove", (e) => show(e.clientX));
  overlay.addEventListener("pointerdown", (e) => show(e.clientX));
  overlay.addEventListener("pointerleave", () => hide());
  overlay.addEventListener("pointercancel", () => hide());
  overlay.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "mouse") hide(1500);
  });
}

// ------------------------------------------------------------------ waterfall (C5a)

const WF_COLORS = { births: "var(--c-births)", deaths: "var(--c-deaths)", migration: "var(--c-migration)", total: "var(--c-total)" };

export function waterfallChart(container, rows, { height = 168, fmtValue, fmtRate, ariaLabel, fade } = {}) {
  const W = containerWidth(container);
  const showRates = W >= 400 && !media.mobile();
  const labelCol = 108;
  const texts = rows.map((r) => fmtValue(r.value) + (showRates && r.rate != null ? ` · ${fmtRate(r.rate)} per 1,000` : ""));
  const R = Math.min(190, Math.max(...texts.map((t) => labelWidth(t))) + 12);
  const x0 = labelCol + 8;
  const x1 = W - R;
  let lo = 0;
  let hi = 0;
  for (const r of rows) {
    lo = Math.min(lo, r.from, r.to);
    hi = Math.max(hi, r.from, r.to);
  }
  if (hi === lo) hi = lo + 1;
  const x = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  const rowH = 36;
  const barH = 18;
  const top = 4;

  const svg = s("svg", { viewBox: `0 0 ${W} ${height}`, width: W, height, role: "img", "aria-label": ariaLabel ?? "" });
  const zx = Math.round(x(0)) + 0.5;
  svg.append(s("line", { class: "zero-line", x1: zx, x2: zx, y1: top - 2, y2: top + rows.length * rowH + 2 }));
  svg.append(s("text", { class: "annot-muted", x: zx, y: top + rows.length * rowH + 16, "text-anchor": "middle" }, "0"));

  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2;
    const a = x(Math.min(r.from, r.to));
    const b = x(Math.max(r.from, r.to));
    svg.append(s("text", { x: 0, y: cy + 4, fill: "var(--text)", "font-size": 13, "font-weight": r.key === "total" ? 650 : 400 }, r.label));
    svg.append(
      s("rect", {
        x: a,
        y: cy - barH / 2,
        width: Math.max(1, b - a),
        height: barH,
        rx: 2,
        fill: WF_COLORS[r.key],
        stroke: r.key === "total" ? "var(--border-strong)" : "none",
        "stroke-width": 1,
      }),
    );
    const t = s("text", { x: b + 6, y: cy + 4, class: "direct-label", fill: "var(--text)" }, s("tspan", null, fmtValue(r.value)));
    if (showRates && r.rate != null) t.append(s("tspan", { fill: "var(--text-muted)", "font-weight": 400 }, ` · ${fmtRate(r.rate)} per 1,000`));
    svg.append(t);
    if (i < rows.length - 1) {
      const nx = Math.round(x(r.to)) + 0.5;
      svg.append(
        s("line", { x1: nx, x2: nx, y1: cy + barH / 2, y2: cy + rowH - barH / 2, stroke: "var(--border-strong)", "stroke-width": 1 }),
      );
    }
  });
  mount(container, svg, fade);
  return svg;
}
