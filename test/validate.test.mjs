// scripts/validate-data.mjs comparisons (scripts/lib/validate.mjs), offline: references are derived from the same
// synthetic sources the fixture build uses, so a clean build has 0 mismatches and each corruption is named.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDataset } from "../scripts/lib/build.mjs";
import { API_DIR, finalize, renderFiles } from "../scripts/lib/publish.mjs";
import { TOLERANCE, validatePublished } from "../scripts/lib/validate.mjs";
import { fixtureManifest, fixtureRaw, fixtureScenarios } from "./helpers/fixture.mjs";

/** Published files -> the object validatePublished() expects (as scripts/validate-data.mjs loads them). */
function published(raw = fixtureRaw()) {
  const files = finalize(renderFiles(buildDataset(raw), fixtureManifest())).files;
  const read = (p) => JSON.parse(files.get(`${API_DIR}/${p}`));
  const countries = read("countries.json");
  return {
    countries,
    details: new Map(countries.countries.map((c) => [c.iso3, read(`countries/${c.iso3}.json`)])),
    risk: read("risk.json"),
    scenarios: read("scenarios.json"),
    countriesCsv: files.get(`${API_DIR}/countries.csv`),
    timeseriesCsv: files.get(`${API_DIR}/timeseries.csv`),
  };
}

/** "Primary source" references built from the fixture's raw inputs, in the shapes the CLI produces. */
function refs(raw = fixtureRaw()) {
  const ind = new Map();
  const share65 = new Map();
  const v = (y, est, proj) => y?.[est] ?? y?.[proj] ?? null;
  for (const [code, e] of raw.wpp.population.entities) {
    const rows = new Map();
    const sh = new Map();
    for (const [year, y] of e.years) {
      const at = (ds) => raw.wpp[ds].entities.get(code)?.years.get(year);
      const population = v(y, "popEst", "popProj");
      const births = v(at("birthsDeaths"), "birthsEst", "birthsProj");
      const deaths = v(at("birthsDeaths"), "deathsEst", "deathsProj");
      rows.set(year, {
        population,
        births,
        deaths,
        naturalChange: births - deaths,
        netMigration: v(at("netMigration"), "netMigEst", "netMigProj"),
        tfr: v(at("fertility"), "tfrEst", "tfrProj"),
        medianAge: v(at("medianAge"), "medianAgeEst", "medianAgeProj"),
        cbr: (births / population) * 1000,
        cdr: (deaths / population) * 1000,
      });
      const a = at("ageStructure");
      sh.set(year, (v(a, "pop65Est", "pop65Proj") / v(a, "popAllEst", "popAllProj")) * 100);
    }
    ind.set(code, rows);
    share65.set(code, sh);
  }
  return { un: { ind, share65, scen: { main: fixtureScenarios().places, update: new Map() } }, wb: { latest: raw.wb.latest } };
}

test("a clean build validates with 0 mismatches against its sources", () => {
  const summary = validatePublished(published(), refs()).summary();
  const bad = summary.checks.filter((c) => c.mismatches);
  assert.deepEqual(bad.map((c) => `${c.id}: ${c.examples[0]}`), []);
  assert.ok(summary.compared > 10_000, `compared ${summary.compared}`);
  assert.equal(summary.countries, 5, "4 records + the CSV row-count pseudo-entry");
  for (const id of ["series.population", "series.share65", "projection.change2100Pct", "headline.provenance", "scenarios.medium", "scenarios.constant", "csv.timeseries", "risk.score", "links.site"]) {
    assert.ok(summary.checks.find((c) => c.id === id)?.compared > 0, `${id} ran`);
  }
});

