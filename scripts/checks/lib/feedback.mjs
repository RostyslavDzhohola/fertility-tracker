// Feedback issues: select, parse issue-form bodies, normalise countries, group by country and type.
// Everything read from an issue is untrusted user text; render it only through safeInline().

export const FEEDBACK_TYPES = ["data-problem", "feature-request", "feedback"]; // precedence when an issue has several
export const CHECK_LABEL = "weekly-check";
export const NO_COUNTRY = "(no country given)";

// A few common names the data sources spell differently. Keys are lower-case. A Map, so user text such as
// "constructor" can never hit an inherited object property.
const ALIASES = new Map(Object.entries({
  usa: "USA", us: "USA", "u.s.": "USA", "u.s.a.": "USA", america: "USA", "united states of america": "USA",
  uk: "GBR", "u.k.": "GBR", britain: "GBR", "great britain": "GBR", england: "GBR",
  "south korea": "KOR", korea: "KOR", "republic of korea": "KOR", "korea, rep.": "KOR",
  "north korea": "PRK", russia: "RUS", "russian federation": "RUS", iran: "IRN", vietnam: "VNM", "viet nam": "VNM",
  turkey: "TUR", turkiye: "TUR", "türkiye": "TUR", czechia: "CZE", "czech republic": "CZE", syria: "SYR",
  laos: "LAO", "ivory coast": "CIV", "cote d'ivoire": "CIV", "côte d'ivoire": "CIV", "dr congo": "COD",
  drc: "COD", "democratic republic of congo": "COD", "democratic republic of the congo": "COD", "republic of congo": "COG",
  taiwan: "TWN", "hong kong": "HKG", macau: "MAC", macao: "MAC", bolivia: "BOL", venezuela: "VEN", tanzania: "TZA",
  moldova: "MDA", palestine: "PSE", "cape verde": "CPV", "cabo verde": "CPV", swaziland: "SWZ", eswatini: "SWZ",
  burma: "MMR", myanmar: "MMR", "east timor": "TLS", "timor-leste": "TLS", micronesia: "FSM", world: "WLD", global: "WLD",
}));

export function issueType(labels = []) {
  const names = labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
  return FEEDBACK_TYPES.find((t) => names.includes(t)) ?? "other";
}

