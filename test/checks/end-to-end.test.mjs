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
import { TITLE_RE } from "../../scripts/checks/lib/report.mjs";
import { runSiteChecks } from "../../scripts/checks/lib/site.mjs";

const run = promisify(execFile);
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/checks/weekly-check.mjs");
const BASE = "/fertility-tracker/";

const json = (v) => ({ type: "application/json", body: JSON.stringify(v) });
function goodSite() {
  return {
    "": { type: "text/html", body: "<!doctype html><html><head><title>Fertility Tracker</title></head><body>map</body></html>" },
    "api/v1/index.json": json({
      version: "1",
      generatedAt: new Date().toISOString(),
      sources: { un: { name: "UN WPP 2024", revision: "2024" } },
      endpoints: [
        { name: "countries", url: "countries.json" },
        { name: "country", url: "countries/{ISO3}.json" },
        { name: "risk", url: "risk.json" },
        { name: "countries-csv", url: "countries.csv" },
        { name: "openapi", url: "openapi.json" },
        { name: "status", url: "status.json" },
      ],
    }),
    "api/v1/status.json": json({ apiVersion: "v1", checkedAt: new Date().toISOString(), refresh: "success", trigger: "schedule", dataChangedAt: "2024-07-12T00:00:00Z" }),
    "api/v1/countries.json": json({ countries: [{ iso3: "JPN", name: "Japan" }, { iso3: "KOR", name: "South Korea" }] }),
    "api/v1/countries/JPN.json": json({ iso3: "JPN", series: [[2023, 1.2]] }),
    "api/v1/countries/KOR.json": json({ iso3: "KOR", series: [[2023, 0.72]] }),
    "api/v1/risk.json": json({ ranked: [{ iso3: "KOR", name: "South Korea", risk: { rank: 1, score: 95 } }, { iso3: "JPN", name: "Japan", risk: { rank: 2, score: 80 } }] }),
    "api/v1/countries.csv": { type: "text/csv", body: "iso3,name,tfr\nJPN,Japan,1.2\nKOR,South Korea,0.72\n" },
    "api/v1/openapi.json": json({ openapi: "3.1.0", paths: { "/countries.json": {} } }),
  };
}

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
  assert.deepEqual(r.topRisk.map((x) => x.iso3), ["KOR", "JPN"]);
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
  routes = { "": goodSite()[""] };
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
  routes = { "": goodSite()[""] };
  const repoRoot = await tempRepo();
  const r = await runSiteChecks({ siteUrl: site, repoRoot, apiWasLive: true, retries: 0 });
  await rm(repoRoot, { recursive: true });
  const manifest = r.targets.find((t) => t.path === "api/v1/index.json");
  assert.equal(manifest.level, "fail");
  assert.equal(manifest.reason, "was live in the previous weekly check");
});

test("invalid or empty live manifest: the fallback list stays under check and a broken manifest fails", async () => {
  const repoRoot = await tempRepo();
  routes = { "": goodSite()[""], "api/v1/index.json": { type: "application/json", body: "true" } };
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

test("CLI exit codes: 0 when healthy, 1 when the home page or an advertised endpoint is broken", async () => {
  routes = goodSite();
  const okRun = await run(process.execPath, [CLI, "--site", site, "--no-github"]);
  assert.match(okRun.stdout, /weekly-check: (PASS|WARN) \(exit 0\)/);

  routes = goodSite();
  routes["api/v1/openapi.json"] = json({ title: "not openapi" });
  await assert.rejects(run(process.execPath, [CLI, "--site", site, "--no-github"]), (err) => err.code === 1 && /Overall: FAIL/.test(err.stdout));

  routes = {};
  await assert.rejects(run(process.execPath, [CLI, "--site", site, "--no-github"]), (err) => err.code === 1 && /SITE IS DOWN/.test(err.stdout));
});

// Fake GitHub REST API: enough of issues, comments and labels for publishReport/ensureLabels.
function fakeGitHub(initialIssues, labels = []) {
  const issues = new Map(initialIssues.map((i) => [i.number, { state: "open", labels: [{ name: "weekly-check" }], ...i }]));
  const calls = [];
  let next = 100;
  const fetchImpl = async (url, { method = "GET", body } = {}) => {
    const u = new URL(url);
    const payload = body ? JSON.parse(body) : undefined;
    calls.push({ method, path: u.pathname, payload });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    const m = u.pathname.match(/^\/repos\/o\/r\/(issues|labels)(?:\/(\d+))?(\/comments)?$/);
    if (!m) return reply({ message: "Not Found" }, 404);
    const [, kind, num, comments] = m;
    if (kind === "labels") {
      if (method === "GET") return reply(labels.map((name) => ({ name })));
      labels.push(payload.name);
      return reply({ name: payload.name }, 201);
    }
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

test("ensureLabels creates only the missing labels", async () => {
  const fake = fakeGitHub([], ["feedback", "Weekly-Check"]);
  const gh = createGitHub({ token: "t", repo: "o/r", fetchImpl: fake.fetchImpl });
  const created = await gh.ensureLabels({ feedback: {}, "weekly-check": {}, triaged: { color: "C2E0C6", description: "x" } });
  assert.deepEqual(created, ["triaged"]);
});
