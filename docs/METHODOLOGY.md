# Methodology

How the Fertility Tracker turns public statistics into per-country figures, projections and a population-decline
risk score. All of it is computed by `scripts/fetch-data.mjs` (Node 22, no dependencies) and published under
`public/api/v1/`. Field-level reference: [API.md](API.md).

## Sources

| Id | Source | What we take | Vintage (Oct 2026 build) |
| --- | --- | --- | --- |
| `UN-WPP` | UN World Population Prospects 2024, read from the UN's own CSV files, with the UN's interim update of 19 January 2026 (Togo) | Population (1 July), births, deaths, net migration, fertility rate, median age, crude birth and death rates, population by 5-year age group (65+ share): estimates 1950-2023 and the medium-variant projection 2024-2100. Total population under the medium and constant-fertility scenarios 2024-2100 (`scenarios.json`) | Files 2024-12-13, interim update 2026-01-19 (next revision: 11 July 2027) |
| `UN-DESA` | UN DESA International Migrant Stock 2024, via Our World in Data | Immigrant stock and emigrant stock (number and % of population), plus migrant stock by origin and destination (corridors) | 2025-03-12 (corridors 2025-03-18) |
| `WB` | World Bank World Development Indicators API | Latest reported fertility rate, population, crude birth and death rates, net migration, population growth, 65+ share, migrant stock; region and income group | 2026-10-08 (fertility and crude rates to 2024; population, net migration, growth and 65+ share to 2025) |

`index.json` lists the exact URLs fetched, the column names used, each dataset's last-update date and status.
All sources are free and need no key.

**Exact URLs**

- UN WPP, from `https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/` (gzip CSV,
  streamed): `WPP2024_Demographic_Indicators_Medium.csv.gz` (`TPopulation1July`, `Births`, `Deaths`, `NetMigrations`,
  `TFR`, `MedianAgePop`, `CBR`, `CDR`), `WPP2024_PopulationByAge5GroupSex_Medium.csv.gz` (65+ share) and
  `WPP2024_TotalPopulationBySex.csv.gz` (`PopTotal` for the `Medium` and `Constant fertility` variants). Counts are
  published in thousands with 3 decimals and converted to whole people. The interim update
  `.../1_Indicator%20(Standard)/WPP2024_CSV_files_update.zip` (release note:
  `https://population.un.org/wpp/assets/Files/WPP2024_Release-Note-rev1.pdf`) replaces Togo's rows in all three.
- UN DESA: `grapher/migrant-populations.csv?metric={immigrants|emigrants}&unit={number|share}`;
  corridors from `grapher/migration-origin-destination.csv?country_select={country}&metric={immigrants|emigrants}&gender=all`.
- World Bank: `https://api.worldbank.org/v2/country/all/indicator/{ID}?format=json&per_page=20000&mrnev=1` for
  `SP.DYN.TFRT.IN, SP.POP.TOTL, SP.DYN.CBRT.IN, SP.DYN.CDRT.IN, SM.POP.NETM, SP.POP.GROW, SP.POP.65UP.TO.ZS,
  SM.POP.TOTL, SM.POP.TOTL.ZS`, and `https://api.worldbank.org/v2/country?format=json&per_page=400`.

**Why the UN files and not Our World in Data (since October 2026).** Until then the UN WPP series came from Our World
in Data's copies. A full comparison with the UN's files (see [DATA-VALIDATION.md](DATA-VALIDATION.md)) found that OWID
builds population and deaths by summing the UN's 101 single-age values, each already rounded to a whole person. For
large countries that is off by a few dozen people. For tiny places it is material: Tokelau's 14 deaths in 2023 became
2, so its death rate showed 0.8 instead of 5.7 per 1,000. OWID's "65+" group also stops at age 99, which understated
the 65+ share in old populations (Hong Kong 2100: 56.5% instead of 61.2%). Migrant stocks and corridors still come
from OWID: they match UN DESA's own tables exactly.

## Countries covered

