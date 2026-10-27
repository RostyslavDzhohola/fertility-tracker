// Render the published files and write them idempotently: unchanged numbers => byte-identical files, and
// generatedAt / contentHash only move when some published number or text actually changes.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { toCsv } from "./csv.mjs";
import { REPLACEMENT_TFR } from "./model.mjs";
import { RISK_MODEL } from "./risk.mjs";
import { API_BASE, SCHEMA_VERSION, SITE_URL, openapi, schemas } from "./schema.mjs";

export const API_DIR = "api/v1";
const GEN = "__GENERATED_AT__";
const HASH = "__CONTENT_HASH__";
const REPO = "https://github.com/RostyslavDzhohola/fertility-tracker";

export const SOURCE_NAMES = {
  WB: "World Bank, World Development Indicators",
  "UN-WPP": "United Nations, World Population Prospects 2024 (via Our World in Data)",
  "UN-DESA": "United Nations DESA, International Migrant Stock 2024 (via Our World in Data)",
};

const SERIES_METRICS = ["population", "births", "deaths", "naturalChange", "netMigration", "populationChange", "tfr", "medianAge", "share65"];
const STOCK_METRICS = ["immigrants", "immigrantsPct", "emigrants", "emigrantsPct", "livingAbroadPct"];

const pretty = (o) => JSON.stringify(o, null, 2) + "\n";
const compact = (o) => JSON.stringify(o) + "\n";

function sourcesManifest(manifest) {
  const wppVintage = manifest.wpp.find((d) => d.id === "population")?.vintage;
  const imsVintage = manifest.ims.find((d) => d.vintage)?.vintage;
  const wbDates = manifest.wb.map((d) => d.lastUpdated).filter(Boolean).sort();
  const owidDataset = (d) => ({
    id: d.id,
    title: d.title,
    url: d.url,
    metadataUrl: d.metadataUrl,
    status: d.status,
    columns: d.columns,
    lastUpdated: d.vintage?.lastUpdated ?? null,
    timespan: d.vintage?.timespan ?? null,
  });
  return [
    {
      id: "UN-WPP",
      name: "World Population Prospects 2024",
      publisher: "United Nations, Department of Economic and Social Affairs, Population Division",
      via: "Our World in Data (grapher and explorer CSV downloads)",
      homepage: "https://population.un.org/wpp/",
      license: "CC BY 3.0 IGO (UN); OWID processing CC BY 4.0",
      citation: wppVintage?.citation ?? "UN, World Population Prospects (2024) – processed by Our World in Data",
      vintage: wppVintage?.lastUpdated ?? null,
      nextUpdate: wppVintage?.nextUpdate ?? null,
      coverage: "Estimates 1950 to the latest estimate year; medium-variant projections to 2100",
      datasets: manifest.wpp.map(owidDataset),
    },
    {
      id: "UN-DESA",
      name: "International Migrant Stock 2024",
      publisher: "United Nations, Department of Economic and Social Affairs, Population Division",
      via: "Our World in Data (grapher CSV downloads)",
      homepage: "https://www.un.org/development/desa/pd/content/international-migrant-stock",
      license: "CC BY 3.0 IGO (UN); OWID processing CC BY 4.0",
      citation: imsVintage?.citation ?? "United Nations Department of Economic and Social Affairs (2024)",
      vintage: imsVintage?.lastUpdated ?? null,
      nextUpdate: imsVintage?.nextUpdate ?? null,
      coverage: "Migrant stocks by country of residence and of birth, 1990-2020 every 5 years plus 2024",
      datasets: manifest.ims.map(owidDataset),
    },
    {
      id: "WB",
      name: "World Development Indicators",
      publisher: "World Bank",
      via: "World Bank Indicators API v2 (latest non-empty value per country, mrnev=1)",
      homepage: "https://data.worldbank.org/",
      license: "CC BY 4.0",
      citation: "World Bank, World Development Indicators",
      vintage: wbDates.at(-1) ?? null,
      nextUpdate: null,
      coverage: "Latest reported year per country and indicator",
      datasets: manifest.wb.map((d) => ({ id: d.id, title: d.title, url: d.url, status: d.status, lastUpdated: d.lastUpdated ?? null })),
    },
  ];
}

