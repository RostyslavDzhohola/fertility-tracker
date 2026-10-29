// Share a picture: what is on screen (the globe as you left it, or the country's chart) with the numbers beside it,
// 1600×900 so X shows it whole. X's post link can't carry a picture, so on computers "Post on X" copies the picture
// first (paste it into the post) and opens the post with the text and link; phones get the system share sheet, which
// includes the X app. Copy and Download work everywhere. The picture follows the page's day or night colors.

import { h, announce, focusNoScroll, media } from "./dom.js";
import * as L from "./logic.js";

export const SNAP_W = 1600;
export const SNAP_H = 900;
const LEFT = 900; // the picture; the numbers take the rest
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// The same figure as the page's people rows (style.css --person), in a 20×32 box.
const PERSON = typeof Path2D === "function" ? new Path2D("M4.7 5.8a5.3 5.3 0 1 0 10.6 0a5.3 5.3 0 1 0 -10.6 0z M2.4 32V19.6a7.6 7.6 0 0 1 15.2 0V32z") : null;

function theme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    paper: v("--paper", "#f6f4ef"),
    card: v("--card", "#ffffff"),
    ink: v("--ink", "#1f2328"),
    ink2: v("--ink-2", "#3d4651"),
    muted: v("--muted", "#5b6470"),
    line: v("--line", "#e6e1d8"),
    alive: v("--alive", "#2e3a47"),
    gone: v("--gone", "#dcd7cf"),
    grow: v("--grow", "#2c9690"),
    accent: v("--accent", "#2457ff"),
    accentText: v("--accent-text", "#2457ff"),
    down: v("--down-ink", "#a8382c"),
    up: v("--up-ink", "#126a63"),
    globeBg: v("--globe-bg", "#fbfaf7"),
    medium: v("--chart-medium", "#4f6b84"),
    constant: v("--chart-constant", "#c8693a"),
    legendBg: v("--legend-bg", "rgba(255,255,255,0.86)"),
  };
}

const font = (weight, size) => `${weight} ${size}px ${FONT}`;

function roundRect(g, x, y, w, hgt, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, hgt, r);
  else g.rect(x, y, w, hgt);
}

// Largest size (down to min) at which the text fits on one line.
function fitSize(g, text, weight, size, maxW, min) {
  for (let s = size; s > min; s -= 2) {
    g.font = font(weight, s);
    if (g.measureText(text).width <= maxW) return s;
  }
  return min;
}

