// Static checks on the shipped front end (public/): scroll guardrails (DESIGN §3.4), agent-facing head tags (§6),
// feedback rules (§7), relative asset paths, vendored licences. No browser needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const read = (p) => readFile(path.join(root, p), "utf8");
const exists = async (p) => {
  try {
    await access(path.join(root, p));
    return true;
  } catch {
    return false;
  }
};

const html = await read("index.html");
const jsFiles = (await readdir(path.join(root, "js"))).filter((f) => f.endsWith(".js"));
const js = Object.fromEntries(await Promise.all(jsFiles.map(async (f) => [f, await read(`js/${f}`)])));
const countries = JSON.parse(await read("api/v1/countries.json")).countries;
const codes = new Set(countries.map((c) => c.iso3.toLowerCase()));

test("G2: no element id equals a country code in any letter case", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 20);
  for (const id of ids) assert.ok(!codes.has(id.toLowerCase()), `id="${id}" collides with a country code`);
  // Ids created at runtime are prefixed (opt-kor, row-kor, dlg-kor, chip-kor).
  for (const [f, src] of Object.entries(js)) {
    for (const m of src.matchAll(/id:\s*`([^`]*)`/g)) assert.match(m[1], /^[a-z]+-\$\{|^\$\{prefix\}-/, `${f}: runtime id ${m[1]} must be prefixed`);
  }
});

test("G1/G3/G4: replaceState only, every focus() avoids scrolling, no scrollIntoView", () => {
  for (const [f, src] of Object.entries(js)) {
    assert.ok(!/scrollIntoView/.test(src), `${f} uses scrollIntoView`);
    assert.ok(!/location\.hash\s*=[^=]/.test(src), `${f} assigns location.hash`);
    for (const m of src.matchAll(/\.focus\(([^)]*)\)/g)) assert.match(m[1], /preventScroll:\s*true/, `${f}: .focus(${m[1]}) must pass { preventScroll: true }`);
  }
  assert.ok(!/scrollIntoView/.test(html));
  assert.match(js["main.js"], /history\.replaceState\(null, "", `#\$\{iso3\}`\)/);
  // G9: scroll restoration is left alone.
  for (const src of Object.values(js)) assert.ok(!/scrollRestoration/.test(src));
});

test("pinch-zoom is never blocked", () => {
  const vp = html.match(/<meta name="viewport" content="([^"]+)"/)[1];
  assert.ok(!/user-scalable\s*=\s*no|maximum-scale/i.test(vp), vp);
});

test("head points people and agents at the data", () => {
  assert.match(html, /<link rel="service-desc" type="application\/json" href="api\/v1\/openapi\.json"/);
  assert.match(html, /<link rel="alternate" type="application\/json" href="api\/v1\/index\.json"/);
  assert.match(html, /<link rel="alternate" type="text\/plain" href="llms\.txt"/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "Dataset");
  const urls = ld.distribution.map((d) => d.contentUrl);
  for (const f of ["countries.json", "countries.csv", "timeseries.csv"]) assert.ok(urls.some((u) => u.endsWith(`/api/v1/${f}`)), f);
  assert.ok(ld.license && ld.creator && ld.name && ld.description);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/rostyslavdzhohola\.github\.io\/fertility-tracker\/og\.png">/);
  assert.match(html, /<meta property="og:image:width" content="1200">/);
});

test("noscript links the CSVs, api/ and llms.txt", () => {
  const ns = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
  for (const href of ["api/v1/countries.csv", "api/v1/timeseries.csv", "api/", "llms.txt"]) assert.ok(ns.includes(`href="${href}"`), href);
});

test("feedback: section anchor exists, no X link or twitter:site while the handle is a TODO_ placeholder", async () => {
  const fb = JSON.parse(await read("feedback.json"));
  assert.match(html, /<section[^>]*id="feedback"/);
  assert.match(html, /<section[^>]*id="data"/);
  assert.match(html, /<section[^>]*id="methodology"/);
  if (String(fb.x?.handle ?? "").startsWith("TODO_")) {
    assert.ok(!/twitter:site/.test(html));
    assert.ok(!html.includes("TODO_X_HANDLE"));
    assert.ok(!/x\.com\/(?!intent)/.test(html), "no X profile link in the static page");
  }
  for (const src of Object.values(js)) assert.ok(!src.includes("labels="), "never add labels= to issue URLs");
});

test("every local asset the page references exists and uses a relative path", async () => {
  const refs = [...html.matchAll(/\s(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:|data:)/.test(u));
  assert.ok(refs.length > 10);
  for (const r of refs) {
    assert.ok(!r.startsWith("/"), `${r} must be relative (site lives under /fertility-tracker/)`);
    const file = r === "./" ? "index.html" : r.endsWith("/") ? `${r}index.html` : r;
    assert.ok(await exists(file), `${r} is missing`);
  }
  // Module graph: every relative import resolves.
  for (const [f, src] of Object.entries(js)) {
    for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) assert.ok(await exists(path.join("js", m[1])), `${f} imports missing ${m[1]}`);
  }
  // Runtime fetches.
  for (const p of ["geo/countries-110m.json", "geo/world-points.json", "feedback.json", "api/v1/countries.json", "api/v1/risk.json", "api/v1/index.json"]) {
    assert.ok(await exists(p), p);
    assert.ok(js["main.js"].includes(p.replace(/^api\/v1\//, "")), `main.js should request ${p}`);
  }
  assert.ok(await exists(".nojekyll"));
});

test("no runtime CDN requests; vendored libraries keep their licence headers", async () => {
  for (const [f, src] of Object.entries(js)) assert.ok(!/https?:\/\/(cdn|unpkg|esm\.sh|jsdelivr|cdnjs|fonts\.)/.test(src), f);
  assert.ok(!/<script[^>]+src="https?:/.test(html));
  assert.ok(!/<link[^>]+rel="stylesheet"[^>]+href="https?:/.test(html));
  for (const f of ["d3-array.min.js", "d3-geo.min.js", "topojson-client.min.js"]) {
    const head = (await read(`vendor/${f}`)).slice(0, 600);
    assert.match(head, /Permission to use, copy, modify, and\/or distribute this software/, f);
  }
  assert.ok(await exists("geo/LICENSE-world-atlas.txt"));
});

test("world-points covers every data place without a 110m polygon", async () => {
  const topo = JSON.parse(await read("geo/countries-110m.json"));
  const points = JSON.parse(await read("geo/world-points.json"));
  const ids = new Set(topo.objects.countries.geometries.map((g) => g.id).filter(Boolean));
  const named = new Set(topo.objects.countries.geometries.filter((g) => g.id == null).map((g) => g.properties.name));
  const fallback = { XKX: "Kosovo" };
  for (const c of countries) {
    if (c.iso3 === "WLD") continue;
    const hasPoly = (c.isoNumeric && ids.has(c.isoNumeric)) || (fallback[c.iso3] && named.has(fallback[c.iso3]));
    assert.ok(hasPoly || points[c.iso3], `${c.iso3} ${c.name} has neither a polygon nor a dot`);
  }
  // The #1-ranked place must be reachable on the map.
  const first = countries.find((c) => c.risk?.rank === 1);
  assert.ok(first && ((first.isoNumeric && ids.has(first.isoNumeric)) || points[first.iso3]));
});
