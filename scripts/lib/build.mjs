// Assemble the published dataset (summary records, detail records, ranking) from parsed source data.
import { isoCodes } from "./iso.mjs";
import {
  buildSeries,
  demographicBalance,
  generations,
  lastEstimateYear,
  pickLatest,
  projectionSummary,
  round,
} from "./model.mjs";
import { assignRanks, riskFactors, riskInputs, RISK_MODEL, scoreRisk } from "./risk.mjs";

// Entities without World Bank metadata borrow the WB region of a neighbour (keeps region labels consistent).
const REGION_PROXY = {
  AIA: "ATG", BES: "CUW", BLM: "MAF", COK: "WSM", ESH: "MAR", FLK: "ARG", GGY: "GBR", GLP: "DMA", GUF: "SUR",
  JEY: "GBR", MSR: "ATG", MTQ: "LCA", MYT: "COM", NIU: "WSM", REU: "MUS", SHN: "STP", SPM: "CAN", TKL: "WSM",
  TWN: "CHN", VAT: "ITA", WLF: "WSM",
};

/** Max number of factors kept in the compact countries.json record (all are in risk.json and countries/{ISO3}.json). */
export const SUMMARY_FACTORS = 3;

const wbPoint = (wb, key, code, d) => {
  const p = wb.latest[key]?.get(code);
  return p ? { value: round(p.value, d), year: p.year, source: "WB" } : null;
};
const unPoint = (row, value, d) => (row && value != null ? { value: round(value, d), year: row.year, source: "UN-WPP" } : null);

function regionFor(code, wbCountries) {
  if (code === "WLD") return "World";
  return wbCountries.get(code)?.region ?? wbCountries.get(REGION_PROXY[code])?.region ?? "Other";
}

/**
 * Share of all living people born in a country who live abroad: emigrants / (native-born residents + emigrants).
 * UN DESA's emigrant share (emigrantsPct) divides by the CURRENT RESIDENT population instead, so it can exceed what
 * "share of people born here" means. Resident population is recovered from the shares (both use the same UN
 * denominator): native-born residents = resident population - immigrants.
 */
export function livingAbroadPct(immigrants, immigrantsPct, emigrants, emigrantsPct) {
  if (emigrants == null || immigrants == null) return null;
  const resident = emigrantsPct > 0 ? emigrants / (emigrantsPct / 100) : immigrantsPct > 0 ? immigrants / (immigrantsPct / 100) : null;
  if (resident == null) return emigrants === 0 ? 0 : null;
  const bornHere = resident - immigrants + emigrants;
  return bornHere > 0 ? (emigrants / bornHere) * 100 : null;
}

/** Latest immigrant/emigrant stock (UN DESA) for a country, plus its 5-yearly history. */
function migrantStock(code, ims, wb) {
  const ent = (k) => ims[k]?.entities.get(code);
  const years = new Set();
  for (const k of ["immigrants", "immigrantsShare", "emigrants", "emigrantsShare"]) for (const y of ent(k)?.years.keys() ?? []) years.add(y);
  const series = [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const v = (k, f) => ent(k)?.years.get(year)?.[f] ?? null;
      const imm = v("immigrants", "immigrants");
      const emi = v("emigrants", "emigrants");
      const immPct = v("immigrantsShare", "immigrantsPct");
      const emiPct = v("emigrantsShare", "emigrantsPct");
      const immigrants = round(imm);
      const emigrants = round(emi);
      return {
        year,
        immigrants,
        immigrantsPct: round(immPct, 1),
        emigrants,
        emigrantsPct: round(emiPct, 1),
        livingAbroadPct: round(livingAbroadPct(imm, immPct, emi, emiPct), 1),
        netStock: immigrants != null && emigrants != null ? immigrants - emigrants : null,
      };
    })
    .filter((r) => r.immigrants != null || r.emigrants != null);
  let latest = series.at(-1) ?? null;
  if (!latest) {
    // Fall back to World Bank immigrant stock (same UN DESA source) when OWID's copy is unavailable.
    const imm = wb.latest.immigrants?.get(code);
    if (!imm) return { latest: null, series };
    latest = {
      year: imm.year,
      immigrants: round(imm.value),
      immigrantsPct: round(wb.latest.immigrantsPct?.get(code)?.value, 1),
      emigrants: null,
      emigrantsPct: null,
      livingAbroadPct: null,
      netStock: null,
    };
    return { latest: { ...latest, source: "WB" }, series };
  }
  return { latest: { ...latest, source: "UN-DESA" }, series };
}

