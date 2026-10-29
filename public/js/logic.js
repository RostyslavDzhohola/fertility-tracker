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

// People in `year` (fractional years interpolate, so Play is smooth). null when missing.
export function popAt(scen, iso3, year, scenario = "medium") {
  const arr = scen?.places?.[iso3]?.[normScenario(scenario)];
  if (!Array.isArray(arr) || !arr.length || !isNum(year)) return null;
  const t = clamp(year - scen.startYear, 0, arr.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  const a = arr[i];
  const b = arr[Math.min(i + 1, arr.length - 1)];
  if (!isNum(a)) return isNum(b) && f > 0.5 ? b : null;
  if (!isNum(b) || f === 0) return a;
  return a + (b - a) * f;
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

// ---------------------------------------------------------------- the people ramp (DESIGN-v3 §1)

// % change vs today → color. Greens grow (blue-leaning, so they part from the oranges under red-green color blindness),
// sand stays about the same, orange → red shrinks, and from half gone on a gray that darkens. Checked under protan,
// deutan and tritan simulation (docs/design/DESIGN-v3.md §1).
export const RAMP = [
  [-100, "#3B3A39"],
  [-80, "#5E5B58"],
  [-50, "#9A958F"],
  [-49.999, "#BE3A30"],
  [-35, "#DA573A"],
  [-20, "#EC8447"],
  [-10, "#F4B26E"],
  [-4, "#F2D9A9"],
  [0, "#EEE5CD"],
  [4, "#DDE8D0"],
  [12, "#ABD8C4"],
  [30, "#62B7A6"],
  [60, "#2C9690"],
  [120, "#13737A"],
  [250, "#0B4F63"],
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

// The % as people read it: whole numbers, one decimal under 1%, halves rounded away from zero on both sides
// (−49.5 → −50, like +49.5 → +50). fmtPct prints this value and colors and words use it, so a place shown as "−50%"
// is always "Half gone", never "Shrinking fast".
export function roundPct(x) {
  if (!isNum(x)) return null;
  const a = Math.abs(x);
  const r = a < 1 ? Math.round(a * 10) / 10 : Math.round(a);
  return r === 0 ? 0 : Math.sign(x) * r;
}
export const shownPct = roundPct;

export function changeColor(pct) {
  if (!isNum(pct)) return null;
  const p = clamp(shownPct(pct), RAMP[0][0], RAMP[RAMP.length - 1][0]);
  for (let i = 1; i < RAMP_RGB.length; i++) {
    const [p1, c1] = RAMP_RGB[i];
    if (p <= p1) {
      const [p0, c0] = RAMP_RGB[i - 1];
      const t = p1 === p0 ? 1 : (p - p0) / (p1 - p0);
      return rgbToHex([0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * t));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

// The legend, worst first (left to right on screen).
// One five-word scale for every word and meter on screen: the globe legend, the card chip, the country meter and
// verdict, search rows and rankings. Each word covers a band of the ramp above; its color is the ramp's color in the
// middle of that band. Chips and meters describe 2100 under the selected scenario, compared with today.
export const OUTLOOK = [
  { key: "growing", label: "Growing", from: 5, to: Infinity, pct: 40 },
  { key: "same", label: "About the same", from: -5, to: 5, pct: 0 },
  { key: "shrinking", label: "Shrinking", from: -25, to: -5, pct: -15 },
  { key: "fast", label: "Shrinking fast", from: -50, to: -25, pct: -37 },
  { key: "half", label: "Half gone", from: -100, to: -50, pct: -70 },
];

// 0 growing … 4 half gone; -1 without a figure. Boundaries: > +5, −5…+5, −25…−5, −50…−25, ≤ −50.
export function outlookStep(pct) {
  if (!isNum(pct)) return -1;
  pct = shownPct(pct);
  if (pct <= -50) return 4;
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

// Plain verdict for 2100 under a scenario. It always agrees with outlookStep(pct): the same five bands.
// peakYear (of the scenario's path) adds "grows for a while, then …" when the peak is still ahead.
export function verdict(rec, pct2100, today, { scenario = "medium", peakYear = rec?.projection?.peakYear, small = isSmallPlace(rec) } = {}) {
  const name = theName(rec, { start: true });
  if (small) return `${name} has a very small population: its numbers swing a lot.`;
  if (!isNum(pct2100)) return `${name}: no forecast in our sources.`;
  const rising = isNum(peakYear) && peakYear > today + 3 && peakYear < END_YEAR;
  const step = outlookStep(pct2100);
  let v;
  if (step === 4) v = rising ? `${name} grows a little longer, then loses half its people or more.` : `${name} loses half its people or more by 2100.`;
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
export function yearlyNetSentence(net) {
  if (!isNum(net)) return "No recent figure for people moving in and out.";
  if (Math.abs(net) < 50) return "Each year, about as many people arrive as leave.";
  const n = fmtFlow(Math.abs(net), { plus: false });
  return net < 0 ? `Each year, ${n} more people leave than arrive.` : `Each year, ${n} more people arrive than leave.`;
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
export function flowsBetween(series, from, to) {
  let births = 0;
  let deaths = 0;
  let net = 0;
  let years = 0;
  for (const r of series ?? []) {
    if (r.year < from || r.year > to) continue;
    if (!isNum(r.births) || !isNum(r.deaths)) return null;
    births += r.births;
    deaths += r.deaths;
    if (isNum(r.netMigration)) net += r.netMigration;
    years++;
  }
  if (!years) return null;
  return { from, to, years, births, deaths, netMigration: net, natural: births - deaths, change: births - deaths + net };
}

// One plain sentence for flowsBetween(): does moving in hold the place up? name: "Germany", "the United States".
export function flowsSentence(f, name, { world = false } = {}) {
  if (!f) return "No yearly figures for births, deaths and moving.";
  const fl = (v) => fmtFlow(Math.abs(v), { plus: false });
  const nat = f.natural;
  const mig = world ? 0 : f.netMigration;
  // Moving that changes the total by under 2% of births or deaths barely matters.
  const moves = Math.abs(mig) >= 0.02 * Math.max(f.births, f.deaths, 1);
  if (world) return nat < 0 ? "More people die than are born. Moving doesn't change the world's total." : "More babies are born than people die. Moving doesn't change the world's total.";
  if (nat < 0) {
    if (!moves) return "More people die than are born. Moving in and out barely changes it.";
    if (mig < 0) return "More people die than are born, and more people leave than arrive.";
    if (nat + mig >= 0) return "More people die than are born. People moving in make up the difference.";
    return `${fl(nat)} more people die than are born. People moving in cut the loss to ${fl(nat + mig)}.`;
  }
  if (!moves) return "More babies are born than people die. Moving in and out barely changes it.";
  if (mig < 0) return nat + mig < 0 ? `More babies are born than people die, but so many leave that ${name} shrinks.` : "More babies are born than people die. Some people leave, but fewer than are born.";
  return "More babies are born than people die, and more people move in than leave.";
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
  if (r < 0.995) return `${n === 10 ? "Almost all" : `${Math.max(0, n)} of 10`} still here in ${year}.`;
  if (r > 1.005) return `${n} for every 10 today.`;
  return "About the same as today.";
}

// The words that go with a shared picture: the place, the slider year and the chosen future, like the picture.
export function snapshotPostText({ rec, year, today, scenario, ratio }) {
  const who = displayName(rec);
  const tfr = isNum(rec?.tfr?.value) ? ` ${fmtTfr(rec.tfr.value)} babies per woman today.` : "";
  if (!isNum(ratio) || year === today) return `${who}: where its population is headed by 2100.${tfr}`;
  const n = Math.round(100 * ratio);
  const future = scenario === "constant" ? "if birth rates stay the same" : "UN forecast";
  return `${who} in ${year}: for every 100 people today, about ${n}${n < 100 ? " left" : ""} (${future}).${tfr}`;
}

export const HOME_TITLE = "Fertility Tracker: every country's population, today to 2100";

export function documentTitle(page, rec = null, pct2100 = null) {
  if (page === "country" && rec) return `${rec.iso3 === "WLD" ? "The world" : rec.name}: ${verdictShort(pct2100)} · Fertility Tracker`;
  if (page === "rankings") return "Where populations will shrink most · Fertility Tracker";
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
