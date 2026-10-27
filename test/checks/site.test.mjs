import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessFreshness,
  assessWorkflowStates,
  buildSchemaMap,
  crossCheck,
  extractModuleRefs,
  extractPageAssets,
  schemaPathFor,
  shapeProblems,
  isLocalSite,
  assessWorkflowRuns,
  expandTemplate,
  extractEndpoints,
  extractTopRisk,
  findCountryRecords,
  kindFromPath,
  levelFor,
  parseCsv,
  requirement,
  toSitePath,
  validateResponse,
} from "../../scripts/checks/lib/site.mjs";

const SITE = "https://fertility-tracker-live.vercel.app/";
const ok = (text, contentType = "application/json") => ({ status: 200, contentType, text });

test("toSitePath resolves absolute, root-relative, api-relative and manifest-relative refs", () => {
  assert.equal(toSitePath(`${SITE}api/v1/risk.json`, SITE), "api/v1/risk.json");
  assert.equal(toSitePath("/api/v1/risk.json", SITE), "api/v1/risk.json");
  assert.equal(toSitePath("api/v1/risk.json", SITE), "api/v1/risk.json");
  assert.equal(toSitePath("countries.csv", SITE), "api/v1/countries.csv");
  assert.equal(toSitePath("./countries/{ISO3}.json", SITE), "api/v1/countries/{ISO3}.json");
  assert.equal(toSitePath("../../llms.txt", SITE), "llms.txt");
  assert.equal(toSitePath("https://api.worldbank.org/v2/x.json", SITE), null);
  assert.equal(toSitePath("https://other-project.vercel.app/x.json", SITE), null);
  assert.equal(toSitePath("mailto:a@b.c", SITE), null);
});

test("extractEndpoints handles arrays of strings, arrays of objects, maps, and ignores external links", () => {
  const asArray = { endpoints: ["countries.json", "risk.json", "countries/{ISO3}.json"] };
  assert.deepEqual(extractEndpoints(asArray, SITE), ["api/v1/countries.json", "api/v1/countries/{ISO3}.json", "api/v1/risk.json"]);

  const asObjects = {
    generatedAt: "2026-10-26T00:00:00Z",
    sources: [{ name: "World Bank", url: "https://api.worldbank.org/v2/indicator.json" }],
    endpoints: [
      { name: "countries", url: `${SITE}api/v1/countries.json`, description: "see notes.json for details" },
      { name: "country", urlTemplate: `${SITE}api/v1/countries/{ISO3}.json`, formats: { csv: `${SITE}api/v1/timeseries.csv` } },
    ],
  };
  assert.deepEqual(extractEndpoints(asObjects, SITE), ["api/v1/countries.json", "api/v1/countries/{ISO3}.json", "api/v1/timeseries.csv"]);

  const asMap = { endpoints: { countries: { path: "/api/v1/countries.json" }, openapi: "/api/v1/openapi.json", docs: "/api/" } };
  assert.deepEqual(extractEndpoints(asMap, SITE), ["api/v1/countries.json", "api/v1/openapi.json"]);

  const noEndpointsKey = { links: { llms: `${SITE}llms.txt`, home: SITE } };
  assert.deepEqual(extractEndpoints(noEndpointsKey, SITE), ["llms.txt"]);
  assert.deepEqual(extractEndpoints(null, SITE), []);
});

test("isLocalSite recognises loopback hosts", () => {
  assert.equal(isLocalSite("http://127.0.0.1:8080/"), true);
  assert.equal(isLocalSite("http://localhost:3000/x/"), true);
  assert.equal(isLocalSite("http://[::1]:8080/"), true);
  assert.equal(isLocalSite(SITE), false);
});

test("kindFromPath and expandTemplate", () => {
  assert.equal(kindFromPath(""), "html");
  assert.equal(kindFromPath("api/"), "html");
  assert.equal(kindFromPath("api/v1/index.json"), "manifest");
  assert.equal(kindFromPath("api/v1/openapi.json"), "openapi");
  assert.equal(kindFromPath("api/v1/status.json"), "status");
  assert.equal(kindFromPath("api/v1/countries.csv"), "csv");
  assert.equal(kindFromPath("llms.txt"), "text");
  assert.deepEqual(expandTemplate("api/v1/countries/{ISO3}.json", ["JPN", "KOR"]), ["api/v1/countries/JPN.json", "api/v1/countries/KOR.json"]);
  assert.deepEqual(expandTemplate("api/v1/countries/{iso3}.json", ["WLD"]), ["api/v1/countries/WLD.json"]);
});

