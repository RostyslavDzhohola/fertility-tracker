// Static checks on the shipped front end (public/) for DESIGN-v3: scroll and focus guardrails, agent-facing head tags,
// feedback rules, root-absolute assets, Vercel rewrites, the 404 redirect, vendored licences and the first-paint budget.
// No browser needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo, "public");
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
const pages = { "index.html": html, "api/index.html": await read("api/index.html"), "404.html": await read("404.html"), "og.html": await read("og.html") };
const jsFiles = (await readdir(path.join(root, "js"))).filter((f) => f.endsWith(".js"));
const js = Object.fromEntries(await Promise.all(jsFiles.map(async (f) => [f, await read(`js/${f}`)])));
const allJs = Object.values(js).join("\n");
const css = await read("style.css");
const countries = JSON.parse(await read("api/v1/countries.json")).countries;
const codes = new Set(countries.map((c) => c.iso3.toLowerCase()));

test("country codes are never element ids, in any letter case", () => {
  for (const [name, src] of Object.entries(pages)) {
    for (const m of src.matchAll(/\sid="([^"]+)"/g)) assert.ok(!codes.has(m[1].toLowerCase()), `${name}: id="${m[1]}" collides with a country code`);
  }
  // Ids created at runtime are prefixed (opt-kor, globe-year, cv-year).
  for (const [f, src] of Object.entries(js)) {
    for (const m of src.matchAll(/id:\s*`([^`]*)`/g)) assert.match(m[1], /^[a-z]+-\$\{|^\$\{prefix\}-[a-z]+$/, `${f}: runtime id ${m[1]} must be prefixed`);
  }
});

test("focus never scrolls, nothing uses scrollIntoView, the hash is never assigned, scroll restoration is left alone", () => {
  for (const [f, src] of Object.entries(js)) {
    assert.ok(!/scrollIntoView/.test(src), `${f} uses scrollIntoView`);
    assert.ok(!/location\.hash\s*=[^=]/.test(src), `${f} assigns location.hash`);
    assert.ok(!/scrollRestoration/.test(src), `${f} touches scrollRestoration`);
    for (const m of src.matchAll(/\.focus\(([^)]*)\)/g)) assert.match(m[1], /preventScroll:\s*true/, `${f}: .focus(${m[1]}) must pass { preventScroll: true }`);
  }
  for (const src of Object.values(pages)) assert.ok(!/scrollIntoView/.test(src));
});

test("page changes push history; year, scenario and focus tweaks only replace it", () => {
  const main = js["main.js"];
  assert.match(main, /history\.pushState\(null, "", url\)/, "navigate() pushes");
  const pushes = [...allJs.matchAll(/history\.pushState\(/g)].length;
  assert.equal(pushes, 1, "pushState only in navigate()");
  assert.match(main, /const syncUrl = debounce\(/);
  assert.match(main.slice(main.indexOf("const syncUrl")), /history\.replaceState\(history\.state, "", url\)/);
  assert.ok(!/history\.(push|replace)State/.test(js["store.js"]), "the store never writes history (no spam while playing)");
});

test("pinch-zoom is never blocked; the globe canvas takes touch itself", () => {
  for (const [name, src] of Object.entries(pages)) {
    const vp = src.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? "";
    assert.ok(!/user-scalable\s*=\s*no|maximum-scale/i.test(vp), `${name}: ${vp}`);
  }
  const rule = css.match(/\.globe-canvas \{[^}]*\}/)[0];
  assert.match(rule, /touch-action:\s*none/);
});

test("head points people and agents at the data (root-absolute), with JSON-LD", () => {
  assert.match(html, /<link rel="service-desc" type="application\/json" href="\/api\/v1\/openapi\.json"/);
  assert.match(html, /<link rel="alternate" type="application\/json" href="\/api\/v1\/index\.json"/);
  assert.match(html, /<link rel="alternate" type="text\/plain" href="\/llms\.txt"/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "Dataset");
  const urls = ld.distribution.map((d) => d.contentUrl);
  for (const f of ["countries.json", "scenarios.json", "countries.csv", "timeseries.csv"]) assert.ok(urls.some((u) => u.endsWith(`/api/v1/${f}`)), f);
  assert.ok(ld.license && ld.creator && ld.name && ld.description);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/fertility-tracker-live\.vercel\.app\/og\.png">/);
  // Day and night follow the system (style.css has both palettes).
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(pages["api/index.html"], /<link rel="service-desc" type="application\/json" href="\/api\/v1\/openapi\.json">/);
});

test("noscript links the CSVs, the API docs and llms.txt", () => {
  const ns = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
  for (const href of ["/api/v1/countries.csv", "/api/v1/timeseries.csv", "/api/", "/llms.txt"]) assert.ok(ns.includes(`href="${href}"`), href);
});

test("feedback: no X link or twitter:site while the handle is a TODO_ placeholder; never labels=", async () => {
  const fb = JSON.parse(await read("feedback.json"));
  if (String(fb.x?.handle ?? "").startsWith("TODO_")) {
    for (const src of Object.values(pages)) {
      assert.ok(!/twitter:site/.test(src));
      assert.ok(!src.includes("TODO_X_HANDLE"));
      assert.ok(!/x\.com\/(?!intent)/.test(src), "no X profile link in static HTML");
    }
  }
  assert.ok(!allJs.includes("labels="), "never add labels= to issue URLs");
  assert.match(html, /id="fb-btn"/, "a Feedback entry point in the top bar");
});

test("every local asset the pages reference exists and is root-absolute", async () => {
  for (const [name, src] of Object.entries(pages)) {
    const refs = [...src.matchAll(/\s(?:src|href)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:|data:)/.test(u));
    for (const r of refs) {
      assert.ok(r.startsWith("/"), `${name}: ${r} must be root-absolute (pages are served from /country/… and /rankings)`);
      const p = r.replace(/^\//, "").split("?")[0];
      const file = p === "" ? "index.html" : p.endsWith("/") ? `${p}index.html` : p;
      if (/^(country\/|rankings$)/.test(p)) continue; // app routes, served by the rewrite
      if (p === "api/v1/status.json") continue; // written at deploy time (gitignored)
      assert.ok(await exists(file), `${name}: ${r} is missing`);
    }
  }
  // Module graph: every relative import resolves.
  for (const [f, src] of Object.entries(js)) {
    for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) assert.ok(await exists(path.join("js", m[1])), `${f} imports missing ${m[1]}`);
  }
  // Runtime fetches are root-absolute and exist.
  for (const p of ["/geo/countries-110m.json", "/geo/countries-50m.json", "/geo/world-points.json", "/feedback.json"]) {
    assert.ok(allJs.includes(`"${p}"`), `some module should fetch ${p}`);
    assert.ok(await exists(p.slice(1)), p);
  }
  assert.match(js["store.js"], /export const API = "\/api\/v1\/";/);
  for (const f of ["countries.json", "scenarios.json", "index.json"]) {
    assert.ok(allJs.includes(`\${API}${f}`), `fetches ${f}`);
    assert.ok(await exists(`api/v1/${f}`), f);
  }
  // No module builds a relative data URL that would break under /country/….
  for (const [f, src] of Object.entries(js)) assert.ok(!/fetch(?:Json)?\(\s*["'`](?!\/|\$\{API\}|https?:)/.test(src), `${f} has a relative fetch`);
});

