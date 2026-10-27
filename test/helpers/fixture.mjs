// Synthetic source data shaped like the parsed upstream sources (see scripts/lib/sources.mjs), for offline tests.
const EST_END = 2023;
const YEARS = Array.from({ length: 151 }, (_, i) => 1950 + i);

/** shape(year) -> { pop, tfr, cbr, cdr, nmr, medianAge, share65 } */
function entity(name, shape) {
  const years = (fn) => new Map(YEARS.map((y) => [y, fn(y, shape(y), y <= EST_END)]));
  return {
    name,
    population: years((y, s, est) => (est ? { popEst: s.pop } : { popProj: s.pop })),
    fertility: years((y, s, est) => (est ? { tfrEst: s.tfr } : { tfrProj: s.tfr })),
    birthsDeaths: years((y, s, est) => {
      const b = Math.round((s.pop * s.cbr) / 1000);
      const d = Math.round((s.pop * s.cdr) / 1000);
      return est ? { birthsEst: b, deathsEst: d } : { birthsProj: b, deathsProj: d };
    }),
    netMigration: years((y, s, est) => (est ? { netMigEst: Math.round((s.pop * s.nmr) / 1000) } : { netMigProj: Math.round((s.pop * s.nmr) / 1000) })),
    medianAge: years((y, s, est) => (est ? { medianAgeEst: s.medianAge } : { medianAgeProj: s.medianAge })),
    ageStructure: years((y, s, est) =>
      est ? { pop65Est: (s.pop * s.share65) / 100, popAllEst: s.pop } : { pop65Proj: (s.pop * s.share65) / 100, popAllProj: s.pop },
    ),
  };
}

const lerp = (y, y0, v0, y1, v1) => (y <= y0 ? v0 : y >= y1 ? v1 : v0 + ((v1 - v0) * (y - y0)) / (y1 - y0));

export const SHAPES = {
  // Very low fertility, deaths > births since 2015, steep projected decline.
  SHR: (y) => ({
    pop: y <= 2010 ? 20e6 + (y - 1950) * 1e5 : 26e6 * Math.exp(-0.012 * (y - 2010)),
    tfr: lerp(y, 1960, 3, 2020, 0.8),
    cbr: y <= 2015 ? lerp(y, 1960, 25, 2015, 10) : 5,
    cdr: y <= 2015 ? 9 : 13,
    nmr: 1,
    medianAge: lerp(y, 1960, 25, 2023, 47),
    share65: lerp(y, 1960, 5, 2023, 25),
  }),
  // High fertility, young, growing.
  GRO: (y) => ({
    pop: 5e6 * Math.exp(0.025 * (y - 1950)),
    tfr: lerp(y, 1950, 7, 2100, 3),
    cbr: 40,
    cdr: 8,
    nmr: -0.5,
    medianAge: 17,
    share65: 3,
  }),
  // Tiny territory: excluded from the ranking.
  TNY: (y) => ({ pop: 30_000, tfr: 1.2, cbr: 8, cdr: 10, nmr: 2, medianAge: 45, share65: 22 }),
  WLD: (y) => ({ pop: 2.5e9 + (y - 1950) * 6e7, tfr: lerp(y, 1950, 5, 2100, 1.8), cbr: 17, cdr: 8, nmr: 0, medianAge: 30, share65: 10 }),
};
const NAMES = { SHR: "Shrinkland", GRO: "Growland", TNY: "Tinyland", WLD: "World" };

export function fixtureRaw() {
  const datasets = ["population", "fertility", "birthsDeaths", "netMigration", "medianAge", "ageStructure"];
  const wpp = Object.fromEntries(datasets.map((d) => [d, { entities: new Map(), found: {}, missing: [] }]));
  for (const [code, shape] of Object.entries(SHAPES)) {
    const e = entity(NAMES[code], shape);
    for (const d of datasets) wpp[d].entities.set(code, { name: e.name, rawName: e.name, years: e[d] });
  }
  const stock = (k, f) => ({ entities: new Map([["SHR", { name: "Shrinkland", years: new Map([[2020, { [f]: k[0] }], [2024, { [f]: k[1] }]]) }]]) });
  const ims = {
    immigrants: stock([900_000, 1_000_000], "immigrants"),
    immigrantsShare: stock([3.6, 4.1], "immigrantsPct"),
    emigrants: stock([2_000_000, 2_600_000], "emigrants"),
    emigrantsShare: stock([8, 10.5], "emigrantsPct"),
  };
  const wb = {
    countries: new Map([
      ["SHR", { name: "Shrinkland", region: "Europe & Central Asia", incomeGroup: "High income", iso2: "SH", aggregate: false }],
      ["GRO", { name: "Growland", region: "Sub-Saharan Africa", incomeGroup: "Low income", iso2: "GR", aggregate: false }],
      ["TNY", { name: "Tinyland", region: "East Asia & Pacific", incomeGroup: null, iso2: "TN", aggregate: false }],
      ["WLD", { name: "World", region: null, incomeGroup: null, iso2: "1W", aggregate: true }],
    ]),
    latest: {
      tfr: new Map([["SHR", { value: 0.75, year: 2024 }]]),
      population: new Map([["SHR", { value: 23_000_000, year: 2025 }]]),
      birthRate: new Map([["SHR", { value: 5.1, year: 2024 }]]),
      deathRate: new Map([["SHR", { value: 13.2, year: 2024 }]]),
    },
  };
  const corridors = new Map([
    ["SHR", { year: 2024, source: "UN-DESA", immigrantsTotal: 1_000_000, emigrantsTotal: 2_600_000, topOrigins: [{ iso3: "GRO", name: "Growland", people: 400_000 }], topDestinations: [] }],
  ]);
  return { wpp, ims, wb, corridors };
}

export function fixtureManifest() {
  const ds = (id) => ({ id, title: id, url: `https://example.test/${id}.csv`, metadataUrl: null, required: true, status: "ok", vintage: { lastUpdated: "2024-07-12" }, columns: [id], error: null });
  return {
    wpp: ["fertility", "population", "birthsDeaths", "netMigration", "medianAge", "ageStructure"].map(ds),
    ims: ["immigrants", "immigrantsShare", "emigrants", "emigrantsShare", "migrationCorridors"].map(ds),
    wb: [{ id: "countries", key: "countries", title: "Countries", url: "https://example.test/wb", status: "ok", lastUpdated: null, error: null }],
  };
}
