// Population-decline risk score (0-100): a transparent weighted sum of five components, each scaled 0..1 by a
// linear ramp between a "no risk" point and a "maximum risk" point. Documented in docs/METHODOLOGY.md and risk.json.
import { REPLACEMENT_TFR, round } from "./model.mjs";

export const RISK_MODEL = {
  version: "1.0",
  name: "Population decline risk",
  scale: "0 (no sign of decline) to 100 (fastest, most locked-in decline)",
  minPopulation: 100_000,
  components: [
    {
      id: "fertility",
      label: "Fertility below replacement",
      weight: 35,
      input: "tfr (latest of World Bank / UN WPP)",
      zeroAt: REPLACEMENT_TFR,
      fullAt: 0.8,
      unit: "births per woman",
      explain: "How far the fertility rate is below the 2.1 births per woman that keeps each generation the same size.",
    },
    {
      id: "naturalChange",
      label: "More deaths than births",
      weight: 15,
      input: "naturalChangeRate (births minus deaths per 1,000 people, latest of World Bank / UN WPP)",
      zeroAt: 5,
      fullAt: -7,
      unit: "per 1,000 people",
      explain: "Births minus deaths per 1,000 people. Full risk at 7 more deaths than births per 1,000 people a year.",
    },
    {
      id: "aging",
      label: "Aging population",
      weight: 10,
      input: "average of share65 (ramp 7% -> 30%) and medianAge (ramp 25 -> 50 years)",
      zeroAt: null,
      fullAt: null,
      unit: "mixed",
      parts: [
        { input: "share65", zeroAt: 7, fullAt: 30, weight: 1, unit: "% of population aged 65+" },
        { input: "medianAge", zeroAt: 25, fullAt: 50, weight: 1, unit: "years" },
      ],
      explain: "An older population has fewer people of child-bearing age and more deaths ahead.",
    },
    {
      id: "projectedDecline",
      label: "UN-projected population decline",
      weight: 30,
      input:
        "weighted average of change2050Pct (weight 1, ramp 0% -> -25%) and change2100Pct (weight 2, ramp 0% -> -60%), " +
        "UN WPP medium variant vs the latest estimate year",
      zeroAt: null,
      fullAt: null,
      unit: "% change",
      parts: [
        { input: "change2050Pct", zeroAt: 0, fullAt: -25, weight: 1, unit: "% change by 2050" },
        { input: "change2100Pct", zeroAt: 0, fullAt: -60, weight: 2, unit: "% change by 2100" },
      ],
      explain:
        "The UN's central (medium) projection of how much the population shrinks by 2050 and by 2100. 2100 counts double: " +
        "it captures where today's fertility leads once the current age structure has worked through.",
    },
    {
      id: "migration",
      label: "Migration does not fill the gap",
      weight: 10,
      input: "components.migrationOffsetPct (UN WPP, latest estimate year)",
      zeroAt: 100,
      fullAt: 0,
      unit: "% of natural decline offset by net migration",
      explain:
        "When deaths exceed births: the share of that gap NOT covered by net immigration (net emigration counts as full risk). " +
        "When births exceed deaths but net emigration still shrinks the population: population change per 1,000, ramp 0 -> -10.",
    },
  ],
  tiers: [
    { name: "Critical", min: 70, description: "Shrinking fast and locked in: very low fertility, more deaths than births, steep projected decline." },
    { name: "High", min: 55, description: "Decline is underway or close, with fertility far below replacement." },
    { name: "Elevated", min: 40, description: "Fertility well below replacement; decline likely within decades unless migration fills the gap." },
    { name: "Moderate", min: 20, description: "Some warning signs (below-replacement fertility or aging), but population still growing or stable." },
    { name: "Low", min: 0, description: "Fertility near or above replacement; population projected to keep growing." },
  ],
};

/** Linear ramp: 0 at zeroAt, 1 at fullAt, clamped. Works in either direction. */
export function ramp(x, zeroAt, fullAt) {
  if (x == null || !Number.isFinite(x)) return null;
  const t = (x - zeroAt) / (fullAt - zeroAt);
  return Math.min(1, Math.max(0, t));
}

/** Weighted mean over parts that have a value: [[value, weight], ...]. */
const wmean = (pairs) => {
  const v = pairs.filter(([x]) => x != null);
  const w = v.reduce((a, [, wt]) => a + wt, 0);
  return v.length && w > 0 ? v.reduce((a, [x, wt]) => a + x * wt, 0) / w : null;
};
const partsScore = (comp, i) => wmean(comp.parts.map((p) => [ramp(i[p.input], p.zeroAt, p.fullAt), p.weight ?? 1]));

