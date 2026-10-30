// Pure logic shared by the pages, the social card and the tests (test/frontend/logic.test.mjs).
// No DOM, no d3: everything here runs in Node as well as the browser.

export const REPLACEMENT = 2.1;
export const MINUS = "−";
export const SITE_URL = "https://fertility-tracker-live.vercel.app/";
export const FALLBACK_EMAIL = "andromedus+fertility@mail.grokbot.com";
export const GEN_YEARS = 30;
export const END_YEAR = 2100;

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- risk in words (DESIGN-v3 §0, §3)

// API tiers → the five words people see. The 0–100 score only appears behind "More numbers".
export const TIERS = ["Low", "Moderate", "Elevated", "High", "Critical"];
export const RISK_LEVELS = ["Very low", "Low", "Medium", "High", "Very high"];
export const RISK_WORDS = { Low: "Very low", Moderate: "Low", Elevated: "Medium", High: "High", Critical: "Very high" };
// Meter segments, calm → alarming. Not the accent color, not the people ramp's gray.
export const RISK_COLORS = ["#CFE6D2", "#EDE3C6", "#F3B87A", "#E8774A", "#C3392F"];

export function tierOf(rec) {
  const t = rec?.risk?.tier;
  return TIERS.includes(t) ? t : null;
}

// 0..4, or -1 when the place has no tier.
export function riskStep(rec) {
  return TIERS.indexOf(tierOf(rec));
}

export function riskWord(rec) {
  const t = tierOf(rec);
  return t ? RISK_WORDS[t] : null;
}

export function isSmallPlace(rec) {
  return (rec?.flags ?? []).includes("small-population");
}

// ---------------------------------------------------------------- scenarios (DESIGN-v3 §7)

export const SCENARIOS = ["medium", "constant"];
export const SCENARIO_LABELS = { medium: "UN forecast", constant: "If birth rates stay the same" };
export const SCENARIO_SHORT = { medium: "UN forecast", constant: "Rates stay the same" };
export const SCENARIO_HINTS = {
  medium: "The UN's central forecast (World Population Prospects 2024).",
  constant: "What if every country kept today's babies per woman until 2100? A what-if, not a forecast.",
};

export function normScenario(s) {
  return s === "constant" ? "constant" : "medium";
}

// "Today" is the current calendar year, clamped to the data.
export function todayYear(scen, now = new Date()) {
  const start = scen?.startYear ?? 2024;
  const end = scen?.endYear ?? END_YEAR;
  return clamp(now.getFullYear(), start, end);
}

// The first year on the slider: the UN's estimates start in 1950 (scenarios.json `estimate`, the past both futures
// share). Older files without it start at the first forecast year.
export function firstYear(scen) {
  return scen?.estimateStartYear ?? scen?.startYear ?? 2024;
}

// Play from the end of the slider starts again here: the recent past, then the future.
export const REPLAY_FROM = 2000;

// People in one whole year: the UN estimate before startYear, the scenario from it on. null when missing.
function popYear(scen, iso3, year, scenario) {
  const p = scen?.places?.[iso3];
  if (!p) return null;
  if (year < scen.startYear) {
    const v = p.estimate?.[year - firstYear(scen)];
    return isNum(v) ? v : null;
  }
  const v = p[normScenario(scenario)]?.[year - scen.startYear];
  return isNum(v) ? v : null;
}

// People in `year` (fractional years interpolate, so Play is smooth). null when missing.
export function popAt(scen, iso3, year, scenario = "medium") {
  const arr = scen?.places?.[iso3]?.[normScenario(scenario)];
  if (!Array.isArray(arr) || !arr.length || !isNum(year)) return null;
  const lo = scen.startYear > firstYear(scen) && scen.places[iso3].estimate?.length ? firstYear(scen) : scen.startYear;
  const t = clamp(year, lo, scen.startYear + arr.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = popYear(scen, iso3, i, scenario);
  const b = f > 0 ? popYear(scen, iso3, i + 1, scenario) : a;
  if (!isNum(a)) return isNum(b) && f > 0.5 ? b : null;
  if (!isNum(b) || f === 0) return a;
  return a + (b - a) * f;
}

// How fast a place is growing or shrinking at `year`: the average yearly % change over the TREND_YEARS years up to it
// (in the first years of the data, over the years there are). Looking back, not ahead, so a year shows what had been
// happening: Ukraine in 2026 is still the war years, not the UN's assumed return of refugees in 2025-2026.
export const TREND_YEARS = 5;
export function trendAt(scen, iso3, year, scenario = "medium") {
  if (!isNum(year)) return null;
  const first = firstYear(scen);
  const to = Math.max(year, first + 1);
  const from = Math.max(first, to - TREND_YEARS);
  const a = popAt(scen, iso3, from, scenario);
  const b = popAt(scen, iso3, to, scenario);
  if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0) return null;
  return (Math.pow(b / a, 1 / (to - from)) - 1) * 100;
}

// Population in `year` as a share of today's (UN forecast for today, so both scenarios share one baseline).
export function ratioVsToday(scen, iso3, year, scenario, today) {
  const base = popAt(scen, iso3, today, "medium");
  const v = popAt(scen, iso3, year, scenario);
  if (!isNum(base) || base <= 0 || !isNum(v)) return null;
  return v / base;
}

export function pctVsToday(scen, iso3, year, scenario, today) {
  const r = ratioVsToday(scen, iso3, year, scenario, today);
  return r == null ? null : (r - 1) * 100;
}

// ---------------------------------------------------------------- the color scales (DESIGN-v3 §1)

// Two scales on one set of colors and words. Greens grow (blue-leaning, so they part from the oranges under red-green
// color blindness), sand stays about the same, orange → red shrinks, and red only deepens: the worse, the darker red.
// No gray "half gone" step: gray read as "no data" (user feedback, round 4).
//
// RAMP: % change vs today (the 2100 outlook: chips, meter, verdicts, rankings, link cards).
export const RAMP = [
  [-100, "#5E120E"],
  [-60, "#8E1F1A"],
  [-40, "#BE3A30"],
  [-25, "#DA573A"],
  [-15, "#EC8447"],
  [-8, "#F4B26E"],
  [-4, "#F2D9A9"],
  [0, "#EEE5CD"],
  [4, "#DDE8D0"],
  [12, "#ABD8C4"],
  [30, "#62B7A6"],
  [60, "#2C9690"],
  [120, "#13737A"],
  [250, "#0B4F63"],
];
// TREND_RAMP: % change per year over the last TREND_YEARS years (the globe: fill, legend, tooltip, labels).
export const TREND_RAMP = [
  [-3, "#5E120E"],
  [-2, "#8E1F1A"],
  [-1.3, "#BE3A30"],
  [-0.8, "#DA573A"],
  [-0.45, "#EC8447"],
  [-0.25, "#F4B26E"],
  [-0.1, "#F2D9A9"],
  [0, "#EEE5CD"],
  [0.1, "#DDE8D0"],
  [0.4, "#ABD8C4"],
  [1, "#62B7A6"],
  [2, "#2C9690"],
  [3, "#13737A"],
  [4.5, "#0B4F63"],
];
export const NODATA_COLOR = "#E7E3DC";

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const RAMP_RGB = RAMP.map(([p, c]) => [p, hexToRgb(c)]);
const TREND_RGB = TREND_RAMP.map(([p, c]) => [p, hexToRgb(c)]);

