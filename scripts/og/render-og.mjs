#!/usr/bin/env node
// Re-render public/og.png (1200×630 social card) from public/og.html with headless Chrome.
// Zero dependencies: serves public/ on a local port, screenshots og.html, writes public/og.png.
//
//   node scripts/og/render-og.mjs            # uses $CHROME_BIN, google-chrome, chromium or the macOS app
//
// In GitHub Actions (Ubuntu runners ship google-chrome), run it after the data step and commit og.png with the data.

import { createServer } from "node:http";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../public");
const out = path.join(publicDir, "og.png");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? "google-chrome";
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const file = path.join(publicDir, p || "og.html");
    if (!file.startsWith(publicDir)) throw new Error("outside public/");
    const st = await stat(file);
    const target = st.isDirectory() ? path.join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[path.extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const profile = await mkdtemp(path.join(tmpdir(), "ft-og-"));
const chrome = findChrome();
const args = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  "--virtual-time-budget=8000",
  `--screenshot=${out}`,
  `http://127.0.0.1:${port}/og.html`,
];
if (process.getuid?.() === 0) args.unshift("--no-sandbox");

const code = await new Promise((resolve) => {
  const child = spawn(chrome, args, { stdio: ["ignore", "inherit", "inherit"] });
  child.on("error", (err) => {
    console.error(`Could not start Chrome (${chrome}): ${err.message}`);
    resolve(1);
  });
  child.on("exit", resolve);
});
server.close();
await rm(profile, { recursive: true, force: true });
if (code !== 0 || !existsSync(out)) {
  console.error("og.png was not written");
  process.exit(1);
}
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
