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
  // As big as fits: it has to read in a phone's X feed, where the picture is about a quarter of this size.
  let size = 26;
  let sw, gap, widths, total;
  for (; size >= 18; size -= 1) {
    g.font = font(700, size);
    sw = Math.round(size * 1.1);
    gap = Math.round(size * 0.7);
    widths = items.map((it) => sw + 8 + g.measureText(it.label).width);
    total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1) + 36;
    if (total <= box.w - 32) break;
  }
  const hgt = Math.round(size * 2.1);
  const x = box.x + (box.w - total) / 2;
  const y = box.y + box.h - hgt - 24;
  g.fillStyle = t.legendBg;
  roundRect(g, x, y, total, hgt, hgt / 2);
  g.fill();
  let cx = x + 18;
  g.textBaseline = "middle";
  items.forEach((it, i) => {
    g.fillStyle = it.color;
    roundRect(g, cx, y + hgt / 2 - size * 0.3, sw, size * 0.6, 4);
    g.fill();
    g.fillStyle = t.ink2;
    g.textAlign = "left";
    g.fillText(it.label, cx + sw + 8, y + hgt / 2 + 1);
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
    const padL = 100;
    const padR = 270;
    const top = 190;
    const bottom = box.h - 120;
    g.fillStyle = t.ink;
    g.textAlign = "left";
    const title = `People in ${name}, 1950–2100`;
    g.font = font(800, fitSize(g, title, 800, 44, box.w - 120, 28));
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
    g.font = font(650, 24);
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
    g.fillText(unit, box.x + 20, top - 34);
    g.textAlign = "center";
    for (const yr of [1950, 2000, 2050, 2100]) g.fillText(String(yr), X(yr), bottom + 42);
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
    g.font = font(750, 22);
    g.textAlign = "left";
    g.textBaseline = "middle";
    const ends = ["medium", "constant"].map((sc) => ({ sc, v: model[sc][model[sc].length - 1]?.[1] })).filter((e) => Number.isFinite(e.v));
    const ys = ends.map((e) => Y(e.v));
    if (ys.length === 2 && Math.abs(ys[0] - ys[1]) < 56) {
      const mid = (ys[0] + ys[1]) / 2;
      const up = ys[0] <= ys[1] ? 0 : 1;
      ys[up] = mid - 28;
      ys[1 - up] = mid + 28;
    }
    ends.forEach((e, i) => {
      g.globalAlpha = e.sc === chosen ? 1 : 0.7;
      g.fillStyle = colors[e.sc];
      g.fillText(L.SCENARIO_SHORT[e.sc], X(2100) + 16, ys[i] - 13);
      g.fillStyle = t.ink2;
      g.fillText(L.fmtCompact(e.v), X(2100) + 16, ys[i] + 14);
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
      // The year, on the line, so the blue marker says what it is.
      g.font = font(800, 26);
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      g.fillStyle = t.accentText;
      g.fillText(String(year), Math.min(x, box.x + box.w - padR + 10), top - 12);
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
    g.font = font(800, fitSize(g, word, 800, 30, maxW - 44, 22));
    const w = g.measureText(word).width + 44;
    const color = L.outlookColor(step);
    g.fillStyle = color;
    roundRect(g, x, y, w, 58, 29);
    g.fill();
    g.fillStyle = lum(color) > 0.55 ? "#1f2328" : "#ffffff";
    g.fillText(word, x + 22, y + 40);
    y += 58;
  }
  y += 136;
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
    g.fillStyle = t.ink2;
    g.font = font(700, 30);
    g.fillText(L.peopleCaption(m.ratio, m.year, m.today), x, y);
    y += 56;
  }
  // Babies per woman, short, if there is room above the footer.
  const tfr = rec?.tfr?.value;
  if (Number.isFinite(tfr) && y < SNAP_H - 180) {
    g.fillStyle = t.ink2;
    g.font = font(700, 30);
    g.fillText(`${L.fmtTfr(tfr)} babies per woman (2.1 keeps it level)`, x, y, maxW);
  }
  // Footer: which future, the source, then the link.
  g.fillStyle = t.ink2;
  g.font = font(750, 26);
  g.fillText(L.SCENARIO_LABELS[m.scenario] ?? L.SCENARIO_LABELS.medium, x, SNAP_H - 130, maxW);
  g.fillStyle = t.muted;
  g.font = font(600, 22);
  g.fillText("Source: UN World Population Prospects 2024", x, SNAP_H - 96, maxW);
  g.fillStyle = t.accentText;
  const link = String(m.url).replace(/^https?:\/\//, "");
  g.font = font(800, fitSize(g, link, 800, 32, maxW, 18));
  g.fillText(link, x, SNAP_H - 50);

  return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}

// ---------------------------------------------------------------- the share dialog

let dlg = null;
// The current opening of the dialog: { url, text, fileName, returnFocus, blob, file, objectUrl }. A new object each
// time it opens; anything async checks it is still `state` before touching the dialog.
let state = null;

// Let an opening go: free its picture. Synchronous, so a new opening can't be undone by an old close event.
function retire(inv) {
  if (!inv) return;
  if (inv.objectUrl) URL.revokeObjectURL(inv.objectUrl);
  inv.objectUrl = null;
  if (state === inv) state = null;
}

// Focus goes back only to something still on screen (a route change may have hidden the page it came from).
function focusBack(node) {
  if (node instanceof HTMLElement && node.isConnected && node.getClientRects().length) focusNoScroll(node);
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const paste = () => (isMac() ? "⌘V" : "Ctrl+V");

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
  el.share = h("button", { type: "button", class: "btn btn-primary", id: "snap-share", hidden: true }, "Share");
  el.copy = h("button", { type: "button", class: "btn btn-secondary", id: "snap-copy" }, "Copy picture");
  el.download = h("a", { class: "btn btn-secondary", id: "snap-download", href: "#" }, "Download");
  el.hint = h("ol", { class: "snap-hint", id: "snap-hint" });
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

  // Every way of closing ends the opening at once, before anything else can run: a pending clipboard reply then finds
  // it gone, and a new opening right after can't be undone by a late close event.
  const closeNow = ({ quiet = false } = {}) => {
    const inv = state;
    retire(inv);
    el.img.removeAttribute("src");
    if (el.root.open) el.root.close();
    if (inv && !quiet) focusBack(inv.returnFocus);
  };
  el.close.addEventListener("click", () => closeNow());
  // A click on the dim backdrop closes it.
  el.root.addEventListener("click", (e) => {
    if (e.target === el.root) {
      const r = el.root.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) closeNow();
    }
  });
  // Escape.
  el.root.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeNow();
  });
  // Any other close (dialog.close() from elsewhere). If a new picture opened before this event arrived, the dialog
  // is open again and that picture stays.
  el.root.addEventListener("close", () => {
    if (el.root.open || !state) return;
    const inv = state;
    retire(inv);
    el.img.removeAttribute("src");
    focusBack(inv.returnFocus);
  });
  el.closeNow = closeNow;

  // Still the picture on screen? Checked after every wait.
  const live = (inv) => state === inv && el.root.open;
  const say = (inv, msg) => {
    if (!live(inv)) return;
    el.status.textContent = msg;
    announce(msg);
  };
  const copyPicture = async (inv) => {
    if (!inv.blob || !navigator.clipboard?.write || typeof ClipboardItem !== "function") return false;
    try {
      await Promise.race([navigator.clipboard.write([new ClipboardItem({ "image/png": inv.blob })]), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2500))]);
      return true;
    } catch {
      return false;
    }
  };
  const download = (inv) => {
    if (!inv.objectUrl) return;
    const a = h("a", { href: inv.objectUrl, download: inv.fileName });
    document.body.append(a);
    a.click();
    a.remove();
  };

  el.x.addEventListener("click", async () => {
    const inv = state;
    if (!inv?.blob) return;
    const intent = `https://x.com/intent/post?text=${encodeURIComponent(inv.text)}&url=${encodeURIComponent(inv.url)}`;
    // Copy before X opens: the clipboard only takes a picture while this tab has focus. The copy starts inside the
    // click, so the window still opens within the click's grace period.
    const copied = await copyPicture(inv);
    if (!live(inv)) return; // closed or replaced while copying
    if (!copied) download(inv);
    const w = window.open(intent, "_blank");
    if (w) w.opener = null;
    const done = copied ? `Picture copied. In the X post, press ${paste()} to add it.` : "Picture downloaded. In the X post, add it with the picture button.";
    if (w) say(inv, done);
    else {
      // The browser blocked the new window: give a link to click instead.
      el.status.replaceChildren(done, " ", h("a", { href: intent, target: "_blank", rel: "noopener" }, "Open the X post"));
      announce(done);
    }
  });
  el.share.addEventListener("click", async () => {
    const inv = state;
    if (!inv?.file) return;
    try {
      await navigator.share({ files: [inv.file], text: `${inv.text} ${inv.url}` });
    } catch (err) {
      if (err?.name !== "AbortError") say(inv, "Couldn't open sharing. Use Download instead.");
    }
  });
  el.copy.addEventListener("click", async () => {
    const inv = state;
    if (!inv?.blob) return;
    const ok = await copyPicture(inv);
    say(inv, ok ? `Picture copied. Paste it anywhere with ${paste()}.` : "Couldn't copy the picture here. Use Download instead.");
  });
  el.download.addEventListener("click", (e) => {
    if (!state?.objectUrl) return e.preventDefault();
    say(state, "Picture saved to your downloads.");
  });

  dlg = el;
  return el;
}

