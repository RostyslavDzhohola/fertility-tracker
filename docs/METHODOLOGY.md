# Methodology

How the Fertility Tracker turns public statistics into per-country figures, projections and a population-decline
risk score. All of it is computed by `scripts/fetch-data.mjs` (Node 22, no dependencies) and published under
`public/api/v1/`. Field-level reference: [API.md](API.md).

## Sources

| Id | Source | What we take | Vintage (Oct 2026 build) |
| --- | --- | --- | --- |
| `UN-WPP` | UN World Population Prospects 2024, via Our World in Data | Fertility rate, population, births, deaths, net migration, median age, population 65+: estimates 1950-2023 and the medium-variant projection 2024-2100 | 2024-07-12 (next UN update expected 2027) |
| `UN-DESA` | UN DESA International Migrant Stock 2024, via Our World in Data | Immigrant stock and emigrant stock (number and % of population), plus migrant stock by origin and destination (corridors) | 2025-03-12 (corridors 2025-03-18) |
| `WB` | World Bank World Development Indicators API | Latest reported fertility rate, population, crude birth and death rates, net migration, population growth, 65+ share, migrant stock; region and income group | 2026-10-08 |

`index.json` lists the exact URLs fetched, the column names used, each dataset's last-update date and status.
All sources are free and need no key.

**Exact URLs**

- UN WPP (OWID grapher CSVs, `?v=1&csvType=full&useColumnShortNames=true`): `fertility-rate-with-projections`,
  `population-with-un-projections`, `births-and-deaths-projected-to-2100`, `median-age`,
  `population-by-age-group-with-projections`. Net migration comes from the OWID population explorer:
  `explorers/population-and-demography.csv?indicator=Net+migration&Sex=Both+sexes&Age=Total&Projection+scenario=Medium`.
- UN DESA: `grapher/migrant-populations.csv?metric={immigrants|emigrants}&unit={number|share}`;
  corridors from `grapher/migration-origin-destination.csv?country_select={country}&metric={immigrants|emigrants}&gender=all`.
- World Bank: `https://api.worldbank.org/v2/country/all/indicator/{ID}?format=json&per_page=20000&mrnev=1` for
  `SP.DYN.TFRT.IN, SP.POP.TOTL, SP.DYN.CBRT.IN, SP.DYN.CDRT.IN, SM.POP.NETM, SP.POP.GROW, SP.POP.65UP.TO.ZS,
  SM.POP.TOTL, SM.POP.TOTL.ZS`, and `https://api.worldbank.org/v2/country?format=json&per_page=400`.

## Countries covered

