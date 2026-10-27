// Network layer with a stubbed fetch: retries, error reporting, and the migration-corridor fallbacks.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { configureHttp, getJson, getText } from "../scripts/lib/http.mjs";
import { parseCorridorCsv } from "../scripts/lib/parse.mjs";
import { checkCorridor, checkCorridorPair, fetchCorridors } from "../scripts/lib/sources.mjs";

const realFetch = globalThis.fetch;
let calls;
const respond = (handler) => {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const r = await handler(String(url));
    return r instanceof Response ? r : new Response(r.body, { status: r.status ?? 200 });
  };
};
beforeEach(() => {
  calls = [];
  configureHttp({ retries: 3, baseDelayMs: 0 });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  configureHttp({ retries: 4, baseDelayMs: 1500 });
});

test("getText retries 5xx and succeeds; does not retry 404", async () => {
  let n = 0;
  respond(() => (++n < 3 ? { status: 503, body: "busy" } : { body: "ok" }));
  assert.equal(await getText("https://x.test/a"), "ok");
  assert.equal(calls.length, 3);
  calls = [];
  respond(() => ({ status: 404, body: "nope" }));
  await assert.rejects(getText("https://x.test/missing"), /GET https:\/\/x\.test\/missing failed: HTTP 404/);
  assert.equal(calls.length, 1);
});

test("getJson names the URL when the body is not JSON (e.g. a bot-challenge page)", async () => {
  respond(() => ({ body: "<!doctype html><title>Just a moment</title>" }));
  await assert.rejects(getJson("https://x.test/j"), /returned invalid JSON/);
});

const entities = new Map([
  ["KOR", { name: "South Korea", rawName: "South Korea", years: new Map() }],
  ["CHN", { name: "China", rawName: "China", years: new Map() }],
]);
const page = `{"dimensions": [{"name": "Country", "slug": "country_select", "choices": [{"name": "South Korea", "slug": "south_korea"}, {"name": "China", "slug": "china"}]}]}`;
const meta = (d) => JSON.stringify({ columns: { a: { titleShort: "x", lastUpdated: d } } });
const csv = (self, metric) =>
  `entity,code,year,migrants__country_select_${self}__metric_${metric}__gender_all\nWorld,OWID_WRL,2024,100\nVietnam,VNM,2024,60\nUnited States,USA,2024,40\n`;
const handler = (vintage) => (url) => {
  if (url.includes(".metadata.json")) return { body: meta(vintage) };
  if (url.endsWith("/grapher/migration-origin-destination")) return { body: page };
  const m = url.match(/country_select=([a-z_]+)&metric=(\w+)/);
  return { body: csv(m[1], m[2]) };
};
const previous = (vintage) => ({
  entry: { id: "migrationCorridors", status: "ok", lastUpdated: vintage, timespan: "1990-2024" },
  data: new Map([
    ["KOR", { year: 2024, source: "UN-DESA", topOrigins: [], topDestinations: [] }],
    ["CHN", { year: 2024, source: "UN-DESA", topOrigins: [], topDestinations: [] }],
  ]),
});

test("fetchCorridors fetches every country when there is no previous build", async () => {
  respond(handler("2025-03-18"));
  const r = await fetchCorridors({ codes: ["KOR", "CHN", "WLD"], entities, previous: null });
  assert.equal(r.entry.status, "ok");
  assert.equal(r.entry.vintage.lastUpdated, "2025-03-18");
  assert.deepEqual([...r.data.keys()], ["CHN", "KOR"]);
  assert.deepEqual(r.data.get("KOR").topOrigins.map((p) => p.iso3), ["VNM", "USA"]);
  assert.equal(r.data.get("KOR").immigrantsTotal, 100);
  assert.equal(calls.filter((u) => u.includes("country_select")).length, 4);
});

