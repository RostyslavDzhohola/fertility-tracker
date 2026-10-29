// How sure is each number: a per-place disclosure built from primary sources only.
//   - what the UN says it based each place on (World Population Prospects 2024: Data Sources, a PDF extracted once
//     into scripts/data/wpp2024-data-sources.json by scripts/extract/wpp_data_sources.py);
//   - what national offices last reported to the UN (UN Statistics Division, Population and Vital Statistics Report,
//     tables 2 and 3, extracted into scripts/data/unsd-pvsr.json by scripts/extract/unsd_pvsr.py);
//   - how UN DESA measured each place's migrants (International Migrant Stock 2024, "Data type" column);
//   - the UN's own forecast range (80% and 95% prediction intervals) and its Zero-migration scenario;
//   - newer national figures: Eurostat (population on 1 January, people born abroad), fetched every build, and
//     hand-checked notes in scripts/data/crosschecks.json (docs/CROSS-CHECK-PROCESS.md).
// Levels are "good" | "fair" | "poor" by the rules in LEVEL_RULES (published in index.json and docs/METHODOLOGY.md).
// Words for people are written by the site (public/js/logic.js); this module only publishes facts and levels.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getBuffer, getJson } from "./http.mjs";
import { round } from "./model.mjs";
import { readXlsx } from "./xlsx.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);

export const DESA_DESTINATION_XLSX =
  "https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_and_destination.xlsx";
export const EUROSTAT_API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
export const EUROSTAT_POPULATION_URL = `${EUROSTAT_API}/demo_gind?format=JSON&lang=EN&indic_de=JAN&sinceTimePeriod=2023`;
export const EUROSTAT_FOREIGN_BORN_URL = `${EUROSTAT_API}/migr_pop3ctb?format=JSON&lang=EN&c_birth=FOR&age=TOTAL&sex=T&unit=NR&sinceTimePeriod=2023`;
export const EUROSTAT_PAGES = {
  population: "https://ec.europa.eu/eurostat/databrowser/view/demo_gind/default/table?lang=en",
  foreignBorn: "https://ec.europa.eu/eurostat/databrowser/view/migr_pop3ctb/default/table?lang=en",
};

/** A census older than this is "more than 15 years ago": the UN's own cutoff (WPP 2024 Summary of Results, annex 1). */
export const OLD_CENSUS_YEARS = 15;
/** Only censuses from this year on are compared as "a census the UN couldn't use yet". */
export const NEW_CENSUS_FROM = 2015;
/**
 * Eurostat's figure for these places includes areas the UN lists on their own (France: its five overseas regions),
 * so the UN figure compared is the sum.
 */
export const EUROSTAT_INCLUDES = { FRA: ["GLP", "MTQ", "GUF", "REU", "MYT"] };
/** National footnotes that never change how a number compares (dates, rounding, sex totals). */
const TRIVIAL_NOTE = /^Data refer to (\d|the Iranian Year)|randomly|rounding|may not add up|intersex|Densely Inhabited|unknown sex|^Figures for male and female/i;
/** For births and deaths, only footnotes about which area or people are covered. */
const COVERAGE_NOTE = /not in a position|controlled|occupied|exclud|without the data|not included|residents only|nationals only|including the number of transcribed/i;

/** Births and deaths are compared only for places with at least this many people (the ranking's threshold). */
export const MIN_EVENTS_POPULATION = 100_000;
/** Within this many per cent, two figures "match". */
export const MATCH_PCT = 2;
/** A newer official population this many per cent away from the UN's lowers the "today" level by one step. */
export const DOWNGRADE_PCT = 5;