function dataGaps(ds, manifest) {
  const gaps = [
    "Gross annual migration flows (how many people arrive and how many leave each year) are not published for all countries by any global source. " +
      "We publish annual net migration (UN WPP: immigrants minus emigrants) plus migrant stocks from UN DESA as inflow/outflow proxies: " +
      "immigrants = people living in a country who were born elsewhere; emigrants = people born in a country who now live abroad.",
    `UN WPP 2024 estimates end in ${ds.latestEstimateYear}; later years are the UN medium-variant projection (variant = "projection"). ` +
      "The demographic balance (components) and projection baselines use the latest estimate year.",
    "Headline fields (population, tfr, birthRate, deathRate, netMigration, populationGrowthPct, share65) take the newest year across World Bank and UN; " +
      "each carries its own year and source. World Bank's latest net migration (and, for many countries, population) are themselves UN WPP estimates or projections.",
    "populationChange = births - deaths + netMigration for the calendar year (UN WPP). It can differ slightly from the difference between successive 1 July population figures.",
    "Migrant stocks are available for 1990-2020 every 5 years plus 2024; there is no annual series. migrantStock.emigrantsPct follows UN DESA / OWID: " +
      "emigrants as % of the country's CURRENT RESIDENT population. livingAbroadPct is the share of everyone born in the country who lives abroad: " +
      "emigrants / (residents - immigrants + emigrants).",
    "projection.change2050Pct / change2100Pct are relative to projection.basePopulation in projection.baseYear (UN WPP, latest estimate year), " +
      "not to the headline population (often a newer World Bank figure).",
    "Taiwan and 20 small territories are not in the World Bank database: their figures come from UN sources only, their region is borrowed from a neighbour, and incomeGroup is null.",
    `Places with fewer than ${RISK_MODEL.minPopulation.toLocaleString("en-US")} people are scored where possible but not ranked: small numbers make rates noisy.`,
  ];
  for (const d of [...manifest.wpp, ...manifest.ims, ...manifest.wb]) {
    if (d.status !== "ok") gaps.push(`Source dataset ${d.id} was unavailable in this build (${d.error ?? "unknown error"}); the fields it feeds are null.`);
  }
  return gaps;
}

function riskPayload(ds) {
  const full = new Map(ds.full.map((r) => [r.iso3, r]));
  return {
    apiVersion: "v1",
    generatedAt: GEN,
    methodology: {
      ...RISK_MODEL,
      formula:
        "score = round(sum over components of weight x value), where each value is a linear ramp from 0 (at zeroAt) to 1 (at fullAt), clamped to 0..1. " +
        "Weights sum to 100. Tier thresholds apply to the rounded score.",
      eligibility: `Ranked: countries and territories with population >= ${RISK_MODEL.minPopulation} and every input available. WLD is never ranked.`,
      docs: `${REPO}/blob/main/docs/METHODOLOGY.md`,
    },
    ranking: ds.ranking.map((r) => {
      const d = ds.details.get(r.iso3);
      return {
        rank: r.risk.rank,
        iso3: r.iso3,
        name: r.name,
        region: r.region,
        score: r.risk.score,
        tier: r.risk.tier,
        components: d.risk.components,
        inputs: d.risk.inputs,
        factors: d.risk.factors,
      };
    }),
    unranked: ds.unranked.map((r) => {
      const f = full.get(r.iso3).flags;
      const reason = f.includes("aggregate")
        ? "World aggregate"
        : f.includes("small-population")
          ? `Population under ${RISK_MODEL.minPopulation.toLocaleString("en-US")}`
          : "Incomplete inputs";
      return { iso3: r.iso3, name: r.name, region: r.region, score: r.risk.score, tier: r.risk.tier, reason };
    }),
  };
}

