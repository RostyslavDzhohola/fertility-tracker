import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSeries,
  demographicBalance,
  generations,
  lastEstimateYear,
  naturalDeclineSince,
  pickLatest,
  projectionSummary,
} from "../scripts/lib/model.mjs";
import { fixtureRaw } from "./helpers/fixture.mjs";

const row = (year, births, deaths, netMigration, population = 1_000_000) => ({
  year,
  variant: "estimate",
  population,
  births,
  deaths,
  naturalChange: births - deaths,
  netMigration,
  populationChange: births - deaths + netMigration,
});

test("buildSeries merges estimates then projections and decomposes growth", () => {
  const { wpp } = fixtureRaw();
  const s = buildSeries("SHR", wpp);
  assert.equal(s.length, 151);
  assert.equal(s[0].year, 1950);
  assert.equal(s.at(-1).year, 2100);
  assert.equal(lastEstimateYear(s), 2023);
  assert.equal(s.find((r) => r.year === 2023).variant, "estimate");
  assert.equal(s.find((r) => r.year === 2024).variant, "projection");
  for (const r of s) {
    assert.equal(r.naturalChange, r.births - r.deaths, `naturalChange identity ${r.year}`);
    assert.equal(r.populationChange, r.births - r.deaths + r.netMigration, `balance identity ${r.year}`);
    assert.ok(r.share65 > 0 && r.share65 < 100);
  }
  assert.deepEqual(buildSeries("NOPE", wpp), []);
});

test("buildSeries leaves fields null when a dataset is missing (graceful degradation)", () => {
  const { wpp } = fixtureRaw();
  delete wpp.netMigration;
  const r = buildSeries("SHR", wpp).find((x) => x.year === 2023);
  assert.equal(r.netMigration, null);
  assert.equal(r.populationChange, null);
  assert.notEqual(r.naturalChange, null);
});

test("demographicBalance gives absolute numbers, per-1000 rates and the migration offset", () => {
  const b = demographicBalance(row(2023, 236_394, 345_503, 87_800, 51_748_744));
  assert.equal(b.naturalChange, -109_109);
  assert.equal(b.populationChange, -21_309);
  assert.deepEqual(b.perThousand, { births: 4.6, deaths: 6.7, naturalChange: -2.1, netMigration: 1.7, populationChange: -0.4 });
  assert.equal(b.migrationOffsetPct, 80);
  assert.equal(demographicBalance(row(2023, 100, 50, -10)).migrationOffsetPct, null, "no natural decline => null");
  assert.equal(demographicBalance(row(2023, 50, 100, -10)).migrationOffsetPct, -20, "net emigration => negative");
  assert.equal(demographicBalance(null), null);
});

test("naturalDeclineSince finds the start of the current run, or the first projected year", () => {
  const s = [row(2018, 10, 5, 0), row(2019, 4, 5, 0), row(2020, 4, 6, 0), row(2021, 3, 6, 0)];
  assert.equal(naturalDeclineSince(s, 2021), 2019);
  const future = [row(2023, 10, 5, 0), { ...row(2024, 10, 9, 0), variant: "projection" }, { ...row(2025, 8, 9, 0), variant: "projection" }];
  assert.equal(naturalDeclineSince(future, 2023), 2025);
  assert.equal(naturalDeclineSince([row(2023, 10, 5, 0)], 2023), null);
  assert.equal(naturalDeclineSince(s, 1999), null, "unknown base year");
});

test("projectionSummary reports changes vs the base year, peak and half-population year", () => {
  const { wpp } = fixtureRaw();
  const s = buildSeries("SHR", wpp);
  const p = projectionSummary(s, 2023);
  const base = s.find((r) => r.year === 2023).population;
  assert.equal(p.baseYear, 2023);
  assert.equal(p.basePopulation, base);
  assert.equal(p.change2100Pct, Math.round(((s.at(-1).population - base) / base) * 1000) / 10);
  assert.ok(p.change2050Pct < 0 && p.change2100Pct < p.change2050Pct);
  assert.equal(p.peakYear, 2010);
  const half = s.find((r) => r.year > 2023 && r.population <= base / 2).year;
  assert.equal(p.halfPopulationYear, half);
  assert.equal(p.naturalDeclineSince, 2016);
  const g = projectionSummary(buildSeries("GRO", wpp), 2023);
  assert.ok(g.change2100Pct > 0);
  assert.equal(g.halfPopulationYear, null);
  assert.equal(g.peakYear, 2100);
});

test("generations reproduces the 100 -> 54 -> 29 -> 16 -> 9 example for TFR 1.14", () => {
  const g = generations(1.14);
  assert.deepEqual(g.hundredPeople, [100, 54, 29, 16, 9]);
  assert.equal(g.ratio, 0.543);
  assert.equal(g.halvingYears, 34);
  assert.equal(generations(2.5).halvingYears, null);
  assert.equal(generations(null), null);
});

test("pickLatest prefers the newest year, ties go to the first candidate", () => {
  const wb = { value: 0.748, year: 2024, source: "WB" };
  const un = { value: 0.72, year: 2023, source: "UN-WPP" };
  assert.deepEqual(pickLatest(wb, un), wb);
  assert.deepEqual(pickLatest(null, un), un);
  assert.deepEqual(pickLatest({ ...wb, year: 2023 }, un).source, "WB");
  assert.equal(pickLatest(null, { value: null, year: 2020, source: "UN-WPP" }), null);
});
