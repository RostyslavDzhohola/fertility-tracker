// Site and API checks: which URLs to check, how to validate each response, data freshness.
// Pure helpers are exported for tests; runSiteChecks() does the network work.
import { access, readFile } from "node:fs/promises";
import path from "node:path";

// Checked even when the live manifest is missing. `planned` = part of the v2 contract (docs/brief/BRIEF.md);
// a planned target that is not live yet is a warning, not a failure, unless the repo says it should be live.
// `legacy` targets are only checked while the file still exists in the repo.
export const BUILTIN_TARGETS = [
  { path: "", kind: "html", name: "Home page", always: true },
  { path: "api/v1/index.json", kind: "manifest", name: "API manifest", planned: true },
  { path: "api/v1/countries.json", kind: "json", planned: true },
  { path: "api/v1/countries/{ISO3}.json", kind: "json", planned: true },
  { path: "api/v1/risk.json", kind: "json", planned: true },
  { path: "api/v1/countries.csv", kind: "csv", planned: true },
  { path: "api/v1/timeseries.csv", kind: "csv", planned: true },
  { path: "api/v1/openapi.json", kind: "openapi", planned: true },
  { path: "api/v1/status.json", kind: "status", name: "Deploy status", planned: true },
  { path: "api/", kind: "html", name: "API docs", planned: true },
  { path: "llms.txt", kind: "text", planned: true },
  { path: "feedback.json", kind: "feedback", planned: true },
  { path: "data/fertility.json", kind: "json", legacy: true },
];

export const MANIFEST_PATH = "api/v1/index.json";
export const STATUS_PATH = "api/v1/status.json";
// Written by CI at deploy time and gitignored: required on the live site, absent from a local build of public/.
export const DEPLOY_ONLY = new Set([STATUS_PATH]);
export const REFRESH_MAX_AGE_DAYS = 9;

export function isLocalSite(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host) || host.endsWith(".localhost");
}
const TEMPLATE_RE = /\{[^}]+\}|<ISO3>|:iso3\b/i;
const ENDPOINT_FILE_RE = /\.(json|csv|txt|ya?ml|geojson|ndjson)$/i;