/** Inputs for the score, taken from a country summary record. */
export function riskInputs(rec) {
  const c = rec.components;
  return {
    tfr: rec.tfr?.value ?? null,
    naturalChangeRate: rec.naturalChangeRate?.value ?? null,
    share65: rec.share65?.value ?? null,
    medianAge: rec.medianAge?.value ?? null,
    change2050Pct: rec.projection?.change2050Pct ?? null,
    change2100Pct: rec.projection?.change2100Pct ?? null,
    naturalChange: c?.naturalChange ?? null,
    netMigration: c?.netMigration ?? null,
    populationChangePerThousand: c?.perThousand?.populationChange ?? null,
    migrationOffsetPct: c?.migrationOffsetPct ?? null,
  };
}

/** Migration component (0..1). */
export function migrationRisk(i) {
  if (i.naturalChange == null || i.netMigration == null) return null;
  if (i.naturalChange < 0) {
    if (i.netMigration <= 0) return 1;
    return ramp((i.netMigration / -i.naturalChange) * 100, 100, 0);
  }
  if (i.netMigration < 0 && i.populationChangePerThousand != null && i.populationChangePerThousand < 0) {
    return ramp(i.populationChangePerThousand, 0, -10);
  }
  return 0;
}

/**
 * Score one country. Returns { score (int 0-100) | null, exact, tier, components: {id: {value, points, weight}} }.
 * score is null when a component cannot be computed (missing inputs).
 */
export function scoreRisk(i) {
  const [fert, nat, aging, proj, mig] = RISK_MODEL.components;
  const values = {
    fertility: ramp(i.tfr, fert.zeroAt, fert.fullAt),
    naturalChange: ramp(i.naturalChangeRate, nat.zeroAt, nat.fullAt),
    aging: partsScore(aging, i),
    projectedDecline: i.change2050Pct == null || i.change2100Pct == null ? null : partsScore(proj, i),
    migration: migrationRisk(i),
  };
  const components = {};
  let exact = 0;
  let complete = true;
  for (const c of RISK_MODEL.components) {
    const v = values[c.id];
    if (v == null) complete = false;
    const points = v == null ? null : v * c.weight;
    components[c.id] = { value: round(v, 3), points: round(points, 1), weight: c.weight };
    exact += points ?? 0;
  }
  if (!complete) return { score: null, exact: null, tier: null, components };
  const score = Math.round(exact);
  return { score, exact: round(exact, 2), tier: tierFor(score), components };
}

export const tierFor = (score) => (score == null ? null : RISK_MODEL.tiers.find((t) => score >= t.min).name);

// ---------- plain-English factors ----------

const FRACTIONS = [
  [0.2, "a fifth"],
  [0.25, "a quarter"],
  [1 / 3, "a third"],
  [0.4, "two-fifths"],
  [0.5, "half"],
  [0.6, "three-fifths"],
  [2 / 3, "two-thirds"],
  [0.75, "three-quarters"],
  [0.8, "four-fifths"],
  [0.9, "nine-tenths"],
];

export function fractionWords(r) {
  if (r < 0.15) return "less than a fifth";
  if (r >= 0.95) return "just under";
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - r) < Math.abs(best[0] - r)) best = f;
  return `about ${best[1]}`;
}

/** 3 significant figures with thousands separators, or "x.x million/billion". */
export function people(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2).replace(/\.?0+$/, "")} billion`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, "")} million`;
  if (a >= 1000) {
    const p = 10 ** (Math.floor(Math.log10(a)) - 2);
    return sign + (Math.round(a / p) * p).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  return sign + String(Math.round(a));
}

const num = (v, d) => Number(v).toFixed(d);

/**
 * Plain-English risk factors for a summary record, most important first.
 * Each: { id, points, text }. Points tie the factor to its score contribution (0 for context-only factors).
 */