test("findCountryRecords reads arrays of records, wrapped arrays and ISO3-keyed objects", () => {
  assert.deepEqual(findCountryRecords([{ iso3: "jpn", name: "Japan" }, { iso3: "KOR", name: "South Korea" }]).map((r) => r.iso3), ["JPN", "KOR"]);
  assert.deepEqual(findCountryRecords({ generatedAt: "x", countries: [{ iso3: "NGA", name: "Nigeria" }] }).map((r) => r.name), ["Nigeria"]);
  const keyed = { countries: Object.fromEntries(["AFG", "ALB", "DZA", "AND", "AGO", "WLD"].map((k) => [k, { name: k.toLowerCase() }])) };
  assert.equal(findCountryRecords(keyed).length, 6);
  assert.deepEqual(findCountryRecords({ nothing: true }), []);
});

test("parseCsv handles quotes, escaped quotes and CRLF", () => {
  const { rows, unterminatedQuote } = parseCsv('iso3,name,note\r\nKOR,"Korea, Rep.","said ""hi"""\r\n');
  assert.equal(unterminatedQuote, false);
  assert.deepEqual(rows[1], ["KOR", "Korea, Rep.", 'said "hi"']);
});

test("validateResponse: JSON", () => {
  assert.equal(validateResponse("json", ok('{"a":1}')).ok, true);
  const bad = validateResponse("json", ok("{nope"));
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /invalid JSON/);
  assert.deepEqual(validateResponse("json", ok("[]")).problems, ["empty JSON"]);
  assert.deepEqual(validateResponse("json", { status: 404, text: "<html>" }).problems, ["HTTP 404"]);
  assert.match(validateResponse("json", ok('{"a":1}', "text/html")).warnings[0], /content-type/);
  assert.equal(validateResponse("json", ok('[{"iso3":"JPN"},{"iso3":"KOR"}]')).info.countries, 2);
});

test("validateResponse: manifest, openapi, feedback", () => {
  const m = validateResponse("manifest", ok(JSON.stringify({ generatedAt: "2026-10-26", endpoints: ["countries.json"] })), { siteUrl: SITE });
  assert.equal(m.ok, true);
  assert.equal(m.info.endpoints, 1);
  assert.equal(m.warnings.length, 0);
  assert.equal(validateResponse("manifest", ok('{"version":1}'), { siteUrl: SITE }).warnings.length, 2);
  assert.deepEqual(validateResponse("manifest", ok("true"), { siteUrl: SITE }).problems, ["manifest is not a JSON object"]);
  assert.deepEqual(validateResponse("manifest", ok('["countries.json"]'), { siteUrl: SITE }).problems, ["manifest is not a JSON object"]);
  assert.equal(validateResponse("status", ok('{"checkedAt":"2026-10-26T06:21:00Z","refresh":"success"}')).ok, true);
  assert.deepEqual(validateResponse("status", ok('{"refresh":"success"}')).problems, ["status.json has no valid checkedAt"]);

  assert.equal(validateResponse("openapi", ok('{"openapi":"3.1.0","paths":{"/a":{}}}')).info.paths, 1);
  assert.equal(validateResponse("openapi", ok('{"title":"x"}')).ok, false);

  const fb = validateResponse("feedback", ok(JSON.stringify({ email: { address: "a@b.c" }, github: { templates: {} }, x: { handle: "TODO_X_HANDLE" } })));
  assert.equal(fb.ok, true);
  assert.match(fb.info.xHandle, /placeholder/);
  assert.equal(validateResponse("feedback", ok('{"x":{}}')).ok, false);
});

test("validateResponse: CSV", () => {
  const good = validateResponse("csv", ok("iso3,year,tfr\nJPN,2023,1.2\nKOR,2023,0.72\n", "text/csv"));
  assert.equal(good.ok, true);
  assert.deepEqual(good.info, { rows: 2, columns: 3 });
  const ragged = validateResponse("csv", ok("iso3,year,tfr\nJPN,2023\n", "text/csv"));
  assert.equal(ragged.ok, false);
  assert.match(ragged.problems[0], /row 2 has 2 columns/);
  assert.equal(validateResponse("csv", ok("iso3,tfr\n", "text/csv")).ok, false);
  assert.equal(validateResponse("csv", ok('a,b\n"open,1\n', "text/csv")).ok, false);
  assert.match(validateResponse("csv", ok('a,b\nJPN,un"quo"ted\n', "text/csv")).problems[0], /stray quote on line 2/);
  assert.match(validateResponse("csv", ok('a,b\n"JPN"x,1\n', "text/csv")).problems[0], /stray quote on line 2/);
  assert.equal(validateResponse("csv", ok('a,b\n"multi\nline",1\nKOR,2\n', "text/csv")).ok, true);
});

