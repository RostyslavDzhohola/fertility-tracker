// scripts/validate-data.mjs comparisons (scripts/lib/validate.mjs), offline: references are derived from the same
// synthetic sources the fixture build uses, so a clean build has 0 mismatches and each corruption is named.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDataset } from "../scripts/lib/build.mjs";
import { API_DIR, finalize, renderFiles } from "../scripts/lib/publish.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { markUnavailable } from "../scripts/lib/http.mjs";
import { REFERENCE_GAPS, TOLERANCE, validatePublished } from "../scripts/lib/validate.mjs";
import { EXIT, exitCodeFor } from "../scripts/validate-data.mjs";
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
  // UN DESA tables as the CLI reads them: stocks by year, population in thousands (Table 2), corridors.
  const stock = (k, f) => new Map([...raw.ims[k].entities].map(([code, e]) => [code, new Map([...e.years].map(([y, v]) => [y, v[f]]))]));
  const emigrants = stock("emigrants", "emigrants");
  const emiPct = stock("emigrantsShare", "emigrantsPct");
  const population = new Map([...emigrants].map(([code, m]) => [code, new Map([...m].map(([y, v]) => [y, v / (emiPct.get(code).get(y) / 100) / 1000]))]));
  const corridors = new Map(
    [...raw.corridors].map(([code, c]) => [
      code,
      { year: c.year, immigrantsTotal: c.immigrantsTotal, emigrantsTotal: c.emigrantsTotal, origins: c.topOrigins.map(({ iso3, people }) => ({ iso3, people })), destinations: c.topDestinations.map(({ iso3, people }) => ({ iso3, people })) },
    ]),
  );
  return {
    un: { ind, share65, scen: { main: fixtureScenarios().places, update: new Map() } },
    wb: { latest: raw.wb.latest },
    ims: { immigrants: stock("immigrants", "immigrants"), immigrantsPct: stock("immigrantsShare", "immigrantsPct"), emigrants, population, corridors },
  };
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
  assert.equal(check("headline.wb.tfr").examples[0], "SHR tfr year: published 2024, expected 2025");
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

// ---------- a missing reference is a failure, never a silent pass ----------

const check = (summary, id) => summary.checks.find((c) => c.id === id);

test("probe: a wrong published value whose reference year was removed is still a mismatch", () => {
  const pub = published();
  pub.details.get("SHR").series.find((r) => r.year === 2030).population += 12_345;
  const caught = validatePublished(pub, refs()).summary();
  assert.equal(check(caught, "series.population").mismatches, 1, "with the reference present: a value mismatch");
  const r = refs();
  r.un.ind.get("SHR").delete(2030); // the reference lost that year
  const summary = validatePublished(pub, r).summary();
  assert.ok(summary.mismatches > 0, "not 0 mismatches");
  assert.equal(check(summary, "reference.missing").mismatches, 1);
  assert.deepEqual(check(summary, "reference.missing").examples, ["SHR 2030 (year not in the UN file) (series): published, but the reference has no value"]);
});

test("probe: a published corridor (or stock value, or headline) with no reference is a mismatch", () => {
  const r = refs();
  r.ims.corridors.delete("SHR");
  r.ims.emigrants.get("SHR").delete(2024);
  r.wb.latest = { ...r.wb.latest, deathRate: new Map() }; // the World Bank no longer has SHR's 2024 death rate
  const summary = validatePublished(published(), r).summary();
  const miss = check(summary, "reference.missing");
  assert.ok(miss.examples.includes("SHR migrationCorridors (no destination-and-origin rows) (corridors): published, but the reference has no value"), miss.examples.join("\n"));
  assert.ok(miss.examples.some((e) => /^SHR 2024 emigrants \(migrantStock\.emigrants\): published/.test(e)), miss.examples.join("\n"));
  assert.ok(miss.examples.some((e) => /^SHR deathRate 2024 \(no World Bank value\)/.test(e)), miss.examples.join("\n"));
  // A whole place missing from the UN file fails once per series and once for its projection.
  const r2 = refs();
  r2.un.ind.delete("GRO");
  const s2 = validatePublished(published(), r2).summary();
  assert.ok(check(s2, "reference.missing").examples.some((e) => e.startsWith("GRO every year (place not in the UN file)")));
  assert.ok(check(s2, "reference.missing").examples.some((e) => e.startsWith("GRO projection (no UN rows")));
});

test("genuine source gaps pass only when listed in REFERENCE_GAPS, and are reported separately", () => {
  assert.deepEqual(REFERENCE_GAPS, [], "no gaps are allowed for the current sources");
  const r = refs();
  r.ims.corridors.delete("SHR");
  const gaps = [{ iso3: "SHR", section: "corridors", reason: "UN DESA has no origin-destination rows for this place" }];
  const summary = validatePublished(published(), r, { gaps }).summary();
  assert.equal(summary.mismatches, 0);
  assert.deepEqual(check(summary, "reference.allowedGaps").examples, ["SHR migrationCorridors (no destination-and-origin rows): UN DESA has no origin-destination rows for this place"]);
  // The allow-list is per place and section: another place's gap still fails.
  const r2 = refs();
  r2.ims.emigrants.get("SHR").delete(2020);
  const s2 = validatePublished(published(), r2, { gaps }).summary();
  assert.equal(s2.mismatches, 3, "emigrants, and the two shares derived from them");
  assert.deepEqual(check(s2, "reference.missing").examples.map((e) => e.split(" (")[0]), ["SHR 2020 emigrants", "SHR 2020 emigrantsPct", "SHR 2020 livingAbroadPct"]);
});

test("exit codes: 2 only when a source could not be fetched; bugs and bad inputs are 3", () => {
  assert.deepEqual(EXIT, { ok: 0, mismatches: 1, unavailable: 2, error: 3 });
  assert.equal(exitCodeFor(markUnavailable(new Error("GET x failed: HTTP 503"))), 2);
  assert.equal(exitCodeFor(new Error("wrapped", { cause: markUnavailable(new Error("socket hang up")) })), 2);
  assert.equal(exitCodeFor(new TypeError("x is not a function")), 3);
  assert.equal(exitCodeFor(new Error("CSV header lacks TFR")), 3);
  // End to end: unreadable published files are not an outage.
  const script = fileURLToPath(new URL("../scripts/validate-data.mjs", import.meta.url));
  const res = spawnSync(process.execPath, [script, "--api", "/nonexistent/api/v1"], { encoding: "utf8" });
  assert.equal(res.status, 3, res.stderr);
  assert.match(res.stderr, /failed unexpectedly \(exit 3/);
});
