// Small DOM helpers. All data-driven text goes in through textContent or setAttribute (never innerHTML), so it is
// escaped by construction. esc() exists for the few places that build markup strings.

export const SVG_NS = "http://www.w3.org/2000/svg";

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function apply(el, attrs) {
  if (!attrs) return el;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function h(tag, attrs, ...children) {
  return append(apply(document.createElement(tag), attrs), children);
}

export function s(tag, attrs, ...children) {
  return append(apply(document.createElementNS(SVG_NS, tag), attrs), children);
}

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

export function setAttr(el, name, value) {
  if (!el) return;
  if (value == null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
}

export const media = {
  reduced: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  coarse: () => window.matchMedia("(pointer: coarse)").matches,
  finePointer: () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  mobile: () => window.matchMedia("(max-width: 699px)").matches,
};

// Every programmatic focus in the app goes through here (DESIGN §3.4 G3).
export function focusNoScroll(el) {
  if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
}

let announceTimer = 0;
export function announce(msg) {
  const el = $("announcer");
  if (!el) return;
  clearTimeout(announceTimer);
  el.textContent = "";
  announceTimer = setTimeout(() => (el.textContent = msg), 30);
}

// Scroll an element into view inside its own scroll container only (never the window; DESIGN §3.4 G4).
export function keepInView(container, el, pad = 4) {
  if (!container || !el) return;
  const top = el.offsetTop - pad;
  const bottom = el.offsetTop + el.offsetHeight + pad;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const prev = document.activeElement;
    const ta = h("textarea", { style: { position: "fixed", top: "0", left: "0", opacity: "0" }, readonly: true });
    ta.value = text;
    document.body.append(ta);
    focusNoScroll(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    if (prev instanceof HTMLElement) focusNoScroll(prev);
    return ok;
  }
}

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function idle(fn) {
  if ("requestIdleCallback" in window) window.requestIdleCallback(fn, { timeout: 2500 });
  else setTimeout(fn, 600);
}
