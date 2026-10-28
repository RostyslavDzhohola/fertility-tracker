// UN WPP 2024 read from the UN's own CSV files: streamed gzip parsing, the 2026 interim-update overlay (Togo),
// scenario rescaling, retries, and the minimal zip/xlsx readers. Offline: fetch is stubbed with in-memory files.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { configureHttp } from "../scripts/lib/http.mjs";
import { sourceDecision } from "../scripts/lib/sanity.mjs";
import {
  applyScenarioUpdate,
  eachCsvRow,
  fetchUnWpp,
  INDICATOR_COLUMNS,
  parseCsvLine,
  readZip,
  WPP_CSV,
  WPP_UPDATE,
} from "../scripts/lib/unwpp.mjs";
import { readXlsx } from "../scripts/lib/xlsx.mjs";
import { gz, makeZip, wppCsv } from "./helpers/archive.mjs";

const realFetch = globalThis.fetch;
let calls;
beforeEach(() => {
  calls = [];
  configureHttp({ retries: 3, baseDelayMs: 0 });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  configureHttp({ retries: 4, baseDelayMs: 1500 });
});
const serve = (routes) => {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const r = routes[String(url)];
    const body = typeof r === "function" ? r() : r;
    if (body == null) return new Response("missing", { status: 404 });
    if (body.status) return new Response(body.body ?? "", { status: body.status });
    return new Response(body, { status: 200, headers: { "last-modified": "Fri, 13 Dec 2024 19:11:17 GMT" } });
  };
};

// ---------- synthetic UN files ----------

const LOC = {
  WLD: { LocID: 900, ISO3_code: "", Location: "World" },
  AFR: { LocID: 903, ISO3_code: "", Location: "Africa" }, // an aggregate: dropped
  KOR: { LocID: 410, ISO3_code: "KOR", Location: "Republic of Korea" },
  TGO: { LocID: 768, ISO3_code: "TGO", Location: "Togo" },
  HKG: { LocID: 344, ISO3_code: "HKG", Location: "China, Hong Kong SAR" },
};
const IND_HEADER = ["SortOrder", "LocID", "Notes", "ISO3_code", "Location", "Variant", "Time", "TPopulation1July", "Births", "Deaths", "NetMigrations", "NatChange", "TFR", "MedianAgePop", "CBR", "CDR"];
const ind = (code, Time, pop, extra = {}) => ({ ...LOC[code], Variant: "Medium", Time, TPopulation1July: pop, Births: 1.5, Deaths: 2.25, NetMigrations: -3.427, NatChange: -0.75, TFR: 0.72, MedianAgePop: 44.4567, CBR: 4.6, CDR: 6.7, ...extra });
const indicatorsCsv = (rows) => wppCsv(IND_HEADER, rows);
const MAIN_IND = indicatorsCsv([
  ...["WLD", "AFR", "KOR", "TGO", "HKG"].flatMap((c) => [2023, 2024, 2101].map((y) => ind(c, y, c === "TGO" ? 9304.338 : 51748.744))),
]);
const UPD_IND = indicatorsCsv([2023, 2024].map((y) => ind("TGO", y, 8223.85, { Births: 268.455 })));

const AGE_HEADER = ["LocID", "ISO3_code", "Location", "Variant", "Time", "AgeGrp", "AgeGrpStart", "PopTotal"];
const age = (code, Time, AgeGrpStart, PopTotal) => ({ ...LOC[code], Variant: "Medium", Time, AgeGrp: `${AgeGrpStart}`, AgeGrpStart, PopTotal });
const MAIN_AGE = wppCsv(AGE_HEADER, [age("KOR", 2023, 0, 40), age("KOR", 2023, 65, 8), age("KOR", 2023, 100, 0.5), age("TGO", 2023, 0, 90), age("TGO", 2023, 65, 10)]);
const UPD_AGE = wppCsv(AGE_HEADER, [age("TGO", 2023, 0, 80), age("TGO", 2023, 65, 2)]);

const POP_HEADER = ["SortOrder", "LocID", "ISO3_code", "Location", "Variant", "Time", "PopTotal"];
const pop = (code, Variant, Time, PopTotal) => ({ ...LOC[code], Variant, Time, PopTotal });
const MAIN_POP = wppCsv(POP_HEADER, [
  ...["WLD", "KOR", "TGO"].flatMap((c) => [2023, 2024, 2025, 2026].flatMap((y) => [pop(c, "Medium", y, 1000 + y - 2024), ...(y >= 2024 ? [pop(c, "Constant fertility", y, 1000 + 2 * (y - 2024)), pop(c, "Low", y, 1)] : [])])),
]);
const UPD_POP = wppCsv(POP_HEADER, [2024, 2025, 2026].map((y) => pop("TGO", "Medium", y, 880 + y - 2024)));

