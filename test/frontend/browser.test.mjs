// Headless-Chrome regression checks for the no-scroll-jump rule and map sizing (DESIGN §3.4, §2.2).
// Opt-in, because it launches Chrome:  FT_BROWSER_TESTS=1 node --test test/frontend/browser.test.mjs
// Zero dependencies: a static server for public/, Chrome's DevTools protocol over Node's built-in WebSocket,
// and real key events (Input.dispatchKeyEvent), so the browser's own caret and focus scrolling is exercised.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ENABLED = process.env.FT_BROWSER_TESTS === "1";
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
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

const COUNTRY_READY = `(() => { const n = document.getElementById("country-name"); return !!n && n.textContent.trim().length > 1 && !!document.querySelector("#pop-chart svg .proj-zone"); })()`;

async function openPage({ width, height, mobile = false, hash = "", path: urlPath = "/", ready = COUNTRY_READY, setup }) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s("Page.enable");
  if (setup) await setup(s, sessionId);
  await s("Page.navigate", { url: `${base}${urlPath}${hash}` });
  const page = {
    targetId,
    async eval(expr) {
      const r = await s("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    async key(key, { code, text, vk } = {}) {
      const down = { type: text ? "keyDown" : "rawKeyDown", key, code: code ?? key, windowsVirtualKeyCode: vk ?? 0, nativeVirtualKeyCode: vk ?? 0 };
      if (text) {
        down.text = text;
        down.unmodifiedText = text;
      }
      await s("Input.dispatchKeyEvent", down);
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, code: code ?? key, windowsVirtualKeyCode: vk ?? 0, nativeVirtualKeyCode: vk ?? 0 });
      await sleep(60);
    },
    async type(str) {
      for (const ch of str) await this.key(ch, { code: /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : undefined, text: ch, vk: ch.toUpperCase().charCodeAt(0) });
    },
    close: () => send("Target.closeTarget", { targetId }),
    waitFor: (expr, ms) => waitForOn(page, expr, ms),
  };
  await page.waitFor(ready);
  await sleep(300);
  return page;
}

