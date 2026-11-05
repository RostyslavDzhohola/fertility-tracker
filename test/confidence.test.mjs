// How sure each number is (scripts/lib/confidence.mjs): the level rules, the automatic comparisons with newer national
// figures, and the parsers for the UN DESA workbook and Eurostat's JSON-stat.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildConfidence,
  DOWNGRADE_PCT,
  estimateDate,
  eurostatIso2,
  gapPct,
  lastUnCount,
  LEVEL_RULES,
  parseDesaDataTypes,
  parseJsonStat,
  unPopulationOn,
  verdictOf,
} from "../scripts/lib/confidence.mjs";
import { confidenceChecks } from "../scripts/lib/sanity.mjs";
import { applyRangeUpdate, splitRanges } from "../scripts/lib/unwpp.mjs";

const NONE = { wppSources: null, pvsr: null, curated: null, desaReassessed: null, desaTypes: null, eurostat: { population: null, foreignBorn: null } };
// A place growing by 1,000 people a year from 1,000,000 in 2020 (1 July).
const series = Array.from({ length: 81 }, (_, i) => ({ year: 2020 + i, variant: i <= 3 ? "estimate" : "projection", population: 1_000_000 + i * 1000, births: 10_000, deaths: 8_000 }));
const rec = { iso3: "AAA", iso2: "AA", isoNumeric: "001", migrantStock: { year: 2024, immigrants: 50_000 } };
const run = (sources, extra = {}) => buildConfidence({ rec, series, range: null, stock: rec.migrantStock, sources: { ...NONE, ...sources }, latestEstimateYear: 2023, year: 2026, ...extra });
const ds = (o = {}) => ({ wppSources: { places: { AAA: { censuses: [2001], registers: [], officialEstimatesThrough: 2022, registeredBirthsThrough: 2021, registeredDeathsThrough: 2021, birthsAdjusted: false, deathsAdjusted: false, migrationBasis: ["residual"], text: { population: "Population: …" }, page: 12, ...o } } } });
const pvsr = (place, footnotes = {}) => ({ pvsr: { source: { tables: { 2: { lastUpdated: "2026-10-05" } } }, places: { AAA: place }, footnotes } });

test("gaps and verdicts: within 2% matches; otherwise which side the UN is on", () => {
  assert.equal(gapPct(102, 100), 2);
  assert.equal(verdictOf(2), "matches");
  assert.equal(verdictOf(-2.1), "un-lower");
  assert.equal(verdictOf(5), "un-higher");
  assert.equal(verdictOf(null), "context");
  assert.equal(gapPct(null, 5), null);
});

test("the UN population on a date sits between its 1 July figures", () => {
  assert.equal(unPopulationOn(series, "2024-07-01"), 1_004_000);
  assert.equal(unPopulationOn(series, "2025-01-01"), 1_004_504, "184 of 365 days after 1 July 2024");
  assert.equal(unPopulationOn(series, "2010-01-01"), null, "outside the series");
});

test("today's level: census age with the UN's 15-year cutoff, registers are always current", () => {
  assert.equal(run(ds({ censuses: [2001] })).confidence.today.level, "poor");
  assert.equal(run(ds({ censuses: [2001, 2012] })).confidence.today.level, "fair");
  assert.equal(run(ds({ censuses: [2020] })).confidence.today.level, "good");
  assert.equal(run(ds({ censuses: [], registers: [] })).confidence.today.level, "poor", "no count at all");
  assert.equal(run(ds({ censuses: [1990], registers: [2022] })).confidence.today.register, true);
  assert.equal(run(ds({ censuses: [1990], registers: [2022] })).confidence.today.level, "good");
  assert.equal(lastUnCount({ censuses: [1999, 2011], registers: [2015] }), 2015);
  assert.match(LEVEL_RULES.today.poor, /15 years/);
});

