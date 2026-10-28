// Pure comparisons for scripts/validate-data.mjs: every published number against the primary sources (UN WPP 2024
// CSVs with the 2026 interim update, World Bank API, UN DESA International Migrant Stock 2024 tables), plus the
// internal identities between files. No network here; the CLI loads the references and calls validatePublished().
import { parseCsv } from "./csv.mjs";
import { generations, REPLACEMENT_TFR } from "./model.mjs";
import { riskInputs, scoreRisk } from "./risk.mjs";

/**
 * Tolerances: only the rounding the API applies. UN WPP counts are published in thousands with 3 decimals and we
 * publish whole people (so +-0.5, plus float noise); rates are rounded (tfr to 3 decimals, ages, shares and per-1,000
 * rates to 1 decimal). Before October 2026 the series came from Our World in Data, whose sums of single-age values
 * were off by up to 34 people (and by 12 of Tokelau's 14 deaths): this validator found that.
 */
export const TOLERANCE = {
  people: 1,
  tfr: 0.0005 + 1e-9,
  oneDecimal: 0.05 + 1e-9,
  pct1: 0.05 + 1e-6, // % change rounded to 1 decimal, recomputed from UN totals
  growthPct: 0.011,
  wb: { population: 0.5, tfr: 0.0005 + 1e-9, birthRate: 0.05 + 1e-9, deathRate: 0.05 + 1e-9, naturalChangeRate: 0.1 + 1e-9, netMigration: 0.5, populationGrowthPct: 0.005 + 1e-9, share65: 0.05 + 1e-9 },
  stockPct: 0.05 + 1e-9,
  livingAbroadPct: 0.1 + 1e-9,
};

const round = (v, d = 0) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d || 0);

/** Collects comparisons per check: counts, mismatches with examples, and the largest difference seen. */
export class Report {
  constructor({ examples = 8 } = {}) {
    this.checks = new Map();
    this.examples = examples;
    this.notes = [];
  }
  check(id, { source, description }) {
    if (!this.checks.has(id)) this.checks.set(id, { id, source, description, compared: 0, mismatches: 0, countries: new Set(), badCountries: new Set(), maxDiff: 0, maxExample: null, examples: [] });
    return this.checks.get(id);
  }
  /** Numeric comparison within tol; nulls must agree (both missing is fine and not counted). */
  num(id, meta, iso3, label, pub, ref, tol) {
    const c = this.check(id, meta);
    if (pub == null && ref == null) return true;
    c.compared++;
    c.countries.add(iso3);
    if (pub == null || ref == null || !Number.isFinite(pub) || !Number.isFinite(ref)) return this.#bad(c, iso3, `${iso3} ${label}: published ${fmt(pub)}, reference ${fmt(ref)}`);
    const diff = Math.abs(pub - ref);
    if (diff > c.maxDiff) {
      c.maxDiff = diff;
      c.maxExample = `${iso3} ${label}: published ${fmt(pub)}, reference ${fmt(ref)}`;
    }
    if (diff > tol) return this.#bad(c, iso3, `${iso3} ${label}: published ${fmt(pub)}, reference ${fmt(ref)} (diff ${fmt(round(diff, 6))}, tolerance ${fmt(round(tol, 6))})`);
    return true;
  }
  /** Exact equality (strings, years, sources, arrays via JSON). */
  eq(id, meta, iso3, label, pub, ref) {
    const c = this.check(id, meta);
    c.compared++;
    c.countries.add(iso3);
    const a = typeof pub === "object" ? JSON.stringify(pub) : pub;
    const b = typeof ref === "object" ? JSON.stringify(ref) : ref;
    if (a !== b) return this.#bad(c, iso3, `${iso3} ${label}: published ${clip(a)}, expected ${clip(b)}`);
    return true;
  }
  note(text) {
    this.notes.push(text);
  }
  #bad(c, iso3, text) {
    c.mismatches++;
    c.badCountries.add(iso3);
    if (c.examples.length < this.examples) c.examples.push(text);
    return false;
  }
  summary() {
    const checks = [...this.checks.values()].map((c) => ({
      id: c.id,
      source: c.source,
      description: c.description,
      compared: c.compared,
      countries: c.countries.size,
      mismatches: c.mismatches,
      mismatchCountries: [...c.badCountries].sort(),
      maxDiff: round(c.maxDiff, 6),
      maxExample: c.maxExample,
      examples: c.examples,
    }));
    return {
      compared: checks.reduce((n, c) => n + c.compared, 0),
      mismatches: checks.reduce((n, c) => n + c.mismatches, 0),
      countries: new Set([...this.checks.values()].flatMap((c) => [...c.countries])).size,
      checks,
      notes: this.notes,
    };
  }
}
const fmt = (v) => (v == null ? "null" : typeof v === "number" ? String(v) : JSON.stringify(v));
const clip = (s) => {
  const t = String(s);
  return t.length > 160 ? `${t.slice(0, 157)}...` : t;
};