export const LEVELS = ["good", "fair", "poor"];
export const LEVEL_RULES = {
  today: {
    good:
      "Counted by a census in the last 10 years, kept by a population register, or kept current: births and deaths fully registered and the country's own population figure from the last two years within 2% of the UN's",
    fair: "Last census 11 to 15 years ago",
    poor: "Last census more than 15 years ago (the UN's own cutoff), or none",
    downgrade: `One step lower when a newer official population differs from the UN's by more than ${DOWNGRADE_PCT}%`,
  },
  birthsDeaths: {
    good: "Births and deaths both registered and reported as virtually complete (at least 90%), for 2018 or later",
    fair: "Registered, but at least one of the two incomplete or out of date: the UN corrects them",
    poor: "No usable registration: the UN estimates births and deaths from surveys and models",
  },
  immigration: {
    good: "Counted by country of birth (census or population register), and reassessed by the UN for 2024",
    fair: "Counted by citizenship (misses people who became citizens, counts children born there to foreign parents), or by country of birth but only carried forward from the UN's 2020 edition",
    poor: "No data (the UN modelled the number), or counted by citizenship and only carried forward from 2020",
  },
  forecast: {
    good: "The UN's 95% range for 2050 is within 20% either side of its forecast",
    fair: "The 95% range for 2050 is 20% to 40% either side",
    poor: "The 95% range for 2050 is more than 40% either side",
    note: "By 2100 every range is wide: a typical place's 95% range runs from half to twice the forecast",
  },
  overall: "The lower of the levels for today's population and for births and deaths",
};

const worse = (...ls) => ls.filter(Boolean).reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), null);
const lower = (l) => (l == null ? null : LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(l) + 1)]);
export const gapPct = (un, other) => (un == null || !other ? null : round(((un - other) / other) * 100, 1));
export const verdictOf = (gap) => (gap == null ? "context" : Math.abs(gap) <= MATCH_PCT ? "matches" : gap > 0 ? "un-higher" : "un-lower");

// ---------------------------------------------------------------- inputs

