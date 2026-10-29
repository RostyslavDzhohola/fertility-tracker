// Sanity checks run before anything is written. Any error => the pipeline refuses to overwrite published data.

const inRange = (v, lo, hi) => v == null || (Number.isFinite(v) && v >= lo && v <= hi);

/**
 * ds: output of buildDataset. previous: { countries: parsed countries.json } | null.
 * Returns a list of error strings (empty = OK).
 */
export function sanityCheck(ds, previous = null) {
  const errors = [];
  const err = (m) => errors.length < 100 && errors.push(m);
  const by = new Map(ds.full.map((r) => [r.iso3, r]));

  if (ds.full.length < 200) err(`only ${ds.full.length} records (expected >= 200)`);
  if (ds.ranking.length < 150) err(`only ${ds.ranking.length} ranked countries (expected >= 150)`);
  if (!(ds.latestEstimateYear >= 2023 && ds.latestEstimateYear <= new Date().getUTCFullYear())) err(`odd latestEstimateYear ${ds.latestEstimateYear}`);

  const w = by.get("WLD");
  if (!w) err("world (WLD) record missing");
  else {
    if (!inRange(w.population?.value, 7e9, 1.1e10)) err(`world population out of range: ${w.population?.value}`);
    if (!inRange(w.tfr?.value, 1.5, 3.5)) err(`world tfr out of range: ${w.tfr?.value}`);
    if (!inRange(w.projection?.population2100, 6e9, 1.5e10)) err(`world 2100 projection out of range: ${w.projection?.population2100}`);
  }

  for (const r of ds.full) {
    const id = r.iso3;
    if (!r.name || !r.region) err(`${id}: missing name/region`);
    if (r.iso3 !== "WLD" && !inRange(r.population?.value, 1, 2e9)) err(`${id}: population ${r.population?.value}`);
    if (!inRange(r.tfr?.value, 0.3, 9)) err(`${id}: tfr ${r.tfr?.value}`);
    if (!inRange(r.birthRate?.value, 0, 60)) err(`${id}: birthRate ${r.birthRate?.value}`);
    if (!inRange(r.deathRate?.value, 0, 40)) err(`${id}: deathRate ${r.deathRate?.value}`);
    if (!inRange(r.share65?.value, 0, 45)) err(`${id}: share65 ${r.share65?.value}`);
    if (!inRange(r.medianAge?.value, 10, 65)) err(`${id}: medianAge ${r.medianAge?.value}`);
    if (!inRange(r.migrantStock?.immigrantsPct, 0, 100)) err(`${id}: immigrantsPct ${r.migrantStock?.immigrantsPct}`);
    const c = r.components;
    if (c) {
      if (c.births != null && c.births < 0) err(`${id}: negative births`);
      if (c.deaths != null && c.deaths < 0) err(`${id}: negative deaths`);
      if (c.births != null && c.deaths != null && c.naturalChange !== c.births - c.deaths) err(`${id}: naturalChange != births - deaths`);
      if (c.naturalChange != null && c.netMigration != null && c.populationChange !== c.naturalChange + c.netMigration)
        err(`${id}: populationChange != naturalChange + netMigration`);
      if (c.population && c.netMigration != null && Math.abs(c.netMigration) > c.population * 0.25) err(`${id}: net migration ${c.netMigration} implausible`);
    }
    if (r.projection && !(r.projection.change2100Pct > -100)) err(`${id}: change2100Pct ${r.projection.change2100Pct}`);
    if (r.risk.score != null && !inRange(r.risk.score, 0, 100)) err(`${id}: risk score ${r.risk.score}`);
    if (r.ranked && (!c || !r.projection || r.risk.score == null)) err(`${id}: ranked without complete data`);

    const s = ds.details.get(id)?.series ?? [];
    if (r.ranked && s.length < 140) err(`${id}: only ${s.length} series years`);
    for (let i = 1; i < s.length; i++) {
      if (s[i].year <= s[i - 1].year) err(`${id}: series years not increasing at ${s[i].year}`);
      if (s[i - 1].variant === "projection" && s[i].variant === "estimate") err(`${id}: estimate after projection at ${s[i].year}`);
    }
  }

  // Spot checks against well-known facts: catch swapped or mislabelled columns.
  const spot = [
    ["KOR", (r) => r.tfr?.value < 1.3, "South Korea tfr should be < 1.3"],
    ["NER", (r) => r.tfr?.value > 4, "Niger tfr should be > 4"],
    ["JPN", (r) => r.share65?.value > 20, "Japan 65+ share should be > 20%"],
    ["JPN", (r) => r.components?.naturalChange < 0, "Japan should have more deaths than births"],
    ["NGA", (r) => r.projection?.change2100Pct > 0, "Nigeria should be projected to grow"],
    ["USA", (r) => r.population?.value > 3e8 && r.population.value < 4e8, "US population should be 300-400 million"],
  ];
  for (const [code, ok, msg] of spot) {
    const r = by.get(code);
    if (!r || !ok(r)) err(`spot check failed: ${msg}`);
  }

  if (previous?.countries) {
    const prevCount = previous.countries.length;
    if (ds.full.length < prevCount * 0.95) err(`record count fell from ${prevCount} to ${ds.full.length}`);
    const pw = previous.countries.find((r) => r.iso3 === "WLD")?.population?.value;
    if (pw && w?.population?.value && Math.abs(w.population.value / pw - 1) > 0.05) err(`world population moved >5% (${pw} -> ${w.population.value})`);
  }
  if (previous?.details?.size) for (const e of coverageRegressions(previous.details, ds.details)) err(e);
  if (ds.scenarios || previous?.scenarios) for (const e of scenarioChecks(ds, previous?.scenarios ?? null)) err(e);
  return errors;
}