test("fetchCorridors reuses the previous corridors while the vintage is unchanged", async () => {
  respond(handler("2025-03-18"));
  const r = await fetchCorridors({ codes: ["KOR", "CHN"], entities, previous: previous("2025-03-18") });
  assert.equal(r.data.size, 2);
  assert.equal(calls.filter((u) => u.includes("country_select")).length, 0, "no per-country downloads");
  assert.equal(r.entry.vintage.lastUpdated, "2025-03-18");
});

test("fetchCorridors refetches when the source vintage changes", async () => {
  respond(handler("2027-03-01"));
  const r = await fetchCorridors({ codes: ["KOR", "CHN"], entities, previous: previous("2025-03-18") });
  assert.equal(calls.filter((u) => u.includes("country_select")).length, 4);
  assert.equal(r.data.get("KOR").topOrigins.length, 2);
});

test("fetchCorridors keeps the last published corridors when the source is down, else reports unavailable", async () => {
  respond(() => ({ status: 503, body: "down" }));
  const kept = await fetchCorridors({ codes: ["KOR", "CHN"], entities, previous: previous("2025-03-18") });
  assert.equal(kept.entry.status, "ok");
  assert.equal(kept.entry.vintage.lastUpdated, "2025-03-18");
  assert.equal(kept.data.size, 2);
  const none = await fetchCorridors({ codes: ["KOR", "CHN"], entities, previous: null });
  assert.equal(none.entry.status, "unavailable");
  assert.equal(none.data, null);
  assert.match(none.entry.error, /HTTP 503/);
});

test("a partly failing corridor refresh after a vintage change keeps ALL previous corridors (no silent deletions)", async () => {
  const base = handler("2027-03-01");
  respond((url) => (url.includes("country_select=south_korea") ? { status: 503, body: "down" } : base(url)));
  const r = await fetchCorridors({ codes: ["KOR", "CHN"], entities, previous: previous("2025-03-18") });
  assert.equal(r.entry.status, "ok");
  assert.equal(r.entry.vintage.lastUpdated, "2025-03-18", "previous vintage kept: one consistent set");
  assert.deepEqual([...r.data.keys()].sort(), ["CHN", "KOR"], "South Korea's corridors are not deleted");
  assert.deepEqual(r.data.get("CHN").topOrigins, [], "previous records, not a mix of old and new");
});

test("structurally empty corridor CSVs are rejected, and count as a failure", async () => {
  const empty = "entity,code,year,migrants__country_select_x__metric_immigrants__gender_all\n";
  assert.throws(() => checkCorridor(parseCorridorCsv(empty, "KOR"), "KOR", "immigrants"), /empty immigrants corridor CSV for KOR/);
  const noTotal = "entity,code,year,migrants__x\nAsia,OWID_ASI,2024,500\nChina,CHN,2024,500\n";
  assert.throws(() => checkCorridor(parseCorridorCsv(noTotal, "KOR"), "KOR", "emigrants"), /empty emigrants/);
  // A World total with no partner breakdown is legitimate for one direction (UN DESA: immigrants into BES, VAT)...
  const totalOnly = parseCorridorCsv("entity,code,year,migrants__x\nWorld,OWID_WRL,2024,496\nEurope,OWID_EUR,2024,0\n", "VAT");
  assert.equal(checkCorridor(totalOnly, "VAT", "immigrants"), totalOnly);
  // ...but not for both.
  assert.throws(() => checkCorridorPair(totalOnly, totalOnly, "VAT"), /no partner countries/);
  const base = handler("2027-03-01");
  respond((url) => (url.includes("country_select=china&metric=emigrants") ? { body: empty } : base(url)));
  const r = await fetchCorridors({ codes: ["KOR", "CHN"], entities, previous: previous("2025-03-18") });
  assert.equal(r.entry.vintage.lastUpdated, "2025-03-18", "refresh refused, previous kept");
  const first = await fetchCorridors({ codes: ["KOR", "CHN"], entities, previous: null });
  assert.equal(first.entry.status, "unavailable", "first build: 1 of 2 failing exceeds the 10% tolerance");
});