const UN = { source: "UN WPP 2024 CSV (population.un.org) + 2026-01-19 interim update" };
const WB = { source: "World Bank WDI API" };
const IMS = { source: "UN DESA International Migrant Stock 2024 (un.org .xlsx tables)" };
const SELF = { source: "internal consistency" };

/**
 * published: { countries (countries.json), details: Map<iso3, detail>, risk (risk.json), scenarios (scenarios.json|null),
 *              countriesCsv (text|null), timeseriesCsv (text|null), index }
 * refs: { un?: { ind: Map<code, Map<year, row>>, share65?: Map<code, Map<year, pct>>, scen?: { main, update } },
 *         wb?: { latest: {key: Map<code, {value, year}>}, lastUpdated }, ims?: {...} }
 */
export function validatePublished(published, refs, opts = {}) {
  const r = new Report(opts);
  const { details } = published;
  const estYear = published.countries.latestEstimateYear;
  if (refs.un) compareUnSeries(r, details, refs.un, estYear);
  if (refs.un) compareProjection(r, details, refs.un, estYear);
  compareHeadline(r, details, refs, estYear);
  compareDerived(r, published);
  if (published.scenarios) compareScenarios(r, published, refs.un?.scen);
  if (refs.ims) compareMigrantStock(r, details, refs.ims);
  if (published.countriesCsv || published.timeseriesCsv) compareCsv(r, published);
  patternChecks(r, details, refs.un, estYear);
  return r;
}

// ---------- UN WPP series ----------

function compareUnSeries(r, details, un, estYear) {
  for (const [iso3, d] of details) {
    const ref = un.ind.get(iso3);
    const meta = (field, description) => [`series.${field}`, { ...UN, description }];
    if (!ref) {
      r.eq("series.coverage", { ...UN, description: "Every published place exists in the UN file" }, iso3, "in UN WPP", false, true);
      continue;
    }
    const years = d.series.map((s) => s.year);
    r.eq("series.years", { ...UN, description: "Series covers every year 1950-2100 once, in order" }, iso3, "years", `${years[0]}-${years.at(-1)} x${years.length}`, "1950-2100 x151");
    for (const s of d.series) {
      const u = ref.get(s.year);
      if (!u) continue;
      const y = `${s.year}`;
      r.eq("series.variant", { ...UN, description: `variant = estimate up to ${estYear}, projection after` }, iso3, `${y} variant`, s.variant, s.year <= estYear ? "estimate" : "projection");
      r.num(...meta("population", "1 July population vs TPopulation1July"), iso3, `${y} population`, s.population, u.population, TOLERANCE.people);
      r.num(...meta("births", "Births vs Births"), iso3, `${y} births`, s.births, u.births, TOLERANCE.people);
      r.num(...meta("deaths", "Deaths vs Deaths"), iso3, `${y} deaths`, s.deaths, u.deaths, TOLERANCE.people);
      r.num(...meta("netMigration", "Net migration vs NetMigrations"), iso3, `${y} netMigration`, s.netMigration, u.netMigration, TOLERANCE.people);
      r.num(...meta("naturalChange", "births - deaths vs NatChange"), iso3, `${y} naturalChange`, s.naturalChange, u.naturalChange, TOLERANCE.people * 2);
      r.num(...meta("tfr", "Fertility rate vs TFR"), iso3, `${y} tfr`, s.tfr, u.tfr, TOLERANCE.tfr);
      r.num(...meta("medianAge", "Median age vs MedianAgePop"), iso3, `${y} medianAge`, s.medianAge, u.medianAge, TOLERANCE.oneDecimal);
      const sh = un.share65?.get(iso3)?.get(s.year);
      if (un.share65) r.num(...meta("share65", "% aged 65+ vs PopulationByAge5GroupSex (65+ / total)"), iso3, `${y} share65`, s.share65, sh ?? null, TOLERANCE.oneDecimal + 1e-6);
      const ident = { ...SELF, description: "series: naturalChange = births - deaths; populationChange = naturalChange + netMigration" };
      if (s.births != null && s.deaths != null) r.eq("series.identities", ident, iso3, `${y} naturalChange`, s.naturalChange, s.births - s.deaths);
      if (s.naturalChange != null && s.netMigration != null) r.eq("series.identities", ident, iso3, `${y} populationChange`, s.populationChange, s.naturalChange + s.netMigration);
    }
  }
}