// ---------- scenarios.json ----------

const SCENARIO_KEYS = ["medium", "constant"];

/**
 * scenarios.json guards. Against the build itself: every record has both arrays, full length, no nulls, plausible
 * world totals; the medium path equals the series population (same UN projection) and both scenarios start from the
 * same level (catches a stale or partial overlay such as Togo's 2026 interim update). Against the previous published
 * file: no place lost, no year range shrinking, no array losing values. Returns error strings.
 */
export function scenarioChecks(ds, previous = null, { max = 40 } = {}) {
  const out = [];
  const sc = ds.scenarios;
  if (!sc) return previous ? ["scenarios.json: no scenario data in this build (it was published before)"] : [];
  const n = sc.endYear - sc.startYear + 1;
  if (!(n > 0)) return [`scenarios.json: bad year range ${sc.startYear}-${sc.endYear}`];
  for (const rec of ds.full ?? ds.records) {
    if (out.length >= max) break;
    const p = sc.places.get(rec.iso3);
    if (!p) {
      out.push(`scenarios.json: ${rec.iso3} (${rec.name}) missing`);
      continue;
    }
    for (const k of SCENARIO_KEYS) {
      const a = p[k];
      if (!Array.isArray(a) || a.length !== n) out.push(`scenarios.json: ${rec.iso3} ${k} has ${a?.length ?? 0} years, expected ${n}`);
      else if (a.some((v) => v == null || !Number.isInteger(v) || v < 0)) out.push(`scenarios.json: ${rec.iso3} ${k} has missing or invalid values`);
    }
    // The shared past: one value per year from estimateStartYear, each the series' UN estimate.
    const ne = sc.startYear - (sc.estimateStartYear ?? sc.startYear);
    const est = p.estimate;
    if (!Array.isArray(est) || est.length !== ne) out.push(`scenarios.json: ${rec.iso3} estimate has ${est?.length ?? 0} years, expected ${ne}`);
    else if (est.some((v) => v == null || !Number.isInteger(v) || v < 0)) out.push(`scenarios.json: ${rec.iso3} estimate has missing or invalid values`);
    const m0 = p.medium?.[0];
    const c0 = p.constant?.[0];
    if (m0 > 0 && c0 != null && Math.abs(c0 / m0 - 1) > 0.01) out.push(`scenarios.json: ${rec.iso3} constant starts ${c0} vs medium ${m0} in ${sc.startYear} (scenarios must share the same base population)`);
    const series = ds.details.get(rec.iso3)?.series ?? [];
    const bad = series.filter((r) => {
      const v = p.medium?.[r.year - sc.startYear];
      return r.year >= sc.startYear && r.year <= sc.endYear && r.population != null && v != null && Math.abs(v - r.population) > Math.max(2, r.population * 0.0005);
    });
    const badPast = series.filter((r) => {
      const v = p.estimate?.[r.year - sc.estimateStartYear];
      return r.year >= sc.estimateStartYear && r.year < sc.startYear && r.population != null && v != null && v !== Math.round(r.population);
    });
    if (badPast.length) out.push(`scenarios.json: ${rec.iso3} estimate differs from the series population in ${badPast.length} years (e.g. ${badPast[0].year}: ${p.estimate[badPast[0].year - sc.estimateStartYear]} vs ${badPast[0].population})`);
    if (bad.length) out.push(`scenarios.json: ${rec.iso3} medium differs from the series population in ${bad.length} years (e.g. ${bad[0].year}: ${p.medium[bad[0].year - sc.startYear]} vs ${bad[0].population})`);
  }
  const w = sc.places.get("WLD");
  const last = (k) => w?.[k]?.at(-1);
  if (w && !(last("medium") > 6e9 && last("medium") < 1.5e10)) out.push(`scenarios.json: world medium ${sc.endYear} out of range: ${last("medium")}`);
  if (w && !(last("constant") > 3e9 && last("constant") < 3e10)) out.push(`scenarios.json: world constant ${sc.endYear} out of range: ${last("constant")}`);
  if (previous) {
    if (sc.startYear > previous.startYear || sc.endYear < previous.endYear) {
      out.push(`scenarios.json: year range would shrink from ${previous.startYear}-${previous.endYear} to ${sc.startYear}-${sc.endYear}`);
    }
    if (previous.estimateStartYear != null && !(sc.estimateStartYear <= previous.estimateStartYear)) {
      out.push(`scenarios.json: the past would shrink from ${previous.estimateStartYear} to ${sc.estimateStartYear ?? "none"}`);
    }
    const values = (a) => (a ?? []).filter((v) => v != null).length;
    for (const [code, prev] of Object.entries(previous.places ?? {})) {
      if (out.length >= max) break;
      const cur = sc.places.get(code);
      if (!cur) out.push(`scenarios.json: ${code} would be dropped (it was published before)`);
      else for (const k of [...SCENARIO_KEYS, "estimate"]) if (values(cur[k]) < values(prev[k])) out.push(`scenarios.json: ${code} ${k} would lose values (${values(prev[k])} -> ${values(cur[k])})`);
    }
  }
  return out.slice(0, max);
}

