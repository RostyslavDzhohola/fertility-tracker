#!/usr/bin/env node
// Draw every place's link-preview card: public/og/<ISO3>.jpg (1200×630), from public/og-cards.html in headless Chrome.
// Zero dependencies: serves public/ on a local port and talks to Chrome over the DevTools protocol (Node's WebSocket).
//
//   node scripts/og/render-cards.mjs            # uses $CHROME_BIN, google-chrome, chromium or the macOS app
//
// The deploy workflow runs it after the data is final, before `vercel build`. The cards are not committed
// (.gitignore): every deploy draws them from the data it ships.

import { createServer } from "node:http";
import { readFile, stat, mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../public");
const outDir = path.join(publicDir, "og");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8" };

function findChrome() {
  return [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((c) => c && existsSync(c));
}

const server = createServer(async (req, res) => {
  try {
    const p = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const file = path.join(publicDir, p);
    if (!file.startsWith(publicDir)) throw new Error("outside public/");
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

const chromeBin = findChrome();
if (!chromeBin) {
  console.error("render-cards: no Chrome found (set CHROME_BIN)");
  process.exit(1);
}
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), "ft-cards-"));
const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
if (process.getuid?.() === 0) args.unshift("--no-sandbox");
const chrome = spawn(chromeBin, args, { stdio: ["ignore", "ignore", "pipe"] });

let ws;
let exitCode = 0;
try {
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
  let id = 1;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = id++;
      pending.set(i, { resolve, reject, method });
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  // Cards are always the day palette, whatever the machine's appearance.
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await s("Runtime.enable");
  await s("Page.enable");
  await s("Page.navigate", { url: `${base}/og-cards.html` });
  const evaluate = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const t0 = Date.now();
  while (!(await evaluate("!!window.FTCards").catch(() => false))) {
    if (Date.now() - t0 > 20000) throw new Error(`og-cards.html did not load${errors.length ? `: ${errors[0]}` : ""}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  await evaluate("document.fonts.ready.then(() => FTCards.ready())");
  const places = await evaluate("FTCards.cardPlaces()");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  let bytes = 0;
  for (const iso3 of places) {
    const url = await evaluate(`FTCards.renderCard(${JSON.stringify(iso3)})`);
    if (!url?.startsWith("data:image/jpeg;base64,")) throw new Error(`no card for ${iso3}`);
    const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    bytes += buf.length;
    await writeFile(path.join(outDir, `${iso3}.jpg`), buf);
  }
  if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
  const written = (await readdir(outDir)).length;
  console.log(`Wrote ${written} link-preview cards to public/og/ (${(bytes / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (err) {
  console.error(`render-cards: ${err.message}`);
  exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {}
  chrome.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
