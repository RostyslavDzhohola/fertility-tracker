// Render the published files and write them idempotently: unchanged numbers => byte-identical files, and
// generatedAt / contentHash only move when some published number or text actually changes.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { toCsv } from "./csv.mjs";
import { REPLACEMENT_TFR } from "./model.mjs";
import { DOWNGRADE_PCT, LEVEL_RULES, MATCH_PCT } from "./confidence.mjs";
import { RISK_MODEL } from "./risk.mjs";
import { API_BASE, SCHEMA_VERSION, SITE_URL, openapi, schemas } from "./schema.mjs";
import { WPP_CITATION, WPP_CSV, WPP_HOME, WPP_METHODOLOGY, WPP_NEXT_RELEASE, WPP_RELEASED, WPP_SCENARIOS_DOC, WPP_UPDATE } from "./unwpp.mjs";

export const API_DIR = "api/v1";
const GEN = "__GENERATED_AT__";
const HASH = "__CONTENT_HASH__";
const REPO = "https://github.com/RostyslavDzhohola/fertility-tracker";

export const SOURCE_NAMES = {
  WB: "World Bank, World Development Indicators",
  "UN-WPP": "United Nations, World Population Prospects 2024 (UN CSV files, with the January 2026 interim update for Togo)",
  "UN-DESA": "United Nations DESA, International Migrant Stock 2024 (via Our World in Data)",
};

const SERIES_METRICS = ["population", "births", "deaths", "naturalChange", "netMigration", "populationChange", "tfr", "medianAge", "share65"];
const STOCK_METRICS = ["immigrants", "immigrantsPct", "emigrants", "emigrantsPct", "livingAbroadPct"];

const pretty = (o) => JSON.stringify(o, null, 2) + "\n";
const compact = (o) => JSON.stringify(o) + "\n";