/**
 * Build everything. raw = { wpp, ims, wb: { countries, latest }, corridors: Map|null }.
 * Returns { records (summary, sorted by iso3), details: Map<iso3, detail>, ranking, unranked, latestEstimateYear }.
 */
export function buildDataset(raw) {
  const { wpp, ims, wb, corridors } = raw;
  const codes = [...wpp.population.entities.keys()].sort();
  const worldSeries = buildSeries("WLD", wpp);
  const estYear = lastEstimateYear(worldSeries);

  const records = [];
  const details = new Map();
  for (const code of codes) {
    const series = buildSeries(code, wpp);
    if (!series.length) continue;
    const name = wpp.population.entities.get(code).name;
    const isWorld = code === "WLD";
    const wbMeta = wb.countries.get(code);
    const baseRow = series.find((r) => r.year === estYear) ?? null;
    const components = baseRow ? demographicBalance(baseRow) : null;
    const projection = baseRow ? projectionSummary(series, estYear) : null;
    const stock = migrantStock(code, ims, wb);

    const unBirthRate = components?.perThousand.births;
    const unDeathRate = components?.perThousand.deaths;
    const wbBirth = wbPoint(wb, "birthRate", code, 1);
    const wbDeath = wbPoint(wb, "deathRate", code, 1);
    const wbNatural =
      wbBirth && wbDeath && wbBirth.year === wbDeath.year
        ? { value: round(wbBirth.value - wbDeath.value, 1), year: wbBirth.year, source: "WB" }
        : null;

    const rec = {
      iso3: code,
      ...(isWorld ? { iso2: null, isoNumeric: null } : isoCodes(code)),
      name: isWorld ? "World" : name,
      region: regionFor(code, wb.countries),
      incomeGroup: isWorld ? null : (wbMeta?.incomeGroup ?? null),
      ranked: false,
      flags: [],
      population: pickLatest(wbPoint(wb, "population", code, 0), unPoint(baseRow, baseRow?.population, 0)),
      tfr: pickLatest(wbPoint(wb, "tfr", code, 3), unPoint(baseRow, baseRow?.tfr, 3)),
      birthRate: pickLatest(wbBirth, unPoint(baseRow, unBirthRate, 1)),
      deathRate: pickLatest(wbDeath, unPoint(baseRow, unDeathRate, 1)),
      naturalChangeRate: pickLatest(wbNatural, unPoint(baseRow, components?.perThousand.naturalChange, 1)),
      netMigration: pickLatest(wbPoint(wb, "netMigration", code, 0), unPoint(baseRow, baseRow?.netMigration, 0)),
      populationGrowthPct: pickLatest(
        wbPoint(wb, "populationGrowthPct", code, 2),
        unPoint(baseRow, components?.perThousand.populationChange != null ? components.perThousand.populationChange / 10 : null, 2),
      ),
      medianAge: unPoint(baseRow, baseRow?.medianAge, 1),
      share65: pickLatest(wbPoint(wb, "share65", code, 1), unPoint(baseRow, baseRow?.share65, 1)),
      components,
      migrantStock: stock.latest,
      projection,
      generations: null,
      risk: null,
    };
    rec.generations = generations(rec.tfr?.value);

    // Ranking eligibility: real countries/territories with enough population and complete inputs.
    if (isWorld) rec.flags.push("aggregate");
    if (!isWorld && !wbMeta) rec.flags.push("no-world-bank-data");
    const pop = rec.population?.value ?? 0;
    if (!isWorld && pop < RISK_MODEL.minPopulation) rec.flags.push("small-population");

    const inputs = riskInputs(rec);
    const scored = scoreRisk(inputs);
    if (scored.score == null) rec.flags.push("incomplete-risk-inputs");
    const factors = riskFactors(rec, scored);
    rec.ranked = !isWorld && pop >= RISK_MODEL.minPopulation && scored.score != null;
    rec.risk = { score: scored.score, tier: scored.tier, rank: null, factors: factors.map((f) => f.text), exact: scored.exact };

    records.push(rec);
    details.set(code, { series, stock, scored, factors, inputs });
  }

  const ranking = assignRanks(records);
  const unranked = records.filter((r) => !r.ranked);

  // Detail payloads (one per country) and final summary shape.
  const detailOut = new Map();
  for (const rec of records) {
    const d = details.get(rec.iso3);
    const corridor = corridors?.get(rec.iso3) ?? null;
    detailOut.set(rec.iso3, {
      ...detailRecord(rec),
      risk: {
        score: rec.risk.score,
        tier: rec.risk.tier,
        rank: rec.risk.rank,
        factors: rec.risk.factors,
        components: d.scored.components,
        inputs: d.inputs,
      },
      series: d.series,
      migrantStockSeries: d.stock.series,
      migrationCorridors: corridor,
    });
  }

  return {
    records: records.map((r) => summaryRecord(r)),
    full: records,
    details: detailOut,
    ranking,
    unranked,
    latestEstimateYear: estYear,
  };
}