const updateZip = () =>
  makeZip({
    [WPP_UPDATE.files.indicatorsMedium]: UPD_IND,
    [WPP_UPDATE.files.ageGroupsMedium]: UPD_AGE,
    [WPP_UPDATE.files.populationBySex]: UPD_POP,
    "WPP2024_Fertility_by_Age1_Medium_Update.csv": "unused",
  });
const routes = (over = {}) => ({
  [WPP_CSV.indicatorsMedium]: gz(MAIN_IND),
  [WPP_CSV.ageGroupsMedium]: gz(MAIN_AGE),
  [WPP_CSV.populationBySex]: gz(MAIN_POP),
  [WPP_UPDATE.url]: updateZip(),
  ...over,
});

// ---------- tests ----------

test("parseCsvLine handles quoted names with commas and escaped quotes", () => {
  assert.deepEqual(parseCsvLine('1,"China, Hong Kong SAR",,"say ""hi""",2.5'), ["1", "China, Hong Kong SAR", "", 'say "hi"', "2.5"]);
});

test("eachCsvRow names a missing required column", async () => {
  const lines = ["﻿LocID,Time", "900,2023"];
  await assert.rejects(eachCsvRow(lines, () => {}, { required: INDICATOR_COLUMNS }), /CSV header lacks ISO3_code/);
});

test("fetchUnWpp: UN rows become the model's datasets (people, est/proj split, display names, aggregates dropped)", async () => {
  serve(routes());
  const { wpp, entries } = await fetchUnWpp({ scenarioYears: [2024, 2026] });
  assert.deepEqual(entries.map((e) => [e.id, e.status, e.required]), [
    ["demographicIndicators", "ok", true],
    ["ageGroups", "ok", false],
    ["populationScenarios", "ok", false],
    ["interimUpdate", "ok", true],
  ]);
  assert.equal(entries[0].vintage.lastUpdated, "2024-12-13", "file date from Last-Modified");
  assert.deepEqual(entries[0].updated, ["TGO"]);
  const kor = wpp.population.entities.get("KOR");
  assert.equal(kor.name, "South Korea", "frozen display name, not the UN's 'Republic of Korea'");
  assert.equal(wpp.population.entities.get("HKG").name, "Hong Kong");
  assert.deepEqual([...wpp.population.entities.keys()].sort(), ["HKG", "KOR", "TGO", "WLD"], "aggregates (no ISO3) dropped, LocID 900 = WLD");
  assert.equal(kor.years.get(2023).popEst, 51748744, "thousands -> people");
  assert.equal(kor.years.get(2024).popProj, 51748744, "2024+ is the projection");
  assert.equal(kor.years.has(2101), false, "years after 2100 are dropped");
  const bd = wpp.birthsDeaths.entities.get("KOR").years.get(2023);
  assert.deepEqual(bd, { birthsEst: 1500, deathsEst: 2250, cbrEst: 4.6, cdrEst: 6.7 });
  assert.equal(wpp.netMigration.entities.get("HKG").years.get(2023).netMigEst, -3427);
  assert.equal(wpp.fertility.entities.get("KOR").years.get(2023).tfrEst, 0.72);
  assert.equal(wpp.medianAge.entities.get("KOR").years.get(2023).medianAgeEst, 44.4567);
  // 65+ includes the 100+ group (Our World in Data's 65+ column stopped at 99).
  assert.deepEqual(wpp.ageStructure.entities.get("KOR").years.get(2023), { pop65Est: 8500, popAllEst: 48500 });
});

