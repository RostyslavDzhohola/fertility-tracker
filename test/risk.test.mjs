import assert from "node:assert/strict";
import { test } from "node:test";
import { fractionWords, migrationRisk, people, ramp, RISK_MODEL, riskFactors, scoreRisk, tierFor } from "../scripts/lib/risk.mjs";

const inputs = (o = {}) => ({
  tfr: 1.6,
  naturalChangeRate: 1,
  share65: 15,
  medianAge: 38,
  change2050Pct: 5,
  change2100Pct: 10,
  naturalChange: 1000,
  netMigration: 500,
  populationChangePerThousand: 2,
  migrationOffsetPct: null,
  ...o,
});

test("component weights sum to 100 and tiers are ordered", () => {
  assert.equal(RISK_MODEL.components.reduce((a, c) => a + c.weight, 0), 100);
  const mins = RISK_MODEL.tiers.map((t) => t.min);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a));
  assert.equal(mins.at(-1), 0);
});

test("ramp is linear, clamped, and works in both directions", () => {
  assert.equal(ramp(2.1, 2.1, 0.8), 0);
  assert.equal(ramp(0.8, 2.1, 0.8), 1);
  assert.equal(ramp(0.5, 2.1, 0.8), 1);
  assert.equal(ramp(3, 2.1, 0.8), 0);
  assert.ok(Math.abs(ramp(1.45, 2.1, 0.8) - 0.5) < 1e-12);
  assert.equal(ramp(15, 7, 30) > 0, true);
  assert.equal(ramp(null, 0, 1), null);
});

test("a young, fast-growing, high-fertility country scores 0 (Low)", () => {
  const r = scoreRisk(inputs({ tfr: 5.5, naturalChangeRate: 30, share65: 3, medianAge: 17, change2050Pct: 60, change2100Pct: 150, netMigration: -1000 }));
  assert.equal(r.score, 0);
  assert.equal(r.tier, "Low");
});

test("an extreme shrinking country scores 100 (Critical)", () => {
  const r = scoreRisk(
    inputs({ tfr: 0.7, naturalChangeRate: -9, share65: 32, medianAge: 52, change2050Pct: -30, change2100Pct: -70, naturalChange: -100_000, netMigration: -5_000 }),
  );
  assert.equal(r.score, 100);
  assert.equal(r.tier, "Critical");
  for (const c of Object.values(r.components)) assert.equal(c.value, 1);
});

test("score rises monotonically as fertility falls, other inputs fixed", () => {
  let prev = -1;
  for (const tfr of [2.6, 2.1, 1.8, 1.5, 1.2, 1.0, 0.8]) {
    const s = scoreRisk(inputs({ tfr })).exact;
    assert.ok(s >= prev, `tfr ${tfr}: ${s} >= ${prev}`);
    prev = s;
  }
});

test("score is null (unrankable) when a required input is missing; aging works with one part", () => {
  assert.equal(scoreRisk(inputs({ tfr: null })).score, null);
  assert.equal(scoreRisk(inputs({ change2100Pct: null })).score, null);
  assert.notEqual(scoreRisk(inputs({ share65: null })).score, null);
});

test("migration component: offset share of natural decline, emigration-driven decline, otherwise 0", () => {
  assert.equal(migrationRisk({ naturalChange: -100, netMigration: 100 }), 0);
  assert.equal(migrationRisk({ naturalChange: -100, netMigration: 150 }), 0);
  assert.equal(migrationRisk({ naturalChange: -100, netMigration: 25 }), 0.75);
  assert.equal(migrationRisk({ naturalChange: -100, netMigration: 0 }), 1);
  assert.equal(migrationRisk({ naturalChange: -100, netMigration: -50 }), 1);
  assert.equal(migrationRisk({ naturalChange: 100, netMigration: -300, populationChangePerThousand: -5 }), 0.5);
  assert.equal(migrationRisk({ naturalChange: 100, netMigration: -50, populationChangePerThousand: 1 }), 0);
  assert.equal(migrationRisk({ naturalChange: null, netMigration: 5 }), null);
});

test("tierFor uses the documented thresholds", () => {
  assert.equal(tierFor(70), "Critical");
  assert.equal(tierFor(69), "High");
  assert.equal(tierFor(55), "High");
  assert.equal(tierFor(54), "Elevated");
  assert.equal(tierFor(40), "Elevated");
  assert.equal(tierFor(39), "Moderate");
  assert.equal(tierFor(20), "Moderate");
  assert.equal(tierFor(19), "Low");
  assert.equal(tierFor(null), null);
});

test("plain-English helpers", () => {
  assert.equal(fractionWords(0.748 / 2.1), "about a third");
  assert.equal(fractionWords(0.5), "about half");
  assert.equal(fractionWords(0.1), "less than a fifth");
  assert.equal(people(236_394), "236,000");
  assert.equal(people(87_800), "87,800");
  assert.equal(people(51_748_744), "51.7 million");
  assert.equal(people(343_000_000), "343 million");
  assert.equal(people(8_090_000_000), "8.09 billion");
  assert.equal(people(-20_473), "-20,500");
  assert.equal(people(950), "950");
});

test("riskFactors explain the score in plain English, most important first", () => {
  const rec = {
    tfr: { value: 0.748, year: 2024, source: "WB" },
    share65: { value: 20.3, year: 2025, source: "WB" },
    medianAge: { value: 44.5, year: 2023, source: "UN-WPP" },
    components: {
      year: 2023,
      births: 236_394,
      deaths: 345_503,
      naturalChange: -109_109,
      netMigration: 87_800,
      populationChange: -21_309,
      perThousand: { births: 4.6, deaths: 6.7, naturalChange: -2.1, netMigration: 1.7, populationChange: -0.4 },
      migrationOffsetPct: 80,
    },
    projection: { baseYear: 2023, basePopulation: 51_748_744, population2100: 21_848_795, change2100Pct: -57.8, peakYear: 2020, naturalDeclineSince: 2019 },
    migrantStock: { year: 2024, emigrants: 2_030_473, emigrantsPct: 3.9 },
  };
  const scored = scoreRisk(
    inputs({ tfr: 0.748, naturalChangeRate: -2.3, share65: 20.3, medianAge: 44.5, change2050Pct: -12.8, change2100Pct: -57.8, naturalChange: -109_109, netMigration: 87_800 }),
  );
  const f = riskFactors(rec, scored);
  assert.equal(f[0].id, "fertility");
  assert.equal(f[0].text, "Fertility 0.75 births per woman (2024), about a third of the 2.1 replacement level");
  const text = f.map((x) => x.text);
  assert.ok(text.includes("UN projects a 58% fall by 2100 (51.7 million in 2023 → 21.8 million); peaked in 2020"));
  assert.ok(text.includes("More deaths than births since 2019 (2023: 236,000 births, 346,000 deaths)"));
  assert.ok(text.includes("Immigration offsets only 80% of the natural decline (2023: net +87,800)"));
  assert.ok(text.includes("1 in 5 people is 65 or older (2025); median age 44.5"));
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].points >= f[i].points, "sorted by points");
});