test("Vercel serves the app's clean paths and the 404 sends short links to the country page", async () => {
  const vercel = JSON.parse(await readFile(path.join(repo, "vercel.json"), "utf8"));
  assert.equal(vercel.outputDirectory, "public");
  const rw = Object.fromEntries((vercel.rewrites ?? []).map((r) => [r.source, r.destination]));
  assert.equal(rw["/country/:iso3"], "/index.html");
  assert.equal(rw["/rankings"], "/index.html");
  for (const r of vercel.rewrites) assert.ok(!r.source.startsWith("/api"), "nothing rewrites the API");
  assert.ok(vercel.redirects.some((r) => r.source === "/api" && r.destination === "/api/"));

  const script = pages["404.html"].match(/<script>([\s\S]*?)<\/script>/)[1];
  const go = (pathname, search = "") => {
    let to = null;
    vm.runInNewContext(script, { location: { pathname, search, replace: (u) => (to = u) } });
    return to;
  };
  assert.equal(go("/KOR"), "/country/KOR");
  assert.equal(go("/kor/"), "/country/KOR");
  assert.equal(go("/fertility-tracker/JPN"), "/country/JPN");
  assert.equal(go("/country/twn/", "?year=2070"), "/country/TWN?year=2070");
  assert.equal(go("/rankings/"), "/rankings");
  assert.equal(go("/nope"), null);
  assert.equal(go("/api/v2/x.json"), null);
});

