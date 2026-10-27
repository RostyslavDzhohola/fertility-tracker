# Fertility Tracker v2 — brief (read fully before working)

## Ros's original prompt (verbatim, from X note https://x.com/i/status/2114850610897994228)

```
@bot build  a live tracker for this with loops to update the data from the latest sources and show for each country, projections and into the future with the current stats ( visualize data so regular person can understand )

Ask engineering to create seprate project and setup weekly atonumus cheks to update with the feedback collected from people using it, use your grok bot email, create dedicated handle for this , make sure it works

it should highlight wich countries are at the highest risks
enrich with data so the coutry growth seprated by things  like birth, imigration, inflow and outflow of people, make data easily acceble by poeple and most importatnly by other agents 

opus 5.5 with xhigh thinking , and let it decide which other agents to use for desing, backend frontend etc

when done, draft an X post
```

Context posts for the visualization idea: https://x.com/i/status/2114764208399421635 quoting
https://x.com/i/status/2114753234443108791 ("start with 100 people at a fertility rate of 1.14 and show each generation
shrinking": 1.14 / 2.1 replacement ≈ 0.54, so 100 → 54 → 29 → 16 → 9).

## Ros's feedback on v1 (must fix)

1. Keep GitHub Pages hosting (free). No Vercel.
2. PRIMARY VISUAL: a **world map / globe** with country outlines colored by fertility / risk, so a regular person instantly
   sees who is in trouble. The map is the hero, not a line chart + dropdown.
3. v1 country dropdown was broken UX: selecting a country yanked the page to the dashed projection line. Selecting a
   country (search box or map click) must focus that country cleanly, with no scroll jump.
4. Missing from v1 and required now:
   - Highlight the countries at highest risk.
   - Growth broken down into births, deaths, immigration / net migration, inflow and outflow of people (not just TFR).
   - Data easily accessible to people AND especially to other agents (clean JSON/CSV, documented machine-readable
     endpoints, OpenAPI, llms.txt).
   - Weekly autonomous checks that also fold in feedback from people using it.
   - Feedback email: `andromedus+fertility@mail.grokbot.com` (Grok Bot inbox alias, works now). GitHub Issues is the
     machine-readable feedback feed. Dedicated X handle is not created yet: use placeholder `TODO_X_HANDLE` / hide it.
   - Draft X post when done (orchestrator does this).

## Constraints

- Free tiers only. Static site on GitHub Pages, deployed from `public/` by `.github/workflows/refresh-and-deploy.yml`.
- No runtime CDN dependencies for the live site; vendor any library into `public/vendor/`. No paid APIs, no API keys.
- Zero-dependency Node 22 scripts for the data pipeline (global fetch, node:test for tests).
- Repo: github.com/RostyslavDzhohola/fertility-tracker (public, MIT). Live: https://rostyslavdzhohola.github.io/fertility-tracker/
- Branch `v2-map-redo` is checked out. Do NOT run git commands that change state (no commit, checkout, stash, reset, push).
  The orchestrator commits.
- Several agents work in this folder at once. Only write the files your brief assigns you.

## v1 (being replaced)

`scripts/fetch-data.mjs` writes `public/data/fertility.json` (World Bank TFR + population; UN WPP TFR estimates and
medium projections via Our World in Data). `public/index.html`, `app.js`, `style.css` are the v1 chart-first UI.

## Planned API contract (backend owns it; others build against it)

Base: `https://rostyslavdzhohola.github.io/fertility-tracker/api/v1/` (relative in the app: `api/v1/`).

- `index.json` — manifest: version, generatedAt, sources, endpoint list, methodology links.
- `countries.json` — one summary record per country (+ `WLD` world): iso3, name, region, population, tfr, latest
  components (births, deaths, naturalChange, netMigration, per-1000 rates), immigrant stock (inflow proxy) and emigrant
  stock (outflow proxy), median age / 65+ share, UN projections (population 2050/2100, % change), generation ratio
  (tfr/2.1), halving years, risk {score 0–100, tier, rank, factors[] in plain English}.
- `countries/{ISO3}.json` — full yearly series 1950–2100 (estimates + UN medium projection): tfr, population, births,
  deaths, netMigration, naturalChange.
- `risk.json` — countries ranked by risk + methodology.
- `countries.csv`, `timeseries.csv` (long format) — spreadsheet-friendly.
- `openapi.json`, JSON Schemas; `/llms.txt` at the site root; human docs at `/api/`.