function rampColor(stops, x) {
  const v = clamp(x, stops[0][0], stops[stops.length - 1][0]);
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (v <= p1) {
      const [p0, c0] = stops[i - 1];
      const t = p1 === p0 ? 1 : (v - p0) / (p1 - p0);
      return rgbToHex([0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * t));
    }
  }
  return rgbToHex(stops[stops.length - 1][1]);
}

// The % as people read it: whole numbers, one decimal under 1%, halves rounded away from zero on both sides
// (−24.5 → −25, like +24.5 → +25). fmtPct prints this value and colors and words use it, so a place shown as "−25%"
// is always "Shrinking fast", never "Shrinking".
export function roundPct(x) {
  if (!isNum(x)) return null;
  const a = Math.abs(x);
  const r = a < 1 ? Math.round(a * 10) / 10 : Math.round(a);
  return r === 0 ? 0 : Math.sign(x) * r;
}
export const shownPct = roundPct;

export function changeColor(pct) {
  if (!isNum(pct)) return null;
  return rampColor(RAMP_RGB, shownPct(pct));
}

// The yearly rate as people read it: one decimal ("−0.4% a year"), halves away from zero like roundPct; colors and
// words use that value.
export function shownRate(x) {
  if (!isNum(x)) return null;
  const r = Math.round(Math.abs(x) * 10) / 10;
  return r === 0 ? 0 : Math.sign(x) * r;
}

export function trendColor(rate) {
  if (!isNum(rate)) return null;
  return rampColor(TREND_RGB, shownRate(rate));
}

// The four words, growing first (left to right on screen). One scale for every word on screen; each word covers a
// band of a ramp, and its color is the ramp's color in the middle of that band.
// OUTLOOK: 2100 under the selected scenario vs today. Boundaries: > +5, −5…+5, −25…−5, ≤ −25.
export const OUTLOOK = [
  { key: "growing", label: "Growing", from: 5, to: Infinity, pct: 40 },
  { key: "same", label: "About the same", from: -5, to: 5, pct: 0 },
  { key: "shrinking", label: "Shrinking", from: -25, to: -5, pct: -12 },
  { key: "fast", label: "Shrinking fast", from: -100, to: -25, pct: -45 },
];

// TREND: the globe, per year. Boundaries: > +0.1% a year, −0.1…+0.1, −0.8…−0.1, ≤ −0.8.
export const TREND = [
  { key: "growing", label: "Growing", from: 0.1, to: Infinity, rate: 1 },
  { key: "same", label: "About the same", from: -0.1, to: 0.1, rate: 0 },
  { key: "shrinking", label: "Shrinking", from: -0.8, to: -0.1, rate: -0.4 },
  { key: "fast", label: "Shrinking fast", from: -Infinity, to: -0.8, rate: -1.5 },
];

// 0 growing … 3 shrinking fast; -1 without a figure.
export function outlookStep(pct) {
  if (!isNum(pct)) return -1;
  pct = shownPct(pct);
  if (pct <= -25) return 3;
  if (pct < -5) return 2;
  if (pct <= 5) return 1;
  return 0;
}

export function outlookOf(pct) {
  const i = outlookStep(pct);
  return i < 0 ? null : OUTLOOK[i];
}

export function changeBand(pct) {
  return outlookOf(pct)?.key ?? null;
}

export function outlookColor(step) {
  const o = OUTLOOK[step];
  return o ? changeColor(o.pct) : NODATA_COLOR;
}

export function trendStep(rate) {
  if (!isNum(rate)) return -1;
  rate = shownRate(rate);
  if (rate <= -0.8) return 3;
  if (rate < -0.1) return 2;
  if (rate <= 0.1) return 1;
  return 0;
}

export function trendColorOf(step) {
  const t = TREND[step];
  return t ? trendColor(t.rate) : NODATA_COLOR;
}

// "Shrinking 0.4% a year", "Growing 2.1% a year", "About the same size".
export function trendWords(rate) {
  const step = trendStep(rate);
  if (step < 0) return "No trend in our sources";
  const r = Math.abs(shownRate(rate)).toFixed(1);
  if (step === 1) return "About the same size";
  return `${step === 0 ? "Growing" : "Shrinking"} ${r}% a year`;
}

// ---------------------------------------------------------------- number formatting

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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

// "21.8 million", "8.22 billion", "820,000", "640".
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

// Big counters split the number from its unit: { num: "10.2", unit: "billion" }, { num: "820,000", unit: "" }.
export function splitWords(n) {
  const w = fmtWords(n);
  const m = /^(.*?) (million|billion)$/.exec(w);
  return m ? { num: m[1], unit: m[2] } : { num: w, unit: "" };
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
  const r = roundPct(x);
  if (r == null) return "–";
  if (r === 0) return "0%";
  const a = Math.abs(r);
  return signOf(r, plus) + (a < 1 ? a.toFixed(1) : String(a)) + "%";
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

// The unit a population axis is labelled in: { div, unit } so 23,000,000 reads "23" with "million".
export function axisUnit(max) {
  if (max >= 2e9) return { div: 1e9, unit: "billion" };
  if (max >= 2e6) return { div: 1e6, unit: "million" };
  if (max >= 2e3) return { div: 1e3, unit: "thousand" };
  return { div: 1, unit: "people" };
}

// ---------------------------------------------------------------- generations

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

// How full each of `n` icons is (0..1), filled from the first: count 4.3 of 10 → [1,1,1,1,0.3,0,…].
export function iconFills(count, n = 100) {
  const c = Math.max(0, Math.min(n, isNum(count) ? count : 0));
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.min(1, c - i)));
}

// Person icons for a ratio vs today, `per` icons standing for today's population:
// { kept } icons stay colored (fractional), the rest of `per` gray out; growth adds { extra } green icons.
export function peopleIcons(ratio, per = 10) {
  if (!isNum(ratio)) return { kept: per, lost: 0, extra: 0 };
  const kept = Math.min(1, Math.max(0, ratio)) * per;
  const extra = Math.max(0, ratio - 1) * per;
  return { kept, lost: per - kept, extra };
}

