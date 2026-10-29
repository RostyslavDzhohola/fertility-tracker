// Headless-Chrome checks for DESIGN-v3 §9 (items 1–6 and 8) and the guardrails that carry over from v2.
// Opt-in, because it launches Chrome:  FT_BROWSER_TESTS=1 node --test test/frontend/browser.test.mjs
// Zero dependencies: a static server for public/ that applies vercel.json rewrites and serves 404.html like Vercel,
// Chrome's DevTools protocol over Node's built-in WebSocket, and real input events (mouse, wheel, touch, keys).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { buildPages } from "../../scripts/pages/build-pages.mjs";

const ENABLED = process.env.FT_BROWSER_TESTS === "1";
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = path.join(repoDir, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".csv": "text/csv", ".txt": "text/plain" };

function findChrome() {
  return [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((c) => c && existsSync(c));
}

let server;
let base;
let chrome;
let profile;
let ws;
let nextId = 1;
const pending = new Map();
const listeners = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

// The app is up: data loaded, pages created, and (on the globe page) the globe has drawn.
const APP_READY = `document.documentElement.classList.contains("ready") && !!window.FT && (document.getElementById("view-globe").hidden || FT.home.globe.ready)`;

async function openPage({ width = 1440, height = 900, mobile = false, path: urlPath = "/?year=2100", ready = APP_READY, setup, reducedMotion = false, dark = false }) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const features = [];
  if (reducedMotion) features.push({ name: "prefers-reduced-motion", value: "reduce" });
  if (dark) features.push({ name: "prefers-color-scheme", value: "dark" });
  if (features.length) await s("Emulation.setEmulatedMedia", { features });
  await s("Page.enable");
  await s("Runtime.enable");
  const errors = [];
  const onMsg = (msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  };
  listeners.add(onMsg);
  if (setup) await setup(s, sessionId);
  await s("Page.navigate", { url: `${base}${urlPath}` });
  const page = {
    targetId,
    errors,
    s,
    async eval(expr) {
      const r = await s("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    async key(key, { code, text, vk, modifiers = 0 } = {}) {
      const down = { type: text ? "keyDown" : "rawKeyDown", key, code: code ?? key, windowsVirtualKeyCode: vk ?? 0, nativeVirtualKeyCode: vk ?? 0, modifiers };
      if (text) {
        down.text = text;
        down.unmodifiedText = text;
      }
      await s("Input.dispatchKeyEvent", down);
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, code: code ?? key, windowsVirtualKeyCode: vk ?? 0, nativeVirtualKeyCode: vk ?? 0, modifiers });
      await sleep(40);
    },
    async type(str) {
      for (const ch of str) await this.key(ch, { code: /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : undefined, text: ch, vk: ch.toUpperCase().charCodeAt(0) });
    },
    mouse: (type, x, y, extra = {}) => s("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mouseReleased" ? 0 : extra.buttons ?? (type === "mousePressed" ? 1 : 0), clickCount: 1, ...extra }),
    async click(x, y) {
      await this.mouse("mouseMoved", x, y);
      await this.mouse("mousePressed", x, y);
      await this.mouse("mouseReleased", x, y);
    },
    async drag(x0, y0, x1, y1, steps = 12, stepMs = 16) {
      await this.mouse("mouseMoved", x0, y0);
      await this.mouse("mousePressed", x0, y0);
      for (let i = 1; i <= steps; i++) {
        await this.mouse("mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { button: "left", buttons: 1 });
        await sleep(stepMs);
      }
      await this.mouse("mouseReleased", x1, y1);
    },
    touch: (type, points) => s("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) }),
    close: () => {
      listeners.delete(onMsg);
      return send("Target.closeTarget", { targetId });
    },
    waitFor: (expr, ms) => waitForOn(page, expr, ms),
  };
  await page.waitFor(ready);
  await sleep(200);
  return page;
}

