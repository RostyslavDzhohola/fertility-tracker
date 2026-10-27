#!/usr/bin/env node
// Weekly autonomous check: live site + API health, data freshness, refresh-workflow status, and the
// past week's feedback issues. Writes a markdown report and keeps one open "Weekly check — YYYY-MM-DD"
// issue. Zero dependencies; Node 22+.
//
// Exit codes: 0 = site/API fine (warnings allowed), 1 = a required URL is down or invalid,
//             2 = the checker itself failed (crash, or could not publish the report).
//
// Local:  GITHUB_TOKEN=$(gh auth token) node scripts/checks/weekly-check.mjs --dry-run
//         node scripts/checks/weekly-check.mjs --site http://127.0.0.1:8080/ --no-github --expect-deployed
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { activityCandidates, assessActivity, buildCountryIndex, groupFeedback, selectIssues, summarizeIssue, CHECK_LABEL, FEEDBACK_TYPES } from "./lib/feedback.mjs";
import { createGitHub } from "./lib/github.mjs";
import { overallStatus, renderReport, reportTitle, machineSummary, TITLE_RE } from "./lib/report.mjs";
import { assessWorkflowRuns, assessWorkflowStates, findCountryRecords, runSiteChecks } from "./lib/site.mjs";

// CHECK_REPO_ROOT points the checker at another checkout (tests use an empty one).
const REPO_ROOT = path.resolve(process.env.CHECK_REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const DEFAULTS = {
  site: "https://rostyslavdzhohola.github.io/fertility-tracker/",
  repo: "RostyslavDzhohola/fertility-tracker",
  refreshWorkflow: "refresh-and-deploy.yml",
};

const HELP = `Usage: node scripts/checks/weekly-check.mjs [options]

  --site <url>            live site base (default: public/feedback.json site.url)
  --repo <owner/name>     GitHub repo (default: $GITHUB_REPOSITORY or feedback.json)
  --days <n>              feedback window in days (default 7)
  --countries <all|n>     per-country API files to fetch (default all)
  --expect-deployed       files in this checkout's public/ must be live (CI sets this on main)
  --dry-run               read everything, write nothing to GitHub
  --no-github             skip GitHub entirely (no workflow status, no feedback, no issue)
  --out <dir>             also write report.md and report.json there
  --help

Env: GITHUB_TOKEN or GH_TOKEN (writes need it), CHECK_SITE_URL, CHECK_EXPECT_DEPLOYED=true, CHECK_DRY_RUN=true,
CHECK_REPO_ROOT (another checkout), GITHUB_STEP_SUMMARY (appends the report when set).`;

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const truthy = (v) => /^(1|true|yes)$/i.test(String(v ?? ""));

async function main() {
  const { values: opt } = parseArgs({
    options: {
      site: { type: "string" },
      repo: { type: "string" },
      days: { type: "string", default: "7" },
      countries: { type: "string", default: "all" },
      "expect-deployed": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "no-github": { type: "boolean", default: false },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (opt.help) {
    console.log(HELP);
    return 0;
  }

  const config = (await readJson(path.join(REPO_ROOT, "public/feedback.json"))) ?? {};
  const siteUrl = opt.site ?? process.env.CHECK_SITE_URL ?? config.site?.url ?? DEFAULTS.site;
  const repo = opt.repo ?? process.env.GITHUB_REPOSITORY ?? config.github?.repo ?? DEFAULTS.repo;
  const expectDeployed = opt["expect-deployed"] || truthy(process.env.CHECK_EXPECT_DEPLOYED);
  const dryRun = opt["dry-run"] || truthy(process.env.CHECK_DRY_RUN);
  const useGitHub = !opt["no-github"];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const days = Math.max(1, Number(opt.days) || 7);
  const now = new Date();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const feedbackLabels = Object.values(config.github?.templates ?? {}).map((t) => t.label).filter(Boolean);
  const labels = feedbackLabels.length ? feedbackLabels : FEEDBACK_TYPES;

  const result = { date: now.toISOString(), repo, errors: [] };
  if (process.env.GITHUB_RUN_ID) result.runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  result.mode = !useGitHub ? "offline (no GitHub)" : dryRun ? "dry run (nothing written to GitHub)" : token ? "live" : "read-only (no token)";

  const gh = useGitHub ? createGitHub({ token, repo }) : null;

  // Refresh workflow status first: a deploy in progress softens repo-derived failures.
  if (gh) {
    try {
      result.workflow = assessWorkflowRuns(await gh.listWorkflowRuns(DEFAULTS.refreshWorkflow), now);
    } catch (err) {
      result.errors.push(`could not read ${DEFAULTS.refreshWorkflow} runs: ${err.message}`);
    }
    try {
      result.workflowStates = assessWorkflowStates(await gh.listWorkflows(), [DEFAULTS.refreshWorkflow, "weekly-check.yml"]);
    } catch (err) {
      result.errors.push(`could not read workflow states: ${err.message}`);
    }
  }

  let previous = null;
  if (gh) {
    try {
      previous = await gh.previousSummary(CHECK_LABEL, TITLE_RE);
    } catch (err) {
      result.errors.push(`could not read the previous weekly check: ${err.message}`);
    }
  }

  result.site = await runSiteChecks({
    siteUrl,
    repoRoot: REPO_ROOT,
    expectDeployed,
    deployInProgress: !!result.workflow?.inProgress,
    apiWasLive: previous?.apiLive === true,
    countrySample: opt.countries === "all" ? "all" : Number(opt.countries),
  });

  if (gh) {
    try {
      const records = findCountryRecords(result.site.countryIndexSource ?? (await readJson(path.join(REPO_ROOT, "public/data/fertility.json"))));
      const index = buildCountryIndex(records);
      const issues = await gh.listIssuesForReport(since);
      if (issues.truncated) result.errors.push("issue listing hit the page limit; some feedback may be missing from this report");
      let activity = new Map();
      try {
        const collected = await gh.collectActivity(activityCandidates(issues, { since, labels }), assessActivity);
        activity = collected.activity;
        if (!collected.editsKnown) {
          const list = collected.unknownEdits.map((n) => `#${n}`).join(", ");
          result.errors.push(`could not read body-edit history (GraphQL) for ${list}; recently updated ones are listed as needing attention`);
        }
      } catch (err) {
        result.errors.push(`could not read issue comments; every recent feedback issue is listed as needing attention: ${err.message}`);
      }
      const { attention, handled, other } = selectIssues(issues, { since, labels, activity });
      const items = attention.map((a) => summarizeIssue(a.issue, { since, index, reason: a.reason, activity: a.activity }));
      result.feedback = {
        since,
        items,
        grouped: groupFeedback(items),
        handled: handled.map((h) => summarizeIssue(h.issue, { since, index, activity: h.activity })),
        other: other.map((i) => summarizeIssue(i, { since, index })),
      };
    } catch (err) {
      result.errors.push(`could not read feedback issues: ${err.message}`);
    }
  }
  delete result.site.countryIndexSource;

  const title = reportTitle(now);
  const body = renderReport(result); // capped to fit an issue
  const fullBody = renderReport(result, { maxLength: Infinity });
  const status = overallStatus(result);

  if (opt.out) {
    await mkdir(opt.out, { recursive: true });
    await writeFile(path.join(opt.out, "report.md"), `# ${title}\n\n${fullBody}\n`);
    await writeFile(path.join(opt.out, "report.json"), JSON.stringify({ title, ...machineSummary(result), detail: result }, null, 2));
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `# ${title}\n\n${fullBody}\n`);
  console.log(`# ${title}\n\n${fullBody}\n`);

  let exitCode = status === "FAIL" ? 1 : 0;
  if (gh && token && !dryRun) {
    try {
      const created = await gh.ensureLabels(config.labels ?? { [CHECK_LABEL]: { color: "5319E7", description: "Automated weekly site, data and feedback report" } });
      if (created.length) console.log(`Created labels: ${created.join(", ")}`);
      const pub = await gh.publishReport({ title, body, label: CHECK_LABEL, titleRe: TITLE_RE });
      console.log(`${pub.created ? "Opened" : "Updated"} ${pub.url}${pub.closed.length ? `; closed ${pub.closed.map((n) => `#${n}`).join(", ")}` : ""}`);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\nReport issue: ${pub.url}\n`);
    } catch (err) {
      console.error(`Could not publish the report issue: ${err.message}`);
      exitCode = Math.max(exitCode, 2);
    }
  } else if (gh && !dryRun && !token) {
    console.log("No GITHUB_TOKEN/GH_TOKEN: report not published.");
  }
  console.log(`weekly-check: ${status} (exit ${exitCode})`);
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err?.stack ?? err);
    process.exit(2);
  },
);
