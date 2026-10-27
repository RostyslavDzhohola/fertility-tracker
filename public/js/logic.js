// Pure logic shared by the page, the social card and the tests (test/frontend/logic.test.mjs).
// No DOM, no d3: everything here runs in Node as well as the browser.

export const REPLACEMENT = 2.1;
export const MINUS = "−";
export const SITE_URL = "https://rostyslavdzhohola.github.io/fertility-tracker/";
export const FALLBACK_EMAIL = "andromedus+fertility@mail.grokbot.com";
export const GEN_YEARS = 30;

// ---------------------------------------------------------------- tiers and color ramps (DESIGN §2.4, §4.1)

export const TIERS = ["Low", "Moderate", "Elevated", "High", "Critical"];
export const TIER_COLORS = {
  Low: "#2A3A5E",
  Moderate: "#5B4A94",
  Elevated: "#B4508C",
  High: "#F2713F",
  Critical: "#FFCB52",
};
export const DEFAULT_TIER_MINS = { Low: 0, Moderate: 20, Elevated: 40, High: 55, Critical: 70 };

// Lower bound inclusive; the value is rounded to 2 decimals before binning.
export const TFR_BINS = [
  { max: 1.0, label: "Under 1", color: "#FFCB52" },
  { max: 1.3, label: "1–1.3", color: "#F2713F" },
  { max: 1.6, label: "1.3–1.6", color: "#B9563A" },
  { max: 2.1, label: "1.6–2.1", color: "#7A4A34" },
  { max: 3.0, label: "2.1–3", color: "#2C4C72" },
  { max: 4.0, label: "3–4", color: "#3779B4" },
  { max: Infinity, label: "4+", color: "#73B7EA" },
];
export const NODATA = "nodata";

export function tierOf(rec) {
  const t = rec?.risk?.tier;
  return TIERS.includes(t) ? t : null;
}

export function tierClass(tier) {
  return tier ? `tier-${tier.toLowerCase()}` : "tier-none";
}

