# Data cross-check: what the UN figures measure, and what other primary sources say

Checked 2026-10-29. [DATA-VALIDATION.md](DATA-VALIDATION.md) shows the site copies the UN files exactly. This note asks
a different question: what do those UN figures measure, what are they based on, and do independent primary sources
agree in 2025-2026? Every claim links to the publisher's own page, file or API. Anything that only a news report
supports is marked **secondary**. Anything no source confirmed is marked **unconfirmed**. The arithmetic is ours and
says so.

## Summary: what holds, what doesn't

**What holds**

- The definitions are applied consistently. UN DESA counts people by **country of birth**, whatever their reason for
  moving or legal status, and includes refugees.
- **US foreign-born.** UN DESA's 52.4M (mid-2024) matches the Census Bureau's ACS 2024 to within 0.2%, once people born
  in Puerto Rico and the US Island Areas are added. UN DESA counts them as migrants; the Census Bureau counts them as
  native-born.
- **Zero-migration scenario.** WPP 2024 publishes one (VarID 7) in both the population file and an "other variants"
  demographic indicators file.
- **Medium-scenario migration** is probabilistic (new in WPP 2024). It is the median of 2,000 Bayesian trajectories,
  adjusted by expert judgement. It is neither held at recent levels nor tapered to zero.

**What doesn't**

- **Ukraine's 5.06M immigrants (13.4%) is not a 2024 measurement.**
  - Ukraine was not among the 60 countries UN DESA reassessed for 2024. Its figure extrapolates the 2020 edition.
  - The mix of countries of birth is the 2001 census mix, scaled. This is our derivation; UN DESA names no source.
  - 67% of the stock was born in Russia. UN DESA documents that people who moved inside the USSR became
    "international migrants" overnight in 1991 without moving.
- **Ukraine's projected growth (37.9M in 2024 to 39.5M in 2026) rests on one assumption.** The UN assumed two thirds
  of refugees would return by 2026: +2.85M net migration in 2024-2025. No primary source shows that return:
  - Ukrainians under temporary protection in the EU **rose** to 4.36M (August 2026).
  - UNHCR recorded 5.88M refugees from Ukraine worldwide (November 2025).
  - UNHCR recorded only 0.35M refugee returns in 2024-2025.
  - Ukraine's statistics office has published no population estimate since 1 January 2022 (41.2M, excluding Crimea).
    Reported joint estimates by the statistics office and the national demography institute put government-controlled
    territory at about 29M in mid-2026 (**secondary**).
- **US net migration.** The UN's +1.18M for 2026 is 2x CBO's projection (0.57M) and 3.7x the Census Bureau's
  short-term projection (about 0.32M for the year to July 2026). The UN's 2023 *estimate* (+1.32M) is also far below
  the Census Bureau's Vintage 2025 estimates (2.26M and 2.73M for the years to June 2023 and June 2024) and CBO's 3.5M.
- **UK foreign-born.** UN DESA's 11.85M (17.1%) is about 1.3M below ONS's newest official estimate: 13.1M non-UK-born
  at June 2024 (18.9%). The 4.8M UK-born abroad has no UK official counterpart (**unconfirmed**).

---

## 1. UN DESA International Migrant Stock 2024: Ukraine's source, and Soviet-era moves

### What the site shows, and the UN rows behind it

- `undesa_pd_2024_ims_stock_by_sex_and_destination.xlsx`, sheet "Table 1", row `Ukraine*`:
  - Data type `B`.
  - 1990: 6,892,920 · 2000: 5,527,087 · 2010: 4,818,767 · 2020: 4,997,387 · **2024: 5,064,173**.
  - File: <https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_and_destination.xlsx>
- What the data-type codes mean (same file, sheet "Migrant notes"): "B, which indicates that estimates were derived from
  data on the foreign-born population; C, … foreign citizens; R, which indicates that the number of refugees or persons
  in refugee-like situations, asylum seekers … as reported by the Office of the United Nations High Commissioner for
  Refugees (UNHCR) … were added to the estimates, and I … imputed." Ukraine has no `R`.
- The 13.4% share uses the WPP population, 37,860,221 (sheet "Table 2"). Its population note reads "Including Crimea".

### Ukraine was not reassessed in 2024: its figure extrapolates the 2020 edition

UN DESA, *International Migrant Stock 2024: Key facts and figures* (advance unedited, January 2025), printed p. 1 (PDF
p. 5), <https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2025_intlmigstock_2024_key_facts_and_figures_advance-unedited.pdf>:

> "In the new edition of these data, a total of 60 countries and areas received a full reassessment of trends in the
> number of international migrants residing in the territory. For the remaining countries and areas, the estimates
> generated in 2024 reflect extrapolations of estimates published in the 2020 edition of the dataset."

