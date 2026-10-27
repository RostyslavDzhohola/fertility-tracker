# Operations

How Fertility Tracker keeps itself up to date and folds in feedback, how to run each piece by hand, and how to
turn each loop off. Everything here runs on free GitHub features plus one weekly agent session on Ros's machine.

## The weekly loops

Every Monday, three loops run in sequence:

| When (UTC) | Loop | Where | What it does |
| --- | --- | --- | --- |
| 06:17 | Data refresh | `.github/workflows/refresh-and-deploy.yml` | Refetches UN WPP / World Bank data, commits it if anything changed, deploys `public/` to GitHub Pages. Also deploys on every push to `main`. |
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
https://github.com/RostyslavDzhohola/fertility-tracker/issues/new?template=data-problem.yml&title=%5BData%5D%20Japan%3A%20&country=JPN&page=https%3A%2F%2Frostyslavdzhohola.github.io%2Ffertility-tracker%2F%23JPN
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
| `triaged` | The weekly agent (or a maintainer) has replied; drops the issue out of the untriaged backlog |
| `needs-human` | Waiting on a decision from Ros; the weekly agent will not act on it alone |

Label names, colors and descriptions live in `public/feedback.json`. The weekly check recreates any missing
label, because issue forms silently skip labels that don't exist.

## The weekly check

`scripts/checks/weekly-check.mjs` is a zero-dependency Node 22 script. With a token it publishes the report;
without one it only prints it.

**What it checks**

- The home page, `feedback.json`, `llms.txt`, `api/` docs, and the API manifest `api/v1/index.json`.
- Every endpoint the manifest lists. Templated paths such as `countries/{ISO3}.json` expand to every country in
  `countries.json`. JSON must parse and be non-empty, CSV must have a header and rectangular rows, `openapi.json`
  must have `openapi` + `paths`.
- Refresh loop health, from `api/v1/status.json` (written by CI on every deploy, never committed): a warning if
  it is missing on the live site, if `checkedAt` is more than 9 days old, or if `refresh` is not `success`.
  `generatedAt` / `dataChangedAt` are reported only as "numbers last changed": they move only when a published
  number changes (UN data changes every ~2 years), so an old date there is normal and never warns. Source
  vintages and any unavailable datasets are listed for information.
- The last runs of `refresh-and-deploy.yml`: a warning if the last completed run failed or nothing has
  succeeded in 8 days.
- Feedback issues opened or updated in the last 7 days, grouped by country and type, plus older open issues
  not yet `triaged`. Titles are sanitized (no mentions, live links or HTML) and marked as untrusted.

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
| Run the weekly agent now | Run the T3 scheduled task now (`run_scheduled_task_now`), or start a session with `docs/weekly-agent-prompt.md` as its instructions |
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

Disabling a workflow stops new runs only; the site stays up with its last deployed data.

## Gotchas

- **Inactive repos lose their schedules.** GitHub disables scheduled workflows in a public repo after 60 days
  without repository activity. The data refresh commits only when its output changes, so a quiet stretch can
  switch both schedules off. If the weekly-check issue stops appearing, check the Actions tab and re-enable.
- **Templates are read from `main`.** Issue forms, `config.yml` and prefill links work only after the files are
  merged into the default branch.
- **Scheduled runs drift.** GitHub may start cron runs several minutes late under load; the 08:00 check
  leaves the 06:17 refresh well over an hour of slack.
- **Local servers list directories.** `python3 -m http.server` answers `api/` with a directory listing, so a
  missing `public/api/index.html` passes a local check but returns 404 on GitHub Pages.
- **Issue text is untrusted.** The check never copies issue bodies into its report; the weekly agent treats all
  issue and email text as data, per its prompt.