export function tfrValue(rec) {
  const v = rec?.tfr?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function tfrBinIndex(tfr) {
  if (typeof tfr !== "number" || !Number.isFinite(tfr)) return -1;
  const v = Math.round(tfr * 100) / 100;
  for (let i = 0; i < TFR_BINS.length; i++) if (v < TFR_BINS[i].max) return i;
  return TFR_BINS.length - 1;
}

// The legend key a place belongs to in a color mode: a tier name, "tfr-<bin>", or "nodata".
export function legendKey(rec, mode) {
  if (mode === "tfr") {
    const i = tfrBinIndex(tfrValue(rec));
    return i < 0 ? NODATA : `tfr-${i}`;
  }
  return tierOf(rec) ?? NODATA;
}

export function colorForKey(key) {
  if (key === NODATA || key == null) return null;
  if (key.startsWith("tfr-")) return TFR_BINS[Number(key.slice(4))]?.color ?? null;
  return TIER_COLORS[key] ?? null;
}

export function colorFor(rec, mode) {
  return colorForKey(legendKey(rec, mode));
}

export function legendItems(mode) {
  if (mode === "tfr") return TFR_BINS.map((b, i) => ({ key: `tfr-${i}`, label: b.label, color: b.color }));
  return TIERS.map((t) => ({ key: t, label: t, color: TIER_COLORS[t] }));
}

export function countByKey(records, mode) {
  const counts = new Map();
  for (const r of records) {
    const k = legendKey(r, mode);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------- number formatting (DESIGN §8.6)

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

export function sig3(n) {
  if (!isNum(n) || n === 0) return 0;
  const digits = Math.floor(Math.log10(Math.abs(n))) + 1;
  const p = 3 - digits;
  const m = Math.pow(10, Math.abs(p));
  return p >= 0 ? Math.round(n * m) / m : Math.round(n / m) * m;
}

function trimZeros(s) {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

function signOf(n, plus) {
  if (n < 0) return MINUS;
  return plus && n > 0 ? "+" : "";
}

export function fmtTfr(v) {
  if (!isNum(v)) return "–";
  return (Math.round(v * 100) / 100).toFixed(2);
}

export function fmtInt(n) {
  if (!isNum(n)) return "–";
  return (n < 0 ? MINUS : "") + nf.format(Math.abs(Math.round(n)));
}

// "51.7M", "820K", "8.22B", "640". 3 significant digits, trailing zeros trimmed.
export function fmtCompact(n, { plus = false } = {}) {
  if (!isNum(n)) return "–";
  const s = signOf(n, plus);
  const a = Math.abs(n);
  if (Math.round(a) < 1000) return s + String(Math.round(a));
  const r = sig3(a);
  for (const [u, suf] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ]) {
    if (r >= u) {
      const v = r / u;
      const int = Math.floor(Math.log10(v)) + 1;
      return s + trimZeros(v.toFixed(Math.max(0, 3 - int))) + suf;
    }
  }
  return s + String(r);
}

// "21.9 million", "8.22 billion", "820,000", "640".
export function fmtWords(n) {
  if (!isNum(n)) return "–";
  const s = n < 0 ? MINUS : "";
  const a = Math.abs(n);
  if (Math.round(a) < 1000) return s + String(Math.round(a));
  const r = sig3(a);
  if (r >= 1e9) return s + trimZeros((r / 1e9).toFixed(Math.max(0, 3 - (Math.floor(Math.log10(r / 1e9)) + 1)))) + " billion";
  if (r >= 1e6) return s + trimZeros((r / 1e6).toFixed(Math.max(0, 3 - (Math.floor(Math.log10(r / 1e6)) + 1)))) + " million";
  return s + nf.format(r);
}

// Yearly flows: "+231,000", "−352,000"; exact below 1,000; "+70.5 million" from a million up.
export function fmtFlow(n, { plus = true } = {}) {
  if (!isNum(n)) return "–";
  const a = Math.abs(n);
  if (sig3(a) >= 1e6) return signOf(n, plus) + fmtWords(a);
  const v = a < 1000 ? Math.round(a) : sig3(a);
  if (v === 0) return "0";
  return signOf(n, plus) + nf.format(v);
}

// "−58%", "+12%", "−0.4%". Integer with sign; one decimal when |x| < 1.
export function fmtPct(x, { plus = true } = {}) {
  if (!isNum(x)) return "–";
  const a = Math.abs(x);
  const str = a < 1 ? (Math.round(a * 10) / 10).toFixed(1) : String(Math.round(a));
  if (Number(str) === 0) return "0%";
  return signOf(x, plus) + str + "%";
}

export function fmtRate(x, { plus = false } = {}) {
  if (!isNum(x)) return "–";
  const str = (Math.round(Math.abs(x) * 10) / 10).toFixed(1);
  if (Number(str) === 0) return "0.0";
  return signOf(x, plus) + str;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Axis ticks: "40M", "200K", "1.5", "0".
export function fmtTick(v, { kind = "count" } = {}) {
  if (kind === "tfr") return trimZeros(v.toFixed(1));
  if (v === 0) return "0";
  return fmtCompact(v);
}

export function niceTicks(min, max, count = 4) {
  if (!isNum(min) || !isNum(max)) return [0];
  if (min === max) {
    if (max === 0) return [0, 1];
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks.map((t) => (Math.abs(t) < step / 1e6 ? 0 : Number(t.toPrecision(12))));
}

// ---------------------------------------------------------------- generations (DESIGN §5.3, §5.9)

export function generationRatio(tfr) {
  return isNum(tfr) ? tfr / REPLACEMENT : null;
}

export function generationCounts(tfr, n = 5) {
  const r = generationRatio(tfr);
  if (r == null) return [];
  return Array.from({ length: n }, (_, i) => 100 * Math.pow(r, i));
}

export function nextGeneration(tfr) {
  const r = generationRatio(tfr);
  return r == null ? null : Math.round(100 * r);
}

// ≥ 10 → integer; < 10 → one decimal.
export function fmtCount(v) {
  if (!isNum(v)) return "–";
  const one = Math.round(v * 10) / 10;
  return one >= 10 ? String(Math.round(v)) : one.toFixed(1);
}

// How full each of the 100 dots is (0..1), filled row by row from the top-left.
export function dotFills(count) {
  const c = Math.max(0, Math.min(100, isNum(count) ? count : 0));
  return Array.from({ length: 100 }, (_, i) => Math.max(0, Math.min(1, c - i)));
}

// ---------------------------------------------------------------- URL hash (DESIGN §3.5)

// Returns { iso3, normalized } for a selection hash naming a known place, else null.
export function parseSelectionHash(hash, known) {
  const m = /^#([A-Za-z]{3})$/.exec(hash ?? "");
  if (!m) return null;
  const iso3 = m[1].toUpperCase();
  const has = typeof known === "function" ? known(iso3) : known?.has?.(iso3);
  if (!has) return null;
  return { iso3, normalized: m[1] !== iso3 };
}

export function isSelectionLikeHash(hash) {
  return /^#[A-Za-z]{3}$/.test(hash ?? "");
}

// ---------------------------------------------------------------- feedback links (DESIGN §7)

export function pageUrl(iso3, siteUrl = SITE_URL) {
  const base = siteUrl.endsWith("/") ? siteUrl : siteUrl + "/";
  return iso3 ? `${base}#${iso3}` : base;
}

function query(params) {
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function appendQuery(url, params) {
  if (!params.length) return url;
  return url + (url.includes("?") ? "&" : "?") + query(params);
}

function countryParam(ctx) {
  return ctx.iso3 === "WLD" ? "World" : ctx.iso3;
}

// ctx = { iso3, name, siteUrl }
export function buildIssueUrl(feedback, templateKey, ctx) {
  const t = feedback?.github?.templates?.[templateKey];
  if (!t?.newIssueUrl) return null;
  const fields = t.fields ?? {};
  const params = [];
  const name = ctx?.name;
  if (name) params.push(["title", `${t.titlePrefix ?? ""}${name}: `]);
  if (ctx?.iso3 && "country" in fields) params.push(["country", countryParam(ctx)]);
  if ("page" in fields) params.push(["page", pageUrl(ctx?.iso3, ctx?.siteUrl ?? feedback?.site?.url ?? SITE_URL)]);
  return appendQuery(t.newIssueUrl, params);
}

// The chooser passes parameters through to every template, so only send the field ids all templates share.
export function buildChooserUrl(feedback, ctx) {
  const gh = feedback?.github;
  if (!gh?.chooserUrl) return null;
  const templates = Object.values(gh.templates ?? {});
  const shared = (key) => templates.length > 0 && templates.every((t) => key in (t.fields ?? {}));
  const params = [];
  if (ctx?.iso3 && shared("country")) params.push(["country", countryParam(ctx)]);
  if (shared("page")) params.push(["page", pageUrl(ctx?.iso3, ctx?.siteUrl ?? feedback?.site?.url ?? SITE_URL)]);
  return appendQuery(gh.chooserUrl, params);
}

export function buildMailto(feedback, ctx) {
  const address = feedback?.email?.address || FALLBACK_EMAIL;
  const subjectBase = feedback?.email?.subject || "Fertility Tracker feedback";
  const subject = ctx?.name ? `${subjectBase}: ${ctx.name}` : subjectBase;
  const body = `Page: ${pageUrl(ctx?.iso3, ctx?.siteUrl ?? feedback?.site?.url ?? SITE_URL)}\n\nWhat should we fix or add?\n`;
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function xHandle(feedback) {
  const h = feedback?.x?.handle;
  if (typeof h !== "string") return null;
  const clean = h.trim().replace(/^@/, "");
  if (!clean || clean.startsWith("TODO_") || !/^[A-Za-z0-9_]{1,15}$/.test(clean)) return null;
  return clean;
}

export function xProfileUrl(feedback) {
  const h = xHandle(feedback);
  if (!h) return null;
  const tpl = feedback?.x?.urlTemplate || "https://x.com/{handle}";
  return tpl.replace("{handle}", encodeURIComponent(h));
}

// ---------------------------------------------------------------- search (DESIGN §3.6)

export const ALIASES = {
  KOR: ["Korea", "Republic of Korea"],
  PRK: ["North Korea", "DPRK"],
  GBR: ["UK", "Britain", "Great Britain", "England"],
  USA: ["US", "America", "United States of America"],
  RUS: ["Russian Federation"],
  TUR: ["Türkiye", "Turkey"],
  CZE: ["Czech Republic", "Czechia"],
  CIV: ["Ivory Coast", "Côte d'Ivoire"],
  MMR: ["Burma"],
  NLD: ["Holland"],
  MAC: ["Macau"],
  COD: ["DRC", "Congo-Kinshasa"],
  COG: ["Congo-Brazzaville"],
  SWZ: ["Swaziland", "Eswatini"],
  MKD: ["Macedonia"],
  CPV: ["Cabo Verde"],
  TLS: ["East Timor"],
  VAT: ["Holy See"],
  PSE: ["Palestine"],
  WLD: ["World", "Earth", "Global"],
};

const MARKS = /[̀-ͯ]/g;
const DROP = /['’‘.]/;
const SPACE = /[^\p{L}\p{N}]/u;

// Normalize one character: may return "", " " or several characters.
function normChar(c) {
  if (DROP.test(c)) return "";
  const base = c.normalize("NFD").replace(MARKS, "").toLowerCase();
  return base.replace(new RegExp(SPACE.source, "gu"), " ");
}

export function normalizeText(s) {
  let out = "";
  for (const c of String(s ?? "")) out += normChar(c);
  return out.replace(/\s+/g, " ").trim();
}

// [start, end) in the original string for the first occurrence of the normalized query, or null.
export function matchRange(text, q) {
  const nq = normalizeText(q);
  if (!nq) return null;
  let norm = "";
  const map = []; // map[i] = index in the original string of norm[i]
  let i = 0;
  for (const c of String(text)) {
    const n = normChar(c);
    for (const ch of n) {
      norm += ch;
      map.push(i);
    }
    i += c.length;
  }
  const at = norm.indexOf(nq);
  if (at < 0) return null;
  const lastIdx = map[at + nq.length - 1];
  const lastChar = String(text).codePointAt(lastIdx) > 0xffff ? 2 : 1;
  return [map[at], lastIdx + lastChar];
}

function scorePlace(place, nq) {
  const name = normalizeText(place.name);
  const code = place.iso3.toLowerCase();
  const aliases = (ALIASES[place.iso3] ?? []).map(normalizeText);
  if (name === nq || code === nq || aliases.includes(nq)) return 0;
  if (name.startsWith(nq)) return 1;
  if (name.split(" ").some((w) => w.startsWith(nq))) return 2;
  if (aliases.some((a) => a.startsWith(nq) || a.split(" ").some((w) => w.startsWith(nq)))) return 3;
  if (name.includes(nq) || aliases.some((a) => a.includes(nq))) return 4;
  return -1;
}

// places: [{ iso3, name, population }]. Returns up to `limit` places, best first.
export function searchPlaces(places, q, limit = 8) {
  const nq = normalizeText(q);
  if (!nq) return [];
  const hits = [];
  for (const p of places) {
    const s = scorePlace(p, nq);
    if (s >= 0) hits.push({ p, s });
  }
  hits.sort((a, b) => a.s - b.s || (b.p.population ?? 0) - (a.p.population ?? 0) || a.p.name.localeCompare(b.p.name));
  return hits.slice(0, limit).map((h) => h.p);
}

// ---------------------------------------------------------------- ordering (DESIGN §4.3, §4.4)

// Ranked places first (risk mode: by API rank; tfr mode: ascending births per woman), then the unranked.
export function orderPlaces(records, mode) {
  const list = records.filter((r) => r.iso3 !== "WLD");
  const byTfr = (a, b) => (tfrValue(a) ?? 99) - (tfrValue(b) ?? 99) || a.name.localeCompare(b.name);
  const byScore = (a, b) =>
    (b.risk?.score ?? -1) - (a.risk?.score ?? -1) || (tfrValue(a) ?? 99) - (tfrValue(b) ?? 99) || a.name.localeCompare(b.name);
  const isRanked = (r) => r.ranked === true && Number.isInteger(r.risk?.rank);
  const ranked = list.filter(isRanked);
  const unranked = list.filter((r) => !isRanked(r));
  if (mode === "tfr") {
    ranked.sort(byTfr);
    unranked.sort(byTfr);
  } else {
    ranked.sort((a, b) => a.risk.rank - b.risk.rank);
    unranked.sort(byScore);
  }
  return { ranked, unranked };
}

export function rankLabel(rec, n) {
  if (!rec) return "";
  if (rec.iso3 === "WLD") return "The world as a whole isn't scored";
  if (Number.isInteger(rec.risk?.rank)) return `#${rec.risk.rank} of ${n}`;
  return (rec.flags ?? []).includes("small-population") ? "Not ranked (under 100,000 people)" : "Not ranked (incomplete data)";
}

// ---------------------------------------------------------------- keyboard map navigation (DESIGN §2.11)

// points: [{ iso3, x, y }]; dir: "left" | "right" | "up" | "down". Lowest score within ±60° wins.
export function nearestInDirection(points, from, dir) {
  const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  if (!v || !from) return null;
  let best = null;
  let bestScore = Infinity;
  const cos60 = Math.cos(Math.PI / 3);
  for (const p of points) {
    if (p.iso3 === from.iso3) continue;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-9) continue;
    const cos = (dx * v[0] + dy * v[1]) / dist;
    if (cos < cos60 - 1e-9) continue;
    const score = dist * (1 + 2 * (1 - cos));
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------- copy (DESIGN §5, §8)

export function possessive(name) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function subject(rec, { start = false, own = false } = {}) {
  if (rec.iso3 === "WLD") {
    const w = start ? "The world" : "the world";
    return own ? `${w}'s` : w;
  }
  return own ? possessive(rec.name) : rec.name;
}

export function tierLabel(tier) {
  return tier ? `${tier} decline risk` : "Not scored";
}

export function summarySentence(rec, detail) {
  const tfr = tfrValue(rec);
  const t = fmtTfr(tfr);
  const pct = rec.projection?.change2100Pct;
  const pop2100 = rec.projection?.population2100;
  if (rec.iso3 === "WLD") {
    const peak = detail?.projection?.peakPopulation;
    const peakYear = rec.projection?.peakYear;
    const tail = peak && peakYear ? ` The UN projects the world population to peak at ${fmtWords(peak)} around ${peakYear}.` : "";
    const rel = tfr != null && tfr >= REPLACEMENT ? "just above" : "just below";
    return `The world has ${t} births per woman, ${rel} the 2.1 replacement level.${tail}`;
  }
  if (tfr == null) return `${rec.name} has no recent births-per-woman figure in our sources.`;
  if (tfr < REPLACEMENT) {
    if (pct != null && pct < 0) {
      const how = tfr < 1.5 ? "far below" : "below";
      return `${rec.name} has ${t} births per woman, ${how} the 2.1 needed to keep a population steady. The UN projects ${fmtWords(pop2100)} people by 2100, ${fmtPct(Math.abs(pct), { plus: false })} fewer than today.`;
    }
    if (pct != null) {
      return `${rec.name} has ${t} births per woman, below replacement, but immigration and a young population keep it growing for now. The UN projects ${fmtPct(pct)} by 2100.`;
    }
    return `${rec.name} has ${t} births per woman, below the 2.1 needed to keep a population steady.`;
  }
  const how = tfr < 2.4 ? "close to" : "above";
  const proj = pop2100 != null && pct != null ? ` The UN projects ${fmtWords(pop2100)} people by 2100 (${fmtPct(pct)}).` : "";
  return `${rec.name} has ${t} births per woman, ${how} the 2.1 replacement level.${proj}`;
}

export function populationTakeaway(rec, lastEstimateYear) {
  const p = rec.projection ?? {};
  const pct = p.change2100Pct;
  const peak = p.peakYear;
  if (pct == null) return `UN population estimates and projection for ${subject(rec)}.`;
  if (peak != null && peak <= lastEstimateYear && pct < 0)
    return `${subject(rec, { start: true, own: true })} population peaked in ${peak} and is projected to fall ${fmtPct(Math.abs(pct), { plus: false })} by 2100.`;
  if (peak != null && peak > lastEstimateYear && peak < 2100)
    return `${subject(rec, { start: true })} keeps growing until about ${peak}, then the UN expects a slow decline.`;
  if (pct >= 0) return `${subject(rec, { start: true, own: true })} population keeps growing through 2100, up ${fmtPct(pct, { plus: false })} from today.`;
  return `${subject(rec, { start: true, own: true })} population is projected to change ${fmtPct(pct)} by 2100.`;
}

export function waterfallTakeaway(rec) {
  const c = rec.components;
  if (!c || c.births == null || c.deaths == null) return `No recent births and deaths data for ${subject(rec)}.`;
  const B = c.births;
  const D = c.deaths;
  const M = c.netMigration ?? 0;
  const total = B - D + M;
  const year = c.year;
  const gap = D - B;
  if (B > D && M === 0) return `Births outnumber deaths: ${fmtFlow(total)} people in ${year}.`;
  if (B > D && M >= 0) return `Births outnumber deaths and more people arrive than leave: ${fmtFlow(total)} people in ${year}.`;
  if (B > D) return `Births outnumber deaths, but ${fmtFlow(Math.abs(M), { plus: false })} more people leave than arrive each year.`;
  if (M >= gap) return `More deaths than births, but immigration more than fills the gap: ${fmtFlow(total)} people in ${year}.`;
  if (M > 0) return `Deaths outnumber births by ${fmtFlow(gap, { plus: false })}. Immigration covers ${Math.round((100 * M) / gap)}% of that gap.`;
  return `Deaths outnumber births and more people leave than arrive: ${fmtFlow(total)} people in ${year}.`;
}

export function componentsTakeaway(rec, series, lastEstimateYear) {
  const since = rec.projection?.naturalDeclineSince;
  if (since != null && since <= lastEstimateYear) {
    const last = series?.[series.length - 1];
    const r = last && last.births > 0 ? (last.deaths / last.births).toFixed(1) : null;
    return r
      ? `Deaths overtook births in ${since}. By 2100 the UN expects ${r} deaths for every birth.`
      : `Deaths overtook births in ${since}.`;
  }
  if (since != null) return `Births still outnumber deaths, but the UN expects deaths to overtake them around ${since}.`;
  return "Births outnumber deaths all the way to 2100.";
}

export function migrationTakeaway(rec) {
  if (rec.iso3 === "WLD") return "Migration moves people between countries, so it cancels out for the world.";
  const m = rec.migrantStock;
  if (!m || m.immigrants == null) return `No migrant-stock data for ${rec.name}.`;
  const im = fmtWords(m.immigrants);
  if (m.emigrants == null) return `${rec.name} is home to ${im} people born abroad.`;
  const em = fmtWords(m.emigrants);
  if (m.emigrants > m.immigrants) return `More people born in ${rec.name} live abroad (${em}) than immigrants live in ${rec.name} (${im}).`;
  return `${rec.name} is home to ${im} people born abroad, more than the ${em} of its own people living abroad.`;
}

export function generationsTakeaway(name, tfr, { whatIf = false } = {}) {
  if (whatIf) return `What if ${name} had ${fmtTfr(tfr)} births per woman?`;
  const g = generationCounts(tfr, 4);
  if (!g.length) return `No births-per-woman figure for ${name}.`;
  if (Math.abs(tfr / REPLACEMENT - 1) < 0.005)
    return `At ${fmtTfr(tfr)} births per woman, each generation is about the same size: 100 \u2192 ${fmtCount(g[1])} \u2192 ${fmtCount(g[2])}.`;
  if (tfr / REPLACEMENT < 1)
    return `At ${fmtTfr(tfr)} births per woman, 100 people today have ${fmtCount(g[1])} children, ${fmtCount(g[2])} grandchildren and ${fmtCount(g[3])} great-grandchildren.`;
  return `At ${fmtTfr(tfr)} births per woman, each generation is bigger than the last: 100 → ${fmtCount(g[1])} → ${fmtCount(g[2])}.`;
}

export function tfrTakeaway(rec, series) {
  const first = series?.find((r) => r.year === 1950 && r.tfr != null) ?? series?.find((r) => r.tfr != null);
  const last = series?.[series.length - 1];
  const latest = tfrValue(rec);
  if (!first || latest == null) return `Births per woman in ${subject(rec)} over time.`;
  const verb = latest > first.tfr ? "rose" : "fell";
  const tail = last?.tfr != null ? ` The UN projects ${fmtTfr(last.tfr)} by 2100.` : "";
  return `Births per woman ${verb} from ${fmtTfr(first.tfr)} in ${first.year} to ${fmtTfr(latest)} in ${rec.tfr.year}.${tail}`;
}

export function xPostText(rec) {
  const tfr = tfrValue(rec);
  const g = generationCounts(tfr, 3);
  const pct = rec.projection?.change2100Pct;
  const who = rec.iso3 === "WLD" ? "The world" : rec.name;
  let text = `${who}: ${fmtTfr(tfr)} births per woman.`;
  if (g.length) text += ` Start with 100 people → ${fmtCount(g[1])} children → ${fmtCount(g[2])} grandchildren.`;
  if (pct != null) text += ` The UN projects a ${fmtPct(Math.abs(pct), { plus: false })} population ${pct < 0 ? "drop" : "rise"} by 2100.`;
  return text;
}

export function documentTitle(rec) {
  if (!rec) return "Fertility Tracker: which countries are shrinking, and how fast";
  return `${rec.name}: ${fmtTfr(tfrValue(rec))} births per woman · Fertility Tracker`;
}

export function selectionAnnouncement(rec) {
  const tier = tierOf(rec);
  const parts = [`${rec.name} selected.`];
  if (tier && rec.iso3 !== "WLD") parts.push(`${tier} decline risk.`);
  parts.push(`${fmtTfr(tfrValue(rec))} births per woman.`);
  return parts.join(" ");
}

// Tooltip lines (DESIGN §8.4). n = length of the ranking.
export function tooltipLines(rec, n) {
  if (!rec) return null;
  const tier = tierOf(rec);
  let line2;
  if (!tier) line2 = "Not scored (incomplete data)";
  else if (Number.isInteger(rec.risk?.rank)) line2 = `${tier} decline risk · #${rec.risk.rank} of ${n}`;
  else
    line2 = `${tier} decline risk · ${
      (rec.flags ?? []).includes("small-population") ? "not ranked (under 100,000 people)" : "not ranked (incomplete data)"
    }`;
  const tfr = tfrValue(rec);
  const line3 = tfr != null ? `${fmtTfr(tfr)} births per woman (${rec.tfr.year})` : "No births-per-woman figure";
  const p = rec.projection;
  const pop = rec.population?.value;
  const line4 =
    pop != null && p?.population2100 != null
      ? `Population ${fmtCompact(pop)} → ${fmtCompact(p.population2100)} by 2100 (${fmtPct(p.change2100Pct)})`
      : pop != null
        ? `Population ${fmtCompact(pop)}`
        : "";
  return [rec.name, line2, line3, line4].filter(Boolean);
}

export function cursorAnnouncement(rec) {
  const tier = tierOf(rec);
  return `${rec.name}. ${tier ? `${tier} decline risk. ` : ""}${fmtTfr(tfrValue(rec))} births per woman. Press Enter to select.`;
}

// ---------------------------------------------------------------- waterfall geometry (DESIGN §5.6)

export function waterfallRows(c) {
  if (!c || c.births == null || c.deaths == null) return null;
  const B = c.births;
  const D = c.deaths;
  const M = c.netMigration ?? 0;
  const pt = c.perThousand ?? {};
  return [
    { key: "births", label: "Births", from: 0, to: B, value: B, rate: pt.births },
    { key: "deaths", label: "Deaths", from: B, to: B - D, value: -D, rate: pt.deaths != null ? -pt.deaths : null },
    { key: "migration", label: "Net migration", from: B - D, to: B - D + M, value: M, rate: pt.netMigration },
    { key: "total", label: "Total change", from: 0, to: B - D + M, value: B - D + M, rate: pt.populationChange },
  ];
}

// Spread label y positions so they sit at least `gap` px apart, keeping order. items: [{ y }] (mutated copy returned).
export function spreadLabels(ys, gap, min = -Infinity, max = Infinity) {
  const idx = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < idx.length; k++) if (idx[k].y - idx[k - 1].y < gap) idx[k].y = idx[k - 1].y + gap;
  const over = idx.length ? idx[idx.length - 1].y - max : 0;
  if (over > 0) {
    idx[idx.length - 1].y -= over;
    for (let k = idx.length - 2; k >= 0; k--) if (idx[k + 1].y - idx[k].y < gap) idx[k].y = idx[k + 1].y - gap;
  }
  if (idx.length && idx[0].y < min) {
    const shift = min - idx[0].y;
    for (const it of idx) it.y += shift;
  }
  const out = new Array(ys.length);
  for (const it of idx) out[it.i] = it.y;
  return out;
}

export function lastEstimateYear(series, fallback = null) {
  let y = fallback;
  for (const r of series ?? []) if (r.variant === "estimate") y = r.year;
  return y;
}

export function peakOf(series, key = "population") {
  let best = null;
  for (const r of series ?? []) if (r[key] != null && (best == null || r[key] > best[key])) best = r;
  return best;
}
