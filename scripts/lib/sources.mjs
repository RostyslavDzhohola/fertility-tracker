// Upstream sources: exact URLs, what we take from each, and fetchers that return parsed data + a status manifest.
import { getJson, getText, mapLimit } from "./http.mjs";
import { nameIndex, parseCorridorCsv, parseMdimChoices, parseOwidCsv, parseOwidMetadata, parseWbCountries, parseWbLatest } from "./parse.mjs";
import { fetchUnWpp } from "./unwpp.mjs";

const OWID = "https://ourworldindata.org";
const Q = "v=1&csvType=full&useColumnShortNames=true";
export const owidCsvUrl = (path, params = "") => `${OWID}/${path}.csv?${Q}${params ? `&${params}` : ""}`;
export const owidMetaUrl = (path, params = "") => `${OWID}/${path}.metadata.json?${Q}${params ? `&${params}` : ""}`;

/**
 * UN World Population Prospects 2024 comes straight from the UN's CSV files (scripts/lib/unwpp.mjs): estimates
 * 1950-2023, medium projection 2024-2100, the Constant-fertility scenario, and the 2026-01-19 interim update (Togo).
 * Until October 2026 it came from Our World in Data's copies, which sum the UN's single-age figures (each rounded to a
 * whole person: Tokelau's 14 deaths in 2023 became 2) and whose "65+" group stops at 99. See docs/DATA-VALIDATION.md.
 */
export { WPP_CSV, WPP_UPDATE } from "./unwpp.mjs";

/** UN DESA International Migrant Stock 2024 (1990-2024, every 5 years + 2024), via Our World in Data. */
export const IMS_DATASETS = [
  { id: "immigrants", title: "Immigrant stock: people living here who were born abroad", params: "metric=immigrants&unit=number", spec: { immigrants: "immigrants_all" } },
  { id: "immigrantsShare", title: "Immigrant stock, % of population", params: "metric=immigrants&unit=share", spec: { immigrantsPct: "immigrant_share_of_dest_population_all" } },
  { id: "emigrants", title: "Emigrant stock: people born here living abroad", params: "metric=emigrants&unit=number", spec: { emigrants: "emigrants_all" } },
  { id: "emigrantsShare", title: "Emigrant stock, % of population of origin", params: "metric=emigrants&unit=share", spec: { emigrantsPct: "emigrants_share_of_total_population" } },
].map((d) => ({ ...d, path: "grapher/migrant-populations", required: false }));

export const CORRIDOR_PATH = "grapher/migration-origin-destination";
export const corridorUrl = (slug, metric) => owidCsvUrl(CORRIDOR_PATH, `country_select=${slug}&metric=${metric}&gender=all`);

/** World Bank World Development Indicators (latest non-empty value per country: mrnev=1). */
export const WB_INDICATORS = {
  tfr: "SP.DYN.TFRT.IN",
  population: "SP.POP.TOTL",
  birthRate: "SP.DYN.CBRT.IN",
  deathRate: "SP.DYN.CDRT.IN",
  netMigration: "SM.POP.NETM",
  populationGrowthPct: "SP.POP.GROW",
  share65: "SP.POP.65UP.TO.ZS",
  immigrants: "SM.POP.TOTL",
  immigrantsPct: "SM.POP.TOTL.ZS",
};
export const wbIndicatorUrl = (id) => `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&per_page=20000&mrnev=1`;
export const WB_COUNTRIES_URL = "https://api.worldbank.org/v2/country?format=json&per_page=400";

async function fetchOwidDataset(d) {
  const url = owidCsvUrl(d.path, d.params);
  const metadataUrl = owidMetaUrl(d.path, d.params);
  const entry = { id: d.id, title: d.title, url, metadataUrl, required: d.required, status: "ok", vintage: null, columns: null, error: null };
  try {
    const [text, meta] = await Promise.all([getText(url), getJson(metadataUrl).catch(() => null)]);
    const parsed = parseOwidCsv(text, d.spec);
    if (parsed.missing.length) throw new Error(`columns not found: ${parsed.missing.map((k) => d.spec[k]).join(", ")}`);
    if (parsed.entities.size < 150) throw new Error(`only ${parsed.entities.size} entities parsed`);
    entry.columns = Object.values(parsed.found);
    entry.vintage = meta ? parseOwidMetadata(meta) : null;
    return { entry, data: parsed };
  } catch (err) {
    return { entry: { ...entry, status: "unavailable", error: String(err.message ?? err) }, data: null };
  }
}