/** The projection summary recomputed from the UN primary series (people from TPopulation1July). */
export function expectedProjection(ref, share65, estYear) {
  const at = (y) => ref.get(y);
  const base = at(estYear);
  if (!base || !at(2050) || !at(2100)) return null;
  const pop = (y) => Math.round(at(y).population);
  let peakYear = 1950;
  for (const [y, v] of ref) if (y >= 1950 && y <= 2100 && v.population > at(peakYear).population) peakYear = y;
  let half = null;
  for (let y = estYear + 1; y <= 2100; y++) if (at(y) && at(y).population <= base.population / 2) {
    half = y;
    break;
  }
  const nat = (y) => (at(y) ? Math.round(at(y).births) - Math.round(at(y).deaths) : null);
  let decline = null;
  if (nat(estYear) < 0) {
    let y = estYear;
    while (at(y - 1) && nat(y - 1) < 0) y--;
    decline = y;
  } else for (let y = estYear + 1; y <= 2100; y++) if (nat(y) < 0) {
    decline = y;
    break;
  }
  const pct = (p) => ((p - base.population) / base.population) * 100;
  return {
    basePopulation: pop(estYear),
    population2050: pop(2050),
    population2100: pop(2100),
    change2050Pct: pct(at(2050).population),
    change2100Pct: pct(at(2100).population),
    peakYear,
    peakPopulation: pop(peakYear),
    halfPopulationYear: half,
    naturalDeclineSince: decline,
    tfr2050: at(2050).tfr,
    tfr2100: at(2100).tfr,
    medianAge2050: at(2050).medianAge,
    share65in2050: share65?.get(2050) ?? null,
  };
}

function compareProjection(r, details, un, estYear) {
  const m = (f, description) => [`projection.${f}`, { ...UN, description }];
  for (const [iso3, d] of details) {
    const ref = un.ind.get(iso3);
    if (!ref || !d.projection) continue;
    const p = d.projection;
    const e = expectedProjection(ref, un.share65?.get(iso3), estYear);
    r.eq(...m("baseYear", "baseYear = latest UN estimate year"), iso3, "baseYear", p.baseYear, estYear);
    for (const k of ["basePopulation", "population2050", "population2100", "peakPopulation"]) r.num(...m(k, `${k} vs TPopulation1July`), iso3, k, p[k], e[k], TOLERANCE.people);
    for (const k of ["change2050Pct", "change2100Pct"]) r.num(...m(k, `${k} recomputed from UN totals`), iso3, k, p[k], e[k], TOLERANCE.pct1);
    for (const k of ["peakYear", "halfPopulationYear", "naturalDeclineSince"]) r.eq(...m(k, `${k} recomputed from UN totals`), iso3, k, p[k], e[k]);
    r.num(...m("tfr2050", "TFR 2050/2100 vs TFR"), iso3, "tfr2050", p.tfr2050, e.tfr2050, TOLERANCE.tfr);
    r.num(...m("tfr2050", "TFR 2050/2100 vs TFR"), iso3, "tfr2100", p.tfr2100, e.tfr2100, TOLERANCE.tfr);
    r.num(...m("medianAge2050", "Median age 2050 vs MedianAgePop"), iso3, "medianAge2050", p.medianAge2050, e.medianAge2050, TOLERANCE.oneDecimal);
    if (un.share65) r.num(...m("share65in2050", "% 65+ in 2050 vs age groups"), iso3, "share65in2050", p.share65in2050, e.share65in2050, TOLERANCE.oneDecimal + 1e-6);
  }
}

