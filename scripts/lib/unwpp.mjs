// UN World Population Prospects 2024 read straight from the UN's own CSV files (population.un.org), streamed through
// node:zlib without holding the decompressed file in memory. Used for scenarios.json (Medium and Constant-fertility
// population, 2024-2100) and by scripts/validate-data.mjs to check every published UN number against the primary file.
//
// WPP 2024 (released 2024-07-11) had one interim update on 2026-01-19: revised Togo population and vital-event counts
// (estimates 1950-2023 and the medium projection), shipped as a separate zip of "_Update" CSVs. The standard CSVs
// still hold the superseded Togo figures, so every reader here overlays the update zip (applyUpdate).
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip, inflateRawSync } from "node:zlib";
import { getBuffer, markUnavailable, openStream, withRetries } from "./http.mjs";
import { NAMES, OWID_ALIASES } from "./names.mjs";

export const WPP_BASE = "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/";
export const WPP_CSV = {
  indicatorsMedium: `${WPP_BASE}CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz`,
  populationBySex: `${WPP_BASE}CSV_FILES/WPP2024_TotalPopulationBySex.csv.gz`,
  ageGroupsMedium: `${WPP_BASE}CSV_FILES/WPP2024_PopulationByAge5GroupSex_Medium.csv.gz`,
};
export const WPP_UPDATE = {
  url: `${WPP_BASE}WPP2024_CSV_files_update.zip`,
  releaseNote: "https://population.un.org/wpp/assets/Files/WPP2024_Release-Note-rev1.pdf",
  released: "2026-01-19",
  files: {
    indicatorsMedium: "WPP2024_Demographic_Indicators_Medium_Update.csv",
    populationBySex: "WPP2024_TotalPopulationBySex_Medium_Update.csv",
    ageGroupsMedium: "WPP2024_PopulationByAge5GroupSex_Medium_Update.csv",
  },
  /** What the release note says the update contains: every one of these files must hold all of it. */
  places: ["TGO"],
  years: [1950, 2100],
};
/** UN 5-year age groups: 0-4, 5-9, ..., 95-99, 100+. */
export const AGE_GROUP_STARTS = Array.from({ length: 21 }, (_, i) => i * 5);
/** WPP 2024: estimates 1950-2023, medium-variant projection 2024-2100. The next revision is due 2027-07-11. */
export const WPP_LAST_ESTIMATE_YEAR = 2023;
export const WPP_RELEASED = "2024-07-11";
export const WPP_NEXT_RELEASE = "2027-07-11";
export const WPP_CITATION = "United Nations, Department of Economic and Social Affairs, Population Division (2024). World Population Prospects 2024, Online Edition (interim update for Togo, 19 January 2026).";
export const WPP_HOME = "https://population.un.org/wpp/";
export const WPP_DOWNLOADS = "https://population.un.org/wpp/downloads";
export const WPP_SCENARIOS_DOC = "https://population.un.org/wpp/definition-of-projection-scenarios";
export const WPP_METHODOLOGY = "https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf";

/** One line of a UN WPP CSV (RFC 4180 quoting: location names such as "China, Hong Kong SAR" are quoted). */
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Our code for a WPP row: LocID 900 is the world (WLD); otherwise the 3-letter ISO3_code; aggregates have none. */
export const wppCode = (get) => (get("LocID") === "900" ? "WLD" : /^[A-Z]{3}$/.test(get("ISO3_code")) ? get("ISO3_code") : null);

/**
 * Call onRow(get) for every data row of a CSV read line by line from an async iterable of lines; get(column) returns
 * the raw string ("" if absent). Throws if a required column is missing from the header.
 */