// ---------- coverage regression vs the previous published build ----------

const SERIES_KEYS = ["population", "births", "deaths", "naturalChange", "netMigration", "populationChange", "tfr", "medianAge", "share65"];
const STOCK_KEYS = ["immigrants", "immigrantsPct", "emigrants", "emigrantsPct"];
const HEADLINE_KEYS = ["population", "tfr", "birthRate", "deathRate", "naturalChangeRate", "netMigration", "populationGrowthPct", "medianAge", "share65"];
const BLOCK_KEYS = ["components", "migrantStock", "projection", "generations", "migrationCorridors"];

/**
 * What one country record covers: years with data per series metric, which headline fields and blocks are present,
 * whether it is scored and ranked. Works on detail-shaped records (published countries/{ISO3}.json or ds.details).
 */
export function coverage(d) {
  const count = (rows, k) => (rows ?? []).reduce((n, r) => n + (r[k] != null ? 1 : 0), 0);
  const out = {};
  for (const k of SERIES_KEYS) out[`series.${k}`] = count(d.series, k);
  for (const k of STOCK_KEYS) out[`migrantStockSeries.${k}`] = count(d.migrantStockSeries, k);
  for (const k of HEADLINE_KEYS) out[k] = d[k]?.value != null ? 1 : 0;
  for (const k of BLOCK_KEYS) out[k] = d[k] ? 1 : 0;
  for (const k of ["births", "deaths", "naturalChange", "netMigration", "populationChange"]) out[`components.${k}`] = d.components?.[k] != null ? 1 : 0;
  // Each corridor direction separately: a breakdown that existed must not vanish (BES/VAT never had origins: fine).
  out["migrationCorridors.topOrigins"] = d.migrationCorridors?.topOrigins?.length ? 1 : 0;
  out["migrationCorridors.topDestinations"] = d.migrationCorridors?.topDestinations?.length ? 1 : 0;
  out["risk.score"] = d.risk?.score != null ? 1 : 0;
  out.ranked = d.ranked ? 1 : 0;
  return out;
}