export function labelNames(issue) {
  return (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
}

// Split an issue-form body ("### Label\n\nvalue") into { lower-cased label: value }. "_No response_" → "".
export function parseIssueForm(body) {
  const out = {};
  if (typeof body !== "string") return out;
  const parts = body.replace(/\r\n/g, "\n").split(/^###[ \t]+(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i].trim().toLowerCase();
    const value = (parts[i + 1] ?? "").trim();
    out[label] = value === "_No response_" ? "" : value;
  }
  return out;
}

export function findField(sections, patterns) {
  for (const [label, value] of Object.entries(sections)) {
    if (patterns.some((p) => (p instanceof RegExp ? p.test(label) : label === p.toLowerCase()))) return value;
  }
  return "";
}

// Country lookup from countries.json-like records ({iso3, name}).
export function buildCountryIndex(records = []) {
  const byIso = new Map();
  const byName = new Map();
  for (const r of records) {
    if (!r?.iso3) continue;
    byIso.set(r.iso3, r.name ?? r.iso3);
    if (r.name) byName.set(simplify(r.name), r.iso3);
  }
  return { byIso, byName };
}

function simplify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^the\s+/, "").replace(/[.\s]+$/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeCountry(raw, index = buildCountryIndex()) {
  const text = String(raw ?? "").split("\n")[0].trim().replace(/^["'`*_]+|["'`*_]+$/g, "");
  if (!text) return { key: NO_COUNTRY, iso3: null, name: null, raw: "" };
  const upper = text.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && (index.byIso.has(upper) || index.byIso.size === 0)) {
    return { key: upper, iso3: upper, name: index.byIso.get(upper) ?? null, raw: text };
  }
  const simple = simplify(text);
  const candidate = index.byName.get(simple) ?? ALIASES.get(simple) ?? ALIASES.get(text.toLowerCase());
  const iso3 = typeof candidate === "string" && /^[A-Z]{3}$/.test(candidate) ? candidate : null;
  if (iso3) return { key: iso3, iso3, name: index.byIso.get(iso3) ?? null, raw: text };
  // "Japan (JPN)" or "JPN - Japan"
  const code = text.match(/\b([A-Z]{3})\b/)?.[1];
  if (code && index.byIso.has(code)) return { key: code, iso3: code, name: index.byIso.get(code), raw: text };
  return { key: `?${simple.slice(0, 40)}`, iso3: null, name: null, raw: text };
}

/**
 * Pick the issues the weekly report covers: feedback issues updated within the window, plus open ones
 * nobody has triaged yet (the backlog). Pull requests and weekly-check issues are dropped.
 */
export function selectIssues(issues, { since, labels = FEEDBACK_TYPES } = {}) {
  const sinceMs = new Date(since).getTime();
  const seen = new Set();
  const inWindow = [];
  const backlog = [];
  const other = [];
  for (const issue of issues) {
    if (!issue || issue.pull_request || seen.has(issue.number)) continue;
    seen.add(issue.number);
    const names = labelNames(issue);
    if (names.includes(CHECK_LABEL)) continue;
    const isFeedback = names.some((n) => labels.includes(n));
    const recent = new Date(issue.updated_at).getTime() >= sinceMs;
    if (isFeedback && recent) inWindow.push(issue);
    else if (isFeedback && issue.state === "open" && !names.includes("triaged")) backlog.push(issue);
    else if (!isFeedback && recent) other.push(issue);
  }
  return { inWindow, backlog, other };
}

export function summarizeIssue(issue, { since, index } = {}) {
  const names = labelNames(issue);
  const sections = parseIssueForm(issue.body);
  const countryRaw = findField(sections, [/countr/]);
  const page = findField(sections, [/^page link/, /^page\b/]);
  return {
    number: issue.number,
    title: issue.title ?? "",
    url: issue.html_url,
    state: issue.state,
    type: issueType(issue.labels),
    labels: names,
    country: normalizeCountry(countryRaw, index),
    page: page.split("\n")[0].trim(),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    isNew: since ? new Date(issue.created_at) >= new Date(since) : false,
    triaged: names.includes("triaged"),
    needsHuman: names.includes("needs-human"),
    comments: issue.comments ?? 0,
  };
}

const TYPE_ORDER = Object.fromEntries([...FEEDBACK_TYPES, "other"].map((t, i) => [t, i]));

// Group summarised items by country (most items first; no-country last), and count by type.
export function groupFeedback(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.country?.key ?? NO_COUNTRY;
    if (!groups.has(key)) groups.set(key, { key, iso3: item.country?.iso3 ?? null, name: item.country?.name ?? null, raw: item.country?.raw ?? "", items: [] });
    groups.get(key).items.push(item);
  }
  const byCountry = [...groups.values()];
  for (const g of byCountry) g.items.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.number - b.number);
  // Recognised countries first (most items first), then unrecognised text, then no country.
  const tier = (g) => (g.key === NO_COUNTRY ? 2 : g.iso3 ? 0 : 1);
  byCountry.sort((a, b) => tier(a) - tier(b) || b.items.length - a.items.length || a.key.localeCompare(b.key));
  const byType = {};
  for (const t of [...FEEDBACK_TYPES, "other"]) byType[t] = 0;
  for (const item of items) byType[item.type] = (byType[item.type] ?? 0) + 1;
  return {
    byCountry,
    byType,
    total: items.length,
    newCount: items.filter((i) => i.isNew).length,
    openCount: items.filter((i) => i.state === "open").length,
  };
}

// Render untrusted text as one inline code span: GitHub parses nothing inside code spans, so no mention,
// issue reference, link, autolink (http://, www., email) or HTML can survive. One line, bounded length.
// Not for table cells (a "|" still splits a GFM table row even inside a code span).
export function safeInline(text, max = 100) {
  let s = String(text ?? "")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  if (!s) return "``";
  const longestRun = Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence} ${s} ${fence}`;
}