function flatRow(rec) {
  const p = (pt) => [pt?.value ?? null, pt?.year ?? null, pt?.source ?? null];
  const c = rec.components ?? {};
  const pt = c.perThousand ?? {};
  const m = rec.migrantStock ?? {};
  const pr = rec.projection ?? {};
  const g = rec.generations ?? {};
  return [
    rec.iso3, rec.iso2, rec.isoNumeric, rec.name, rec.region, rec.incomeGroup, rec.ranked,
    rec.risk.rank, rec.risk.score, rec.risk.tier,
    ...p(rec.population), ...p(rec.tfr), ...p(rec.birthRate), ...p(rec.deathRate), ...p(rec.naturalChangeRate),
    ...p(rec.netMigration), ...p(rec.populationGrowthPct), ...p(rec.medianAge), ...p(rec.share65),
    c.year, c.births, c.deaths, c.naturalChange, c.netMigration, c.populationChange,
    pt.births, pt.deaths, pt.naturalChange, pt.netMigration, pt.populationChange, c.migrationOffsetPct,
    m.year, m.immigrants, m.immigrantsPct, m.emigrants, m.emigrantsPct, m.livingAbroadPct,
    pr.baseYear, pr.basePopulation, pr.population2050, pr.population2100, pr.change2050Pct, pr.change2100Pct,
    pr.peakYear, pr.halfPopulationYear, pr.naturalDeclineSince, pr.tfr2050, pr.tfr2100,
    g.ratio, g.halvingYears, rec.flags.join(" "), rec.risk.factors.join(" | "),
  ].map((v) => (v === undefined ? null : v));
}
const COUNTRY_CSV_HEADER = [
  "iso3", "iso2", "isoNumeric", "name", "region", "incomeGroup", "ranked",
  "risk_rank", "risk_score", "risk_tier",
  ...["population", "tfr", "birthRate", "deathRate", "naturalChangeRate", "netMigration", "populationGrowthPct", "medianAge", "share65"].flatMap((k) => [k, `${k}_year`, `${k}_source`]),
  "components_year", "components_births", "components_deaths", "components_naturalChange", "components_netMigration", "components_populationChange",
  "components_perThousand_births", "components_perThousand_deaths", "components_perThousand_naturalChange", "components_perThousand_netMigration",
  "components_perThousand_populationChange", "components_migrationOffsetPct",
  "migrantStock_year", "migrantStock_immigrants", "migrantStock_immigrantsPct", "migrantStock_emigrants", "migrantStock_emigrantsPct",
  "migrantStock_livingAbroadPct",
  "projection_baseYear", "projection_basePopulation", "projection_population2050", "projection_population2100",
  "projection_change2050Pct", "projection_change2100Pct", "projection_peakYear", "projection_halfPopulationYear",
  "projection_naturalDeclineSince", "projection_tfr2050", "projection_tfr2100",
  "generations_ratio", "generations_halvingYears", "flags", "risk_factors",
];

function timeseriesCsv(ds) {
  const rows = [];
  for (const [iso3, d] of ds.details) {
    const byYear = new Map();
    for (const r of d.series) byYear.set(r.year, SERIES_METRICS.map((m) => [r.variant, m, r[m]]));
    for (const s of d.migrantStockSeries) {
      const list = byYear.get(s.year) ?? [];
      for (const m of STOCK_METRICS) list.push(["estimate", m, s[m]]);
      byYear.set(s.year, list);
    }
    for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
      for (const [variant, metric, value] of byYear.get(year)) if (value != null) rows.push([iso3, year, variant, metric, value]);
    }
  }
  return toCsv(["iso3", "year", "variant", "metric", "value"], rows);
}