// ---------- headline fields, components and World Bank provenance ----------

const WB_DIGITS = { population: 0, tfr: 3, birthRate: 1, deathRate: 1, netMigration: 0, populationGrowthPct: 2, share65: 1 };

/** Expected headline point: newest of the World Bank and the UN latest-estimate value (tie -> World Bank). */
function pickLatest(...cands) {
  let best = null;
  for (const c of cands) if (c && c.value != null && Number.isFinite(c.value) && (!best || c.year > best.year)) best = c;
  return best;
}

function compareHeadline(r, details, refs, estYear) {
  const wb = refs.wb?.latest;
  const unRow = (iso3) => refs.un?.ind.get(iso3)?.get(estYear) ?? null;
  for (const [iso3, d] of details) {
    const u = unRow(iso3);
    const wbPt = (key) => {
      const p = wb?.[key]?.get(iso3);
      return p ? { value: round(p.value, WB_DIGITS[key]), year: p.year, source: "WB" } : null;
    };
    const wbNat = () => {
      const b = wbPt("birthRate");
      const dd = wbPt("deathRate");
      return b && dd && b.year === dd.year ? { value: round(b.value - dd.value, 1), year: b.year, source: "WB" } : null;
    };
    const unPt = (value) => (u && value != null ? { value, year: estYear, source: "UN-WPP" } : null);
    const unValues = u && {
      population: u.population,
      tfr: u.tfr,
      birthRate: u.cbr,
      deathRate: u.cdr,
      naturalChangeRate: u.cbr != null && u.cdr != null ? u.cbr - u.cdr : null,
      netMigration: u.netMigration,
      populationGrowthPct: u.population ? ((u.births - u.deaths + u.netMigration) / u.population) * 100 : null,
      medianAge: u.medianAge,
      share65: refs.un?.share65?.get(iso3)?.get(estYear) ?? null,
    };
    const unTol = { population: TOLERANCE.people, tfr: TOLERANCE.tfr, birthRate: TOLERANCE.oneDecimal, deathRate: TOLERANCE.oneDecimal, naturalChangeRate: TOLERANCE.oneDecimal + 1e-6, netMigration: TOLERANCE.people, populationGrowthPct: TOLERANCE.growthPct, medianAge: TOLERANCE.oneDecimal, share65: TOLERANCE.oneDecimal + 1e-6 };
    for (const key of ["population", "tfr", "birthRate", "deathRate", "naturalChangeRate", "netMigration", "populationGrowthPct", "medianAge", "share65"]) {
      const pub = d[key];
      if (wb) {
        const cand = key === "naturalChangeRate" ? wbNat() : key === "medianAge" ? null : wbPt(key);
        const exp = pickLatest(cand, unPt(unValues?.[key]));
        const meta = { source: "World Bank API + UN WPP", description: `${key}: year and source are the newest available (World Bank wins ties)` };
        if (exp || pub) r.eq(`headline.provenance`, meta, iso3, `${key} year/source`, pub ? `${pub.year} ${pub.source}` : null, exp ? `${exp.year} ${exp.source}` : null);
        if (pub?.source === "WB" && cand) r.num(`headline.wb.${key}`, { ...WB, description: `${key} equals the World Bank's latest value` }, iso3, `${key} ${pub.year}`, pub.value, cand.year === pub.year ? cand.value : null, TOLERANCE.wb[key]);
      }
      if (pub?.source === "UN-WPP" && unValues) r.num(`headline.un.${key}`, { ...UN, description: `${key} (UN ${estYear}) vs the UN file` }, iso3, `${key} ${pub.year}`, pub.value, pub.year === estYear ? unValues[key] : null, unTol[key]);
    }
    const c = d.components;
    if (c && u) {
      const m = (f) => [`components.${f}`, { ...UN, description: `components (${estYear}) ${f} vs the UN file` }];
      r.eq("components.year", { ...UN, description: "components.year = latest UN estimate year" }, iso3, "year", c.year, estYear);
      r.num(...m("population"), iso3, "population", c.population, u.population, TOLERANCE.people);
      r.num(...m("births"), iso3, "births", c.births, u.births, TOLERANCE.people);
      r.num(...m("deaths"), iso3, "deaths", c.deaths, u.deaths, TOLERANCE.people);
      r.num(...m("netMigration"), iso3, "netMigration", c.netMigration, u.netMigration, TOLERANCE.people);
      // perThousand is per 1,000 of the 1 July population (documented), so recompute it from the UN counts. The UN's
      // CBR/CDR divide by person-years instead; the gap is only visible for tiny places (Vatican, Niue).
      const unPer = (v) => (v == null || !(u.population > 0) ? null : (v / u.population) * 1000);
      r.num(...m("perThousand"), iso3, "births per 1,000", c.perThousand.births, unPer(u.births), TOLERANCE.oneDecimal + 1e-6);
      r.num(...m("perThousand"), iso3, "deaths per 1,000", c.perThousand.deaths, unPer(u.deaths), TOLERANCE.oneDecimal + 1e-6);
      r.num(...m("perThousand"), iso3, "net migration per 1,000", c.perThousand.netMigration, unPer(u.netMigration), TOLERANCE.oneDecimal + 1e-6);
      const self = { ...SELF, description: "components: identities, per-1,000 rates and migrationOffsetPct recomputed from the published counts" };
      const per = (v) => (v == null || !(c.population > 0) ? null : round((v / c.population) * 1000, 1));
      r.eq("components.identities", self, iso3, "naturalChange", c.naturalChange, c.births - c.deaths);
      r.eq("components.identities", self, iso3, "populationChange", c.populationChange, c.naturalChange + c.netMigration);
      for (const k of ["births", "deaths", "naturalChange", "netMigration", "populationChange"]) r.eq("components.identities", self, iso3, `perThousand.${k}`, c.perThousand[k], per(c[k]));
      r.eq("components.identities", self, iso3, "migrationOffsetPct", c.migrationOffsetPct, c.naturalChange < 0 ? round((c.netMigration / -c.naturalChange) * 100) : null);
      const row = d.series.find((s) => s.year === c.year);
      for (const k of ["population", "births", "deaths", "netMigration"]) r.eq("components.identities", self, iso3, `${k} = series ${c.year}`, c[k], row?.[k] ?? null);
    }
  }
}

