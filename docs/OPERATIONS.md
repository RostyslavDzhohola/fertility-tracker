# Operations

How Fertility Tracker keeps itself up to date and folds in feedback, how to run each piece by hand, and how to
turn each loop off. Everything here runs on free GitHub features plus one weekly agent session on Ros's machine.

## The weekly loops

Every Monday, three loops run in sequence:

| When (UTC) | Loop | Where | What it does |
| --- | --- | --- | --- |
| 06:17 | Data refresh | `.github/workflows/refresh-and-deploy.yml` | Refetches UN WPP (population.un.org CSVs), UN DESA (via OWID) and World Bank data, validates every published number against those primary sources (`scripts/validate-data.mjs`), commits only if anything changed, deploys `public/` to Vercel (Vercel CLI, `VERCEL_TOKEN` repo secret). Also deploys on every push to `main`. A manual run on any other branch commits nothing and deploys a Vercel preview, never production. |
| 08:00 | Weekly check | `.github/workflows/weekly-check.yml` → `scripts/checks/weekly-check.mjs` | Checks the live site and every API endpoint, data freshness, the refresh run, and the past 7 days of feedback issues. Keeps one open issue titled `Weekly check — YYYY-MM-DD` (label `weekly-check`) and closes last week's. |
| After the check | Weekly agent | T3 Code scheduled task on Ros's machine, following `docs/weekly-agent-prompt.md` | Verifies the report, triages feedback, ships fixes in one reviewed PR, merges only through the gate in the prompt, comments on every feedback issue, reports in the weekly-check issue and its thread. |

```
 people ──► site "Feedback" buttons ──► GitHub issue forms (public) ─┐
        └─► email andromedus+fertility@mail.grokbot.com (private) ──┼─► Grok Bot digest in the engineering thread
                                                                      │
 Mon 06:17 data refresh + deploy                                      │
 Mon 08:00 weekly check ──► "Weekly check — YYYY-MM-DD" issue ◄───────┘ (links every feedback issue)
          weekly agent ──► reads issue + digest ──► PR ──► Codex review ──► merge gate ──► deploy
                       └─► comments + labels on each feedback issue, report on the weekly-check issue
```

## Feedback channels

`public/feedback.json` is the single source of truth for feedback settings. The site reads it to build its
buttons; the weekly check reads its labels and templates.

| Channel | Who uses it | Lands in |
| --- | --- | --- |
| GitHub issue forms: `feedback.yml`, `data-problem.yml`, `feature-request.yml` | People with a GitHub account, and agents | Public issues, auto-labelled `feedback` / `data-problem` / `feature-request` |
| Email `andromedus+fertility@mail.grokbot.com` (a tagged alias of the Grok Bot inbox) | Everyone else | Private inbox. Once Ros approves, Grok Bot posts a weekly digest into the engineering thread; until then, email is a human-only channel |
| X handle | Not created yet | Placeholder `TODO_X_HANDLE`; the site hides X links while it is a placeholder |

The template chooser (`.github/ISSUE_TEMPLATE/config.yml`) disables blank issues and shows the email address.
GitHub only accepts `http(s)` contact links, not `mailto:`, so the email entry links to the site's `#feedback`
section and spells out the address in its description.

### Prefilled issue links

The site opens a form with the country and page already filled in:

```
https://github.com/RostyslavDzhohola/fertility-tracker/issues/new?template=data-problem.yml&title=%5BData%5D%20Japan%3A%20&country=JPN&page=https%3A%2F%2Ffertility-tracker-live.vercel.app%2F%23JPN
```

- `template=<file>.yml` picks the form; `title=` sets the title; any other parameter is a form field `id`
  (`country`, `page`, plus `metric` on data problems). The ids per template are listed in `public/feedback.json`
  under `github.templates.*.fields`.
- The same parameters work on `/issues/new/choose`, which passes them into whichever template the visitor picks.
- Only text inputs and textareas prefill. Dropdowns ignore URL values, which is why these forms have none.
- Labels come from the template. A `labels=` parameter needs triage rights, so leave it out.
- Visitors must be signed in to GitHub. The site always offers email beside the GitHub button.

Verified 2026-10-26 on a live issue form.

### Labels