test("kept current: an old census, but complete registration and a recent official figure that matches the UN's", () => {
  const es = { data: new Map([["AA", new Map([[2026, { value: 1_005_000, flag: null }]])]]), updated: "2026-10-27" };
  const complete = pvsr({ births: { year: 2025, code: "C" }, deaths: { year: 2025, code: "C" } });
  const out = run({ ...ds({ censuses: [2011] }), ...complete, eurostat: { population: es, foreignBorn: null } });
  assert.equal(out.confidence.today.level, "good");
  assert.equal(out.confidence.today.keptCurrent, true);
  // Not when births and deaths aren't fully registered, nor when the figures differ.
  const partial = run({ ...ds({ censuses: [2011] }), ...pvsr({ births: { year: 2025, code: "U" }, deaths: { year: 2025, code: "U" } }), eurostat: { population: es, foreignBorn: null } });
  assert.equal(partial.confidence.today.level, "fair");
  const off = { data: new Map([["AA", new Map([[2026, { value: 950_000, flag: null }]])]]), updated: "2026-10-27" };
  const differs = run({ ...ds({ censuses: [2011] }), ...complete, eurostat: { population: off, foreignBorn: null } });
  assert.equal(differs.confidence.today.keptCurrent, false);
  assert.equal(differs.confidence.today.level, "poor", "fair, then one step lower for the 5.8% gap");
});

test("a newer census the UN couldn't use counts as the last head count, and is compared with the UN", () => {
  const out = run({ ...ds({ censuses: [2001] }), ...pvsr({ census: { date: "2024-07-01", code: "DJ", total: 950_000, provisional: true, notes: [7] } }, { 2: { 7: "Excluding the north." } }) });
  assert.equal(out.confidence.today.lastCount, 2024);
  const c = out.crossChecks.find((x) => x.key === "census");
  assert.equal(c.unFigure.value, 1_004_000);
  assert.equal(c.verdict, "un-higher");
  assert.equal(c.unUsedUpTo, 2001);
  assert.deepEqual(c.notes, ["Excluding the north."]);
  assert.equal(c.asOf, "2026-10-05");
  // 5.7% away: the head count is recent, but the level drops one step.
  assert.ok(Math.abs(c.gapPct) > DOWNGRADE_PCT);
  assert.equal(out.confidence.today.level, "fair");
  assert.equal(out.confidence.today.downgraded, true);
  // A sample survey is not a census, and old censuses are not "newer counts".
  const survey = run({ ...ds({ censuses: [2001] }), ...pvsr({ census: { date: "2011-10-01", code: "SSDF", total: 900_000 } }) });
  assert.equal(survey.confidence.today.lastCount, 2001);
  assert.equal(survey.crossChecks.length, 0);
});

test("births and deaths: complete registration is good, gaps are fair, surveys are poor", () => {
  const level = (b, d, o) => run({ ...ds(o), ...(b || d ? pvsr({ births: b, deaths: d }) : {}) }).confidence.birthsDeaths.level;
  assert.equal(level({ year: 2024, code: "C" }, { year: 2024, code: "C" }), "good");
  assert.equal(level({ year: 2016, code: "C" }, { year: 2016, code: "C" }), "fair", "complete, but old");
  assert.equal(level({ year: 2024, code: "U" }, { year: 2024, code: "U" }), "fair");
  assert.equal(level({ year: 2014, code: "|" }, null, { registeredBirthsThrough: null, registeredDeathsThrough: null }), "poor");
  assert.equal(level(null, null, { registeredBirthsThrough: 2022, registeredDeathsThrough: 2022 }), "good", "the UN's own inputs when the country reported nothing");
  assert.equal(level(null, null, { registeredBirthsThrough: 2022, registeredDeathsThrough: 2022, birthsAdjusted: true }), "fair");
  assert.equal(level(null, null, { registeredBirthsThrough: null, registeredDeathsThrough: 2022 }), "poor", "Nigeria: some deaths registered, no births");
});