/** Detail shape: everything, internal fields dropped. */
export function detailRecord(rec) {
  const { risk, ...rest } = rec;
  return { ...rest, risk: { score: risk.score, tier: risk.tier, rank: risk.rank, factors: risk.factors } };
}

/**
 * Compact shape for countries.json (one file for the map/list, kept small): headline fields with provenance,
 * the latest demographic balance, migrant stocks, the UN outlook and the risk summary. countries/{ISO3}.json has the rest.
 */
export function summaryRecord(rec, maxFactors = SUMMARY_FACTORS) {
  const c = rec.components;
  const p = rec.projection;
  const m = rec.migrantStock;
  return {
    iso3: rec.iso3,
    isoNumeric: rec.isoNumeric,
    name: rec.name,
    region: rec.region,
    incomeGroup: rec.incomeGroup,
    ranked: rec.ranked,
    flags: rec.flags,
    population: rec.population,
    tfr: rec.tfr,
    medianAge: rec.medianAge,
    share65: rec.share65,
    components: c && {
      year: c.year,
      births: c.births,
      deaths: c.deaths,
      naturalChange: c.naturalChange,
      netMigration: c.netMigration,
      populationChange: c.populationChange,
      perThousand: c.perThousand,
      migrationOffsetPct: c.migrationOffsetPct,
    },
    migrantStock: m && {
      year: m.year,
      immigrants: m.immigrants,
      immigrantsPct: m.immigrantsPct,
      emigrants: m.emigrants,
      emigrantsPct: m.emigrantsPct,
      livingAbroadPct: m.livingAbroadPct,
    },
    projection: p && {
      baseYear: p.baseYear,
      basePopulation: p.basePopulation,
      population2050: p.population2050,
      population2100: p.population2100,
      change2050Pct: p.change2050Pct,
      change2100Pct: p.change2100Pct,
      peakYear: p.peakYear,
      halfPopulationYear: p.halfPopulationYear,
      naturalDeclineSince: p.naturalDeclineSince,
    },
    generations: rec.generations && { ratio: rec.generations.ratio, halvingYears: rec.generations.halvingYears },
    risk: { score: rec.risk.score, tier: rec.risk.tier, rank: rec.risk.rank, factors: rec.risk.factors.slice(0, maxFactors) },
  };
}
