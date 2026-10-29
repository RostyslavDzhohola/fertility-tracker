// JSON Schemas (draft 2020-12) for every JSON payload, the OpenAPI 3.1 document, and a tiny validator used by the
// pipeline (refuse to publish output that does not match its schema) and by the tests.
import { RISK_MODEL } from "./risk.mjs";

export const SITE_URL = "https://fertility-tracker-live.vercel.app/";
export const API_BASE = `${SITE_URL}api/v1/`;
export const SCHEMA_VERSION = "1.0.0";

const SOURCE_IDS = ["WB", "UN-WPP", "UN-DESA"];
const FLAGS = ["aggregate", "no-world-bank-data", "small-population", "incomplete-risk-inputs"];
const TIERS = RISK_MODEL.tiers.map((t) => t.name);

const T = (type, description, extra = {}) => ({ type, description, ...extra });
const nul = (t) => [t, "null"];
const int = (d, extra) => T("integer", d, extra);
const intN = (d, extra) => T(nul("integer"), d, extra);
const numN = (d, extra) => T(nul("number"), d, extra);
const obj = (description, properties, extra = {}) => ({
  type: "object",
  description,
  required: Object.keys(properties),
  properties,
  additionalProperties: false,
  ...extra,
});
const objN = (description, properties) => ({ ...obj(description, properties), type: ["object", "null"] });
const arr = (description, items, extra = {}) => ({ type: "array", description, items, ...extra });
const ref = (name) => ({ $ref: `#/$defs/${name}` });

const point = {
  type: ["object", "null"],
  description: "A headline figure with provenance: the newest value across sources. Null when no source has it.",
  required: ["value", "year", "source"],
  properties: {
    value: T("number", "The value."),
    year: int("Year the value refers to."),
    source: T("string", "WB = World Bank WDI, UN-WPP = UN World Population Prospects 2024, UN-DESA = UN International Migrant Stock 2024.", { enum: SOURCE_IDS }),
  },
  additionalProperties: false,
};

const identity = {
  iso3: T("string", "ISO 3166-1 alpha-3 code (WLD = world, XKX = Kosovo).", { pattern: "^[A-Z]{3}$" }),
  isoNumeric: T(nul("string"), "ISO 3166-1 numeric code (3 digits), the id used by common world map files. Null for WLD and XKX.", { pattern: "^[0-9]{3}$" }),
  name: T("string", "Short English name."),
  region: T("string", "World Bank region (\"World\" for WLD)."),
  incomeGroup: T(nul("string"), "World Bank income group, null if not classified."),
  ranked: T("boolean", "True if the country is included in the risk ranking (population >= 100,000 and complete inputs)."),
  flags: arr("Data-quality flags.", T("string", "Flag.", { enum: FLAGS })),
};

const perThousand = obj("Rates per 1,000 mid-year population (same year).", {
  births: numN("Births per 1,000 people (crude birth rate)."),
  deaths: numN("Deaths per 1,000 people (crude death rate)."),
  naturalChange: numN("Births minus deaths per 1,000 people."),
  netMigration: numN("Net migration per 1,000 people."),
  populationChange: numN("Population change per 1,000 people."),
});

const componentsCore = {
  year: int("Year of the demographic balance (latest UN estimate year)."),
  births: intN("Live births in the year."),
  deaths: intN("Deaths in the year."),
  naturalChange: intN("births - deaths."),
  netMigration: intN("Immigrants minus emigrants in the year (UN WPP)."),
  populationChange: intN("births - deaths + netMigration."),
  perThousand,
  migrationOffsetPct: intN("When deaths exceed births: net migration as % of the natural decline (100+ = fully offset; negative = net emigration). Null when births >= deaths."),
};

const stockCore = {
  year: int("Reference year of the migrant stock estimate."),
  immigrants: intN("Immigrant stock: people living in the country who were born in another country (inflow proxy)."),
  immigrantsPct: numN("Immigrant stock as % of the population."),
  emigrants: intN("Emigrant stock: people born in the country who now live abroad (outflow proxy)."),
  emigrantsPct: numN("Emigrant stock as % of the country's CURRENT RESIDENT population (UN DESA / OWID definition; can exceed the share of people born here)."),
  livingAbroadPct: numN("Share of all living people born in the country who live abroad: emigrants / (native-born residents + emigrants) x 100."),
};

