// Local preview server for public/ with Vercel-like routing: vercel.json redirects, then files, then rewrites, then
// 404.html. Builds the share pages first (scripts/pages/build-pages.mjs), as the deploy does. The link-preview cards
// are optional locally: node scripts/og/render-cards.mjs. Zero dependencies.
//   Usage: node scripts/serve.mjs [port]   (default 8731)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPages } from "./pages/build-pages.mjs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(repoDir, "public");
const port = Number(process.argv[2] ?? 8731);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".csv": "text/csv", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml" };

// A vercel.json source ("/country/:iso3", "/:code(AFG|ALB)") as a RegExp with named groups; fill() puts them back.
const routeRe = (source) =>
  new RegExp(
    "^" +
      source
        .split(/(:\w+(?:\([^)]*\))?)/)
        .map((part) => {
          const m = /^:(\w+)(?:\(([^)]*)\))?$/.exec(part);
          return m ? `(?<${m[1]}>${m[2] ?? "[^/]+"})` : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("") +
      "$",
  );
const fill = (dest, groups) => dest.replace(/:(\w+)/g, (all, k) => groups?.[k] ?? all);
const vercel = JSON.parse(await readFile(path.join(repoDir, "vercel.json"), "utf8"));
const redirects = (vercel.redirects ?? []).map((r) => [routeRe(r.source), r.destination, r.permanent === false ? 307 : 308]);
const rewrites = (vercel.rewrites ?? []).map((r) => [routeRe(r.source), r.destination]);
await buildPages();

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
  for (const [re, dest, code] of redirects) {
    const m = re.exec(p);
    if (m) return res.writeHead(code, { location: fill(dest, m.groups) }).end();
  }
  let file = await fileFor(p);
  if (!file) for (const [re, dest] of rewrites) if (re.test(p) && (file = await fileFor(dest))) break;
  let status = 200;
  if (!file) [file, status] = [path.join(publicDir, "404.html"), 404];
  res.writeHead(status, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
}).listen(port, "127.0.0.1", () => console.log(`Serving public/ at http://127.0.0.1:${port}/`));