function wrapLines(g, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (line && g.measureText(t).width > maxW) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function lum(css) {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// One figure, `f` of it alive (filled from the feet up, like the page), the rest gone.
function person(g, x, y, s, f, alive, gone) {
  if (!PERSON) return;
  g.save();
  g.translate(x, y);
  g.scale(s / 20, s / 20);
  g.fillStyle = gone;
  g.fill(PERSON);
  if (f > 0) {
    g.beginPath();
    g.rect(0, 32 * (1 - f), 20, 32 * f);
    g.clip();
    g.fillStyle = alive;
    g.fill(PERSON);
  }
  g.restore();
}

// ---------------------------------------------------------------- the picture's left half

// The globe as drawn on screen. `crop` is a rectangle of the canvas in CSS pixels; parts outside the canvas stay
// background. The legend goes along the bottom.
export function globeVisual(canvas, crop) {
  return (g, box, t) => {
    const bg = g.createRadialGradient(box.x + box.w / 2, box.y + box.h * 0.45, 0, box.x + box.w / 2, box.y + box.h * 0.45, box.w * 0.75);
    bg.addColorStop(0, t.globeBg);
    bg.addColorStop(1, t.paper);
    g.fillStyle = bg;
    g.fillRect(box.x, box.y, box.w, box.h);
    const cw = canvas.clientWidth || canvas.width;
    const ch = canvas.clientHeight || canvas.height;
    const px = canvas.width / cw;
    const scale = Math.min(box.w / crop.w, box.h / crop.h);
    const ox = box.x + (box.w - crop.w * scale) / 2;
    const oy = box.y + (box.h - crop.h * scale) / 2;
    const x0 = Math.max(0, crop.x);
    const y0 = Math.max(0, crop.y);
    const x1 = Math.min(cw, crop.x + crop.w);
    const y1 = Math.min(ch, crop.y + crop.h);
    if (x1 > x0 && y1 > y0) {
      g.imageSmoothingQuality = "high";
      g.drawImage(canvas, x0 * px, y0 * px, (x1 - x0) * px, (y1 - y0) * px, ox + (x0 - crop.x) * scale, oy + (y0 - crop.y) * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    }
    legend(g, box, t);
  };
}

function legend(g, box, t) {
  const items = L.OUTLOOK.map((o, i) => ({ label: o.label, color: L.outlookColor(i) }));
  g.font = font(650, 19);
  const sw = 26;
  const widths = items.map((it) => sw + 8 + g.measureText(it.label).width);
  const gap = 18;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1) + 36;
  const x = box.x + (box.w - total) / 2;
  const y = box.y + box.h - 72;
  g.fillStyle = t.legendBg;
  roundRect(g, x, y, total, 46, 23);
  g.fill();
  let cx = x + 18;
  g.textBaseline = "middle";
  items.forEach((it, i) => {
    g.fillStyle = it.color;
    roundRect(g, cx, y + 17, sw, 12, 4);
    g.fill();
    g.fillStyle = t.ink2;
    g.textAlign = "left";
    g.fillText(it.label, cx + sw + 8, y + 23);
    cx += widths[i] + gap;
  });
  g.textBaseline = "alphabetic";
}

// The country's population line, 1950–2100: the past, both futures (the chosen one strong), and the slider year.
// model: { past, medium, constant, today } as the page's chart gets them ([year, people] pairs).
export function chartVisual(model, { year, scenario, name }) {
  return (g, box, t) => {
    g.fillStyle = t.paper;
    g.fillRect(box.x, box.y, box.w, box.h);
    const padL = 92;
    const padR = 230;
    const top = 170;
    const bottom = box.h - 120;
    g.fillStyle = t.ink;
    g.textAlign = "left";
    const title = `People in ${name}, 1950–2100`;
    g.font = font(750, fitSize(g, title, 750, 38, box.w - 120, 24));
    g.fillText(title, box.x + 60, box.y + 96);
    const all = [...model.past, ...model.medium, ...model.constant].map((p) => p[1]).filter((v) => Number.isFinite(v));
    if (!all.length) return;
    const max = Math.max(...all);
    const { div, unit } = L.axisUnit(max);
    const ticks = L.niceTicks(0, max / div, 4);
    const top1 = ticks[ticks.length - 1] * div;
    const X = (yr) => box.x + padL + ((yr - 1950) / 150) * (box.w - padL - padR);
    const Y = (v) => bottom - (v / top1) * (bottom - top);
    // Grid and axis labels.
    g.font = font(600, 18);
    g.strokeStyle = t.line;
    g.lineWidth = 1.5;
    g.fillStyle = t.muted;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const tk of ticks) {
      const y = Y(tk * div);
      g.beginPath();
      g.moveTo(box.x + padL, y);
      g.lineTo(box.x + box.w - padR + 20, y);
      g.stroke();
      g.fillText(String(tk), box.x + padL - 14, y);
    }
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(unit, box.x + 20, top - 26);
    g.textAlign = "center";
    for (const yr of [1950, 2000, 2050, 2100]) g.fillText(String(yr), X(yr), bottom + 36);
    // Today.
    g.setLineDash([6, 6]);
    g.strokeStyle = t.muted;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(X(model.today), top - 10);
    g.lineTo(X(model.today), bottom);
    g.stroke();
    g.setLineDash([]);
    g.fillText("today", X(model.today), top - 18);
    const line = (pts, color, width, alpha = 1) => {
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = "round";
      g.lineCap = "round";
      g.beginPath();
      let pen = false;
      for (const [yr, v] of pts) {
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        if (pen) g.lineTo(X(yr), Y(v));
        else g.moveTo(X(yr), Y(v));
        pen = true;
      }
      g.stroke();
      g.globalAlpha = 1;
    };
    const fut = (pts) => pts.filter((p) => p[0] >= model.today);
    const chosen = scenario === "constant" ? "constant" : "medium";
    const other = chosen === "medium" ? "constant" : "medium";
    const colors = { medium: t.medium, constant: t.constant };
    line(fut(model[other]), colors[other], 4, 0.45);
    line(model.past, t.ink, 5);
    line(fut(model[chosen]), colors[chosen], 6);
    // End labels: the chosen future on top if they would collide.
    g.font = font(700, 18);
    g.textAlign = "left";
    g.textBaseline = "middle";
    const ends = ["medium", "constant"].map((sc) => ({ sc, v: model[sc][model[sc].length - 1]?.[1] })).filter((e) => Number.isFinite(e.v));
    const ys = ends.map((e) => Y(e.v));
    if (ys.length === 2 && Math.abs(ys[0] - ys[1]) < 44) {
      const mid = (ys[0] + ys[1]) / 2;
      const up = ys[0] <= ys[1] ? 0 : 1;
      ys[up] = mid - 22;
      ys[1 - up] = mid + 22;
    }
    ends.forEach((e, i) => {
      g.globalAlpha = e.sc === chosen ? 1 : 0.7;
      g.fillStyle = colors[e.sc];
      g.fillText(L.SCENARIO_SHORT[e.sc], X(2100) + 16, ys[i] - 10);
      g.fillStyle = t.ink2;
      g.fillText(L.fmtCompact(e.v), X(2100) + 16, ys[i] + 12);
      g.globalAlpha = 1;
    });
    // The slider year.
    const pts = model[chosen];
    const hit = pts.find((p) => p[0] === year) ?? model.past.find((p) => p[0] === year);
    if (hit && Number.isFinite(hit[1])) {
      const x = X(year);
      const y = Y(hit[1]);
      g.strokeStyle = t.accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, top - 4);
      g.lineTo(x, bottom);
      g.stroke();
      g.fillStyle = t.accent;
      g.beginPath();
      g.arc(x, y, 11, 0, 2 * Math.PI);
      g.fill();
      g.strokeStyle = t.card;
      g.lineWidth = 4;
      g.stroke();
    }
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
  };
}

