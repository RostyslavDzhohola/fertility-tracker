// UN WPP 2024 read from the UN's own CSV files: streamed gzip parsing, the 2026 interim-update overlay (Togo),
// scenario rescaling, retries, and the minimal zip/xlsx readers. Offline: fetch is stubbed with in-memory files.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { configureHttp, isUnavailable } from "../scripts/lib/http.mjs";
import { sourceDecision } from "../scripts/lib/sanity.mjs";
import {
  applyScenarioUpdate,
  eachCsvRow,
  fetchUnWpp,
  INDICATOR_COLUMNS,
  parseCsvLine,
  populationAccumulator,
  POPULATION_COLUMNS,
  readGzipCsv,
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
// The correction files must cover every year of the update range (the real ones: TGO 1950-2100); here 2023-2026.
const UPD_YEARS = [2023, 2026];
const updYears = [2023, 2024, 2025, 2026];
const UPD_IND_ROWS = updYears.map((y) => ind("TGO", y, 8223.85, { Births: 268.455 }));
const UPD_IND = indicatorsCsv(UPD_IND_ROWS);

const AGE_HEADER = ["LocID", "ISO3_code", "Location", "Variant", "Time", "AgeGrp", "AgeGrpStart", "PopTotal"];
const age = (code, Time, AgeGrpStart, PopTotal) => ({ ...LOC[code], Variant: "Medium", Time, AgeGrp: `${AgeGrpStart}`, AgeGrpStart, PopTotal });
const MAIN_AGE = wppCsv(AGE_HEADER, [age("KOR", 2023, 0, 40), age("KOR", 2023, 65, 8), age("KOR", 2023, 100, 0.5), age("TGO", 2023, 0, 90), age("TGO", 2023, 65, 10)]);
const GROUPS = Array.from({ length: 21 }, (_, i) => i * 5);
const UPD_AGE_ROWS = updYears.flatMap((y) => GROUPS.map((g) => age("TGO", y, g, g === 0 ? 80 : g === 65 ? 2 : 0)));
const UPD_AGE = wppCsv(AGE_HEADER, UPD_AGE_ROWS);

const POP_HEADER = ["SortOrder", "LocID", "ISO3_code", "Location", "Variant", "Time", "PopTotal"];
const pop = (code, Variant, Time, PopTotal) => ({ ...LOC[code], Variant, Time, PopTotal });
const MAIN_POP = wppCsv(POP_HEADER, [
  ...["WLD", "KOR", "TGO"].flatMap((c) => [2023, 2024, 2025, 2026].flatMap((y) => [pop(c, "Medium", y, 1000 + y - 2024), ...(y >= 2024 ? [pop(c, "Constant fertility", y, 1000 + 2 * (y - 2024)), pop(c, "Low", y, 1)] : [])])),
]);
const UPD_POP_ROWS = updYears.map((y) => pop("TGO", "Medium", y, 880 + y - 2024));
const UPD_POP = wppCsv(POP_HEADER, UPD_POP_ROWS);

const updateZip = (over = {}) =>
  makeZip({
    [WPP_UPDATE.files.indicatorsMedium]: UPD_IND,
    [WPP_UPDATE.files.ageGroupsMedium]: UPD_AGE,
    [WPP_UPDATE.files.populationBySex]: UPD_POP,
    "WPP2024_Fertility_by_Age1_Medium_Update.csv": "unused",
    ...over,
  });
const run = (opts = {}) => fetchUnWpp({ scenarioYears: [2024, 2026], updateYears: UPD_YEARS, ...opts });
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
  const { wpp, entries } = await run();
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
  const { wpp, scenarios } = await run();
  const tgo = wpp.population.entities.get("TGO");
  assert.equal(tgo.years.get(2023).popEst, 8223850, "revised, not the superseded 9.3 million");
  assert.equal(wpp.birthsDeaths.entities.get("TGO").years.get(2023).birthsEst, 268455);
  assert.equal(tgo.years.has(2101), false);
  assert.deepEqual(wpp.ageStructure.entities.get("TGO").years.get(2023), { pop65Est: 2000, popAllEst: 82000 });
  assert.equal(wpp.population.entities.get("TGO").years.get(2026).popProj, 8223850, "every update year replaces the original");

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

// ---------- the interim update must be complete before it may replace anything ----------

/** Run with a modified update zip; return the interimUpdate entry and the publish decision. */
async function withUpdate(over) {
  serve(routes({ [WPP_UPDATE.url]: updateZip(over) }));
  const res = await run();
  const upd = res.entries.find((e) => e.id === "interimUpdate");
  return { ...res, upd, decision: sourceDecision(res.entries, null, { force: true }) };
}
const headerOnly = (csv) => csv.split("\r\n")[0] + "\r\n";

test("a header-only update zip is refused, not accepted as ok (Togo would keep its superseded figures)", async () => {
  const { wpp, scenarios, upd, decision } = await withUpdate({
    [WPP_UPDATE.files.indicatorsMedium]: headerOnly(UPD_IND),
    [WPP_UPDATE.files.ageGroupsMedium]: headerOnly(UPD_AGE),
    [WPP_UPDATE.files.populationBySex]: headerOnly(UPD_POP),
  });
  assert.equal(upd.status, "unavailable");
  assert.match(upd.error, /^interim update is incomplete, refusing to apply it/);
  assert.match(upd.error, /WPP2024_Demographic_Indicators_Medium_Update\.csv has no rows for TGO \(expected 2023-2026\)/);
  assert.match(upd.error, /WPP2024_PopulationByAge5GroupSex_Medium_Update\.csv has no rows for TGO/);
  assert.match(upd.error, /WPP2024_TotalPopulationBySex_Medium_Update\.csv has no Medium rows for TGO/);
  assert.equal(wpp, null);
  assert.equal(scenarios, null);
  assert.equal(decision.publish, false, "required source: refused even with --force");
  assert.match(decision.problems[0], /required source interimUpdate unavailable: interim update is incomplete/);
});

test("a correction file missing one place's year, a field, or an age group is refused with a precise message", async () => {
  const noYear = await withUpdate({ [WPP_UPDATE.files.indicatorsMedium]: indicatorsCsv(UPD_IND_ROWS.filter((r) => r.Time !== 2025)) });
  assert.match(noYear.upd.error, /Indicators_Medium_Update\.csv lacks TGO 2025/);
  assert.equal(noYear.decision.publish, false);

  const emptyField = await withUpdate({ [WPP_UPDATE.files.indicatorsMedium]: indicatorsCsv(UPD_IND_ROWS.map((r) => (r.Time === 2024 ? { ...r, Births: "" } : r))) });
  assert.match(emptyField.upd.error, /has empty Births for TGO 2024/);

  const noGroup = await withUpdate({ [WPP_UPDATE.files.ageGroupsMedium]: wppCsv(AGE_HEADER, UPD_AGE_ROWS.filter((r) => !(r.Time === 2026 && r.AgeGrpStart === 100))) });
  assert.match(noGroup.upd.error, /Age5GroupSex_Medium_Update\.csv lacks age groups for TGO in 1 years \(e\.g\. 2026: 100\+\)/);

  const noPopYears = await withUpdate({ [WPP_UPDATE.files.populationBySex]: wppCsv(POP_HEADER, UPD_POP_ROWS.slice(0, 2)) });
  assert.match(noPopYears.upd.error, /TotalPopulationBySex_Medium_Update\.csv lacks TGO Medium 2025-2026/);

  // Another place in one file only: it must be complete everywhere too.
  const partial = await withUpdate({ [WPP_UPDATE.files.indicatorsMedium]: indicatorsCsv([...UPD_IND_ROWS, ...updYears.map((y) => ind("KOR", y, 1))]) });
  assert.match(partial.upd.error, /PopulationByAge5GroupSex_Medium_Update\.csv has no rows for KOR/);

  const missingFile = await withUpdate({ [WPP_UPDATE.files.populationBySex]: undefined });
  assert.equal(missingFile.upd.status, "unavailable");
  assert.ok(missingFile.upd.error, "a missing CSV is reported, not thrown");
});

test("a truncated gzip download is retried from scratch", async () => {
  let n = 0;
  const full = gz(MAIN_IND);
  serve(routes({ [WPP_CSV.indicatorsMedium]: () => (++n === 1 ? full.subarray(0, Math.floor(full.length / 2)) : full) }));
  const { wpp, entries } = await run();
  assert.equal(entries[0].status, "ok");
  assert.equal(n, 2, "second attempt succeeded");
  assert.equal(wpp.population.entities.get("KOR").years.get(2023).popEst, 51748744, "no rows duplicated from the failed attempt");
});

test("a missing optional file (age groups) leaves share65 empty but keeps the series", async () => {
  serve(routes({ [WPP_CSV.ageGroupsMedium]: { status: 404 } }));
  const { wpp, entries } = await run();
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

// ---------- fetch failures vs everything else (scripts/validate-data.mjs exit 2 means only "could not fetch") ----------

test("a dropped connection mid-download is a fetch failure: retried, then reported as unavailable", async () => {
  const full = gz(MAIN_POP);
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    const body = new ReadableStream({
      start(c) {
        c.enqueue(full.subarray(0, 40));
        setTimeout(() => c.error(new Error("socket hang up")), 5);
      },
    });
    return new Response(body, { status: 200 });
  };
  const err = await readGzipCsv(WPP_CSV.populationBySex, () => populationAccumulator({ startYear: 2024, endYear: 2026 }), { required: POPULATION_COLUMNS }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, "rejects instead of hanging or succeeding");
  assert.equal(isUnavailable(err), true);
  assert.equal(n, 3, "retried");
  assert.match(err.message, /failed after 3 attempts: .*socket hang up/);
});

test("a bug or a changed file format is not a fetch failure: not retried, not marked unavailable", async () => {
  serve(routes());
  const buggy = () => ({
    onRow() {
      throw new TypeError("x is not a function");
    },
    done: () => null,
  });
  const err = await readGzipCsv(WPP_CSV.populationBySex, buggy, { required: POPULATION_COLUMNS }).then(() => null, (e) => e);
  assert.ok(err instanceof TypeError);
  assert.equal(isUnavailable(err), false);
  assert.equal(calls.length, 1, "no retry");
  const format = await readGzipCsv(WPP_CSV.populationBySex, () => populationAccumulator({ startYear: 2024, endYear: 2026 }), { required: ["NoSuchColumn"] }).then(() => null, (e) => e);
  assert.match(format.message, /CSV header lacks NoSuchColumn/);
  assert.equal(isUnavailable(format), false);
  serve({});
  const down = await readGzipCsv(WPP_CSV.populationBySex, buggy).then(() => null, (e) => e);
  assert.equal(isUnavailable(down), true, "HTTP 404 is a fetch failure");
});