- **Ukraine is not in that list** (footnote 3, same page). Russian Federation, Poland, Germany, Czechia, Republic of
  Moldova, United Kingdom and United States of America are.
- The 2024 file repeats the 2020 edition's 1990-2020 Ukraine values. 2024 is 2020 × 1.0134.
- The documentation has no per-country source annex. The landing page's only documentation link is the Key facts PDF:
  <https://www.un.org/development/desa/pd/content/international-migrant-stock>. The 2020 methodology report
  (<https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2020_international_migrant_stock_documentation.pdf>)
  has no country-by-country source table either.

### The underlying source is almost certainly the 2001 census, scaled (our derivation)

**UN DESA does not name Ukraine's source or reference year. Unconfirmed from UN DESA text.** The evidence:

- The UN Statistics Division's Demographic Statistics Database, table 44 ("Foreign-born population by country/area of
  birth"), has one Ukraine source only: the 2001 census.
  <https://data.un.org/Data.aspx?d=POP&f=tableCode%3a44%3bcountryCode%3a804>
- Its counts by country of birth: Russian Federation 3,613,240; Belarus 270,751; Kazakhstan 245,072; Uzbekistan 242,390;
  Republic of Moldova 165,126.
- The 2024 corridors on the site are those same counts times one common factor:

  | Origin | IMS 2024 (site) | 2001 census | Ratio |
  | --- | ---: | ---: | ---: |
  | Russian Federation | 3,375,095 | 3,613,240 | 0.9341 |
  | Belarus | 252,977 | 270,751 | 0.9344 |
  | Kazakhstan | 228,982 | 245,072 | 0.9344 |
  | Uzbekistan | 226,478 | 242,390 | 0.9344 |
  | Republic of Moldova | 154,284 | 165,126 | 0.9343 |

- So the composition is the 5 December 2001 census, scaled, and the total is carried forward through the 2020 edition.
- The census publication itself: <http://2001.ukrcensus.gov.ua/eng/publications/>.
- The 1990 figure rests on the 1989 USSR census. UN DESA, *Trends in International Migrant Stock: The 2008 Revision*,
  p. 1, footnote 1: "The estimates presented in this report backdate the effect of the disintegration of the USSR to
  1990 and the estimates for that date are based on the 1989 census of the USSR."
  - The original URL now returns 404. Archived copy:
    <https://web.archive.org/web/2019id_/https://www.un.org/en/development/desa/population/publications/pdf/migration/mig-stock.pdf>

### People who moved inside the USSR, Yugoslavia or Czechoslovakia count as international migrants

The UN DESA *2008 Revision* documentation (archived link above) states this explicitly.

p. 1, footnote 1:

> "the 1991 disintegration of the former Union of Soviet Socialist Republics (USSR), which led to the creation of 15
> independent States and resulted in the reclassification of millions of persons who had been internal migrants within
> the USSR into international migrants because their place of birth became part of a different country."

pp. 4-5, section II.A:

> "the largest discontinuity stems from the disintegration of the former Union of Soviet Socialist Republics (USSR) in
> 1991 and, to a lesser extent, from those of the former Yugoslavia (starting in 1992 and continuing until 2006 when
> Serbia and Montenegro separated), and the former Czechoslovakia (1993). For purposes of estimation the changes in
> state configurations occurring in the early 1990s were backdated to mid-year 1990."

> "Because an international migrant is equated with a person who was born outside the country in which he or she
> resides, when a country disintegrates, persons who had been internal migrants because they had moved from one part
> of the country to another may become, overnight, international migrants without having moved at that time. Such
> changes introduce artificial but unavoidable discontinuities in the trend of the international migrant stock."

- The same wording is live today in the World Bank's metadata for its copy of the series (SM.POP.TOTL, field
  "Limitationsandexceptions"):
  <https://api.worldbank.org/v2/sources/2/series/SM.POP.TOTL/metadata?format=json>
- No 2020 or 2024 UN DESA text restates it (**unconfirmed** for the current edition). The place-of-birth rule still
  applies in 2024: Ukraine is coded `B`, and Russia-born residents are 3.38M of 5.06M (67%).

### Ukraine 2022-2024

- UN DESA gives no note on Ukraine as a destination (occupied territory, refugee departures). Its only mention (Key
  facts, printed p. 2): "The pace of growth of Europe's international migrant stock increased since 2020, due largely
  to refugee flows from Ukraine."
- **On the emigrant side, Ukrainian refugees are added in host countries.** In the 2024 file these hosts are coded
  `B R` (UNHCR refugee counts added): Russian Federation, Germany, Poland, Czechia, United Kingdom.
  - That is why the site's 9.77M Ukraine-born abroad includes 1.42M in Germany and 1.10M in Poland.
  - Russia's 2.87M Ukraine-born is mostly the same Soviet-era reclassification, plus UNHCR's refugee count for Russia.
  - The 2020 methodology report (printed pp. 4-5) said that for "countries in more developed regions … no such
    adjustment was made". The 2024 codes show that rule was dropped for these hosts. UN DESA doesn't explain the change.