test("validateResponse: HTML and text", () => {
  const page = validateResponse("html", ok("<!doctype html><html><title>Tracker</title></html>", "text/html"));
  assert.equal(page.ok, true);
  assert.equal(page.info.title, "Tracker");
  assert.equal(validateResponse("html", ok('{"not":"html"}')).ok, false);
  assert.equal(validateResponse("text", ok("  \n")).ok, false);
  assert.equal(validateResponse("text", ok("# llms.txt")).ok, true);
});

test("requirement and levelFor decide what counts as broken", () => {
  assert.deepEqual(requirement({ always: true }), { required: true, reason: "site root" });
  assert.equal(requirement({ advertised: true }).required, true);
  assert.equal(requirement({ inRepo: true, expectDeployed: true }).required, true);
  assert.equal(requirement({ inRepo: true, expectDeployed: false }).required, false);
  assert.equal(requirement({ inRepo: false, expectDeployed: true }).required, false);
  assert.deepEqual(requirement({ wasLive: true }), { required: true, reason: "was live in the previous weekly check" });
  assert.deepEqual(requirement({ served: true }), { required: true, reason: "deployed (HTTP 200) but invalid" });
  assert.equal(levelFor({ ok: false, required: true, warnings: [] }), "fail");
  assert.equal(levelFor({ ok: false, required: false, warnings: [] }), "warn");
  assert.equal(levelFor({ ok: true, required: true, warnings: ["x"] }), "warn");
  assert.equal(levelFor({ ok: true, required: true, warnings: [] }), "pass");
});

test("assessFreshness judges the loop by status.json checkedAt/refresh; generatedAt is info only", () => {
  const now = new Date("2026-10-26T08:00:00Z");
  const status = (over = {}) => ({ checkedAt: "2026-10-26T06:21:00Z", refresh: "success", trigger: "schedule", run: "https://github.com/o/r/actions/runs/1", dataChangedAt: "2024-07-12T00:00:00Z", ...over });
  const manifest = { generatedAt: "2024-07-12T00:00:00Z", sources: [{ id: "WB", name: "World Development Indicators", vintage: "2026-10-08", url: "x", datasets: [{ id: "a", status: "ok" }, { id: "b", status: "unavailable" }] }] };

  const fresh = assessFreshness({ status: status(), manifest }, now);
  assert.equal(fresh.level, "pass", "two-year-old generatedAt is normal");
  assert.equal(fresh.checkedAt, "2026-10-26T06:21:00.000Z");
  assert.equal(fresh.refresh, "success");
  assert.equal(fresh.numbersChangedAt, "2024-07-12T00:00:00.000Z");
  assert.equal(fresh.numbersFrom, "status");
  assert.deepEqual(fresh.sources, [{ name: "World Development Indicators", vintage: { vintage: "2026-10-08" }, unavailable: ["b"] }]);

  const stale = assessFreshness({ status: status({ checkedAt: "2026-10-16T06:21:00Z" }), manifest }, now);
  assert.equal(stale.level, "warn");
  assert.match(stale.note, /10\.1 days ago \(threshold 9\)/);
  const failed = assessFreshness({ status: status({ refresh: "failure" }), manifest }, now);
  assert.equal(failed.level, "warn");
  assert.match(failed.note, /"failure"/);
  const missing = assessFreshness({ manifest }, now);
  assert.equal(missing.level, "warn");
  assert.match(missing.note, /status\.json is missing/);
  assert.equal(missing.numbersChangedAt, "2024-07-12T00:00:00.000Z");
  assert.equal(assessFreshness({ manifest, statusLocal: true }, now).level, "skip");
  assert.equal(assessFreshness({ status: status({ run: "javascript:x" }) }, now).run, null);
});