export function kindFromPath(p) {
  const clean = p.split(/[?#]/)[0].toLowerCase();
  if (clean === "" || clean.endsWith("/") || clean.endsWith(".html")) return "html";
  if (clean.endsWith("openapi.json")) return "openapi";
  if (clean.endsWith("api/v1/index.json")) return "manifest";
  if (clean.endsWith("api/v1/status.json")) return "status";
  if (clean.endsWith("feedback.json")) return "feedback";
  if (clean.endsWith(".json") || clean.endsWith(".geojson")) return "json";
  if (clean.endsWith(".csv")) return "csv";
  return "text";
}

export function isTemplated(p) {
  return TEMPLATE_RE.test(p);
}

export function expandTemplate(p, codes) {
  return codes.map((code) => p.replace(TEMPLATE_RE, code));
}

export function normalizeSiteUrl(url) {
  const u = new URL(url);
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  u.search = "";
  u.hash = "";
  return u.toString();
}

// Turn a manifest reference (absolute URL, root-relative or manifest-relative path) into a path relative to
// the site base, or null when it points outside the site (source links, docs elsewhere).
export function toSitePath(ref, siteUrl, manifestPath = MANIFEST_PATH) {
  if (typeof ref !== "string" || !ref.trim()) return null;
  const base = new URL(normalizeSiteUrl(siteUrl));
  let str = ref.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(str) && !/^https?:/i.test(str)) return null; // mailto:, data:, ...
  if (str.startsWith("/") && !str.startsWith("//") && !str.startsWith(base.pathname)) {
    return cleanPath(safeDecode(str.replace(/^\/+/, ""))); // "/api/v1/x.json" written relative to the site root
  }
  // "api/v1/x.json" (starts with the manifest's top folder) is site-root relative, not manifest relative.
  const topFolder = manifestPath.split("/")[0] + "/";
  if (manifestPath.includes("/") && str.startsWith(topFolder)) return cleanPath(safeDecode(str));
  let resolved;
  try {
    resolved = new URL(str, new URL(manifestPath, base));
  } catch {
    return null;
  }
  if (resolved.origin !== base.origin) return null;
  const pathname = safeDecode(resolved.pathname);
  if (!pathname.startsWith(base.pathname)) return null;
  return cleanPath(pathname.slice(base.pathname.length));
}

function cleanPath(p) {
  return p.split(/[?#]/)[0].replace(/^\.\//, "");
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Collect endpoint paths from an API manifest without assuming its exact shape: look under `endpoints`
// (array or map, strings or objects) and, failing that, anywhere in the document.
export function extractEndpoints(manifest, siteUrl, manifestPath = MANIFEST_PATH) {
  if (!manifest || typeof manifest !== "object") return [];
  const root = manifest.endpoints ?? manifest.files ?? manifest.resources ?? manifest;
  const found = new Set();
  const visit = (value, key, depth) => {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      if (key && /^(description|title|name|summary|license|citation|note)s?$/i.test(key)) return;
      const looksLikeEndpoint = ENDPOINT_FILE_RE.test(value.split(/[?#]/)[0]) || (isTemplated(value) && /\//.test(value));
      if (!looksLikeEndpoint) return;
      const p = toSitePath(value, siteUrl, manifestPath);
      if (p !== null) found.add(p);
      return;
    }
    if (Array.isArray(value)) return value.forEach((v) => visit(v, key, depth + 1));
    if (typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, k, depth + 1);
  };
  visit(root, null, 0);
  return [...found].sort();
}

// Find ISO3 codes in countries.json-like data: an array of records with iso3, or an object keyed by ISO3.
export function findCountryRecords(data) {
  const seen = new Set();
  const search = (value, depth) => {
    if (depth > 4 || value == null || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      const recs = value.filter((r) => r && typeof r === "object" && typeof (r.iso3 ?? r.iso ?? r.code) === "string");
      if (recs.length && recs.length >= value.length / 2) {
        return recs
          .map((r) => ({ iso3: String(r.iso3 ?? r.iso ?? r.code).toUpperCase(), name: r.name ?? r.country ?? null, record: r }))
          .filter((r) => /^[A-Z]{3}$/.test(r.iso3));
      }
      for (const v of value) {
        const hit = search(v, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    const keys = Object.keys(value);
    const isoKeys = keys.filter((k) => /^[A-Z]{3}$/.test(k));
    if (isoKeys.length >= 5 && isoKeys.length >= keys.length * 0.8) {
      return isoKeys.map((k) => ({ iso3: k, name: value[k]?.name ?? null, record: value[k] }));
    }
    for (const k of ["countries", "data", "items", "records", "results", "ranking", "ranked"]) {
      if (k in value) {
        const hit = search(value[k], depth + 1);
        if (hit) return hit;
      }
    }
    for (const v of Object.values(value)) {
      const hit = search(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return search(data, 0) ?? [];
}

// Strict RFC 4180 parser: quotes only around a whole field, "" for a literal quote, CRLF or LF line ends.
// `badQuoteLine` is the 1-based line of the first quote in the wrong place (or null).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;
  let afterClose = false;
  let line = 1;
  let badQuoteLine = null;
  const endField = () => {
    row.push(field);
    field = "";
    fieldStart = true;
    afterClose = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        afterClose = true;
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === ",") endField();
    else if (c === "\n") {
      endField();
      rows.push(row);
      row = [];
      line++;
    } else if (c === "\r" && text[i + 1] === "\n") continue;
    else if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else {
      if ((c === '"' || afterClose) && badQuoteLine === null) badQuoteLine = line;
      field += c;
      fieldStart = false;
    }
  }
  if (field !== "" || row.length || afterClose) {
    endField();
    rows.push(row);
  }
  return { rows, unterminatedQuote: quoted, badQuoteLine };
}

// Validate one fetched response. Returns { ok, problems[], warnings[], info{}, data }.
// `problems` make the target broken; `warnings` are worth reporting but do not break it.
export function validateResponse(kind, { status, contentType = "", text = "" }, { siteUrl } = {}) {
  const problems = [];
  const warnings = [];
  const info = {};
  let data;
  if (status !== 200) {
    problems.push(status ? `HTTP ${status}` : "no response");
    return { ok: false, problems, warnings, info, data };
  }
  const ct = contentType.toLowerCase();
  if (["json", "manifest", "openapi", "feedback", "status"].includes(kind)) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      problems.push(`invalid JSON: ${err.message.slice(0, 120)}`);
      return { ok: false, problems, warnings, info, data };
    }
    const empty = data == null || (Array.isArray(data) ? data.length === 0 : typeof data === "object" && Object.keys(data).length === 0);
    if (empty) problems.push("empty JSON");
    if (ct && !ct.includes("json")) warnings.push(`content-type is ${contentType}, expected application/json`);
    if (Array.isArray(data)) info.records = data.length;
    const records = findCountryRecords(data);
    if (records.length) info.countries = records.length;
    if (kind === "manifest" && (!data || typeof data !== "object" || Array.isArray(data))) {
      problems.push("manifest is not a JSON object");
    } else if (kind === "manifest") {
      const endpoints = siteUrl ? extractEndpoints(data, siteUrl) : [];
      info.endpoints = endpoints.length;
      if (!endpoints.length) warnings.push("manifest lists no endpoints the checker can find");
      if (!data?.generatedAt) warnings.push("manifest has no generatedAt");
    }
    if (kind === "openapi") {
      const version = data?.openapi ?? data?.swagger;
      if (typeof version !== "string" || !data?.paths || typeof data.paths !== "object") problems.push("not an OpenAPI document (needs openapi + paths)");
      else info.paths = Object.keys(data.paths).length;
    }
    if (kind === "status") {
      if (!data || typeof data !== "object" || Array.isArray(data)) problems.push("status.json is not a JSON object");
      else {
        if (!data.checkedAt || Number.isNaN(Date.parse(data.checkedAt))) problems.push("status.json has no valid checkedAt");
        if (typeof data.refresh !== "string") problems.push("status.json has no refresh outcome");
        info.refresh = data.refresh;
        info.checkedAt = data.checkedAt;
      }
    }
    if (kind === "feedback") {
      if (!data?.email?.address) problems.push("feedback.json has no email.address");
      if (!data?.github?.templates) problems.push("feedback.json has no github.templates");
      if (typeof data?.x?.handle !== "string" || data.x.handle.startsWith("TODO")) info.xHandle = "placeholder (hidden on site)";
    }
  } else if (kind === "csv") {
    const { rows, unterminatedQuote, badQuoteLine } = parseCsv(text);
    while (rows.length && rows.at(-1).length === 1 && rows.at(-1)[0] === "") rows.pop();
    if (unterminatedQuote) problems.push("unterminated quoted field");
    if (badQuoteLine) problems.push(`stray quote on line ${badQuoteLine}`);
    const header = rows[0] ?? [];
    if (header.length < 2) problems.push("CSV header has fewer than 2 columns");
    if (rows.length < 2) problems.push("CSV has no data rows");
    const bad = rows.findIndex((r) => r.length !== header.length);
    if (header.length >= 2 && bad > 0) problems.push(`row ${bad + 1} has ${rows[bad].length} columns, header has ${header.length}`);
    info.rows = Math.max(rows.length - 1, 0);
    info.columns = header.length;
    if (ct && !ct.includes("csv") && !ct.includes("text/plain")) warnings.push(`content-type is ${contentType}`);
  } else if (kind === "html") {
    if (!/<html[\s>]|<!doctype html/i.test(text)) problems.push("response is not an HTML page");
    const title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    if (title) info.title = title.slice(0, 80);
  } else if (!text.trim()) problems.push("empty response");
  return { ok: problems.length === 0, problems, warnings, info, data };
}

// generatedAt + source vintages from the first document that has them.
/**
 * Is the refresh loop alive? Judged only from the deploy-time api/v1/status.json: `checkedAt` (when the pipeline
 * last ran) and `refresh` (its outcome). generatedAt / dataChangedAt only move when a published number changes
 * (UN data changes every ~2 years), so they are reported as "numbers last changed" and never warn.
 */
export function assessFreshness(docs, now = new Date(), maxAgeDays = REFRESH_MAX_AGE_DAYS) {
  const status = docs.status && typeof docs.status === "object" ? docs.status : null;
  let numbersChangedAt = null;
  let numbersFrom = null;
  for (const [key, value] of [["status", status?.dataChangedAt], ["manifest", docs.manifest?.generatedAt], ["countries", docs.countries?.generatedAt], ["legacy", docs.legacy?.generatedAt]]) {
    if (value && !Number.isNaN(Date.parse(value))) {
      numbersChangedAt = new Date(value).toISOString();
      numbersFrom = key;
      break;
    }
  }
  const sourcesDoc = docs.manifest?.sources ? docs.manifest : status?.sources ? status : docs.countries ?? docs.legacy;
  const sources = describeSources(sourcesDoc?.sources ?? sourcesDoc?.meta?.sources);
  const base = { numbersChangedAt, numbersFrom, sources, checkedAt: null, ageDays: null, refresh: null, trigger: null, run: null };
  if (!status && docs.statusLocal) {
    return { ...base, level: "skip", note: "local build: status.json is written by CI at deploy time, so loop freshness is checked only on the live site" };
  }
  if (!status?.checkedAt || Number.isNaN(Date.parse(status.checkedAt))) {
    return { ...base, level: "warn", note: "api/v1/status.json is missing or has no checkedAt on the live site, so there is no proof the refresh loop ran" };
  }
  const checkedAt = new Date(status.checkedAt).toISOString();
  const ageDays = Math.round(((now - new Date(checkedAt)) / 86400000) * 10) / 10;
  const run = typeof status.run === "string" && status.run.startsWith("https://github.com/") ? status.run : null;
  const notes = [];
  let level = "pass";
  if (ageDays > maxAgeDays) {
    level = "warn";
    notes.push(`refresh loop last ran ${ageDays} days ago (threshold ${maxAgeDays})`);
  } else if (ageDays < -1) {
    level = "warn";
    notes.push("status.json checkedAt is in the future");
  } else notes.push(`refresh loop last ran ${ageDays} days ago`);
  if (status.refresh !== "success") {
    level = "warn";
    notes.push(`last refresh outcome was "${status.refresh ?? "missing"}"`);
  } else notes.push("outcome success");
  return { ...base, level, checkedAt, ageDays, refresh: status.refresh ?? null, trigger: status.trigger ?? null, run, note: notes.join("; ") };
}

const VINTAGE_KEY_RE = /updated|vintage|revision|retrieved|as_?of|version|edition|year|date|fetched|release/i;

export function describeSources(sources) {
  if (!sources || typeof sources !== "object") return [];
  const entries = Array.isArray(sources) ? sources.map((s, i) => [String(i), s]) : Object.entries(sources);
  return entries
    .filter(([, v]) => v && typeof v === "object")
    .map(([key, v]) => {
      const vintage = {};
      for (const [k, val] of Object.entries(v)) {
        if (VINTAGE_KEY_RE.test(k) && (typeof val === "string" || typeof val === "number")) vintage[k] = val;
      }
      const unavailable = Array.isArray(v.datasets) ? v.datasets.filter((d) => d?.status && d.status !== "ok").map((d) => String(d.id ?? "?")) : [];
      return { name: String(v.name ?? v.title ?? v.id ?? key).slice(0, 100), vintage, unavailable };
    });
}

// Status of the data refresh workflow from GitHub's workflow-runs API (newest first).
export function assessWorkflowRuns(runs, now = new Date(), maxAgeDays = 8) {
  if (!Array.isArray(runs) || runs.length === 0) return { level: "warn", note: "no runs of the refresh workflow found", latest: null, lastSuccessAt: null, inProgress: false };
  const pick = (r) => ({ status: r.status, conclusion: r.conclusion, event: r.event, createdAt: r.created_at, url: r.html_url, branch: r.head_branch });
  const latest = pick(runs[0]);
  const inProgress = runs.some((r) => r.status !== "completed");
  const lastCompleted = runs.find((r) => r.status === "completed");
  const lastSuccess = runs.find((r) => r.status === "completed" && r.conclusion === "success");
  const lastSuccessAt = lastSuccess?.created_at ?? null;
  const notes = [];
  let level = "pass";
  if (lastCompleted && lastCompleted.conclusion !== "success") {
    level = "warn";
    notes.push(`last completed run ended "${lastCompleted.conclusion}" (${lastCompleted.event}, ${lastCompleted.created_at})`);
  }
  if (!lastSuccessAt || (now - new Date(lastSuccessAt)) / 86400000 > maxAgeDays) {
    level = "warn";
    notes.push(lastSuccessAt ? `no successful run since ${lastSuccessAt}` : "no successful run in the recent history");
  }
  if (inProgress) notes.push("a run is in progress right now");
  return { level, note: notes.join("; ") || "last run succeeded", latest: pick(lastCompleted ?? runs[0]), newest: latest, lastSuccessAt, inProgress };
}

// Countries ranked by risk, best effort across plausible shapes.
export function extractTopRisk(data, n = 5) {
  const recs = findCountryRecords(data).filter((r) => r.iso3 !== "WLD");
  const scored = recs
    .map(({ iso3, name, record }) => {
      const risk = record?.risk && typeof record.risk === "object" ? record.risk : record;
      const score = num(risk?.score ?? risk?.riskScore ?? record?.riskScore);
      const rank = num(risk?.rank ?? record?.rank ?? record?.riskRank);
      return { iso3, name, score, rank, tier: risk?.tier ?? record?.tier ?? null };
    })
    .filter((r) => r.score != null || r.rank != null);
  if (!scored.length) return [];
  scored.sort((a, b) => (a.rank != null && b.rank != null ? a.rank - b.rank : (b.score ?? -Infinity) - (a.score ?? -Infinity)));
  return scored.slice(0, n);
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function fetchTarget(url, { fetchImpl = fetch, timeoutMs = 20000, retries = 2 } = {}) {
  const started = Date.now();
  let last = { status: 0, contentType: "", text: "", error: null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { "user-agent": "fertility-tracker-weekly-check (github.com/RostyslavDzhohola/fertility-tracker)", "cache-control": "no-cache" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      last = { status: res.status, contentType: res.headers.get("content-type") ?? "", text, error: null };
      if (res.status < 500) break;
    } catch (err) {
      last = { status: 0, contentType: "", text: "", error: err.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : err.message };
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return { ...last, ms: Date.now() - started };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Decide whether a target must be up. Reasons, strongest first:
//  - the home page always must;
//  - anything the live manifest advertises must;
//  - anything the site serves with HTTP 200 must be valid (deployed but broken is broken);
//  - the API manifest must, once a previous weekly check saw the API live (catches deploy-time files vanishing);
//  - anything present in the repo's public/ must, when the checked-out ref is the deployed branch.
export function requirement({ always, advertised, inRepo, expectDeployed, wasLive, served }) {
  if (always) return { required: true, reason: "site root" };
  if (advertised) return { required: true, reason: "listed in live API manifest" };
  if (served) return { required: true, reason: "deployed (HTTP 200) but invalid" };
  if (wasLive) return { required: true, reason: "was live in the previous weekly check" };
  if (inRepo && expectDeployed) return { required: true, reason: "in repo public/ on the deployed branch" };
  return { required: false, reason: inRepo ? "in repo, not on the deployed branch" : "planned, not in repo yet" };
}

export function levelFor(target) {
  if (target.ok) return target.warnings.length ? "warn" : "pass";
  return target.required ? "fail" : "warn";
}

/**
 * Check the live site and API.
 * @param {object} o
 * @param {string} o.siteUrl live site base URL
 * @param {string} o.repoRoot repo checkout, used to see which public/ files should be live
 * @param {boolean} o.expectDeployed true when the checkout is the branch Pages deploys (main)
 * @param {boolean} [o.deployInProgress] downgrade repo-derived failures while a deploy is running
 * @param {boolean} [o.apiWasLive] the previous weekly check saw the API manifest live
 * @param {boolean} [o.localBuild] checking a local server: deploy-only files (status.json) are not expected.
 *   Defaults to true for localhost / 127.0.0.1 site URLs.
 * @param {"all"|number} [o.countrySample] how many per-country files to fetch per template
 */
export async function runSiteChecks({ siteUrl, repoRoot, expectDeployed = false, deployInProgress = false, apiWasLive = false, localBuild, countrySample = "all", fetchImpl = fetch, concurrency = 8, timeoutMs = 20000, retries = 2 }) {
  siteUrl = normalizeSiteUrl(siteUrl);
  if (localBuild === undefined) localBuild = isLocalSite(siteUrl);
  const publicDir = path.join(repoRoot, "public");
  const urlFor = (p) => new URL(p, siteUrl).toString();
  const fetchOpts = { fetchImpl, timeoutMs, retries };
  const results = [];
  const docs = {};

  // 1. Manifest first: it decides the endpoint list.
  const manifestRes = await fetchTarget(urlFor(MANIFEST_PATH), fetchOpts);
  const manifestVal = validateResponse("manifest", manifestRes, { siteUrl });
  // A live manifest only replaces the fallback list when it is valid and lists endpoints we can find;
  // otherwise the repo copy, then the built-in contract list, keep every endpoint under check.
  const liveManifest = manifestVal.ok ? manifestVal.data : null;
  const liveEndpoints = liveManifest ? extractEndpoints(liveManifest, siteUrl) : [];
  const repoManifest = await readJson(path.join(publicDir, MANIFEST_PATH));
  const repoEndpoints = repoManifest ? extractEndpoints(repoManifest, siteUrl) : [];
  if (liveManifest) docs.manifest = liveManifest;
  let manifestSource = "builtin";
  let endpointPaths = BUILTIN_TARGETS.filter((t) => t.path.startsWith("api/v1/")).map((t) => t.path);
  if (liveEndpoints.length) {
    manifestSource = "live";
    endpointPaths = liveEndpoints;
  } else if (repoEndpoints.length) {
    manifestSource = "repo";
    endpointPaths = repoEndpoints;
  }
  const advertised = new Set(liveEndpoints);

  // 2. Assemble the target list (deduplicated by path).
  const targets = new Map();
  const add = (p, extra = {}) => {
    if (targets.has(p)) return Object.assign(targets.get(p), { ...extra, ...targets.get(p) });
    targets.set(p, { path: p, kind: extra.kind ?? kindFromPath(p), name: extra.name ?? null, ...extra });
  };
  for (const t of BUILTIN_TARGETS) if (!t.path.startsWith("api/v1/") || t.path === MANIFEST_PATH) add(t.path, t);
  for (const p of endpointPaths) add(p, { planned: true, fromManifest: manifestSource });
  if (!endpointPaths.includes(MANIFEST_PATH)) add(MANIFEST_PATH, { kind: "manifest", name: "API manifest", planned: true });
  if (!endpointPaths.includes(STATUS_PATH)) add(STATUS_PATH, { kind: "status", name: "Deploy status", planned: true });

  // 3. Country codes for templated endpoints: live countries.json, else the repo copy, else a fixed sample.
  const countriesPath = endpointPaths.find((p) => /countries\.json$/i.test(p)) ?? "api/v1/countries.json";
  const countriesRes = await fetchTarget(urlFor(countriesPath), fetchOpts);
  const countriesVal = validateResponse("json", countriesRes);
  if (countriesVal.ok) docs.countries = countriesVal.data;
  const countriesFromRepo = await readJson(path.join(publicDir, countriesPath));
  let codes = findCountryRecords(docs.countries ?? countriesFromRepo).map((r) => r.iso3);
  if (!codes.length) codes = ["WLD", "KOR", "JPN", "USA", "NGA", "IND", "ITA"];
  if (countrySample !== "all") {
    const n = Math.max(1, Number(countrySample) || 5);
    const preferred = ["WLD", "KOR", "JPN", "USA", "NGA"].filter((c) => codes.includes(c));
    codes = [...new Set([...preferred, ...codes])].slice(0, n);
  }

  // 4. Fetch everything (the manifest and countries responses are reused).
  const jobs = [];
  for (const t of targets.values()) {
    const inRepoTemplate = isTemplated(t.path);
    const paths = inRepoTemplate ? expandTemplate(t.path, codes) : [t.path];
    for (const p of paths) {
      jobs.push({ target: t, path: p, template: inRepoTemplate ? t.path : null });
    }
  }
  const cache = new Map([
    [MANIFEST_PATH, manifestRes],
    [countriesPath, countriesRes],
  ]);
  const checked = await mapLimit(jobs, concurrency, async (job) => {
    const repoFile = path.join(publicDir, job.path === "" || job.path.endsWith("/") ? path.join(job.path, "index.html") : job.path);
    const inRepo = await exists(repoFile);
    const t = job.target;
    if (t.legacy && !inRepo) return null; // legacy file removed from the repo: stop checking it
    const res = cache.get(job.path) ?? (await fetchTarget(urlFor(job.path), fetchOpts));
    const val = validateResponse(t.kind, res, { siteUrl });
    if (res.error) val.problems.unshift(res.error);
    const req = requirement({ always: t.always, advertised: advertised.has(t.path), inRepo, expectDeployed, wasLive: apiWasLive && job.path === MANIFEST_PATH, served: res.status === 200 && !val.ok });
    const result = {
      path: job.path,
      template: job.template,
      url: urlFor(job.path),
      kind: t.kind,
      name: t.name,
      planned: !!t.planned,
      status: res.status,
      ms: res.ms,
      ok: val.ok,
      problems: val.problems,
      warnings: val.warnings,
      info: val.info,
      required: req.required,
      reason: req.reason,
      inRepo,
    };
    if (!result.ok && result.required && req.reason.startsWith("in repo") && deployInProgress) {
      result.required = false;
      result.reason += " (deploy in progress, not counted as broken)";
    }
    if (DEPLOY_ONLY.has(job.path) && localBuild) {
      result.required = false;
      result.reason = "deploy-only (written by CI at deploy time), not expected in a local build";
    } else if (DEPLOY_ONLY.has(job.path) && !result.required) {
      result.reason = "deploy-only (written by CI); required once the live manifest lists it";
    }
    if (!result.ok && !result.required && res.status === 404) result.warnings.push(t.planned ? "not live yet" : "not found");
    result.level = levelFor(result);
    if (DEPLOY_ONLY.has(job.path) && localBuild && res.status === 404) {
      result.level = "skip";
      result.warnings = [];
    }
    if (job.path === STATUS_PATH && val.ok) docs.status = val.data;
    if (t.kind === "json" && /risk\.json$/i.test(job.path) && val.data) docs.risk = val.data;
    if (job.path === "data/fertility.json" && val.data) docs.legacy = val.data;
    return result;
  });
  for (const r of checked) if (r) results.push(r);

  const apiLive = !!liveManifest;
  if (localBuild && !docs.status) docs.statusLocal = true;
  return {
    siteUrl,
    localBuild,
    manifestSource,
    apiLive,
    countryCodesChecked: codes.length,
    targets: results,
    freshness: assessFreshness(docs),
    topRisk: extractTopRisk(docs.risk ?? docs.countries),
    countryIndexSource: docs.countries ?? countriesFromRepo ?? docs.legacy ?? null,
  };
}