test("fetchUnWpp overlays the 2026 interim update on every file (Togo)", async () => {
  serve(routes());
  const { wpp, scenarios } = await fetchUnWpp({ scenarioYears: [2024, 2026] });
  const tgo = wpp.population.entities.get("TGO");
  assert.equal(tgo.years.get(2023).popEst, 8223850, "revised, not the superseded 9.3 million");
  assert.equal(wpp.birthsDeaths.entities.get("TGO").years.get(2023).birthsEst, 268455);
  assert.equal(tgo.years.has(2101), false);
  assert.deepEqual(wpp.ageStructure.entities.get("TGO").years.get(2023), { pop65Est: 2000, popAllEst: 82000 });

  assert.deepEqual(scenarios.places.get("KOR"), { medium: [1000000, 1001000, 1002000], constant: [1000000, 1002000, 1004000] });
  assert.deepEqual(scenarios.places.get("TGO").medium, [880000, 881000, 882000]);
  // Constant fertility was not revised by the UN: rescaled by revised / original medium, year by year.
  assert.deepEqual(scenarios.places.get("TGO").constant, [880000, Math.round((1002000 * 881000) / 1001000), Math.round((1004000 * 882000) / 1002000)]);
  assert.deepEqual(scenarios.adjustments, [{ iso3: "TGO", scenarios: ["constant"], ratioRange: [0.88, 0.88] }]);
  assert.equal(scenarios.vintage.lastModified, "2024-12-13");
  assert.equal(scenarios.places.has("AFR"), false);
});

test("without the interim update nothing UN-based is usable, and the build is refused", async () => {
  serve(routes({ [WPP_UPDATE.url]: { status: 404 } }));
  const { wpp, scenarios, entries } = await fetchUnWpp();
  assert.equal(wpp, null, "Togo must not silently revert to the superseded figures");
  assert.equal(scenarios, null);
  const upd = entries.find((e) => e.id === "interimUpdate");
  assert.equal(upd.status, "unavailable");
  assert.match(upd.error, /HTTP 404/);
  const decision = sourceDecision(entries, null, { force: true });
  assert.equal(decision.publish, false, "required, even with --force");
});

test("a truncated gzip download is retried from scratch", async () => {
  let n = 0;
  const full = gz(MAIN_IND);
  serve(routes({ [WPP_CSV.indicatorsMedium]: () => (++n === 1 ? full.subarray(0, Math.floor(full.length / 2)) : full) }));
  const { wpp, entries } = await fetchUnWpp({ scenarioYears: [2024, 2026] });
  assert.equal(entries[0].status, "ok");
  assert.equal(n, 2, "second attempt succeeded");
  assert.equal(wpp.population.entities.get("KOR").years.get(2023).popEst, 51748744, "no rows duplicated from the failed attempt");
});

test("a missing optional file (age groups) leaves share65 empty but keeps the series", async () => {
  serve(routes({ [WPP_CSV.ageGroupsMedium]: { status: 404 } }));
  const { wpp, entries } = await fetchUnWpp({ scenarioYears: [2024, 2026] });
  assert.equal(entries.find((e) => e.id === "ageGroups").status, "unavailable");
  assert.equal(wpp.ageStructure.entities.size, 0);
  assert.equal(wpp.population.entities.size, 4);
});

test("applyScenarioUpdate keeps nulls and reports the ratio range", () => {
  const places = new Map([["TGO", { medium: [100, 200, null], constant: [100, 210, 300] }]]);
  const adj = applyScenarioUpdate(places, new Map([["TGO", { medium: [90, 170, 250] }], ["XXX", { medium: [1] }]]));
  assert.deepEqual(places.get("TGO"), { medium: [90, 170, 250], constant: [90, 179, null] });
  assert.deepEqual(adj, [{ iso3: "TGO", scenarios: ["constant"], ratioRange: [0.85, 0.9] }]);
});

test("readZip reads deflated entries; readXlsx reads shared, inline and numeric cells", () => {
  const zip = readZip(makeZip({ "a.txt": "hello", "b/c.csv": "x,y\n1,2\n" }));
  assert.deepEqual([...zip.keys()], ["a.txt", "b/c.csv"]);
  assert.equal(zip.get("b/c.csv")().toString(), "x,y\n1,2\n");
  assert.throws(() => readZip(Buffer.from("not a zip at all, definitely not")), /not a zip/);

  const xlsx = makeZip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Table 1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Republic of Korea</t></si><si><r><t>Côte</t></r><r><t xml:space=\"preserve\"> d&apos;Ivoire</t></r></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>410</v></c><c r="D1"><v>1811507</v></c></row>' +
      '<row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="inlineStr"><is><t>B R</t></is></c><c r="D3"><v>3.5026902839</v></c></row></sheetData></worksheet>',
  });
  const wb = readXlsx(xlsx);
  assert.deepEqual(wb.sheetNames, ["Table 1"]);
  const rows = wb.sheet("Table 1");
  assert.deepEqual(Array.from(rows[0]), ["Republic of Korea", undefined, 410, 1811507]);
  assert.equal(rows[1], undefined);
  assert.deepEqual(rows[2].slice(1), ["Côte d'Ivoire", "B R", 3.5026902839]);
});
