# Fertility Tracker

Live fertility rates (births per woman) for every country, plus a plain-language view of what today's rate means
over a few generations: start with 100 people, and at a fertility rate of 1.14 each generation is about 54% the size of
the last (1.14 ÷ 2.1 replacement), so 100 → 54 → 29 → 16 → 9.

**Live:** https://fertility-tracker-live.vercel.app/ (shareable per country, e.g. `/country/KOR`, `/country/JPN`; rankings at `/rankings`)

## What's in it

- Full-screen globe (drag, wheel/pinch zoom) colored by how fast each country is growing or shrinking in the slider
  year (its average yearly change over the 5 years before), with a year slider from 1950 (UN estimates) to 2100 and two
  futures: the UN forecast, and "if birth rates stay the same" (UN constant fertility). Play from the end starts at 2000
- Country pages (`/country/KOR`): a plain-words risk meter, 100 people who gray out as the year moves, population
  1950–2100 under both futures, "Births, deaths, immigration" (births and deaths, then net migration, for the slider
  year or added up from now to it, so you can see whether moving in holds a place up), immigration (people born abroad
  and born here living abroad, plus net migration each year 1990–2100, counted and forecast), and generations with a
  what-if slider. The population chart moves the year only on press and drag
- Where each number comes from: press any underlined number (or a migration row) for what it counts, its year,
  whether it was counted or forecast, the publisher's file and the same number in the API. Where newer or independent
  counts differ a lot (Ukraine's assumed refugee return, US net migration, UK born abroad), the page says so with links:
  [docs/DATA-CROSS-CHECK.md](docs/DATA-CROSS-CHECK.md)
- How sure is this: every country page grades its numbers (solid, partly estimated, mostly estimated) on four
  things: when it was last counted, whether births and deaths are registered, how people born abroad were counted,
  and how wide the UN's own forecast range is (also shaded on the chart). It lists newer national figures next to
  the UN's: Eurostat and the UN Statistics Division automatically for every country, plus hand-checked notes. Sources
  and rules: [docs/METHODOLOGY.md](docs/METHODOLOGY.md#how-sure-is-each-number); keeping it current:
  [docs/CROSS-CHECK-PROCESS.md](docs/CROSS-CHECK-PROCESS.md)
- Rankings (`/rankings`): where populations shrink most by 2100, highest risk, fewest babies per woman
- Share a picture: a 1600×900 image of the globe as you left it (or a country's chart) with its numbers, for X
  (copied for pasting into the post; phones use the share sheet), or to copy or download. "Post on X" on a country
  page shares this picture too
- Night mode that follows the system appearance
- Link previews: every place has its own page and card, so a link to `/country/TWN` shows Taiwan's picture and
  numbers on X, Slack or iMessage (built at deploy by `scripts/pages/build-pages.mjs` and `scripts/og/render-cards.mjs`)
- Design: [docs/design/DESIGN-v3.md](docs/design/DESIGN-v3.md). Preview locally with `node scripts/serve.mjs` (port 8731)

## Data and refresh

`scripts/fetch-data.mjs` (Node 22, zero dependencies) pulls the latest public sources and builds a static API under
`public/api/v1/`:

- **World Bank WDI**: latest reported fertility rate, population, crude birth and death rates, net migration,
  population growth, 65+ share and migrant stock, plus region and income group
- **UN World Population Prospects 2024** (the UN's own CSV files, with its January 2026 corrections): fertility,
  population, births, deaths, net migration, median age and 65+ population, as estimates 1950-2023 and projections to
  2100 for the medium and constant-fertility variants
- **UN DESA International Migrant Stock 2024** (via Our World in Data): immigrant stock (people living in a country who
  were born elsewhere), emigrant stock (people born there who live abroad) and the top origin and destination countries

For how sure each number is, it also reads the UN's own per-country documentation (what each estimate rests on,
extracted from the UN's PDFs into `scripts/data/`), the UN Statistics Division's latest census, estimate and
registration tables, Eurostat's population and people born abroad, and the UN's 80% and 95% forecast ranges.

For each country it computes the demographic balance (population change = births − deaths + net migration, in
absolute numbers and per 1,000 people), the UN outlook to 2050 and 2100, the "100 people" generation ratio, and a
transparent 0-100 **population-decline risk score** with tiers and plain-English reasons. Every headline number
carries its year and source. How it works: [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

`.github/workflows/refresh-and-deploy.yml` runs every Monday at 06:17 UTC, on demand, and on pushes to `main`. It
runs the tests, refetches everything, and refuses to publish in three cases: a source that worked before is down,
any country or metric has less data than in the last build, or a sanity or schema check fails. It commits only when
a number actually changed (unchanged data gives byte-identical files), never deploys if the branch moved mid-run, and
deploys `public/` to Vercel. Each deploy also writes `api/v1/status.json` with the time of the last check.

## API (for people and agents)

Base URL `https://fertility-tracker-live.vercel.app/api/v1/`: no key, CORS open, JSON and CSV.

| File | What |
| --- | --- |
| `index.json` | Manifest: exact source URLs and vintages, endpoints, data gaps, `generatedAt`, `contentHash` |
| `countries.json` | Summary for every country + world (map/list data) |
| `countries/{ISO3}.json` | One country: yearly series 1950-2100, migrant stocks and corridors, full risk breakdown |
| `risk.json` | Countries ranked by population-decline risk, with the methodology |
| `countries.csv`, `timeseries.csv` | Spreadsheet-friendly (long format `iso3,year,variant,metric,value`) |
| `openapi.json`, `schema/*.schema.json`, `status.json` | OpenAPI 3.1, JSON Schemas, last-run status |

Human docs: [/api/](https://fertility-tracker-live.vercel.app/api/). Agent guide:
[/llms.txt](https://fertility-tracker-live.vercel.app/llms.txt). Field reference: [docs/API.md](docs/API.md).

## Run locally

```sh
node scripts/fetch-data.mjs                # fetch + rebuild public/api/v1 (writes only changed files)
node scripts/fetch-data.mjs --verify       # validate the published files against their schemas (offline)
node --test                                # unit tests
npx serve public                           # or any static server
```

`--cache <dir>` caches raw downloads while developing; `--force` publishes despite failed checks (use with care).

## Model caveat

The generations view multiplies each generation by (fertility rate ÷ 2.1) with ~30-year generations. It ignores migration,
mortality change and age-structure momentum: it shows the long-run pull of a rate, not a forecast. The UN line is the forecast.

## License

MIT. Data: World Bank (CC BY 4.0); UN WPP 2024 and UN DESA International Migrant Stock 2024 (CC BY 3.0 IGO); migrant
stock via Our World in Data (CC BY 4.0).