async function waitForOn(page, expr, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.eval(expr).catch(() => false)) return true;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${expr}`);
}

before(async () => {
  if (!ENABLED) return;
  const bin = findChrome();
  if (!bin) throw new Error("FT_BROWSER_TESTS=1 but no Chrome found (set CHROME_BIN)");
  server = createServer(async (req, res) => {
    try {
      const p = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      let file = path.join(publicDir, p);
      if (!file.startsWith(publicDir)) throw new Error("outside");
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(path.join(tmpdir(), "ft-browser-test-"));
  const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
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

test("desktop: typing in search and selecting never moves the page (R1)", opts, async () => {
  const page = await openPage({ width: 1280, height: 800, hash: "#JPN" });
  try {
    for (const [y0, query, want] of [
      [1800, "KOR", "#KOR"],
      [4200, "TCD", "#TCD"],
      [1800, "Saint Vincent", "#VCT"],
      [1800, "Chad", "#TCD"],
    ]) {
      await page.eval(`(document.activeElement && document.activeElement.blur(), window.scrollTo(0, ${y0}), 0)`);
      await sleep(150);
      const start = await page.eval("window.scrollY");
      const height = await page.eval("document.documentElement.scrollHeight");
      const seen = [];
      await page.key("/", { code: "Slash", text: "/", vk: 191 });
      seen.push(["/", await page.eval("window.scrollY")]);
      for (const ch of query) {
        await page.type(ch);
        seen.push([ch, await page.eval("window.scrollY")]);
      }
      await page.key("ArrowDown", { vk: 40 });
      seen.push(["ArrowDown", await page.eval("window.scrollY")]);
      await page.key("Enter", { text: "\r", vk: 13 });
      await sleep(250);
      seen.push(["Enter", await page.eval("window.scrollY")]);
      for (const [step, y] of seen) assert.equal(y, start, `scrollY moved after "${step}" while searching "${query}" from ${start}: ${JSON.stringify(seen)}`);
      assert.equal(await page.eval("location.hash"), want);
      assert.equal(await page.eval("document.documentElement.scrollHeight"), height, "document height changed");
    }
  } finally {
    await page.close();
  }
});

test("desktop: list and map-free selections keep scrollY (R1)", opts, async () => {
  const page = await openPage({ width: 1280, height: 800, hash: "#TCD" });
  try {
    await page.eval("window.scrollTo(0, 1800), 0");
    await sleep(150);
    const y = await page.eval("window.scrollY");
    await page.eval(`document.getElementById("row-vct").click(), 0`);
    await sleep(250);
    assert.equal(await page.eval("window.scrollY"), y);
    await page.eval(`location.hash = "#jpn", 0`); // a user editing the URL
    await sleep(300);
    assert.equal(await page.eval("window.scrollY"), y);
    assert.equal(await page.eval("location.hash"), "#JPN");
  } finally {
    await page.close();
  }
});

test("mobile: Globe then Flat restores the full-width flat map", opts, async () => {
  const page = await openPage({ width: 390, height: 844, mobile: true, hash: "#KOR" });
  try {
    const frame = `(() => { const r = document.getElementById("map-frame").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), sw: document.documentElement.scrollWidth, vb: document.getElementById("map-svg").getAttribute("viewBox") }; })()`;
    const first = await page.eval(frame);
    assert.equal(first.w, 390, `initial flat frame ${JSON.stringify(first)}`);
    assert.equal(first.left, 0);
    for (let i = 0; i < 2; i++) {
      await page.eval(`document.getElementById("globe-toggle").click(), 0`);
      await sleep(400);
      const globe = await page.eval(frame);
      assert.equal(globe.w, 390, `globe frame ${JSON.stringify(globe)}`);
      await page.eval(`document.getElementById("globe-toggle").click(), 0`);
      await sleep(400);
      const flat = await page.eval(frame);
      assert.deepEqual({ w: flat.w, h: flat.h, left: flat.left, sw: flat.sw }, { w: first.w, h: first.h, left: 0, sw: 390 }, `flat after globe ${JSON.stringify(flat)}`);
      assert.equal(flat.vb, first.vb);
    }
  } finally {
    await page.close();
  }
});

test("mobile: what-if slider captions never overlap (default Hong Kong and others)", opts, async () => {
  for (const hash of ["", "#JPN", "#VCT", "#NER", "#WLD", "#ISR"]) {
    const page = await openPage({ width: 390, height: 844, mobile: true, hash });
    try {
      const r = await page.eval(`(() => {
        const a = document.getElementById("tick-country"), b = document.getElementById("tick-repl");
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const vis = (el, rr) => !el.hidden && rr.width > 0;
        return { a: vis(a, ra) ? [ra.left, ra.right, a.textContent] : null, b: [rb.left, rb.right], wrap: document.querySelector(".whatif-track").getBoundingClientRect().right };
      })()`);
      if (r.a) assert.ok(r.a[1] + 2 <= r.b[0] || r.b[1] + 2 <= r.a[0], `${hash || "default"}: captions overlap ${JSON.stringify(r)}`);
      assert.ok(r.b[1] <= r.wrap + 1, `${hash}: replacement caption overflows`);
    } finally {
      await page.close();
    }
  }
});

test("retry after a failed countries.json rebuilds every map join (C)", opts, async () => {
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
    width: 1280,
    height: 800,
    hash: "#KOR",
    ready: `!document.getElementById("load-banner").hidden`,
    setup: async (s, sessionId) => {
      sid = sessionId;
      await s("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/countries.json*" }] });
    },
  });
  try {
    failing = false;
    await page.eval(`document.getElementById("load-retry").click(), 0`);
    await page.waitFor(COUNTRY_READY);
    const m = await page.eval(`(() => {
      const paths = [...document.querySelectorAll("#map-svg .land path[data-iso3]")];
      return {
        joined: paths.filter((p) => !p.dataset.iso3.startsWith("nodata-")).length,
        nodata: paths.filter((p) => p.dataset.iso3.startsWith("nodata-")).length,
        hatched: paths.filter((p) => p.getAttribute("fill") === "url(#map-hatch)").length,
        dots: document.querySelectorAll("#map-svg .dots circle").length,
        name: document.getElementById("country-name").textContent.trim(),
        banner: document.getElementById("load-banner").hidden,
      };
    })()`);
    assert.equal(m.nodata, 0, JSON.stringify(m));
    assert.equal(m.hatched, 0, JSON.stringify(m));
    assert.ok(m.joined >= 170, JSON.stringify(m));
    assert.ok(m.dots >= 230, JSON.stringify(m));
    assert.equal(m.name, "South Korea");
    assert.equal(m.banner, true);
  } finally {
    listeners.delete(onPaused);
    await page.close();
  }
});

test("API docs fit a 390px phone (F)", opts, async () => {
  const page = await openPage({ width: 390, height: 844, mobile: true, path: "/api/", ready: `document.readyState === "complete"` });
  try {
    const w = await page.eval(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
    assert.ok(w.sw <= w.cw, JSON.stringify(w));
  } finally {
    await page.close();
  }
});

test("mobile: mini-bar Map button is a focusable 44px target while visible; corridor rows are 44px (H, I)", opts, async () => {
  const page = await openPage({ width: 390, height: 844, mobile: true, hash: "#JPN" });
  try {
    const coarse = await page.eval(`matchMedia("(pointer: coarse)").matches`);
    assert.equal(coarse, true, "touch emulation should make (pointer: coarse) match");
    await page.waitFor(`document.querySelectorAll(".corridor-list button.corr-name").length > 0`);
    await page.eval(`window.scrollTo(0, document.querySelector(".c3").getBoundingClientRect().top + scrollY), 0`);
    await sleep(400);
    const bar = await page.eval(`(() => { const b = document.getElementById("minibar-map"); const r = b.getBoundingClientRect(); return { visible: document.getElementById("minibar").classList.contains("visible"), tab: b.tabIndex, h: r.height, hidden: b.closest("[aria-hidden=true]") != null }; })()`);
    assert.equal(bar.visible, true, JSON.stringify(bar));
    assert.equal(bar.tab, 0, JSON.stringify(bar));
    assert.equal(bar.hidden, false, "a focusable button must not sit inside aria-hidden");
    assert.ok(bar.h >= 44, JSON.stringify(bar));
    const hs = await page.eval(`[...document.querySelectorAll(".corridor-list button.corr-name")].map((b) => Math.round(b.getBoundingClientRect().height))`);
    assert.ok(hs.length >= 2 && hs.every((x) => x >= 44), JSON.stringify(hs));
    await page.eval(`window.scrollTo(0, 0), 0`);
    await sleep(400);
    assert.equal(await page.eval(`document.getElementById("minibar-map").tabIndex`), -1);
  } finally {
    await page.close();
  }
});

test("generation labels only wrap at spaces or hyphens (J)", opts, async () => {
  for (const vp of [
    { width: 1280, height: 800 },
    { width: 390, height: 844, mobile: true },
    { width: 360, height: 780, mobile: true },
  ]) {
    const page = await openPage({ ...vp, hash: "#JPN" });
    try {
      const bad = await page.eval(`(() => {
        const out = [];
        for (const el of document.querySelectorAll(".gen-label strong")) {
          const t = el.firstChild, text = t.textContent;
          let prevTop = null;
          for (let i = 0; i < text.length; i++) {
            const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1);
            const top = Math.round(r.getBoundingClientRect().top);
            if (prevTop != null && top > prevTop + 2 && !/[\s-]/.test(text[i - 1])) out.push(text);
            prevTop = top;
          }
        }
        return out;
      })()`);
      assert.deepEqual(bad, [], `mid-word breaks at ${vp.width}px`);
      const overflow = await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      assert.equal(overflow, 0, `horizontal overflow at ${vp.width}px`);
    } finally {
      await page.close();
    }
  }
});

test("keyboard map cursor tooltip says Press Enter for details (K)", opts, async () => {
  const page = await openPage({ width: 1280, height: 800, hash: "#JPN" });
  try {
    await page.eval(`document.getElementById("globe-toggle").focus({ preventScroll: true }), 0`);
    await page.key("Tab", { vk: 9 });
    assert.equal(await page.eval(`document.activeElement.id`), "map-svg");
    await page.key("ArrowLeft", { vk: 37 });
    await sleep(100);
    const hint = await page.eval(`(() => { const t = document.getElementById("map-tooltip"); return t.hidden ? null : t.querySelector(".tt-hint")?.textContent; })()`);
    assert.equal(hint, "Press Enter for details");
  } finally {
    await page.close();
  }
});

test("projection figures name their baseline; growth copy names no invented cause (D, E)", opts, async () => {
  const page = await openPage({ width: 1280, height: 800, hash: "#NGA" });
  try {
    const nga = await page.eval(`({ kpi: document.getElementById("kpi-pop").textContent, sub: document.getElementById("kpi-pop-sub").textContent, summary: document.getElementById("cv-summary").textContent })`);
    assert.equal(nga.kpi, "+109% vs 2023");
    assert.equal(nga.sub, "228M in 2023 → 477M in 2100 (UN projection)");
    assert.match(nga.summary, /\(\+109% vs 2023\)/);
    await page.eval(`location.hash = "#IND", 0`);
    await page.waitFor(`document.getElementById("country-name").textContent === "India"`);
    const ind = await page.eval(`document.getElementById("cv-summary").textContent`);
    assert.ok(!/immigra/i.test(ind), ind);
    assert.match(ind, /births still outnumber deaths for now/);
  } finally {
    await page.close();
  }
});

test("mobile: swapping countries keeps scrollY and the page height (R1, G5)", opts, async () => {
  const page = await openPage({ width: 390, height: 844, mobile: true, hash: "#TCD" });
  try {
    await page.eval("window.scrollTo(0, 2400), 0");
    await sleep(200);
    const y = await page.eval("window.scrollY");
    const h0 = await page.eval("document.documentElement.scrollHeight");
    for (const code of ["VCT", "WLD", "HKG", "BES", "TCD"]) {
      await page.eval(`location.hash = "#${code}", 0`);
      await sleep(350);
      assert.equal(await page.eval("window.scrollY"), y, `scrollY after #${code}`);
      assert.equal(await page.eval("document.documentElement.scrollHeight"), h0, `scrollHeight after #${code}`);
    }
  } finally {
    await page.close();
  }
});