/** Fetch every bulk source. Never throws for a single dataset; callers decide based on entry.status/required. */
export async function fetchSources(log = () => {}) {
  const owidJobs = IMS_DATASETS.map((d) => ["ims", d]);
  const wbJobs = Object.entries(WB_INDICATORS);

  const [un, owidResults, wbResults, wbCountries] = await Promise.all([
    fetchUnWpp({ log }),
    mapLimit(owidJobs, 4, async ([group, d]) => ({ group, ...(await fetchOwidDataset(d)) })),
    mapLimit(wbJobs, 4, async ([key, id]) => {
      const url = wbIndicatorUrl(id);
      try {
        const parsed = parseWbLatest(await getJson(url));
        if (parsed.values.size < 150) throw new Error(`only ${parsed.values.size} values`);
        return { key, entry: { id, key, title: parsed.indicatorName, url, status: "ok", lastUpdated: parsed.lastUpdated, error: null }, data: parsed.values };
      } catch (err) {
        return { key, entry: { id, key, title: null, url, status: "unavailable", lastUpdated: null, error: String(err.message ?? err) }, data: null };
      }
    }),
    getJson(WB_COUNTRIES_URL).then(
      (j) => ({ ok: true, data: parseWbCountries(j) }),
      (err) => ({ ok: false, error: String(err.message ?? err) }),
    ),
  ]);

  const ims = {};
  const manifest = { wpp: un.entries, ims: [], wb: [] };
  for (const r of owidResults) {
    const { entry, data } = r.value;
    ims[entry.id] = data;
    manifest.ims.push(entry);
    log(`${entry.status === "ok" ? "ok  " : "FAIL"} ims/${entry.id}${entry.error ? ` (${entry.error})` : ""}`);
  }
  const latest = {};
  for (const r of wbResults) {
    const { key, entry, data } = r.value;
    latest[key] = data;
    manifest.wb.push(entry);
    log(`${entry.status === "ok" ? "ok  " : "FAIL"} wb/${entry.id}${entry.error ? ` (${entry.error})` : ""}`);
  }
  manifest.wb.unshift({
    id: "countries",
    key: "countries",
    title: "Country metadata (region, income group)",
    url: WB_COUNTRIES_URL,
    status: wbCountries.ok ? "ok" : "unavailable",
    lastUpdated: null,
    error: wbCountries.ok ? null : wbCountries.error,
  });
  log(`${wbCountries.ok ? "ok  " : "FAIL"} wb/countries${wbCountries.ok ? "" : ` (${wbCountries.error})`}`);
  return { wpp: un.wpp ?? {}, scenarios: un.scenarios, ims, wb: { countries: wbCountries.ok ? wbCountries.data : new Map(), latest }, manifest };
}

/**
 * Reject a structurally empty corridor parse for one direction: no data year or no World total. A direction may
 * legitimately have a total but no partner breakdown (UN DESA has only totals for immigrants into e.g. BES, VAT).
 */
export function checkCorridor(parsed, code, metric) {
  if (parsed.year == null || parsed.total == null) throw new Error(`empty ${metric} corridor CSV for ${code}`);
  return parsed;
}

/** A country's corridor is rejected when neither direction has any partner country. */
export function checkCorridorPair(origins, destinations, code) {
  if (!origins.partners.length && !destinations.partners.length) throw new Error(`no partner countries in either corridor CSV for ${code}`);
}

/**
 * Migration corridors (top origins of immigrants, top destinations of emigrants) from UN DESA via OWID.
 * One CSV per country and direction (~460 small requests). While the source vintage is unchanged, corridors from the
 * last published output are reused and only missing countries are fetched; if the source is unreachable, the last
 * published corridors are kept (never regress to nulls).
 * previous: { entry (as published in index.json), data: Map<iso3, corridor> } or null.
 */