test("people born abroad: by birthplace is good, citizenship fair, none poor; one step lower if only carried forward", () => {
  const level = (type, reassessed) =>
    run({ desaTypes: new Map([[1, { type, refugeesAdded: false }]]), desaReassessed: new Set(reassessed ? ["AAA"] : []) }).confidence.immigration.level;
  assert.equal(level("B", true), "good");
  assert.equal(level("B", false), "fair");
  assert.equal(level("C", true), "fair");
  assert.equal(level("C", false), "poor");
  assert.equal(level("I", true), "poor");
  assert.equal(run({}).confidence.immigration.level, null);
});

test("the forecast level follows the width of the UN's 95% range in 2050", () => {
  const range = (half) => {
    const n = 77;
    const mid = (i) => series.find((r) => r.year === 2024 + i)?.population ?? null;
    const at = (f) => Array.from({ length: n }, (_, i) => (mid(i) == null ? null : Math.round(mid(i) * f)));
    return { startYear: 2024, lower80: at(1 - half / 2), upper80: at(1 + half / 2), lower95: at(1 - half), upper95: at(1 + half), zeroMigration: at(0.9) };
  };
  const out = (half) => run({}, { range: range(half) }).confidence.forecast;
  assert.equal(out(0.1).level, "good");
  assert.equal(out(0.3).level, "fair");
  assert.equal(out(0.5).level, "poor");
  const [p2050, p2100] = out(0.1).at;
  assert.equal(p2050.year, 2050);
  assert.equal(p2100.year, 2100);
  assert.ok(p2050.lower95 < p2050.lower80 && p2050.lower80 < p2050.medium && p2050.medium < p2050.upper80 && p2050.upper80 < p2050.upper95);
  assert.equal(p2050.zeroMigration, Math.round(p2050.medium * 0.9));
});

test("overall: the lower of today's count and births and deaths; the world has none", () => {
  const out = run({ ...ds({ censuses: [2020] }), ...pvsr({ births: { year: 2024, code: "U" }, deaths: { year: 2024, code: "U" } }) });
  assert.equal(out.confidence.today.level, "good");
  assert.equal(out.confidence.birthsDeaths.level, "fair");
  assert.equal(out.confidence.level, "fair");
  assert.deepEqual(buildConfidence({ rec: { iso3: "WLD" }, series, sources: NONE, latestEstimateYear: 2023, year: 2026 }), { confidence: null, crossChecks: [] });
  assert.equal(run(ds()).confidence.unSources.population, "Population: …");
});

test("Eurostat: newest 1 January figure; France is compared with the UN's France plus its five overseas regions", () => {
  const es = (geo, values, extra = {}) => ({ data: new Map([[geo, new Map(Object.entries(values).map(([y, v]) => [Number(y), { value: v, flag: extra[y] ?? null }]))]]), updated: "2026-10-27" });
  const out = run({ eurostat: { population: es("AA", { 2025: 1_000_000, 2026: 1_004_500 }, { 2026: "p" }), foreignBorn: null } });
  const t = out.crossChecks.find((c) => c.key === "today");
  assert.equal(t.kind, "eurostat");
  assert.equal(t.figure.date, "2026-01-01");
  assert.equal(t.figure.provisional, true);
  assert.equal(t.unFigure.value, 1_005_504);
  assert.equal(t.verdict, "matches");
  assert.equal(t.asOf, "2026-10-27");

  const fra = { ...rec, iso3: "FRA", iso2: "FR" };
  const others = { GLP: series, MTQ: series, GUF: series, REU: series, MYT: series };
  const f = buildConfidence({ rec: fra, series, seriesOf: (c) => others[c] ?? null, stock: null, sources: { ...NONE, eurostat: { population: es("FR", { 2026: 6_033_000 }), foreignBorn: null } }, latestEstimateYear: 2023, year: 2026 });
  const ft = f.crossChecks.find((c) => c.key === "today");
  assert.equal(ft.unFigure.value, 6 * 1_005_504);
  assert.match(ft.unFigure.what, /GLP, MTQ, GUF, REU, MYT/);
  assert.equal(eurostatIso2("EL"), "GR");
  assert.equal(eurostatIso2("UK"), "GB");
  assert.equal(eurostatIso2("EU27_2020"), null);
});

