#!/usr/bin/env node
// Validate the published API (public/api/v1) against the PRIMARY sources and print every mismatch:
//   - UN WPP 2024 CSVs from population.un.org (Demographic Indicators, population by 5-year age group, total
//     population by sex for the scenarios), with the 2026-01-19 interim update (Togo) overlaid;
//   - the World Bank WDI API (value and year of every World Bank headline figure);
//   - the UN DESA International Migrant Stock 2024 tables (.xlsx on un.org): stocks, shares and corridors;
//   - internal identities: summary = detail, CSV = JSON, risk recomputed from its inputs, scenarios = series.
// Zero dependencies, Node 22+. Downloads about 70 MB (cache them with --cache while iterating).
//
//   node scripts/validate-data.mjs [--api public/api/v1] [--cache /tmp/ft-cache] [--json report.json]
//                                  [--skip un,age,scenarios,wb,ims] [--examples 8]
// Exit codes: 0 = no mismatches, 1 = mismatches found, 2 = a source could not be loaded.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getBuffer, getJson, useCache } from "./lib/http.mjs";
import { parseWbLatest } from "./lib/parse.mjs";
import { WB_INDICATORS } from "./lib/sources.mjs";
import {
  AGE_COLUMNS,
  ageAccumulator,
  fetchUpdateZip,
  INDICATOR_COLUMNS,
  indicatorsAccumulator,
  POPULATION_COLUMNS,
  populationAccumulator,
  readGzipCsv,
  readUpdateCsv,
  WPP_CSV,
  WPP_UPDATE,
} from "./lib/unwpp.mjs";
import { validatePublished } from "./lib/validate.mjs";
import { readXlsx } from "./lib/xlsx.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const API = resolve(opt("--api", fileURLToPath(new URL("../public/api/v1", import.meta.url))));
const skip = new Set(opt("--skip", "").split(",").filter(Boolean));
if (opt("--cache")) useCache(resolve(opt("--cache")));
const log = (m) => console.error(m);

export const IMS_FILES = {
  destination: "https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_and_destination.xlsx",
  origin: "https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_and_origin.xlsx",
  destinationAndOrigin: "https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx",
};
const WB_RANGE = (id) => `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&per_page=20000&date=2000:2030`;

const readJson = (p) => readFile(p, "utf8").then(JSON.parse);

async function loadPublished() {
  const countries = await readJson(join(API, "countries.json"));
  const details = new Map();
  for (const n of (await readdir(join(API, "countries"))).filter((x) => /^[A-Z]{3}\.json$/.test(x)).sort()) {
    const d = await readJson(join(API, "countries", n));
    details.set(d.iso3, d);
  }
  const opt2 = (p, f) => f(join(API, p)).catch(() => null);
  return {
    countries,
    details,
    risk: await opt2("risk.json", readJson),
    index: await opt2("index.json", readJson),
    scenarios: await opt2("scenarios.json", readJson),
    countriesCsv: await opt2("countries.csv", (p) => readFile(p, "utf8")),
    timeseriesCsv: await opt2("timeseries.csv", (p) => readFile(p, "utf8")),
  };
}

// ---------- UN WPP ----------

/** UN rows -> what the comparisons use: Map<code, Map<year, row>> and Map<code, Map<year, % aged 65+>>. */
const yearsByCode = (places) => new Map([...places].map(([code, p]) => [code, p.years]));
const sharesByCode = (ages) => new Map([...ages].map(([code, m]) => [code, new Map([...m].map(([y, t]) => [y, t.total > 0 ? (t.age65plus / t.total) * 100 : null]))]));