test("lossy series values (Tokelau-style deaths, 65+ without 100+) are reported with examples", () => {
  const pub = published();
  const shr = pub.details.get("SHR");
  const row = shr.series.find((r) => r.year === 2023);
  row.deaths -= 12; // e.g. single-age deaths rounded to whole people before summing
  row.share65 = Math.round((row.share65 - 2) * 10) / 10; // e.g. a 65+ group that stops at 99
  const summary = validatePublished(pub, refs()).summary();
  const check = (id) => summary.checks.find((c) => c.id === id);
  assert.equal(check("series.deaths").mismatches, 1);
  assert.match(check("series.deaths").examples[0], /^SHR 2023 deaths: published \d+, reference \d+ \(diff 12, tolerance 1\)$/);
  assert.equal(check("series.share65").mismatches, 1);
  assert.equal(check("series.identities").mismatches, 1, "naturalChange no longer equals births - deaths");
  assert.deepEqual(check("series.deaths").mismatchCountries, ["SHR"]);
  assert.equal(TOLERANCE.people, 1);
});

test("a stale scenario overlay and a stale World Bank year are both caught", () => {
  const pub = published();
  pub.scenarios.places.GRO.medium = pub.scenarios.places.GRO.medium.map((x) => Math.round(x * 1.13));
  const r = refs();
  r.wb.latest = { ...r.wb.latest, tfr: new Map([["SHR", { value: 0.72, year: 2025 }]]) }; // WB has a newer year than we publish
  const summary = validatePublished(pub, r).summary();
  const check = (id) => summary.checks.find((c) => c.id === id);
  assert.equal(check("scenarios.medium").mismatches, 77);
  assert.equal(check("scenarios.medium=series").mismatches, 77);
  assert.ok(check("headline.provenance").examples.some((e) => e === "SHR tfr year/source: published 2024 WB, expected 2025 WB"), check("headline.provenance").examples.join("\n"));
  assert.match(check("headline.wb.tfr").examples[0], /^SHR tfr 2024: published 0.75, reference null/);
});

test("internal consistency: summary vs detail, CSV vs JSON, risk recomputed from its inputs", () => {
  const pub = published();
  pub.countries.countries.find((c) => c.iso3 === "SHR").tfr.value = 0.7;
  pub.details.get("GRO").risk.score += 3;
  pub.timeseriesCsv = pub.timeseriesCsv.replace(/^SHR,2050,projection,births,\d+$/m, "SHR,2050,projection,births,1");
  const summary = validatePublished(pub, refs()).summary();
  const check = (id) => summary.checks.find((c) => c.id === id);
  assert.ok(check("summary=detail").examples.some((e) => /^SHR tfr: published .*0\.7\b.*, expected .*0\.75/.test(e)), check("summary=detail").examples.join("\n"));
  assert.ok(check("summary=detail").mismatchCountries.includes("GRO"), "GRO's summary risk no longer equals its detail file");
  assert.ok(check("risk.score").mismatchCountries.includes("GRO"));
  assert.match(check("csv.timeseries").examples[0], /^SHR 2050 projection births: published 1, expected \d+$/);
});

test("pattern note: identical net migration in the last three estimate years is checked against the UN file", () => {
  const raw = fixtureRaw();
  for (const y of [2021, 2022, 2023]) raw.wpp.netMigration.entities.get("SHR").years.set(y, { netMigEst: -3427 });
  const summary = validatePublished(published(raw), refs(raw)).summary();
  // SHR (set here) and TNY (constant by construction in the fixture).
  assert.match(summary.notes[0], /Net migration identical in 2021, 2022, 2023: 2 places in our files, 2 in the UN file; ours but not the UN's: none/);
  assert.equal(summary.checks.find((c) => c.id === "pattern.netMigrationFlat").mismatches, 0, "same in the source: not our bug");
  // Same pattern only in our files (a fill-forward bug) is a mismatch.
  const r = refs(raw);
  r.un.ind.get("SHR").get(2022).netMigration = -5000;
  const s2 = validatePublished(published(raw), r).summary();
  assert.equal(s2.checks.find((c) => c.id === "pattern.netMigrationFlat").mismatches, 1);
});