test("assessWorkflowRuns reports failures, staleness and in-progress runs", () => {
  const now = new Date("2026-10-26T08:00:00Z");
  const run = (conclusion, created_at, status = "completed") => ({ status, conclusion, event: "schedule", created_at, html_url: "u" });
  assert.equal(assessWorkflowRuns([run("success", "2026-10-26T06:17:00Z")], now).level, "pass");
  const failed = assessWorkflowRuns([run("failure", "2026-10-26T06:17:00Z"), run("success", "2026-10-19T06:17:00Z")], now);
  assert.equal(failed.level, "warn");
  assert.match(failed.note, /failure/);
  assert.equal(assessWorkflowRuns([run("success", "2026-10-01T06:17:00Z")], now).level, "warn");
  const running = assessWorkflowRuns([run(null, "2026-10-26T07:59:00Z", "in_progress"), run("success", "2026-10-19T06:17:00Z")], now);
  assert.equal(running.inProgress, true);
  assert.equal(assessWorkflowRuns([], now).level, "warn");
});

test("extractTopRisk ranks by rank, else by score", () => {
  const byRank = [
    { iso3: "WLD", risk: { rank: 0, score: 1 } },
    { iso3: "KOR", name: "South Korea", risk: { rank: 1, score: 92, tier: "critical" } },
    { iso3: "TWN", name: "Taiwan", risk: { rank: 2, score: 90 } },
  ];
  assert.deepEqual(extractTopRisk(byRank, 2).map((r) => r.iso3), ["KOR", "TWN"]);
  const byScore = { countries: [{ iso3: "JPN", riskScore: 70 }, { iso3: "KOR", riskScore: 95 }] };
  assert.deepEqual(extractTopRisk(byScore).map((r) => r.iso3), ["KOR", "JPN"]);
  assert.deepEqual(extractTopRisk({ countries: [{ iso3: "JPN" }] }), []);
});

test("extractPageAssets finds scripts, stylesheets, module preloads and preloads; skips data:, external and non-asset links", () => {
  const html = `<link rel="canonical" href="https://elsewhere.example/"><link rel="icon" href="data:image/svg+xml,x">
<link rel="alternate" href="api/v1/index.json"><link rel="help" href="api/"><link rel="preload" href="api/v1/countries.json" as="fetch">
<link rel="modulepreload" href="js/logic.js"><link rel=stylesheet href='style.css'><script type="application/ld+json">{}</script>
<script defer src="vendor/d3.min.js"></script><script type="module" src="./js/main.js"></script><script src="https://cdn.example/x.js"></script>`;
  assert.deepEqual(extractPageAssets(html, SITE, SITE), [
    { path: "api/v1/countries.json", kind: "json" },
    { path: "js/logic.js", kind: "module" },
    { path: "style.css", kind: "css" },
    { path: "vendor/d3.min.js", kind: "js" },
    { path: "js/main.js", kind: "module" },
  ]);
});

test("extractModuleRefs follows relative static, multi-line, re-export and dynamic imports, and fetched JSON", () => {
  const js = `import { a } from "./logic.js";
import {
  b,
  c,
} from "./country.js";
import * as L from '../shared/util.js';
import "./side-effect.js";
export * from "./dom.js";
export { x } from "./x.js";
const lazy = () => import("./lazy.js");
import fs from "node:fs"; // bare: ignored
const topo = await fetchJson("geo/countries-110m.json");
const pts = fetch(\`geo/world-points.json\`);
const dyn = fetch(\`api/v1/countries/\${iso}.json\`);`;
  const refs = extractModuleRefs(js, `${SITE}js/main.js`, SITE, SITE);
  assert.deepEqual(refs.imports.sort(), ["js/country.js", "js/dom.js", "js/lazy.js", "js/logic.js", "js/side-effect.js", "js/x.js", "shared/util.js"]);
  assert.deepEqual(refs.data.sort(), ["geo/countries-110m.json", "geo/world-points.json"]);
});

test("buildSchemaMap and schemaPathFor use the manifest's schema links, then defaults", () => {
  const manifest = { endpoints: [{ path: "countries/{iso3}.json", url: `${SITE}api/v1/countries/{iso3}.json`, schema: `${SITE}api/v1/schema/country.schema.json` }, { url: "risk.json" }] };
  const map = buildSchemaMap(manifest, SITE);
  assert.equal(map.get("api/v1/countries/{iso3}.json"), "api/v1/schema/country.schema.json");
  assert.equal(schemaPathFor("api/v1/countries/JPN.json", "api/v1/countries/{iso3}.json", map), "api/v1/schema/country.schema.json");
  assert.equal(schemaPathFor("api/v1/risk.json", null, map), "api/v1/schema/risk.schema.json");
  assert.equal(schemaPathFor("api/v1/status.json", null), "api/v1/schema/status.schema.json");
  assert.equal(schemaPathFor("api/v1/countries.csv", null), null);
});