// ---------- derived fields: generations, risk, summary = detail ----------

function compareDerived(r, published) {
  const { details, countries, risk } = published;
  const self = (description) => ({ ...SELF, description });
  const byIso = new Map(countries.countries.map((c) => [c.iso3, c]));
  for (const [iso3, d] of details) {
    const g = generations(d.tfr?.value);
    r.eq("generations", self("generations = f(headline tfr): ratio, halvingYears, hundredPeople"), iso3, "generations", d.generations, g);
    const inputs = riskInputs(d);
    r.eq("risk.inputs", self("risk.inputs equal the headline fields they come from"), iso3, "inputs", d.risk.inputs, inputs);
    const s = scoreRisk(inputs);
    r.eq("risk.score", self("risk score and tier recomputed from the inputs"), iso3, "score/tier", `${d.risk.score} ${d.risk.tier}`, `${s.score} ${s.tier}`);
    r.eq("risk.score", self("risk score and tier recomputed from the inputs"), iso3, "components", d.risk.components, s.components);
    const sum = byIso.get(iso3);
    const same = self("countries.json record equals the matching fields of countries/{ISO3}.json");
    if (!sum) {
      r.eq("summary=detail", same, iso3, "in countries.json", false, true);
      continue;
    }
    for (const k of ["name", "region", "incomeGroup", "ranked", "flags", "population", "tfr", "medianAge", "share65", "isoNumeric"]) r.eq("summary=detail", same, iso3, k, sum[k], d[k]);
    const pick = (o, keys) => (o ? Object.fromEntries(keys.map((k) => [k, o[k]])) : null);
    if (sum.components) r.eq("summary=detail", same, iso3, "components", sum.components, pick(d.components, Object.keys(sum.components)));
    if (sum.migrantStock) r.eq("summary=detail", same, iso3, "migrantStock", sum.migrantStock, pick(d.migrantStock, Object.keys(sum.migrantStock)));
    if (sum.projection) r.eq("summary=detail", same, iso3, "projection", sum.projection, pick(d.projection, Object.keys(sum.projection)));
    r.eq("summary=detail", same, iso3, "generations", sum.generations, d.generations && pick(d.generations, ["ratio", "halvingYears"]));
    r.eq("summary=detail", same, iso3, "risk", sum.risk, { ...pick(d.risk, ["score", "tier", "rank"]), factors: d.risk.factors.slice(0, sum.risk.factors.length) });
    if (d.links?.site) r.eq("links.site", self("links.site is the clean country URL"), iso3, "links.site", d.links.site, `https://fertility-tracker-live.vercel.app/country/${iso3}`);
  }
  if (risk) {
    const ranked = risk.ranking;
    const order = [...ranked].sort((a, b) => a.rank - b.rank);
    order.forEach((x, i) => r.eq("risk.ranking", self("risk.json ranks run 1..n, match the country files and descend by score"), x.iso3, "rank", x.rank, i + 1));
    for (let i = 1; i < order.length; i++) if (order[i].score > order[i - 1].score) r.eq("risk.ranking", self("ranking descends by score"), order[i].iso3, "score order", order[i].score, `<= ${order[i - 1].score}`);
    for (const x of ranked) r.eq("risk.ranking", self("risk.json entry = country file"), x.iso3, "rank/score", `${x.rank} ${x.score} ${x.tier}`, `${details.get(x.iso3)?.risk.rank} ${details.get(x.iso3)?.risk.score} ${details.get(x.iso3)?.risk.tier}`);
  }
}