// ---------------------------------------------------------------- the whole picture

// m: { rec, year, today, scenario, pop, pct, ratio, outlookPct (2100 vs today), url, visual(g, box, theme) }
export async function renderSnapshot(m) {
  const c = document.createElement("canvas");
  c.width = SNAP_W;
  c.height = SNAP_H;
  const g = c.getContext("2d");
  const t = theme();
  g.fillStyle = t.paper;
  g.fillRect(0, 0, SNAP_W, SNAP_H);
  await m.visual(g, { x: 0, y: 0, w: LEFT, h: SNAP_H }, t);

  // The numbers.
  g.fillStyle = t.card;
  g.fillRect(LEFT, 0, SNAP_W - LEFT, SNAP_H);
  const x = LEFT + 64;
  const maxW = SNAP_W - LEFT - 128;
  let y = 88;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  // Brand.
  g.fillStyle = t.accent;
  g.beginPath();
  g.arc(x + 12, y - 9, 12, 0, 2 * Math.PI);
  g.fill();
  g.fillStyle = t.ink2;
  g.font = font(750, 26);
  g.fillText("Fertility Tracker", x + 36, y);
  y += 70;
  // Region and name.
  const rec = m.rec;
  const region = rec.iso3 === "WLD" ? "Whole world" : rec.region ?? "";
  if (region) {
    g.fillStyle = t.muted;
    g.font = font(750, 20);
    if ("letterSpacing" in g) g.letterSpacing = "2px";
    g.fillText(region.toUpperCase(), x, y);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    y += 64;
  }
  const name = L.displayName(rec);
  g.fillStyle = t.ink;
  let size = fitSize(g, name, 800, 72, maxW, 46);
  g.font = font(800, size);
  let lines = [name];
  if (g.measureText(name).width > maxW) {
    size = 46;
    g.font = font(800, size);
    lines = wrapLines(g, name, maxW).slice(0, 2);
  }
  lines.forEach((ln, i) => {
    if (i) y += size * 1.08;
    g.fillText(ln, x, y);
  });
  y += 30;
  // Outlook word, on its own color.
  const step = L.outlookStep(m.outlookPct);
  if (step >= 0 && !(rec.iso3 !== "WLD" && L.isSmallPlace(rec))) {
    const word = `By 2100${m.scenario === "constant" ? ", if rates stay" : ""}: ${L.OUTLOOK[step].label}`;
    g.font = font(750, 24);
    const w = g.measureText(word).width + 40;
    const color = L.outlookColor(step);
    g.fillStyle = color;
    roundRect(g, x, y, w, 50, 25);
    g.fill();
    g.fillStyle = lum(color) > 0.55 ? "#1f2328" : "#ffffff";
    g.fillText(word, x + 20, y + 34);
    y += 50;
  }
  y += 140;
  // The big number for the slider year.
  const sp = L.splitWords(m.pop);
  g.fillStyle = t.ink;
  g.font = font(800, 128);
  g.fillText(sp.num, x - 4, y);
  const nw = g.measureText(sp.num).width;
  g.font = font(750, 42);
  g.fillText(sp.unit || "people", x + nw + 12, y);
  y += 54;
  const when = m.year === m.today ? "today" : `in ${m.year}`;
  g.font = font(600, 32);
  g.fillStyle = t.ink2;
  g.fillText(when, x, y);
  if (m.year !== m.today && Number.isFinite(m.pct)) {
    const ww = g.measureText(when).width;
    g.font = font(800, 32);
    g.fillStyle = m.pct < -0.5 ? t.down : m.pct > 0.5 ? t.up : t.ink2;
    g.fillText(`${L.fmtPct(m.pct)} vs today`, x + ww + 16, y);
  }
  y += 36;
  // Ten people, graying out as they go; more figures in green when it grows.
  if (Number.isFinite(m.ratio)) {
    const n = Math.min(20, Math.max(10, Math.ceil(m.ratio * 10 - 1e-9)));
    const s = n > 10 ? Math.min(34, (maxW - (n - 1) * 8) / n) : 40;
    const gap = n > 10 ? 8 : 15;
    for (let i = 0; i < n; i++) {
      const f = Math.max(0, Math.min(1, m.ratio * 10 - i));
      person(g, x + i * (s + gap), y, s, f, i < 10 ? t.alive : t.grow, t.gone);
    }
    y += s * 1.6 + 40;
    g.fillStyle = t.muted;
    g.font = font(600, 24);
    g.fillText(L.peopleCaption(m.ratio, m.year, m.today), x, y);
    y += 50;
  }
  // Babies per woman.
  const why = L.tfrReason(rec);
  if (why && y < SNAP_H - 170) {
    g.fillStyle = t.ink2;
    g.font = font(550, 24);
    for (const ln of wrapLines(g, why, maxW).slice(0, 2)) {
      g.fillText(ln, x, y);
      y += 32;
    }
  }
  // Footer: which future, the link, the source.
  g.fillStyle = t.muted;
  g.font = font(650, 20);
  g.fillText(`${L.SCENARIO_LABELS[m.scenario] ?? L.SCENARIO_LABELS.medium} · UN World Population Prospects 2024`, x, SNAP_H - 92);
  g.fillStyle = t.accentText;
  const link = String(m.url).replace(/^https?:\/\//, "");
  g.font = font(750, fitSize(g, link, 750, 26, maxW, 16));
  g.fillText(link, x, SNAP_H - 52);

  return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}

// ---------------------------------------------------------------- the share dialog

let dlg = null;
let state = null; // { blob, file, url, text, fileName, objectUrl }

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

function canShareFiles(file) {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

function ensureDialog() {
  if (dlg) return dlg;
  const el = {};
  el.img = h("img", { class: "snap-img", id: "snap-img", alt: "" });
  el.loading = h("p", { class: "snap-loading" }, "Making the picture…");
  el.x = h("button", { type: "button", class: "btn btn-primary", id: "snap-x" }, "Post on X");
  el.share = h("button", { type: "button", class: "btn btn-secondary", id: "snap-share", hidden: true }, "Share…");
  el.copy = h("button", { type: "button", class: "btn btn-secondary", id: "snap-copy" }, "Copy picture");
  el.download = h("a", { class: "btn btn-secondary", id: "snap-download", href: "#" }, "Download");
  el.hint = h("p", { class: "snap-hint", id: "snap-hint" });
  el.status = h("p", { class: "snap-status", id: "snap-status", role: "status", "aria-live": "polite" });
  el.close = h(
    "button",
    { type: "button", class: "icon-btn snap-close", id: "snap-close", "aria-label": "Close" },
    h("span", { "aria-hidden": "true" }, "✕"),
  );
  el.root = h(
    "dialog",
    { class: "snap", id: "snap", "aria-labelledby": "snap-title" },
    h("div", { class: "snap-head" }, h("h2", { id: "snap-title" }, "Share this picture"), el.close),
    h("div", { class: "snap-frame" }, el.loading, el.img),
    h("div", { class: "snap-actions" }, el.share, el.x, el.copy, el.download),
    el.hint,
    el.status,
  );
  document.body.append(el.root);

  el.close.addEventListener("click", () => el.root.close());
  // A click on the dim backdrop closes it.
  el.root.addEventListener("click", (e) => {
    if (e.target === el.root) {
      const r = el.root.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) el.root.close();
    }
  });
  el.root.addEventListener("close", () => {
    if (state?.objectUrl) URL.revokeObjectURL(state.objectUrl);
    const back = state?.returnFocus;
    state = null;
    el.img.removeAttribute("src");
    if (back) focusNoScroll(back);
  });

  const say = (msg) => {
    el.status.textContent = msg;
    announce(msg);
  };
  const copyPicture = async () => {
    if (!state?.blob || !navigator.clipboard?.write || typeof ClipboardItem !== "function") return false;
    try {
      await Promise.race([navigator.clipboard.write([new ClipboardItem({ "image/png": state.blob })]), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))]);
      return true;
    } catch {
      return false;
    }
  };
  const download = () => {
    if (!state) return;
    const a = h("a", { href: state.objectUrl, download: state.fileName });
    document.body.append(a);
    a.click();
    a.remove();
  };
  const paste = () => (isMac() ? "⌘V" : "Ctrl+V");

  el.x.addEventListener("click", async () => {
    if (!state) return;
    const intent = `https://x.com/intent/post?text=${encodeURIComponent(state.text)}&url=${encodeURIComponent(state.url)}`;
    // Copy before X opens: the clipboard only takes a picture while this tab has focus.
    const copied = await copyPicture();
    if (!copied) download();
    window.open(intent, "_blank", "noopener");
    say(copied ? `Picture copied. In the X post, press ${paste()} to add it.` : "Picture downloaded. In the X post, add it with the picture button.");
  });
  el.share.addEventListener("click", async () => {
    if (!state) return;
    try {
      await navigator.share({ files: [state.file], text: `${state.text} ${state.url}` });
    } catch (err) {
      if (err?.name !== "AbortError") say("Couldn't open sharing. Use Download instead.");
    }
  });
  el.copy.addEventListener("click", async () => {
    const ok = await copyPicture();
    say(ok ? `Picture copied. Paste it anywhere with ${paste()}.` : "Couldn't copy the picture here. Use Download instead.");
  });
  el.download.addEventListener("click", (e) => {
    if (!state) return e.preventDefault();
    say("Picture saved to your downloads.");
  });

  dlg = el;
  return el;
}

