# Data validation

What `scripts/validate-data.mjs` checks against the primary sources, what it found on 2026-10-27/28, and how each
finding was fixed. Methodology: [METHODOLOGY.md](METHODOLOGY.md). Field reference: [API.md](API.md).

## What is compared

Every published value for all 238 records (237 countries and areas + `WLD`), against the publishers' own files:

| Source | Published fields | Values compared |
| --- | --- | ---: |
| UN WPP 2024 CSVs (`WPP2024_Demographic_Indicators_Medium`, `WPP2024_PopulationByAge5GroupSex_Medium`, `WPP2024_TotalPopulationBySex`) + the 2026-01-19 interim update | `series` (every year 1950-2100: population, births, deaths, net migration, natural change, fertility, median age, 65+ share, variant label), `projection` (base, 2050, 2100, % changes, peak, half-population year, natural decline since, 2050/2100 fertility, median age and 65+ share), `components`, every headline value whose source is UN-WPP, `scenarios.json` (both scenarios, every year) | 365,976 |
| World Bank WDI API (all years 2000-2030, not just `mrnev=1`) | Every headline value whose source is WB: value and year (population, fertility, birth, death and natural-change rates, net migration, growth, 65+ share) | 1,736 |
| World Bank + UN WPP | Each headline field's year and source is the newest available (World Bank wins ties): 9 fields × 238 | 2,142 |
| UN DESA International Migrant Stock 2024 (`.xlsx` tables on un.org: by destination, by origin, by destination and origin) | `migrantStockSeries` (immigrants, immigrants %, emigrants, emigrants %, share living abroad; 1990-2024), the 232 `migrationCorridors` (totals and top 10 partners each way) | 10,280 |
| Internal | Identities (births − deaths, balance), summary = detail, risk inputs and scores recomputed, ranking order, generations, `countries.csv` and every `timeseries.csv` row = JSON, scenarios medium = series, `links.site` | 437,625 |
| **Total** | | **817,759** |

Tolerances are only the published rounding: whole people for counts, 0.0005 for fertility, 0.05 for one-decimal
values.

## What it found, and the fixes

Before the fixes: **92,544 of 817,760 values disagreed**. After: **0 of 817,759**. The ranking and all 200 ranked
scores are unchanged; five unranked small places moved by 1-4 points (Falkland Islands 31 → 35; Saint Barthélemy,
Cook Islands, Montserrat, Wallis and Futuna +1).

1. **Population and deaths for small places were wrong** (root cause: Our World in Data sums the UN's 101 single-age
   values, each rounded to a whole person). Large countries were off by 1-34 people (28,950 population values),
   but tiny places were materially wrong: Tokelau 2023 deaths 2 → **14**, death rate 0.8 → **5.7** per 1,000; British
   Virgin Islands 1964 deaths 54 → 73; Vatican % change to 2100 172.1 → 174.4; Bermuda deaths exceed births since
   2021 → 2018. Peak year moved in 6 places and `naturalDeclineSince` in 16.
   **Fix:** the pipeline reads the UN's own CSVs (streamed, `scripts/lib/unwpp.mjs`) instead of OWID's copies.