/**
 * Provenance regressions for one country: a published year must never move backwards, and a World Bank value must
 * not be replaced by another source for the same year (that means the WB value vanished and an older fallback won).
 * Catches successful-but-partial responses that a presence check cannot see (e.g. WB tfr 2024 -> UN tfr 2023).
 */
export function provenanceRegressions(prev, cur) {
  const out = [];
  const point = (label, a, b) => {
    if (a?.year == null || b?.year == null) return; // presence is covered by coverage()
    if (b.year < a.year || (b.year === a.year && a.source === "WB" && b.source !== "WB")) {
      out.push(`${label} ${a.year} ${a.source ?? ""} -> ${b.year} ${b.source ?? ""}`.replace(/\s+/g, " ").trim());
    }
  };
  for (const k of HEADLINE_KEYS) point(k, prev[k], cur[k]);
  point("migrantStock", prev.migrantStock, cur.migrantStock);
  point("components", prev.components, cur.components);
  point("migrationCorridors", prev.migrationCorridors, cur.migrationCorridors);
  if (prev.projection?.baseYear != null && cur.projection?.baseYear != null && cur.projection.baseYear < prev.projection.baseYear) {
    out.push(`projection.baseYear ${prev.projection.baseYear} -> ${cur.projection.baseYear}`);
  }
  if (prev.migrantStock?.source === "UN-DESA" && cur.migrantStock?.source && cur.migrantStock.source !== "UN-DESA" && cur.migrantStock.year <= prev.migrantStock.year) {
    out.push(`migrantStock source UN-DESA -> ${cur.migrantStock.source}`);
  }
  return [...new Set(out)];
}

/**
 * Compare every country and metric against the previous published build. Any loss (a country gone, fewer years of a
 * series, a field, block or corridor direction that was present and is now empty, dropping out of the risk ranking,
 * a headline year moving backwards or a World Bank value replaced by a same-year fallback) is an error: a partial
 * upstream response must never overwrite good data. Intentional changes need --force.
 */
export function coverageRegressions(previousDetails, details, { max = 60 } = {}) {
  const out = [];
  for (const [iso3, prev] of previousDetails) {
    if (out.length >= max) break;
    const cur = details.get(iso3);
    if (!cur) {
      out.push(`${iso3}: record missing (was published before)`);
      continue;
    }
    const older = provenanceRegressions(prev, cur);
    if (older.length) out.push(`${iso3} (${cur.name}): older data would replace newer: ${older.join(", ")}`);
    const a = coverage(prev);
    const b = coverage(cur);
    const lost = Object.keys(a).filter((k) => b[k] < a[k]);
    if (!lost.length) continue;
    if (lost.includes("ranked")) out.push(`${iso3} (${cur.name}): dropped out of the risk ranking (was rank ${prev.risk?.rank ?? "?"})`);
    const rest = lost.filter((k) => k !== "ranked");
    if (rest.length) out.push(`${iso3} (${cur.name}): lost data vs the previous build: ${rest.map((k) => (a[k] > 1 ? `${k} ${a[k]} -> ${b[k]} years` : k)).join(", ")}`);
  }
  return out.slice(0, max);
}

/**
 * Decide whether a build may be published given each dataset's fetch status.
 * - a required dataset (or the World Bank country list) is down: never publish;
 * - a dataset that was "ok" in the previous published index.json is down now: do not publish (unless force);
 * - a dataset that has never worked: publish with its fields null (a documented gap).
 */
export function sourceDecision(datasets, previousIndex, { force = false } = {}) {
  const prevStatus = new Map((previousIndex?.sources ?? []).flatMap((s) => (s.datasets ?? []).map((d) => [d.id, d.status])));
  const problems = [];
  const warnings = [];
  let hard = false;
  for (const d of datasets) {
    if (d.status === "ok") continue;
    if (d.required || d.id === "countries") {
      hard = true;
      problems.push(`required source ${d.id} unavailable: ${d.error}`);
    } else if (prevStatus.get(d.id) === "ok") problems.push(`source ${d.id} worked in the last build but is unavailable now: ${d.error}`);
    else warnings.push(`${d.id} unavailable; publishing with its fields null (documented in index.json dataGaps)`);
  }
  return { publish: !hard && (force || problems.length === 0), problems, warnings };
}