Every entity with an ISO 3166 alpha-3 code in UN WPP (236), plus Kosovo (`XKX`, World Bank's code) and the world
(`WLD`, UN location 900): 238 records. Continents and income-group aggregates are not published. Names follow Our World
in Data ("South Korea", not "Republic of Korea" or "Korea, Rep."), frozen in `scripts/lib/names.mjs`. Regions are World Bank regions. Taiwan and 20 small territories missing from the
World Bank borrow the region of a neighbour (Taiwan takes China's, Réunion takes Mauritius's, and so on); their
`incomeGroup` is `null`.

## Current figures and provenance

Headline fields (`population`, `tfr`, `birthRate`, `deathRate`, `naturalChangeRate`, `netMigration`,
`populationGrowthPct`, `share65`, `medianAge`) each carry `{value, year, source}`. The pipeline takes the newest
year available across the World Bank and the latest UN estimate; on a tie, the World Bank wins. Fertility and
crude rates are usually World Bank 2024, population and 65+ share World Bank 2025, median age UN 2023. Where the UN
value is used, crude birth and death rates are the UN's own `CBR` and `CDR` (per 1,000 person-years), and
`naturalChangeRate` is their difference. `share65` is everyone aged 65 or over, including 100+.

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

### Scenarios (`scenarios.json`)

The year slider's two paths are the UN's own scenarios, total population on 1 July, 2024-2100, for every record:

- **UN forecast** = WPP 2024 `Medium`: the projection years of each country's `series`. The UN's definition: fertility,
  mortality and international migration are "Based on the mean probabilistic projections for fertility and mortality,
  and median probabilistic projections for net migration."
- **If birth rates stay the same** = WPP 2024 `Constant fertility`. The UN's definition (WPP 2024 Methodology Report,
  section on projection scenarios): "As the name implies, under the constant-fertility scenario, fertility in all
  countries will remain constant at the level projected for 2024. Meanwhile, mortality and migration assumptions are
  the same as those in the medium fertility scenario." Its table II.4 lists fertility "Constant as of 2024", mortality
  "Medium", international migration "Medium". In the published data the constant level is each country's 2023
  estimate (checked for all 237 countries and areas: South Korea stays at 0.72 to 2100), so in plain words: fertility
  stays at its 2023 level; deaths and migration follow the UN forecast. It is a what-if, not a forecast.
- **Togo.** The UN's interim update of 19 January 2026 revised Togo's population (its 2010 and 2022 census counts had
  been adjusted for undercount twice), but only the medium scenario. Fertility and mortality rates did not change, so
  Togo's constant-fertility path is rescaled year by year by revised ÷ original medium (factor 0.88-0.90). The file
  lists this under `adjustments`. The world aggregate (`WLD`) was not revised by the UN and still counts Togo's old
  figures: about 1.1 million more people in 2024, under 0.03% of the world.

## How sure is each number

Every country page has a **How sure is this?** section, and every record in the API has a `confidence` block, a
`forecastRange` and `crossChecks` ([API.md](API.md)). They come only from primary sources, all of them free:

| What | Source | How we read it |
| --- | --- | --- |
| What the UN based each place on: censuses, registers, official estimates, registered births and deaths, how net migration was estimated | UN DESA, *World Population Prospects 2024: Data Sources* (UN DESA/POP/2024/DC/NO.11, August 2024), one page per place | A PDF, extracted once into `scripts/data/wpp2024-data-sources.json` by `scripts/extract/wpp_data_sources.py`, with the PDF's SHA-256. The UN's own sentences are published verbatim (`confidence.unSources`) |
| The latest census, the country's own latest population estimate, and whether its births and deaths registration is complete | UN Statistics Division, *Population and Vital Statistics Report*, tables 2 and 3 (updated 5 October 2026) | Two PDFs, extracted into `scripts/data/unsd-pvsr.json` by `scripts/extract/unsd_pvsr.py`, with each PDF's SHA-256 and the tables' footnotes |
| How each place's people born abroad were counted | UN DESA, *International Migrant Stock 2024*, Table 1 "Data type" (B = by country of birth, C = by citizenship, I = no data, modelled; R = refugees added) | The UN's workbook, read on every build |
| Which places UN DESA reassessed for 2024 (the rest carry the 2020 edition forward) | UN DESA, *International Migrant Stock 2024: Key facts and figures*, p. 1, footnote 3 (60 places) | `scripts/data/desa-2024-reassessed.json` |
| How sure the UN is about the future | UN WPP 2024, `Lower/Upper 80 PI`, `Lower/Upper 95 PI` and `Zero migration` rows of `WPP2024_TotalPopulationBySex.csv.gz` (the file the scenarios already come from) | Read on every build, Togo rescaled like its other scenarios |
| Newer national figures | Eurostat `demo_gind` (population on 1 January) and `migr_pop3ctb` (people born abroad), about 45 countries in and around Europe; the UN Statistics Division tables above for the rest; hand-checked notes in `scripts/data/crosschecks.json` | Eurostat read on every build. Hand-checked notes follow [CROSS-CHECK-PROCESS.md](CROSS-CHECK-PROCESS.md) |

**Levels.** Each part gets `good`, `fair` or `poor` ("Solid numbers", "Partly estimated", "Mostly estimated" on the
site). The rules are published in `index.json` as `confidenceRules`:

- **Today's population (last head count).** Good: a census in the last 10 years, a population register, or kept
  current (every birth and death registered, and the country's own population figure from the last two years within 2%
  of the UN's: Sweden and the Netherlands count everyone through registers, though their last listed census is 2011).
  Fair: the last census was 11-15 years ago. Poor: more than 15 years ago, or never. Fifteen years is the UN's own cutoff for an
  old census (WPP 2024 Summary of Results, annex 1: 23 places). The newest census counts even when the UN couldn't use
  it yet (reported to the UN Statistics Division after the 2024 revision). One step lower when a newer official
  population differs from the UN's by more than 5%.
- **Births and deaths.** Good: both reported to the UN Statistics Division as virtually complete (at least 90%), for 2018
  or later. Fair: registered, but incomplete or out of date, so the UN corrects them. Poor: no usable registration; the
  UN estimates births and deaths from surveys. Where a country reported nothing, what the UN says it used decides.
- **People born abroad.** Good: counted by country of birth and reassessed by UN DESA for 2024. Fair: counted by
  citizenship (this misses people who became citizens and counts children born there to foreign parents), or by
  country of birth but only carried forward from 2020. Poor: no data (modelled), or by citizenship and carried forward.
- **The forecast.** By the half-width of the UN's 95% range for 2050: within 20% of the forecast is good, 20-40% fair,
  more than 40% poor. By 2100 every range is wide: a typical place's runs from half to twice the forecast. Togo's range
  is the UN's, rescaled by us to its January 2026 correction (the UN revised only the central forecast), and says so
  (`forecastRange.adjusted`).
- **Overall** (`countries.json` `confidence`, the chip under each country's headline): the lower of today's
  population and births and deaths.

**Comparisons with newer figures** (`crossChecks`). Within 2% the figures "match"; otherwise the site says which side
the UN is on and by how much. Every national figure is compared with the UN's figure for the same day, between its two
1 July figures: 1 January for Eurostat, and the day a national estimate refers to (its footnote, such as "Data refer to
31 December"; otherwise mid-year). Where the national office's footnote says its figure covers a different area or group
(government-controlled areas only, nationals only, a region left out or added), the comparison is shown with that note
but not graded higher or lower, and it never changes a level. Only figures newer than what the UN used can lower the
"today" level. France is compared with the UN's France plus its five overseas regions, which Eurostat counts as part
of France. Each automatic comparison carries the national office's own footnotes to its figure, such as "Data refer to
government controlled areas" (Cyprus) or "The national total includes an estimated 19,191,728 persons (37.4%) who were
not enumerated" (Myanmar's 2024 census). Registered births and deaths are compared only where registration is reported as
complete, for 2021 or later, and in places of 100,000 people or more.

What the comparisons show, October 2026 build:

- **Where births are fully registered, the UN's forecast is often too high.** Colombia registered 434,000 births in 2025
  against a UN forecast of 693,000. Thailand's gap is 32%, Poland's 25%, Egypt's 24%, Argentina's 23% and Türkiye's
  18%. The UN made these forecasts in 2024 from data that ended in 2023; birth rates have kept falling since.
- **Several countries count far fewer people than the UN.** Ethiopia's own estimate for 2025 is 22% below the UN's.
  Uganda's 2024 census counted 46 million, 8.5% below the UN. Kenya's figure is 8% below, Egypt's 10% below, and
  Albania's 2023 census 17% below.
- **People born abroad: the UN adds refugees, which national registers often leave out.** For Türkiye the UN's
  figure (7.1 million) is more than twice Eurostat's (2.9 million), and for Poland 85% higher.

**Our own math.** The trend colors on the globe, the 0-100 risk score and the "100 people" generations view are our own
calculations on the UN's numbers: see the sections around this one. They inherit every uncertainty above. The risk
score's weights are our judgement.

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
2. `node scripts/fetch-data.mjs` fetches every source (4 attempts with backoff, 60 s timeout per request; the UN CSVs
   are streamed and restart from scratch on a broken download), builds all files, then refuses to write anything
   (exit 1, published data untouched) if:
   - a required source (the UN demographic indicators file, the UN interim update, the World Bank country list) is
     down, or the interim update is incomplete: each correction file must hold Togo for every year 1950-2100, every
     indicator field and all 21 age groups. Without a complete update Togo would silently keep the superseded figures;
   - any source that worked in the previous build is down now;
   - sanity checks fail: at least 200 records and 150 ranked; value ranges; `naturalChange = births − deaths` and the
     balance identity hold; world population and record count within 5% of the previous build; spot checks such as
     "South Korea TFR < 1.3", "Niger TFR > 4", "Nigeria projected to grow";
   - **coverage regresses vs the previous published build**. The check runs per country and per metric: years with
     data in each series metric (births, deaths, net migration, …), migrant stock years, every headline field and block
     (`components`, `migrantStock`, `projection`), each migration-corridor direction (`topOrigins`,
     `topDestinations`), the risk score, and membership of the ranking. Any loss is refused, so a partial upstream
     outage (for example one country's births and deaths missing from a CSV) cannot erase good data;
   - **provenance moves backwards**. For every headline field (`population`, `tfr`, `birthRate`, `deathRate`,
     `naturalChangeRate`, `netMigration`, `populationGrowthPct`, `medianAge`, `share65`) and for `migrantStock`,
     `components`, corridors and `projection.baseYear`, the published year must never decrease. A World Bank value
     may not be replaced by another source for the same year. Without this check, a successful but partial World
     Bank reply that omits one country would silently fall back to the older UN figure: France's fertility rate would
     go from 1.61 (WB, 2024) to 1.639 (UN, 2023). Policy: **refuse the write** and keep the last published data
     untouched; the failed run is visible in Actions and `status.json`. The pipeline never mixes old and new data in
     one build. A maintainer who has confirmed an upstream change is intentional reruns with `--force`;
   - `scenarios.json` would lose a place, shrink its year range or lose values, its medium path disagrees with the
     series population (by more than 0.05%), or its two scenarios start from different populations (more than 1%
     apart);
   - any JSON file fails its JSON Schema.
3. The workflow then runs `node scripts/validate-data.mjs`, which compares every published number with the primary
   sources (UN WPP CSVs, World Bank API, UN DESA tables; see [DATA-VALIDATION.md](DATA-VALIDATION.md)). A mismatch
   blocks scheduled and manual runs before anything is committed or deployed. A published value with no reference
   value counts as a mismatch. Exit 2 means only that a primary source could not be fetched; any other failure is
   exit 3.
4. Output is idempotent. Unchanged numbers give byte-identical files. `generatedAt` and `contentHash` in `index.json`
   move only when some published value changes, so the workflow commits only real changes.
5. The migration corridors (about 460 small CSVs) are reused from the previous build while their source vintage is
   unchanged. When the vintage changes, the refresh is all-or-nothing. Any of these count as a country failure:
   a network error; a structurally empty CSV (no data year or World total, or no partner country in either
   direction); a direction whose partner breakdown was published before coming back with only a World total. On any
   failure, the last published corridors are kept as one consistent set with their original vintage. Directions that
   never had a breakdown (UN DESA gives only totals for immigrants into Bonaire and the Vatican) stay valid. Countries
   and directions are never silently dropped.
6. The workflow verifies the files, then checks that the branch has not moved since checkout. If it moved, the run
   stops without committing or deploying, and the run triggered by the newer commit refreshes, tests and deploys it
   (no rebase, so untested code is never deployed). Otherwise it commits changes with a plain fast-forward push and
   writes a deploy-time `api/v1/status.json` (not committed). That file holds `checkedAt`, the refresh outcome, the run
   URL, the deployed `commit` and the `triggerCommit`. Then it deploys `public/` to Vercel (production) with the Vercel CLI.

## Limitations

- UN WPP 2024 estimates end in 2023. Every later year is a projection, and a sharp recent fertility drop (or rebound)
  shows up only in the World Bank's latest TFR and the next WPP revision (postponed by the UN to 11 July 2027).
  National statistics offices publish newer figures for some countries; [DATA-VALIDATION.md](DATA-VALIDATION.md) lists
  them for the 30 highest-risk places.
- Some UN net-migration series are flat or jumpy because the UN publishes them that way: Hong Kong's estimate is
  -3,427 in each of 2021, 2022 and 2023, then the projection swings (-19,272 in 2024, +17,863 in 2025, -12,576 in
  2026). 32 places repeat a value for three or more estimate years. We publish the UN's numbers unchanged.
- The World Bank's latest net migration (2025) and, for many countries, population are UN WPP projections
  republished: Hong Kong's headline net migration +17,863 (World Bank 2025) is the UN's 2025 projection.
- Wars and crises (Ukraine, Gaza, Sudan, Myanmar) make estimates and projections less certain. The "How sure is
  this?" section says, per place, how old the last count is and what newer figures show (see
  [How sure is each number](#how-sure-is-each-number)).
- Migrant stocks count people by country of birth, so border changes and refugees are handled as UN DESA defines them.
- The risk weights are judgement calls, documented above so anyone can recompute or reweight from `risk.json` inputs.