async function readData(name) {
  try {
    return JSON.parse(await readFile(new URL(name, DATA_DIR), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new Error(`scripts/data/${name}: ${err.message}`);
  }
}

/**
 * UN DESA "Data type" per place, keyed by UN location code (= ISO 3166 numeric): B foreign-born, C foreign citizens,
 * I imputed (no data); R = UNHCR refugees added. Rows: Table 1 of the destination workbook.
 */
export function parseDesaDataTypes(rows) {
  const head = rows.findIndex((r) => r?.[3] === "Data type" && r?.[4] === "Location code");
  if (head < 0) throw new Error("UN DESA destination workbook: no 'Data type' / 'Location code' header in Table 1");
  const out = new Map();
  for (const r of rows.slice(head + 1)) {
    const code = r?.[4];
    const raw = typeof r?.[3] === "string" ? r[3].trim() : "";
    if (!Number.isInteger(code) || !raw) continue;
    const parts = raw.split(/\s+/);
    const basis = parts.filter((p) => p !== "R").join("");
    if (!/^[BCI]+$/.test(basis)) throw new Error(`UN DESA destination workbook: unknown data type "${raw}" for location ${code}`);
    out.set(code, { type: basis, refugeesAdded: parts.includes("R") });
  }
  if (out.size < 200) throw new Error(`UN DESA destination workbook: only ${out.size} places with a data type`);
  return out;
}

/** JSON-stat 2.0 (Eurostat) -> Map<geo, Map<year, {value, flag}>>, for a dataset varying only by geo and time. */
export function parseJsonStat(d) {
  const ids = d.id;
  const size = d.size;
  const gi = ids.indexOf("geo");
  const ti = ids.indexOf("time");
  if (gi < 0 || ti < 0) throw new Error("Eurostat: no geo/time dimension");
  for (let i = 0; i < ids.length; i++) if (i !== gi && i !== ti && size[i] !== 1) throw new Error(`Eurostat: dimension ${ids[i]} has ${size[i]} values`);
  const byIndex = (dim) => Object.fromEntries(Object.entries(d.dimension[dim].category.index).map(([k, v]) => [v, k]));
  const geos = byIndex("geo");
  const times = byIndex("time");
  const stride = (i) => size.slice(i + 1).reduce((a, b) => a * b, 1);
  const gs = stride(gi);
  const ts = stride(ti);
  const out = new Map();
  for (const [k, v] of Object.entries(d.value ?? {})) {
    const n = Number(k);
    const geo = geos[Math.floor(n / gs) % size[gi]];
    const year = Number(times[Math.floor(n / ts) % size[ti]]);
    if (!out.has(geo)) out.set(geo, new Map());
    out.get(geo).set(year, { value: v, flag: d.status?.[k] ?? null });
  }
  return out;
}

/** Eurostat geo code -> ISO 3166 alpha-2 (Eurostat writes EL for Greece, UK for the United Kingdom). */
export const eurostatIso2 = (geo) => ({ EL: "GR", UK: "GB" })[geo] ?? (/^[A-Z]{2}$/.test(geo) ? geo : null);

const entry = (id, title, url, extra = {}) => ({ id, title, url, status: "ok", lastUpdated: null, error: null, ...extra });

/**
 * Is each extracted PDF still the edition online? docs: [{ url, sha256 }]. Returns true (all the same), false (a new
 * edition: rerun scripts/extract/, see its README) or null (could not download one). Never throws.
 */
export async function sameEditions(docs) {
  const results = await Promise.all(
    docs.map(async ({ url, sha256 }) => {
      if (!url || !sha256) return null;
      try {
        const { buffer } = await getBuffer(url);
        return createHash("sha256").update(buffer).digest("hex") === sha256;
      } catch {
        return null;
      }
    }),
  );
  return results.includes(false) ? false : results.includes(null) ? null : true;
}

/**
 * Fetch every confidence input. Never throws for one source: a missing piece leaves its fields null and its manifest
 * entry "unavailable". Returns { wppSources, pvsr, curated, desaTypes, eurostat: {population, foreignBorn}, entries }.
 */
export async function fetchConfidenceSources(log = () => {}) {
  const entries = [];
  const note = (e) => {
    entries.push(e);
    log(`${e.status === "ok" ? "ok  " : "FAIL"} quality/${e.id}${e.error ? ` (${e.error})` : ""}${e.current === false ? " (WARN: a new edition is online; rerun scripts/extract/)" : ""}`);
    return e;
  };
  const [wppSources, pvsr, curated, reassessed] = await Promise.all(
    ["wpp2024-data-sources.json", "unsd-pvsr.json", "crosschecks.json", "desa-2024-reassessed.json"].map(readData),
  );
  // A new edition of an extracted PDF leaves our copy stale: say so in index.json (dataGaps) and in the build log.
  const [wppCurrent, pvsrCurrent, reassessedCurrent] = await Promise.all([
    sameEditions(wppSources ? [wppSources.source] : []),
    sameEditions(pvsr ? Object.values(pvsr.source.tables) : []),
    sameEditions(reassessed ? [reassessed.source] : []),
  ]);
  note(
    entry("wppDataSources", "World Population Prospects 2024: Data Sources (what the UN based each place on)", wppSources?.source?.url ?? null, {
      current: wppSources ? wppCurrent : null,
      file: "scripts/data/wpp2024-data-sources.json",
      lastUpdated: wppSources?.source?.published ?? null,
      sha256: wppSources?.source?.sha256 ?? null,
      ...(wppSources ? {} : { status: "unavailable", error: "scripts/data/wpp2024-data-sources.json missing" }),
    }),
  );
  note(
    entry("unsdPvsr", "Population and Vital Statistics Report, tables 2 and 3 (latest census, official estimate, registered births and deaths)", pvsr?.source?.page ?? null, {
      current: pvsr ? pvsrCurrent : null,
      file: "scripts/data/unsd-pvsr.json",
      lastUpdated: pvsr?.source?.tables?.["2"]?.lastUpdated ?? null,
      tables: pvsr ? Object.fromEntries(Object.entries(pvsr.source.tables).map(([k, t]) => [k, { url: t.url, lastUpdated: t.lastUpdated, sha256: t.sha256 }])) : null,
      ...(pvsr ? {} : { status: "unavailable", error: "scripts/data/unsd-pvsr.json missing" }),
    }),
  );
  note(
    entry("crossChecks", "Hand-checked notes from national and UN agency sources", null, {
      file: "scripts/data/crosschecks.json",
      lastUpdated: curated?.checked ?? null,
      places: curated ? Object.keys(curated.places).length : 0,
      ...(curated ? {} : { status: "unavailable", error: "scripts/data/crosschecks.json missing" }),
    }),
  );

  note(
    entry("desaReassessed", "International Migrant Stock 2024: Key facts and figures, footnote 3 (the 60 places fully reassessed for 2024)", reassessed?.source?.url ?? null, {
      file: "scripts/data/desa-2024-reassessed.json",
      current: reassessed ? reassessedCurrent : null,
      sha256: reassessed?.source?.sha256 ?? null,
      ...(reassessed ? {} : { status: "unavailable", error: "scripts/data/desa-2024-reassessed.json missing" }),
    }),
  );

  const [desa, pop, fb] = await Promise.allSettled([
    getBuffer(DESA_DESTINATION_XLSX).then((b) => parseDesaDataTypes(readXlsx(b.buffer).sheet("Table 1"))),
    getJson(EUROSTAT_POPULATION_URL),
    getJson(EUROSTAT_FOREIGN_BORN_URL),
  ]);
  const fail = (r) => String(r.reason?.message ?? r.reason);
  note(entry("desaDataType", "International Migrant Stock 2024, Table 1 'Data type' (how each place's migrants were counted)", DESA_DESTINATION_XLSX, desa.status === "fulfilled" ? {} : { status: "unavailable", error: fail(desa) }));
  const eurostat = { population: null, foreignBorn: null };
  for (const [key, r, id, title, url] of [
    ["population", pop, "eurostatPopulation", "Eurostat demo_gind: population on 1 January", EUROSTAT_POPULATION_URL],
    ["foreignBorn", fb, "eurostatForeignBorn", "Eurostat migr_pop3ctb: population on 1 January born abroad", EUROSTAT_FOREIGN_BORN_URL],
  ]) {
    let error = r.status === "rejected" ? fail(r) : null;
    if (!error) {
      try {
        const parsed = parseJsonStat(r.value);
        if (parsed.size < 25) throw new Error(`only ${parsed.size} places`);
        eurostat[key] = { data: parsed, updated: r.value.updated?.slice(0, 10) ?? null };
      } catch (e) {
        error = String(e.message ?? e);
      }
    }
    note(entry(id, title, url, { page: EUROSTAT_PAGES[key], lastUpdated: eurostat[key]?.updated ?? null, ...(error ? { status: "unavailable", error } : {}) }));
  }
  return {
    wppSources,
    pvsr,
    curated,
    desaReassessed: reassessed ? new Set(reassessed.reassessed) : null,
    desaTypes: desa.status === "fulfilled" ? desa.value : null,
    eurostat,
    entries,
  };
}

// ---------------------------------------------------------------- per place

/** 1 July population for a year from the place's series (estimates, then the medium projection). */
const julyPop = (series, year) => series.find((r) => r.year === year)?.population ?? null;

/** UN population on a date (YYYY-MM-DD), interpolated linearly in time between the 1 July figures around it. */
export function unPopulationOn(series, date) {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const y0 = t >= Date.UTC(y, 6, 1) ? y : y - 1;
  const a = julyPop(series, y0);
  const b = julyPop(series, y0 + 1);
  if (a == null || b == null) return null;
  const f = (t - Date.UTC(y0, 6, 1)) / (Date.UTC(y0 + 1, 6, 1) - Date.UTC(y0, 6, 1));
  return Math.round(a + (b - a) * f);
}

/** The forecast's spread at a year, from forecastRange and the medium series. */
function rangeAt(range, series, year) {
  if (!range) return null;
  const i = year - range.startYear;
  const medium = julyPop(series, year);
  const pick = (k) => range[k]?.[i] ?? null;
  if (medium == null || pick("lower95") == null || pick("upper95") == null) return null;
  return { year, medium, lower80: pick("lower80"), upper80: pick("upper80"), lower95: pick("lower95"), upper95: pick("upper95"), zeroMigration: pick("zeroMigration") };
}

function todayLevel({ lastCount, register }, year) {
  if (register) return "good";
  if (lastCount == null) return "poor";
  const age = year - lastCount;
  return age <= 10 ? "good" : age <= OLD_CENSUS_YEARS ? "fair" : "poor";
}

const isComplete = (v, from = 2018) => v?.code === "C" && v.year >= from;
function birthsDeathsLevel(pvsrPlace, ds) {
  const b = pvsrPlace?.births;
  const d = pvsrPlace?.deaths;
  if (isComplete(b) && isComplete(d)) return "good";
  // Registered, but incomplete (U) or complete only for an old year.
  if (["C", "U"].includes(b?.code) || ["C", "U"].includes(d?.code)) return "fair";
  // No registration code from the national office: what the UN says it used.
  const rb = ds?.registeredBirthsThrough ?? 0;
  const rd = ds?.registeredDeathsThrough ?? 0;
  if (!b && !d && rb >= 2018 && rd >= 2018 && !ds.birthsAdjusted && !ds.deathsAdjusted) return "good";
  if (rb >= 2010 || rd >= 2010) return "fair";
  return "poor";
}

/** By how the migrants were counted; one step lower when the 2024 figure only extrapolates the 2020 edition. */
function immigrationLevel(t, reassessed) {
  if (t == null) return null;
  const base = t.type === "B" ? "good" : t.type.includes("I") ? "poor" : "fair";
  return reassessed === false ? lower(base) : base;
}

/** By the half-width of the UN's 95% range for 2050, relative to its forecast (2100 ranges are wide everywhere). */
function forecastLevel(r2050) {
  if (!r2050?.medium) return null;
  const half = (r2050.upper95 - r2050.lower95) / 2 / r2050.medium;
  return half <= 0.2 ? "good" : half <= 0.4 ? "fair" : "poor";
}

/** Census dates in the UNSD table can be ranges; the table keeps the first day. Sample surveys are not counts. */
const isCensus = (c) => c && !/^SS/.test(c.code ?? "");

/**
 * Automatic comparisons with the newest national figures. Returns cross-check objects (kind: eurostat | unsd).
 * Population: Eurostat's latest 1 January figure where it has one, else the UNSD table's latest official estimate.
 * A census newer than anything the UN used is compared too. Births and deaths: registered counts reported as
 * complete, compared with the UN's figure for the same year.
 */
function autoChecks({ rec, series, seriesOf, ds, pvsrPlace, footnotes, eurostat, stock, desa, latestEstimateYear }) {
  const out = [];
  const iso2 = rec.iso2;
  // The national office's own footnotes to its figures (what area, which census it builds on), minus trivial ones.
  const notesOf = (table, ...lists) => {
    const texts = [...new Set(lists.flat().filter((n) => n != null))].map((n) => footnotes?.[table]?.[String(n)]).filter(Boolean);
    return [...new Set(texts)].filter((t) => !TRIVIAL_NOTE.test(t));
  };
  const placeNotes = (table) => pvsrPlace?.notes?.[table] ?? [];
  const popNotes = notesOf("2", placeNotes("2"), pvsrPlace?.estimate?.notes ?? []);
  const unsdAsOf = pvsrPlace ? (footnotes?.asOf ?? null) : null;
  const extra = EUROSTAT_INCLUDES[rec.iso3] ?? [];
  const esGeo = iso2 ? [...(eurostat.population?.data.keys() ?? [])].find((g) => eurostatIso2(g) === iso2) : null;
  const esPop = esGeo ? eurostat.population.data.get(esGeo) : null;
  const esYear = esPop ? Math.max(...[...esPop.keys()].filter((y) => esPop.get(y).value != null)) : null;
  if (esPop && Number.isFinite(esYear)) {
    const date = `${esYear}-01-01`;
    const { value, flag } = esPop.get(esYear);
    const parts = [unPopulationOn(series, date), ...extra.map((c) => unPopulationOn(seriesOf(c) ?? [], date))];
    const un = parts.some((v) => v == null) ? null : parts.reduce((a, b) => a + b, 0);
    const gap = gapPct(un, value);
    out.push({
      key: "today",
      kind: "eurostat",
      asOf: eurostat.population.updated,
      figure: { value, what: "population on 1 January, reported by the national statistics office to Eurostat", date, provisional: /p/.test(flag ?? ""), estimated: /e/.test(flag ?? "") },
      unFigure: {
        value: un,
        what: `UN figure for the same day (between its 1 July ${esYear - 1} and ${esYear} figures)${extra.length ? `, adding ${extra.join(", ")}, which Eurostat counts as part of it` : ""}`,
        date,
        forecast: esYear - 1 > latestEstimateYear,
      },
      notes: popNotes,
      gapPct: gap,
      verdict: verdictOf(gap),
      links: [{ label: "Eurostat: population on 1 January (demo_gind)", href: EUROSTAT_PAGES.population }],
    });
  } else if (pvsrPlace?.estimate?.total) {
    const e = pvsrPlace.estimate;
    const un = julyPop(series, e.year);
    const gap = gapPct(un, e.total);
    out.push({
      key: "today",
      kind: "unsd",
      asOf: unsdAsOf,
      figure: { value: e.total, what: "official mid-year estimate the country reported to the UN Statistics Division", date: String(e.year), provisional: !!e.provisional, estimated: false },
      unFigure: { value: un, what: `UN figure for 1 July ${e.year}`, date: `${e.year}-07-01`, forecast: e.year > latestEstimateYear },
      notes: popNotes,
      gapPct: gap,
      verdict: verdictOf(gap),
      links: [{ label: "UN Statistics Division: latest census and estimates (table 2)", href: "https://unstats.un.org/unsd/demographic-social/products/vitstats/seratab2.pdf" }],
    });
  }
  const c = pvsrPlace?.census;
  const unLast = lastUnCount(ds);
  if (isCensus(c) && c.total && c.date && Number(c.date.slice(0, 4)) >= NEW_CENSUS_FROM && Number(c.date.slice(0, 4)) > (unLast ?? 0)) {
    const un = unPopulationOn(series, c.date);
    const gap = gapPct(un, c.total);
    out.push({
      key: "census",
      kind: "unsd",
      asOf: unsdAsOf,
      figure: { value: c.total, what: "people counted by the census", date: c.date, provisional: !!c.provisional, estimated: false },
      unFigure: { value: un, what: "UN figure for the census day", date: c.date, forecast: Number(c.date.slice(0, 4)) > latestEstimateYear },
      gapPct: gap,
      verdict: verdictOf(gap),
      unUsedUpTo: unLast,
      notes: notesOf("2", placeNotes("2"), c.notes ?? []),
      links: [{ label: "UN Statistics Division: latest census and estimates (table 2)", href: "https://unstats.un.org/unsd/demographic-social/products/vitstats/seratab2.pdf" }],
    });
  }
  // Registered births and deaths, for places big enough that a few events don't swing the comparison.
  for (const key of ["births", "deaths"]) {
    const v = pvsrPlace?.[key];
    if (!v || v.code !== "C" || !v.number || v.numberUnclear || v.year < 2021 || !(julyPop(series, v.year) >= MIN_EVENTS_POPULATION)) continue;
    const un = series.find((r) => r.year === v.year)?.[key] ?? null;
    const gap = gapPct(un, v.number);
    out.push({
      key,
      kind: "unsd",
      asOf: unsdAsOf,
      figure: { value: v.number, what: key === "births" ? "births registered (registration reported as virtually complete)" : "deaths registered (registration reported as virtually complete)", date: String(v.year), provisional: !!v.provisional, estimated: false },
      notes: notesOf("3", placeNotes("3"), v.notes ?? []).filter((t) => COVERAGE_NOTE.test(t)),
      unFigure: { value: un, what: `UN figure for ${v.year}`, date: String(v.year), forecast: v.year > latestEstimateYear },
      gapPct: gap,
      verdict: verdictOf(gap),
      links: [{ label: "UN Statistics Division: births and deaths (table 3)", href: "https://unstats.un.org/unsd/demographic-social/products/vitstats/seratab3.pdf" }],
    });
  }
  const fbGeo = iso2 ? [...(eurostat.foreignBorn?.data.keys() ?? [])].find((g) => eurostatIso2(g) === iso2) : null;
  const fb = fbGeo ? eurostat.foreignBorn.data.get(fbGeo) : null;
  const fbYear = fb ? Math.max(...[...fb.keys()].filter((y) => fb.get(y).value != null)) : null;
  if (fb && Number.isFinite(fbYear) && stock?.immigrants != null) {
    const { value, flag } = fb.get(fbYear);
    const gap = gapPct(stock.immigrants, value);
    out.push({
      key: "immigrants",
      kind: "eurostat",
      asOf: eurostat.foreignBorn.updated,
      figure: { value, what: "people living there who were born in another country, on 1 January", date: `${fbYear}-01-01`, provisional: /p/.test(flag ?? ""), estimated: /e/.test(flag ?? "") },
      unFigure: { value: stock.immigrants, what: `UN DESA estimate for mid-${stock.year}`, date: `${stock.year}-07-01`, forecast: false },
      gapPct: gap,
      verdict: verdictOf(gap),
      unAddsRefugees: desa?.refugeesAdded ?? null,
      notes: [],
      links: [{ label: "Eurostat: population by country of birth (migr_pop3ctb)", href: EUROSTAT_PAGES.foreignBorn }],
    });
  }
  return out;
}

/** The newest census or register year the UN says it used (null if none). */
export function lastUnCount(ds) {
  const years = [...(ds?.censuses ?? []), ...(ds?.registers ?? [])];
  return years.length ? Math.max(...years) : null;
}

/** Hand-checked notes for a place, as published (scripts/data/crosschecks.json, docs/CROSS-CHECK-PROCESS.md). */
const plainFigure = (f) => (f ? { value: f.value ?? null, what: f.what, date: String(f.date) } : null);
function curatedChecks(curated, code) {
  return (curated?.places?.[code] ?? []).map((c) => ({
    key: c.key,
    kind: "researched",
    text: c.text,
    figure: plainFigure(c.figure),
    unFigure: plainFigure(c.unFigure),
    gapPct: c.figure?.value != null && c.unFigure?.value != null ? gapPct(c.unFigure.value, c.figure.value) : null,
    verdict: c.verdict,
    links: c.links,
    quotes: c.quotes ?? [],
    accessed: c.accessed,
  }));
}

/**
 * Everything the site says about how sure a place's numbers are.
 * Returns { confidence, crossChecks } for countries/{ISO3}.json; forecastRange is published alongside.
 */
export function buildConfidence({ rec, series, seriesOf = () => null, range, stock, sources, latestEstimateYear, year }) {
  const code = rec.iso3;
  if (code === "WLD") return { confidence: null, crossChecks: [] };
  const ds = sources.wppSources?.places?.[code] ?? null;
  const pvsrPlace = sources.pvsr?.places?.[code] ?? null;
  const desa = rec.isoNumeric != null ? (sources.desaTypes?.get(Number(rec.isoNumeric)) ?? null) : null;

  const unLast = lastUnCount(ds);
  const register = (ds?.registers ?? []).some((y) => y >= year - 10);
  const pvsrCensus = isCensus(pvsrPlace?.census) && pvsrPlace.census.date ? pvsrPlace.census : null;
  const pvsrYear = pvsrCensus ? Number(pvsrCensus.date.slice(0, 4)) : null;
  const lastCount = Math.max(unLast ?? -Infinity, pvsrYear ?? -Infinity);
  const crossChecks = [
    ...autoChecks({
      rec,
      series,
      seriesOf,
      ds,
      pvsrPlace,
      footnotes: sources.pvsr ? { ...sources.pvsr.footnotes, asOf: sources.pvsr.source?.tables?.["2"]?.lastUpdated ?? null } : null,
      eurostat: sources.eurostat,
      stock,
      desa,
      latestEstimateYear,
    }),
    ...curatedChecks(sources.curated, code),
  ];

  let today = ds || pvsrCensus ? todayLevel({ lastCount: Number.isFinite(lastCount) ? lastCount : null, register }, year) : null;
  const birthsDeaths = ds || pvsrPlace ? birthsDeathsLevel(pvsrPlace, ds) : null;
  // Kept current between censuses: every birth and death registered, and the country's own recent figure agrees with
  // the UN's (Sweden and the Netherlands count everyone through registers; their last listed census is 2011).
  const recentOfficial = crossChecks.filter((c) => c.key === "today" && c.kind !== "researched" && Number(String(c.figure?.date).slice(0, 4)) >= year - 2);
  const keptCurrent = today != null && today !== "good" && birthsDeaths === "good" && recentOfficial.some((c) => c.verdict === "matches");
  if (keptCurrent) today = "good";
  const popGap = crossChecks.filter((c) => (c.key === "today" || c.key === "census") && c.gapPct != null).map((c) => Math.abs(c.gapPct));
  const downgraded = today != null && popGap.some((g) => g > DOWNGRADE_PCT);
  if (downgraded) today = lower(today);
  const reassessed = sources.desaReassessed ? sources.desaReassessed.has(code) : null;
  const immigration = immigrationLevel(desa, reassessed);
  const r2050 = rangeAt(range, series, 2050);
  const r2100 = rangeAt(range, series, 2100);
  const forecast = forecastLevel(r2050);

  const pv = (v) => (v ? { year: v.year, code: v.code, byRegistration: !!v.byRegistration } : null);
  return {
    confidence: {
      level: worse(today, birthsDeaths),
      today: {
        level: today,
        lastCount: Number.isFinite(lastCount) ? lastCount : null,
        unCensuses: ds?.censuses ?? [],
        unRegisters: ds?.registers ?? [],
        register,
        keptCurrent,
        unOfficialEstimatesThrough: ds?.officialEstimatesThrough ?? null,
        latestCensus: pvsrCensus ? { date: pvsrCensus.date, total: pvsrCensus.total ?? null, provisional: !!pvsrCensus.provisional } : null,
        downgraded,
      },
      birthsDeaths: {
        level: birthsDeaths,
        births: pv(pvsrPlace?.births),
        deaths: pv(pvsrPlace?.deaths),
        unRegisteredBirthsThrough: ds?.registeredBirthsThrough ?? null,
        unRegisteredDeathsThrough: ds?.registeredDeathsThrough ?? null,
        unBirthsAdjusted: ds?.birthsAdjusted ?? null,
        unDeathsAdjusted: ds?.deathsAdjusted ?? null,
      },
      immigration: {
        level: immigration,
        dataType: desa?.type ?? null,
        refugeesAdded: desa?.refugeesAdded ?? null,
        reassessed2024: reassessed,
        netMigrationBasis: ds?.migrationBasis ?? [],
      },
      forecast: { level: forecast, at: [r2050, r2100].filter(Boolean) },
      unSources: ds
        ? {
            page: ds.page ?? null,
            population: ds.text?.population ?? null,
            fertility: ds.text?.fertility ?? null,
            mortality: ds.text?.overallMortality ?? null,
            migration: ds.text?.migration ?? null,
          }
        : null,
    },
    crossChecks,
  };
}

/** forecastRange for countries/{ISO3}.json: the UN's yearly 80%/95% bounds and Zero-migration path, or null. */
export function forecastRange(ranges, code, startYear) {
  const r = ranges?.get(code);
  if (!r) return null;
  return { startYear, ...r };
}
