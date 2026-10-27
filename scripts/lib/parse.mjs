// Pure parsers for the upstream formats. No network access here, so everything is unit-testable.
import { readTable } from "./csv.mjs";

/** OWID entity code -> our ISO3 code, or null for aggregates/regions we do not publish. */
export function normalizeCode(code) {
  if (code === "OWID_WRL") return "WLD";
  if (code === "OWID_KOS") return "XKX"; // Kosovo: World Bank's code
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

const NAME_FIXES = { "Micronesia (country)": "Micronesia" };
export const cleanName = (name) => NAME_FIXES[name] ?? name;

/**
 * Parse an OWID grapher/explorer CSV (useColumnShortNames=true).
 * spec maps our key -> column-name prefix (OWID appends suffixes such as "__projected", so we match by prefix).
 * Returns { entities: Map<iso3, {name, years: Map<year, {key: number}>}>, found: {key: column}, missing: [keys] }.
 */
export function parseOwidCsv(text, spec) {
  const { header, rows } = readTable(text);
  const iEnt = header.indexOf("entity");
  const iCode = header.indexOf("code");
  const iYear = header.indexOf("year");
  if (iEnt < 0 || iCode < 0 || iYear < 0) {
    throw new Error(`Unexpected OWID CSV header (need entity,code,year): ${header.slice(0, 6).join(",")}`);
  }
  const found = {};
  const idx = [];
  const missing = [];
  for (const [key, prefix] of Object.entries(spec)) {
    const i = header.findIndex((h) => h === prefix || h.startsWith(prefix + "__"));
    if (i < 0) missing.push(key);
    else {
      found[key] = header[i];
      idx.push([key, i]);
    }
  }
  const entities = new Map();
  for (const r of rows) {
    const code = normalizeCode(r[iCode] ?? "");
    if (!code) continue;
    const year = Number(r[iYear]);
    if (!Number.isInteger(year)) continue;
    let e = entities.get(code);
    if (!e) entities.set(code, (e = { name: cleanName(r[iEnt]), rawName: r[iEnt], years: new Map() }));
    let y = e.years.get(year);
    for (const [key, i] of idx) {
      const raw = r[i];
      if (raw === undefined || raw === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      if (!y) e.years.set(year, (y = {}));
      y[key] = v;
    }
  }
  return { entities, found, missing };
}

/** Name -> ISO3 lookup built from OWID entities (used to map corridor CSV rows and mdim choices). */
export function nameIndex(entities) {
  const m = new Map();
  for (const [code, e] of entities) {
    m.set(e.name, code);
    if (e.rawName) m.set(e.rawName, code);
  }
  return m;
}

/** World Bank v2 indicator response (mrnev=1 or a date range) -> Map<iso3, {value, year}> keeping the newest non-null. */
export function parseWbLatest(json) {
  if (!Array.isArray(json) || json.length < 2) {
    const msg = Array.isArray(json) ? JSON.stringify(json[0]?.message ?? json[0]) : typeof json;
    throw new Error(`Unexpected World Bank response: ${msg}`);
  }
  const out = new Map();
  for (const d of json[1] ?? []) {
    const code = d.countryiso3code;
    if (d.value == null || !code || !/^[A-Z]{3}$/.test(code)) continue;
    const year = Number(d.date);
    const prev = out.get(code);
    if (!prev || prev.year < year) out.set(code, { value: Number(d.value), year });
  }
  return { values: out, lastUpdated: json[0]?.lastupdated ?? null, indicatorName: json[1]?.[0]?.indicator?.value ?? null };
}

/** World Bank country list -> Map<iso3, {name, region, incomeGroup, iso2, aggregate}>. */
export function parseWbCountries(json) {
  if (!Array.isArray(json) || !Array.isArray(json[1])) throw new Error("Unexpected World Bank country list response");
  const out = new Map();
  for (const c of json[1]) {
    const aggregate = c.region?.value?.trim() === "Aggregates";
    const income = c.incomeLevel?.value?.trim();
    out.set(c.id, {
      name: c.name,
      region: aggregate ? null : c.region?.value?.trim() || null,
      incomeGroup: !aggregate && income && income !== "Not classified" ? income : null,
      iso2: c.iso2Code || null,
      aggregate,
    });
  }
  return out;
}

/**
 * OWID "migration-origin-destination" CSV for one country/metric -> top partner countries for the latest year.
 * Rows are partner entities (countries, plus regional aggregates which we drop).
 */
export function parseCorridorCsv(text, selfCode, { top = 10 } = {}) {
  const { header, rows } = readTable(text);
  const iCode = header.indexOf("code");
  const iEnt = header.indexOf("entity");
  const iYear = header.indexOf("year");
  const iVal = header.findIndex((h) => h.startsWith("migrants__"));
  if (iCode < 0 || iYear < 0 || iVal < 0) throw new Error(`Unexpected corridor CSV header: ${header.join(",")}`);
  let year = -Infinity;
  for (const r of rows) if (r[iVal] !== "") year = Math.max(year, Number(r[iYear]));
  const partners = [];
  let total = null;
  for (const r of rows) {
    if (Number(r[iYear]) !== year || r[iVal] === "") continue;
    const v = Number(r[iVal]);
    if (r[iCode] === "OWID_WRL") total = v;
    const code = normalizeCode(r[iCode]);
    if (!code || code === "WLD" || code === selfCode || !(v > 0)) continue;
    partners.push({ iso3: code, name: cleanName(r[iEnt]), people: Math.round(v) });
  }
  partners.sort((a, b) => b.people - a.people || a.iso3.localeCompare(b.iso3));
  return { year: Number.isFinite(year) ? year : null, total, partners: partners.slice(0, top) };
}

/** Extract the mdim dimension choices (e.g. country_select) embedded in an OWID grapher HTML page. */
export function parseMdimChoices(html, dimensionSlug) {
  const at = html.indexOf(`"slug": "${dimensionSlug}"`);
  const at2 = at >= 0 ? at : html.indexOf(`"slug":"${dimensionSlug}"`);
  if (at2 < 0) return null;
  const start = html.indexOf("[", html.indexOf('"choices"', at2));
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === "[") depth++;
    else if (html[i] === "]" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)).map((c) => ({ slug: c.slug, name: c.name }));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** OWID .metadata.json -> vintage info for one dataset. */
export function parseOwidMetadata(meta) {
  const cols = Object.values(meta?.columns ?? {}).filter((c) => c.lastUpdated && !/region according to OWID/i.test(c.titleShort ?? ""));
  const pick = (k) => [...new Set(cols.map((c) => c[k]).filter(Boolean))].sort();
  return {
    lastUpdated: pick("lastUpdated").at(-1) ?? null,
    nextUpdate: pick("nextUpdate").at(-1) ?? null,
    citation: cols[0]?.citationShort ?? null,
    timespan: pick("timespan").join(", ") || null,
  };
}
