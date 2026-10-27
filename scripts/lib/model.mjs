// Demographic model: yearly series, demographic balance (births - deaths + net migration), projections, generations.
// Pure functions over parsed source data.

export const REPLACEMENT_TFR = 2.1;
export const GENERATION_YEARS = 30;

export const round = (v, d = 0) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d || 0);
const sum = (...xs) => (xs.some((x) => x == null) ? null : xs.reduce((a, b) => a + b, 0));

/** Value of an "estimate" column, falling back to the "projection" column. Returns [value, variant]. */
function pick(y, est, proj) {
  if (!y) return [null, null];
  if (y[est] != null) return [y[est], "estimate"];
  if (y[proj] != null) return [y[proj], "projection"];
  return [null, null];
}

/**
 * One row per year (1950-2100) for a country, merging UN WPP datasets.
 * Every row: year, variant ("estimate" | "projection"), population, births, deaths, naturalChange,
 * netMigration, populationChange, tfr, medianAge, share65. Missing values are null.
 */
export function buildSeries(code, wpp) {
  const ent = (ds) => wpp[ds]?.entities.get(code);
  const popE = ent("population");
  if (!popE) return [];
  const years = [...popE.years.keys()].sort((a, b) => a - b);
  const rows = [];
  for (const year of years) {
    const at = (ds) => ent(ds)?.years.get(year);
    const [population, variant] = pick(at("population"), "popEst", "popProj");
    if (population == null) continue;
    const bd = at("birthsDeaths");
    const [births] = pick(bd, "birthsEst", "birthsProj");
    const [deaths] = pick(bd, "deathsEst", "deathsProj");
    const [netMigration] = pick(at("netMigration"), "netMigEst", "netMigProj");
    const [tfr] = pick(at("fertility"), "tfrEst", "tfrProj");
    const [medianAge] = pick(at("medianAge"), "medianAgeEst", "medianAgeProj");
    const age = at("ageStructure");
    const [pop65] = pick(age, "pop65Est", "pop65Proj");
    const [popAll] = pick(age, "popAllEst", "popAllProj");
    const naturalChange = births != null && deaths != null ? Math.round(births) - Math.round(deaths) : null;
    rows.push({
      year,
      variant,
      population: round(population),
      births: round(births),
      deaths: round(deaths),
      naturalChange,
      netMigration: round(netMigration),
      populationChange: sum(naturalChange, round(netMigration)),
      tfr: round(tfr, 3),
      medianAge: round(medianAge, 1),
      share65: pop65 != null && popAll > 0 ? round((pop65 / popAll) * 100, 1) : null,
    });
  }
  return rows;
}

export const lastEstimateYear = (series) => series.filter((r) => r.variant === "estimate").at(-1)?.year ?? null;

const perThousand = (v, pop) => (v == null || !(pop > 0) ? null : round((v / pop) * 1000, 1));

/** Demographic balance for one year: absolute numbers + rates per 1,000 mid-year population. */
export function demographicBalance(row, source = "UN-WPP") {
  if (!row) return null;
  const { year, population: pop, births, deaths, naturalChange, netMigration, populationChange } = row;
  return {
    year,
    source,
    population: pop,
    births,
    deaths,
    naturalChange,
    netMigration,
    populationChange,
    perThousand: {
      births: perThousand(births, pop),
      deaths: perThousand(deaths, pop),
      naturalChange: perThousand(naturalChange, pop),
      netMigration: perThousand(netMigration, pop),
      populationChange: perThousand(populationChange, pop),
    },
    // Share of the natural decline (deaths - births) offset by net migration; null when births >= deaths.
    migrationOffsetPct:
      naturalChange != null && naturalChange < 0 && netMigration != null ? round((netMigration / -naturalChange) * 100) : null,
  };
}

/**
 * Start year of the current (or next) run of years with more deaths than births.
 * If deaths exceed births in baseYear: the earliest year of the unbroken run ending at baseYear.
 * Otherwise: the first later year (projection) with more deaths than births. Null if never (to 2100).
 */
export function naturalDeclineSince(series, baseYear) {
  const i = series.findIndex((r) => r.year === baseYear);
  if (i < 0) return null;
  if (series[i].naturalChange != null && series[i].naturalChange < 0) {
    let j = i;
    while (j > 0 && series[j - 1].naturalChange != null && series[j - 1].naturalChange < 0) j--;
    return series[j].year;
  }
  return series.slice(i + 1).find((r) => r.naturalChange != null && r.naturalChange < 0)?.year ?? null;
}

/** UN medium-variant outlook relative to the latest estimate year. */
export function projectionSummary(series, baseYear) {
  const at = (y) => series.find((r) => r.year === y);
  const base = at(baseYear);
  const p2050 = at(2050);
  const p2100 = at(2100);
  if (!base?.population || !p2050?.population || !p2100?.population) return null;
  let peak = series[0];
  for (const r of series) if (r.population > peak.population) peak = r;
  const half = series.find((r) => r.year > baseYear && r.population <= base.population / 2);
  const pct = (p) => round(((p - base.population) / base.population) * 100, 1);
  return {
    source: "UN-WPP",
    variant: "medium",
    baseYear,
    basePopulation: base.population,
    population2050: p2050.population,
    population2100: p2100.population,
    change2050Pct: pct(p2050.population),
    change2100Pct: pct(p2100.population),
    peakYear: peak.year,
    peakPopulation: peak.population,
    halfPopulationYear: half?.year ?? null,
    tfr2050: p2050.tfr,
    tfr2100: p2100.tfr,
    share65in2050: p2050.share65,
    medianAge2050: p2050.medianAge,
    naturalDeclineSince: naturalDeclineSince(series, baseYear),
  };
}

/** The "100 people" view: each ~30-year generation is (TFR / 2.1) the size of the one before. */
export function generations(tfr) {
  if (tfr == null || !(tfr > 0)) return null;
  const ratio = tfr / REPLACEMENT_TFR;
  return {
    ratio: round(ratio, 3),
    halvingYears: ratio < 1 ? round((GENERATION_YEARS * Math.log(0.5)) / Math.log(ratio)) : null,
    hundredPeople: [0, 1, 2, 3, 4].map((g) => round(100 * ratio ** g)),
  };
}

/** Newest candidate wins; ties go to the earlier candidate (priority order). Candidates: {value, year, source} | null. */
export function pickLatest(...cands) {
  let best = null;
  for (const c of cands) if (c && c.value != null && Number.isFinite(c.value) && (!best || c.year > best.year)) best = c;
  return best ? { value: best.value, year: best.year, source: best.source } : null;
}