async function waitForOn(page, expr, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.eval(expr).catch(() => false)) return true;
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${expr}`);
}

// Vercel-like routing: vercel.json redirects, then files (including the share pages built in before()), then
// rewrites, then 404.html with status 404. Sources like "/:code(AFG|ALB)" become named groups.
function routeRe(source) {
  const parts = source.split(/(:\w+(?:\([^)]*\))?)/).map((part) => {
    const m = /^:(\w+)(?:\(([^)]*)\))?$/.exec(part);
    return m ? `(?<${m[1]}>${m[2] ?? "[^/]+"})` : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp("^" + parts.join("") + "$");
}

before(async () => {
  if (!ENABLED) return;
  const bin = findChrome();
  if (!bin) throw new Error("FT_BROWSER_TESTS=1 but no Chrome found (set CHROME_BIN)");
  await buildPages({ quiet: true });
  const vercel = JSON.parse(await readFile(path.join(repoDir, "vercel.json"), "utf8"));
  const rewrites = (vercel.rewrites ?? []).map((r) => [routeRe(r.source), r.destination]);
  const fileFor = async (p) => {
    const rel = path.normalize(p).replace(/^([/\\])+/, "");
    let file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir)) return null;
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      await stat(file);
      return file;
    } catch {
      return null;
    }
  };
  server = createServer(async (req, res) => {
    const reqUrl = new URL(req.url, "http://x");
    const p = decodeURIComponent(reqUrl.pathname);
    for (const r of vercel.redirects ?? []) {
      const m = routeRe(r.source).exec(p);
      if (m) {
        // Like Vercel, the query string comes along.
        res.writeHead(r.permanent === false ? 307 : 308, { location: r.destination.replace(/:(\w+)/g, (all, k) => m.groups?.[k] ?? all) + reqUrl.search });
        return res.end();
      }
    }
    let file = await fileFor(p);
    if (!file) for (const [re, dest] of rewrites) if (re.test(p)) file = await fileFor(dest);
    let status = 200;
    if (!file) {
      file = path.join(publicDir, "404.html");
      status = 404;
    }
    res.writeHead(status, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(path.join(tmpdir(), "ft-browser-test-"));
  const args = ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
  if (process.getuid?.() === 0) args.unshift("--no-sandbox");
  chrome = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not print a DevTools URL")), 20000);
    chrome.stderr.on("data", (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
  ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) for (const fn of listeners) fn(msg);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  };
});

after(async () => {
  if (!ENABLED) return;
  try {
    ws?.close();
  } catch {}
  chrome?.kill();
  server?.close();
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
});

const opts = { skip: ENABLED ? false : "set FT_BROWSER_TESTS=1 to run the headless-Chrome checks" };
const G = "FT.home.globe";
const settle = (page, ms = 6000) => page.waitFor(`!${G}.moving`, ms);

// ------------------------------------------------------------------ §9.1 full-viewport globe

test("§9.1 the home page is a full-viewport globe with no page scroll or horizontal overflow", opts, async () => {
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 390, height: 844, mobile: true },
  ]) {
    const page = await openPage({ ...vp });
    try {
      const m = await page.eval(`(() => {
        const c = document.getElementById("globe").getBoundingClientRect();
        const f = ${G}.frame;
        return { cw: c.width, ch: c.height, iw: innerWidth, ih: innerHeight, sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, r: f.r, mode: ${G}.mode,
          dock: document.getElementById("dock-wrap").getBoundingClientRect().bottom };
      })()`);
      assert.equal(m.cw, m.iw, JSON.stringify(m));
      assert.equal(m.ch, m.ih, JSON.stringify(m));
      assert.ok(m.sh <= m.ih, `page scrolls: ${JSON.stringify(m)}`);
      assert.ok(m.sw <= m.iw, `horizontal overflow: ${JSON.stringify(m)}`);
      assert.ok(m.dock <= m.ih, "the dock is on screen");
      assert.ok(m.r * 2 >= Math.min(m.iw, m.ih) * 0.75, `globe is big: ${JSON.stringify(m)}`);
      assert.equal(m.mode, "globe", "globe is the default view");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  }
});

// ------------------------------------------------------------------ §9.2 drag and click

test("§9.2 the first drag rotates at once and keeps the grabbed point under the pointer; one click selects", opts, async () => {
  const page = await openPage({});
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    const f = await page.eval(`${G}.frame`);
    const [x0, y0] = [f.cx - 60, f.cy + 20];
    const grabbed = await page.eval(`${G}.lonLatAt(${x0}, ${y0})`);
    const rot0 = await page.eval(`${G}.rotation`);
    await page.mouse("mouseMoved", x0, y0);
    await page.mouse("mousePressed", x0, y0);
    // The very first move past the 5px click slop already turns the globe; no second click, no activation step.
    await page.mouse("mouseMoved", x0 + 12, y0 + 4, { button: "left", buttons: 1 });
    await sleep(60);
    const rot1 = await page.eval(`${G}.rotation`);
    assert.notDeepEqual(rot1, rot0, "first drag rotates immediately");
    for (let i = 2; i <= 10; i++) {
      await page.mouse("mouseMoved", x0 + 12 * i, y0 + 4 * i, { button: "left", buttons: 1 });
      await sleep(16);
    }
    const under = await page.eval(`${G}.lonLatAt(${x0 + 120}, ${y0 + 40})`);
    const dist = Math.hypot(((under[0] - grabbed[0] + 540) % 360) - 180, under[1] - grabbed[1]);
    assert.ok(dist < 0.6, `grabbed point drifted ${dist.toFixed(2)}° (${JSON.stringify({ grabbed, under })})`);
    await page.mouse("mouseReleased", x0 + 120, y0 + 40);
    // Inertia: a fast flick keeps turning after release.
    await page.drag(f.cx, f.cy, f.cx + 220, f.cy, 6, 8);
    const ra = await page.eval(`${G}.rotation`);
    await sleep(120);
    const rb = await page.eval(`${G}.rotation`);
    assert.notDeepEqual(ra, rb, "inertia after release");
    await settle(page);
    // A click without movement selects whatever is under it, first time.
    await page.eval(`FT.home.globe.flyTo("FRA", { zoom: 3 }), 0`);
    await settle(page);
    const p = await page.eval(`${G}.screenOf("FRA")`);
    await page.click(p.x, p.y);
    await page.waitFor(`FT.home.selected === "FRA" && !document.getElementById("card").hidden`, 3000);
    assert.equal(await page.eval(`document.getElementById("card-name").textContent`), "France");
    await page.waitFor(`location.search.includes("focus=FRA")`, 2000);
    assert.equal(await page.eval("history.length"), 2, "selecting replaces, never pushes");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ §9.3 zoom

test("§9.3 wheel zoom goes toward the pointer; Taiwan is visible and clickable at max zoom with 50m outlines", opts, async () => {
  const page = await openPage({});
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    const f = await page.eval(`${G}.frame`);
    const [x, y] = [f.cx + 120, f.cy - 90];
    const before = await page.eval(`${G}.lonLatAt(${x}, ${y})`);
    for (let i = 0; i < 4; i++) {
      await page.s("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -240 });
      await sleep(40);
    }
    await settle(page);
    const k = await page.eval(`${G}.k`);
    assert.ok(k > 2.5, `wheel zoomed in: k=${k}`);
    const after = await page.eval(`${G}.lonLatAt(${x}, ${y})`);
    assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 0.5, `zoom kept the point under the pointer: ${JSON.stringify({ before, after })}`);
    // Buttons and double-click.
    await page.eval(`document.getElementById("zoom-out").click(), 0`);
    await settle(page);
    assert.ok((await page.eval(`${G}.k`)) < k);
    // Max zoom on Taiwan, at rest: 50m outlines and a click that lands on Taiwan.
    await page.waitFor(`${G}.has50`, 15000);
    await page.eval(`${G}.flyTo("TWN", { zoom: 16 }), 0`);
    await settle(page, 8000);
    await sleep(300);
    assert.ok(Math.abs((await page.eval(`${G}.k`)) - 7) < 1e-6, "fly-to caps at 7× so neighbours stay in view");
    await page.eval(`${G}.zoomBy(16 / 7, { animate: false }), 0`);
    await sleep(100);
    await sleep(400);
    assert.ok(Math.abs((await page.eval(`${G}.k`)) - 16) < 1e-6, "zoom goes to 16×");
    assert.equal(await page.eval(`${G}.detail`), 50, "50m outlines at rest");
    const p = await page.eval(`${G}.screenOf("TWN")`);
    assert.ok(p && p.x > 0 && p.y > 0 && p.x < 1440 && p.y < 900, JSON.stringify(p));
    await page.click(p.x, p.y);
    await page.waitFor(`FT.home.selected === "TWN"`, 3000);
    assert.equal(await page.eval(`document.getElementById("card-name").textContent`), "Taiwan");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("§9.3 two-finger pinch zooms on touch; a one-finger drag turns the globe", opts, async () => {
  const page = await openPage({ width: 390, height: 844, mobile: true });
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    const f = await page.eval(`${G}.frame`);
    const k0 = await page.eval(`${G}.k`);
    await page.touch("touchStart", [
      [f.cx - 30, f.cy],
      [f.cx + 30, f.cy],
    ]);
    for (let i = 1; i <= 8; i++) {
      await page.touch("touchMove", [
        [f.cx - 30 - 12 * i, f.cy],
        [f.cx + 30 + 12 * i, f.cy],
      ]);
      await sleep(16);
    }
    await page.touch("touchEnd", []);
    await sleep(200);
    const k1 = await page.eval(`${G}.k`);
    assert.ok(k1 > k0 * 2, `pinch zoomed: ${k0} → ${k1}`);
    const r0 = await page.eval(`${G}.rotation`);
    await page.touch("touchStart", [[f.cx, f.cy]]);
    for (let i = 1; i <= 6; i++) {
      await page.touch("touchMove", [[f.cx + 15 * i, f.cy]]);
      await sleep(16);
    }
    await page.touch("touchEnd", []);
    await sleep(100);
    assert.notDeepEqual(await page.eval(`${G}.rotation`), r0, "one-finger drag turns the globe");
    assert.equal(await page.eval("window.scrollY"), 0, "touch never scrolls the page");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ §9.4 slider, Play, scenario

test("§9.4 slider, Play and the scenario switch change the globe, the world counter and the open card live", opts, async () => {
  const page = await openPage({ path: "/?year=2100&focus=TWN" });
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    await page.waitFor(`FT.home.selected === "TWN" && !document.getElementById("card").hidden`);
    await settle(page);
    const snap = `(() => {
      const p = ${G}.screenOf("TWN");
      const c = document.getElementById("globe");
      const d = Math.min(2, devicePixelRatio || 1);
      const px = p ? [...c.getContext("2d").getImageData(Math.round(p.x * d), Math.round(p.y * d), 1, 1).data].slice(0, 3).join(",") : null;
      return { world: document.getElementById("wc-num").textContent + " " + document.getElementById("wc-unit").textContent, wpct: document.getElementById("wc-pct").textContent,
        card: document.getElementById("card-num").textContent + " " + document.getElementById("card-unit").textContent, cardYear: document.getElementById("card-year").textContent,
        gray: [...document.querySelectorAll("#card-people .pp-base .person")].map((i) => getComputedStyle(i).getPropertyValue("--f").trim()).join(","), px, year: document.querySelector(".tc-year-num").textContent };
    })()`;
    const a = await page.eval(snap);
    assert.equal(a.year, "2100");
    // Drag the slider's value to 2050 the way a user does (input events), and everything follows.
    await page.eval(`(() => { const r = document.getElementById("globe-year"); r.value = "2050"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(600);
    const b = await page.eval(snap);
    assert.equal(b.year, "2050");
    assert.notEqual(b.world, a.world, "world counter changed");
    assert.notEqual(b.card, a.card, "card number changed");
    assert.equal(b.cardYear, "in 2050");
    assert.notEqual(b.gray, a.gray, "card icons changed");
    assert.notEqual(b.px, a.px, "Taiwan's color on the globe changed");
    assert.match(await page.eval(`document.getElementById("globe-year").getAttribute("aria-valuetext")`), /^2050, world \d/);
    await page.waitFor(`location.search.includes("year=2050")`, 2000);
    // Play runs from 2050 toward 2100 and the counter moves while it plays.
    await page.eval(`document.querySelector(".tc-play").click(), 0`);
    await sleep(500);
    const c1 = await page.eval(snap);
    await sleep(500);
    const c2 = await page.eval(snap);
    assert.ok(Number(c1.year) > 2050 && Number(c2.year) > Number(c1.year), `Play advances: ${c1.year} → ${c2.year}`);
    assert.notEqual(c2.world, c1.world);
    await page.eval(`document.querySelector(".tc-play").click(), 0`); // pause
    await page.eval(`(() => { const r = document.getElementById("globe-year"); r.value = "2100"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(600);
    const d1 = await page.eval(snap);
    await page.eval(`document.querySelector('#dock .seg[data-s="constant"]').click(), 0`);
    await sleep(900);
    const d2 = await page.eval(snap);
    assert.notEqual(d2.world, d1.world, "scenario changes the world counter");
    assert.notEqual(d2.card, d1.card, "scenario changes the card");
    assert.notEqual(d2.px, d1.px, "scenario changes the globe color");
    assert.equal(await page.eval(`document.querySelector('#dock .seg[data-s="constant"]').getAttribute("aria-pressed")`), "true");
    await page.waitFor(`location.search.includes("scenario=constant")`, 2000);
    assert.equal(await page.eval("history.length"), 2, "slider and scenario tweaks never push history");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ §9.5 labels

test("§9.5 zoomed-in labels show each country's population and % for the slider year", opts, async () => {
  const page = await openPage({ path: "/?year=2070" });
  try {
    await page.eval(`${G}.stopSpin(), ${G}.flyTo("DEU", { zoom: 4 }), 0`);
    await settle(page, 8000);
    await sleep(300);
    const labels = await page.eval(`${G}.labels`);
    assert.ok(labels.length >= 5, `labels drawn: ${JSON.stringify(labels.map((l) => l.name))}`);
    const de = labels.find((l) => l.iso3 === "DEU");
    assert.ok(de, "Germany is labelled");
    const want = await page.eval(`(() => { const L = ${"{"} pop: FT.data.scen.places.DEU.medium[2070 - FT.data.scen.startYear] ${"}"}; return L.pop; })()`);
    const m = /^([\d.]+)([KMB]) · ([+−]\d+%|0%)$/.exec(de.line);
    assert.ok(m, `label line "${de.line}"`);
    const scale = { K: 1e3, M: 1e6, B: 1e9 }[m[2]];
    assert.ok(Math.abs(Number(m[1]) * scale - want) / want < 0.01, `${de.line} vs ${want}`);
    for (const l of labels) assert.match(l.line, /^[\d.]+[KMB]? · ([+−][\d.]+%|0%)$/, l.name);
    // The label follows the slider.
    await page.eval(`(() => { const r = document.getElementById("globe-year"); r.value = "2100"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(700);
    const de2 = (await page.eval(`${G}.labels`)).find((l) => l.iso3 === "DEU");
    assert.ok(de2 && de2.line !== de.line, `label updated: ${de.line} → ${de2?.line}`);
    // Labels never sit under the dock, the zoom buttons or the search box.
    const blocks = await page.eval(`["dock-wrap", "zoom-ctrl", "search-wrap"].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; })`);
    for (const l of await page.eval(`${G}.labels`)) for (const [x0, y0, x1, y1] of blocks) assert.ok(!(l.x > x0 && l.x < x1 && l.y > y0 && l.y < y1), `${l.name} at ${Math.round(l.x)},${Math.round(l.y)} is under a control`);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ §9.6 search

test("§9.6 search is typo-tolerant, finds names, aliases and codes, and flies the globe there", opts, async () => {
  const page = await openPage({});
  try {
    for (const [q, want] of [
      ["taiwan", "Taiwan"],
      ["taiwn", "Taiwan"],
      ["korea", "South Korea"],
      ["south korea", "South Korea"],
      ["uk", "United Kingdom"],
      ["ivory coast", "Cote d'Ivoire"],
      ["hong kong", "Hong Kong"],
      ["macau", "Macao"],
      ["czech", "Czechia"],
      ["türkiye", "Turkey"],
      ["turkey", "Turkey"],
      ["KOR", "South Korea"],
      ["jpn", "Japan"],
    ]) {
      await page.eval(`(() => { const i = document.getElementById("search"); i.focus({ preventScroll: true }); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(60);
      const first = await page.eval(`document.querySelector("#search-results [role=option] .opt-name")?.textContent`);
      assert.equal(first, want, `"${q}"`);
    }
    // Real typing, then Enter: the globe flies to Taiwan and the card opens.
    await page.eval(`(() => { const i = document.getElementById("search"); i.value = ""; i.blur(); })()`);
    await page.key("/", { code: "Slash", text: "/", vk: 191 });
    await page.type("taiwn");
    await page.key("Enter", { text: "\r", vk: 13 });
    await page.waitFor(`FT.home.selected === "TWN"`, 3000);
    await settle(page, 8000);
    assert.ok((await page.eval(`${G}.k`)) > 3, "flew in");
    const p = await page.eval(`${G}.screenOf("TWN")`);
    // The card opens on the left; the zoom buttons stay put on the right. Taiwan lands between them.
    const card = await page.eval(`document.getElementById("card").getBoundingClientRect().right`);
    const ctrl = await page.eval(`document.getElementById("zoom-ctrl").getBoundingClientRect().left`);
    assert.ok(p && p.x > card && p.x < ctrl && p.y > 60 && p.y < 760, `Taiwan in view beside the card: ${JSON.stringify(p)}`);
    assert.equal(await page.eval("window.scrollY"), 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ §9.8 routes, deep links, Back

test("§9.8 deep links survive a reload: /country/TWN, /rankings, /api/, /#KOR and /KOR", opts, async () => {
  const cases = [
    ["/country/TWN", "/country/TWN", `document.getElementById("cv-name").textContent === "Taiwan"`],
    ["/country/twn?year=2070", "/country/TWN", `document.getElementById("cv-name").textContent === "Taiwan" && document.getElementById("pp-year").textContent === "2070"`],
    ["/rankings", "/rankings", `document.querySelectorAll("#rk-list li").length === 25 && document.querySelectorAll("#rk-small li").length >= 20`],
    ["/#KOR", "/country/KOR", `document.getElementById("cv-name").textContent === "South Korea"`],
    ["/KOR", "/country/KOR", `document.getElementById("cv-name").textContent === "South Korea"`],
    ["/fertility-tracker/JPN", "/country/JPN", `document.getElementById("cv-name").textContent === "Japan"`],
  ];
  for (const [from, to, check] of cases) {
    const page = await openPage({ path: from, ready: `location.pathname === ${JSON.stringify(to)} && ${APP_READY}` });
    try {
      await page.waitFor(check, 8000);
      assert.equal(await page.eval("location.pathname"), to, from);
      assert.equal(await page.eval(`!!document.querySelector('link[rel="service-desc"]')`), true, "agent tags on every route");
      assert.deepEqual(page.errors, [], from);
    } finally {
      await page.close();
    }
  }
  const api = await openPage({ path: "/api/", ready: `document.readyState === "complete"` });
  try {
    assert.equal(await api.eval(`document.querySelector("h1").textContent`), "Fertility Tracker API");
    assert.ok(await api.eval(`!!document.querySelector('a[href="/api/v1/scenarios.json"]')`), "lists scenarios.json");
  } finally {
    await api.close();
  }
});

test("§9.8 Back and Forward move between pages; the year and scenario travel in the URL", opts, async () => {
  const page = await openPage({ path: "/?year=2070&scenario=constant&focus=TWN" });
  try {
    await page.waitFor(`FT.home.selected === "TWN" && !document.getElementById("card").hidden`);
    const cta = await page.eval(`document.getElementById("card-cta").getAttribute("href")`);
    assert.equal(cta, "/country/TWN?year=2070&scenario=constant");
    await page.eval(`document.getElementById("card-cta").click(), 0`);
    await page.waitFor(`location.pathname === "/country/TWN" && document.getElementById("cv-name").textContent === "Taiwan"`);
    assert.equal(await page.eval("document.activeElement.id"), "cv-name", "focus moves to the story's title");
    assert.equal(await page.eval("location.search"), "?year=2070&scenario=constant");
    assert.equal(await page.eval(`document.getElementById("view-globe").hidden`), true);
    assert.equal(await page.eval(`document.getElementById("pp-year").textContent`), "2070");
    assert.equal(await page.eval(`document.querySelector('#cv-controls .seg[data-s="constant"]').getAttribute("aria-pressed")`), "true");
    // Rankings through the nav, then Back twice.
    await page.eval(`document.querySelector('#topnav a[data-page="rankings"]').click(), 0`);
    await page.waitFor(`location.pathname === "/rankings" && !document.getElementById("view-rankings").hidden`);
    await page.eval("history.back(), 0");
    await page.waitFor(`location.pathname === "/country/TWN" && !document.getElementById("view-country").hidden`);
    await page.eval("history.back(), 0");
    await page.waitFor(`location.pathname === "/" && !document.getElementById("view-globe").hidden && FT.home.selected === "TWN"`);
    assert.match(await page.eval("location.search"), /focus=TWN/);
    await page.eval("history.forward(), 0");
    await page.waitFor(`location.pathname === "/country/TWN"`);
    // Search on a story page opens that place's story.
    await page.eval(`(() => { const i = document.getElementById("search"); i.focus({ preventScroll: true }); i.value = "japan"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.key("Enter", { text: "\r", vk: 13 });
    await page.waitFor(`location.pathname === "/country/JPN" && document.getElementById("cv-name").textContent === "Japan"`);
    assert.equal(await page.eval("document.activeElement.id"), "cv-name", "focus moves to the new title after a search");
    assert.match(await page.eval("document.title"), /^Japan: .* · Fertility Tracker$/);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ country page

test("country page: the 100 people and the chart marker follow the shared slider; risk is a meter of words", opts, async () => {
  const page = await openPage({ path: "/country/TWN?year=2100" });
  try {
    await page.waitFor(`document.querySelector("#pop-chart svg .marker")`);
    const meter = await page.eval(`(() => ({ words: [...document.querySelectorAll("#cv-meter .meter-word")].map((w) => w.textContent), on: document.querySelector("#cv-meter .meter-seg.on .meter-word")?.textContent, text: document.querySelector(".hero").textContent }))()`);
    assert.deepEqual(meter.words, ["Growing", "About the same", "Shrinking", "Shrinking fast", "Half gone"]);
    assert.equal(meter.on, "Half gone");
    assert.match(meter.text, /By 2100: Half gone −5\d% vs today/);
    assert.ok(!/\b\d{1,3} ?\/ ?100\b/.test(meter.text), "no 0–100 score in the hero");
    assert.match(await page.eval(`document.getElementById("cv-lede").textContent`), /^For every 100 people in Taiwan today, about \d+ will be left in 2100 \(UN forecast\)\.$/);
    const gone = `[...document.querySelectorAll("#pp-grid .pp-base .person")].filter((i) => Number(getComputedStyle(i).getPropertyValue("--f")) < 0.5).length`;
    const g2100 = await page.eval(gone);
    const x2100 = await page.eval(`document.querySelector("#pop-chart .m-line").getAttribute("x1")`);
    await page.eval(`(() => { const r = document.getElementById("cv-year"); r.value = "2040"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(600);
    const g2040 = await page.eval(gone);
    assert.ok(g2100 > 45 && g2040 < g2100, `gray icons ${g2100} (2100) → ${g2040} (2040)`);
    assert.notEqual(await page.eval(`document.querySelector("#pop-chart .m-line").getAttribute("x1")`), x2100, "chart marker moved");
    assert.equal(await page.eval(`document.getElementById("pp-year").textContent`), "2040");
    // The 0–100 score only appears under "More numbers".
    assert.equal(await page.eval(`document.getElementById("more").open`), false);
    assert.match(await page.eval(`document.getElementById("more-body").textContent`), /Risk score \(0–100\), how it works →/);
    // A growing place gains green icons.
    await page.eval(`FT.navigate("/country/NER"), 0`);
    await page.waitFor(`document.getElementById("cv-name").textContent === "Niger"`);
    await page.eval(`(() => { const r = document.getElementById("cv-year"); r.value = "2100"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(600);
    const green = await page.eval(`document.querySelectorAll("#pp-grid .pp-extra .person:not([hidden])").length`);
    assert.equal(green, 100, "extra green rows, capped");
    assert.match(await page.eval(`document.querySelector("#pp-grid .pp-more").textContent`), /^\+\d+ more for every 100 today$/);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("micro-places get no verdict word; the world gets the outlook meter", opts, async () => {
  for (const [code, re] of [
    ["VAT", /^$/],
    ["WLD", /By 2100: Growing/],
  ]) {
    const page = await openPage({ path: `/country/${code}` });
    try {
      assert.match(await page.eval(`document.getElementById("cv-meter").textContent`), re);
      if (code === "VAT") assert.equal(await page.eval(`document.getElementById("cv-verdict").textContent`), "The Vatican has a very small population: its numbers swing a lot.");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  }
});

// ------------------------------------------------------------------ guardrails carried over from v2

test("typing in search and choosing a result never moves the page (R1)", opts, async () => {
  const page = await openPage({ path: "/country/JPN" });
  try {
    await page.eval("window.scrollTo(0, 1400), 0");
    await sleep(150);
    const start = await page.eval("window.scrollY");
    const seen = [];
    await page.key("/", { code: "Slash", text: "/", vk: 191 });
    seen.push(["/", await page.eval("window.scrollY")]);
    for (const ch of "Chad") {
      await page.type(ch);
      seen.push([ch, await page.eval("window.scrollY")]);
    }
    await page.key("ArrowDown", { vk: 40 });
    seen.push(["ArrowDown", await page.eval("window.scrollY")]);
    for (const [step, y] of seen) assert.equal(y, start, `scrollY moved after "${step}": ${JSON.stringify(seen)}`);
    await page.key("Enter", { text: "\r", vk: 13 });
    await page.waitFor(`location.pathname === "/country/TCD"`);
    assert.equal(await page.eval("window.scrollY"), 0, "a new page starts at the top");
  } finally {
    await page.close();
  }
});

test("phones: no horizontal overflow on any page; the card sheet never covers the slider", opts, async () => {
  for (const p of ["/?year=2100&focus=TWN", "/country/TWN", "/country/VCT", "/rankings", "/api/"]) {
    const page = await openPage({ width: 390, height: 844, mobile: true, path: p, ready: p === "/api/" ? `document.readyState === "complete"` : APP_READY });
    try {
      const w = await page.eval(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
      assert.ok(w.sw <= w.cw, `${p}: ${JSON.stringify(w)}`);
      if (p.startsWith("/?")) {
        await page.waitFor(`!document.getElementById("card").hidden`);
        const r = await page.eval(`({ card: document.getElementById("card").getBoundingClientRect().bottom, slider: document.getElementById("globe-year").getBoundingClientRect().top })`);
        assert.ok(r.card <= r.slider, `card covers the slider: ${JSON.stringify(r)}`);
      }
    } finally {
      await page.close();
    }
  }
});

test("every control is at least 44px, on desktop and on phones", opts, async () => {
  for (const vp of [{}, { width: 390, height: 844, mobile: true }]) {
    const page = await openPage({ ...vp, path: "/?year=2100&focus=TWN" });
    try {
      await page.waitFor(`!document.getElementById("card").hidden`);
      const small = await page.eval(`[...document.querySelectorAll("#view-globe button, #view-globe a, .topbar button, .topbar a, .topbar input, #globe-year")].filter((b) => b.offsetParent && getComputedStyle(b).visibility !== "hidden").map((b) => [b.id || b.textContent.trim().slice(0, 20), Math.round(b.getBoundingClientRect().height)]).filter(([, hh]) => hh < 44)`);
      assert.deepEqual(small, [], `${vp.width ?? 1440}px`);
    } finally {
      await page.close();
    }
  }
});

test("first visit plays the years once; reduced motion and ?year= skip it", opts, async () => {
  const page = await openPage({ path: "/" });
  try {
    await page.waitFor(`FT.state.playing || Math.round(FT.state.year) > FT.data.today`, 4000);
    await page.waitFor(`!FT.state.playing && Math.round(FT.state.year) === 2100`, 12000);
    assert.equal(await page.eval(`sessionStorage.getItem("ft.seenIntro")`), "1");
  } finally {
    await page.close();
  }
  const still = await openPage({ path: "/", reducedMotion: true });
  try {
    await sleep(1500);
    assert.equal(await still.eval("FT.state.playing"), false);
    assert.equal(await still.eval(`${G}.spinning`), false, "no idle spin with reduced motion");
  } finally {
    await still.close();
  }
});

test("retry after a failed countries.json brings the whole app up", opts, async () => {
  let failing = true;
  let sid = null;
  const onPaused = (msg) => {
    if (msg.method !== "Fetch.requestPaused" || msg.sessionId !== sid) return;
    const { requestId } = msg.params;
    if (failing) send("Fetch.failRequest", { requestId, errorReason: "Failed" }, sid).catch(() => {});
    else send("Fetch.continueRequest", { requestId }, sid).catch(() => {});
  };
  listeners.add(onPaused);
  const page = await openPage({
    path: "/?year=2100&focus=KOR",
    ready: `!document.getElementById("load-banner").hidden`,
    setup: async (s, sessionId) => {
      sid = sessionId;
      await s("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/countries.json*" }] });
    },
  });
  try {
    failing = false;
    await page.eval(`document.getElementById("load-retry").click(), 0`);
    await page.waitFor(APP_READY);
    await page.waitFor(`FT.home.selected === "KOR"`);
    assert.equal(await page.eval(`document.getElementById("card-name").textContent`), "South Korea");
    assert.equal(await page.eval(`document.getElementById("load-banner").hidden`), true);
  } finally {
    listeners.delete(onPaused);
    await page.close();
  }
});

// ------------------------------------------------------------------ fix round 1 (review findings)

const BUCKET = `((p) => p == null ? null : p <= -50 ? "Half gone" : p <= -25 ? "Shrinking fast" : p < -5 ? "Shrinking" : p <= 5 ? "About the same" : "Growing")`;
const PCT = `((t) => { const m = /([+−-])?(\\d+(?:\\.\\d)?)%/.exec(t); return m ? (m[1] === "−" || m[1] === "-" ? -1 : 1) * Number(m[2]) : null; })`;

test("B1 every word on screen matches the number beside it: card, search, Shrinking most, rankings, country meter", opts, async () => {
  const page = await openPage({ path: "/?year=2070&focus=BRA" });
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    await page.waitFor(`FT.home.selected === "BRA"`);
    // The card chip says where Brazil is headed by 2100 (UN forecast): −24% → Shrinking.
    const card = await page.eval(`(() => { const p = ((FT.data.scen.places.BRA.medium[2100 - FT.data.scen.startYear] / FT.data.scen.places.BRA.medium[FT.data.today - FT.data.scen.startYear]) - 1) * 100; return { word: document.querySelector("#card-risk b")?.textContent, text: document.getElementById("card-risk").textContent, want: ${BUCKET}(p), p }; })()`);
    assert.equal(card.word, card.want, JSON.stringify(card));
    assert.match(card.text, /^By 2100: /);
    // Search rows: word and number agree.
    await page.eval(`(() => { const i = document.getElementById("search"); i.focus({ preventScroll: true }); i.value = "korea"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const rows = await page.eval(`[...document.querySelectorAll("#search-results [role=option][data-iso3]")].map((o) => ({ sub: o.querySelector(".opt-sub").textContent, pct: o.querySelector(".opt-pct").textContent }))`);
    assert.ok(rows.length >= 2);
    for (const r of rows) assert.equal(r.sub.replace(/ by 2100$/, ""), await page.eval(`${BUCKET}(${PCT}(${JSON.stringify(r.pct)}))`), JSON.stringify(r));
    await page.eval(`document.getElementById("search").blur(), 0`);
    // "Shrinking most": sorted by the number each row shows; the old label is gone.
    assert.equal(await page.eval(`document.getElementById("risk-btn").textContent.trim()`), "Shrinking most");
    await page.eval(`document.getElementById("risk-btn").click(), 0`);
    const list = await page.eval(`[...document.querySelectorAll("#risk-list .rr-pct")].map((x) => ${PCT}(x.textContent))`);
    assert.equal(list.length, 10);
    for (let i = 1; i < list.length; i++) assert.ok(list[i] >= list[i - 1], `sorted by shown %: ${list}`);
    // No "risk" wording outside "More numbers" on the globe page.
    assert.ok(!/Risk of shrinking|Most at risk/i.test(await page.eval(`document.getElementById("view-globe").textContent`)));
    // The list took the card's place; pick Brazil again. Switching the scenario re-words the chip.
    assert.equal(await page.eval(`document.getElementById("card").hidden`), true, "the list replaces the card");
    await page.eval(`document.getElementById("risk-btn").click(), FT.home.selectFromSearch("BRA"), 0`);
    await page.waitFor(`!document.getElementById("card").hidden`, 2000);
    await page.eval(`document.querySelector('#dock .seg[data-s="constant"]').click(), 0`);
    await sleep(300);
    assert.match(await page.eval(`document.getElementById("card-risk").getAttribute("title") ?? document.querySelector("#card-risk .risk-chip").title`), /if birth rates stay the same/);
  } finally {
    await page.close();
  }
  const rk = await openPage({ path: "/rankings" });
  try {
    assert.deepEqual(await rk.eval(`[...document.querySelectorAll("#rk-tabs [role=tab]")].map((t) => t.textContent)`), ["Shrinking most by 2100", "Fewest babies"]);
    const rows = await rk.eval(`[...document.querySelectorAll("#rk-list .rk-row")].map((r) => ({ word: r.querySelector(".rk-risk b")?.textContent, pct: ${PCT}(r.querySelector(".rk-pct").textContent) }))`);
    assert.equal(rows.length, 25, "top 25 first");
    for (const r of rows) assert.equal(r.word, await rk.eval(`${BUCKET}(${r.pct})`), JSON.stringify(r));
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].pct >= rows[i - 1].pct);
    await rk.eval(`document.getElementById("rk-more").click(), 0`);
    assert.ok((await rk.eval(`document.querySelectorAll("#rk-list .rk-row").length`)) >= 150, "Show all");
    assert.equal(await rk.eval(`document.getElementById("rk-small-wrap").open`), false, "small places start folded");
    assert.ok(!/Very high|Medium|Moderate|Critical/.test(await rk.eval(`document.getElementById("rk-list").textContent`)), "no API tier words in the rows");
  } finally {
    await rk.close();
  }
  const cv = await openPage({ path: "/country/JAM" });
  try {
    const m = await cv.eval(`({ on: document.querySelector("#cv-meter .meter-seg.on .meter-word").textContent, title: document.querySelector("#cv-meter .meter-title").textContent, verdict: document.getElementById("cv-verdict").textContent, hero: document.querySelector(".hero").textContent })`);
    assert.equal(m.on, await cv.eval(`${BUCKET}(${PCT}(${JSON.stringify(m.title)}))`), JSON.stringify(m));
    assert.ok(!/risk/i.test(m.hero), "no risk wording in the hero");
    assert.match(await cv.eval(`document.getElementById("more-body").textContent`), /Risk score \(0–100\), how it works →/);
  } finally {
    await cv.close();
  }
});

test("B2 the globe is full view: about the viewport height on desktop, edge to edge on phones", opts, async () => {
  for (const [vp, check] of [
    [{ width: 1440, height: 900 }, (f) => f.r * 2 >= 0.9 * 900 && Math.abs(f.cx - 720) < 2],
    [{ width: 1280, height: 720 }, (f) => f.r * 2 >= 0.9 * 720],
    [{ width: 390, height: 844, mobile: true }, (f) => f.r * 2 >= 390],
  ]) {
    const page = await openPage(vp);
    try {
      const f = await page.eval(`${G}.frame`);
      assert.ok(check(f), `${vp.width}×${vp.height}: ${JSON.stringify(f)}`);
    } finally {
      await page.close();
    }
  }
});

test("B3 the top bar never overlaps itself from 700 to 1280 px", opts, async () => {
  for (const width of [700, 768, 820, 1000, 1024, 1180, 1280]) {
    for (const path of ["/?year=2100", "/rankings"]) {
      const page = await openPage({ width, height: 800, path });
      try {
        const r = await page.eval(`(() => {
          const box = (el) => { if (!el || getComputedStyle(el).display === "none") return null; const b = el.getBoundingClientRect(); return b.width ? b : null; };
          const items = { word: box(document.querySelector(".wordmark")), search: box(document.getElementById("search-wrap")), nav: box(document.getElementById("topnav")), menu: box(document.getElementById("menu-btn")), kbd: box(document.querySelector(".search-kbd")) };
          const bad = [];
          const keys = Object.keys(items).filter((k) => items[k] && k !== "kbd");
          for (const a of keys) for (const b of keys) if (a < b && items[a].right > items[b].left && items[b].right > items[a].left) bad.push(a + "/" + b);
          if (items.kbd) for (const k of ["nav", "menu", "word"]) if (items[k] && items.kbd.right > items[k].left && items[k].right > items.kbd.left) bad.push("kbd/" + k);
          return { bad, navOrMenu: !!(items.nav || items.menu), sw: document.documentElement.scrollWidth };
        })()`);
        assert.deepEqual(r.bad, [], `${width}px ${path}`);
        assert.ok(r.navOrMenu, `${width}px: nav or menu reachable`);
        assert.ok(r.sw <= width, `${width}px: horizontal overflow`);
      } finally {
        await page.close();
      }
    }
  }
});

test("B4 the intro starts with the first painted frame, stops on the first touch, then hands over with a hint", opts, async () => {
  const page = await openPage({ path: "/", ready: `!!window.FT && FT.home && FT.home.globe.ready` });
  try {
    await page.waitFor(`FT.state.playing && FT.state.intro`, 600);
    // Touching the slider during the intro stops it at once and hands over.
    const y = await page.eval(`Math.round(FT.state.year)`);
    await page.eval(`(() => { const r = document.getElementById("globe-year"); r.value = String(${y}); r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(120);
    assert.deepEqual(await page.eval(`({ playing: FT.state.playing, intro: FT.state.intro, touched: FT.state.touched })`), { playing: false, intro: false, touched: true });
    assert.equal(await page.eval(`document.querySelector("#dock .tc-bubble").hidden`), true);
  } finally {
    await page.close();
  }
  // Left alone, the intro ends at 2100 and the slider asks to be dragged until Play is pressed.
  const idle = await openPage({ path: "/", ready: `!!window.FT && FT.home && FT.home.globe.ready` });
  try {
    await idle.waitFor(`!FT.state.playing && Math.round(FT.state.year) === 2100`, 12000);
    const hint = await idle.eval(`({ bubble: !document.querySelector("#dock .tc-bubble").hidden, text: document.querySelector("#dock .tc-bubble").textContent, pulse: document.getElementById("globe-year").classList.contains("hint"), anim: getComputedStyle(document.querySelector("#dock .tc-slider"), "::after").animationName, touched: FT.state.touched })`);
    assert.deepEqual(hint, { bubble: true, text: "Drag me", pulse: true, anim: "hint-ring", touched: false });
    // The year label clears the thumb's halo at the start of the track.
    const gap = await idle.eval(`(() => { const r = document.getElementById("globe-year"); r.value = "2026"; r.dispatchEvent(new Event("input", { bubbles: true })); return document.querySelector("#dock .tc-slider").getBoundingClientRect().left - document.querySelector("#dock .tc-year-num").getBoundingClientRect().right; })()`);
    assert.ok(gap >= 20, `year label clears the thumb halo: ${gap}px`);
    await idle.eval(`document.querySelector(".tc-play").click(), 0`);
    await sleep(100);
    assert.equal(await idle.eval(`document.querySelector("#dock .tc-bubble").hidden`), true);
    assert.equal(await idle.eval(`FT.state.touched`), true);
  } finally {
    await idle.close();
  }
});

test("S3 the hover tooltip goes away on a click and while the globe flies, and comes back on the next move", opts, async () => {
  const page = await openPage({ path: "/?year=2070" });
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    await settle(page);
    const p = await page.eval(`${G}.screenOf("IND")`);
    await page.mouse("mouseMoved", p.x, p.y);
    await page.waitFor(`!document.getElementById("globe-tip").hidden`, 2000);
    await page.click(p.x, p.y);
    await sleep(80);
    assert.equal(await page.eval(`document.getElementById("globe-tip").hidden`), true, "hidden on pick");
    await sleep(300);
    assert.equal(await page.eval(`document.getElementById("globe-tip").hidden`), true, "hidden while flying");
    await settle(page);
    const q = await page.eval(`${G}.screenOf("IND")`);
    await page.mouse("mouseMoved", q.x + 2, q.y + 2);
    await page.waitFor(`!document.getElementById("globe-tip").hidden && document.querySelector("#globe-tip .tip-name").textContent === "India"`, 2000);
  } finally {
    await page.close();
  }
});

test("S5 flicks never pin the globe on a pole, and fly-to stays north up", opts, async () => {
  const page = await openPage({ path: "/?year=2100" });
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    const f = await page.eval(`${G}.frame`);
    await page.drag(f.cx, f.cy - 100, f.cx + 40, f.cy + 300, 5, 8); // fast flick pulling the north pole into view
    const t0 = Date.now();
    await settle(page, 2500);
    const settled = Date.now() - t0;
    const rot = await page.eval(`${G}.rotation`);
    assert.ok(Math.abs(rot[1]) <= 72.001, `center latitude ${-rot[1]}`);
    assert.ok(settled < 1500, `came to rest in ${settled} ms`);
    await page.eval(`${G}.flyTo("RUS"), 0`);
    await settle(page, 6000);
    const r2 = await page.eval(`${G}.rotation`);
    assert.ok(Math.abs(r2[1]) <= 60.001, `Russia fly-to center latitude ${-r2[1]}`);
  } finally {
    await page.close();
  }
});

test("S8 flying to a small place keeps its neighbours in view", opts, async () => {
  const page = await openPage({ path: "/?year=2100&focus=SGP" });
  try {
    await page.waitFor(`FT.home.selected === "SGP"`);
    await settle(page, 6000);
    const k = await page.eval(`${G}.k`);
    assert.ok(k <= 7.001, `k=${k}`);
    const near = await page.eval(`["MYS", "IDN"].map((c) => ${G}.screenOf(c)).filter((p) => p && p.x > 0 && p.x < innerWidth && p.y > 0 && p.y < innerHeight).length`);
    assert.ok(near >= 1, "Malaysia or Indonesia stays on screen");
  } finally {
    await page.close();
  }
});

test("S1 S2 S7: no focus ring after a mouse drag; + never zooms into empty ocean; the readout follows the thumb", opts, async () => {
  const page = await openPage({ path: "/?year=2100" });
  try {
    await page.eval(`${G}.stopSpin(), 0`);
    const f = await page.eval(`${G}.frame`);
    await page.drag(f.cx, f.cy, f.cx + 80, f.cy, 6, 16);
    await settle(page);
    assert.equal(await page.eval(`getComputedStyle(document.getElementById("globe")).boxShadow`), "none", "no ring around the viewport after a mouse drag");
    // Point the center at open ocean, then press + four times: there is land in the middle of the view.
    await page.eval(`${G}.flyTo("MDV", { zoom: 1 }), 0`);
    await settle(page, 6000);
    for (let i = 0; i < 4; i++) {
      await page.eval(`document.getElementById("zoom-in").click(), 0`);
      await sleep(500);
    }
    await settle(page);
    const hit = await page.eval(`${G}.centerPick()`);
    assert.ok(hit && hit.rec, `land at the center after zooming: ${JSON.stringify(hit && hit.iso3)}`);
    const kk = await page.eval(`${G}.k`);
    assert.ok(kk >= 15.9, `k after four + clicks: ${kk}`);
    // Dragging the range thumb: the readout is the thumb's year, with no lag.
    await page.eval(`(() => { const r = document.getElementById("globe-year"); r.value = "2047"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    assert.equal(await page.eval(`document.querySelector("#dock .tc-year-num").textContent`), "2047");
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ Codex review fixes

test("a hidden globe schedules no frames, and draws again when shown", opts, async () => {
  const page = await openPage({ path: "/?year=2100" });
  try {
    assert.equal(await page.eval(`${G}.spinning`), true, "the idle spin is running before we leave");
    await page.eval(`FT.navigate("/rankings"), 0`);
    await page.waitFor(`!document.getElementById("view-rankings").hidden`);
    await sleep(300);
    const counted = await page.eval(`new Promise((resolve) => {
      let n = 0;
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = (fn) => { n++; return raf.call(window, fn); };
      setTimeout(() => { window.requestAnimationFrame = raf; resolve({ n, scheduled: ${G}.scheduled }); }, 1000);
    })`);
    assert.deepEqual(counted, { n: 0, scheduled: false }, "no animation frames while the globe is hidden");
    const draws = await page.eval(`${G}.stats.draws`);
    await page.eval("history.back(), 0");
    await page.waitFor(`!document.getElementById("view-globe").hidden`);
    await page.waitFor(`${G}.stats.draws > ${draws}`, 3000);
    assert.equal(await page.eval(`${G}.spinning`), true, "the spin resumes");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("touching a slider on another page stops the idle spin for good", opts, async () => {
  const page = await openPage({ path: "/?year=2100" });
  try {
    assert.equal(await page.eval(`${G}.spinning`), true, "the idle spin is running before we leave");
    await page.eval(`FT.navigate("/country/TWN"), 0`);
    await page.waitFor(`!document.getElementById("view-country").hidden && !!document.querySelector("#cv-controls input.tc-range")`);
    await page.eval(`(() => { const r = document.querySelector("#cv-controls input.tc-range"); r.value = String(Number(r.max) - 1); r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.eval("history.back(), 0");
    await page.waitFor(`!document.getElementById("view-globe").hidden`);
    await sleep(400);
    assert.equal(await page.eval(`${G}.spinning`), false, "the spin stays stopped after an interaction while hidden");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("a failed map download shows Retry, and the globe recovers on Retry or on the next visit", opts, async () => {
  let failing = true;
  let sid = null;
  const onPaused = (msg) => {
    if (msg.method !== "Fetch.requestPaused" || msg.sessionId !== sid) return;
    const { requestId } = msg.params;
    if (failing) send("Fetch.failRequest", { requestId, errorReason: "Failed" }, sid).catch(() => {});
    else send("Fetch.continueRequest", { requestId }, sid).catch(() => {});
  };
  listeners.add(onPaused);
  const setup = async (s, sessionId) => {
    sid = sessionId;
    await s("Fetch.enable", { patterns: [{ urlPattern: "*/geo/countries-110m.json*" }] });
  };
  const page = await openPage({ path: "/?year=2100", ready: `!!window.FT && !document.getElementById("geo-error").hidden`, setup });
  try {
    assert.equal(await page.eval(`document.getElementById("geo-error").textContent.includes("Couldn't load the map.")`), true);
    assert.deepEqual(page.errors, [], "no unhandled rejection");
    failing = false;
    await page.eval(`document.getElementById("geo-retry").click(), 0`);
    await page.waitFor(`${G}.ready && document.getElementById("geo-error").hidden`, 8000);
  } finally {
    await page.close();
  }
  failing = true;
  const again = await openPage({ path: "/?year=2100", ready: `!!window.FT && !document.getElementById("geo-error").hidden`, setup });
  try {
    failing = false;
    await again.eval(`FT.navigate("/rankings"), 0`);
    await again.waitFor(`!document.getElementById("view-rankings").hidden`);
    await again.eval("history.back(), 0");
    await again.waitFor(`${G}.ready && document.getElementById("geo-error").hidden`, 8000);
    assert.deepEqual(again.errors, []);
  } finally {
    listeners.delete(onPaused);
    await again.close();
  }
});

test("Skip to content moves focus to the main content and keeps the page, year and scenario", opts, async () => {
  const page = await openPage({ path: "/country/TWN?year=2070&scenario=constant" });
  try {
    await page.eval(`document.activeElement && document.activeElement.blur(), 0`);
    await page.key("Tab", { vk: 9 });
    assert.equal(await page.eval(`document.activeElement.className`), "skip-link");
    await page.key("Enter", { text: "\r", vk: 13 });
    await sleep(200);
    assert.equal(await page.eval(`document.activeElement.id`), "main");
    assert.equal(await page.eval(`location.pathname + location.search`), "/country/TWN?year=2070&scenario=constant");
    assert.deepEqual(await page.eval(`({ year: Math.round(FT.state.year), scenario: FT.state.scenario })`), { year: 2070, scenario: "constant" });
    assert.equal(await page.eval(`document.getElementById("view-country").hidden`), false);
  } finally {
    await page.close();
  }
});

// ------------------------------------------------------------------ night mode, email, the card, shared pictures

test("night mode follows the system: the page and the globe switch palettes live, without a reload", opts, async () => {
  const page = await openPage({ dark: true });
  try {
    const bg = () => page.eval(`getComputedStyle(document.body).backgroundColor`);
    assert.equal(await bg(), "rgb(18, 21, 24)");
    assert.equal(await page.eval(`${G}.theme`), "dark");
    await page.s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await page.waitFor(`${G}.theme === "light"`, 2000);
    assert.equal(await bg(), "rgb(246, 244, 239)");
    await page.s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await page.waitFor(`${G}.theme === "dark"`, 2000);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("Email us always does something: Gmail and Outlook open a ready message, the mail app and Copy are there too", opts, async () => {
  const page = await openPage({});
  try {
    await page.eval(`document.getElementById("fb-btn").click(), 0`);
    await page.waitFor(`!document.getElementById("fb-panel").hidden`, 2000);
    assert.equal(await page.eval(`document.getElementById("fb-email-choices").hidden`), true);
    await page.eval(`document.getElementById("fb-email-btn").click(), 0`);
    const links = await page.eval(`[...document.querySelectorAll("#fb-email-choices a")].map((a) => ({ mail: a.dataset.mail, href: a.href, target: a.target }))`);
    assert.deepEqual(links.map((l) => l.mail), ["gmail", "outlook", "mail-app"]);
    const gmail = new URL(links[0].href);
    assert.equal(gmail.origin, "https://mail.google.com");
    assert.equal(gmail.searchParams.get("to"), "andromedus+fertility@mail.grokbot.com");
    assert.match(gmail.searchParams.get("body"), /^Page: https:\/\/fertility-tracker-live\.vercel\.app\//);
    assert.equal(links[0].target, "_blank");
    assert.equal(new URL(links[1].href).origin, "https://outlook.live.com");
    assert.match(links[2].href, /^mailto:andromedus\+fertility@mail\.grokbot\.com\?subject=/);
    assert.equal(await page.eval(`document.getElementById("fb-email-btn").getAttribute("aria-expanded")`), "true");
    assert.equal(await page.eval(`!!document.getElementById("fb-email-copy")`), true);
    // The country page's "Email us" opens the same choice, with the place in the subject.
    await page.eval(`FT.navigate("/country/JPN"), 0`);
    await page.waitFor(`!!document.getElementById("cv-email-btn")`, 4000);
    await page.eval(`document.getElementById("more").open = true; document.getElementById("cv-email-btn").click(), 0`);
    const su = await page.eval(`new URL(document.querySelector("#cv-email-choices a[data-mail=gmail]").href).searchParams.get("su")`);
    assert.equal(su, "Fertility Tracker feedback: Japan");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("the card opens on the left and the zoom buttons never move", opts, async () => {
  const page = await openPage({});
  try {
    const ctrl = () => page.eval(`(() => { const r = document.getElementById("zoom-ctrl").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()`);
    const before = await ctrl();
    await page.eval(`FT.home.selectFromSearch("FRA"), 0`);
    await page.waitFor(`!document.getElementById("card").hidden`, 3000);
    await sleep(400);
    assert.deepEqual(await ctrl(), before);
    const card = await page.eval(`(() => { const r = document.getElementById("card").getBoundingClientRect(); return { left: r.left, right: r.right }; })()`);
    assert.ok(card.left < 40 && card.right < before[0] - 200, `card on the left: ${JSON.stringify(card)}`);
  } finally {
    await page.close();
  }
});

test("Share makes a 1600×900 picture of the view; Post on X copies it and opens the post with the words and link", opts, async () => {
  const page = await openPage({ path: "/?year=2070&focus=JPN" });
  try {
    await page.waitFor(`FT.home.selected === "JPN" && !document.getElementById("card").hidden`, 3000);
    await settle(page, 8000);
    await page.eval(`(() => {
      window.__opened = null;
      window.__copied = 0;
      window.open = (u) => { window.__opened = u; return null; };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async () => { window.__copied++; }, writeText: async () => {} } });
    })()`);
    await page.eval(`document.getElementById("share-view").click(), 0`);
    await page.waitFor(`document.getElementById("snap").open && !document.getElementById("snap-img").hidden && document.getElementById("snap-img").complete && document.getElementById("snap-img").naturalWidth > 0`, 8000);
    assert.deepEqual(await page.eval(`[document.getElementById("snap-img").naturalWidth, document.getElementById("snap-img").naturalHeight]`), [1600, 900]);
    assert.match(await page.eval(`document.getElementById("snap-download").getAttribute("download")`), /^fertility-tracker-japan-2070\.png$/);
    await page.eval(`document.getElementById("snap-x").click(), 0`);
    await page.waitFor(`!!window.__opened`, 3000);
    const intent = new URL(await page.eval("window.__opened"));
    assert.equal(intent.origin + intent.pathname, "https://x.com/intent/post");
    assert.match(intent.searchParams.get("text"), /^Japan in 2070: for every 100 people today, about \d+ left \(UN forecast\)\./);
    assert.equal(intent.searchParams.get("url"), "https://fertility-tracker-live.vercel.app/?year=2070&focus=JPN");
    assert.equal(await page.eval("window.__copied"), 1);
    assert.match(await page.eval(`document.getElementById("snap-status").textContent`), /^Picture copied/);
    // While it is open, globe keys do nothing; Escape closes it.
    const k0 = await page.eval(`${G}.k`);
    await page.key("+", { code: "Equal", text: "+", vk: 187 });
    await sleep(300);
    assert.equal(await page.eval(`${G}.k`), k0);
    await page.key("Escape", { vk: 27 });
    await page.waitFor(`!document.getElementById("snap").open`, 2000);
    // The country page shares its chart.
    await page.eval(`FT.navigate("/country/TWN?year=2070"), 0`);
    await page.waitFor(`!document.getElementById("view-country").hidden && !!FT.country`, 4000);
    await page.eval(`document.getElementById("cv-share").click(), 0`);
    await page.waitFor(`document.getElementById("snap").open && !document.getElementById("snap-img").hidden && document.getElementById("snap-img").naturalWidth === 1600`, 8000);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("born, died, moved follows the slider and adds up to the change", opts, async () => {
  const page = await openPage({ path: "/country/DEU?year=2070" });
  try {
    await page.waitFor(`document.querySelector("#why-born .tile-span")?.textContent === "From now to 2070 (UN forecast)"`, 6000);
    // The numbers are readable by screen readers; only the bars are hidden.
    assert.match(await page.eval(`document.querySelector("#why-born .bd-pic").getAttribute("aria-hidden") ?? "visible"`), /visible/);
    const vals = await page.eval(`[...document.querySelectorAll("#why-born .bd-row")].map((r) => r.className.replace("bd-row ", ""))`);
    assert.deepEqual(vals, ["born", "died", "moved"]);
    await page.eval(`(() => { const i = document.querySelector("#cv-controls input.tc-range"); i.value = "2100"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await page.waitFor(`document.querySelector("#why-born .tile-span")?.textContent === "From now to 2100 (UN forecast)"`, 3000);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("the share dialog survives a second click, and a page change or Back closes it", opts, async () => {
  const page = await openPage({ path: "/?year=2070&focus=JPN" });
  try {
    await page.waitFor(`FT.home.selected === "JPN"`, 3000);
    await settle(page, 8000);
    // Two clicks in a row: one dialog, showing the second picture, whose file still loads.
    await page.eval(`document.getElementById("share-view").click(), document.getElementById("share-view").click(), 0`);
    await page.waitFor(`document.getElementById("snap").open && document.getElementById("snap-img").naturalWidth === 1600`, 8000);
    await sleep(300);
    assert.equal(await page.eval(`(async () => (await fetch(document.getElementById("snap-img").src)).ok)()`), true);
    assert.equal(await page.eval(`document.querySelectorAll("dialog.snap").length`), 1);
    // Closed and opened again in the same moment: the new picture shows.
    await page.eval(`document.getElementById("snap").close(), document.getElementById("share-view").click(), 0`);
    await sleep(500);
    await page.waitFor(`document.getElementById("snap").open && document.getElementById("snap-img").naturalWidth === 1600 && !document.getElementById("snap-x").disabled`, 8000);
    // A Post on X still copying when the dialog closes never opens X.
    await page.eval(`(() => {
      window.__opened = null;
      window.open = (u) => { window.__opened = u; return null; };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: () => new Promise((r) => (window.__finishCopy = r)), writeText: async () => {} } });
    })()`);
    await page.eval(`document.getElementById("snap-x").click(), 0`);
    await page.waitFor(`typeof window.__finishCopy === "function"`, 2000);
    await page.eval(`document.getElementById("snap-close").click(), window.__finishCopy(), 0`);
    await sleep(300);
    assert.equal(await page.eval("window.__opened"), null);
    assert.equal(await page.eval(`document.getElementById("snap").open`), false);
    await page.eval(`document.getElementById("share-view").click(), 0`);
    await page.waitFor(`document.getElementById("snap").open && document.getElementById("snap-img").naturalWidth === 1600`, 8000);
    // A page change closes it.
    await page.eval(`FT.navigate("/country/JPN?year=2070"), 0`);
    await page.waitFor(`!document.getElementById("view-country").hidden`, 4000);
    assert.equal(await page.eval(`document.getElementById("snap").open`), false);
    // So does Back, from the country page's picture.
    await page.eval(`document.getElementById("cv-share").click(), 0`);
    await page.waitFor(`document.getElementById("snap").open`, 4000);
    await page.eval(`history.back(), 0`);
    await page.waitFor(`!document.getElementById("view-globe").hidden && !document.getElementById("snap").open`, 4000);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test("every place has its own share page: a country link previews that country; unknown codes are a real 404", opts, async () => {
  const twn = await fetch(`${base}/country/TWN`);
  assert.equal(twn.status, 200);
  const html = await twn.text();
  assert.match(html, /<meta property="og:image" content="https:\/\/fertility-tracker-live\.vercel\.app\/og\/TWN\.jpg">/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/fertility-tracker-live\.vercel\.app\/og\/TWN\.jpg">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/fertility-tracker-live\.vercel\.app\/country\/TWN">/);
  assert.match(html, /<meta property="og:title" content="Taiwan: [^"]+ people by 2100, [^"]+ vs today">/);
  assert.equal((await fetch(`${base}/country/XXX`)).status, 404);
  const kor = await fetch(`${base}/KOR`, { redirect: "manual" });
  assert.equal(kor.status, 307);
  assert.equal(kor.headers.get("location"), "/country/KOR");
  // Lower-case links redirect on the server too, so link previews follow them.
  const twnLower = await fetch(`${base}/country/twn`, { redirect: "manual" });
  assert.equal(twnLower.status, 307);
  assert.equal(twnLower.headers.get("location"), "/country/TWN");
  const korLower = await fetch(`${base}/kor`);
  assert.equal(korLower.status, 200);
  assert.equal(new URL(korLower.url).pathname, "/country/KOR");
  // The 404 page names the missing code and doesn't send the browser round in circles.
  const page = await openPage({ path: "/country/XXX", ready: `document.readyState === "complete"` });
  try {
    await page.waitFor(`document.getElementById("nf-title")?.textContent === "We don't have a place with the code XXX."`, 3000);
    await sleep(300);
    assert.equal(await page.eval("location.pathname"), "/country/XXX");
  } finally {
    await page.close();
  }
});