test("people born abroad vs Eurostat says when the UN adds refugees", () => {
  const fb = { data: new Map([["AA", new Map([[2025, { value: 25_000, flag: null }]])]]), updated: "2026-09-25" };
  const out = run({ eurostat: { population: null, foreignBorn: fb }, desaTypes: new Map([[1, { type: "B", refugeesAdded: true }]]) });
  const c = out.crossChecks.find((x) => x.key === "immigrants");
  assert.equal(c.gapPct, 100);
  assert.equal(c.verdict, "un-higher");
  assert.equal(c.unAddsRefugees, true);
});

test("registered births and deaths are compared only when complete, recent and for places of 100,000 or more", () => {
  const p = (births, footnotes) => run({ ...ds(), ...pvsr({ births, deaths: null }, footnotes) }).crossChecks.filter((c) => c.key === "births");
  assert.equal(p({ year: 2024, code: "C", number: 8_000, notes: [3] }, { 3: { 3: "Excluding the north." } })[0].gapPct, 25);
  assert.deepEqual(p({ year: 2024, code: "C", number: 8_000, notes: [4] }, { 3: { 4: "Data refer to births with weight 500g and more." } })[0].notes, [], "only notes about coverage");
  assert.equal(p({ year: 2024, code: "U", number: 8_000 }).length, 0);
  assert.equal(p({ year: 2019, code: "C", number: 8_000 }).length, 0);
  assert.equal(p({ year: 2024, code: "C", number: null, numberUnclear: true }).length, 0);
  const tiny = buildConfidence({ rec, series: series.map((r) => ({ ...r, population: 50_000 })), stock: null, sources: { ...NONE, ...pvsr({ births: { year: 2024, code: "C", number: 500 } }) }, latestEstimateYear: 2023, year: 2026 });
  assert.equal(tiny.crossChecks.length, 0);
});

test("hand-checked notes are published with only the fields the schema knows", () => {
  const curated = { places: { AAA: [{ key: "net", text: "Newer counts show fewer arrivals.", figure: { value: 10, what: "x", date: 2026 }, unFigure: { value: 20, what: "y", date: "2026", field: "series" }, verdict: "un-higher", links: [{ label: "A", href: "https://a" }], quotes: [{ text: "10", href: "https://a" }], accessed: "2026-10-29" }] } };
  const [c] = run({ curated }).crossChecks;
  assert.equal(c.kind, "researched");
  assert.deepEqual(c.unFigure, { value: 20, what: "y", date: "2026" });
  assert.equal(c.figure.date, "2026");
  assert.equal(c.gapPct, 100);
});

test("UN DESA data types: B, C, I with or without refugees; unknown codes are refused", () => {
  const head = [null, "Region, development group, country or area", "Coverage", "Data type", "Location code"];
  const rows = (extra) => [head, ...Array.from({ length: 200 }, (_, i) => [i, `P${i}`, null, "B", 1000 + i]), ...extra];
  const t = parseDesaDataTypes(rows([[1, "Ukraine*", null, "B", 804], [2, "Nigeria", null, "C R", 566], [3, "Somalia", null, "I R", 706], [4, "X", null, "C B R", 5]]));
  assert.deepEqual(t.get(804), { type: "B", refugeesAdded: false });
  assert.deepEqual(t.get(566), { type: "C", refugeesAdded: true });
  assert.deepEqual(t.get(706), { type: "I", refugeesAdded: true });
  assert.deepEqual(t.get(5), { type: "CB", refugeesAdded: true });
  assert.throws(() => parseDesaDataTypes(rows([[1, "Y", null, "Z", 6]])), /unknown data type/);
  assert.throws(() => parseDesaDataTypes([head]), /only 0 places/);
  assert.throws(() => parseDesaDataTypes([[null, "no header"]]), /no 'Data type'/);
});

