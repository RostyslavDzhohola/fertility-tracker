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

// ---------- Activity since the weekly agent last handled an issue ----------

// The weekly agent ends every reply with this line; see docs/weekly-agent-prompt.md step 8.
export const HANDLED_MARKER_RE = /<!--\s*fertility-tracker:handled(?:\s+\d{4}-\d{2}-\d{2})?\s*-->/;
export const handledMarker = (date) => `<!-- fertility-tracker:handled ${new Date(date).toISOString().slice(0, 10)} -->`;
// Only these can mark an issue handled, so a stranger's comment cannot hide feedback from the agent.
export const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function isBotUser(user) {
  return user?.type === "Bot" || /\[bot\]$/i.test(user?.login ?? "");
}

const latest = (...dates) => dates.filter(Boolean).map((d) => new Date(d).toISOString()).sort().at(-1) ?? null;

/**
 * When was the issue last handled (newest trusted comment carrying the marker), and when did a human last do
 * something that deserves a reply (opened it, commented without the marker, edited the body)? Bot activity,
 * label changes and closing are maintenance and never count.
 * @param {object} issue GitHub issue
 * @param {object[]} comments its comments (GitHub REST shape)
 * @param {{lastEditedAt?: string|null, editedByBot?: boolean}} [edit] body edit time from GraphQL
 */
export function assessActivity(issue, comments = [], { lastEditedAt = null, editedByBot = false } = {}) {
  let handledAt = null;
  const human = [isBotUser(issue.user) ? null : issue.created_at];
  for (const c of comments) {
    const at = latest(c.created_at, c.updated_at);
    if (HANDLED_MARKER_RE.test(c.body ?? "") && (TRUSTED_ASSOCIATIONS.has(c.author_association) || isBotUser(c.user))) handledAt = latest(handledAt, at);
    else if (!isBotUser(c.user)) human.push(at);
  }
  if (lastEditedAt && !editedByBot) human.push(lastEditedAt);
  const lastHumanAt = latest(...human);
  return { handledAt, lastHumanAt, newSinceHandled: handledAt ? !!lastHumanAt && lastHumanAt > handledAt : null };
}

/**
 * Pick the issues the weekly report covers. A feedback issue needs attention when
 *  - it was never handled (no marker reply) and is new, recently updated, or still open without `triaged`; or
 *  - a human commented or edited after the last handled reply, whatever its age, state or labels.
 * Handled issues with no human activity since are listed separately so the agent leaves them alone.
 * @param {Map<number, {handledAt: string|null, lastHumanAt: string|null}>} [activity] from assessActivity()
 */
export function selectIssues(issues, { since, labels = FEEDBACK_TYPES, activity = new Map() } = {}) {
  const sinceMs = new Date(since).getTime();
  const seen = new Set();
  const attention = [];
  const handled = [];
  const other = [];
  for (const issue of issues) {
    if (!issue || issue.pull_request || seen.has(issue.number)) continue;
    seen.add(issue.number);
    const names = labelNames(issue);
    if (names.includes(CHECK_LABEL)) continue;
    const isFeedback = names.some((n) => labels.includes(n));
    const recent = new Date(issue.updated_at).getTime() >= sinceMs;
    if (!isFeedback) {
      if (recent) other.push(issue);
      continue;
    }
    const act = activity.get(issue.number);
    if (act?.handledAt) {
      if (act.newSinceHandled) attention.push({ issue, reason: "new human activity since last handled", activity: act });
      else handled.push({ issue, activity: act });
    } else if (new Date(issue.created_at).getTime() >= sinceMs) attention.push({ issue, reason: "new", activity: act });
    else if (recent) attention.push({ issue, reason: "updated, not yet handled", activity: act });
    else if (issue.state === "open" && !names.includes("triaged")) attention.push({ issue, reason: "open, not yet handled", activity: act });
  }
  return { attention, handled, other };
}

// Feedback issues whose comments and edits the check must read: recently updated or still open.
export function activityCandidates(issues, { since, labels = FEEDBACK_TYPES } = {}) {
  const sinceMs = new Date(since).getTime();
  return issues.filter((i) => {
    const names = labelNames(i);
    return !i.pull_request && !names.includes(CHECK_LABEL) && names.some((n) => labels.includes(n)) && (i.state === "open" || new Date(i.updated_at).getTime() >= sinceMs);
  });
}

export function summarizeIssue(issue, { since, index, reason = null, activity = null } = {}) {
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
    reason,
    lastHandledAt: activity?.handledAt ?? null,
    lastHumanAt: activity?.lastHumanAt ?? null,
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