test("shapeProblems catches payloads that parse but are useless", () => {
  assert.deepEqual(shapeProblems("api/v1/countries.json", { oops: true }), ["no country records (expected objects with iso3)"]);
  assert.deepEqual(shapeProblems("api/v1/countries.json", { countries: [{ iso3: "JPN", name: "Japan" }] }), []);
  assert.deepEqual(shapeProblems("api/v1/countries/JPN.json", { oops: true }), ['iso3 is null, file is for JPN']);
  assert.deepEqual(shapeProblems("api/v1/countries/JPN.json", { iso3: "JPN" }), ["country file has no name"]);
  assert.deepEqual(shapeProblems("api/v1/countries/JPN.json", { iso3: "JPN", name: "Japan" }), []);
  assert.deepEqual(shapeProblems("api/v1/risk.json", { ranking: [] }), ["no ranked countries"]);
  assert.deepEqual(shapeProblems("api/v1/openapi.json", { oops: true }), []);
});

test("crossCheck: counts, ranks, unknown codes, CSV rows and summary/detail agreement", () => {
  const recs = Array.from({ length: 3 }, (_, i) => ({ iso3: ["JPN", "KOR", "WLD"][i], name: ["Japan", "South Korea", "World"][i] }));
  const ok = {
    countries: { count: 3, countries: recs },
    index: { counts: { records: 3, ranked: 2 } },
    risk: { ranking: [{ rank: 1, iso3: "KOR" }, { rank: 2, iso3: "JPN" }], unranked: [{ iso3: "WLD" }] },
    details: new Map([["JPN", { iso3: "JPN", name: "Japan" }]]),
    countriesCsvRows: 3,
    minCountries: 3,
  };
  assert.deepEqual(crossCheck(ok), []);
  const bad = crossCheck({
    ...ok,
    countries: { count: 4, countries: [...recs, { iso3: "JPN", name: "Japan again" }] },
    index: { counts: { records: 3, ranked: 5 } },
    risk: { ranking: [{ rank: 1, iso3: "KOR" }, { rank: 3, iso3: "ZZZ" }], unranked: [] },
    details: new Map([["KOR", { iso3: "KOR", name: "Korea" }]]),
    countriesCsvRows: 2,
    minCountries: 150,
  });
  const text = bad.map((x) => `${x.path}: ${x.problem}`);
  assert.ok(text.includes("api/v1/countries.json: only 4 country records (expected at least 150)"));
  assert.ok(text.includes("api/v1/countries.json: duplicate iso3: JPN"));
  assert.ok(text.includes("api/v1/index.json: counts.records is 3, countries.json has 4"));
  assert.ok(text.includes("api/v1/countries.csv: 2 rows, countries.json has 4 records"));
  assert.ok(text.includes('api/v1/countries/KOR.json: summary says KOR "South Korea", detail says KOR "Korea"'));
  assert.ok(text.includes("api/v1/risk.json: 2 ranked + 0 unranked != 4 countries"));
  assert.ok(text.includes("api/v1/risk.json: ranking[1].rank is 3, expected 2"));
  assert.ok(text.includes("api/v1/risk.json: iso3 not in countries.json: ZZZ"));
  assert.ok(text.includes("api/v1/index.json: counts.ranked is 5, risk.json ranks 2"));
});

test("assessWorkflowStates warns on disabled schedules with the right advice", () => {
  const wf = (file, state) => ({ path: `.github/workflows/${file}`, state });
  assert.equal(assessWorkflowStates([wf("refresh-and-deploy.yml", "active"), wf("weekly-check.yml", "active")]).level, "pass");
  const idle = assessWorkflowStates([wf("refresh-and-deploy.yml", "disabled_inactivity"), wf("weekly-check.yml", "active")]);
  assert.equal(idle.level, "warn");
  assert.match(idle.note, /60 days without repo activity: re-enable with gh workflow enable refresh-and-deploy\.yml/);
  const manual = assessWorkflowStates([wf("refresh-and-deploy.yml", "active"), wf("weekly-check.yml", "disabled_manually")]);
  assert.match(manual.note, /disabled manually \(leave it unless Ros asks\)/);
  assert.deepEqual(assessWorkflowStates([]).states, { "refresh-and-deploy.yml": "missing", "weekly-check.yml": "missing" });
});
