// Review fixes: never overwrite good data with partial upstream data; projection baseline; emigrant share; status.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildDataset, livingAbroadPct } from "../scripts/lib/build.mjs";
import { API_DIR, finalize, renderFiles, writeFiles } from "../scripts/lib/publish.mjs";
import { riskFactors, scoreRisk } from "../scripts/lib/risk.mjs";
import { coverage, coverageRegressions, provenanceRegressions, sanityCheck } from "../scripts/lib/sanity.mjs";
import { schemas, validate } from "../scripts/lib/schema.mjs";
import { fixtureManifest, fixtureRaw } from "./helpers/fixture.mjs";

/** Fixture plus a France-like ranked country (a copy of SHR's shape under code FRA). */
function rawWithFrance() {
  const raw = fixtureRaw();
  for (const ds of Object.values(raw.wpp)) {
    const shr = ds.entities.get("SHR");
    ds.entities.set("FRA", { name: "France", rawName: "France", years: new Map([...shr.years].map(([y, v]) => [y, { ...v }])) });
  }
  raw.wb.countries.set("FRA", { name: "France", region: "Europe & Central Asia", incomeGroup: "High income", iso2: "FR", aggregate: false });
  return raw;
}

test("France repro: clearing France's births/deaths upstream is refused, not published", () => {
  const good = buildDataset(rawWithFrance());
  const fra = good.full.find((r) => r.iso3 === "FRA");
  assert.equal(fra.ranked, true);
  assert.ok(fra.risk.rank > 0);
  const previous = { countries: good.records, details: good.details };

  // Same build again: no regressions.
  assert.deepEqual(coverageRegressions(previous.details, buildDataset(rawWithFrance()).details), []);

  // Upstream drops France from the births/deaths CSV (everything else intact).
  const raw = rawWithFrance();
  raw.wpp.birthsDeaths.entities.delete("FRA");
  const broken = buildDataset(raw);
  const bFra = broken.full.find((r) => r.iso3 === "FRA");
  assert.equal(bFra.components.births, null, "precondition: the balance is erased");
  assert.equal(bFra.ranked, false, "precondition: the rank is lost");

  const regressions = coverageRegressions(previous.details, broken.details);
  assert.ok(regressions.some((e) => /^FRA \(France\): dropped out of the risk ranking/.test(e)), regressions.join("\n"));
  const lost = regressions.find((e) => /^FRA \(France\): lost data/.test(e));
  assert.match(lost, /series\.births 151 -> 0 years/);
  assert.match(lost, /series\.deaths 151 -> 0 years/);
  assert.match(lost, /components\.births/);
  assert.ok(sanityCheck(broken, previous).some((e) => e.startsWith("FRA (France)")), "sanityCheck (which gates writing) reports it");
  assert.ok(!regressions.some((e) => e.startsWith("SHR")), "other countries unaffected");
});

test("coverage regressions: lost years, lost blocks, lost corridors, missing records; gains are fine", () => {
  const good = buildDataset(fixtureRaw());
  const prev = good.details;
  const clone = () => new Map([...prev].map(([k, v]) => [k, structuredClone(v)]));

  const fewer = clone();
  fewer.get("SHR").series.slice(0, 10).forEach((r) => (r.tfr = null));
  assert.match(coverageRegressions(prev, fewer)[0], /series\.tfr 151 -> 141 years/);

  const noCorr = clone();
  noCorr.get("SHR").migrationCorridors = null;
  assert.match(coverageRegressions(prev, noCorr)[0], /migrationCorridors/);

  const gone = clone();
  gone.delete("GRO");
  assert.deepEqual(coverageRegressions(prev, gone), ["GRO: record missing (was published before)"]);

  const gained = clone();
  gained.get("GRO").migrationCorridors = { year: 2024, topOrigins: [], topDestinations: [] };
  assert.deepEqual(coverageRegressions(prev, gained), []);
  assert.equal(coverage(prev.get("SHR"))["series.births"], 151);
});