### How UN DESA defines a migrant

Key facts, printed p. 1, footnote 1:

> "To be considered an international migrant, a person must have moved across an international border and changed his
> or her country of residence. In addition, a threshold, usually of 12 months, is used … The statistical definition of
> an international migrant makes no reference to the reason for migration or to the legal immigration status of persons
> changing their country of residence. … When data on country of birth are available, they are given precedence …"

- Refugees are included. World Bank definition of the same series: "the number of people at mid-year born in a country
  other than that in which they live. It also includes refugees."
- Unauthorized migrants: no UN DESA text includes or excludes them. They are in the stock only as far as the national
  census or survey counts them (**unconfirmed** beyond the "legal immigration status" sentence).

---

## 2. Ukraine: why the UN projects growth in 2024-2026, and what independent sources show

### The UN's numbers (WPP 2024 medium)

From `WPP2024_Demographic_Indicators_Medium.csv.gz`
(<https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz>):

| Year | Population 1 Jan | Population 1 Jul | Net migration | Natural change |
| --- | ---: | ---: | ---: | ---: |
| 2022 (estimate) | 44,073,121 | 41,048,766 | −5,699,445 | −349,259 |
| 2023 (estimate) | 38,024,411 | 37,732,836 | −299,961 | −283,190 |
| 2024 | 37,441,260 | 37,860,221 | **+1,146,012** | −308,085 |
| 2025 | 38,279,183 | 38,980,376 | **+1,702,358** | −299,980 |
| 2026 | 39,681,570 | 39,535,849 | −6,229 | −285,208 |
| 2027 | 39,390,127 | 39,245,209 | −796 | −289,037 |

- 1 July values are from `WPP2024_TotalPopulationBySex.csv.gz`, as on the site. The indicators file rounds some of
  them 1 person differently.
- The growth comes entirely from +2.85M net migration in 2024-2025. Natural change is about −0.3M a year throughout.
- Under the UN's own **zero-migration** scenario, Ukraine's population on 1 July 2026 is **36,662,145**, not
  39,535,849 (see section 6).
- The population includes Crimea. `WPP2024_Locations_notes.csv`, note 15: "Including Crimea."
  <https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Locations_notes.csv>
- The World Bank's 2025 Ukraine population (38,980,376) and net migration (1,702,358) are this UN projection
  republished, not an independent figure. Its metadata lists "World Population Prospects" as the first source.
  <https://api.worldbank.org/v2/country/UKR/indicator/SP.POP.TOTL?format=json&date=2022:2025>

### The assumption, in the UN's words: two thirds of refugees return by 2026

*World Population Prospects 2024: Methodology of the United Nations Population Estimates and Projections*,
<https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf>. Printed page numbers; the PDF page
is the printed page + 9.

Section II.E.1, step 3, printed p. 48:

> "To address the challenges with the set of countries experiencing recent large movements of net international
> migrants or refugees, expert knowledge was used to define the expected target years when the situation in these
> locations is expected to return to some baseline level (Table II.3.B), and for a subset of those that experienced
> large in/outflow of recent refugees what proportions of refugees are expected to return to their country of origin
> by the target year. For each of these cases, some linearly interpolated values were estimated between the 2023
> baseline and the expected median value for the user-defined target year."

Table II.3, "Countries for which adjustments were made to the default migration projection trajectory in the 2024
Revision":

- Printed p. 48, part A, "Countries with user-defined reference periods": "Ukraine 2000-2021".
- Printed p. 49, part B, "Countries with user-defined target year to return to baseline net migration level": "Ukraine |
  Target year 2026 | Return of refugees 2/3".
  - The same 2026, 2/3 entry appears for the main host countries: Poland, Czechia, Germany, Republic of Moldova,
    Russian Federation, Slovakia, and others.

Footnote 75, printed p. 48:

> "As noted by […] (2019; 2017), the median duration of exile at the end-2018 stands at 5 years, i.e. half of the
> refugees worldwide have spent 5 years or less in exile. … Recent statistical analysis for 35 countries with ongoing
> refugee crises by […] (2024) also validates the projection assumption that two thirds of refugees will return to
> their country of origin within 5 years."

