// Pulls the latest public fertility data and writes public/data/fertility.json.
// Sources:
//   - World Bank WDI  SP.DYN.TFRT.IN (TFR) + SP.POP.TOTL (population), latest reported years
//   - UN World Population Prospects via Our World in Data: estimates 1950+ and medium-variant projections to 2100
// No dependencies; runs on Node 18+ (global fetch).
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT = new URL("../public/data/fertility.json", import.meta.url);
const OWID_URL =
  "https://ourworldindata.org/grapher/fertility-rate-with-projections.csv?v=1&csvType=full&useColumnShortNames=true";
const WB = (indicator) =>
  `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&date=1960:2030`;
const WB_COUNTRIES = "https://api.worldbank.org/v2/country?format=json&per_page=400";

async function get(url, as = "json") {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "fertility-tracker (github.com/RostyslavDzhohola)" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return as === "json" ? await res.json() : await res.text();
    } catch (err) {
      if (attempt >= 3) throw new Error(`GET ${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

async function main() {
  const [owidCsv, wbTfr, wbPop, wbCountries] = await Promise.all([
    get(OWID_URL, "text"),
    get(WB("SP.DYN.TFRT.IN")),
    get(WB("SP.POP.TOTL")),
    get(WB_COUNTRIES),
  ]);

  // UN WPP series (via OWID). Keep real countries (ISO3) plus World.
  const [header, ...rows] = parseCsv(owidCsv);
  const col = (prefix) => header.findIndex((h) => h.startsWith(prefix));
  const iEnt = header.indexOf("entity"), iCode = header.indexOf("code"), iYear = header.indexOf("year");
  const iEst = col("fertility_rate__sex_all__age_all__variant_estimates");
  const iProj = col("fertility_rate__sex_all__age_all__variant_medium");
  if ([iEnt, iCode, iYear, iEst, iProj].includes(-1)) throw new Error(`OWID CSV columns changed: ${header.join(",")}`);

  const countries = {};
  for (const r of rows) {
    let code = r[iCode];
    if (code === "OWID_WRL") code = "WLD";
    else if (!/^[A-Z]{3}$/.test(code)) continue;
    const c = (countries[code] ??= { name: r[iEnt], un: { est: [], proj: [] } });
    const year = +r[iYear];
    if (r[iEst] !== "") c.un.est.push([year, round(+r[iEst])]);
    if (r[iProj] !== "") c.un.proj.push([year, round(+r[iProj])]);
  }

  // World Bank: latest non-null TFR and population per country.
  const latest = (resp) => {
    const out = {};
    for (const d of resp[1] ?? []) {
      if (d.value == null || !d.countryiso3code) continue;
      const y = +d.date;
      if (!out[d.countryiso3code] || out[d.countryiso3code].year < y) out[d.countryiso3code] = { year: y, value: d.value };
    }
    return out;
  };
  const tfr = latest(wbTfr), pop = latest(wbPop);
  const region = Object.fromEntries((wbCountries[1] ?? []).map((c) => [c.id, c.region?.value?.trim()]));

  for (const [code, c] of Object.entries(countries)) {
    const est = c.un.est.at(-1);
    const wb = tfr[code];
    // Prefer the newer of the WB report and the last UN estimate as "current".
    c.tfr = wb && (!est || wb.year >= est[0])
      ? { value: round(wb.value), year: wb.year, source: "World Bank" }
      : est ? { value: est[1], year: est[0], source: "UN WPP" } : null;
    if (pop[code]) c.population = { value: pop[code].value, year: pop[code].year };
    if (region[code] && region[code] !== "Aggregates") c.region = region[code];
  }
  for (const [code, c] of Object.entries(countries)) if (!c.tfr) delete countries[code];

  const data = {
    generatedAt: new Date().toISOString(),
    sources: {
      worldBank: { name: "World Bank WDI (SP.DYN.TFRT.IN, SP.POP.TOTL)", url: "https://data.worldbank.org/indicator/SP.DYN.TFRT.IN", lastUpdated: wbTfr[0]?.lastupdated ?? null },
      un: { name: "UN World Population Prospects (via Our World in Data)", url: "https://ourworldindata.org/grapher/fertility-rate-with-projections" },
    },
    replacement: 2.1,
    countries,
  };

  const n = Object.keys(countries).length;
  if (n < 150) throw new Error(`Only ${n} countries parsed; refusing to overwrite data`);
  // Keep the previous timestamp when nothing changed, so the file only changes when the numbers do.
  const previous = await readFile(OUT, "utf8").then(JSON.parse, () => null);
  if (previous && JSON.stringify({ ...previous, generatedAt: null }) === JSON.stringify({ ...data, generatedAt: null })) {
    console.log(`No changes (${n} countries)`);
    return;
  }
  await mkdir(new URL(".", OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  console.log(`Wrote ${n} countries -> ${decodeURIComponent(OUT.pathname)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