test("published France record: blanking its births/deaths is caught against the real previous build", { skip: !existsSync(new URL("../public/api/v1/countries/FRA.json", import.meta.url)) && "no published output" }, () => {
  const fra = JSON.parse(readFileSync(new URL("../public/api/v1/countries/FRA.json", import.meta.url), "utf8"));
  const broken = structuredClone(fra);
  for (const r of broken.series) r.births = r.deaths = r.naturalChange = r.populationChange = null;
  Object.assign(broken.components, { births: null, deaths: null, naturalChange: null, populationChange: null });
  broken.ranked = false;
  broken.risk.score = broken.risk.rank = null;
  const errors = coverageRegressions(new Map([["FRA", fra]]), new Map([["FRA", broken]]));
  assert.equal(errors.length, 2);
  assert.match(errors[0], /FRA \(France\): dropped out of the risk ranking \(was rank \d+\)/);
  assert.match(errors[1], /series\.births 151 -> 0 years.*risk\.score/);
});

test("projection baseline (baseYear, basePopulation) is in countries.json and matches change2100Pct", () => {
  const ds = buildDataset(fixtureRaw());
  const shr = ds.records.find((r) => r.iso3 === "SHR");
  assert.equal(shr.projection.baseYear, 2023);
  const expected = Math.round(((shr.projection.population2100 - shr.projection.basePopulation) / shr.projection.basePopulation) * 1000) / 10;
  assert.equal(shr.projection.change2100Pct, expected);
  assert.notEqual(shr.projection.basePopulation, shr.population.value, "baseline differs from the headline World Bank population");
  const { files } = finalize(renderFiles(ds, fixtureManifest()));
  const countries = JSON.parse(files.get(`${API_DIR}/countries.json`));
  assert.deepEqual(validate(schemas()["countries.schema.json"], countries), []);
  assert.equal(countries.countries.find((r) => r.iso3 === "SHR").projection.basePopulation, shr.projection.basePopulation);
});

test("livingAbroadPct divides by everyone born in the country, not the resident population (Guyana)", () => {
  // UN DESA 2024 via OWID: Guyana ~831k residents, emigrantsPct 56% of residents.
  const residents = 831_237;
  const emigrants = Math.round(residents * 0.56);
  const immigrants = 33_000;
  const pct = livingAbroadPct(immigrants, (immigrants / residents) * 100, emigrants, 56);
  assert.ok(Math.abs(pct - (emigrants / (residents - immigrants + emigrants)) * 100) < 1e-3);
  assert.ok(pct > 36 && pct < 38, `~37%, got ${pct}`);
  assert.equal(livingAbroadPct(null, null, 5, 1), null);

  const rec = { migrantStock: { year: 2024, emigrants, emigrantsPct: 56, livingAbroadPct: Math.round(pct * 10) / 10 } };
  const scored = scoreRisk({});
  const text = riskFactors(rec, scored).map((f) => f.text);
  assert.deepEqual(text, [`37% of people born here now live abroad (465,000, 2024)`]);
  const noBorn = riskFactors({ migrantStock: { year: 2024, emigrants, emigrantsPct: 56, livingAbroadPct: null } }, scored).map((f) => f.text);
  assert.deepEqual(noBorn, ["Emigrants living abroad equal 56% of the current population (465,000, 2024)"]);
});