/** All published files: Map<path relative to public/, content>. Placeholders are filled by finalize(). */
export function renderFiles(ds, manifest) {
  const files = new Map();
  const put = (path, content) => files.set(`${API_DIR}/${path}`, content);
  const sourceIds = Object.fromEntries(Object.entries(SOURCE_NAMES));

  put(
    "countries.json",
    compact({
      apiVersion: "v1",
      generatedAt: GEN,
      latestEstimateYear: ds.latestEstimateYear,
      replacementTfr: REPLACEMENT_TFR,
      count: ds.records.length,
      sources: sourceIds,
      countries: ds.records,
    }),
  );
  for (const [iso3, d] of ds.details) {
    const { apiVersion, ...rest } = d;
    put(
      `countries/${iso3}.json`,
      compact({
        apiVersion: "v1",
        ...rest,
        links: {
          self: `${API_BASE}countries/${iso3}.json`,
          countries: `${API_BASE}countries.json`,
          risk: `${API_BASE}risk.json`,
          docs: `${SITE_URL}api/`,
          site: `${SITE_URL}#${iso3}`,
        },
      }),
    );
  }
  put("risk.json", compact(riskPayload(ds)));
  put("countries.csv", toCsv(COUNTRY_CSV_HEADER, ds.full.map(flatRow)));
  put("timeseries.csv", timeseriesCsv(ds));
  put("openapi.json", pretty(openapi()));
  for (const [name, schema] of Object.entries(schemas())) put(`schema/${name}`, pretty(schema));

  const endpoint = (path, format, description, schema) => ({
    path,
    url: `${API_BASE}${path}`,
    format,
    description,
    ...(schema ? { schema: `${API_BASE}schema/${schema}` } : {}),
  });
  put(
    "index.json",
    pretty({
      name: "Fertility Tracker API",
      description:
        "Fertility, births, deaths, net migration, migrant stocks, UN projections to 2100 and a population-decline risk score for every country. " +
        "Static files, no key, CORS open, refreshed weekly.",
      apiVersion: "v1",
      schemaVersion: SCHEMA_VERSION,
      generatedAt: GEN,
      contentHash: HASH,
      baseUrl: API_BASE,
      latestEstimateYear: ds.latestEstimateYear,
      replacementTfr: REPLACEMENT_TFR,
      counts: { records: ds.records.length, ranked: ds.ranking.length, unranked: ds.unranked.length },
      sources: sourcesManifest(manifest),
      endpoints: [
        endpoint("index.json", "json", "This manifest.", "index.schema.json"),
        endpoint("countries.json", "json", "Summary for every country + WLD (sorted by iso3).", "countries.schema.json"),
        endpoint("countries/{iso3}.json", "json", "Full record for one country: series 1950-2100, demographic balance, migrant stocks and corridors, risk detail.", "country.schema.json"),
        endpoint("risk.json", "json", "Countries ranked by population-decline risk + methodology.", "risk.schema.json"),
        endpoint("countries.csv", "csv", "One row per country; nested fields flattened with underscores (components_births, projection_change2100Pct, ...)."),
        endpoint("timeseries.csv", "csv", "Long format iso3,year,variant,metric,value. Metrics: " + [...SERIES_METRICS, ...STOCK_METRICS].join(", ") + ". Rows with no data are omitted."),
        endpoint("openapi.json", "json", "OpenAPI 3.1 description of these endpoints."),
        endpoint("status.json", "json", "When the weekly refresh last ran and whether it succeeded (written at deploy time; generatedAt elsewhere only moves when numbers change).", "status.schema.json"),
      ],
      dataGaps: dataGaps(ds, manifest),
      links: {
        docs: `${SITE_URL}api/`,
        llms: `${SITE_URL}llms.txt`,
        openapi: `${API_BASE}openapi.json`,
        methodology: `${REPO}/blob/main/docs/METHODOLOGY.md`,
        apiReference: `${REPO}/blob/main/docs/API.md`,
        repo: REPO,
        issues: `${REPO}/issues`,
        feedbackEmail: "andromedus+fertility@mail.grokbot.com",
        site: SITE_URL,
      },
      license: {
        code: "MIT",
        data: "CC BY 4.0 (World Bank, Our World in Data); UN data CC BY 3.0 IGO. Cite the original publishers and this API.",
      },
      cors: "Served by GitHub Pages with Access-Control-Allow-Origin: *, so browsers and agents can fetch any file cross-origin.",
    }),
  );
  return files;
}

/** Fill generatedAt/contentHash: keep the previous generatedAt when nothing changed. */
export function finalize(files, { previousIndex, now = new Date() } = {}) {
  const h = createHash("sha256");
  for (const path of [...files.keys()].sort()) h.update(path).update("\0").update(files.get(path)).update("\0");
  const contentHash = h.digest("hex");
  const unchanged = previousIndex?.contentHash === contentHash && previousIndex?.generatedAt;
  const generatedAt = unchanged ? previousIndex.generatedAt : now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const out = new Map();
  for (const [path, content] of files) out.set(path, content.replaceAll(GEN, generatedAt).replaceAll(HASH, contentHash));
  return { files: out, contentHash, generatedAt, unchanged: Boolean(unchanged) };
}

/** Write files whose bytes differ; delete stale files under the managed directories. Returns counts. */
export async function writeFiles(publicDir, files, { prune = [`${API_DIR}/countries`, `${API_DIR}/schema`] } = {}) {
  let written = 0;
  let same = 0;
  for (const [path, content] of files) {
    const abs = join(publicDir, path);
    const old = await readFile(abs, "utf8").catch(() => null);
    if (old === content) {
      same++;
      continue;
    }
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}`;
    await writeFile(tmp, content);
    await rename(tmp, abs);
    written++;
  }
  let removed = 0;
  for (const dir of prune) {
    const names = await readdir(join(publicDir, dir)).catch(() => []);
    for (const name of names) {
      if (!files.has(`${dir}/${name}`)) {
        await rm(join(publicDir, dir, name), { force: true });
        removed++;
      }
    }
  }
  return { written, same, removed };
}