export async function fetchCorridors({ codes, entities, previous, log = () => {} }) {
  const metadataUrl = owidMetaUrl(CORRIDOR_PATH);
  const pageUrl = `${OWID}/${CORRIDOR_PATH}`;
  const base = {
    id: "migrationCorridors",
    title: "Migrant stock by country of origin and destination (top partners)",
    url: corridorUrl("{country_slug}", "{immigrants|emigrants}"),
    metadataUrl,
    required: false,
    status: "ok",
    vintage: null,
    columns: ["migrants__country_select_{country}__metric_{immigrants|emigrants}__gender_all"],
    error: null,
  };
  const wanted = new Set(codes.filter((c) => c !== "WLD"));
  const prevOk = previous?.entry?.status === "ok" && previous.data?.size > 0;
  const fromPrevious = () => ({
    entry: { ...base, vintage: { lastUpdated: previous.entry.lastUpdated ?? null, timespan: previous.entry.timespan ?? null } },
    data: new Map([...previous.data].filter(([c]) => wanted.has(c))),
  });
  try {
    const vintage = parseOwidMetadata(await getJson(metadataUrl));
    const same = prevOk && vintage.lastUpdated && vintage.lastUpdated === previous.entry.lastUpdated;
    const choices = parseMdimChoices(await getText(pageUrl), "country_select");
    if (!choices?.length) throw new Error("could not read the country list from the chart page");
    const byName = nameIndex(entities);
    const jobs = [];
    for (const ch of choices) {
      const code = byName.get(ch.name);
      if (code && wanted.has(code)) jobs.push({ code, slug: ch.slug });
    }
    if (jobs.length < wanted.size * 0.8) throw new Error(`only ${jobs.length} chart countries matched our ${wanted.size}`);
    const data = same ? fromPrevious().data : new Map();
    const todo = jobs.filter((j) => !data.has(j.code));
    if (todo.length) log(`...  ims/migrationCorridors fetching ${todo.length * 2} CSVs${same ? ` (reusing ${data.size}; vintage ${vintage.lastUpdated} unchanged)` : ""}`);
    const results = await mapLimit(todo, 6, async ({ code, slug }) => {
      const [imm, emi] = await Promise.all([getText(corridorUrl(slug, "immigrants")), getText(corridorUrl(slug, "emigrants"))]);
      const origins = checkCorridor(parseCorridorCsv(imm, code), code, "immigrants");
      const destinations = checkCorridor(parseCorridorCsv(emi, code), code, "emigrants");
      checkCorridorPair(origins, destinations, code);
      return {
        code,
        corridor: {
          year: Math.max(origins.year ?? 0, destinations.year ?? 0) || null,
          source: "UN-DESA",
          immigrantsTotal: origins.total == null ? null : Math.round(origins.total),
          emigrantsTotal: destinations.total == null ? null : Math.round(destinations.total),
          topOrigins: origins.partners,
          topDestinations: destinations.partners,
        },
      };
    });
    const failures = results.map((r, i) => (r.ok ? null : `${todo[i].code}: ${r.error?.message ?? r.error}`)).filter(Boolean);
    // A direction whose partner breakdown was published before must not come back empty (an HTTP-200 CSV with only
    // the World total). Places that never had a breakdown (BES, VAT origins) stay valid.
    if (prevOk) {
      for (const r of results) {
        if (!r.ok) continue;
        const old = previous.data.get(r.value.code);
        for (const dir of ["topOrigins", "topDestinations"]) {
          if (old?.[dir]?.length && !r.value.corridor[dir].length) {
            failures.push(`${r.value.code}: ${dir} breakdown vanished (previously ${old[dir].length} partners)`);
          }
        }
      }
    }
    // With published corridors to protect, a refresh is all-or-nothing: any failure keeps the last published set
    // (one consistent vintage) instead of silently dropping countries. Only a first build tolerates a few gaps.
    if (failures.length && prevOk) throw new Error(`${failures.length} of ${todo.length} countries failed (${failures.slice(0, 3).join("; ")})`);
    if (failures.length > jobs.length * 0.1) throw new Error(`${failures.length} of ${todo.length} countries failed (${failures.slice(0, 3).join("; ")})`);
    for (const r of results) if (r.ok) data.set(r.value.code, r.value.corridor);
    const failed = failures.length;
    log(`ok   ims/migrationCorridors (${data.size} countries${failed ? `, ${failed} failed` : ""}${same && !todo.length ? ", all reused" : ""})`);
    return { entry: { ...base, vintage }, data: new Map([...data].sort(([a], [b]) => a.localeCompare(b))) };
  } catch (err) {
    if (prevOk) {
      log(`WARN ims/migrationCorridors unavailable (${err.message}); keeping the last published corridors`);
      return fromPrevious();
    }
    log(`FAIL ims/migrationCorridors (${err.message})`);
    return { entry: { ...base, status: "unavailable", error: String(err.message ?? err) }, data: null };
  }
}