test("status.json records the deployed commit and the trigger commit separately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ft-status-"));
  try {
    await writeFiles(dir, finalize(renderFiles(buildDataset(fixtureRaw()), fixtureManifest())).files);
    const script = fileURLToPath(new URL("../scripts/fetch-data.mjs", import.meta.url));
    const res = spawnSync(process.execPath, [script, "--write-status", "--out", dir, "--outcome", "success", "--commit", "b".repeat(40)], {
      env: { ...process.env, GITHUB_SHA: "a".repeat(40), GITHUB_EVENT_NAME: "schedule" },
      encoding: "utf8",
    });
    assert.equal(res.status, 0, res.stderr);
    const status = JSON.parse(await readFile(join(dir, API_DIR, "status.json"), "utf8"));
    assert.equal(status.commit, "b".repeat(40));
    assert.equal(status.triggerCommit, "a".repeat(40));
    assert.equal(status.refresh, "success");
    assert.deepEqual(validate(schemas()["status.schema.json"], status), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("partial World Bank response: a country missing from a successful WB reply cannot fall back to older UN data", () => {
  const good = buildDataset(fixtureRaw());
  const previous = { countries: good.records, details: good.details };
  const raw = fixtureRaw();
  raw.wb.latest.tfr.delete("SHR"); // HTTP 200, every other country present, SHR missing
  raw.wb.latest.population.delete("SHR");
  const partial = buildDataset(raw);
  assert.deepEqual(partial.details.get("SHR").tfr, { value: 0.8, year: 2023, source: "UN-WPP" }, "precondition: silent fallback");
  const errors = coverageRegressions(previous.details, partial.details);
  assert.equal(errors.length, 1, errors.join("\n"));
  assert.match(errors[0], /^SHR \(Shrinkland\): older data would replace newer: population 2025 WB -> 2023 UN-WPP, tfr 2024 WB -> 2023 UN-WPP$/);
  assert.ok(sanityCheck(partial, previous).includes(errors[0]), "the write gate refuses it");
});

test("provenance rules: years never move backwards; a same-year WB value may not be replaced; newer data is fine", () => {
  const wb = (year) => ({ value: 1.5, year, source: "WB" });
  const un = (year) => ({ value: 1.6, year, source: "UN-WPP" });
  assert.deepEqual(provenanceRegressions({ tfr: wb(2024) }, { tfr: un(2023) }), ["tfr 2024 WB -> 2023 UN-WPP"]);
  assert.deepEqual(provenanceRegressions({ tfr: wb(2023) }, { tfr: un(2023) }), ["tfr 2023 WB -> 2023 UN-WPP"]);
  assert.deepEqual(provenanceRegressions({ tfr: wb(2023) }, { tfr: un(2025) }), [], "a newer UN estimate may win");
  assert.deepEqual(provenanceRegressions({ tfr: wb(2024) }, { tfr: wb(2025) }), []);
  assert.deepEqual(provenanceRegressions({ tfr: un(2023) }, { tfr: wb(2023) }), []);
  assert.deepEqual(provenanceRegressions({ migrantStock: { year: 2024, source: "UN-DESA" } }, { migrantStock: { year: 2020, source: "UN-DESA" } }), [
    "migrantStock 2024 UN-DESA -> 2020 UN-DESA",
  ]);
  assert.deepEqual(provenanceRegressions({ migrantStock: { year: 2024, source: "UN-DESA" } }, { migrantStock: { year: 2024, source: "WB" } }), [
    "migrantStock source UN-DESA -> WB",
  ]);
  assert.deepEqual(provenanceRegressions({ projection: { baseYear: 2023 } }, { projection: { baseYear: 2021 } }), ["projection.baseYear 2023 -> 2021"]);
});

test("published France record: WB tfr 2024 falling back to the UN 2023 value is refused", { skip: !existsSync(new URL("../public/api/v1/countries/FRA.json", import.meta.url)) && "no published output" }, () => {
  const fra = JSON.parse(readFileSync(new URL("../public/api/v1/countries/FRA.json", import.meta.url), "utf8"));
  assert.equal(fra.tfr.source, "WB");
  const fallback = structuredClone(fra);
  fallback.tfr = { value: fra.series.find((r) => r.year === 2023).tfr, year: 2023, source: "UN-WPP" };
  assert.deepEqual(coverageRegressions(new Map([["FRA", fra]]), new Map([["FRA", fallback]])), [
    `FRA (France): older data would replace newer: tfr ${fra.tfr.year} WB -> 2023 UN-WPP`,
  ]);
});

test("a corridor direction whose breakdown existed may not become empty; never-available directions are fine", () => {
  const corr = (origins) => ({ year: 2024, source: "UN-DESA", topOrigins: origins, topDestinations: [{ iso3: "USA", name: "United States", people: 9 }] });
  const rec = (c) => ({ iso3: "KOR", name: "South Korea", migrationCorridors: c });
  const had = new Map([["KOR", rec(corr([{ iso3: "CHN", name: "China", people: 5 }]))]]);
  const emptied = new Map([["KOR", rec(corr([]))]]);
  assert.deepEqual(coverageRegressions(had, emptied), ["KOR (South Korea): lost data vs the previous build: migrationCorridors.topOrigins"]);
  const never = new Map([["VAT", { ...rec(corr([])), iso3: "VAT", name: "Vatican" }]]);
  assert.deepEqual(coverageRegressions(never, never), []);
});
