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
  return errors;
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