// ---------------------------------------------------------------- routes and URLs (DESIGN-v3 §6)

const ISO = /^[A-Za-z]{3}$/;

// pathname + search + hash → { page, iso3, year, scenario, focus, redirect }. `redirect` is the canonical path to
// replaceState to (legacy /#KOR, lowercase codes, trailing slashes).
export function parseRoute(pathname = "/", search = "", hash = "") {
  const q = new URLSearchParams(search);
  const y = Number(q.get("year"));
  const sc = q.get("scenario");
  const focus = q.get("focus");
  const out = {
    page: "notfound",
    iso3: null,
    year: Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : null,
    scenario: sc === "constant" || sc === "medium" ? sc : null,
    focus: focus && ISO.test(focus) ? focus.toUpperCase() : null,
    redirect: null,
  };
  const p = String(pathname || "/").replace(/\/index\.html$/, "/");
  let m;
  if (p === "/" || p === "") {
    out.page = "globe";
    const h = /^#([A-Za-z]{3})$/.exec(hash ?? "");
    if (h) {
      out.page = "country";
      out.iso3 = h[1].toUpperCase();
      out.redirect = `/country/${out.iso3}`;
    }
  } else if ((m = /^\/country\/([A-Za-z]{3})(\/?)$/.exec(p))) {
    out.page = "country";
    out.iso3 = m[1].toUpperCase();
    if (m[1] !== out.iso3 || m[2]) out.redirect = `/country/${out.iso3}`;
  } else if ((m = /^\/rankings(\/?)$/.exec(p))) {
    out.page = "rankings";
    if (m[1]) out.redirect = "/rankings";
  } else if ((m = /^\/(?:fertility-tracker\/)?([A-Za-z]{3})\/?$/.exec(p))) {
    // "/KOR" (normally caught by 404.html) and the old GitHub Pages form.
    out.page = "country";
    out.iso3 = m[1].toUpperCase();
    out.redirect = `/country/${out.iso3}`;
  }
  return out;
}

// The shareable query: only what differs from the defaults, in a fixed order.
export function buildQuery({ year, scenario, focus } = {}, { defaultYear = END_YEAR } = {}) {
  const q = [];
  if (Number.isInteger(year) && year !== defaultYear) q.push(`year=${year}`);
  if (scenario === "constant") q.push("scenario=constant");
  if (focus && ISO.test(focus)) q.push(`focus=${focus.toUpperCase()}`);
  return q.length ? `?${q.join("&")}` : "";
}

export function countryPath(iso3) {
  return `/country/${iso3}`;
}

// The public URL of a place (Share, X, feedback context).
export function pageUrl(iso3, siteUrl = SITE_URL) {
  const base = siteUrl.endsWith("/") ? siteUrl : siteUrl + "/";
  return iso3 ? `${base}country/${iso3}` : base;
}

// ---------------------------------------------------------------- feedback links (DESIGN.md §7)

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

// One message, three ways to send it. A mailto: link does nothing on a computer with no mail program set up (or a
// browser with no web mail registered for it), so Gmail and Outlook get links that open a ready message in the browser.
export function buildEmailLinks(feedback, ctx) {
  const address = feedback?.email?.address || FALLBACK_EMAIL;
  const subjectBase = feedback?.email?.subject || "Fertility Tracker feedback";
  const subject = ctx?.name ? `${subjectBase}: ${ctx.name}` : subjectBase;
  const body = `Page: ${pageUrl(ctx?.iso3, ctx?.siteUrl ?? feedback?.site?.url ?? SITE_URL)}\n\nWhat should we fix or add?\n`;
  const e = encodeURIComponent;
  return {
    address,
    subject,
    body,
    mailto: `mailto:${address}?subject=${e(subject)}&body=${e(body)}`,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${e(address)}&su=${e(subject)}&body=${e(body)}`,
    outlook: `https://outlook.live.com/mail/0/deeplink/compose?to=${e(address)}&subject=${e(subject)}&body=${e(body)}`,
  };
}

