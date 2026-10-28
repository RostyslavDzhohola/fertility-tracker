// Local preview server for public/ with Vercel-like routing: files first, then vercel.json redirects and rewrites,
// then 404.html. Zero dependencies.  Usage: node scripts/serve.mjs [port]   (default 8731)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(repoDir, "public");
const port = Number(process.argv[2] ?? 8731);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".csv": "text/csv", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml" };

const routeRe = (source) => new RegExp("^" + source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+") + "$");
const vercel = JSON.parse(await readFile(path.join(repoDir, "vercel.json"), "utf8"));
const redirects = (vercel.redirects ?? []).map((r) => [routeRe(r.source), r.destination]);
const rewrites = (vercel.rewrites ?? []).map((r) => [routeRe(r.source), r.destination]);

async function fileFor(p) {
  let file = path.join(publicDir, path.normalize(p).replace(/^([/\\])+/, ""));
  if (!file.startsWith(publicDir)) return null;
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    await stat(file);
    return file;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  for (const [re, dest] of redirects) if (re.test(p)) return res.writeHead(308, { location: dest }).end();
  let file = await fileFor(p);
  if (!file) for (const [re, dest] of rewrites) if (re.test(p) && (file = await fileFor(dest))) break;
  let status = 200;
  if (!file) [file, status] = [path.join(publicDir, "404.html"), 404];
  res.writeHead(status, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}).listen(port, "127.0.0.1", () => console.log(`Serving public/ at http://127.0.0.1:${port}/`));
