// Offline end-to-end tests: a local HTTP server stands in for GitHub Pages, a fake fetch for the GitHub API.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createGitHub } from "../../scripts/checks/lib/github.mjs";
import { assessActivity } from "../../scripts/checks/lib/feedback.mjs";
import { TITLE_RE } from "../../scripts/checks/lib/report.mjs";
import { runSiteChecks } from "../../scripts/checks/lib/site.mjs";
import { json, makeSite } from "./helpers.mjs";

const run = promisify(execFile);
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/checks/weekly-check.mjs");
const BASE = "/fertility-tracker/";

const goodSite = () => makeSite();
const plainHome = () => ({ "": { type: "text/html", body: "<!doctype html><html><head><title>Fertility Tracker</title></head><body>map</body></html>" } });

let server;
let site;
let routes = goodSite();

before(async () => {
  server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const key = p.startsWith(BASE) ? p.slice(BASE.length) : null;
    const hit = key !== null ? routes[key] : undefined;
    if (!hit) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end("<html>404</html>");
    }
    res.writeHead(200, { "content-type": hit.type });
    res.end(hit.body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${server.address().port}${BASE}`;
});
after(() => server.close());

async function tempRepo(files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "wc-repo-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, "public", rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

test("healthy site: every advertised endpoint passes, templated files expand from countries.json", async () => {
  routes = goodSite();
  const repoRoot = await tempRepo();
  const r = await runSiteChecks({ siteUrl: site, repoRoot, retries: 0 });
  await rm(repoRoot, { recursive: true });
  assert.equal(r.apiLive, true);
  assert.equal(r.manifestSource, "live");
  const byPath = Object.fromEntries(r.targets.map((t) => [t.path, t]));
  for (const p of ["", "api/v1/index.json", "api/v1/countries.json", "api/v1/countries/JPN.json", "api/v1/countries/KOR.json", "api/v1/risk.json", "api/v1/countries.csv", "api/v1/openapi.json", "api/v1/status.json"]) {
    assert.equal(byPath[p]?.level, "pass", `${p} should pass: ${JSON.stringify(byPath[p])}`);
  }
  assert.equal(byPath["api/v1/countries/JPN.json"].required, true);
  assert.equal(byPath["llms.txt"].level, "warn"); // planned but not live, not in repo
  assert.equal(r.targets.some((t) => t.level === "fail"), false);
  assert.equal(r.freshness.level, "pass");
  assert.deepEqual(r.topRisk.slice(0, 2).map((x) => x.iso3), ["KOR", "JPN"]);
  assert.equal(byPath["api/v1/countries/JPN.json"].info.schema, "valid");
  for (const p of ["style.css", "vendor/lib.min.js", "js/main.js", "js/logic.js", "js/map.js", "js/dom.js", "js/lazy.js", "geo/countries-110m.json", "geo/world-points.json"]) {
    assert.equal(byPath[p]?.level, "pass", `asset ${p}: ${JSON.stringify(byPath[p])}`);
    assert.equal(byPath[p].required, true);
  }
  assert.equal(r.assetsChecked >= 9, true);
});

test("status.json is deploy-only: required on the live site, skipped in a local build", async () => {
  routes = goodSite();
  delete routes["api/v1/status.json"];
  const repoRoot = await tempRepo();
  const live = await runSiteChecks({ siteUrl: site, repoRoot, localBuild: false, retries: 0 });
  const liveStatus = live.targets.find((t) => t.path === "api/v1/status.json");
  assert.equal(liveStatus.level, "fail");
  assert.equal(live.freshness.level, "warn");

  const local = await runSiteChecks({ siteUrl: site, repoRoot, expectDeployed: true, retries: 0 }); // 127.0.0.1 → local build
  assert.equal(local.localBuild, true);
  const localStatus = local.targets.find((t) => t.path === "api/v1/status.json");
  assert.equal(localStatus.level, "skip");
  assert.match(localStatus.reason, /deploy-only/);
  assert.equal(local.freshness.level, "skip");
  assert.equal(local.targets.some((t) => t.level === "fail"), false);

  routes = goodSite();
  routes["api/v1/status.json"] = json({ checkedAt: new Date(Date.now() - 12 * 86400000).toISOString(), refresh: "failure" });
  const stale = await runSiteChecks({ siteUrl: site, repoRoot, localBuild: false, retries: 0 });
  await rm(repoRoot, { recursive: true });
  assert.equal(stale.targets.find((t) => t.path === "api/v1/status.json").level, "pass", "a stale but valid file is not broken");
  assert.equal(stale.freshness.level, "warn");
  assert.match(stale.freshness.note, /12 days ago.*"failure"/);
});

test("broken advertised endpoint fails; repo files must be live only on the deployed branch", async () => {
  routes = goodSite();
  routes["api/v1/countries.csv"] = { type: "text/csv", body: "iso3,name,tfr\nJPN,Japan\n" };
  delete routes["api/v1/countries/KOR.json"];
  const repoRoot = await tempRepo({ "llms.txt": "# llms" });
  const deployed = await runSiteChecks({ siteUrl: site, repoRoot, expectDeployed: true, retries: 0 });
  const byPath = Object.fromEntries(deployed.targets.map((t) => [t.path, t]));
  assert.equal(byPath["api/v1/countries.csv"].level, "fail");
  assert.equal(byPath["api/v1/countries/KOR.json"].level, "fail");
  assert.equal(byPath["llms.txt"].level, "fail");
  assert.equal(byPath["llms.txt"].reason, "in repo public/ on the deployed branch");

  const branch = await runSiteChecks({ siteUrl: site, repoRoot, expectDeployed: false, retries: 0 });
  assert.equal(branch.targets.find((t) => t.path === "llms.txt").level, "warn");
  const inProgress = await runSiteChecks({ siteUrl: site, repoRoot, expectDeployed: true, deployInProgress: true, retries: 0 });
  assert.equal(inProgress.targets.find((t) => t.path === "llms.txt").level, "warn");
  await rm(repoRoot, { recursive: true });
});

test("API not deployed yet: only warnings, home page still required", async () => {
  routes = plainHome();
  const repoRoot = await tempRepo();
  const r = await runSiteChecks({ siteUrl: site, repoRoot, retries: 0 });
  await rm(repoRoot, { recursive: true });
  assert.equal(r.apiLive, false);
  assert.equal(r.manifestSource, "builtin");
  assert.equal(r.targets.find((t) => t.path === "").level, "pass");
  assert.equal(r.targets.some((t) => t.level === "fail"), false);
  assert.ok(r.targets.filter((t) => t.level === "warn").every((t) => t.warnings.includes("not live yet")));
});

test("API manifest that vanished after a previous check saw it live is a failure", async () => {
  routes = plainHome();
  const repoRoot = await tempRepo();
  const r = await runSiteChecks({ siteUrl: site, repoRoot, apiWasLive: true, retries: 0 });
  await rm(repoRoot, { recursive: true });
  const manifest = r.targets.find((t) => t.path === "api/v1/index.json");
  assert.equal(manifest.level, "fail");
  assert.equal(manifest.reason, "was live in the previous weekly check");
});

test("invalid or empty live manifest: the fallback list stays under check and a broken manifest fails", async () => {
  const repoRoot = await tempRepo();
  routes = { ...plainHome(), "api/v1/index.json": { type: "application/json", body: "true" } };
  const invalid = await runSiteChecks({ siteUrl: site, repoRoot, retries: 0 });
  assert.equal(invalid.apiLive, false);
  assert.equal(invalid.targets.find((t) => t.path === "api/v1/index.json").level, "fail");
  assert.ok(invalid.targets.some((t) => t.path === "api/v1/risk.json"), "built-in endpoints still checked");

  routes = { ...goodSite(), "api/v1/index.json": json({ generatedAt: new Date().toISOString(), endpoints: [] }) };
  delete routes["api/v1/risk.json"];
  const empty = await runSiteChecks({ siteUrl: site, repoRoot, retries: 0 });
  await rm(repoRoot, { recursive: true });
  assert.equal(empty.apiLive, true);
  assert.equal(empty.manifestSource, "builtin");
  const manifest = empty.targets.find((t) => t.path === "api/v1/index.json");
  assert.equal(manifest.level, "warn");
  assert.match(manifest.warnings.join(), /lists no endpoints/);
  assert.equal(empty.targets.find((t) => t.path === "api/v1/countries/KOR.json").level, "pass");
  assert.equal(empty.targets.find((t) => t.path === "api/v1/risk.json").level, "warn");
});

test("page assets: a missing module, a missing data file, or HTML served as JS is a failure", async () => {
  routes = goodSite();
  delete routes["js/dom.js"]; // imported two levels deep (main.js -> map.js -> dom.js)
  delete routes["geo/world-points.json"]; // fetched by main.js
  routes["vendor/lib.min.js"] = { type: "text/html", body: "<!doctype html><html>fallback</html>" };
  const repoRoot = await tempRepo();
  const r = await runSiteChecks({ siteUrl: site, repoRoot, retries: 0 });
  await rm(repoRoot, { recursive: true });
  const byPath = Object.fromEntries(r.targets.map((t) => [t.path, t]));
  assert.equal(byPath["js/dom.js"].level, "fail");
  assert.equal(byPath["js/dom.js"].reason, "loaded by the home page");
  assert.equal(byPath["geo/world-points.json"].level, "fail");
  assert.equal(byPath["geo/world-points.json"].reason, "fetched by the site's JavaScript");
  assert.equal(byPath["vendor/lib.min.js"].level, "fail");
  assert.match(byPath["vendor/lib.min.js"].problems.join(), /HTML page instead of JavaScript/);
  assert.equal(byPath["js/lazy.js"].level, "pass", "dynamic import() followed");
});

test("structurally useless or inconsistent API payloads fail even though they parse", async () => {
  const repoRoot = await tempRepo();
  routes = goodSite();
  routes["api/v1/countries.json"] = json({ oops: true });
  let r = await runSiteChecks({ siteUrl: site, repoRoot, retries: 0 });
  let byPath = Object.fromEntries(r.targets.map((t) => [t.path, t]));
  assert.equal(byPath["api/v1/countries.json"].level, "fail");
  assert.match(byPath["api/v1/countries.json"].problems.join(), /no country records/);

  routes = goodSite();
  routes["api/v1/countries/JPN.json"] = json({ iso3: "JPN", name: "Japan", tfr: "very low" }); // violates the served schema
  routes["api/v1/countries/AAA.json"] = json({ iso3: "AAA", name: "Wrongland", tfr: 1 }); // summary says "Country AAA"
  routes["api/v1/countries/AAB.json"] = json({ iso3: "XYZ", name: "Country AAB", tfr: 1 }); // wrong file
  const site160 = makeSite();
  const list = JSON.parse(site160["api/v1/countries.json"].body);
  routes["api/v1/countries.json"] = json({ ...list, count: 999 });
  routes["api/v1/countries.csv"] = { type: "text/csv", body: "iso3,name\nJPN,Japan\n" };
  const risk = JSON.parse(site160["api/v1/risk.json"].body);
  risk.ranking[3].rank = 99;
  routes["api/v1/risk.json"] = json(risk);
  r = await runSiteChecks({ siteUrl: site, repoRoot, retries: 0 });
  await rm(repoRoot, { recursive: true });
  byPath = Object.fromEntries(r.targets.map((t) => [t.path, t]));
  const problems = (p) => byPath[p].problems.join(" | ");
  assert.match(problems("api/v1/countries/JPN.json"), /schema: \$\.tfr: expected number or null/);
  assert.match(problems("api/v1/countries/AAA.json"), /consistency: summary says AAA "Country AAA", detail says AAA "Wrongland"/);
  assert.match(problems("api/v1/countries/AAB.json"), /iso3 is "XYZ", file is for AAB/);
  assert.match(problems("api/v1/countries.json"), /count says 999 but there are 160 records/);
  assert.match(problems("api/v1/countries.csv"), /1 rows, countries\.json has 160 records/);
  assert.match(problems("api/v1/risk.json"), /ranking\[3\]\.rank is 99, expected 4/);
  for (const p of ["api/v1/countries/JPN.json", "api/v1/countries/AAA.json", "api/v1/countries/AAB.json", "api/v1/countries.json", "api/v1/countries.csv", "api/v1/risk.json"]) {
    assert.equal(byPath[p].level, "fail", p);
  }
});

test("CLI exit codes: 0 when healthy, 1 when the home page or an advertised endpoint is broken", async () => {
  const repoRoot = await tempRepo(); // keeps the real repo's schemas and public/ out of this run
  const opts = { env: { ...process.env, CHECK_REPO_ROOT: repoRoot } };
  routes = goodSite();
  const okRun = await run(process.execPath, [CLI, "--site", site, "--no-github"], opts);
  assert.match(okRun.stdout, /weekly-check: (PASS|WARN) \(exit 0\)/);

  routes = goodSite();
  routes["api/v1/openapi.json"] = json({ title: "not openapi" });
  await assert.rejects(run(process.execPath, [CLI, "--site", site, "--no-github"], opts), (err) => err.code === 1 && /Overall: FAIL/.test(err.stdout));

  routes = {};
  await assert.rejects(run(process.execPath, [CLI, "--site", site, "--no-github"], opts), (err) => err.code === 1 && /SITE IS DOWN/.test(err.stdout));
  await rm(repoRoot, { recursive: true });
});

// Fake GitHub REST API: enough of issues, comments and labels for publishReport/ensureLabels.
function fakeGitHub(initialIssues, labels = [], { commentsByIssue = {}, edits = {} } = {}) {
  const issues = new Map(initialIssues.map((i) => [i.number, { state: "open", labels: [{ name: "weekly-check" }], ...i }]));
  const calls = [];
  let next = 100;
  const fetchImpl = async (url, { method = "GET", body } = {}) => {
    const u = new URL(url);
    const payload = body ? JSON.parse(body) : undefined;
    calls.push({ method, path: u.pathname, payload });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/graphql") {
      const out = {};
      const errors = [];
      for (const [, alias, n] of payload.query.matchAll(/(i(\d+)): issue\(number: \d+\)/g)) {
        if (edits[n] === "missing") {
          out[alias] = null;
          errors.push({ message: `Could not resolve to an Issue with the number of ${n}.` });
        } else out[alias] = edits[n] ?? { lastEditedAt: null, editor: null };
      }
      return reply({ data: { repository: out }, ...(errors.length ? { errors } : {}) });
    }
    const m = u.pathname.match(/^\/repos\/o\/r\/(issues|labels)(?:\/(\d+))?(\/comments)?$/);
    if (!m) return reply({ message: "Not Found" }, 404);
    const [, kind, num, comments] = m;
    if (kind === "labels") {
      if (method === "GET") return reply(labels.map((name) => ({ name })));
      labels.push(payload.name);
      return reply({ name: payload.name }, 201);
    }
    if (comments && method === "GET") return reply(commentsByIssue[num] ?? []);
    if (comments) return reply({ id: 1 }, 201);
    if (method === "GET" && !num) {
      const state = u.searchParams.get("state") ?? "open";
      return reply([...issues.values()].filter((i) => (state === "all" || i.state === state) && i.labels.some((l) => l.name === u.searchParams.get("labels"))));
    }
    if (method === "POST") {
      const number = next++;
      const issue = { ...payload, number, html_url: `https://github.com/o/r/issues/${number}`, state: "open", labels: payload.labels.map((name) => ({ name })) };
      issues.set(number, issue);
      return reply(issue, 201);
    }
    if (method === "PATCH") {
      const issue = Object.assign(issues.get(Number(num)), payload);
      return reply({ ...issue, html_url: `https://github.com/o/r/issues/${num}` });
    }
    return reply({ message: "unexpected" }, 500);
  };
  return { fetchImpl, calls, issues, labels };
}