function sourcesManifest(manifest) {
  const imsVintage = manifest.ims.find((d) => d.vintage)?.vintage;
  const wbDates = manifest.wb.map((d) => d.lastUpdated).filter(Boolean).sort();
  const wppDates = manifest.wpp.map((d) => d.vintage?.lastUpdated).filter(Boolean).sort();
  const update = manifest.wpp.find((d) => d.id === "interimUpdate");
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
  const unDataset = (d) => ({
    id: d.id,
    title: d.title,
    url: d.url,
    status: d.status,
    columns: d.columns,
    lastUpdated: d.vintage?.lastUpdated ?? null,
    timespan: d.vintage?.timespan ?? null,
    ...(d.releaseNote ? { released: d.released, releaseNote: d.releaseNote, places: d.updated ?? [] } : {}),
  });
  return [
    {
      id: "UN-WPP",
      name: "World Population Prospects 2024",
      publisher: "United Nations, Department of Economic and Social Affairs, Population Division",
      via: "UN Population Division CSV files (population.un.org/wpp/downloads), read directly",
      homepage: WPP_HOME,
      license: "CC BY 3.0 IGO",
      citation: WPP_CITATION,
      edition: "World Population Prospects 2024",
      released: WPP_RELEASED,
      interimUpdate: update ? { released: update.released, places: update.updated ?? [], releaseNote: update.releaseNote, url: update.url } : null,
      vintage: wppDates.at(-1) ?? null,
      nextUpdate: WPP_NEXT_RELEASE,
      coverage: "Estimates 1950-2023; medium-variant projections and the constant-fertility scenario 2024-2100",
      datasets: manifest.wpp.map(unDataset),
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
    ...(manifest.quality?.length
      ? [
          {
            id: "QUALITY",
            name: "How sure is each number",
            publisher: "United Nations (Population Division, Statistics Division), Eurostat, national statistics offices",
            via:
              "The UN's own per-country documentation (PDFs extracted once into scripts/data/, with each file's SHA-256), the UN DESA migrant-stock " +
              "workbook, the Eurostat API, and hand-checked notes (docs/CROSS-CHECK-PROCESS.md)",
            homepage: `${REPO}/blob/main/docs/METHODOLOGY.md#how-sure-is-each-number`,
            license: "UN: CC BY 3.0 IGO; Eurostat: CC BY 4.0",
            citation:
              "United Nations, DESA, Population Division (2024). World Population Prospects 2024: Data Sources; United Nations Statistics Division, " +
              "Population and Vital Statistics Report; Eurostat",
            vintage: manifest.quality.map((d) => d.lastUpdated).filter(Boolean).sort().at(-1) ?? null,
            nextUpdate: null,
            coverage: "confidence, forecastRange and crossChecks in countries/{ISO3}.json; confidence (overall level) in countries.json",
            datasets: manifest.quality.map((d) => ({
              id: d.id,
              title: d.title,
              url: d.url,
              status: d.status,
              lastUpdated: d.lastUpdated ?? null,
              ...(d.file ? { file: d.file } : {}),
              ...(d.sha256 ? { sha256: d.sha256 } : {}),
              ...(d.tables ? { tables: d.tables } : {}),
              ...(d.page ? { page: d.page } : {}),
              ...(d.current !== undefined ? { current: d.current } : {}),
            })),
          },
        ]
      : []),
  ];
}

function dataGaps(ds, manifest) {
  const gaps = [
    "Gross annual migration flows (how many people arrive and how many leave each year) are not published for all countries by any global source. " +
      "We publish annual net migration (UN WPP: immigrants minus emigrants) plus migrant stocks from UN DESA as inflow/outflow proxies: " +
      "immigrants = people living in a country who were born elsewhere; emigrants = people born in a country who now live abroad.",
    `UN WPP 2024 estimates end in ${ds.latestEstimateYear}; later years are the UN medium-variant projection (variant = "projection"). ` +
      "The demographic balance (components) and projection baselines use the latest estimate year. The next WPP revision is due 11 July 2027.",
    "Togo follows the UN's interim update of 19 January 2026 (revised population and vital events, estimates and medium projection). The UN did not revise " +
      "Togo's other scenarios or the world and regional aggregates; scenarios.json rescales Togo's constant-fertility path to the revised level (see its adjustments).",
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
  gaps.push(
    "confidence (countries/{ISO3}.json) says how sure each place's numbers are: when it was last counted, whether births and deaths are registered, " +
      "how its migrants were counted, and how wide the UN's own forecast range is. Levels follow confidenceRules in index.json. crossChecks compare UN " +
      `figures with newer national ones: within ${MATCH_PCT}% they "match". Automatic checks cover Eurostat countries and what national offices report ` +
      "to the UN Statistics Division; hand-checked notes cover the places listed in scripts/data/crosschecks.json.",
  );
  for (const d of manifest.quality ?? []) {
    if (d.current === false) gaps.push(`A new edition of ${d.title} is online; ${d.file} still holds the previous one until it is extracted again (scripts/extract/README.md).`);
  }
  for (const d of [...manifest.wpp, ...manifest.ims, ...manifest.wb, ...(manifest.quality ?? [])]) {
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

export const SCENARIO_META = {
  medium: {
    label: "UN forecast",
    unVariant: "Medium",
    description:
      "UN WPP 2024 medium scenario, the UN's central projection: the projection years of countries/{ISO3}.json series (population on 1 July; " +
      "this file uses the UN's PopTotal and the series its TPopulation1July, which agree to within 1 person).",
    unDefinition: "Fertility, mortality and international migration all follow the medium assumption: \"Based on the mean probabilistic projections for fertility and mortality, and median probabilistic projections for net migration.\"",
  },
  constant: {
    label: "If birth rates stay the same",
    unVariant: "Constant fertility",
    description:
      "UN WPP 2024 constant-fertility scenario: from 2024 to 2100 each country's fertility rate stays at its 2023 level (South Korea 0.72 births per woman), " +
      "while mortality and international migration follow the medium scenario. A what-if that shows where today's birth rates lead, not a forecast.",
    unDefinition:
      "\"As the name implies, under the constant-fertility scenario, fertility in all countries will remain constant at the level projected for 2024. " +
      "Meanwhile, mortality and migration assumptions are the same as those in the medium fertility scenario.\" (table II.4: fertility \"Constant as of 2024\", " +
      "mortality \"Medium\", international migration \"Medium\"). In the published data the constant level equals each country's 2023 estimate " +
      "(true for all 237 countries and areas).",
  },
};

function scenariosPayload(sc) {
  const adjustments = sc.adjustments.map((a) => ({
    iso3: a.iso3,
    scenarios: a.scenarios,
    method: "UN constant-fertility population x (revised medium / original medium), year by year",
    ratioRange: a.ratioRange,
    reason:
      "The UN's interim update of 19 January 2026 revised this place's population (Togo: census counts had been adjusted for undercount twice) for the medium " +
      "scenario only. Its fertility and mortality rates are unchanged, and the release note asks users to read the other scenarios \"taking into consideration " +
      "the adjustments made here to the medium projection\", so the other scenarios are rescaled to the revised population level.",
  }));
  return {
    apiVersion: "v1",
    generatedAt: GEN,
    source: {
      id: "UN-WPP",
      name: "World Population Prospects 2024: total population by sex, all scenarios",
      publisher: "United Nations, Department of Economic and Social Affairs, Population Division",
      url: WPP_CSV.populationBySex,
      vintage: sc.vintage?.lastModified ?? null,
      interimUpdate: { url: WPP_UPDATE.url, released: WPP_UPDATE.released, releaseNote: WPP_UPDATE.releaseNote, lastModified: sc.vintage?.updateLastModified ?? null },
      released: WPP_RELEASED,
      nextUpdate: WPP_NEXT_RELEASE,
      homepage: WPP_HOME,
      scenarioDefinitions: WPP_SCENARIOS_DOC,
      methodology: WPP_METHODOLOGY,
      license: "CC BY 3.0 IGO",
      citation: WPP_CITATION,
    },
    unit: "people",
    estimateStartYear: sc.estimateStartYear,
    startYear: sc.startYear,
    endYear: sc.endYear,
    scenarios: SCENARIO_META,
    notes: [
      "places[ISO3].medium and .constant are arrays of people on 1 July; index = year - startYear; null = missing.",
      "places[ISO3].estimate is the past both scenarios share: the UN's estimates of people on 1 July (TPopulation1July, as in " +
        "countries/{ISO3}.json series) for estimateStartYear..startYear - 1; index = year - estimateStartYear; null = missing.",
      "UN PopTotal (thousands, 3 decimals) x 1000, rounded to whole people.",
      "WLD is the UN's world aggregate. The UN did not revise aggregates for the Togo interim update, so WLD still counts Togo's superseded figures " +
        "(1.1 million more people in 2024, 2.7 million in 2100: under 0.03% of the world).",
    ],
    adjustments,
    places: Object.fromEntries(sc.places),
  };
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
          site: `${SITE_URL}country/${iso3}`,
        },
      }),
    );
  }
  put("risk.json", compact(riskPayload(ds)));
  if (ds.scenarios) put("scenarios.json", compact(scenariosPayload(ds.scenarios)));
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
        "Fertility, births, deaths, net migration, migrant stocks, UN projections to 2100 (medium and constant-fertility scenarios) and a " +
        "population-decline risk score for every country. Static files, no key, CORS open, refreshed weekly.",
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
        endpoint(
          "countries/{iso3}.json",
          "json",
          "Full record for one country: series 1950-2100, demographic balance, migrant stocks and corridors, risk detail, how sure each number is (confidence), the UN's forecast range and newer national figures (crossChecks).",
          "country.schema.json",
        ),
        endpoint("risk.json", "json", "Countries ranked by population-decline risk + methodology.", "risk.schema.json"),
        ...(ds.scenarios
          ? [
              endpoint(
                "scenarios.json",
                "json",
                `Population of every country + WLD each year: UN estimates ${ds.scenarios.estimateStartYear}-${ds.scenarios.startYear - 1}, then ${ds.scenarios.startYear}-${ds.scenarios.endYear} under two UN WPP 2024 scenarios: medium ("UN forecast") and constant fertility ("If birth rates stay the same").`,
                "scenarios.schema.json",
              ),
            ]
          : []),
        endpoint("countries.csv", "csv", "One row per country; nested fields flattened with underscores (components_births, projection_change2100Pct, ...)."),
        endpoint("timeseries.csv", "csv", "Long format iso3,year,variant,metric,value. Metrics: " + [...SERIES_METRICS, ...STOCK_METRICS].join(", ") + ". Rows with no data are omitted."),
        endpoint("openapi.json", "json", "OpenAPI 3.1 description of these endpoints."),
        endpoint("status.json", "json", "When the weekly refresh last ran and whether it succeeded (written at deploy time; generatedAt elsewhere only moves when numbers change).", "status.schema.json"),
      ],
      dataGaps: dataGaps(ds, manifest),
      confidenceRules: { levels: ["good", "fair", "poor"], matchPct: MATCH_PCT, downgradePct: DOWNGRADE_PCT, ...LEVEL_RULES },
      links: {
        docs: `${SITE_URL}api/`,
        llms: `${SITE_URL}llms.txt`,
        openapi: `${API_BASE}openapi.json`,
        ...(ds.scenarios ? { scenarios: `${API_BASE}scenarios.json` } : {}),
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
      cors: "Served by Vercel with Access-Control-Allow-Origin: *, so browsers and agents can fetch any file cross-origin.",
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