// ---------- scenarios.json ----------

function compareScenarios(r, published, ref) {
  const sc = published.scenarios;
  const n = sc.endYear - sc.startYear + 1;
  const self = (description) => ({ ...SELF, description });
  const adjusted = new Map((sc.adjustments ?? []).map((a) => [a.iso3, a]));
  for (const c of published.countries.countries) {
    const p = sc.places[c.iso3];
    r.eq("scenarios.coverage", self("scenarios.json has full medium and constant arrays for every record"), c.iso3, "arrays", p ? `${p.medium?.length}/${p.constant?.length}/${[...p.medium, ...p.constant].filter((v) => v == null).length} nulls` : "missing", `${n}/${n}/0 nulls`);
    if (!p) continue;
    // Medium in scenarios.json (UN PopTotal) vs the country series (UN TPopulation1July): equal to within 1 person.
    const d = published.details.get(c.iso3);
    for (const s of d?.series ?? []) {
      if (s.year < sc.startYear || s.year > sc.endYear) continue;
      r.num("scenarios.medium=series", self("scenarios medium = countries/{ISO3}.json series population (same UN medium projection)"), c.iso3, `${s.year}`, p.medium[s.year - sc.startYear], s.population, TOLERANCE.people + 1);
    }
    if (!ref) continue;
    const main = ref.main.get(c.iso3);
    const upd = ref.update.get(c.iso3);
    const meta = (k) => ({ ...UN, description: `scenarios ${k} vs WPP2024_TotalPopulationBySex (PopTotal x 1000)` });
    for (let i = 0; i < n; i++) {
      const y = sc.startYear + i;
      r.num("scenarios.medium", meta("medium"), c.iso3, `${y} medium`, p.medium[i], (upd ?? main)?.medium[i] ?? null, 0.5);
      if (upd && adjusted.has(c.iso3)) {
        // Documented adjustment: UN constant x revised medium / original medium (the UN did not revise other scenarios).
        const expect = main?.constant[i] != null && main.medium[i] ? Math.round((main.constant[i] * upd.medium[i]) / main.medium[i]) : null;
        r.num("scenarios.constant", meta("constant"), c.iso3, `${y} constant (rescaled for the interim update)`, p.constant[i], expect, 0.5);
      } else r.num("scenarios.constant", meta("constant"), c.iso3, `${y} constant`, p.constant[i], main?.constant[i] ?? null, 0.5);
    }
  }
  for (const code of ref?.update.keys() ?? []) if (!adjusted.has(code)) r.eq("scenarios.constant", { ...UN, description: "places revised by the interim update are listed in adjustments" }, code, "adjustments", "missing", "listed");
}

