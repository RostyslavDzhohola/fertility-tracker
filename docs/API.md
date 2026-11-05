# Fertility Tracker API (v1)

Static, read-only JSON and CSV for every country: fertility, births, deaths, net migration, immigrant and emigrant
stocks, migration corridors, UN projections to 2100 (the UN forecast and "if birth rates stay the same") and a
population-decline risk score. No key, no sign-up, refreshed weekly.

- **Base URL:** `https://fertility-tracker-live.vercel.app/api/v1/`
- **CORS:** Vercel sends `Access-Control-Allow-Origin: *` for `api/`, `llms.txt` and `feedback.json` (set in `vercel.json`), so any file can be fetched cross-origin from a
  browser, a server or an agent.
- **Formats:** JSON (UTF-8) and CSV (RFC 4180, header row). OpenAPI 3.1: [`openapi.json`](https://fertility-tracker-live.vercel.app/api/v1/openapi.json).
  JSON Schemas: `schema/*.schema.json`. Agent guide: [`/llms.txt`](https://fertility-tracker-live.vercel.app/llms.txt).
- **Conventions:** ISO 3166-1 alpha-3 codes (`WLD` = world, `XKX` = Kosovo); numbers are JSON numbers, never strings;
  missing values are `null`; every record carries `iso3`, `name` and `region`, so no join is needed. Field names are
  stable within v1. Breaking changes would ship as `/api/v2/`.
- **Freshness:** `index.json` `generatedAt` changes only when a published number changes. `status.json` shows when the
  weekly job last ran (`checkedAt`) and which commit is deployed (`commit`; `triggerCommit` is the commit that started
  the run). `contentHash` gives a cheap change check.

## Endpoints

| Path | What |
| --- | --- |
| `index.json` | Manifest: sources with exact URLs and vintages, endpoints, data gaps, links, `generatedAt`, `contentHash`. |
| `countries.json` | One summary record per country + `WLD` (238), sorted by iso3. About 310 KB raw, 42 KB gzipped. |
| `countries/{ISO3}.json` | Everything for one country: all headline fields, yearly series 1950-2100, migrant stock history, migration corridors, full risk breakdown. About 35 KB. |
| `risk.json` | Ranked countries (highest risk first) with component points and inputs, unranked records with reasons, and the full methodology. |
| `scenarios.json` | Population of every country + `WLD`, each year: UN estimates 1950-2023, then 2024-2100 under two UN scenarios: "UN forecast" (medium) and "If birth rates stay the same" (constant fertility). About 445 KB raw, 210 KB gzipped. |
| `countries.csv` | One row per country, nested fields flattened with `_` (`components_births`, `projection_change2100Pct`, …). |
| `timeseries.csv` | Long format `iso3,year,variant,metric,value`. Every country, year and metric; rows with no data are omitted. |
| `status.json` | Deploy-time: `checkedAt`, refresh outcome, run URL, source statuses. |
| `openapi.json`, `schema/*.schema.json` | Machine-readable descriptions. |

## `countries.json`

```json
{ "apiVersion": "v1", "generatedAt": "...", "latestEstimateYear": 2023, "replacementTfr": 2.1, "count": 238,
  "sources": { "WB": "...", "UN-WPP": "...", "UN-DESA": "..." }, "countries": [ ... ] }
```

Each record (South Korea, October 2026):

```json
{
  "iso3": "KOR", "isoNumeric": "410", "name": "South Korea", "region": "East Asia & Pacific",
  "incomeGroup": "High income", "ranked": true, "flags": [],
  "population": { "value": 51684564, "year": 2025, "source": "WB" },
  "tfr": { "value": 0.748, "year": 2024, "source": "WB" },
  "medianAge": { "value": 44.5, "year": 2023, "source": "UN-WPP" },
  "share65": { "value": 20.3, "year": 2025, "source": "WB" },
  "components": {
    "year": 2023, "births": 236394, "deaths": 345503, "naturalChange": -109109, "netMigration": 87800,
    "populationChange": -21309,
    "perThousand": { "births": 4.6, "deaths": 6.7, "naturalChange": -2.1, "netMigration": 1.7, "populationChange": -0.4 },
    "migrationOffsetPct": 80
  },
  "migrantStock": { "year": 2024, "immigrants": 1811507, "immigrantsPct": 3.5, "emigrants": 2030473, "emigrantsPct": 3.9,
    "livingAbroadPct": 3.9 },
  "projection": {
    "baseYear": 2023, "basePopulation": 51748744, "population2050": 45143134, "population2100": 21848795, "change2050Pct": -12.8, "change2100Pct": -57.8,
    "peakYear": 2020, "halfPopulationYear": 2089, "naturalDeclineSince": 2019
  },
  "generations": { "ratio": 0.356, "halvingYears": 20 },
  "risk": {
    "score": 77, "tier": "Critical", "rank": 6,
    "factors": [
      "Fertility 0.75 births per woman (2024), about a third of the 2.1 replacement level",
      "UN projects a 58% fall by 2100 (51.7 million in 2023 → 21.8 million); peaked in 2020",
      "More deaths than births since 2019 (2023: 236,000 births, 346,000 deaths)"
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `isoNumeric` | ISO 3166-1 numeric code: the feature id in common world map files (world-atlas TopoJSON). `null` for WLD and XKX. |
| `region`, `incomeGroup` | World Bank classification (`incomeGroup` `null` if unclassified). |
| `ranked`, `flags` | `ranked: false` for `WLD` and places under 100,000 people or with incomplete inputs. Flags: `aggregate`, `small-population`, `no-world-bank-data`, `incomplete-risk-inputs`. |
| `population`, `tfr`, `medianAge`, `share65` | Newest value across sources, with `year` and `source` (`WB`, `UN-WPP`, `UN-DESA`). `tfr` = births per woman; 2.1 = replacement. `share65` = % aged 65+ (100+ included). |
| `components` | Demographic balance for the latest UN estimate year: `populationChange = births − deaths + netMigration`, plus rates per 1,000 people. `migrationOffsetPct` = net migration as % of the natural decline (null when births ≥ deaths). |
| `migrantStock` | UN DESA stocks. `immigrants` = people living here born abroad (inflow proxy); `immigrantsPct` = % of residents. `emigrants` = people born here living abroad (outflow proxy). `emigrantsPct` = emigrants as % of the current RESIDENT population (UN DESA/OWID definition, so it can exceed the share of people born here). `livingAbroadPct` = share of everyone born here who lives abroad: emigrants ÷ (residents − immigrants + emigrants). |
| `projection` | UN WPP 2024 medium variant: populations in 2050 and 2100 and the % change from `basePopulation` in `baseYear` (the latest UN estimate year, not the headline population year), peak year, first year at half of the baseline population, start of more-deaths-than-births. Label the baseline when showing the % change next to the headline `population`. |
| `generations` | `ratio = tfr / 2.1`: each ~30-year generation is this fraction of the last. `halvingYears` = years for generation size to halve (null if ratio ≥ 1). |
| `risk` | Score 0-100, tier (`Critical` ≥ 70, `High` ≥ 55, `Elevated` ≥ 40, `Moderate` ≥ 20, `Low`), rank (1 = highest risk; null if unranked), top 3 plain-English factors. |

## `countries/{ISO3}.json`

Everything in the summary, plus:

- `iso2`, `birthRate`, `deathRate`, `naturalChangeRate` (per 1,000), `netMigration` (people/year),
  `populationGrowthPct`. Each carries `{value, year, source}`.
- `components.source`, `components.population` (the 1 July denominator); `migrantStock.netStock`, `migrantStock.source`.
- `projection` extras: `source`, `variant`, `peakPopulation`, `tfr2050`, `tfr2100`, `share65in2050`, `medianAge2050`.
- `generations.hundredPeople`: 100 people → children → grandchildren → … (5 values).
- `risk.factors` (all of them), `risk.components` (`{value 0..1, points, weight}` per component), `risk.inputs`.
- `series`: one row per year 1950-2100, `{year, variant, population, births, deaths, naturalChange, netMigration,
  populationChange, tfr, medianAge, share65}`. `variant` is `estimate` up to the latest estimate year and
  `projection` (UN medium) after.
- `migrantStockSeries`: `{year, immigrants, immigrantsPct, emigrants, emigrantsPct, livingAbroadPct, netStock}` for 1990-2024.
- `migrationCorridors`: `{year, source, immigrantsTotal, emigrantsTotal, topOrigins[], topDestinations[]}`. Each
  partner is `{iso3, name, people}`: top 10 countries of birth of immigrants, and top 10 countries where emigrants live.
  `null` where UN DESA has no corridor data.
- `links`: `self`, `countries`, `risk`, `docs`, `site` (the country's page on the live tracker,
  `https://fertility-tracker-live.vercel.app/country/{ISO3}`).

## `scenarios.json`

The data behind the year slider: total population on 1 July for every record (all 238, including `WLD`): the UN's
estimates for `estimateStartYear`..`startYear - 1` (1950-2023), then each year `startYear`..`endYear` (2024-2100) under
two UN World Population Prospects 2024 scenarios.

```json
{
  "apiVersion": "v1", "generatedAt": "...", "unit": "people", "estimateStartYear": 1950, "startYear": 2024, "endYear": 2100,
  "source": { "id": "UN-WPP", "url": ".../WPP2024_TotalPopulationBySex.csv.gz", "vintage": "2024-12-13",
              "interimUpdate": { "released": "2026-01-19", ... }, "nextUpdate": "2027-07-11", "license": "CC BY 3.0 IGO", ... },
  "scenarios": {
    "medium":   { "label": "UN forecast", "unVariant": "Medium", "description": "...", "unDefinition": "..." },
    "constant": { "label": "If birth rates stay the same", "unVariant": "Constant fertility", "description": "...", "unDefinition": "..." }
  },
  "notes": [ "..." ],
  "adjustments": [ { "iso3": "TGO", "scenarios": ["constant"], "method": "...", "ratioRange": [0.883, 0.901], "reason": "..." } ],
  "places": { "KOR": { "estimate": [19757321, ...74 integers], "medium": [51717590, ...77 integers], "constant": [51715325, ...] }, "WLD": { ... }, ... }
}
```

| Field | Meaning |
| --- | --- |
| `places[ISO3].estimate` | The past both scenarios share: the UN's estimates, 1950-2023, the same numbers as `series` (variant `estimate`) in `countries/{ISO3}.json`. Index `year - estimateStartYear`. |
| `places[ISO3].medium` | UN forecast (medium scenario): the same projection as `series` in `countries/{ISO3}.json` (to within 1 person). |
| `places[ISO3].constant` | If birth rates stay the same: each country's fertility rate stays at its 2023 level to 2100, while mortality and migration follow the medium scenario (UN constant-fertility scenario). A what-if, not a forecast. |
| index | `medium` and `constant`: `array[year - startYear]`; `estimate`: `array[year - estimateStartYear]`. Integers are people; `null` = missing (none at present). |
| `scenarios.*.unDefinition` | The UN's own definition, quoted from the WPP 2024 Methodology Report. |
| `adjustments` | Places whose numbers are not straight from the UN file, and why. Togo: the UN's interim update of 19 January 2026 revised only its medium scenario, so its constant-fertility path is rescaled to the revised population level. |

"Today" is not in the file: take the current calendar year's value from `medium` (UN estimates end in 2023).

## `risk.json`

`methodology` (formula, components with weights and ramp end points, tiers, eligibility), `ranking[]` (`rank, iso3,
name, region, score, tier, components, inputs, factors`) and `unranked[]` (`iso3, name, region, score, tier,
reason`). The method is described in [METHODOLOGY.md](METHODOLOGY.md).

## CSV

- `countries.csv`: the columns follow the JSON paths: `population`, `population_year`, `population_source`, …,
  `components_births`, `components_perThousand_netMigration`, `migrantStock_emigrants`, `projection_change2100Pct`,
  `risk_rank`, `risk_score`, `risk_tier`, `flags` (space-separated), `risk_factors` (joined with ` | `).
- `timeseries.csv`: metrics are `population, births, deaths, naturalChange, netMigration, populationChange, tfr,
  medianAge, share65` (yearly, UN WPP) and `immigrants, immigrantsPct, emigrants, emigrantsPct, livingAbroadPct` (UN DESA, 1990-2024,
  `variant` = `estimate`). About 11 MB.

## Examples

```sh
# 10 highest-risk countries
curl -s https://fertility-tracker-live.vercel.app/api/v1/risk.json \
  | jq -r '.ranking[:10][] | "\(.rank). \(.name) \(.score) \(.tier)"'

# Taiwan in 2070: UN forecast vs if birth rates stay the same
curl -s https://fertility-tracker-live.vercel.app/api/v1/scenarios.json \
  | jq '.startYear as $s | .places.TWN | {medium: .medium[2070 - $s], constant: .constant[2070 - $s]}'

# Japan's births, deaths and net migration in 2050 (UN projection)
curl -s https://fertility-tracker-live.vercel.app/api/v1/countries/JPN.json \
  | jq '.series[] | select(.year == 2050) | {births, deaths, netMigration}'
```

```js
const base = "https://fertility-tracker-live.vercel.app/api/v1/";
const { countries } = await (await fetch(base + "countries.json")).json();
const belowReplacement = countries.filter((c) => c.iso3 !== "WLD" && c.tfr?.value < 2.1).length;
```

```python
import pandas as pd
ts = pd.read_csv("https://fertility-tracker-live.vercel.app/api/v1/timeseries.csv")
kor = ts[(ts.iso3 == "KOR") & (ts.metric == "births")]
```

## Sources, licence, citation

World Bank WDI (CC BY 4.0); UN World Population Prospects 2024 with its January 2026 interim update (UN, CC BY 3.0 IGO,
read from the UN's CSV files); UN DESA International Migrant Stock 2024 (UN, CC BY 3.0 IGO, via Our World in Data,
CC BY 4.0). Code: MIT. Cite the original publishers plus "Fertility Tracker
(github.com/RostyslavDzhohola/fertility-tracker)". Feedback: GitHub Issues or `andromedus+fertility@mail.grokbot.com`.
