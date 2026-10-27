// Shared test helpers (not a test file: node --test only picks up *.test.mjs here).

// Remove inline code spans (GitHub renders nothing inside them), leaving the text GitHub would parse.
export const outsideCodeSpans = (md) => md.replace(/(`+) [^\n]*? \1/g, "");

export const json = (v) => ({ type: "application/json", body: JSON.stringify(v) });
const js = (body) => ({ type: "text/javascript", body });

// Synthetic country codes: JPN and KOR first (tests look for them), then AAA, AAB, ... up to n.
export function countryCodes(n) {
  const codes = ["JPN", "KOR"];
  for (let i = 0; codes.length < n; i++) {
    const code = String.fromCharCode(65 + Math.floor(i / 676) % 26, 65 + Math.floor(i / 26) % 26, 65 + (i % 26));
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * A small but internally consistent copy of the live site: home page with scripts, a module graph, map data,
 * and an API whose counts, ranks, CSV rows and summary/detail records agree. Keys are paths under the site base.
 */
export function makeSite({ n = 160 } = {}) {
  const codes = countryCodes(n);
  const name = (c) => ({ JPN: "Japan", KOR: "South Korea" })[c] ?? `Country ${c}`;
  const countries = codes.map((iso3) => ({ iso3, name: name(iso3), tfr: 1.5 }));
  const ranking = ["KOR", "JPN", ...codes.filter((c) => c !== "KOR" && c !== "JPN")].map((iso3, i) => ({ rank: i + 1, iso3, name: name(iso3), score: 95 - Math.min(i, 90), tier: "high" }));
  const site = {
    "": {
      type: "text/html",
      body: `<!doctype html><html><head><title>Fertility Tracker</title>
<link rel="canonical" href="https://example.org/">
<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">
<link rel="alternate" type="application/json" href="api/v1/index.json">
<link rel="preload" href="api/v1/countries.json" as="fetch" crossorigin>
<link rel="modulepreload" href="js/logic.js">
<link rel="stylesheet" href="style.css">
<script type="application/ld+json">{"@type":"Dataset"}</script>
<script defer src="vendor/lib.min.js"></script>
<script type="module" src="js/main.js"></script>
</head><body>map</body></html>`,
    },
    "style.css": { type: "text/css", body: "body{margin:0}" },
    "vendor/lib.min.js": js("window.lib={};"),
    "js/main.js": js(`import { a } from "./logic.js";\nimport {\n  draw,\n} from "./map.js";\nconst topo = await fetchJson("geo/countries-110m.json");\nconst pts = fetch(\`geo/world-points.json\`);\n`),
    "js/logic.js": js("export const a = 1;"),
    "js/map.js": js(`export function draw() {}\nexport * from "./dom.js";\nconst lazy = () => import("./lazy.js");`),
    "js/dom.js": js("export const d = 1;"),
    "js/lazy.js": js("export default 1;"),
    "geo/countries-110m.json": json({ type: "Topology", objects: { countries: { type: "GeometryCollection", geometries: [] } }, arcs: [] }),
    "geo/world-points.json": json({ JPN: [138, 36], KOR: [127, 37] }),
    "api/v1/index.json": json({
      apiVersion: "v1",
      generatedAt: "2024-07-12T00:00:00Z",
      counts: { records: n, ranked: n, unranked: 0 },
      sources: [{ id: "UN-WPP", name: "UN WPP 2024", vintage: "2024-07-12" }],
      endpoints: [
        { path: "countries.json", url: "countries.json" },
        { path: "countries/{iso3}.json", url: "countries/{iso3}.json", schema: "schema/country.schema.json" },
        { path: "risk.json", url: "risk.json" },
        { path: "countries.csv", url: "countries.csv" },
        { path: "openapi.json", url: "openapi.json" },
        { path: "status.json", url: "status.json" },
      ],
    }),
    "api/v1/schema/country.schema.json": json({
      type: "object",
      required: ["iso3", "name", "tfr"],
      properties: { iso3: { type: "string", pattern: "^[A-Z]{3}$" }, name: { type: "string" }, tfr: { type: ["number", "null"], minimum: 0 } },
    }),
    "api/v1/status.json": json({ apiVersion: "v1", checkedAt: new Date().toISOString(), refresh: "success", trigger: "schedule", dataChangedAt: "2024-07-12T00:00:00Z" }),
    "api/v1/countries.json": json({ apiVersion: "v1", count: n, countries }),
    "api/v1/risk.json": json({ apiVersion: "v1", ranking, unranked: [] }),
    "api/v1/countries.csv": { type: "text/csv", body: "iso3,name,tfr\n" + countries.map((c) => `${c.iso3},${c.name},${c.tfr}`).join("\n") + "\n" },
    "api/v1/openapi.json": json({ openapi: "3.1.0", paths: { "/countries.json": {} } }),
  };
  for (const c of countries) site[`api/v1/countries/${c.iso3}.json`] = json({ iso3: c.iso3, name: c.name, tfr: c.tfr, series: [[2023, c.tfr]] });
  return site;
}