export function buildMailto(feedback, ctx) {
  return buildEmailLinks(feedback, ctx).mailto;
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

// ---------------------------------------------------------------- search (typo-tolerant)

// ISO 3166-1 alpha-2 → alpha-3 for every place in the data ("tw" finds Taiwan).
export const ISO2 = {"AD":"AND","AE":"ARE","AF":"AFG","AG":"ATG","AI":"AIA","AL":"ALB","AM":"ARM","AO":"AGO","AR":"ARG","AS":"ASM","AT":"AUT","AU":"AUS","AW":"ABW","AZ":"AZE","BA":"BIH","BB":"BRB","BD":"BGD","BE":"BEL","BF":"BFA","BG":"BGR","BH":"BHR","BI":"BDI","BJ":"BEN","BL":"BLM","BM":"BMU","BN":"BRN","BO":"BOL","BQ":"BES","BR":"BRA","BS":"BHS","BT":"BTN","BW":"BWA","BY":"BLR","BZ":"BLZ","CA":"CAN","CD":"COD","CF":"CAF","CG":"COG","CH":"CHE","CI":"CIV","CK":"COK","CL":"CHL","CM":"CMR","CN":"CHN","CO":"COL","CR":"CRI","CU":"CUB","CV":"CPV","CW":"CUW","CY":"CYP","CZ":"CZE","DE":"DEU","DJ":"DJI","DK":"DNK","DM":"DMA","DO":"DOM","DZ":"DZA","EC":"ECU","EE":"EST","EG":"EGY","EH":"ESH","ER":"ERI","ES":"ESP","ET":"ETH","FI":"FIN","FJ":"FJI","FK":"FLK","FM":"FSM","FO":"FRO","FR":"FRA","GA":"GAB","GB":"GBR","GD":"GRD","GE":"GEO","GF":"GUF","GG":"GGY","GH":"GHA","GI":"GIB","GL":"GRL","GM":"GMB","GN":"GIN","GP":"GLP","GQ":"GNQ","GR":"GRC","GT":"GTM","GU":"GUM","GW":"GNB","GY":"GUY","HK":"HKG","HN":"HND","HR":"HRV","HT":"HTI","HU":"HUN","ID":"IDN","IE":"IRL","IL":"ISR","IM":"IMN","IN":"IND","IQ":"IRQ","IR":"IRN","IS":"ISL","IT":"ITA","JE":"JEY","JM":"JAM","JO":"JOR","JP":"JPN","KE":"KEN","KG":"KGZ","KH":"KHM","KI":"KIR","KM":"COM","KN":"KNA","KP":"PRK","KR":"KOR","KW":"KWT","KY":"CYM","KZ":"KAZ","LA":"LAO","LB":"LBN","LC":"LCA","LI":"LIE","LK":"LKA","LR":"LBR","LS":"LSO","LT":"LTU","LU":"LUX","LV":"LVA","LY":"LBY","MA":"MAR","MC":"MCO","MD":"MDA","ME":"MNE","MF":"MAF","MG":"MDG","MH":"MHL","MK":"MKD","ML":"MLI","MM":"MMR","MN":"MNG","MO":"MAC","MP":"MNP","MQ":"MTQ","MR":"MRT","MS":"MSR","MT":"MLT","MU":"MUS","MV":"MDV","MW":"MWI","MX":"MEX","MY":"MYS","MZ":"MOZ","NA":"NAM","NC":"NCL","NE":"NER","NG":"NGA","NI":"NIC","NL":"NLD","NO":"NOR","NP":"NPL","NR":"NRU","NU":"NIU","NZ":"NZL","OM":"OMN","PA":"PAN","PE":"PER","PF":"PYF","PG":"PNG","PH":"PHL","PK":"PAK","PL":"POL","PM":"SPM","PR":"PRI","PS":"PSE","PT":"PRT","PW":"PLW","PY":"PRY","QA":"QAT","RE":"REU","RO":"ROU","RS":"SRB","RU":"RUS","RW":"RWA","SA":"SAU","SB":"SLB","SC":"SYC","SD":"SDN","SE":"SWE","SG":"SGP","SH":"SHN","SI":"SVN","SK":"SVK","SL":"SLE","SM":"SMR","SN":"SEN","SO":"SOM","SR":"SUR","SS":"SSD","ST":"STP","SV":"SLV","SX":"SXM","SY":"SYR","SZ":"SWZ","TC":"TCA","TD":"TCD","TG":"TGO","TH":"THA","TJ":"TJK","TK":"TKL","TL":"TLS","TM":"TKM","TN":"TUN","TO":"TON","TR":"TUR","TT":"TTO","TV":"TUV","TW":"TWN","TZ":"TZA","UA":"UKR","UG":"UGA","US":"USA","UY":"URY","UZ":"UZB","VA":"VAT","VC":"VCT","VE":"VEN","VG":"VGB","VI":"VIR","VN":"VNM","VU":"VUT","WF":"WLF","WS":"WSM","XK":"XKX","YE":"YEM","YT":"MYT","ZA":"ZAF","ZM":"ZMB","ZW":"ZWE"};

export const ALIASES = {
  CHE: ["Swiss", "Swiss Confederation"],
  DEU: ["German", "Deutschland"],
  FRA: ["French"],
  ESP: ["Spanish", "Espana"],
  ITA: ["Italian"],
  JPN: ["Japanese", "Nippon"],
  CHN: ["Chinese", "PRC"],
  IND: ["Indian", "Bharat"],
  BRA: ["Brazilian", "Brasil"],
  MEX: ["Mexican"],
  POL: ["Polish"],
  UKR: ["Ukrainian"],
  KOR: ["Korea", "Republic of Korea", "S Korea", "Korean"],
  PRK: ["North Korea", "DPRK"],
  GBR: ["UK", "Britain", "Great Britain", "England", "Scotland", "Wales", "British"],
  USA: ["US", "USA", "America", "United States of America", "American"],
  RUS: ["Russian Federation"],
  TUR: ["Türkiye", "Turkiye", "Turkey"],
  CZE: ["Czech Republic", "Czechia", "Czech"],
  CIV: ["Ivory Coast", "Côte d'Ivoire"],
  MMR: ["Burma"],
  NLD: ["Holland", "Dutch"],
  MAC: ["Macau"],
  HKG: ["Hongkong"],
  TWN: ["Republic of China", "Chinese Taipei"],
  COD: ["DRC", "DR Congo", "Congo-Kinshasa", "Zaire"],
  COG: ["Congo-Brazzaville", "Republic of the Congo"],
  SWZ: ["Swaziland", "Eswatini"],
  MKD: ["Macedonia"],
  CPV: ["Cabo Verde"],
  TLS: ["Timor-Leste", "East Timor"],
  VAT: ["Holy See", "Vatican City"],
  PSE: ["Palestine", "Gaza", "West Bank"],
  ARE: ["UAE", "Emirates"],
  LAO: ["Lao PDR"],
  IRN: ["Persia"],
  FSM: ["Federated States of Micronesia"],
  BES: ["Caribbean Netherlands", "Bonaire"],
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

// Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping once it exceeds `max`.
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

function typoBudget(len) {
  if (len < 4) return 0;
  if (len < 6) return 1;
  if (len < 9) return 2;
  return 3;
}

function scorePlace(place, nq) {
  const name = normalizeText(place.name);
  const code = place.iso3.toLowerCase();
  const aliases = (ALIASES[place.iso3] ?? []).map(normalizeText);
  if (name === nq || code === nq || aliases.includes(nq)) return 0;
  if (nq.length === 2 && ISO2[nq.toUpperCase()] === place.iso3) return 0.5;
  if (name.startsWith(nq)) return 1;
  if (name.split(" ").some((w) => w.startsWith(nq))) return 2;
  if (aliases.some((a) => a.startsWith(nq) || a.split(" ").some((w) => w.startsWith(nq)))) return 3;
  if (name.includes(nq) || aliases.some((a) => a.includes(nq))) return 4;
  // Typos: compare with each full name, and with the same-length start of it ("taiwn" → "taiwan", "czeck" → "czech").
  const budget = typoBudget(nq.length);
  if (!budget) return -1;
  let best = budget + 1;
  for (const t of [name, ...aliases]) {
    const cands = [t, t.slice(0, nq.length), t.slice(0, nq.length + 1), ...t.split(" ").filter((w) => w.length >= 4)];
    for (const c of cands) best = Math.min(best, editDistance(nq, c, budget));
  }
  return best <= budget ? 5 + best / 10 : -1;
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

// ---------------------------------------------------------------- copy (each block: one picture, one sentence)

export function possessive(name) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

// "Taiwan's", "the United States'", "the world's".
export function possessiveOf(rec, opts) {
  return possessive(theName(rec, opts));
}

export function displayName(rec) {
  return rec?.iso3 === "WLD" ? "The world" : rec?.name ?? "";
}

// Places whose name takes "the" in a sentence.
const THE = new Set(["USA", "GBR", "NLD", "PHL", "BHS", "GMB", "CAF", "DOM", "COD", "MDV", "MHL", "SLB", "ARE", "COM", "COK", "CYM", "FLK", "FRO", "MNP", "TCA", "VGB", "VIR", "IMN", "VAT", "SYC"]);

// "the United States", "Taiwan", "the world"; `start` capitalises for the start of a sentence.
export function theName(rec, { start = false } = {}) {
  if (!rec) return "";
  if (rec.iso3 === "WLD") return start ? "The world" : "the world";
  if (THE.has(rec.iso3)) return `${start ? "The" : "the"} ${rec.name}`;
  return rec.name;
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Plain verdict for 2100 under a scenario. It always agrees with outlookStep(pct): the same four bands.
// peakYear (of the scenario's path) adds "grows for a while, then …" when the peak is still ahead.
export function verdict(rec, pct2100, today, { scenario = "medium", peakYear = rec?.projection?.peakYear, small = isSmallPlace(rec) } = {}) {
  const name = theName(rec, { start: true });
  if (small) return `${name} has a very small population: its numbers swing a lot.`;
  if (!isNum(pct2100)) return `${name}: no forecast in our sources.`;
  const rising = isNum(peakYear) && peakYear > today + 3 && peakYear < END_YEAR;
  const step = outlookStep(pct2100);
  let v;
  // Shrinking fast covers everything from −25%; from half on, the sentence says so.
  if (step === 3 && shownPct(pct2100) <= -50) v = rising ? `${name} grows a little longer, then loses half its people or more.` : `${name} loses half its people or more by 2100.`;
  else if (step === 3) v = rising ? `${name} grows a little longer, then shrinks fast.` : `${name} is shrinking fast.`;
  else if (step === 2) v = rising ? `${name} grows for a while, then shrinks.` : `${name} is shrinking.`;
  else if (step === 1) v = rising ? `${name} grows, then falls back to about today's size.` : `${name} stays about the same size.`;
  else v = pct2100 >= 30 ? `${name} keeps growing fast.` : rising ? `${name} keeps growing until about ${peakYear}, then levels off.` : `${name} keeps growing.`;
  if (normScenario(scenario) === "constant") return `If birth rates stay the same, ${v[0].toLowerCase() === v[0] ? v : (THE.has(rec.iso3) || rec.iso3 === "WLD" ? v[0].toLowerCase() + v.slice(1) : v)}`;
  return v;
}

// Short form for titles: "shrinking fast".
export function verdictShort(pct2100) {
  const o = outlookOf(pct2100);
  return o ? `${o.label.toLowerCase()} by 2100` : "population outlook";
}

// "For every 100 people in Taiwan today, about 43 will be left in 2100 (UN forecast)."
export function hundredSentence(rec, ratio2100, scenario = "medium") {
  if (!isNum(ratio2100)) return "";
  const where = theName(rec);
  const n = Math.round(100 * ratio2100);
  const tag = `(${SCENARIO_LABELS[normScenario(scenario)]})`;
  if (n >= 97 && n <= 103) return `For every 100 people in ${where} today, there will still be about 100 in 2100 ${tag}.`;
  if (n < 100) return `For every 100 people in ${where} today, about ${n} will be left in 2100 ${tag}.`;
  return `For every 100 people in ${where} today, there will be about ${nf.format(n)} in 2100 ${tag}.`;
}

export function tfrReason(rec) {
  const tfr = rec?.tfr?.value;
  if (!isNum(tfr)) return null;
  return `${fmtTfr(tfr)} babies per woman; 2.1 keeps a country the same size`;
}

export function birthsDeathsReason(rec, latestYear = 2023) {
  const c = rec?.components;
  const since = rec?.projection?.naturalDeclineSince;
  if (!c || !isNum(c.births) || !isNum(c.deaths)) return null;
  if (c.deaths > c.births) return isNum(since) && since <= latestYear ? `More deaths than births since ${since}` : "More deaths than births each year";
  if (isNum(since) && since > latestYear && since <= END_YEAR) return `More births than deaths, until about ${since}`;
  return "More births than deaths each year";
}

export function migrationSentence(net) {
  if (!isNum(net)) return "No recent figure for people moving in and out.";
  const a = Math.abs(net);
  if (a < 50) return "About as many people move in as move out.";
  const n = fmtFlow(a, { plus: false });
  return net < 0 ? `${n} more people leave than arrive each year.` : `${n} more people arrive than leave each year.`;
}

// "Each year, 32,800 more people leave than arrive."
// The latest year's net moving, with its year, so it can't be mistaken for the forecast beside it.
export function yearlyNetSentence(net, year = null) {
  if (!isNum(net)) return "No recent figure for people moving in and out.";
  const when = year ? `In ${year}` : "Last year";
  if (Math.abs(net) < 50) return `${when}, about as many people arrived as left.`;
  const n = fmtFlow(Math.abs(net), { plus: false });
  return net < 0 ? `${when}, ${n} more people left than arrived.` : `${when}, ${n} more people arrived than left.`;
}

export function bornDiedSentence(c) {
  if (!c || !isNum(c.births) || !isNum(c.deaths)) return "No recent births and deaths figure.";
  const b = fmtFlow(c.births, { plus: false });
  const d = fmtFlow(c.deaths, { plus: false });
  if (c.deaths > c.births) return `${b} born and ${d} died in ${c.year}: more people die than are born.`;
  return `${b} born and ${d} died in ${c.year}: more babies are born than people die.`;
}

// Where the change in people comes from, over a span of years: births, deaths and people moving in minus people moving
// out, added up from the UN's yearly figures (medium variant). The UN publishes moving only as a yearly net figure;
// arrivals and departures counted separately exist only as "people alive who moved" (migrant stock).
// The yearly figures cover calendar years, while the slider compares 1 July populations. midyear: true counts half of
// the first and last year, so the span runs from 1 July `from` to 1 July `to` like the population it explains.
export function flowsBetween(series, from, to, { midyear = false } = {}) {
  let births = 0;
  let deaths = 0;
  let net = 0;
  let years = 0;
  for (const r of series ?? []) {
    if (r.year < from || r.year > to) continue;
    if (!isNum(r.births) || !isNum(r.deaths)) return null;
    const w = midyear && from < to && (r.year === from || r.year === to) ? 0.5 : 1;
    births += w * r.births;
    deaths += w * r.deaths;
    if (isNum(r.netMigration)) net += w * r.netMigration;
    years++;
  }
  if (!years) return null;
  return { from, to, years, births, deaths, netMigration: net, natural: births - deaths, change: births - deaths + net };
}

// One plain sentence for flowsBetween(): does moving in hold the place up? name: "Germany", "the United States".
export function flowsSentence(f, name, { world = false } = {}) {
  if (!f || !isNum(f.natural)) return "No yearly figures for births, deaths and moving.";
  const fl = (v) => fmtFlow(Math.abs(v), { plus: false });
  const nat = f.natural;
  const mig = world ? 0 : f.netMigration;
  // Moving that changes the total by under 2% of births or deaths barely matters.
  const moves = Math.abs(mig) >= 0.02 * Math.max(f.births, f.deaths, 1);
  if (world) return nat < 0 ? "More people die than are born. Moving doesn't change the world's total." : "More babies are born than people die. Moving doesn't change the world's total.";
  if (nat < 0) {
    if (!moves) return "More people die than are born. Immigration barely changes it.";
    if (mig < 0) return "More people die than are born, and more people leave than arrive.";
    if (nat + mig >= 0) return `${fl(nat)} more people die than are born. Immigration adds ${fl(mig)}, so ${name} ${nat + mig > 0 ? "still grows" : "stays the same size"}.`;
    return `${fl(nat)} more people die than are born. Immigration cuts the loss to ${fl(nat + mig)}.`;
  }
  if (!moves) return "More babies are born than people die. Immigration barely changes it.";
  if (mig < 0) return nat + mig < 0 ? `More babies are born than people die, but so many leave that ${name} shrinks.` : "More babies are born than people die. Some people leave, but fewer than are born.";
  return "More babies are born than people die, and immigration adds more.";
}

export function babiesSentence(tfr) {
  if (!isNum(tfr)) return "No recent figure for babies per woman.";
  if (tfr < REPLACEMENT - 0.05) return `${fmtTfr(tfr)} babies per woman. It takes 2.1 to keep a country the same size.`;
  if (tfr <= REPLACEMENT + 0.05) return `${fmtTfr(tfr)} babies per woman: just about the 2.1 that keeps a country the same size.`;
  return `${fmtTfr(tfr)} babies per woman: more than the 2.1 that keeps a country the same size.`;
}

// Whole people: "41", "7", "less than 1".
export function fmtPeople(v) {
  if (!isNum(v)) return "–";
  const r = Math.round(v);
  return r < 1 ? "less than 1" : nf.format(r);
}

// The generations sentence, without the "At 0.87 babies per woman, " lead-in (whatIf adds its own question).
export function generationsBody(tfr) {
  const g = generationCounts(tfr, 4);
  if (!g.length) return "No births-per-woman figure.";
  const r = tfr / REPLACEMENT;
  if (Math.abs(r - 1) < 0.01) return "each generation is about the same size.";
  if (r < 1) return `100 people have about ${fmtPeople(g[1])} children, ${fmtPeople(g[2])} grandchildren and ${fmtPeople(g[3])} great-grandchildren.`;
  return `each generation is bigger: 100 people have about ${fmtPeople(g[1])} children and ${fmtPeople(g[2])} grandchildren.`;
}

export function generationsSentence(tfr, { whatIfName = null } = {}) {
  const body = generationsBody(tfr);
  if (!generationCounts(tfr, 1).length) return body;
  if (whatIfName) return `What if ${whatIfName} had ${fmtTfr(tfr)} babies per woman? ${cap(body)}`;
  return `At ${fmtTfr(tfr)} babies per woman, ${body}`;
}

// The baseline the API's projected % is measured against (UN population in projection.baseYear).
export function projectionBase(rec, { series = null, fallbackYear = 2023 } = {}) {
  const p = rec?.projection ?? {};
  const year = Number.isInteger(p.baseYear) ? p.baseYear : fallbackYear;
  let population = typeof p.basePopulation === "number" ? p.basePopulation : null;
  if (population == null && series) population = series.find((r) => r.year === year)?.population ?? null;
  if (population == null && p.population2100 != null && p.change2100Pct != null && p.change2100Pct > -100)
    population = p.population2100 / (1 + p.change2100Pct / 100);
  return { year, population };
}

export function rankLabel(rec, n) {
  if (!rec) return "";
  if (rec.iso3 === "WLD") return "The world as a whole isn't ranked";
  if (Number.isInteger(rec.risk?.rank)) return `#${rec.risk.rank} of ${n}`;
  return isSmallPlace(rec) ? "Not ranked (under 100,000 people)" : "Not ranked (incomplete data)";
}

export function xPostText(rec, ratio2100) {
  const who = displayName(rec);
  let text = `${who}: ${fmtTfr(rec?.tfr?.value)} babies per woman.`;
  if (isNum(ratio2100)) {
    const n = Math.round(100 * ratio2100);
    text += n < 100 ? ` For every 100 people today, about ${n} will be left in 2100 (UN forecast).` : ` For every 100 people today, about ${n} in 2100 (UN forecast).`;
  }
  return text;
}

// "south-korea", "cote-d-ivoire", "world": for file names.
export function slugOf(rec) {
  const name = rec?.iso3 === "WLD" ? "world" : rec?.name ?? rec?.iso3 ?? "place";
  return (
    String(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "place"
  );
}

// Under the ten people (globe card, shared picture). r: people in `year` per person today.
export function peopleCaption(r, year, today) {
  if (!isNum(r)) return "No forecast for this place.";
  if (year === today) return "Each figure is one tenth of today's people. Move the slider.";
  const n = Math.round(r * 10);
  if (year < today) return n === 10 ? `About as many in ${year} as today.` : `In ${year}: ${n} for every 10 today.`;
  if (r < 0.995) return `${n === 10 ? "Almost all" : `${Math.max(0, n)} of 10`} still here in ${year}.`;
  if (r > 1.005) return `${n} for every 10 today.`;
  return "About the same as today.";
}

// The words that go with a shared picture: the place, the slider year and the chosen future, like the picture.
// lastEstimate: the UN's last counted year; later years are the selected future, even before today.
export function snapshotPostText({ rec, year, today, scenario, ratio, lastEstimate = null }) {
  const who = displayName(rec);
  const tfr = isNum(rec?.tfr?.value) ? ` ${fmtTfr(rec.tfr.value)} babies per woman today.` : "";
  if (!isNum(ratio) || year === today) return `${who}: where its population is headed by 2100.${tfr}`;
  const n = Math.round(100 * ratio);
  const future = scenario === "constant" ? "if birth rates stay the same" : "UN forecast";
  if (year < today) return `${who} in ${year}: about ${n} people for every 100 today (${isNum(lastEstimate) && year > lastEstimate ? future : "UN estimate"}).${tfr}`;
  return `${who} in ${year}: for every 100 people today, about ${n}${n < 100 ? " left" : ""} (${future}).${tfr}`;
}

export const HOME_TITLE = "Fertility Tracker: every country's population, today to 2100";

// Titles carry the words people search for ("Japan population"), then the verdict.
export function documentTitle(page, rec = null, pct2100 = null) {
  if (page === "country" && rec) {
    const who = `${rec.iso3 === "WLD" ? "World" : rec.name} population`;
    return `${outlookOf(pct2100) ? `${who}: ${verdictShort(pct2100)}` : `${who}, 1950 to 2100`} · Fertility Tracker`;
  }
  if (page === "rankings") return "Countries ranked by population decline to 2100 · Fertility Tracker";
  return HOME_TITLE;
}

export function lastEstimateYear(series, fallback = null) {
  let y = fallback;
  for (const r of series ?? []) if (r.variant === "estimate") y = r.year;
  return y;
}

export function peakOf(points) {
  let best = null;
  for (const p of points ?? []) if (p && isNum(p[1]) && (best == null || p[1] > best[1])) best = p;
  return best;
}

// Spread label y positions so they sit at least `gap` px apart, keeping order.
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

// Short region names for chips.
export const REGION_SHORT = {
  "East Asia & Pacific": "East Asia & Pacific",
  "Europe & Central Asia": "Europe & Central Asia",
  "Latin America & Caribbean": "Latin America",
  "Middle East, North Africa, Afghanistan & Pakistan": "Middle East & N. Africa",
  "North America": "North America",
  "South Asia": "South Asia",
  "Sub-Saharan Africa": "Africa south of the Sahara",
};

// ---------------------------------------------------------------- how sure is this (countries/{ISO3}.json confidence)
// The pipeline publishes facts and levels (good | fair | poor, rules in index.json confidenceRules); these are the words.

export const SURE_LEVELS = ["good", "fair", "poor"];
export const SURE_WORDS = {
  overall: { good: "Solid numbers", fair: "Partly estimated", poor: "Mostly estimated" },
  today: { good: "Counted recently", fair: "Count getting old", poor: "Not counted in a long time" },
  birthsDeaths: { good: "Registered", fair: "Partly registered", poor: "Estimated" },
  immigration: { good: "Counted", fair: "Partly counted", poor: "Estimated" },
  forecast: { good: "Narrow range to 2050", fair: "Wide range", poor: "Very wide range" },
};

// The globe card's line: how sure, in a few words (its page has "How sure is this?").
export function sureCardText(level) {
  return { good: "Data: solid (counted recently)", fair: "Data: partly estimated", poor: "Data: mostly estimated" }[level] ?? "";
}

// The head-count word; when a newer official figure pulled the level down, it says that instead of the count's age.
export function sureTodayWord(t) {
  return t?.downgraded ? "Official figure differs" : SURE_WORDS.today[t?.level] ?? "";
}
export const SURE_TITLES = { today: "Last head count", birthsDeaths: "Births and deaths", immigration: "People born abroad", forecast: "The forecast" };

const yearsAgo = (year, now) => (now - year <= 1 ? (now === year ? "this year" : "last year") : `${now - year} years ago`);
const newestUnCount = (t) => Math.max(-Infinity, ...(t.unCensuses ?? []), ...(t.unRegisters ?? []));

// Last head count: when the place was last counted, and whether the UN's numbers use that count yet.
export function sureTodayText(t, now) {
  if (!t) return null;
  if (t.register) return "Kept by a population register: everyone living there is on file, so the count is always current.";
  if (t.lastCount == null) return "No census on record: the UN works the population out from surveys and other countries' records.";
  const unLast = newestUnCount(t);
  const newer = t.latestCensus && Number(t.latestCensus.date.slice(0, 4)) > unLast;
  let s = `Last census: ${t.lastCount}, ${yearsAgo(t.lastCount, now)}.`;
  const oe = t.unOfficialEstimatesThrough ? ` and official estimates up to ${t.unOfficialEstimatesThrough}` : "";
  if (newer) s += Number.isFinite(unLast) ? ` The UN's 2024 numbers came before it: the counts it lists end in ${unLast}${oe}.` : " The UN's 2024 numbers came before it.";
  else if (t.keptCurrent) s += " Almost all births and deaths are registered, and the country's own recent count matches the UN's, so the number stays current.";
  else if (now - t.lastCount > 10) s += " Since then, the UN adds births and deaths and estimates who moved.";
  if (t.latestCensus?.partial) s += ` Its ${t.latestCensus.date.slice(0, 4)} census couldn't reach everyone, so much of its total is estimated.`;
  if (t.downgraded) s += " The country's newest official figure is more than 5% away from the UN's: see below.";
  return s;
}

// Births and deaths: registered and reported as virtually complete (code C: 90% or more), registered with gaps (U),
// or estimated from surveys. Births and deaths are described apart when they differ.
const REG = { C: "almost all registered (90% or more)", U: "registered, but some are missed", "|": "taken from surveys or a census, not the register" };
export function sureBirthsDeathsText(b, checks = []) {
  if (!b) return null;
  // Registration can be complete while the UN's figure (a 2024 forecast) is off: say so, so the two don't seem to clash.
  const off = checks.filter((c) => (c.key === "births" || c.key === "deaths") && (c.verdict === "un-higher" || c.verdict === "un-lower") && Math.abs(c.gapPct) >= 5);
  const tail = off.length ? ` The UN's figures for ${off.map((c) => c.key).join(" and ")} are ${off.length > 1 ? "each " : ""}more than 5% off the registered counts: see below.` : "";
  return birthsDeathsBody(b) + tail;
}
function birthsDeathsBody(b) {
  const { births: bi, deaths: de } = b;
  const one = (v) => (v?.code && REG[v.code] ? `${REG[v.code]} (${v.year})` : "not reported");
  if (b.level === "good") {
    const yr = bi?.year === de?.year ? bi?.year : null;
    return yr ? `Almost all births and deaths are registered (90% or more), reported for ${yr}.` : `Births: ${one(bi)}. Deaths: ${one(de)}.`;
  }
  if (b.level === "fair") {
    if (bi?.code && de?.code && (bi.code !== de.code || bi.year !== de.year)) return `Births: ${one(bi)}. Deaths: ${one(de)}. The UN corrects for the gaps.`;
    if (bi?.code === "U" || de?.code === "U") return "Births and deaths are registered, but some are missed: the UN corrects for the gaps.";
    if (bi?.code === "C" || de?.code === "C") return `Almost all are registered, but the newest year reported is ${Math.max(bi?.year ?? 0, de?.year ?? 0)}.`;
    return "Births and deaths are partly registered: the UN corrects for the gaps.";
  }
  return "Most births and deaths aren't registered: the UN estimates them from surveys that ask families.";
}

// People born abroad: by country of birth, by citizenship, or modelled; updated for 2024 or carried forward from 2020.
export function sureImmigrationText(m) {
  if (!m?.dataType) return null;
  const how = m.dataType === "B" ? "Counted by country of birth" : m.dataType.includes("I") ? "No count exists: the UN modelled the number" : "Counted by citizenship, which misses people who became citizens";
  const when = m.reassessed2024 === true ? ", and updated by the UN for 2024" : m.reassessed2024 === false ? ". The UN carried its 2020 figure forward to 2024" : "";
  return `${how}${when}.${m.refugeesAdded ? " Refugees counted by the UN refugee agency are added." : ""}`;
}

// The forecast: the UN's own 95% range in 2050 and 2100, and what it would be if nobody moved in or out.
export function sureForecastText(f) {
  const [a, b] = f?.at ?? [];
  if (!a) return null;
  const range = (p) => `${fmtCompact(p.lower95)} to ${fmtCompact(p.upper95)}`;
  let s = `${f.adjusted ? "Rescaled to the UN's 2026 correction of this country's numbers, the" : "The"} UN's model gives a 95% chance of ${range(a)} people in ${a.year} (its forecast: ${fmtCompact(a.medium)})`;
  s += b ? `, and ${range(b)} in ${b.year}.` : ".";
  const z = b ?? a;
  if (isNum(z.zeroMigration) && Math.abs(z.zeroMigration / z.medium - 1) >= 0.03)
    s += ` If nobody moved in or out, it would be ${fmtCompact(z.zeroMigration)} in ${z.year} instead of ${fmtCompact(z.medium)}.`;
  return s;
}

// One sentence for the top of the section: how sure, and the main reason.
export function sureSummary(rec, conf, now) {
  if (!conf?.level) return null;
  const name = theName(rec, { start: true });
  const t = conf.today ?? {};
  const bd = conf.birthsDeaths ?? {};
  const lead = { good: `${possessive(name)} numbers are solid`, fair: `${possessive(name)} numbers are partly estimated`, poor: `${possessive(name)} numbers are mostly estimated` }[conf.level];
  const reasons = [];
  const countWhy = t.lastCount == null ? "it has no census on record" : `its last census was in ${t.lastCount}`;
  if (t.level === conf.level || (conf.level === "good" && t.level === "good"))
    reasons.push(t.register ? "a population register keeps the count" : t.keptCurrent ? "its own up-to-date count matches the UN's" : countWhy);
  const gapsIn = ["births", "deaths"].filter((k) => bd[k]?.code && bd[k].code !== "C");
  const partly = gapsIn.length === 1 ? `not all ${gapsIn[0]} are registered` : "not all births and deaths are registered";
  if (bd.level === conf.level && conf.level !== "good") reasons.push(bd.level === "poor" ? "most births and deaths aren't registered" : partly);
  if (conf.level === "good" && bd.level === "good") reasons.push("almost all births and deaths are registered");
  if (t.downgraded && t.level === conf.level) reasons.push("its newest official figure differs from the UN's by more than 5%");
  const list = reasons.length > 2 ? `${reasons.slice(0, -1).join(", ")} and ${reasons.at(-1)}` : reasons.join(", and ");
  return `${lead}: ${list || countWhy}.`;
}

const gapPctWords = (g) => `${Math.abs(g) < 10 ? Math.abs(g).toFixed(1).replace(/\.0$/, "") : Math.round(Math.abs(g))}%`;
const gapWords = (c) =>
  c.gapPct == null ? "" : c.verdict === "matches" ? (Math.abs(c.gapPct) < 0.5 ? " (the same, within 0.5%)" : ` (${gapPctWords(c.gapPct)} apart)`) : `: the UN's is ${gapPctWords(c.gapPct)} ${c.gapPct > 0 ? "higher" : "lower"}`;

// The badge on a comparison: "Matches" under 1%, "Close" up to 2%; for a UN forecast of births or deaths, which way it
// was off.
export function checkBadge(c) {
  if (c.coverageDiffers) return "Different area";
  if (c.verdict === "matches") return Math.abs(c.gapPct ?? 0) < 1 ? "Matches" : "Close";
  if (c.verdict === "context") return "Context";
  const forecast = c.unFigure?.forecast && (c.key === "births" || c.key === "deaths");
  if (forecast) return c.verdict === "un-higher" ? "UN forecast too high" : "UN forecast too low";
  return c.verdict === "un-higher" ? "UN higher" : "UN lower";
}

// What a newer national figure says, next to the UN's (automatic checks; hand-checked notes carry their own text).
export function checkText(c) {
  if (c.kind === "researched") return c.text;
  const v = fmtWords(c.figure?.value);
  const un = fmtWords(c.unFigure?.value);
  const day = (d) => (d?.length === 10 ? fmtDate(d) : d);
  const first = c.figure?.provisional ? " (first results)" : "";
  const when = (d) => (d?.length === 10 && d.endsWith("-07-01") ? `mid-${d.slice(0, 4)}` : day(d));
  const covers = c.coverageDiffers ? " Their figure covers a different area or group (see their note), so the two can't be compared directly." : "";
  const gw = c.coverageDiffers ? "" : gapWords(c);
  switch (c.key) {
    case "today":
      return c.kind === "eurostat"
        ? `The national statistics office counted ${v} people on ${day(c.figure.date)} (${c.figure?.provisional ? "first results, " : ""}reported to Eurostat). The UN's figure for that day is ${un}${gw}.${covers}`
        : `The country's own estimate for ${when(c.figure.date)} is ${v} people${first} (reported to the UN Statistics Division). The UN's figure is ${un}${gw}.${covers}`;
    case "census":
      return c.partial
        ? `A census on ${day(c.figure.date)} put the population at ${v}${first}, but much of that total is estimated for areas it couldn't reach (see their note). The UN's figure for that day is ${un}${gw}.`
        : `A census on ${day(c.figure.date)} counted ${v} people${first}. The UN's numbers don't include it yet; its figure for that day is ${un}${gw}.${covers}`;
    case "births":
    case "deaths":
      return `${v} ${c.key} were registered in ${c.figure.date}, with registration reported as virtually complete (90% or more). The UN ${c.unFigure?.forecast ? "forecast" : "estimated"} ${un}${gw}.${covers}`;
    case "immigrants": {
      const refugees = c.unAddsRefugees && c.verdict === "un-higher" ? " The UN adds refugees, whom national counts often leave out." : "";
      return `The national count of people born abroad was ${v} on ${day(c.figure.date)} (reported to Eurostat). The UN's mid-2024 figure is ${un}${gapWords(c)}.${refugees}`;
    }
    default:
      return c.text ?? "";
  }
}

// Where an automatic check's numbers come from, for its links line.
export function checkSourceLabel(c) {
  return { eurostat: "Eurostat (national statistics offices)", unsd: "UN Statistics Division (national statistics offices)", researched: "Checked by hand" }[c.kind] ?? "";
}