export function riskFactors(rec, scored) {
  const out = [];
  const pts = (id) => scored.components[id]?.points ?? 0;
  const { tfr, components: c, projection: p, share65, medianAge, migrantStock: ms } = rec;

  if (tfr?.value != null) {
    const r = tfr.value / REPLACEMENT_TFR;
    out.push({
      id: "fertility",
      points: pts("fertility"),
      text:
        tfr.value < REPLACEMENT_TFR
          ? `Fertility ${num(tfr.value, 2)} births per woman (${tfr.year}), ${r >= 0.95 ? "just under" : `${fractionWords(r)} of`} the 2.1 replacement level`
          : `Fertility ${num(tfr.value, 2)} births per woman (${tfr.year}), at or above the 2.1 replacement level`,
    });
  }

  if (c?.naturalChange != null) {
    const since = p?.naturalDeclineSince;
    let text;
    if (c.naturalChange < 0) {
      text =
        since != null && since < c.year
          ? `More deaths than births since ${since} (${c.year}: ${people(c.births)} births, ${people(c.deaths)} deaths)`
          : `More deaths than births in ${c.year} (${people(c.births)} births, ${people(c.deaths)} deaths)`;
    } else if (since != null) {
      text = `Births still outnumber deaths; UN projects more deaths than births from ${since}`;
    } else {
      text = `Births outnumber deaths (${c.year}: ${people(c.births)} births, ${people(c.deaths)} deaths)`;
    }
    out.push({ id: "naturalChange", points: pts("naturalChange"), text });
  }

  if (p) {
    const ch = p.change2100Pct;
    const fromTo = `${people(p.basePopulation)} in ${p.baseYear} → ${people(p.population2100)}`;
    let text;
    if (ch < 0) {
      if (p.peakYear > p.baseYear && p.peakYear < 2100) text = `UN projects growth until ${p.peakYear}, then a ${num(-ch, 0)}% fall by 2100 (${fromTo})`;
      else text = `UN projects a ${num(-ch, 0)}% fall by 2100 (${fromTo})${p.peakYear < p.baseYear ? `; peaked in ${p.peakYear}` : ""}`;
    } else {
      text = `UN projects ${num(ch, 0)}% growth by 2100 (${fromTo})`;
    }
    out.push({ id: "projectedDecline", points: pts("projectedDecline"), text });
  }

  if (c?.naturalChange != null && c?.netMigration != null) {
    let text = null;
    if (c.naturalChange < 0) {
      if (c.netMigration <= 0)
        text =
          c.netMigration < 0
            ? `More people leave than arrive (net outflow ${people(-c.netMigration)} in ${c.year}), deepening the decline`
            : `No net immigration to offset the natural decline (${c.year})`;
      else if (c.migrationOffsetPct < 100)
        text = `Immigration offsets only ${c.migrationOffsetPct}% of the natural decline (${c.year}: net +${people(c.netMigration)})`;
      else text = `Immigration more than offsets the natural decline (${c.year}: net +${people(c.netMigration)})`;
    } else if (c.netMigration < 0 && c.populationChange < 0) {
      text = `Emigration outweighs natural growth: population fell by ${people(-c.populationChange)} in ${c.year}`;
    } else if (c.netMigration < 0 && c.perThousand.netMigration <= -2) {
      text = `Net emigration of ${people(-c.netMigration)} people in ${c.year} slows population growth`;
    }
    if (text) out.push({ id: "migration", points: pts("migration"), text });
  }

  if (share65?.value != null || medianAge?.value != null) {
    let text;
    if (share65?.value >= 5) {
      text = `1 in ${Math.round(100 / share65.value)} people is 65 or older (${share65.year})`;
      if (medianAge?.value != null) text += `; median age ${num(medianAge.value, 1)}`;
    } else if (medianAge?.value != null) {
      text = `Young population: median age ${num(medianAge.value, 1)} (${medianAge.year})`;
    } else text = `${num(share65.value, 1)}% of people are 65 or older (${share65.year})`;
    out.push({ id: "aging", points: pts("aging"), text });
  }

  // livingAbroadPct = emigrants / everyone born here who is alive (UN DESA's emigrantsPct divides by the current
  // resident population, which is not "share of people born here").
  if (ms?.livingAbroadPct != null && ms.livingAbroadPct >= 10) {
    out.push({
      id: "emigrantStock",
      points: 0,
      text: `${num(ms.livingAbroadPct, 0)}% of people born here now live abroad (${people(ms.emigrants)}, ${ms.year})`,
    });
  } else if (ms?.livingAbroadPct == null && ms?.emigrantsPct != null && ms.emigrantsPct >= 10) {
    out.push({
      id: "emigrantStock",
      points: 0,
      text: `Emigrants living abroad equal ${num(ms.emigrantsPct, 0)}% of the current population (${people(ms.emigrants)}, ${ms.year})`,
    });
  }

  // Most important first; context-only factors (0 points) keep their natural order at the end.
  return out
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.points - a.points || a.i - b.i)
    .map(({ i, ...f }) => f);
}

/** Rank scored records in place: rank 1 = highest risk. Only records with ranked=true and a score get a rank. */
export function assignRanks(records) {
  const ranked = records
    .filter((r) => r.ranked && r.risk.score != null)
    .sort((a, b) => b.risk.exact - a.risk.exact || a.iso3.localeCompare(b.iso3));
  ranked.forEach((r, i) => (r.risk.rank = i + 1));
  return ranked;
}