// ---------- UN DESA migrant stock ----------

function compareMigrantStock(r, details, ims) {
  const m = (f, description) => [`migrantStock.${f}`, { ...IMS, description }];
  for (const [iso3, d] of details) {
    if (iso3 === "WLD") continue;
    for (const s of d.migrantStockSeries) {
      const y = s.year;
      const imm = ims.immigrants.get(iso3)?.get(y) ?? null;
      const emi = ims.emigrants.get(iso3)?.get(y) ?? null;
      const pop = ims.population.get(iso3)?.get(y) ?? null; // thousands
      r.num(...m("immigrants", "immigrant stock vs Table 1 (destination)"), iso3, `${y} immigrants`, s.immigrants, imm, 0.5);
      r.num(...m("immigrantsPct", "immigrants % of population vs Table 3 (destination)"), iso3, `${y} immigrantsPct`, s.immigrantsPct, ims.immigrantsPct.get(iso3)?.get(y) ?? null, TOLERANCE.stockPct);
      r.num(...m("emigrants", "emigrant stock vs Table 1 (origin)"), iso3, `${y} emigrants`, s.emigrants, emi, 0.5);
      if (s.emigrantsPct != null || (emi != null && pop)) r.num(...m("emigrantsPct", "emigrants % of resident population (origin Table 1 / destination Table 2)"), iso3, `${y} emigrantsPct`, s.emigrantsPct, emi != null && pop ? (emi / (pop * 1000)) * 100 : null, TOLERANCE.stockPct);
      if (imm != null && emi != null && pop) {
        const born = pop * 1000 - imm + emi;
        r.num(...m("livingAbroadPct", "emigrants / (residents - immigrants + emigrants)"), iso3, `${y} livingAbroadPct`, s.livingAbroadPct, born > 0 ? (emi / born) * 100 : null, TOLERANCE.livingAbroadPct);
      }
      r.eq("migrantStock.identities", { ...SELF, description: "netStock = immigrants - emigrants" }, iso3, `${y} netStock`, s.netStock, s.immigrants != null && s.emigrants != null ? s.immigrants - s.emigrants : null);
    }
    const last = d.migrantStockSeries.at(-1);
    if (d.migrantStock?.source === "UN-DESA") r.eq("migrantStock.latest", { ...SELF, description: "migrantStock = latest migrantStockSeries row" }, iso3, "latest", { ...d.migrantStock, source: undefined }, last && { ...last, source: undefined });
    const corr = d.migrationCorridors;
    const ref = ims.corridors?.get(iso3);
    if (corr && ref) {
      const cm = (f) => [`corridors.${f}`, { ...IMS, description: `migrationCorridors ${f} vs the destination-and-origin table (${ref.year})` }];
      r.eq(...cm("year"), iso3, "year", corr.year, ref.year);
      r.num(...cm("totals"), iso3, "immigrantsTotal", corr.immigrantsTotal, ref.immigrantsTotal, 0.5);
      r.num(...cm("totals"), iso3, "emigrantsTotal", corr.emigrantsTotal, ref.emigrantsTotal, 0.5);
      const top = (list) => list.map((p) => `${p.iso3}:${p.people}`).join(" ");
      r.eq(...cm("topOrigins"), iso3, "topOrigins", top(corr.topOrigins), top(ref.origins.slice(0, corr.topOrigins.length || 10)));
      r.eq(...cm("topDestinations"), iso3, "topDestinations", top(corr.topDestinations), top(ref.destinations.slice(0, corr.topDestinations.length || 10)));
    }
  }
}

// ---------- CSV files = JSON ----------