// opts: { make: () => Promise<Blob>, text, url, fileName, alt }
export async function openShare(opts) {
  const el = ensureDialog();
  if (el.root.open) el.root.close();
  const token = {};
  state = { token, url: opts.url, text: opts.text, fileName: opts.fileName, returnFocus: document.activeElement };
  el.status.textContent = "";
  el.loading.hidden = false;
  el.img.hidden = true;
  for (const b of [el.x, el.share, el.copy]) b.disabled = true;
  el.download.setAttribute("aria-disabled", "true");
  el.root.showModal();
  focusNoScroll(el.close);
  let blob;
  try {
    blob = await opts.make();
  } catch {
    if (state?.token === token) el.loading.textContent = "Couldn't make the picture. Try again.";
    return;
  }
  if (state?.token !== token) return; // closed or reopened meanwhile
  const file = new File([blob], opts.fileName, { type: "image/png" });
  state.blob = blob;
  state.file = file;
  state.objectUrl = URL.createObjectURL(blob);
  el.img.src = state.objectUrl;
  el.img.alt = opts.alt ?? "";
  el.img.hidden = false;
  el.loading.hidden = true;
  el.download.href = state.objectUrl;
  el.download.setAttribute("download", opts.fileName);
  el.download.removeAttribute("aria-disabled");
  const phoneShare = canShareFiles(file) && media.coarse();
  el.share.hidden = !canShareFiles(file);
  el.share.textContent = phoneShare ? "Share to X or any app" : "Share…";
  el.share.classList.toggle("btn-primary", phoneShare);
  el.share.classList.toggle("btn-secondary", !phoneShare);
  el.x.classList.toggle("btn-primary", !phoneShare);
  el.x.classList.toggle("btn-secondary", phoneShare);
  for (const b of [el.x, el.share, el.copy]) b.disabled = false;
  el.hint.textContent = phoneShare
    ? "Share sends the picture with the link. Pick X in the list."
    : `Post on X copies the picture and opens the post: press ${isMac() ? "⌘V" : "Ctrl+V"} there to add it.`;
  focusNoScroll(phoneShare ? el.share : el.x);
}

export const shareOpen = () => !!dlg?.root.open;