test("publishReport creates today's issue and closes last week's", async () => {
  const fake = fakeGitHub([
    { number: 5, title: "Weekly check — 2026-10-19" },
    { number: 6, title: "Unrelated issue that happens to have the label" },
  ]);
  const gh = createGitHub({ token: "t", repo: "o/r", fetchImpl: fake.fetchImpl });
  const res = await gh.publishReport({ title: "Weekly check — 2026-10-26", body: "report", label: "weekly-check", titleRe: TITLE_RE });
  assert.equal(res.created, true);
  assert.deepEqual(res.closed, [5]);
  assert.equal(fake.issues.get(5).state, "closed");
  assert.equal(fake.issues.get(6).state, "open", "issues without a weekly-check title are left alone");
  assert.ok(fake.calls.some((c) => c.method === "POST" && c.path.endsWith("/issues/5/comments") && /Superseded by #100/.test(c.payload.body)));
});

test("publishReport updates an existing same-day issue instead of opening a duplicate", async () => {
  const fake = fakeGitHub([{ number: 7, title: "Weekly check — 2026-10-26" }]);
  const gh = createGitHub({ token: "t", repo: "o/r", fetchImpl: fake.fetchImpl });
  const res = await gh.publishReport({ title: "Weekly check — 2026-10-26", body: "new body", label: "weekly-check", titleRe: TITLE_RE });
  assert.equal(res.created, false);
  assert.equal(res.number, 7);
  assert.equal(fake.issues.get(7).body, "new body");
  assert.equal(fake.calls.filter((c) => c.method === "POST").length, 0);
});

test("publishReport reopens a closed same-day report instead of duplicating it", async () => {
  const fake = fakeGitHub([{ number: 7, title: "Weekly check — 2026-10-26", state: "closed" }]);
  const gh = createGitHub({ token: "t", repo: "o/r", fetchImpl: fake.fetchImpl });
  const res = await gh.publishReport({ title: "Weekly check — 2026-10-26", body: "again", label: "weekly-check", titleRe: TITLE_RE });
  assert.equal(res.number, 7);
  assert.equal(res.created, false);
  assert.equal(fake.issues.get(7).state, "open");
  assert.equal(fake.issues.size, 1);
});

test("previousSummary returns the newest report's machine summary", async () => {
  const summary = (apiLive) => "intro\n```json\n" + JSON.stringify({ schema: "fertility-tracker/weekly-check@1", apiLive }) + "\n```\n";
  const fake = fakeGitHub([
    { number: 9, title: "Weekly check — 2026-10-19", body: summary(true) },
    { number: 8, title: "Weekly check — 2026-10-12", body: summary(false) },
    { number: 7, title: "Not a report", body: summary(false) },
  ]);
  const gh = createGitHub({ token: "t", repo: "o/r", fetchImpl: fake.fetchImpl });
  const prev = await gh.previousSummary("weekly-check", TITLE_RE);
  assert.equal(prev.number, 9);
  assert.equal(prev.apiLive, true);
  const empty = createGitHub({ token: "t", repo: "o/r", fetchImpl: fakeGitHub([{ number: 1, title: "Weekly check — 2026-10-19", body: "no json" }]).fetchImpl });
  assert.equal(await empty.previousSummary("weekly-check", TITLE_RE), null);
});

test("collectActivity reads comments and GraphQL edit times, and skips issues without comments", async () => {
  const owner = { author_association: "OWNER", user: { login: "ros", type: "User" } };
  const fake = fakeGitHub([], [], {
    commentsByIssue: { 7: [{ ...owner, body: "Done.\n<!-- fertility-tracker:handled 2026-10-27 -->", created_at: "2026-10-27T09:00:00Z", updated_at: "2026-10-27T09:00:00Z" }] },
    edits: { 7: { lastEditedAt: "2026-10-29T00:00:00Z", editor: { __typename: "User", login: "reporter" } }, 9: "missing" },
  });
  const gh = createGitHub({ token: "t", repo: "o/r", fetchImpl: fake.fetchImpl });
  const issues = [
    { number: 7, comments: 1, created_at: "2026-10-20T00:00:00Z", user: { login: "reporter", type: "User" } },
    { number: 8, comments: 0, created_at: "2026-10-26T00:00:00Z", user: { login: "x", type: "User" } },
    { number: 9, comments: 0, created_at: "2026-10-26T00:00:00Z", user: { login: "y", type: "User" } }, // GraphQL cannot resolve it
  ];
  const { activity, editsKnown } = await gh.collectActivity(issues, assessActivity);
  assert.equal(editsKnown, true, "one unresolvable issue does not throw away the batch");
  assert.equal(activity.get(7).handledAt, "2026-10-27T09:00:00.000Z");
  assert.equal(activity.get(7).newSinceHandled, true, "body edited after the handled reply");
  assert.equal(activity.get(8).handledAt, null);
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/issues/8/comments")).length, 0);
  const noToken = await createGitHub({ repo: "o/r", fetchImpl: fake.fetchImpl }).collectActivity(issues, assessActivity);
  assert.equal(noToken.editsKnown, false);
});

test("ensureLabels creates only the missing labels", async () => {
  const fake = fakeGitHub([], ["feedback", "Weekly-Check"]);
  const gh = createGitHub({ token: "t", repo: "o/r", fetchImpl: fake.fetchImpl });
  const created = await gh.ensureLabels({ feedback: {}, "weekly-check": {}, triaged: { color: "C2E0C6", description: "x" } });
  assert.deepEqual(created, ["triaged"]);
});