function compareCsv(r, published) {
  const self = (description) => ({ ...SELF, description });
  if (published.countriesCsv) {
    const [h, ...rows] = parseCsv(published.countriesCsv).filter((x) => x.length > 1);
    const col = (row, k) => row[h.indexOf(k)];
    const s = (v) => (v == null ? "" : typeof v === "boolean" ? String(v) : String(v));
    for (const row of rows) {
      const iso3 = row[0];
      const d = published.details.get(iso3);
      if (!d) {
        r.eq("csv.countries", self("countries.csv rows = country files"), iso3, "row", "extra", "absent");
        continue;
      }
      const want = {
        name: d.name, region: d.region, ranked: d.ranked, risk_rank: d.risk.rank, risk_score: d.risk.score, risk_tier: d.risk.tier,
        population: d.population?.value, population_year: d.population?.year, tfr: d.tfr?.value, tfr_year: d.tfr?.year, tfr_source: d.tfr?.source,
        netMigration: d.netMigration?.value, components_births: d.components?.births, components_netMigration: d.components?.netMigration,
        migrantStock_emigrants: d.migrantStock?.emigrants, projection_population2100: d.projection?.population2100, projection_change2100Pct: d.projection?.change2100Pct,
        generations_ratio: d.generations?.ratio, flags: d.flags.join(" "),
      };
      for (const [k, v] of Object.entries(want)) r.eq("csv.countries", self("countries.csv cells = country files"), iso3, k, col(row, k), s(v));
    }
    r.eq("csv.countries", self("countries.csv has one row per record"), "ALL", "rows", rows.length, published.details.size);
  }
  if (published.timeseriesCsv) {
    const rows = parseCsv(published.timeseriesCsv).slice(1).filter((x) => x.length === 5);
    const expected = new Map();
    for (const [iso3, d] of published.details) {
      for (const s of d.series) for (const k of ["population", "births", "deaths", "naturalChange", "netMigration", "populationChange", "tfr", "medianAge", "share65"]) if (s[k] != null) expected.set(`${iso3}|${s.year}|${s.variant}|${k}`, String(s[k]));
      for (const s of d.migrantStockSeries) for (const k of ["immigrants", "immigrantsPct", "emigrants", "emigrantsPct", "livingAbroadPct"]) if (s[k] != null) expected.set(`${iso3}|${s.year}|estimate|${k}`, String(s[k]));
    }
    const seen = new Set();
    for (const [iso3, year, variant, metric, value] of rows) {
      const key = `${iso3}|${year}|${variant}|${metric}`;
      seen.add(key);
      r.eq("csv.timeseries", self("timeseries.csv rows = country files (every value)"), iso3, `${year} ${variant} ${metric}`, value, expected.get(key) ?? "(not in JSON)");
    }
    const missing = [...expected.keys()].filter((k) => !seen.has(k));
    r.eq("csv.timeseries", self("timeseries.csv has every JSON value"), "ALL", "missing rows", missing.length, 0);
  }
}

// ---------- patterns (the Hong Kong net-migration lead) ----------

function patternChecks(r, details, un, estYear) {
  // Identical net migration in the last three estimate years: count it in our files and in the UN file.
  const flat = (vals) => vals.length === 3 && vals.every((v) => v != null && v !== 0 && v === vals[0]);
  const ys = [estYear - 2, estYear - 1, estYear];
  const ours = [];
  const theirs = [];
  for (const [iso3, d] of details) {
    if (flat(ys.map((y) => d.series.find((s) => s.year === y)?.netMigration ?? null))) ours.push(iso3);
    const u = un?.ind.get(iso3);
    if (u && flat(ys.map((y) => (u.get(y) ? Math.round(u.get(y).netMigration) : null)))) theirs.push(iso3);
  }
  r.note(
    `Net migration identical in ${ys.join(", ")}: ${ours.length} places in our files${un ? `, ${theirs.length} in the UN file` : ""}` +
      (un ? `; ours but not the UN's: ${ours.filter((x) => !theirs.includes(x)).join(" ") || "none"}` : "") +
      `. Examples: ${ours.slice(0, 12).join(" ")}`,
  );
  if (un) for (const iso3 of ours) r.eq("pattern.netMigrationFlat", { ...UN, description: `identical net migration ${ys.join("-")} also appears in the UN file (not a pipeline artefact)` }, iso3, "flat in UN", theirs.includes(iso3), true);
}

export { REPLACEMENT_TFR };