(Authors' names are elided here; they are in the report.)

What the UN based Ukraine's past migration on: *WPP 2024 Data Sources*, printed p. 261,
<https://population.un.org/wpp/assets/Excel%20Files/4_Metadata/WPP2024_Data_Sources.pdf>:

> "Population: … consistent with the population by age and sex of the (a) 1959, 1970, 1979, 1989, 2001 censuses; …
> (d) official estimates through 2022 …"

> "Migration: International migration based on: (a) information on foreign-born populations from censuses and
> registers from major countries of destination; (b) estimates derived as the differences between overall population
> growth and natural increase; (c) UNHCR statistics on the number of refugees in the main countries of asylum."

The methodology report (printed p. 22) lists Ukraine among the 23 countries whose "most recent available census data
were from before 2009": "Ukraine (2001)".

The *WPP 2024 Summary of Results* has no Ukraine-specific migration text. No UN Population Division statement since
then revises the assumption (**none found**).

### Independent sources: refugees abroad (2025-2026)

**Eurostat, beneficiaries of temporary protection at month end, Ukrainian citizens, EU-27** (dataset `migr_asytpsm`,
updated 2026-10-26):
<https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/migr_asytpsm?format=JSON&lang=EN&citizen=UA&geo=EU27_2020&sex=T&age=TOTAL&lastTimePeriod=4>

| End of month | People |
| --- | ---: |
| Dec 2022 | 3,749,330 |
| Dec 2023 | 4,203,725 |
| Dec 2024 | 4,186,410 |
| Jun 2025 | 4,117,735 (Eurostat flags a break in series) |
| Dec 2025 | 4,284,385 |
| **Aug 2026** | **4,363,955** |

**UNHCR, "Demographics and places of origin of refugees from Ukraine: UNHCR estimates (Nov-2025)"** (xlsx, published 30
November 2025): <https://data.unhcr.org/en/documents/details/121051>

- "As per available data as of 12 November 2025".
- Refugees from Ukraine recorded worldwide: **5,881,610**. Europe 5,332,520; rest of the world 549,090.
- Largest hosts: Germany 1,314,160 · Poland 1,011,520 · Czechia 397,290 · United Kingdom 263,750 · Spain 250,800.
- Source note: "UNHCR collation of statistics made available by national authorities."

**UNHCR Refugee Data Finder API, country of origin Ukraine** (annual figures):
<https://api.unhcr.org/population/v1/population/?year=2025&coo=UKR>

| Year | Refugees | Returned refugees | Internally displaced | Of the refugees, in Russia |
| --- | ---: | ---: | ---: | ---: |
| 2022 | 5,684,177 | 660,000 | 5,914,000 | 1,275,315 |
| 2023 | 5,960,362 | 399,050 | 3,689,000 | 1,227,554 |
| 2024 | 5,120,036 | 209,064 | 3,665,000 | 6,894 |
| 2025 | 5,224,131 | 139,251 | 3,712,000 | 5,488 |

- The Russia figures come from the same API with `coa_all=true`.
- The fall from 2023 to 2024 is a change in Russia's count (1.23M to 7k), not returns. The reason is **unconfirmed**.
  Excluding Russia, refugees from Ukraine rose every year: 4.41M, 4.73M, 5.11M, 5.22M.
- UNHCR recorded **348,315** refugee returns in 2024-2025 combined. The UN projection assumed +2.85M net migration in
  the same two years.
- The API response doesn't state its reference date. We read the 2025 row as UNHCR's end-2025 figure
  (**unconfirmed**; the Refugee Data Finder page blocks automated access).

### Independent sources: Ukraine's actual population

- **State Statistics Service of Ukraine (primary): no estimate after 1 January 2022.** Its publication list,
  "Чисельність наявного населення України", ends with the 1 January 2022 edition:
  <https://stat.gov.ua/uk/publications/chyselnist-nayavnoho-naselennya-ukrayiny>. That edition
  (<https://stat.gov.ua/sites/default/files/2026-09/zb_chnas_22.pdf>, p. 4, and the table on p. 7) gives a present
  population of **41,167,335**: "Data on the population of Ukraine as of January 1, 2022 are given excluding the
  temporarily occupied territory of the Autonomous Republic of Crimea and the city of Sevastopol."
- **Joint estimate by the statistics office and the Ptoukha Institute of Demography: about 29M (±0.3M) in
  government-controlled territory, mid-2026 (secondary).** Interfax-Ukraine, 20 July 2026, quoting the institute's
  director: <https://en.interfax.com.ua/news/general/1186657.html>.
  - The estimate starts from three mobile operators' data and is checked against registers: pension and tax, migration
    service, the justice ministry's demographic register, the school register, eHealth.
  - We found no publication of it on the statistics office's or the institute's own sites (**unconfirmed** from a
    primary source).
  - Later press reports cite 28.5M at 1 July 2026; we could not trace that to a primary source (**unconfirmed**).
- **Ptoukha Institute, July 2024: 35.8M including 31.1M in government-controlled territory (secondary).** Cited by the
  Kyiv School of Economics, *Ukraine Human Capital Chartbook*, May 2025:
  <https://kse.ua/wp-content/uploads/2025/05/Ukraine-Human-Capital-Chartbook-2025.pdf>. The UN's figure for 1 July
  2024 is 37.86M, about 2M higher.

The UN figure covers all of Ukraine within its internationally recognised borders, occupied areas included. The 29M
covers government-controlled territory only, so the two are not directly comparable. No primary source estimates the
population of the occupied areas.

---

## 3. USA: net international migration

| Period | UN WPP 2024 (calendar year) | Census Bureau Vintage 2025 (year to 30 June) | CBO, Jan 2026 (calendar year) |
| --- | ---: | ---: | ---: |
| 2023 | +1,322,668 (estimate) | +2,264,137 (Jul 2022-Jun 2023) | +3.501M |
| 2024 | +1,286,132 | +2,734,468 (Jul 2023-Jun 2024) | +2.273M |
| 2025 | +1,230,663 | **+1,262,202** (Jul 2024-Jun 2025) | **+0.408M** |
| 2026 | **+1,177,848** | **≈ +321,000** projected (to Jul 2026) | **+0.574M** |
| 2027 | +1,174,683 | n/a | **+0.694M** |

### Census Bureau, Vintage 2025

Press release, 27 January 2026:
<https://www.census.gov/newsroom/press-releases/2026/population-growth-slows.html>

> "Between July 1, 2024, and June 30, 2025, net international migration was 1.3 million, a notable drop from 2.7
> million the year before (a decline of 53.8%). If current trends continue, net international migration is projected
> to be approximately 321,000 by July 2026, representing another decline of nearly 1 million since July 1, 2025."

- The exact values are from the national row of `NST-EST2025-ALLDATA.csv`, columns `INTERNATIONALMIG2023-2025`:
  <https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv>.
  - Vintage 2024 had 2,294,299 and 2,786,119 for the first two periods.
  - The release warns: "year-to-year comparisons in the estimates should only be done within the same vintage."
- What NIM covers (file layout, p. 4): "(a) the net international migration of the non-U.S. born, (b) the net migration
  of U.S. born to and from the United States, (c) the net migration between the United States and Puerto Rico, and (d)
  the net movement of the Armed Forces population".
- How the 2026 figure was made (Census blog, 27 January 2026,
  <https://www.census.gov/newsroom/blogs/random-samplings/2026/01/historic-decline-in-net-international-migration.html>):
  - "Historically, we have held the last year of observed NIM data constant for the projection period … the projected
    NIM would have been too high."
  - "it was assumed that the 2025 estimate [of emigration] would double in 2026"
  - "Currently, the estimates of NIM are trending toward negative net migration."

### CBO, *The Demographic Outlook: 2026 to 2056* (7 January 2026)

Still the latest edition. Report page <https://www.cbo.gov/publication/61879>, PDF
<https://www.cbo.gov/system/files/2026-01/61879-Demographic-Outlook.pdf>, data
<https://www.cbo.gov/system/files/2026-01/61879-Data.xlsx>.

p. 10:

> "CBO now projects net immigration of 410,000 people (instead of 2.0 million) in 2025, 570,000 (instead of 1.6
> million) in 2026, a total of 2.9 million (instead of 3.2 million) from 2028 to 2030, and 1.2 million (instead of 1.1
> million) in 2035."

p. 7:

> "In 2025, net immigration of other foreign nationals turned negative, CBO estimates: 360,000 more people in that
> category left the country than arrived."

- Breakdown (data file, Figures 7-8), millions:

  | Year | LPR+ | INA nonimmigrants | Other foreign nationals |
  | --- | ---: | ---: | ---: |
  | 2025 | 0.871 | −0.099 | −0.365 |
  | 2026 | 0.874 | 0.028 | −0.328 |
  | 2027 | 0.877 | 0.152 | −0.335 |

- "Other foreign nationals" "includes people who entered the United States illegally and people who were allowed to
  enter through the use of parole authority" (p. 6).
- On 12 June 2026 CBO reposted the projections file to correct certain values (note on the report page).
- cbo.gov blocks automated fetches. The report was read in a browser, and the p. 10 sentence was confirmed by a
  cbo.gov-restricted search.

### Comparison

- **2026:** the UN's +1.18M is 2.1x CBO's 0.57M and 3.7x the Census Bureau's ≈0.32M.
- **2023:** the UN's +1.32M *estimate* is 42-52% below the Census Bureau's Vintage 2025 estimates and 62% below CBO's.
- **2025:** the UN's +1.23M for calendar 2025 is close to the Census figure for July 2024-June 2025 (+1.26M). Both US
  agencies show a steep fall during 2025, which the UN projection doesn't have.
- The UN's 2023 figure predates the Census Bureau's upward revision: Vintage 2024, released December 2024, came after
  WPP 2024 (July 2024). This is our reading of the dates, not a UN statement.
- The site's headline US net migration (World Bank, 2025, 1,230,663) is the UN projection republished.

---

## 4. USA: foreign-born population

| Source | Reference date | Foreign-born | Notes |
| --- | --- | ---: | --- |
| UN DESA IMS 2024 | mid-2024 | 52,375,047 | Includes people born in Puerto Rico and the US Island Areas |
| ACS 2024 1-year, B05002 | 2024 | 50,234,858 ± 162,664 | Released 11 Sep 2025. Puerto Rico-born 1,852,356 and Island Areas-born 187,475 counted as native |
| ACS 2025 1-year, B05002 | 2025 | 50,409,320 ± 204,810 | Released 29 Oct 2026 (scheduled date in release CB26-164). Non-citizens down to 23,230,747 from 24,396,883 |
| CPS ASEC 2025, Table 1 (first generation) | March 2025 | 53,120,000 ± 793,500 (15.7%) | CPS ASEC 2024: 51,280,000. Civilian noninstitutionalized universe |

Sources:

- ACS release pages:
  - <https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release.html>
  - <https://www.census.gov/newsroom/press-releases/2026/dates-announced-for-2025-acs-1-year-estimates.html>
- Variable labels: <https://api.census.gov/data/2024/acs/acs1/groups/B05002.json>
- CPS ASEC table:
  <https://www2.census.gov/programs-surveys/demo/tables/foreign-born/2025/cps2025/2025_asec_generation_table1.xlsx>
- Monthly CPS, from the Census blog above: the foreign-born population "declined from 53.3 million in January 2025 to
  51.9 million in June 2025". Census cautions that this "can also reflect survey non-response, coverage error or the
  impact of population controls."

**Reconciliation (our arithmetic):** ACS 2024 foreign-born + Puerto Rico-born + Island Areas-born = 52,274,689. That is
within 100,358 (0.2%) of UN DESA's 52,375,047.

**UN DESA's US definition.** IMS 2024 by-destination file, US row:

- Data type `B` (foreign-born data). Not `R`: no UNHCR refugee counts were added.
- Note 36: "For statistical purposes, the international migrant population includes persons born in Puerto Rico, Guam,
  Northern Mariana Islands, and the United States Virgin Islands."
- The US was one of the 60 countries fully reassessed in 2024. Which ACS year UN DESA used is **unconfirmed**.

**Unauthorized immigrants and refugees.** Census definition of foreign-born
(<https://www.census.gov/topics/population/foreign-born/about.html>):

> "anyone who is not a U.S. citizen at birth. This includes naturalized U.S. citizens, lawful permanent residents
> (immigrants), temporary migrants (such as foreign students), humanitarian migrants (such as refugees and asylees),
> and unauthorized migrants. … unauthorized migrants are included in Census Bureau estimates of the total foreign-born
> population. However, it is not possible to tabulate separate estimates…"

UN DESA's definition "makes no reference to … legal immigration status" (section 1). Since its US figure is built from
Census foreign-born data, it includes unauthorized immigrants and refugees to the extent the ACS counts them.

---

## 5. WPP 2024: how future migration is projected in the medium scenario

**It is probabilistic, new in the 2024 revision.** Methodology report, printed p. 47 (PDF p. 56), section II.E.1:

> "For the first time, the medium variant of net international migration in the 2024 revision was projected using
> probabilistic methods developed by […] (2015; 2016), and adapted to use annual time series … A Bayesian hierarchical
> approach was used to model future trajectories of the crude net migration rate around the world based on historical
> experience across countries and to account for uncertainties and correlations across countries and over time."

> "1. Using the annual estimates of crude net migration rates from 1950 to 2023 for all countries from the 2024
> revision, a Bayesian hierarchical first-order autoregressive model, or AR(1), was fitted to crude net migration rate
> data for all countries …"

**It reverts toward each country's long-run mean, with expert overrides.** Printed p. 48:

> "(1) the country-specific overall rate of change and long-term mean net migration rate are influenced by the
> reference period used to fit the model, which might need to be adjusted depending on the country's historical context
> (e.g., conflicts or political and economic changes), and (2) the short-term and long-term projections are highly
> influenced by the most recent situation (e.g., countries experiencing large in/out flows of migrants or refugees in
> 2023). Expert knowledge was incorporated …"

- Overrides: user-defined reference periods (Table II.3.A), return-to-baseline target years with refugee-return shares
  (II.3.B), and user-defined long-run rates for 32 countries (II.3.C, printed pp. 49-50).
- Caps on cumulative and annual migration for six Gulf states (steps 6 and 9).
- Global balancing so that net migration sums to zero every year (step 9, printed p. 51).

**The medium scenario is the median of 2,000 trajectories.** Step 10, printed p. 52:

> "The 2,000 adjusted and balanced trajectories of total net migration counts … were also used to generate the median
> projected values for each country that were used for the medium deterministic scenario of the 2024 revision (after
> applying an additional rebalancing step …)."

Table II.4 footnote, printed p. 55: "Based on the mean probabilistic projections for fertility and mortality, and
median probabilistic projections for net migration."

The *Definition of Projection Scenarios* page says the same:
<https://population.un.org/wpp/definition-of-projection-scenarios>. This is a JavaScript page that returns 404 to
non-browser clients; we read its text from the site's own bundle.

> "Medium scenario projection: In projecting future levels of fertility, mortality and international migration,
> probabilistic methods were used to reflect the uncertainty of the projections based on the historical variability of
> changes in each variable. … The medium scenario projection corresponds to the mean fertility and mortality and median
> net migration of several thousand distinct trajectories of each demographic component derived using the
> probabilistic model of the variability in changes over time."

**Neither constant nor tapering to zero.** The report states no taper-to-zero or hold-constant rule. In the published
medium series (our arithmetic, net migrants per 1,000 people), each country drifts toward its own long-run level:

| Country | 2023 | 2026 | 2050 | 2100 |
| --- | ---: | ---: | ---: | ---: |
| USA | 3.85 | 3.37 | 3.35 | 2.91 |
| UK | 6.49 | 5.21 | 2.60 | 1.31 |
| Canada | 11.04 | 7.20 | 5.74 | 5.25 |
| Ukraine | −7.95 | −0.16 | −0.08 | −0.04 |

- Ukraine's long-run level comes from its 2000-2021 reference period (near zero), after the assumed 2024-2025 return.
- The report's own caveat (printed p. 47): "Any long-range assumption regarding future trends in international migration
  is virtually guaranteed to prove incorrect."

---

## 6. WPP 2024: zero-migration scenario files

**Yes, `WPP2024_TotalPopulationBySex.csv.gz` includes a zero-migration scenario.**
<https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_TotalPopulationBySex.csv.gz>
(16,980,593 bytes, last-modified 13 Dec 2024)

We streamed the whole file (curl | gunzip | Python csv) and counted distinct `VarID` / `Variant` values:

| VarID | Variant | Rows | Years |
| ---: | --- | ---: | --- |
| 2 | Medium | 83,805 | 1950-2100 |
| 3 | High | 42,735 | 2024-2100 |
| 4 | Low | 42,735 | 2024-2100 |
| 5 | Constant fertility | 42,735 | 2024-2100 |
| 6 | Instant replacement | 42,735 | 2024-2100 |
| **7** | **Zero migration** | 42,735 | 2024-2100 |
| 8 | Constant mortality | 42,735 | 2024-2100 |
| 9 | No change | 42,735 | 2024-2100 |
| 10 | Momentum | 42,735 | 2024-2100 |
| 16 | Instant replacement zero migration | 42,735 | 2024-2100 |
| 17 | No fertility below age 18 | 42,735 | 2024-2100 |
| 18 | Accelerated ABR decline | 42,735 | 2024-2100 |
| 19 | Accelarated ABR decline w/rec. (sic) | 42,735 | 2024-2100 |
| 202 | Median PI | 24,717 | 2024-2100 |
| 203 | Upper 80 PI | 24,717 | 2024-2100 |
| 204 | Lower 80 PI | 24,717 | 2024-2100 |
| 206 | Upper 95 PI | 24,717 | 2024-2100 |
| 207 | Lower 95 PI | 24,717 | 2024-2100 |

Methodology report, Table II.4 (printed p. 55): "Zero-migration | Medium | Medium | Zero from 2024" (fertility,
mortality, international migration). Printed p. 55: "the zero-migration scenario differs from the medium scenario only
with respect to the underlying assumption regarding international migration."

**No separate demographic indicators file per variant.** Names such as `..._Zero_migration.csv.gz`, `..._Low.csv.gz`
and `..._Momentum.csv.gz` return 404. All non-medium variants are in one file:

- `WPP2024_Demographic_Indicators_OtherVariants.csv.gz`, 75,342,445 bytes, last-modified 13 Dec 2024:
  <https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_OtherVariants.csv.gz>
- It has the same 17 non-medium variants (Zero migration = VarID 7, 43,290 rows), plus VarID 208 "Mean". VarID 19 is
  labelled "Accelerated ABR decline with rec" here.
- 67 columns, including `TPopulation1July` and `NetMigrations`.
- The medium variant stays in `WPP2024_Demographic_Indicators_Medium.csv.gz`.
- The scenarios page adds that Excel users get these scenarios "as extra worksheets in each workbook file".

Zero migration against medium, 1 July population:

| Country | 2026 zero migration | 2026 medium | 2050 zero migration | 2050 medium |
| --- | ---: | ---: | ---: | ---: |
| Ukraine | 36,662,145 | 39,535,849 | 28,899,928 | 31,990,132 |
| USA | 345,891,127 | 349,035,494 | 339,286,296 | 380,846,910 |
| UK | 68,929,596 | 69,931,528 | 66,092,035 | 75,504,681 |

---

## 7. UK: foreign-born population

| Source | Reference date | Born outside the UK | Share |
| --- | --- | ---: | ---: |
| UN DESA IMS 2024 | mid-2024 | 11,845,479 | 17.1% |
| Census 2021 England & Wales | 21 Mar 2021 | 10,017,972 | 16.8% |
| Scotland's Census 2022 | 20 Mar 2022 | 554,900 | 10.2% |
| NI Census 2021 | 21 Mar 2021 | 164,700 | 8.7% |
| **Census sum, UK (mixed dates)** | 2021/2022 | **≈ 10.74M** | ≈ 16.0% |
| ONS rolled-forward estimate | 30 Jun 2022 | 11,457,000 | |
| ONS rolled-forward estimate | 30 Jun 2023 | 12,411,000 | |
| **ONS rolled-forward estimate** | **30 Jun 2024** | **13,115,000** | **18.9%** (of 69,281,400) |
| ONS APS ad hoc table 3063 | Jan-Dec 2024 | 10,574,485 | 15.7% (ONS: use with caution) |

Census sources:

- **England & Wales.** ONS, *International migration, England and Wales: Census 2021*, 2 November 2022: "10.0 million
  (16.8%) were born outside the UK."
  <https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/internationalmigration/bulletins/internationalmigrationenglandandwales/census2021>
  - The exact count is from Nomis TS004:
    <https://www.nomisweb.co.uk/api/v01/dataset/NM_2024_1.data.csv?geography=K04000001&measures=20100>
- **Scotland.** NRS, *Scotland's Census 2022: Demography and migration*, 1 August 2024: "A further half a million were
  born outside of the UK (554,900)."
  <https://www.scotlandscensus.gov.uk/2022-reports/scotland-s-census-2022-demography-and-migration/>
  - The share is from the ethnic group, national identity, language and religion report: "The percentage of people born
    outside the UK increased from 7.0% to 10.2% between 2011 and 2022."
- **Northern Ireland.** NISRA, Census 2021 country of birth bulletin, 22 September 2022: "40,400 in the Republic of
  Ireland and 124,300 outside UK and Ireland."
  <https://www.nisra.gov.uk/system/files/statistics/census-2021-main-statistics-for-northern-ireland-phase-1-statistical-bulletin-country-of-birth.pdf>

ONS's newest figure: *Long-term international migration, provisional: year ending December 2025*, 21 May 2026, Table 3:
<https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/internationalmigration/bulletins/longterminternationalmigrationprovisional/yearendingdecember2025>

> "between June 2022 and June 2024 the: non-UK-born population increased from 11.5 to 13.1 million"

- Status: "These estimates are official statistics in development and are provisional". There is no June 2025 figure.
- Method: Census 2021/2022 baseline, minus deaths of the non-UK-born, plus non-UK nationals' immigration, minus their
  emigration.
- Same bulletin, for context: net migration was 171,000 in the year to December 2025, "nearly halved" from 331,000. The
  peak was 944,000 in the year to March 2023.

The annual APS-based series "Population of the UK by country of birth and nationality" was "Discontinued after June
2021". Its last estimate was 9.6M for the year ending June 2021.
<https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/internationalmigration/datasets/populationoftheunitedkingdombycountryofbirthandnationality>

**What UN DESA's UK figure is:**

- IMS 2024 by-destination file, UK row: data type `B R` (foreign-born data plus UNHCR refugee counts).
- Note 14: "the international migrant population includes persons born in Anguilla, Bermuda, British Virgin Islands,
  Cayman Islands, Channel Islands, Falkland Islands (Malvinas), Gibraltar, Isle of Man, Montserrat, Saint Helena, and
  Turks and Caicos Islands."
- The UK was fully reassessed for 2024 (its 2020 value was revised from 9,359,587 to 10,520,870). Which source and
  year UN DESA used is **unconfirmed**.
- Our reading, not a publisher's statement: UN DESA's 11.85M sits between the census baseline and ONS's June 2024
  figure. It does not appear to capture the full 2022-2024 rise.

**UK-born abroad (4.8M):** ONS, NRS and NISRA publish no count of UK-born people living abroad. There is no UK primary
source to check it against (**unconfirmed**).