const projectionCore = {
  baseYear: int("Baseline year for the % changes: the latest UN WPP estimate year (not the headline population year)."),
  basePopulation: int("UN WPP population in baseYear, the denominator of change2050Pct / change2100Pct."),
  population2050: int("UN medium-variant population in 2050."),
  population2100: int("UN medium-variant population in 2100."),
  change2050Pct: T("number", "% change from basePopulation (baseYear) to 2050."),
  change2100Pct: T("number", "% change from basePopulation (baseYear) to 2100."),
  peakYear: int("Year of the highest population, 1950-2100 (estimates + projection)."),
  halfPopulationYear: intN("First projected year with half (or less) of the latest-estimate population; null if not before 2100."),
  naturalDeclineSince: intN("Start year of the current run of years with more deaths than births; if births still exceed deaths, the first projected year with more deaths. Null if never by 2100."),
};

const riskCore = {
  score: intN("Population-decline risk score 0-100 (null if inputs are incomplete).", { minimum: 0, maximum: 100 }),
  tier: T(nul("string"), "Risk tier.", { enum: [...TIERS, null] }),
  rank: intN("Rank among ranked countries, 1 = highest risk. Null if not ranked.", { minimum: 1 }),
  factors: arr("Plain-English reasons, most important first.", T("string", "Factor.")),
};

const summary = obj("Country summary.", {
  ...identity,
  population: { ...point, description: "Population (latest of World Bank / UN)." },
  tfr: { ...point, description: "Total fertility rate, births per woman (latest of World Bank / UN)." },
  medianAge: { ...point, description: "Median age in years (UN WPP)." },
  share65: { ...point, description: "% of the population aged 65+ (latest of World Bank / UN)." },
  components: objN("Demographic balance for the latest UN estimate year: population change = births - deaths + net migration.", componentsCore),
  migrantStock: objN("UN DESA migrant stock (latest year).", stockCore),
  projection: objN("UN WPP 2024 medium-variant outlook vs the latest estimate year (baseYear / basePopulation).", projectionCore),
  generations: objN("The '100 people' view: each ~30-year generation is (tfr / 2.1) the size of the previous one.", {
    ratio: T("number", "tfr / 2.1."),
    halvingYears: intN("Years for each generation's size to halve at this ratio (30-year generations); null if ratio >= 1."),
  }),
  risk: obj("Risk summary (top 3 factors; all factors in countries/{ISO3}.json and risk.json).", riskCore),
});

const riskComponent = obj("One risk component.", {
  value: numN("Component value 0..1 (0 = no risk, 1 = maximum).", { minimum: 0, maximum: 1 }),
  points: numN("value * weight: points contributed to the score."),
  weight: int("Maximum points for this component."),
});
const riskComponents = obj(
  "Score breakdown by component.",
  Object.fromEntries(RISK_MODEL.components.map((c) => [c.id, { ...riskComponent, description: c.label }])),
);
const riskInputs = obj("Inputs used for the score.", {
  tfr: numN("Total fertility rate."),
  naturalChangeRate: numN("Births minus deaths per 1,000 people."),
  share65: numN("% aged 65+."),
  medianAge: numN("Median age."),
  change2050Pct: numN("UN projected % change to 2050."),
  change2100Pct: numN("UN projected % change to 2100."),
  naturalChange: intN("Births minus deaths (UN, latest estimate year)."),
  netMigration: intN("Net migration (UN, latest estimate year)."),
  populationChangePerThousand: numN("Population change per 1,000 (UN, latest estimate year)."),
  migrationOffsetPct: intN("Net migration as % of the natural decline."),
});

const partner = obj("A partner country in a migration corridor.", {
  iso3: T("string", "ISO3 code of the partner country.", { pattern: "^[A-Z]{3}$" }),
  name: T("string", "Partner country name."),
  people: int("Number of migrants."),
});

const seriesRow = obj("One year of the UN WPP series.", {
  year: int("Year (1950-2100)."),
  variant: T("string", "estimate (UN estimates, up to the latest estimate year) or projection (UN medium variant).", { enum: ["estimate", "projection"] }),
  population: intN("Population on 1 July."),
  births: intN("Live births in the year."),
  deaths: intN("Deaths in the year."),
  naturalChange: intN("births - deaths."),
  netMigration: intN("Immigrants minus emigrants."),
  populationChange: intN("births - deaths + netMigration."),
  tfr: numN("Total fertility rate (births per woman)."),
  medianAge: numN("Median age."),
  share65: numN("% aged 65+."),
});