export async function eachCsvRow(lines, onRow, { required = [] } = {}) {
  let index = null;
  let fields = null;
  const get = (name) => fields[index.get(name)] ?? "";
  const it = (lines[Symbol.asyncIterator] ?? lines[Symbol.iterator]).call(lines);
  for (;;) {
    let next;
    try {
      next = await it.next();
    } catch (err) {
      // The download broke off or the gzip is truncated: the source could not be fetched completely.
      throw markUnavailable(err);
    }
    if (next.done) break;
    const raw = next.value;
    if (index == null) {
      const header = parseCsvLine(raw.replace(/^﻿/, "").trimEnd());
      index = new Map(header.map((h, i) => [h, i]));
      const missing = required.filter((c) => !index.has(c));
      if (missing.length) throw new Error(`CSV header lacks ${missing.join(", ")} (has ${header.slice(0, 8).join(",")}, ...)`);
      continue;
    }
    if (!raw) continue;
    fields = parseCsvLine(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
    onRow(get);
  }
  if (index == null) throw new Error("empty CSV");
}

/**
 * Lines of a gzip-compressed stream, decompressed on the fly. A failure of the download stream (connection dropped)
 * is passed on to the gunzip stream, so reading the lines rejects instead of hanging, and is marked as a fetch failure.
 */
function gzipLines(stream) {
  const gunzip = createGunzip();
  stream.on("error", (err) => gunzip.destroy(markUnavailable(err)));
  return createInterface({ input: stream.pipe(gunzip), crlfDelay: Infinity });
}

/**
 * Stream a gzip CSV from a URL into a fresh accumulator. The whole download restarts on any failure (network or
 * truncated gzip), so a result is either complete or an error. make() returns { onRow(get), done() }.
 * Returns { value: done(), lastModified }.
 */
export async function readGzipCsv(url, make, { required = [] } = {}) {
  return withRetries(
    async () => {
      const acc = make();
      const { stream, lastModified } = await openStream(url);
      await eachCsvRow(gzipLines(stream), acc.onRow, { required });
      return { value: acc.done(), lastModified };
    },
    { attempts: 3, label: `UN WPP ${url.split("/").pop()}` },
  );
}

// ---------- zip (the interim-update CSVs, and the UN DESA .xlsx tables in the validator) ----------

/**
 * Minimal zip reader: Map<entry name, () => Buffer>. Supports stored and deflated entries (all the UN uses);
 * no zip64, no encryption.
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end of central directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt zip entry ${name}`);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip entry ${name}: unsupported compression method ${method}`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The interim-update zip as Map<file name, Buffer getter>, plus its Last-Modified date. */
export async function fetchUpdateZip() {
  const { buffer, lastModified } = await getBuffer(WPP_UPDATE.url);
  return { entries: readZip(buffer), lastModified };
}

/** Rows of one CSV from the update zip, through the same accumulator as the main file. */
export async function readUpdateCsv(entries, name, acc, { required = [] } = {}) {
  const get = entries.get(name);
  if (!get) throw new Error(`${name} not found in the WPP update zip`);
  const lines = createInterface({ input: Readable.from(get()), crlfDelay: Infinity });
  await eachCsvRow(lines, acc.onRow, { required });
  return acc.done();
}

// ---------- population scenarios (scenarios.json) ----------

export const SCENARIO_VARIANTS = { Medium: "medium", "Constant fertility": "constant" };
/**
 * The UN's probabilistic range around the medium projection (80 and 95 per cent prediction intervals) and the
 * Zero-migration scenario, read in the same pass as the scenarios. Published per place as `forecastRange`: how sure
 * the forecast is, and how much of it rests on migration.
 */
export const RANGE_VARIANTS = {
  "Lower 80 PI": "lower80",
  "Upper 80 PI": "upper80",
  "Lower 95 PI": "lower95",
  "Upper 95 PI": "upper95",
  "Zero migration": "zeroMigration",
};
export const RANGE_KEYS = Object.values(RANGE_VARIANTS);

/** Split one accumulator's places into the scenarios ({medium, constant}) and the ranges (RANGE_KEYS). */
export function splitRanges(all) {
  const places = new Map();
  const ranges = new Map();
  for (const [code, p] of all) {
    places.set(code, { medium: p.medium, constant: p.constant });
    if (RANGE_KEYS.some((k) => p[k]?.some((v) => v != null))) ranges.set(code, Object.fromEntries(RANGE_KEYS.map((k) => [k, p[k]])));
  }
  return { places, ranges };
}

/**
 * Accumulator for WPP2024_TotalPopulationBySex: Map<code, {medium: number[], constant: number[]}> of people
 * (PopTotal is in thousands, so x1000 and rounded), index = year - startYear. Only codes in `codes` are kept (all if null).
 */
export function populationAccumulator({ codes = null, startYear, endYear, variants = SCENARIO_VARIANTS }) {
  const want = codes && new Set(codes);
  const n = endYear - startYear + 1;
  const places = new Map();
  return {
    onRow(get) {
      const key = variants[get("Variant")];
      if (!key) return;
      const code = wppCode(get);
      if (!code || (want && !want.has(code))) return;
      const year = Number(get("Time"));
      if (!(year >= startYear && year <= endYear)) return;
      const v = Number(get("PopTotal"));
      if (get("PopTotal") === "" || !Number.isFinite(v)) return;
      let p = places.get(code);
      if (!p) places.set(code, (p = Object.fromEntries(Object.values(variants).map((k) => [k, new Array(n).fill(null)]))));
      p[key][year - startYear] = Math.round(v * 1000);
    },
    done: () => places,
  };
}

/**
 * Overlay the interim update on the main file's scenarios. Updated places take the revised medium projection. The UN
 * did not revise their other scenarios (release note: "interpret those results with caution, taking into
 * consideration the adjustments made here to the medium projection"), so each other scenario is rescaled year by year
 * by revised medium / original medium: same fertility and mortality rates, corrected population level. Returns the
 * list of adjustments made (published in scenarios.json).
 */
export function applyScenarioUpdate(places, updated) {
  const adjustments = [];
  for (const [code, rev] of updated) {
    const orig = places.get(code);
    if (!orig) continue;
    const scaled = [];
    for (const key of Object.keys(orig)) {
      if (key === "medium") continue;
      orig[key] = orig[key].map((v, i) => (v == null || rev.medium[i] == null || !orig.medium[i] ? null : Math.round((v * rev.medium[i]) / orig.medium[i])));
      scaled.push(key);
    }
    const ratios = rev.medium.map((v, i) => (v != null && orig.medium[i] ? v / orig.medium[i] : null)).filter((r) => r != null);
    orig.medium = rev.medium;
    adjustments.push({
      iso3: code,
      scenarios: scaled,
      ratioRange: ratios.length ? [Math.round(Math.min(...ratios) * 1000) / 1000, Math.round(Math.max(...ratios) * 1000) / 1000] : null,
    });
  }
  return adjustments;
}

/**
 * The interim update revised only the medium projection, so a revised place's range moves with it: each bound is
 * rescaled year by year by revised medium / original medium, as applyScenarioUpdate does for the other scenarios.
 * origMedium: Map<code, number[]> of the medium projection before the update.
 */
export function applyRangeUpdate(ranges, origMedium, updated) {
  for (const [code, rev] of updated) {
    const r = ranges.get(code);
    const orig = origMedium.get(code);
    if (!r || !orig) continue;
    for (const k of Object.keys(r)) r[k] = r[k].map((v, i) => (v == null || rev.medium[i] == null || !orig[i] ? null : Math.round((v * rev.medium[i]) / orig[i])));
  }
  return ranges;
}

// ---------- demographic indicators and age groups (the yearly series) ----------

export const INDICATOR_COLUMNS = ["LocID", "ISO3_code", "Location", "Time", "TPopulation1July", "Births", "Deaths", "NetMigrations", "NatChange", "TFR", "MedianAgePop", "CBR", "CDR"];
export const AGE_COLUMNS = ["LocID", "ISO3_code", "Time", "AgeGrpStart", "PopTotal"];
export const POPULATION_COLUMNS = ["LocID", "ISO3_code", "Variant", "Time", "PopTotal"];

const numberOr = (get, k, scale = 1) => {
  const s = get(k);
  if (s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v * scale : null;
};

/**
 * Accumulator for WPP2024_Demographic_Indicators_Medium: { places: Map<code, {name, years: Map<year, row>}>,
 * loc: Map<LocID, code> }. Counts are converted from thousands to people (not rounded here); rates stay as published.
 */
export function indicatorsAccumulator() {
  const places = new Map();
  const loc = new Map();
  return {
    onRow(get) {
      const code = wppCode(get);
      if (!code) return;
      loc.set(Number(get("LocID")), code);
      let p = places.get(code);
      if (!p) places.set(code, (p = { name: get("Location"), years: new Map() }));
      p.years.set(Number(get("Time")), {
        population: numberOr(get, "TPopulation1July", 1000),
        births: numberOr(get, "Births", 1000),
        deaths: numberOr(get, "Deaths", 1000),
        netMigration: numberOr(get, "NetMigrations", 1000),
        naturalChange: numberOr(get, "NatChange", 1000),
        tfr: numberOr(get, "TFR"),
        medianAge: numberOr(get, "MedianAgePop"),
        cbr: numberOr(get, "CBR"),
        cdr: numberOr(get, "CDR"),
      });
    },
    done: () => ({ places, loc }),
  };
}

/**
 * Accumulator for WPP2024_PopulationByAge5GroupSex: Map<code, Map<year, {total, age65plus, groups}>> in people (65+
 * includes 100+); groups = the set of AgeGrpStart values seen (used to check the interim update is complete).
 */
export function ageAccumulator() {
  const out = new Map();
  return {
    onRow(get) {
      const code = wppCode(get);
      if (!code) return;
      const v = numberOr(get, "PopTotal", 1000);
      if (v == null) return;
      const year = Number(get("Time"));
      let m = out.get(code);
      if (!m) out.set(code, (m = new Map()));
      const t = m.get(year) ?? { total: 0, age65plus: 0, groups: new Set() };
      const start = Number(get("AgeGrpStart"));
      t.total += v;
      t.groups.add(start);
      if (start >= 65) t.age65plus += v;
      m.set(year, t);
    },
    done: () => out,
  };
}

/**
 * Convert the UN rows into the parsed-dataset shape the model uses (same as parseOwidCsv): one dataset per topic,
 * entities: Map<code, {name, rawName, years: Map<year, {<key>Est | <key>Proj: value}>}>; years up to lastEstimateYear
 * are estimates, later years the medium projection. Names are the frozen display names (scripts/lib/names.mjs).
 */
export function wppDatasets(indicators, ages, { lastEstimateYear = WPP_LAST_ESTIMATE_YEAR, maxYear = 2100 } = {}) {
  const spec = {
    population: { popEst: "population" },
    fertility: { tfrEst: "tfr" },
    birthsDeaths: { birthsEst: "births", deathsEst: "deaths", cbrEst: "cbr", cdrEst: "cdr" },
    netMigration: { netMigEst: "netMigration" },
    medianAge: { medianAgeEst: "medianAge" },
  };
  const out = Object.fromEntries([...Object.keys(spec), "ageStructure"].map((k) => [k, { entities: new Map() }]));
  const entity = (ds, code, name) => {
    let e = out[ds].entities.get(code);
    if (!e) out[ds].entities.set(code, (e = { name, rawName: OWID_ALIASES[code] ?? name, years: new Map() }));
    return e;
  };
  for (const [code, p] of [...indicators].sort(([a], [b]) => a.localeCompare(b))) {
    const name = NAMES[code] ?? p.name;
    for (const [year, row] of p.years) {
      if (year > maxYear) continue;
      const suffix = year <= lastEstimateYear ? "Est" : "Proj";
      for (const [ds, keys] of Object.entries(spec)) {
        const y = {};
        for (const [key, field] of Object.entries(keys)) if (row[field] != null) y[key.replace(/Est$/, suffix)] = row[field];
        if (Object.keys(y).length) entity(ds, code, name).years.set(year, y);
      }
      const a = ages?.get(code)?.get(year);
      if (a && a.total > 0) entity("ageStructure", code, name).years.set(year, { [`pop65${suffix}`]: a.age65plus, [`popAll${suffix}`]: a.total });
    }
  }
  return out;
}

const INDICATOR_FIELDS = { population: "TPopulation1July", births: "Births", deaths: "Deaths", netMigration: "NetMigrations", naturalChange: "NatChange", tfr: "TFR", medianAge: "MedianAgePop", cbr: "CBR", cdr: "CDR" };

const yearList = (ys) => {
  const out = [];
  for (const y of ys) {
    const last = out.at(-1);
    if (last && y === last[1] + 1) last[1] = y;
    else out.push([y, y]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
};

/**
 * The interim update must hold every row the release note promises before it may replace anything: for each place
 * (the expected ones plus any other place found in a file), every year of `years` in all three files, every indicator
 * field filled, all 21 age groups, and the medium population. A header-only or truncated file would otherwise pass as
 * "ok" and leave the superseded figures in place. Returns a list of problems (empty = complete).
 */
export function checkUpdateCoverage({ indicators, ages, population }, { places = WPP_UPDATE.places, years = WPP_UPDATE.years } = {}) {
  const [y0, y1] = years;
  const all = new Set([...places, ...indicators.keys(), ...ages.keys(), ...population.keys()]);
  const F = WPP_UPDATE.files;
  const problems = [];
  for (const code of [...all].sort()) {
    const ind = indicators.get(code)?.years;
    const age = ages.get(code);
    const pop = population.get(code)?.medium;
    const missing = { ind: [], age: [], pop: [] };
    const fields = new Map();
    const groups = new Map();
    for (let y = y0; y <= y1; y++) {
      const row = ind?.get(y);
      if (!row) missing.ind.push(y);
      else for (const [k, col] of Object.entries(INDICATOR_FIELDS)) if (row[k] == null) fields.set(col, [...(fields.get(col) ?? []), y]);
      const a = age?.get(y);
      if (!a) missing.age.push(y);
      else {
        const lacking = AGE_GROUP_STARTS.filter((g) => !a.groups?.has(g));
        if (lacking.length) groups.set(y, lacking);
      }
      if (pop?.[y - y0] == null) missing.pop.push(y);
    }
    const span = `${y0}-${y1}`;
    if (!ind) problems.push(`${F.indicatorsMedium} has no rows for ${code} (expected ${span})`);
    else if (missing.ind.length) problems.push(`${F.indicatorsMedium} lacks ${code} ${yearList(missing.ind)}`);
    for (const [col, ys] of fields) problems.push(`${F.indicatorsMedium} has empty ${col} for ${code} ${yearList(ys)}`);
    if (!age) problems.push(`${F.ageGroupsMedium} has no rows for ${code} (expected ${span}, 21 age groups)`);
    else if (missing.age.length) problems.push(`${F.ageGroupsMedium} lacks ${code} ${yearList(missing.age)}`);
    if (groups.size) {
      const [y, g] = groups.entries().next().value;
      problems.push(`${F.ageGroupsMedium} lacks age groups for ${code} in ${groups.size} years (e.g. ${y}: ${g.map((x) => (x === 100 ? "100+" : `${x}-${x + 4}`)).join(", ")})`);
    }
    if (!population.get(code)) problems.push(`${F.populationBySex} has no Medium rows for ${code} (expected ${span})`);
    else if (missing.pop.length) problems.push(`${F.populationBySex} lacks ${code} Medium ${yearList(missing.pop)}`);
  }
  return problems;
}

/** Parse the three correction files from the update zip and check them. Throws (unmarked: a bad source, not a fetch failure). */
export async function readCheckedUpdate(update, { years = WPP_UPDATE.years, places = WPP_UPDATE.places } = {}) {
  const F = WPP_UPDATE.files;
  for (const name of Object.values(F)) if (!update.entries.has(name)) throw new Error(`interim update zip lacks ${name}`);
  const indicators = (await readUpdateCsv(update.entries, F.indicatorsMedium, indicatorsAccumulator(), { required: INDICATOR_COLUMNS })).places;
  const ages = await readUpdateCsv(update.entries, F.ageGroupsMedium, ageAccumulator(), { required: AGE_COLUMNS });
  const population = await readUpdateCsv(update.entries, F.populationBySex, populationAccumulator({ startYear: years[0], endYear: years[1], variants: { Medium: "medium" } }), { required: POPULATION_COLUMNS });
  const problems = checkUpdateCoverage({ indicators, ages, population }, { places, years });
  if (problems.length) throw new Error(`interim update is incomplete, refusing to apply it (Togo would keep its superseded figures): ${problems.slice(0, 6).join("; ")}${problems.length > 6 ? `; and ${problems.length - 6} more` : ""}`);
  return { indicators, ages, population, places: [...indicators.keys()].sort() };
}

/** Medium population of the update for startYear..endYear (the update file is read for its full year range). */
const sliceYears = (population, from, startYear, endYear) =>
  new Map([...population].map(([code, p]) => [code, { medium: p.medium.slice(startYear - from, endYear - from + 1) }]));

const vintageOf = (lastModified, timespan) => ({ lastUpdated: lastModified ?? null, nextUpdate: WPP_NEXT_RELEASE, citation: WPP_CITATION, timespan });

/**
 * Fetch UN WPP 2024 from population.un.org: the yearly series (Demographic Indicators + 5-year age groups) and the
 * population scenarios (Medium, Constant fertility), each with the interim update overlaid. Never throws: returns
 * { wpp (parsed datasets or null pieces), scenarios (or null), entries (manifest, one per file) }.
 */
export async function fetchUnWpp({ log = () => {}, scenarioYears = [2024, 2100], updateYears = WPP_UPDATE.years, updatePlaces = WPP_UPDATE.places } = {}) {
  const [startYear, endYear] = scenarioYears;
  const t0 = Date.now();
  const [upd, ind, age, pop] = await Promise.allSettled([
    fetchUpdateZip(),
    readGzipCsv(WPP_CSV.indicatorsMedium, indicatorsAccumulator, { required: INDICATOR_COLUMNS }),
    readGzipCsv(WPP_CSV.ageGroupsMedium, ageAccumulator, { required: AGE_COLUMNS }),
    readGzipCsv(WPP_CSV.populationBySex, () => populationAccumulator({ codes: null, startYear, endYear, variants: { ...SCENARIO_VARIANTS, ...RANGE_VARIANTS } }), { required: POPULATION_COLUMNS }),
  ]);
  const err = (r) => (r.status === "rejected" ? String(r.reason?.message ?? r.reason) : null);
  const entry = (id, title, url, required, result, columns, timespan, extra = {}) => ({
    id,
    title,
    url,
    required,
    status: result.status === "fulfilled" ? "ok" : "unavailable",
    vintage: result.status === "fulfilled" ? vintageOf(result.value.lastModified, timespan) : null,
    columns,
    error: err(result),
    ...extra,
  });
  const entries = [
    entry("demographicIndicators", "Demographic indicators, medium variant: population (1 July), births, deaths, net migration, fertility rate, median age", WPP_CSV.indicatorsMedium, true, ind, ["TPopulation1July", "Births", "Deaths", "NetMigrations", "TFR", "MedianAgePop"], "1950-2023 estimates, 2024-2100 medium projection"),
    entry("ageGroups", "Population by 5-year age group, medium variant (65+ share)", WPP_CSV.ageGroupsMedium, false, age, ["AgeGrpStart", "PopTotal"], "1950-2023 estimates, 2024-2100 medium projection"),
    entry("populationScenarios", "Total population by projection scenario: Medium and Constant fertility (scenarios.json); 80% and 95% prediction intervals and Zero migration (forecastRange in countries/{ISO3}.json)", WPP_CSV.populationBySex, false, pop, ["Variant", "PopTotal"], `${startYear}-${endYear}`),
    entry("interimUpdate", "Interim update of 19 January 2026: revised Togo population and vital events (estimates and medium projection)", WPP_UPDATE.url, true, upd, Object.values(WPP_UPDATE.files), "1950-2100", { releaseNote: WPP_UPDATE.releaseNote, released: WPP_UPDATE.released }),
  ];
  // The update is required: without it (or with an incomplete one) Togo would silently keep the superseded figures.
  let checked = null;
  if (upd.status === "fulfilled") {
    try {
      checked = await readCheckedUpdate(upd.value, { years: updateYears, places: updatePlaces });
    } catch (e) {
      Object.assign(entries[3], { status: "unavailable", error: String(e.message ?? e) });
    }
  }
  if (!checked) {
    for (const e of entries) log(`${e.status === "ok" ? "ok  " : "FAIL"} un-wpp/${e.id}${e.error ? ` (${e.error})` : ""}`);
    return { wpp: null, scenarios: null, entries };
  }
  const update = upd.value;
  const updatedCodes = new Set(checked.places);
  let indicators = null;
  if (ind.status === "fulfilled") {
    indicators = ind.value.value.places;
    for (const [code, p] of checked.indicators) indicators.set(code, p);
  }
  let ages = null;
  if (age.status === "fulfilled") {
    ages = age.value.value;
    for (const [code, m] of checked.ages) ages.set(code, m);
  }
  let scenarios = null;
  if (pop.status === "fulfilled") {
    const { places, ranges } = splitRanges(pop.value.value);
    const revised = sliceYears(checked.population, updateYears[0], startYear, endYear);
    const origMedium = new Map([...revised.keys()].filter((c) => places.has(c)).map((c) => [c, places.get(c).medium.slice()]));
    const adjustments = applyScenarioUpdate(places, revised);
    applyRangeUpdate(ranges, origMedium, revised);
    // Every corrected place must have been adjusted: a missing adjustment means its original rows were not found.
    const notAdjusted = checked.places.filter((c) => !adjustments.some((a) => a.iso3 === c));
    if (notAdjusted.length) {
      Object.assign(entries[2], { status: "unavailable", error: `no ${WPP_CSV.populationBySex.split("/").pop()} rows to correct for ${notAdjusted.join(" ")}` });
    } else scenarios = { startYear, endYear, places, ranges, adjustments, vintage: { lastModified: pop.value.lastModified, updateLastModified: update.lastModified } };
  }
  for (const e of entries) {
    if (e.status === "ok") e.updated = [...updatedCodes].sort();
    log(`${e.status === "ok" ? "ok  " : "FAIL"} un-wpp/${e.id}${e.error ? ` (${e.error})` : ""}`);
  }
  log(`...  un-wpp downloads and parsing took ${((Date.now() - t0) / 1000).toFixed(1)}s (interim update applied to ${[...updatedCodes].join(" ") || "nothing"})`);
  return { wpp: indicators ? wppDatasets(indicators, ages) : null, scenarios, entries };
}