Every entity with an ISO 3166 alpha-3 code in UN WPP (236), plus Kosovo (`XKX`, World Bank's code) and the world
(`WLD`): 238 records. Continents and income-group aggregates are not published. Names follow Our World in Data
("South Korea", not "Korea, Rep."). Regions are World Bank regions. Taiwan and 20 small territories missing from the
World Bank borrow the region of a neighbour (Taiwan takes China's, Réunion takes Mauritius's, and so on); their
`incomeGroup` is `null`.

## Current figures and provenance

Headline fields (`population`, `tfr`, `birthRate`, `deathRate`, `naturalChangeRate`, `netMigration`,
`populationGrowthPct`, `share65`, `medianAge`) each carry `{value, year, source}`. The pipeline takes the newest
year available across the World Bank and the latest UN estimate; on a tie, the World Bank wins. Fertility and
crude rates are usually World Bank 2024, population and 65+ share World Bank 2025, median age UN 2023.

Caveat: for most countries, the World Bank's net migration (and often population) for the latest years are
themselves UN WPP estimates or projections, republished by the World Bank.

## Growth decomposition (demographic balance)

For every country and year, 1950-2100:

```
naturalChange    = births - deaths
populationChange = births - deaths + netMigration
```

`births`, `deaths` and `netMigration` are UN WPP calendar-year totals (estimates up to the latest estimate year,
medium-variant projection after). `components` in each record is this balance for the latest estimate year
(2023), with rates per 1,000 mid-year (1 July) population. `migrationOffsetPct` = netMigration ÷ (deaths − births) ×
100 when deaths exceed births: 100 or more means immigration fully offsets the natural decline, and a negative value
means net emigration makes it worse.

`populationChange` is the balance for the calendar year. It can differ slightly from the gap between two successive
1 July population figures.

## Inflow and outflow of people

No global source publishes **gross annual migration flows** (how many people arrive and how many leave each year)
for all countries. National statistics offices and the OECD do for some countries, in incompatible definitions. So we
publish:

- **Annual net migration** (UN WPP): immigrants minus emigrants per year, estimates and projections.
- **Immigrant stock** (UN DESA), the inflow proxy: people living in the country who were born in another country,
  as a number and as a % of the population.
- **Emigrant stock** (UN DESA), the outflow proxy: people born in the country who now live abroad. `emigrantsPct`
  follows UN DESA / Our World in Data and divides by the country's **current resident population**, so for Guyana it is
  56%. `livingAbroadPct` answers "what share of people born here live abroad": emigrants ÷ (residents − immigrants +
  emigrants), where residents − immigrants = native-born residents. For Guyana that is 37.7%. The plain-English factor
  uses `livingAbroadPct`.
- **Migration corridors** (UN DESA): the top 10 countries of birth of immigrants and the top 10 countries where
  emigrants live.

Stocks are available for 1990, 1995, … 2020 and 2024 only. Corridors are missing for Guernsey and Jersey (UN DESA
reports them as "Channel Islands"), Kosovo, Saint Barthélemy and Saint Martin.

## Projections

The UN WPP 2024 **medium variant** is the UN's central projection: fertility, mortality and migration follow its
median assumptions. `projection` reports the 2050 and 2100 populations and the % change from `basePopulation`, the UN
population in `baseYear` (the latest estimate year, 2023). Both are published, because the headline `population` is
often a newer World Bank figure. Nigeria: 238 million (World Bank 2025) is the headline, but +109% by 2100 is measured
from 228 million (UN 2023).
The summary also gives
the peak year (1950-2100), the first year the population is half of the baseline (`halfPopulationYear`), and
`naturalDeclineSince`: the start of the current run of years with more deaths than births, or, if births still lead,
the first projected year with more deaths.

## The "100 people" generations view

`generations.ratio = tfr / 2.1`. If each ~30-year generation is that fraction of the one before, 100 people today
become `hundredPeople` = 100, 100·r, 100·r², … At a fertility rate of 1.14: 100 → 54 → 29 → 16 → 9. `halvingYears` =
30 × ln(0.5) ÷ ln(r). This shows the long-run pull of today's rate. It ignores migration, mortality change and
age-structure momentum; the UN projection is the actual forecast.

## Population-decline risk score

A transparent 0-100 score: how fast, and how locked-in, a country's population decline is. It sums five
components. Each one is a linear ramp, clamped to 0..1: 0 at the "no risk" point, 1 at the "maximum risk" point.

```
score = round( Σ weight_i × ramp(input_i, zeroAt_i, fullAt_i) )      weights sum to 100
ramp(x, z, f) = clamp((x − z) / (f − z), 0, 1)
```

| Component | Weight | Input | 0 at | 1 at |
| --- | ---: | --- | --- | --- |
| Fertility below replacement | 35 | `tfr` (latest) | 2.1 | 0.8 |
| More deaths than births | 15 | `naturalChangeRate`, births − deaths per 1,000 (latest) | +5 | −7 |
| Aging population | 10 | mean of `share65` (7% → 30%) and `medianAge` (25 → 50 years) | | |
| UN-projected decline | 30 | weighted mean of `change2050Pct` (weight 1; 0% → −25%) and `change2100Pct` (weight 2; 0% → −60%) | | |
| Migration does not fill the gap | 10 | see below | | |

**Migration component.** If deaths exceed births (UN, latest estimate year): `ramp(migrationOffsetPct, 100, 0)`, and
net emigration counts as 1. If births exceed deaths but net emigration still shrinks the population: population change
per 1,000, ramped from 0 to −10. Otherwise 0.

**Tiers.** Critical ≥ 70 · High 55-69 · Elevated 40-54 · Moderate 20-39 · Low < 20.

**Ranking.** Countries and territories with at least 100,000 people and every input available are ranked; rank 1 is
the highest risk. Ties break on the unrounded score, then ISO3 code. Smaller places (38 records, including the world
aggregate) keep their score and tier where computable but have `ranked: false`, `risk.rank: null` and the flag
`small-population`. Their rates swing on small numbers.

**Factors.** Each country gets plain-English reasons, ordered by the points each component contributed. Examples:
"Fertility 0.75 births per woman (2024), about a third of the 2.1 replacement level", "More deaths than births since
2019", "UN projects a 58% fall by 2100", "Immigration offsets only 80% of the natural decline". A context line on
emigrant stock is added when 10% or more of the people born in a country live abroad.

**Calibration.** Weights and ramps were set so the ordering matches the demographic consensus: the places with
ultra-low fertility and steep UN-projected decline come first (October 2026 build: Hong Kong, Ukraine, Taiwan,
Puerto Rico, Belarus, South Korea, Japan, Poland, …; Italy ranks 15th), while high-fertility countries such as
Nigeria and Niger score 0. Fertility carries the most weight because it drives everything else. The 2100 projection
counts double the 2050 one: by 2050, today's age structure still props up numbers, while by 2100 the effect of
today's fertility has played out. The score is an indicator, not a forecast. `risk.json` repeats the formula and
gives each country's component values, points and inputs.

**Worked example: South Korea (Oct 2026 build).** Fertility 0.748 → 1.0 × 35 = 35.0. Natural change −2.3 per 1,000 →
0.61 × 15 = 9.1. Aging (20.3% aged 65+, median age 44.5) → 0.68 × 10 = 6.8. Projection (−12.8% by 2050, −57.8% by
2100) → 0.81 × 30 = 24.4. Migration offsets 80% of the natural decline → 0.2 × 10 = 2.0. Total 77, **Critical**,
rank 6.

## Refresh loop and robustness

`.github/workflows/refresh-and-deploy.yml` runs every Monday at 06:17 UTC, on manual dispatch and on pushes to `main`:

1. `node --test` runs the unit tests.
2. `node scripts/fetch-data.mjs` fetches every source (4 attempts with backoff, 60 s timeout per request), builds
   all files, then refuses to write anything (exit 1, published data untouched) if:
   - a required source (UN fertility, population, births/deaths, World Bank country list) is down;
   - any source that worked in the previous build is down now;
   - sanity checks fail: at least 200 records and 150 ranked; value ranges; `naturalChange = births − deaths` and the
     balance identity hold; world population and record count within 5% of the previous build; spot checks such as
     "South Korea TFR < 1.3", "Niger TFR > 4", "Nigeria projected to grow";
   - **coverage regresses vs the previous published build**. The check runs per country and per metric: years with
     data in each series metric (births, deaths, net migration, …), migrant stock years, every headline field and block
     (`components`, `migrantStock`, `projection`, corridors), the risk score, and membership of the ranking. Any loss
     is refused, so a partial upstream outage (for example one country's births and deaths missing from a CSV) cannot
     erase good data. Intentional changes need `--force`;
   - any JSON file fails its JSON Schema.
3. Output is idempotent. Unchanged numbers give byte-identical files. `generatedAt` and `contentHash` in `index.json`
   move only when some published value changes, so the workflow commits only real changes.
4. The migration corridors (about 460 small CSVs) are reused from the previous build while their source vintage is
   unchanged. When the vintage changes, the refresh is all-or-nothing: if any country fails (network error or a
   structurally empty CSV with no data year or World total, or no partner country in either direction), the last
   published corridors are kept as one consistent set. Countries are never silently dropped.
5. The workflow verifies the files, then checks that the branch has not moved since checkout. If it moved, the run
   stops without committing or deploying, and the run triggered by the newer commit refreshes, tests and deploys it
   (no rebase, so untested code is never deployed). Otherwise it commits changes with a plain fast-forward push and
   writes a deploy-time `api/v1/status.json` (not committed). That file holds `checkedAt`, the refresh outcome, the run
   URL, the deployed `commit` and the `triggerCommit`. Then it deploys `public/` to GitHub Pages.

## Limitations

- UN WPP 2024 estimates end in 2023. Every later year is a projection, and a sharp recent fertility drop (or rebound)
  shows up only in the World Bank's latest TFR and the next WPP revision (expected 2027).
- Wars and crises (Ukraine, Gaza, Sudan, Myanmar) make estimates and projections less certain.
- Migrant stocks count people by country of birth, so border changes and refugees are handled as UN DESA defines them.
- The risk weights are judgement calls, documented above so anyone can recompute or reweight from `risk.json` inputs.