const detail = obj("Everything about one country.", {
  apiVersion: T("string", "API version.", { const: "v1" }),
  ...identity,
  iso2: T(nul("string"), "ISO 3166-1 alpha-2 code."),
  population: { ...point, description: "Population (latest of World Bank / UN)." },
  tfr: { ...point, description: "Total fertility rate, births per woman." },
  birthRate: { ...point, description: "Births per 1,000 people." },
  deathRate: { ...point, description: "Deaths per 1,000 people." },
  naturalChangeRate: { ...point, description: "Births minus deaths per 1,000 people." },
  netMigration: { ...point, description: "Net migration, people per year. World Bank's recent years are UN WPP estimates/projections." },
  populationGrowthPct: { ...point, description: "Annual population growth, %." },
  medianAge: { ...point, description: "Median age in years (UN WPP)." },
  share65: { ...point, description: "% of the population aged 65+." },
  components: objN("Demographic balance for the latest UN estimate year.", {
    ...componentsCore,
    source: T("string", "Source id.", { const: "UN-WPP" }),
    population: intN("Mid-year (1 July) population used as the denominator."),
  }),
  migrantStock: objN("UN DESA migrant stock (latest year).", {
    ...stockCore,
    netStock: intN("immigrants - emigrants."),
    source: T("string", "Source id.", { enum: SOURCE_IDS }),
  }),
  projection: objN("UN WPP 2024 medium-variant outlook.", {
    source: T("string", "Source id.", { const: "UN-WPP" }),
    variant: T("string", "UN projection variant.", { const: "medium" }),
    ...projectionCore,
    peakPopulation: int("Population in peakYear."),
    tfr2050: numN("Projected fertility rate in 2050."),
    tfr2100: numN("Projected fertility rate in 2100."),
    share65in2050: numN("Projected % aged 65+ in 2050."),
    medianAge2050: numN("Projected median age in 2050."),
  }),
  generations: objN("The '100 people' view.", {
    ratio: T("number", "tfr / 2.1."),
    halvingYears: intN("Years to halve each generation's size; null if ratio >= 1."),
    hundredPeople: arr("Size of 5 successive generations starting from 100 people (today, children, grandchildren, ...).", T("integer", "People."), { minItems: 5, maxItems: 5 }),
  }),
  risk: obj("Full risk detail.", { ...riskCore, components: riskComponents, inputs: riskInputs }),
  series: arr("Yearly UN WPP series 1950-2100: estimates then medium-variant projection.", seriesRow),
  migrantStockSeries: arr(
    "UN DESA migrant stock history (1990, 1995, ..., 2020, 2024).",
    obj("One migrant stock year.", { ...stockCore, netStock: intN("immigrants - emigrants.") }),
  ),
  migrationCorridors: objN("Where immigrants come from and where emigrants live (UN DESA migrant stock by origin and destination).", {
    year: intN("Reference year."),
    source: T("string", "Source id.", { const: "UN-DESA" }),
    immigrantsTotal: intN("Total immigrant stock in this dataset."),
    emigrantsTotal: intN("Total emigrant stock in this dataset."),
    topOrigins: arr("Top 10 countries of birth of people living here who were born abroad.", partner),
    topDestinations: arr("Top 10 countries where people born here now live.", partner),
  }),
  links: obj("Related URLs.", {
    self: T("string", "This file."),
    countries: T("string", "All countries."),
    risk: T("string", "Risk ranking."),
    docs: T("string", "Human documentation."),
    site: T("string", "This country's page on the live tracker: https://fertility-tracker-live.vercel.app/country/{ISO3}."),
  }),
});

const sourceSummary = T("object", "Source ids used in records -> full names (details in index.json).", {
  additionalProperties: T("string", "Source name."),
});