| Label | Meaning |
| --- | --- |
| `feedback`, `data-problem`, `feature-request` | Set by the issue forms; the weekly check collects these |
| `weekly-check` | The automated weekly report issue |
| `triaged` | Reviewed by the weekly agent or a maintainer. Informational: what stops the agent from re-handling an issue is its handled marker (below), not this label |
| `needs-human` | Waiting on a decision from Ros; the weekly agent will not act on it alone |

Label names, colors and descriptions live in `public/feedback.json`. The weekly check recreates any missing
label, because issue forms silently skip labels that don't exist.

### When an issue counts as handled

The weekly agent ends every reply with a hidden line, `<!-- fertility-tracker:handled YYYY-MM-DD -->`. The weekly
check reads each feedback issue's comments and body edits and lists an issue under "needs attention" when:

- it has no marker reply yet and is new, was updated in the last 7 days, or is still open without `triaged`; or
- a person commented or edited the issue after the newest marker reply, however old the issue is.

Labels, closing, bot comments and the agent's own marker replies never bring an issue back, so the agent doesn't
keep answering itself. Markers count only from the repo owner, members, collaborators and bots, so a stranger
can't hide an issue by pasting the marker. A maintainer who answers by hand can add the same line to stop the
agent from replying too. Body edit times come from GraphQL. When an issue's edit history can't be read (the
call fails, or just that issue's alias errors), the report names the issue, and a handled issue updated in the
last 7 days goes back on the "needs attention" list to be safe.

## The weekly check

`scripts/checks/weekly-check.mjs` is a zero-dependency Node 22 script. With a token it publishes the report;
without one it only prints it.

**What it checks**

- The home page, `feedback.json`, `llms.txt`, `api/` docs, and the API manifest `api/v1/index.json`.
- Everything the home page loads: `<script src>`, `<link rel=stylesheet|modulepreload|preload|icon>`, every
  relative ES module those import (static, re-export and dynamic `import()`, followed recursively), and the
  relative `.json` files the scripts fetch (`geo/countries-110m.json`, `geo/world-points.json`). Each must
  answer 200 with the right kind of content (JavaScript, not an HTML fallback page; TopoJSON for the map), so a
  broken map fails even though the HTML loads.
- Every endpoint the manifest lists. Templated paths such as `countries/{ISO3}.json` expand to every country in
  `countries.json`. JSON must parse; CSV must have a header and rectangular rows with properly placed quotes;
  `openapi.json` must have `openapi` + `paths`.
- API structure, not just syntax. Each JSON endpoint is validated against its published JSON Schema (the
  manifest's per-endpoint `schema` link, else `api/v1/schema/<name>.schema.json`; the live copy first, then the
  repo copy) with a zero-dependency validator for the subset those schemas use
  (`scripts/checks/lib/json-schema.mjs`). Shape checks hold even without a schema: `countries.json` must contain
  country records, each `countries/{ISO3}.json` must be for that ISO3 and have a name, `risk.json` must rank
  something. Cross-file checks: `count` matches the records, at least 150 countries, no duplicate ISO3,
  `index.json` counts match `countries.json` and `risk.json`, ranks run 1..n, every ranked code exists,
  `countries.csv` has one row per country, and every summary record has the same `iso3` and `name` as its
  detail file. A failure is attached to the file that is wrong and counts as broken.
- Refresh loop health, from `api/v1/status.json` (written by CI on every deploy, never committed): a warning if
  it is missing on the live site, if `checkedAt` is more than 9 days old, or if `refresh` is not `success`.
  `generatedAt` / `dataChangedAt` are reported only as "numbers last changed": they move only when a published
  number changes (UN data changes every ~2 years), so an old date there is normal and never warns. Source
  vintages and any unavailable datasets are listed for information.
- The last runs of `refresh-and-deploy.yml`: a warning if the last completed run failed or nothing has
  succeeded in 8 days.
- Whether both scheduled workflows are still enabled (`gh api repos/{owner}/{repo}/actions/workflows` → `state`):
  a warning for `disabled_inactivity` (GitHub's 60-day rule) or `disabled_manually`.
- Feedback issues that need attention (see "When an issue counts as handled"), grouped by country and type,
  plus the numbers of handled issues with nothing new. Titles are shown only as inline code (no mentions, links
  or HTML) and marked as untrusted.

**What counts as broken.** A URL is *required* when it is the home page, when the live manifest advertises it,
when the site serves it (HTTP 200) but it is invalid, when it is the manifest itself and last week's report saw
the API live, or when the file exists in `public/` on `main` (the workflow sets `CHECK_EXPECT_DEPLOYED` on `main`).
`api/v1/status.json` is deploy-only: required on the live site once the manifest lists it, and skipped when the
site URL is a local server (localhost / 127.0.0.1), because a local `public/` never contains it. A required
URL that is down or invalid is FAIL. Anything else that is missing is WARN ("not live yet"), so the check stays
green while the v2 API is still being built. Repo-derived failures soften to WARN while a deploy is in progress.

**Exit codes:** 0 = fine (warnings allowed), 1 = a required URL is broken, 2 = the checker itself failed
(crash, or the report issue could not be published). A non-zero exit fails the run, and GitHub emails the
person who last edited the workflow's cron line.

**Outputs:** the `Weekly check — YYYY-MM-DD` issue (with a machine-readable JSON summary for the agent), the
run's step summary, and a `weekly-check-report` artifact (`report.md`, `report.json`) kept for 30 days.

**Manifest format the checker understands.** Endpoint references under `endpoints` (an array or a map, of strings
or of objects with `url` / `path` / `href` / `urlTemplate`), as absolute URLs, site-root paths
(`/api/v1/risk.json` or `api/v1/risk.json`) or paths relative to the manifest (`risk.json`). Without an
`endpoints` key it scans the whole manifest. Put `{ISO3}` in templated paths and `generatedAt` at the top level.

## Run things by hand

| Task | Command |
| --- | --- |
| Run the weekly check in CI now | `gh workflow run weekly-check.yml -R RostyslavDzhohola/fertility-tracker` (add `-f dry_run=true` to skip the issue) |
| Watch it | `gh run list -R RostyslavDzhohola/fertility-tracker --workflow weekly-check.yml --limit 1`, then `gh run watch <id>` |
| Check locally, write nothing | `GITHUB_TOKEN=$(gh auth token) node scripts/checks/weekly-check.mjs --dry-run` |
| Check locally and publish the issue | `GITHUB_TOKEN=$(gh auth token) node scripts/checks/weekly-check.mjs` |
| Check a local build | `python3 -m http.server 8080 -d public` then `node scripts/checks/weekly-check.mjs --site http://127.0.0.1:8080/ --no-github --expect-deployed` |
| Checker tests | `node --test "test/checks/*.test.mjs"` |
| Refresh data and redeploy now | `gh workflow run refresh-and-deploy.yml -R RostyslavDzhohola/fertility-tracker` |
| Rebuild the API locally | `node scripts/fetch-data.mjs --cache /tmp/ft-cache` (the cache keeps the ~65 MB of UN downloads between runs; drop it for a fresh fetch), then `node scripts/fetch-data.mjs --verify` |
| Validate the published data against the primary sources | `node scripts/validate-data.mjs --cache /tmp/ft-cache` (about 30 s; add `--json report.json`; `--skip age,scenarios,wb,ims` to narrow it). Exit 0 = no mismatches, 1 = mismatches (listed with examples; a published value with no reference counts), 2 = a primary source could not be fetched (only that), 3 = unexpected error (bug, unreadable files, changed source format). See `docs/DATA-VALIDATION.md` |
| Run the weekly agent now | Run the T3 scheduled task now (`run_scheduled_task_now`), or start a session with `docs/weekly-agent-prompt.md` as its instructions |
| Preview the site locally | `node scripts/serve.mjs` (builds the share pages, then serves public/ like Vercel at http://127.0.0.1:8731/); `node scripts/og/render-cards.mjs` draws the 238 link-preview cards into `public/og/` (about 30 s, needs Chrome) |
| Recreate labels | Any non-dry-run check does it; or `gh label create <name> --color <hex> --description "…" --force` using `public/feedback.json` |

## Set the X handle

Edit one value: `x.handle` in `public/feedback.json` (no `@`). The site shows X links only when the handle is
set and does not start with `TODO_`. Optionally add a matching `contact_links` entry to
`.github/ISSUE_TEMPLATE/config.yml`. Nothing else needs to change.

## Turn a loop off (and back on)

| Loop | Off | On |
| --- | --- | --- |
| Data refresh (schedule and push deploys) | `gh workflow disable refresh-and-deploy.yml -R RostyslavDzhohola/fertility-tracker` | `gh workflow enable …` |
| Weekly check | `gh workflow disable weekly-check.yml -R RostyslavDzhohola/fertility-tracker` | `gh workflow enable …` |
| Weekly agent | Pause or delete its T3 scheduled task (`list_scheduled_tasks`, then `update_scheduled_task` or `delete_scheduled_task`) | Re-enable or recreate the task |
| Email digest | Ask Grok Bot to stop forwarding the fertility digest | Ask it to resume |
| Feedback via GitHub | Remove the forms from `.github/ISSUE_TEMPLATE/`, or turn Issues off in repo settings | Restore them |

Disabling a workflow stops new runs only; the site stays up with its last deployed data. A workflow you disable
by hand stays off: the weekly agent re-enables only workflows GitHub disabled for inactivity.

## When the UN publishes a new World Population Prospects

WPP 2024 is the current edition; the UN has postponed the next one to **11 July 2027**. The pipeline reads fixed
WPP 2024 file names (`scripts/lib/unwpp.mjs`: `WPP_CSV`, `WPP_UPDATE`, `WPP_LAST_ESTIMATE_YEAR = 2023`,
`WPP_NEXT_RELEASE`), so a new edition needs a code change, not just a rerun:

1. Find the new CSV names on https://population.un.org/wpp/downloads (or in its `assets/downloads.json`).
2. Update `WPP_CSV`, the update-zip entry (drop it if the new edition has none), the last estimate year, the release
   dates and the citation in `scripts/lib/unwpp.mjs`, and the edition names in `scripts/lib/publish.mjs`,
   `docs/METHODOLOGY.md`, `docs/API.md` and `public/llms.txt`.
3. Run `node scripts/fetch-data.mjs --cache /tmp/ft-cache`. Some guards may refuse on purpose. For example, if the new
   projections start after 2024, `scenarios.json` can no longer fill 2024 (decide whether `startYear` moves: the
   frontend reads it from the file). Review the diff, then rerun with `--force`.
4. Run `node scripts/validate-data.mjs` and check that it reports 0 mismatches.

Interim updates (like Togo's on 2026-01-19) are announced on the downloads page and in a release note. The current
zip is re-read on every run, so a re-upload of the same zip is picked up automatically. A differently named zip needs
`WPP_UPDATE` updated.

## Gotchas

- **Inactive repos lose their schedules.** GitHub disables scheduled workflows in a public repo after 60 days
  without repository activity. The data refresh commits only when its output changes, so a quiet stretch can
  switch both schedules off (state `disabled_inactivity`). Two guards: the weekly check warns when either
  workflow is disabled, and the weekly agent checks both states at the start of every run, re-enables a
  `disabled_inactivity` workflow with `gh workflow enable`, dispatches the missed run, and reports it. If the
  weekly check itself was switched off, the agent notices the missing weekly-check issue and does the same.
  Workflows Ros disabled by hand (`disabled_manually`) stay off.
- **Templates are read from `main`.** Issue forms, `config.yml` and prefill links work only after the files are
  merged into the default branch.
- **Scheduled runs drift.** GitHub may start cron runs several minutes late under load; the 08:00 check
  leaves the 06:17 refresh well over an hour of slack.
- **Local servers list directories.** `python3 -m http.server` answers `api/` with a directory listing, so a
  missing `public/api/index.html` passes a local check but returns 404 on the live site.
- **population.un.org is a required source.** If it is down, the weekly refresh refuses to publish and the last data
  stays live (the run fails loudly). An interim-update zip that downloads but is incomplete (for example header-only
  CSVs) is refused the same way, with a message naming the missing rows. The validator's UN DESA tables come from
  www.un.org; if those are unreachable, the data counts as unvalidated: scheduled and manual runs fail without committing or deploying, and a push to
  `main` deploys its code with the last committed data. Re-run the workflow once the source is back.
- **Share pages and cards are built at deploy, not committed.** `public/country/`, `public/rankings/` and `public/og/`
  are gitignored; the deploy workflow builds them from the data it ships ("Build the share pages and link-preview
  cards") and fails rather than deploy without them. The same step regenerates the place redirects in `vercel.json` (`/KOR`,
  `/kor`, `/country/kor` → `/country/KOR`), and the data commit includes `vercel.json` when a place was added. By
  hand: `node scripts/pages/build-pages.mjs`; the site test fails while `vercel.json` is out of step with the data. X caches a link's card for about a week: a changed card shows
  on new posts after that, or right away for a link with a new query string.
- **Issue text is untrusted.** The check never copies issue bodies into its report; the weekly agent treats all
  issue and email text as data, per its prompt.