async function loadUn() {
  const t0 = Date.now();
  const update = await fetchUpdateZip();
  const main = await readGzipCsv(WPP_CSV.indicatorsMedium, indicatorsAccumulator, { required: INDICATOR_COLUMNS });
  const upd = await readUpdateCsv(update.entries, WPP_UPDATE.files.indicatorsMedium, indicatorsAccumulator(), { required: INDICATOR_COLUMNS });
  for (const [code, p] of upd.places) main.value.places.set(code, p);
  log(`ok   UN WPP Demographic Indicators (${main.value.places.size} places, file ${main.lastModified}; update ${update.lastModified} replaces ${[...upd.places.keys()].join(" ")}) ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const un = { ind: yearsByCode(main.value.places), loc: main.value.loc, vintage: { indicators: main.lastModified, update: update.lastModified, updated: [...upd.places.keys()] } };
  if (!skip.has("age")) {
    const t1 = Date.now();
    const age = await readGzipCsv(WPP_CSV.ageGroupsMedium, ageAccumulator, { required: AGE_COLUMNS });
    const ageUpd = await readUpdateCsv(update.entries, WPP_UPDATE.files.ageGroupsMedium, ageAccumulator(), { required: AGE_COLUMNS });
    for (const [code, m] of ageUpd) age.value.set(code, m);
    un.share65 = sharesByCode(age.value);
    log(`ok   UN WPP population by 5-year age group (${age.value.size} places) ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }
  if (!skip.has("scenarios")) {
    const t2 = Date.now();
    const make = () => populationAccumulator({ startYear: 2024, endYear: 2100 });
    const mainPop = await readGzipCsv(WPP_CSV.populationBySex, make, { required: POPULATION_COLUMNS });
    const updPop = await readUpdateCsv(update.entries, WPP_UPDATE.files.populationBySex, populationAccumulator({ startYear: 2024, endYear: 2100, variants: { Medium: "medium" } }), { required: POPULATION_COLUMNS });
    un.scen = { main: mainPop.value, update: updPop };
    un.vintage.populationBySex = mainPop.lastModified;
    log(`ok   UN WPP total population by sex, Medium + Constant fertility (${mainPop.value.size} places) ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  }
  return un;
}

// ---------- World Bank ----------

async function loadWb() {
  const latest = {};
  const lastUpdated = new Set();
  for (const [key, id] of Object.entries(WB_INDICATORS)) {
    const json = await getJson(WB_RANGE(id));
    if (json?.[0]?.pages > 1) throw new Error(`World Bank ${id}: more than one page`);
    const parsed = parseWbLatest(json);
    latest[key] = parsed.values;
    lastUpdated.add(parsed.lastUpdated);
  }
  log(`ok   World Bank WDI (${Object.keys(latest).length} indicators, last updated ${[...lastUpdated].join(", ")})`);
  return { latest, lastUpdated: [...lastUpdated].sort().at(-1) };
}

// ---------- UN DESA International Migrant Stock 2024 ----------

const YEARS = [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2024];
const headerRow = (rows) => rows.findIndex((r) => r?.some((v) => typeof v === "string" && /^Region, development group/.test(v)));

/**
 * Table with one row per location: Map<code, Map<year, value>> from the first block of year columns (both sexes).
 * Rows are matched by their "Index" (column 0), which is the same in every table of a workbook: Table 2 of the
 * destination file has no location-code column.
 */
function byLocation(rows, indexToCode) {
  const h = headerRow(rows);
  const cols = YEARS.map((y) => rows[h].indexOf(y));
  const out = new Map();
  for (const row of rows.slice(h + 1)) {
    const code = indexToCode.get(row?.[0]);
    if (!code || code === "WLD") continue;
    out.set(code, new Map(YEARS.map((y, i) => [y, typeof row[cols[i]] === "number" ? row[cols[i]] : null]).filter(([, v]) => v != null)));
  }
  return out;
}

/** Index (column 0) -> our code, from a table that has a "Location code" column. */
function indexMap(rows, loc) {
  const h = headerRow(rows);
  const locCol = rows[h].findIndex((v) => typeof v === "string" && /^Location code/.test(v));
  return new Map(rows.slice(h + 1).filter((r) => r && loc.has(Number(r[locCol]))).map((r) => [r[0], loc.get(Number(r[locCol]))]));
}

function corridors(rows, loc) {
  const h = headerRow(rows);
  const head = rows[h];
  const dCol = head.findIndex((v) => /^Location code of destination/.test(v ?? ""));
  const oCol = head.findIndex((v) => /^Location code of origin/.test(v ?? ""));
  const col = head.indexOf(2024);
  const out = new Map();
  const get = (code) => {
    let e = out.get(code);
    if (!e) out.set(code, (e = { year: 2024, immigrantsTotal: null, emigrantsTotal: null, origins: [], destinations: [] }));
    return e;
  };
  for (const row of rows.slice(h + 1)) {
    if (!row) continue;
    const dest = Number(row[dCol]);
    const orig = Number(row[oCol]);
    const v = row[col];
    if (typeof v !== "number") continue;
    const d = loc.get(dest);
    const o = loc.get(orig);
    if (d && d !== "WLD" && orig === 900) get(d).immigrantsTotal = v;
    if (o && o !== "WLD" && dest === 900) get(o).emigrantsTotal = v;
    if (d && o && d !== "WLD" && o !== "WLD" && d !== o && v > 0) {
      get(d).origins.push({ iso3: o, people: Math.round(v) });
      get(o).destinations.push({ iso3: d, people: Math.round(v) });
    }
  }
  const order = (a, b) => b.people - a.people || a.iso3.localeCompare(b.iso3);
  for (const e of out.values()) {
    e.origins.sort(order);
    e.destinations.sort(order);
  }
  return out;
}

async function loadIms(loc) {
  const t0 = Date.now();
  const [dest, orig, both] = await Promise.all(Object.values(IMS_FILES).map((u) => getBuffer(u).then((b) => ({ ...b, wb: readXlsx(b.buffer) }))));
  const destIndex = indexMap(dest.wb.sheet("Table 1"), loc);
  const origIndex = indexMap(orig.wb.sheet("Table 1"), loc);
  const ims = {
    immigrants: byLocation(dest.wb.sheet("Table 1"), destIndex),
    population: byLocation(dest.wb.sheet("Table 2"), destIndex),
    immigrantsPct: byLocation(dest.wb.sheet("Table 3"), destIndex),
    emigrants: byLocation(orig.wb.sheet("Table 1"), origIndex),
    corridors: corridors(both.wb.sheet("Table 1"), loc),
    vintage: { destination: dest.lastModified, origin: orig.lastModified, destinationAndOrigin: both.lastModified },
  };
  log(`ok   UN DESA IMS 2024 tables (${ims.immigrants.size} destinations, ${ims.emigrants.size} origins, ${ims.corridors.size} corridor places; files ${Object.values(ims.vintage).join(", ")}) ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return ims;
}

// ---------- main ----------

function print(summary) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nValidated ${summary.compared.toLocaleString("en-US")} values for ${summary.countries} places: ${summary.mismatches.toLocaleString("en-US")} mismatches.\n`);
  console.log(`${pad("check", 32)} ${pad("compared", 9)} ${pad("places", 6)} ${pad("bad", 6)} max diff`);
  for (const c of summary.checks) console.log(`${pad(c.id, 32)} ${pad(c.compared, 9)} ${pad(c.countries, 6)} ${pad(c.mismatches, 6)} ${c.maxDiff || ""}`);
  for (const c of summary.checks.filter((x) => x.mismatches)) {
    console.log(`\n${c.id} (${c.source}): ${c.description}`);
    console.log(`  ${c.mismatches} mismatches in ${c.mismatchCountries.length} places: ${c.mismatchCountries.slice(0, 30).join(" ")}${c.mismatchCountries.length > 30 ? " ..." : ""}`);
    for (const e of c.examples) console.log(`  - ${e}`);
  }
  for (const n of summary.notes) console.log(`\nNote: ${n}`);
}

async function main() {
  const published = await loadPublished();
  const refs = {};
  try {
    if (!skip.has("un")) refs.un = await loadUn();
    if (!skip.has("wb")) refs.wb = await loadWb();
    if (!skip.has("ims")) {
      const loc = refs.un?.loc ?? (await loadUn()).loc;
      refs.ims = await loadIms(loc);
    }
  } catch (err) {
    console.error(`Could not load a primary source: ${err.message ?? err}`);
    process.exit(2);
  }
  const report = validatePublished(published, refs, { examples: Number(opt("--examples", 8)) });
  const summary = report.summary();
  summary.vintages = { un: refs.un?.vintage ?? null, wb: refs.wb?.lastUpdated ?? null, ims: refs.ims?.vintage ?? null };
  print(summary);
  if (opt("--json")) await writeFile(resolve(opt("--json")), JSON.stringify(summary, null, 2) + "\n");
  process.exit(summary.mismatches ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