const header = (title, id, description) => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${API_BASE}schema/${id}`,
  title,
  description,
});

const scenarioArray = (label) =>
  arr(`${label}: people on 1 July for each year startYear..endYear (index = year - startYear); null = missing.`, T(nul("integer"), "People.", { minimum: 0 }), { minItems: 1 });
const scenarioMeta = (label, variant) =>
  obj(`The ${label} scenario.`, {
    label: T("string", "Plain-language label for the UI.", { const: label }),
    unVariant: T("string", "UN WPP variant name in the source file.", { const: variant }),
    description: T("string", "What the scenario means."),
    unDefinition: T("string", "The UN's own definition, quoted."),
  });

const scenariosSchema = obj("scenarios.json", {
  apiVersion: T("string", "API version.", { const: "v1" }),
  generatedAt: T("string", "When the numbers last changed (ISO 8601).", { format: "date-time" }),
  source: T("object", "UN WPP 2024 file, interim update, vintage, licence and citation."),
  unit: T("string", "Unit of every number in places.", { const: "people" }),
  estimateStartYear: int("First year in each place's estimate array (index 0)."),
  startYear: int("First year in each scenario array (index 0)."),
  endYear: int("Last year in each array."),
  scenarios: obj("The two scenarios.", {
    medium: scenarioMeta("UN forecast", "Medium"),
    constant: scenarioMeta("If birth rates stay the same", "Constant fertility"),
  }),
  notes: arr("Conventions and caveats.", T("string", "Note.")),
  adjustments: arr(
    "Places whose numbers differ from the UN file, and why (Togo: the UN's 2026 interim update revised only its medium scenario).",
    obj("One adjustment.", {
      iso3: identity.iso3,
      scenarios: arr("Scenarios adjusted.", T("string", "Scenario key.", { enum: ["medium", "constant"] })),
      method: T("string", "How the published numbers were derived."),
      ratioRange: T(nul("array"), "Smallest and largest yearly ratio revised medium / original medium.", { items: T("number", "Ratio.") }),
      reason: T("string", "Why."),
    }),
  ),
  places: T("object", "One entry per country plus WLD (every record in countries.json), keyed by ISO3.", {
    additionalProperties: obj("Population paths for one place.", {
      estimate: arr(
        "The past both scenarios share: UN estimates of people on 1 July for each year estimateStartYear..startYear - 1 (index = year - estimateStartYear); null = missing.",
        T(nul("integer"), "People.", { minimum: 0 }),
        { minItems: 1 },
      ),
      medium: scenarioArray("UN forecast (medium)"),
      constant: scenarioArray("If birth rates stay the same (constant fertility)"),
    }),
  }),
});

export function schemas() {
  return {
    "scenarios.schema.json": {
      ...header(
        "Fertility Tracker: scenarios.json",
        "scenarios.schema.json",
        "Population of every country and the world each year from 1950 (UN estimates) to 2100 under two UN WPP 2024 scenarios: medium and constant fertility.",
      ),
      ...scenariosSchema,
    },
    "countries.schema.json": {
      ...header("Fertility Tracker: countries.json", "countries.schema.json", "Summary record for every country plus the world (WLD)."),
      ...obj("countries.json", {
        apiVersion: T("string", "API version.", { const: "v1" }),
        generatedAt: T("string", "When the numbers last changed (ISO 8601).", { format: "date-time" }),
        latestEstimateYear: int("Latest UN WPP estimate year (components year and projection baseline)."),
        replacementTfr: T("number", "Replacement fertility used throughout.", { const: 2.1 }),
        count: int("Number of records."),
        sources: sourceSummary,
        countries: arr("One record per country, sorted by iso3 (includes WLD).", ref("country")),
      }),
      $defs: { country: summary },
    },
    "country.schema.json": {
      ...header("Fertility Tracker: countries/{ISO3}.json", "country.schema.json", "Full record for one country."),
      ...detail,
    },
    "risk.schema.json": {
      ...header("Fertility Tracker: risk.json", "risk.schema.json", "Countries ranked by population-decline risk, with the methodology."),
      ...obj("risk.json", {
        apiVersion: T("string", "API version.", { const: "v1" }),
        generatedAt: T("string", "When the numbers last changed.", { format: "date-time" }),
        methodology: T("object", "Formula, components (weights, ramps), tiers and exclusions. See docs/METHODOLOGY.md."),
        ranking: arr(
          "Ranked countries, highest risk first.",
          obj("Ranked country.", {
            rank: int("1 = highest risk.", { minimum: 1 }),
            iso3: identity.iso3,
            name: identity.name,
            region: identity.region,
            score: int("Risk score 0-100.", { minimum: 0, maximum: 100 }),
            tier: T("string", "Risk tier.", { enum: TIERS }),
            components: riskComponents,
            inputs: riskInputs,
            factors: riskCore.factors,
          }),
        ),
        unranked: arr(
          "Records not in the ranking (world aggregate, populations under 100,000, incomplete inputs). Scores are shown where computable.",
          obj("Unranked record.", {
            iso3: identity.iso3,
            name: identity.name,
            region: identity.region,
            score: riskCore.score,
            tier: riskCore.tier,
            reason: T("string", "Why it is not ranked."),
          }),
        ),
      }),
    },
    "status.schema.json": {
      ...header("Fertility Tracker: status.json", "status.schema.json", "Deploy-time status: when the weekly loop last ran (written by CI, not in the repository)."),
      ...obj("status.json", {
        apiVersion: T("string", "API version.", { const: "v1" }),
        checkedAt: T("string", "When the pipeline last ran (ISO 8601).", { format: "date-time" }),
        refresh: T("string", "Outcome of the source refresh in that run.", { enum: ["success", "failure", "skipped", "cancelled", "unknown"] }),
        trigger: T("string", "What started the run (schedule, workflow_dispatch, push, local)."),
        run: T(nul("string"), "GitHub Actions run URL."),
        commit: T(nul("string"), "Commit SHA actually deployed (after any data commit made by this run)."),
        triggerCommit: T(nul("string"), "Commit SHA that triggered the run (GITHUB_SHA)."),
        dataChangedAt: T("string", "generatedAt of the published data: when a number last changed.", { format: "date-time" }),
        contentHash: T("string", "contentHash from index.json.", { pattern: "^[0-9a-f]{64}$" }),
        latestEstimateYear: int("Latest UN WPP estimate year."),
        sources: arr(
          "Source vintages and per-dataset status from index.json.",
          obj("Source.", {
            id: T("string", "Source id."),
            vintage: T(nul("string"), "Source vintage (last update date)."),
            datasets: arr("Datasets.", obj("Dataset.", { id: T("string", "Dataset id."), status: T("string", "ok or unavailable."), lastUpdated: T(nul("string"), "Last update.") })),
          }),
        ),
        note: T("string", "Explanation."),
      }),
    },
    "index.schema.json": {
      ...header("Fertility Tracker: index.json", "index.schema.json", "API manifest."),
      type: "object",
      required: ["name", "apiVersion", "schemaVersion", "generatedAt", "contentHash", "baseUrl", "latestEstimateYear", "counts", "sources", "endpoints", "dataGaps", "links"],
      properties: {
        name: T("string", "API name."),
        description: T("string", "What this is."),
        apiVersion: T("string", "API version.", { const: "v1" }),
        schemaVersion: T("string", "Schema version (semver; breaking changes bump the API version instead)."),
        generatedAt: T("string", "When the numbers last changed.", { format: "date-time" }),
        contentHash: T("string", "SHA-256 over all published files; changes exactly when any number changes.", { pattern: "^[0-9a-f]{64}$" }),
        baseUrl: T("string", "Base URL of the API."),
        latestEstimateYear: int("Latest UN WPP estimate year."),
        replacementTfr: T("number", "Replacement fertility.", { const: 2.1 }),
        counts: T("object", "Record counts."),
        sources: arr("Upstream sources with exact URLs and vintages.", T("object", "Source.")),
        endpoints: arr("Published files.", T("object", "Endpoint.", { required: ["path", "url", "format", "description"] })),
        dataGaps: arr("Known gaps and caveats.", T("string", "Gap.")),
        links: T("object", "Docs, methodology, OpenAPI, llms.txt, repo, feedback."),
        license: T("object", "Licences."),
        cors: T("string", "CORS note."),
      },
      additionalProperties: false,
    },
  };
}

export function openapi() {
  const json = (schema, description) => ({ description, content: { "application/json": { schema: { $ref: `schema/${schema}` } } } });
  const csv = (description) => ({ description, content: { "text/csv": { schema: { type: "string" } } } });
  return {
    openapi: "3.1.0",
    info: {
      title: "Fertility Tracker API",
      version: SCHEMA_VERSION,
      summary: "Fertility, births, deaths, migration, UN projections and population-decline risk for every country.",
      description:
        "Static, read-only JSON/CSV files regenerated weekly from the World Bank (WDI), UN World Population Prospects 2024 (with its January 2026 interim update) " +
        "and UN DESA International Migrant Stock 2024. No key, no rate limit beyond Vercel static hosting; CORS is open " +
        "(Access-Control-Allow-Origin: *). Missing values are null. See /llms.txt and /api/ for a guide.",
      license: { name: "MIT (code); data CC BY 4.0 from the original publishers", url: "https://github.com/RostyslavDzhohola/fertility-tracker/blob/main/LICENSE" },
      contact: { name: "Feedback", email: "andromedus+fertility@mail.grokbot.com", url: "https://github.com/RostyslavDzhohola/fertility-tracker/issues" },
    },
    servers: [{ url: API_BASE }],
    paths: {
      "/index.json": { get: { operationId: "getIndex", summary: "Manifest: sources, vintages, endpoints, data gaps", responses: { 200: json("index.schema.json", "Manifest") } } },
      "/countries.json": {
        get: { operationId: "listCountries", summary: "Summary for every country + WLD (map/list data)", responses: { 200: json("countries.schema.json", "All countries") } },
      },
      "/countries/{iso3}.json": {
        get: {
          operationId: "getCountry",
          summary: "Full record for one country: yearly series 1950-2100, demographic balance, migration corridors, risk detail",
          parameters: [{ name: "iso3", in: "path", required: true, description: "ISO 3166-1 alpha-3 code, uppercase (e.g. KOR, WLD).", schema: { type: "string", pattern: "^[A-Z]{3}$" } }],
          responses: { 200: json("country.schema.json", "Country"), 404: { description: "Unknown code" } },
        },
      },
      "/risk.json": { get: { operationId: "getRisk", summary: "Countries ranked by population-decline risk + methodology", responses: { 200: json("risk.schema.json", "Risk ranking") } } },
      "/scenarios.json": {
        get: {
          operationId: "getScenarios",
          summary: "Population of every country + WLD each year to 2100: UN forecast (medium) and 'If birth rates stay the same' (constant fertility)",
          responses: { 200: json("scenarios.schema.json", "Population scenarios") },
        },
      },
      "/status.json": { get: { operationId: "getStatus", summary: "When the weekly refresh last ran (deploy-time file)", responses: { 200: json("status.schema.json", "Status") } } },
      "/countries.csv": { get: { operationId: "getCountriesCsv", summary: "One row per country (flat summary)", responses: { 200: csv("CSV with header row") } } },
      "/timeseries.csv": {
        get: {
          operationId: "getTimeseriesCsv",
          summary: "Long format iso3,year,variant,metric,value for every country, year and metric",
          responses: { 200: csv("CSV with header row") },
        },
      },
    },
  };
}

// ---------------- validator (subset of JSON Schema 2020-12 used above) ----------------

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const typeOk = (v, t) => {
  const actual = typeOf(v);
  return t === actual || (t === "number" && actual === "integer");
};

/** Validate data against a schema; returns a list of error strings (empty = valid). */
export function validate(schema, data, { maxErrors = 50 } = {}) {
  const errors = [];
  const root = schema;
  const walk = (s, v, path) => {
    if (errors.length >= maxErrors) return;
    if (s.$ref) {
      const name = s.$ref.replace("#/$defs/", "");
      return walk(root.$defs[name], v, path);
    }
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeOk(v, t))) return errors.push(`${path}: expected ${types.join("|")}, got ${typeOf(v)}`);
    }
    if (v === null) return;
    if ("const" in s && v !== s.const) errors.push(`${path}: expected ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errors.push(`${path}: ${JSON.stringify(v)} not in enum`);
    if (typeof v === "number") {
      if (!Number.isFinite(v)) errors.push(`${path}: not finite`);
      if (s.minimum != null && v < s.minimum) errors.push(`${path}: ${v} < ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) errors.push(`${path}: ${v} > ${s.maximum}`);
    }
    if (typeof v === "string" && s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${path}: ${JSON.stringify(v)} !~ ${s.pattern}`);
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
      if (s.maxItems != null && v.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
      if (s.items) v.forEach((x, i) => walk(s.items, x, `${path}[${i}]`));
    } else if (typeof v === "object") {
      for (const k of s.required ?? []) if (!(k in v)) errors.push(`${path}: missing ${k}`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties?.[k]) walk(s.properties[k], x, `${path}.${k}`);
        else if (s.additionalProperties === false) errors.push(`${path}: unexpected property ${k}`);
        else if (typeof s.additionalProperties === "object") walk(s.additionalProperties, x, `${path}.${k}`);
      }
    }
  };
  walk(schema, data, "$");
  return errors;
}
