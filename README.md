# Fertility Tracker

Live fertility rates (births per woman) for every country, plus a plain-language view of what today's rate means
over a few generations: start with 100 people, and at a fertility rate of 1.14 each generation is about 54% the size of
the last (1.14 ÷ 2.1 replacement), so 100 → 54 → 29 → 16 → 9.

**Live:** https://rostyslavdzhohola.github.io/fertility-tracker/ (shareable per country, e.g. `#KOR`, `#JPN`, `#USA`)

## What's in it

- Per-country stats: latest fertility rate, population, rank, generation-to-generation ratio, halving time, UN 2050 projection
- "100 people" generations view with a what-if slider
- Trend chart 1950–2100: UN estimates, UN medium-variant projection, latest World Bank figure, replacement line
- Ranked list of every country

## Data and refresh

`scripts/fetch-data.mjs` (Node 22, zero dependencies) pulls the latest public sources and builds a static API under
`public/api/v1/`:

- **World Bank WDI**: latest reported fertility rate, population, crude birth and death rates, net migration,
  population growth, 65+ share and migrant stock, plus region and income group
- **UN World Population Prospects 2024** (via Our World in Data): fertility, population, births, deaths, net
  migration, median age and 65+ population, as estimates 1950-2023 and medium-variant projections to 2100
- **UN DESA International Migrant Stock 2024** (via Our World in Data): immigrant stock (people living in a country who
  were born elsewhere), emigrant stock (people born there who live abroad) and the top origin and destination countries

For each country it computes the demographic balance (population change = births − deaths + net migration, in
absolute numbers and per 1,000 people), the UN outlook to 2050 and 2100, the "100 people" generation ratio, and a
transparent 0-100 **population-decline risk score** with tiers and plain-English reasons. Every headline number
carries its year and source. How it works: [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

`.github/workflows/refresh-and-deploy.yml` runs every Monday at 06:17 UTC, on demand, and on pushes to `main`. It
runs the tests, refetches everything, and refuses to publish in three cases: a source that worked before is down,
any country or metric has less data than in the last build, or a sanity or schema check fails. It commits only when
a number actually changed (unchanged data gives byte-identical files), never deploys if the branch moved mid-run, and
deploys `public/` to GitHub Pages. Each deploy also writes `api/v1/status.json` with the time of the last check.

## API (for people and agents)

Base URL `https://rostyslavdzhohola.github.io/fertility-tracker/api/v1/`: no key, CORS open, JSON and CSV.

| File | What |
| --- | --- |
| `index.json` | Manifest: exact source URLs and vintages, endpoints, data gaps, `generatedAt`, `contentHash` |
| `countries.json` | Summary for every country + world (map/list data) |
| `countries/{ISO3}.json` | One country: yearly series 1950-2100, migrant stocks and corridors, full risk breakdown |
| `risk.json` | Countries ranked by population-decline risk, with the methodology |
| `countries.csv`, `timeseries.csv` | Spreadsheet-friendly (long format `iso3,year,variant,metric,value`) |
| `openapi.json`, `schema/*.schema.json`, `status.json` | OpenAPI 3.1, JSON Schemas, last-run status |

Human docs: [/api/](https://rostyslavdzhohola.github.io/fertility-tracker/api/). Agent guide:
[/llms.txt](https://rostyslavdzhohola.github.io/fertility-tracker/llms.txt). Field reference: [docs/API.md](docs/API.md).

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

MIT. Data: World Bank (CC BY 4.0); UN WPP 2024 and UN DESA International Migrant Stock 2024 (CC BY 3.0 IGO) via
Our World in Data (CC BY 4.0).