test("Eurostat JSON-stat: values by geo and year, with flags; extra dimensions must be single-valued", () => {
  const d = {
    id: ["freq", "indic_de", "geo", "time"],
    size: [1, 1, 2, 2],
    dimension: { geo: { category: { index: { DE: 0, EL: 1 } } }, time: { category: { index: { 2025: 0, 2026: 1 } } } },
    value: { 0: 83.5, 1: 83.4, 3: 10.3 },
    status: { 3: "p" },
  };
  const m = parseJsonStat(d);
  assert.equal(m.get("DE").get(2026).value, 83.4);
  assert.equal(m.get("EL").has(2025), false);
  assert.deepEqual(m.get("EL").get(2026), { value: 10.3, flag: "p" });
  assert.throws(() => parseJsonStat({ ...d, size: [1, 2, 2, 2] }), /indic_de has 2 values/);
});

test("forecast ranges: split from the scenarios, rescaled with Togo's interim update", () => {
  const all = new Map([["TGO", { medium: [100, 110], constant: [100, 120], lower80: [90, 95], upper80: [110, 125], lower95: [80, 85], upper95: [120, 135], zeroMigration: [99, 108] }], ["XXX", { medium: [1, 2], constant: [1, 2] }]]);
  const { places, ranges } = splitRanges(all);
  assert.deepEqual(places.get("TGO"), { medium: [100, 110], constant: [100, 120] });
  assert.equal(ranges.has("XXX"), false);
  applyRangeUpdate(ranges, new Map([["TGO", [100, 110]]]), new Map([["TGO", { medium: [88, 99] }]]));
  assert.deepEqual(ranges.get("TGO").lower95, [70, 77]);
  assert.deepEqual(ranges.get("TGO").zeroMigration, [87, 97]);
});

test("sanity: ranges must bracket the forecast; a parsed figure 3x off the UN's is refused, except people born abroad", () => {
  const ds = (d) => ({ details: new Map([["AAA", d]]) });
  const at = (o) => ({ year: 2050, medium: 100, lower80: 90, upper80: 110, lower95: 80, upper95: 120, zeroMigration: 95, ...o });
  assert.deepEqual(confidenceChecks(ds({ confidence: { forecast: { at: [at()] } }, crossChecks: [] })), []);
  assert.match(confidenceChecks(ds({ confidence: { forecast: { at: [at({ lower95: 95 })] } }, crossChecks: [] }))[0], /out of order/);
  const check = (key, un, other) => ({ key, kind: "unsd", gapPct: gapPct(un, other), figure: { value: other }, unFigure: { value: un } });
  assert.match(confidenceChecks(ds({ crossChecks: [check("births", 1000, 10_000)] }))[0], /check the parsed source/);
  assert.deepEqual(confidenceChecks(ds({ crossChecks: [check("births", 693, 434)] })), [], "Colombia: a real 60% gap");
  assert.deepEqual(confidenceChecks(ds({ crossChecks: [{ ...check("immigrants", 7_083_501, 2_930_821), kind: "eurostat" }] })), [], "Türkiye: the UN adds refugees");
});