test("no runtime CDN requests; vendored libraries and world-atlas keep their licences", async () => {
  assert.ok(!/https?:\/\/(cdn|unpkg|esm\.sh|jsdelivr|cdnjs|fonts\.)/.test(allJs));
  for (const src of Object.values(pages)) {
    assert.ok(!/<script[^>]+src="https?:/.test(src));
    assert.ok(!/<link[^>]+rel="stylesheet"[^>]+href="https?:/.test(src));
  }
  for (const f of ["d3-array.min.js", "d3-geo.min.js", "topojson-client.min.js"]) {
    const head = (await read(`vendor/${f}`)).slice(0, 600);
    assert.match(head, /Permission to use, copy, modify, and\/or distribute this software/, f);
  }
  const lic = await read("geo/LICENSE-world-atlas.txt");
  assert.match(lic, /world-atlas@2\.0\.2 \(countries-110m\.json and countries-50m\.json, unmodified\)/);
  const t50 = JSON.parse(await read("geo/countries-50m.json"));
  assert.equal(t50.type, "Topology");
  assert.ok(t50.objects.countries.geometries.some((g) => g.id === "158"), "Taiwan has its own 50m outline");
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
});

test("first globe paint stays under 600 KB compressed (DESIGN-v3 §8)", async () => {
  // Everything the globe page needs before the lazy 50m outlines and per-country files.
  const lazy = new Set(["og.js", "apipage.js"]);
  const files = ["index.html", "style.css", "vendor/d3-array.min.js", "vendor/d3-geo.min.js", "vendor/topojson-client.min.js", ...jsFiles.filter((f) => !lazy.has(f)).map((f) => `js/${f}`), "api/v1/countries.json", "api/v1/scenarios.json", "geo/countries-110m.json", "geo/world-points.json"];
  let total = 0;
  for (const f of files) total += gzipSync(await readFile(path.join(root, f)), { level: 9 }).length;
  assert.ok(total < 600 * 1024, `first paint is ${Math.round(total / 1024)} KB gzipped`);
});

test("the accent color only styles interactive things", () => {
  // Every CSS rule that paints with --accent belongs to a control, a link, the slider, the focus ring or the chart's
  // year marker (which follows the slider and scrubs it).
  const interactive = /(a\b|a:|button|\.btn|\.seg|\.chip|\.tabs|\.tc-|\.search|\.icon-btn|\.pill-btn|\.view-mode|:focus|\.skip-link|\.topnav|\.risk-row|\.risk-all|\.text-btn|\.cv-more summary|\.whatif|\.opt-name b|\.marker|\.m-bubble|\.menu-btn|\.links|\.partners|summary|\.rk-small|\.rk-more|\.tc-bubble|\.tc-slider|\.share-fab)/;
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [sel, body] = [m[1].trim(), m[2]];
    if (!/var\(--accent\)|#2457ff/i.test(body) || sel.startsWith(":root") || sel.startsWith("@")) continue;
    assert.match(sel, interactive, `${sel} uses the accent but isn't interactive`);
  }
});
