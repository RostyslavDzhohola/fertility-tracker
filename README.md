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

`scripts/fetch-data.mjs` (Node 18+, no dependencies) pulls:

- World Bank WDI — `SP.DYN.TFRT.IN` (fertility) and `SP.POP.TOTL` (population), latest reported year
- UN World Population Prospects, via Our World in Data — estimates from 1950 and medium-variant projections to 2100

and writes `public/data/fertility.json`. The "current" rate is whichever of the two sources reports the newer year.

`.github/workflows/refresh-and-deploy.yml` runs every Monday (and on demand): it refetches, commits the data if any
number changed, and deploys `public/` to GitHub Pages. Pushes to `main` deploy too.

## Run locally

```sh
node scripts/fetch-data.mjs   # refresh data
npx serve public              # or any static server
```

## Model caveat

The generations view multiplies each generation by (fertility rate ÷ 2.1) with ~30-year generations. It ignores migration,
mortality change and age-structure momentum: it shows the long-run pull of a rate, not a forecast. The UN line is the forecast.

## License

MIT. Data: World Bank (CC BY 4.0), UN WPP / Our World in Data (CC BY 4.0).