// opts: { make: () => Promise<Blob>, text, url, fileName, alt }
export async function openShare(opts) {
  const el = ensureDialog();
  // Already open (a second click): keep the dialog and swap the picture; the old opening is let go here and now.
  const wasOpen = el.root.open;
  const prev = state;
  retire(prev);
  const inv = { url: opts.url, text: opts.text, fileName: opts.fileName, returnFocus: wasOpen ? prev?.returnFocus : document.activeElement };
  state = inv;
  el.img.removeAttribute("src");
  el.loading.textContent = "Making the picture…";
  el.status.textContent = "";
  el.loading.hidden = false;
  el.img.hidden = true;
  for (const b of [el.x, el.share, el.copy]) b.disabled = true;
  el.download.setAttribute("aria-disabled", "true");
  el.download.setAttribute("href", "#");
  if (!wasOpen) el.root.showModal();
  focusNoScroll(el.close);
  let blob;
  try {
    blob = await opts.make();
  } catch {
    if (state === inv) el.loading.textContent = "Couldn't make the picture. Try again.";
    return;
  }
  if (state !== inv || !el.root.open) return; // closed or replaced meanwhile
  const file = new File([blob], opts.fileName, { type: "image/png" });
  inv.blob = blob;
  inv.file = file;
  inv.objectUrl = URL.createObjectURL(blob);
  el.img.src = inv.objectUrl;
  el.img.alt = opts.alt ?? "";
  el.img.hidden = false;
  el.loading.hidden = true;
  el.download.href = inv.objectUrl;
  el.download.setAttribute("download", opts.fileName);
  el.download.removeAttribute("aria-disabled");
  // One way to X per device: phones share the picture itself (the list includes the X app); computers copy it and
  // open the post.
  const phoneShare = canShareFiles(file) && media.coarse();
  el.share.hidden = !phoneShare;
  el.x.hidden = phoneShare;
  for (const b of [el.x, el.share, el.copy]) b.disabled = false;
  el.hint.replaceChildren(
    ...(phoneShare
      ? [h("li", null, "Press Share, then pick X."), h("li", null, "The picture and the link go into your post.")]
      : [h("li", null, "Press Post on X. The picture is copied for you."), h("li", null, `In the X post, press ${paste()} to add the picture.`)]),
  );
  focusNoScroll(phoneShare ? el.share : el.x);
}

export const shareOpen = () => !!dlg?.root.open;

// A page change closes it without moving focus: the new page places focus itself.
export function closeShare() {
  if (dlg?.root.open) dlg.closeNow({ quiet: true });
}