test("published data: every place but the world has confidence, and the rules are in index.json", async () => {
  const api = new URL("../public/api/v1/", import.meta.url);
  const read = async (p) => JSON.parse(await readFile(new URL(p, api), "utf8"));
  const [countries, index, ukr, deu] = await Promise.all([read("countries.json"), read("index.json"), read("countries/UKR.json"), read("countries/DEU.json")]);
  const levels = countries.countries.filter((c) => c.iso3 !== "WLD").map((c) => c.confidence);
  assert.ok(levels.filter(Boolean).length >= 220, `${levels.filter(Boolean).length} places with a level`);
  assert.equal(countries.countries.find((c) => c.iso3 === "WLD").confidence, null);
  assert.deepEqual(index.confidenceRules.levels, ["good", "fair", "poor"]);
  assert.ok(index.sources.some((s) => s.id === "QUALITY"));
  // Ukraine: last census 2001, the UN's own words quoted, the range brackets the forecast.
  assert.equal(ukr.confidence.today.lastCount, 2001);
  assert.equal(ukr.confidence.today.level, "poor");
  assert.match(ukr.confidence.unSources.population, /2001 censuses/);
  assert.equal(ukr.forecastRange.startYear, 2024);
  assert.equal(ukr.forecastRange.lower95.length, 77);
  assert.ok(ukr.crossChecks.some((c) => c.kind === "researched" && c.key === "today"));
  // Germany: counted in 2022, Eurostat agrees on today's population.
  assert.equal(deu.confidence.today.level, "good");
  assert.equal(deu.crossChecks.find((c) => c.key === "today").verdict, "matches");
});

test("the cross-check queue puts weak data, big gaps and big places first, and skips fresh notes", async () => {
  const { queueScore } = await import("../scripts/checks/crosscheck-queue.mjs");
  const place = (o) => ({ population: { value: 50_000_000 }, confidence: { today: { level: "poor" }, birthsDeaths: { level: "fair" }, immigration: { level: "good" } }, crossChecks: [], ...o });
  const weak = queueScore(place());
  const solid = queueScore(place({ confidence: { today: { level: "good" }, birthsDeaths: { level: "good" }, immigration: { level: "good" } } }));
  assert.ok(weak.score > 0);
  assert.equal(solid.score, 0);
  assert.deepEqual(weak.reasons, ["today poor", "birthsDeaths fair"]);
  const gap = queueScore(place({ crossChecks: [{ kind: "unsd", key: "today", gapPct: 21.5 }] }));
  assert.ok(gap.score > weak.score);
  assert.match(gap.reasons.at(-1), /22% from the UN/);
  assert.ok(queueScore(place({ population: { value: 200_000 } })).score < weak.score, "smaller places later");
  const now = new Date("2026-10-29");
  const fresh = queueScore(place({ crossChecks: [{ kind: "researched", key: "today", accessed: "2026-09-01" }] }), { now });
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.score, 0);
  assert.equal(queueScore(place({ crossChecks: [{ kind: "researched", key: "today", accessed: "2026-01-01" }] }), { now }).fresh, false);
});

test("merging hand-checked notes keeps only what the verifier passed, applies its fixes, and drops invalid notes", async () => {
  const { mergeCountry } = await import("../scripts/checks/merge-crosschecks.mjs");
  const check = (o) => ({ key: "today", text: "The office counted 10 people.", figure: { value: 10, what: "people", date: 2025 }, unFigure: { value: 11, what: "UN", field: "x", date: "2025" }, verdict: "un-higher", links: [{ label: "Office", href: "https://stat.example" }], quotes: [{ text: "10 people", href: "https://stat.example" }], confidence: "verified", ...o });
  const research = { iso3: "AAA", researched: "2026-10-29", checks: [check(), check({ key: "net" }), check({ confidence: "unverified" }), check({ links: [] })] };
  const verify = { checks: [{ index: 0, ok: true, fix: { text: "Fixed." } }, { index: 1, ok: false, problems: ["quote not found"] }, { index: 2, ok: true }, { index: 3, ok: true }] };
  const { notes, dropped } = mergeCountry(research, verify);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, "Fixed.");
  assert.equal(notes[0].accessed, "2026-10-29");
  assert.deepEqual(notes[0].unFigure, { value: 11, what: "UN", date: "2025" }, "extra fields dropped");
  assert.deepEqual(Object.keys(notes[0]), ["key", "text", "figure", "unFigure", "verdict", "links", "quotes", "accessed"]);
  assert.deepEqual(dropped.map((d) => d.why), ["quote not found", "researcher could not open the source", "invalid: links"]);
  assert.equal(mergeCountry(research, null).notes.length, 0, "nothing merges unverified");
});