2. **The 65+ share left out everyone aged 100+** (OWID's "65+" column stops at 99): 9,309 series values, up to 4.7
   points. Hong Kong 2100: 56.5% → **61.0%**; South Korea 2100: 43.0% → 45.2%; Monaco 2050: 28.3% → 28.8%. **Fix:** 65+
   = UN 5-year age groups from 65 up, 100+ included.
3. **Togo in the provisional `scenarios.json` used superseded figures.** The UN's interim update of 19 January 2026
   corrected Togo's population (it had been adjusted for undercount twice), but only in a separate `_Update` zip.
   2024: 9,515,236 → **8,406,558**; 2100: 26.3 → 23.6 million. **Fix:** the pipeline overlays the update zip on every
   UN file and refuses to publish without it. The UN did not revise Togo's constant-fertility scenario, so it is
   rescaled to the corrected level (factor 0.88-0.90) and listed in `scenarios.json` `adjustments`. OWID already
   had the update, so the old series were right for Togo.
4. **UN crude rates** (headline birth and death rates for the 21 places without World Bank data) were births or
   deaths ÷ 1 July population, not the UN's published `CBR`/`CDR` (÷ person-years): Vatican death rate 22.0 → 25.6.
   **Fix:** use the UN's own rates. `components.perThousand` stays per 1 July population, as documented.
5. **Median age rounding**: 159 values sat on a rounding boundary (Niger 2023: 15.3 → 15.2, UN 15.2495). Fixed by the switch in item 1.
6. **Metadata**: `index.json` gave the UN-WPP vintage as 2024-07-12 (OWID's processing date) and did not mention
   the interim update. It now lists the UN file dates, the update (2026-01-19, Togo) and the next revision
   (2027-07-11). `links.site` is now `https://fertility-tracker-live.vercel.app/country/{ISO3}`.

**Not bugs** (verified equal to the primary source):

- **Hong Kong net migration**: -3,427 in 2021, 2022 and 2023, then -19,272 (2024), +17,863 (2025), -12,576 (2026).
  These are exactly the UN's numbers (`NetMigrations` -3.427 thousand, three years running). The same repeat
  appears in French Polynesia for 2021-2023; 32 places repeat a net-migration value for 3+ estimate years (mostly
  1950s-1990s; recent runs end in 2019-2021 for the Bahamas, Barbados, Grenada, Jamaica, Saint Kitts and Nevis,
  Belarus, Bermuda and Laos); 10 places swing sign 4+ times in 2024-2035 (Hong Kong,
  Macao, Bhutan, Djibouti, Rwanda, Somalia, South Sudan, Mayotte, Anguilla, Saint Kitts and Nevis). No place has a
  repeat that is not in the UN file. Hong Kong's headline net migration +17,863 is labelled World Bank 2025, which is
  correct: the World Bank republishes the UN's 2025 projection.
- **World Bank values and years**: all 217 places × 8 fields equal the World Bank's latest value, and no newer year
  exists in the API.
- **Migrant stocks and corridors**: all equal UN DESA's own tables (OWID's copy is exact).

## Editions and vintages (checked 2026-10-27)

| Source | Latest edition | Evidence |
| --- | --- | --- |
| UN World Population Prospects | **WPP 2024** (released 2024-07-11) with an **interim update on 2026-01-19** (Togo only). The next revision was "postponed for public release until 11 July 2027". | [Release note rev.1](https://population.un.org/wpp/assets/Files/WPP2024_Release-Note-rev1.pdf); [downloads](https://population.un.org/wpp/downloads) (CSV files Last-Modified 2024-12-13; update zip 2026-01-22); the [UN data portal sources list](https://population.un.org/dataportalapi/api/v1/sources) tops out at "World Population Prospects 2024"; OWID metadata: lastUpdated 2024-07-12, nextUpdate 2027-07-12 |
| World Bank WDI | Last updated **2026-10-08**. Latest year: fertility, birth and death rates **2024** (all 261 economies); population, net migration, growth, 65+ share **2025**; migrant stock 2024 | `lastupdated` in every [indicator response](https://api.worldbank.org/v2/country/all/indicator/SP.DYN.TFRT.IN?format=json&per_page=20000&date=2015:2026) |
| UN DESA International Migrant Stock | **IMS 2024** (1990-2024; the page lists only 2020 and 2024 tables). Tables Last-Modified 2025-01-27 / 2025-02-07; OWID copy 2025-03-12 | [UN DESA page](https://www.un.org/development/desa/pd/content/international-migrant-stock), [Key facts (Jan 2025)](https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2025_intlmigstock_2024_key_facts_and_figures_advance-unedited.pdf) |

The constant-fertility scenario: the [Methodology Report](https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf)
says fertility "will remain constant at the level projected for 2024" (table II.4: "Constant as of 2024"), but the
published files hold each country's **2023** estimate constant (all 237 countries and areas; South Korea 0.72). The
API describes it as "fertility stays at its 2023 level".

## Newer national figures (top 30 by risk)

What we show is World Bank 2024 (UN 2023 for Taiwan). A newer year exists for 19 of the 30; bold marks a newer,
comparable value that differs from ours (16 places). "Checked" means
re-read on the publisher's own page or API on 2026-10-28; the rest come from the publisher's documents found by search
(⚑ = news report citing the publisher).

| # | Place | We show | Newest official | Publisher, source | Note |
| ---: | --- | --- | --- | --- | --- |
| 1 | Hong Kong | 0.841 (2024) | **0.733 (2025)** | C&SD [API 115-01011](https://www.censtatd.gov.hk/api/get.php?id=115-01011&lang=en&full_series=1) (checked) | 2024 matches |
| 2 | Ukraine | 0.988 (2024) | none | Ukrstat publishes none; MICS survey 1.1 ⚑ ([Kyiv Post](https://www.kyivpost.com/post/78305)) | survey, not registrations |
| 3 | Taiwan | 0.87 (2023, UN) | **0.695 (2025)**; 0.885 (2024) | Ministry of the Interior ⚑ ([PTS](https://news.pts.org.tw/article/802317)) | biggest gap: two years and 0.18 |
| 4 | Puerto Rico | 0.92 (2024) | 0.871 (2024) | CDC NCHS [NVSR 75-2](https://www.cdc.gov/nchs/data/nvsr/nvsr75/nvsr75-02.pdf) | same year, different source |
| 5 | Belarus | 1.217 (2024) | 1.08 (2024) | Belstat ⚑ ([article](https://thinktanks.pro/publication/2025/10/13/beloruski-rozhayut-menshe-vseh-v-evrope.html)) | Belstat site unreachable |
| 6 | South Korea | 0.748 (2024) | **0.80 (2025, final)** | Ministry of Data and Statistics, [2025 birth statistics](https://mods.go.kr/board.es?mid=a10301010000&bid=204&act=view&list_no=446625), 2026-08-26 (release checked; TFR in its attachment) | births +6.7% |
| 7 | Japan | 1.15 (2024) | **1.14 (2025, provisional)** | MHLW [vital statistics 2025](https://www.mhlw.go.jp/toukei/saikin/hw/jinkou/geppo/nengai25/dl/gaikyouR7.pdf) | final due Nov 2026 |
| 8 | Poland | 1.14 (2024) | **1.068 (2025)** | GUS [Polska w liczbach 2026](https://plwliczbach.stat.gov.pl/pl/assets/pdf/polska-w-liczbach-2026.pdf) | GUS 2024: 1.099 |
| 9 | Bosnia and Herzegovina | 1.492 (2024) | 1.182 (2023) | BHAS, via [ANUBIH paper](https://bastina.anubih.ba/server/api/core/bitstreams/d5bab1c0-ed79-4fc1-b744-0478637a67ac/content) | different population base |
| 10 | Lithuania | 1.11 (2024) | **1.04 (2025)** | [State Data Agency](https://osp.stat.gov.lt/statistiniu-rodikliu-analize?hash=53e99ff0-3b91-422f-a54e-09437d28c305#/) | |
| 11 | China | 1.013 (2024) | none | NBS publishes no annual TFR (last: 1.3, 2020 census) | |
| 12 | Latvia | 1.24 (2024) | **1.16 (2025)** | CSP [API IDK010](https://data.stat.gov.lv/api/v1/en/OSP_PUB/POP/ID/IDK/IDK010) | |
| 13 | Greece | 1.24 (2024) | none for 2025 | [ELSTAT births release](https://www.statistics.gr/documents/20181/884a1fb5-9271-3b2e-fc04-c71a9e9b76c8) has no TFR | |
| 14 | Romania | 1.39 (2024) | 1.19 (2025, provisional) | [INS](https://insse.ro/cms/ro/content/evenimente-demografice-%C3%AEn-anul-2025) | INS uses registered address; not comparable |
| 15 | Italy | 1.18 (2024) | **1.14 (2025)** | [ISTAT, 21 Oct 2026](https://www.istat.it/comunicato-stampa/natalita-e-fecondita-della-popolazione-residente-anno-2025/) (checked) | 2024 matches |
| 16 | North Macedonia | 1.4 (2024) | 1.4 (2025) | [MakStat API](https://makstat.stat.gov.mk/PXWeb/api/v1/en/MakStat/Naselenie/Vitalna/475_VitStat_Reg_StapFert_ml.px) | one decimal |
| 17 | Bulgaria | 1.72 (2024) | **1.63 (2025)** | [NSI](https://www.nsi.bg/en/press-release/population-and-demographic-processes-9002) | |
| 18 | Croatia | 1.46 (2024) | 1.46 (2024) | [DZS API SD812](https://web.dzs.hr/PXWeb/api/v1/hr/Stanovni%C5%A1tvo/Demografski%20pokazatelji/SD812.px) | 2025 due late 2026 |
| 19 | Serbia | 1.64 (2024) | **1.62 (2025)** | [RZS](https://publikacije.stat.gov.rs/G2026/HtmlL/G20261177.html) | |
| 20 | Cuba | 1.445 (2024) | **1.29 (2025)**; ONEI 2024 also 1.29 | ONEI Anuario Demográfico ⚑ ([Diario de Cuba](https://diariodecuba.com/cuba/1784677326_68129.html)) | |
| 21 | Macao | 0.582 (2024) | **0.47 (2025)** | DSEC ⚑ ([Macao News](https://macaonews.org/news/city/macau-birth-rate-2025/)) | |
| 22 | Albania | 1.341 (2024) | 1.21 (2022) | INSTAT ⚑ ([Hashtag.al](https://www.hashtag.al/en/index.php/2025/04/14/okb-parashikon-pergjysmim-te-lindjeve-ne-shqiperi-ne-2024-2054/)) | Eurostat 2024: 1.64 |
| 23 | Estonia | 1.18 (2024) | **1.16 (2025)** | [Statistics Estonia](https://stat.ee/en/news/1360745-people-estonias-population-declined-second-year-row) | |
| 24 | Moldova | 1.726 (2024) | **1.68 (2025, preliminary)** | [NBS Moldova](https://statistica.gov.md/ro/situatia-demografica-in-anul-2025-9696_62504.html) | revised 2024: 1.77 |
| 25 | Czechia | 1.36 (2024) | **1.28 (2025, preliminary)** | [CZSO](https://csu.gov.cz/births) | |
| 26 | Thailand | 1.204 (2024) | none official | Mahidol IPSR estimate 0.86 ⚑ | not an official statistic |
| 27 | Spain | 1.1 (2024) | 1.10 (2024) | [INE API 1478](https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/1478?nult=3) | no 2025 rate yet |
| 28 | Mauritius | 1.44 (2024) | 1.44 (2024) | [Statistics Mauritius](https://statsmauritius.govmu.org/Documents/Statistics/ESI/2026/EI1912/Pop_Vital_Yr25_110326.pdf) | |
| 29 | Malta | 1.01 (2024) | **0.98 (2025)** | [NSO](https://nso.gov.mt/wp-content/uploads/Selected-fertility-indicators_2012-2025.xlsx) | |
| 30 | Russia | 1.418 (2024) | 1.374 (2025, unpublished) | Rosstat data reported by [Vedomosti](https://www.vedomosti.ru/society/articles/2026/01/23/1171174-summarnii-koeffitsient-rozhdaemosti-prodolzhil-snizhatsya) ⚑ | Rosstat withholds data |

Eurostat (`demo_find`, updated 2026-09-30; [API](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_find?indic_de=TOTFERRT&geo=IT))
ends at 2024, and its 2024 values equal ours for all 12 EU members above (checked). It will add 2025 in early 2027
and the World Bank will follow, so most European gaps close by themselves.

**No per-country source was added.** Free, key-less, machine-readable sources exist only for Hong Kong (C&SD API),
Latvia and Estonia (PxWeb). The largest gaps (Taiwan, South Korea, Japan, Macao) have no verified key-free API: Korea's
KOSIS and Japan's e-Stat need registration keys, and Taiwan's open data sits behind a bot check. Adding a national
source would add a fourth `source` id to the API (the schema enum is `WB`, `UN-WPP`, `UN-DESA`) and mix population
bases (see Puerto Rico, Belarus, Romania). Recommended follow-up: a small reviewed override table
(`{iso3, tfr, year, publisher, url}`) for Taiwan, South Korea, Japan, Hong Kong and Macao, labelled with its own
source id.

## Re-run it

```sh
node scripts/validate-data.mjs --cache /tmp/ft-cache              # ~70 MB of downloads the first time; about 30 s
node scripts/validate-data.mjs --cache /tmp/ft-cache --json report.json --examples 20
node scripts/validate-data.mjs --skip age,scenarios,ims           # quicker partial check
```

Exit 0 = no mismatches, 1 = mismatches (each check lists counts, places and examples), 2 = a source could not be
loaded. The weekly workflow runs it after every refresh (reusing the pipeline's downloads). A mismatch blocks a
scheduled or manual run before anything is committed or deployed; an unreachable source only warns. The comparison
code is `scripts/lib/validate.mjs` (unit tests: `test/validate.test.mjs`).
