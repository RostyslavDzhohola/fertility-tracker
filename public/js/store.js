// Shared state for every page: the data, the slider year, the scenario, Play. Pages subscribe and redraw.
// The scenario switch animates a blend (`mix`, 0 = UN forecast, 1 = if birth rates stay the same), so the globe colors
// and every number glide to the new scenario instead of jumping.

import * as L from "./logic.js";

export const API = "/api/v1/";

export const data = {
  records: new Map(),
  list: [], // every place except WLD
  searchPlaces: [],
  scen: null,
  today: new Date().getFullYear(),
  start: 2024,
  end: L.END_YEAR,
  latestEstimateYear: 2023,
  generatedAt: null,
  rankedN: 0,
  risk: null,
  index: null,
  feedback: null,
  feedbackFailed: false,
  status: null,
  details: new Map(),
  siteUrl: L.SITE_URL,
  ready: false,
};

export const state = {
  year: L.END_YEAR, // may be fractional while playing or gliding
  scenario: "medium",
  mix: 0,
  playing: false,
  touched: false, // the user has moved the slider, pressed Play or switched the scenario
};

const subs = new Set();
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
function emit(what) {
  for (const fn of subs) fn(what);
}

export async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// ------------------------------------------------------------------ data

export function applyCountries(json) {
  data.records = new Map(json.countries.map((c) => [c.iso3, c]));
  data.list = json.countries.filter((c) => c.iso3 !== "WLD");
  data.searchPlaces = json.countries.map((c) => ({ iso3: c.iso3, name: c.name, population: c.population?.value ?? 0 }));
  data.generatedAt = json.generatedAt ?? data.generatedAt;
  data.latestEstimateYear = json.latestEstimateYear ?? data.latestEstimateYear;
  data.rankedN = data.list.filter((c) => Number.isInteger(c.risk?.rank)).length;
}

export function applyScenarios(json) {
  data.scen = json;
  data.start = json.startYear ?? 2024;
  data.end = json.endYear ?? L.END_YEAR;
  data.today = L.todayYear(json);
}

export function loadDetail(iso3) {
  let e = data.details.get(iso3);
  if (e) return e.promise;
  e = { data: null, promise: null };
  e.promise = fetchJson(`${API}countries/${encodeURIComponent(iso3)}.json`).then(
    (d) => {
      e.data = d;
      return d;
    },
    (err) => {
      data.details.delete(iso3);
      throw err;
    },
  );
  data.details.set(iso3, e);
  return e.promise;
}

export const cachedDetail = (iso3) => data.details.get(iso3)?.data ?? null;

// ------------------------------------------------------------------ derived numbers

// People in a place at the current (or given) year, blended between the two scenarios.
export function popNow(iso3, year = state.year, mix = state.mix) {
  const a = L.popAt(data.scen, iso3, year, "medium");
  if (mix <= 0) return a;
  const b = L.popAt(data.scen, iso3, year, "constant");
  if (a == null || b == null) return a ?? b;
  return a + (b - a) * mix;
}

export function popToday(iso3) {
  return L.popAt(data.scen, iso3, data.today, "medium");
}

export function ratioNow(iso3, year = state.year, mix = state.mix) {
  const base = popToday(iso3);
  const v = popNow(iso3, year, mix);
  if (base == null || v == null || base <= 0) return null;
  return v / base;
}

export function pctNow(iso3, year = state.year, mix = state.mix) {
  const r = ratioNow(iso3, year, mix);
  return r == null ? null : (r - 1) * 100;
}

// % change by 2100 in one scenario (rankings, verdicts).
export function pct2100(iso3, scenario = "medium") {
  return L.pctVsToday(data.scen, iso3, data.end, scenario, data.today);
}

export function yearInt() {
  return Math.round(state.year);
}

// ------------------------------------------------------------------ year, scenario, play

let glide = 0;

export function setYear(y, { animate = false, source = "user" } = {}) {
  const target = Math.max(data.today, Math.min(data.end, y));
  if (source === "user") {
    state.touched = true;
    if (state.playing) pause();
  }
  cancelAnimationFrame(glide);
  if (!animate || Math.abs(target - state.year) < 2.5 || reduced()) {
    state.year = target;
    emit("year");
    return;
  }
  const from = state.year;
  const t0 = performance.now();
  const dur = 380;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    state.year = from + (target - from) * e;
    emit("year");
    if (p < 1) glide = requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
}

let mixRaf = 0;
export function setScenario(s, { source = "user", animate = true } = {}) {
  const sc = L.normScenario(s);
  if (source === "user") state.touched = true;
  if (sc === state.scenario) return;
  state.scenario = sc;
  emit("scenario");
  const target = sc === "constant" ? 1 : 0;
  cancelAnimationFrame(mixRaf);
  mixRaf = 0;
  if (!animate || reduced()) {
    state.mix = target;
    emit("mix");
    return;
  }
  const from = state.mix;
  const t0 = performance.now();
  const dur = 650;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    state.mix = from + (target - from) * e;
    emit("mix");
    if (p < 1) mixRaf = requestAnimationFrame(step);
    else mixRaf = 0;
  };
  mixRaf = requestAnimationFrame(step);
}

let playRaf = 0;
let playLast = 0;
let playDuration = 6000; // ms for today → 2100

export function play({ from = null, duration = 6000, source = "user" } = {}) {
  if (source === "user") state.touched = true;
  cancelAnimationFrame(glide);
  playDuration = duration;
  if (from != null) state.year = from;
  else if (state.year >= data.end - 0.01) state.year = data.today;
  state.playing = true;
  playLast = 0;
  emit("play");
  emit("year");
  cancelAnimationFrame(playRaf);
  playRaf = requestAnimationFrame(playStep);
}

function playStep(t) {
  if (!state.playing) return;
  const dt = playLast ? Math.min(50, t - playLast) : 0;
  playLast = t;
  const speed = (data.end - data.today) / playDuration;
  state.year = Math.min(data.end, state.year + dt * speed);
  emit("year");
  if (state.year >= data.end) {
    state.year = data.end;
    pause();
    return;
  }
  playRaf = requestAnimationFrame(playStep);
}

export function pause() {
  if (!state.playing) return;
  state.playing = false;
  cancelAnimationFrame(playRaf);
  state.year = Math.round(state.year);
  emit("play");
  emit("year");
}

export function togglePlay() {
  if (state.playing) pause();
  else play();
}

export function reduced() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
