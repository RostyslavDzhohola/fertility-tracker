// Upstream sources: exact URLs, what we take from each, and fetchers that return parsed data + a status manifest.
import { getJson, getText, mapLimit } from "./http.mjs";
import { nameIndex, parseCorridorCsv, parseMdimChoices, parseOwidCsv, parseOwidMetadata, parseWbCountries, parseWbLatest } from "./parse.mjs";

const OWID = "https://ourworldindata.org";
const Q = "v=1&csvType=full&useColumnShortNames=true";
export const owidCsvUrl = (path, params = "") => `${OWID}/${path}.csv?${Q}${params ? `&${params}` : ""}`;
export const owidMetaUrl = (path, params = "") => `${OWID}/${path}.metadata.json?${Q}${params ? `&${params}` : ""}`;

const v = (metric) => ({
  est: `${metric}__sex_all__age_all__variant_estimates`,
  proj: `${metric}__sex_all__age_all__variant_medium`,
});

/** UN World Population Prospects 2024 (estimates 1950-2023 + medium projection 2024-2100), via Our World in Data. */
export const WPP_DATASETS = [
  {
    id: "fertility",
    title: "Fertility rate (births per woman)",
    path: "grapher/fertility-rate-with-projections",
    spec: { tfrEst: v("fertility_rate").est, tfrProj: v("fertility_rate").proj },
    required: true,
  },
  {
    id: "population",
    title: "Population (1 July)",
    path: "grapher/population-with-un-projections",
    spec: { popEst: v("population").est, popProj: v("population").proj },
    required: true,
  },
  {
    id: "birthsDeaths",
    title: "Births and deaths per year",
    path: "grapher/births-and-deaths-projected-to-2100",
    spec: { birthsEst: v("births").est, birthsProj: v("births").proj, deathsEst: v("deaths").est, deathsProj: v("deaths").proj },
    required: true,
  },
  {
    id: "netMigration",
    title: "Net migration (immigrants minus emigrants per year)",
    path: "explorers/population-and-demography",
    params: "indicator=Net+migration&Sex=Both+sexes&Age=Total&Projection+scenario=Medium",
    spec: { netMigEst: v("net_migration").est, netMigProj: v("net_migration").proj },
    required: false,
  },
  {
    id: "medianAge",
    title: "Median age",
    path: "grapher/median-age",
    spec: { medianAgeEst: v("median_age").est, medianAgeProj: v("median_age").proj },
    required: false,
  },
  {
    id: "ageStructure",
    title: "Population aged 65+ (for share65)",
    path: "grapher/population-by-age-group-with-projections",
    spec: {
      pop65Est: "population__sex_all__age_65plus__variant_estimates",
      pop65Proj: "population__sex_all__age_65plus__variant_medium",
      popAllEst: v("population").est,
      popAllProj: v("population").proj,
    },
    required: false,
  },
];

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
  const owidJobs = [...WPP_DATASETS.map((d) => ["wpp", d]), ...IMS_DATASETS.map((d) => ["ims", d])];
  const wbJobs = Object.entries(WB_INDICATORS);

  const [owidResults, wbResults, wbCountries] = await Promise.all([
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

  const wpp = {};
  const ims = {};
  const manifest = { wpp: [], ims: [], wb: [] };
  for (const r of owidResults) {
    const { group, entry, data } = r.value;
    (group === "wpp" ? wpp : ims)[entry.id] = data;
    manifest[group].push(entry);
    log(`${entry.status === "ok" ? "ok  " : "FAIL"} ${group}/${entry.id}${entry.error ? ` (${entry.error})` : ""}`);
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
  return { wpp, ims, wb: { countries: wbCountries.ok ? wbCountries.data : new Map(), latest }, manifest };
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
      const origins = parseCorridorCsv(imm, code);
      const destinations = parseCorridorCsv(emi, code);
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
    let failed = 0;
    for (const r of results) {
      if (r.ok) data.set(r.value.code, r.value.corridor);
      else failed++;
    }
    if (failed > jobs.length * 0.1) throw new Error(`${failed} of ${todo.length} countries failed`);
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