test("a national estimate is compared on its own reference day; Iran's year can't be lined up", () => {
  assert.equal(estimateDate(2024, ["Data refer to 31 December."]), "2024-12-31");
  assert.equal(estimateDate(2025, ["Data refer to 1 January.", "Postcensal estimates."]), "2025-01-01");
  assert.equal(estimateDate(2025, []), "2025-07-01");
  assert.equal(estimateDate(2025, ["Data refer to the Iranian Year which begins on 21 March and ends on 20 March of the following year."]), null);
  const out = run({ ...ds({ censuses: [2020] }), ...pvsr({ estimate: { year: 2024, total: 1_000_000, notes: [39] } }, { 2: { 39: "Data refer to 31 December." } }) });
  const t = out.crossChecks.find((c) => c.key === "today");
  assert.equal(t.figure.date, "2024-12-31");
  assert.equal(t.unFigure.value, unPopulationOn(series, "2024-12-31"));
  assert.deepEqual(t.notes, [], "the date is in the comparison, not repeated as a note");
});

test("a national figure for a different area or group is shown with its note but not graded, and never moves the level", () => {
  const out = run({ ...ds({ censuses: [2020] }), ...pvsr({ estimate: { year: 2025, total: 700_000, notes: [78] } }, { 2: { 78: "Data refer to government controlled areas." } }) });
  const t = out.crossChecks.find((c) => c.key === "today");
  assert.equal(t.verdict, "context");
  assert.equal(t.coverageDiffers, true);
  assert.ok(t.gapPct > 40);
  assert.deepEqual(t.notes, ["Data refer to government controlled areas."]);
  assert.equal(out.confidence.today.downgraded, false);
  assert.equal(out.confidence.today.level, "good");
});

test("only figures newer than what the UN used can lower the level", () => {
  const old = run({ ...ds({ censuses: [2020], officialEstimatesThrough: 2023 }), ...pvsr({ estimate: { year: 2023, total: 900_000, notes: [] } }) });
  assert.equal(old.crossChecks.find((c) => c.key === "today").verdict, "un-higher");
  assert.equal(old.confidence.today.downgraded, false, "the UN already had 2023's official estimate");
  const newer = run({ ...ds({ censuses: [2020], officialEstimatesThrough: 2023 }), ...pvsr({ estimate: { year: 2025, total: 900_000, notes: [] } }) });
  assert.equal(newer.confidence.today.downgraded, true);
  assert.equal(newer.confidence.today.level, "fair");
});

test("Togo's range is marked as rescaled by us, not the UN's own", () => {
  const range = { startYear: 2024, adjusted: true, lower80: [], upper80: [], lower95: [], upper95: [], zeroMigration: [] };
  assert.equal(run({}, { range }).confidence.forecast.adjusted, true);
  assert.equal(run({}).confidence.forecast.adjusted, false);
});

test("a census that couldn't reach everyone is shown, but not used as the last head count", () => {
  const out = run({ ...ds({ censuses: [2014] }), ...pvsr({ census: { date: "2024-09-30", code: "DF", total: 1_100_000, notes: [97] } }, { 2: { 97: "The national total includes an estimated 19,191,728 persons (37.4%) who were not enumerated across many locations." } }) });
  assert.equal(out.confidence.today.lastCount, 2014);
  assert.equal(out.confidence.today.latestCensus.partial, true);
  const c = out.crossChecks.find((x) => x.key === "census");
  assert.equal(c.partial, true);
  assert.equal(out.confidence.today.downgraded, false, "a partly estimated total doesn't lower the level");
});
