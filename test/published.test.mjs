// Checks the committed output in public/api/v1 (skipped when it has not been generated yet).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { schemas, validate } from "../scripts/lib/schema.mjs";

const API = new URL("../public/api/v1/", import.meta.url);
const has = existsSync(new URL("countries.json", API));
const read = (p) => JSON.parse(readFileSync(new URL(p, API), "utf8"));

test("published countries.json and risk.json match their schemas and look sane", { skip: !has && "no published output yet" }, () => {
  const s = schemas();
  const countries = read("countries.json");
  assert.deepEqual(validate(s["countries.schema.json"], countries), []);
  assert.deepEqual(validate(s["risk.schema.json"], read("risk.json")), []);
  assert.deepEqual(validate(s["index.schema.json"], read("index.json")), []);
  const by = new Map(countries.countries.map((c) => [c.iso3, c]));
  assert.ok(by.size >= 200);
  assert.ok(by.get("KOR").tfr.value < 1.3);
  assert.ok(["Critical", "High"].includes(by.get("KOR").risk.tier));
  assert.equal(by.get("NER").risk.tier, "Low");
  assert.equal(by.get("WLD").risk.rank, null);
});

test("published country files match the detail schema", { skip: !has && "no published output yet" }, () => {
  const s = schemas()["country.schema.json"];
  for (const code of ["KOR", "JPN", "UKR", "NGA", "TWN", "WLD", "XKX"]) assert.deepEqual(validate(s, read(`countries/${code}.json`)), [], code);
});

const hasScenarios = existsSync(new URL("scenarios.json", API));

test("published scenarios.json matches its schema and the frontend contract", { skip: !hasScenarios && "no scenarios.json yet" }, () => {
  const sc = read("scenarios.json");
  assert.deepEqual(validate(schemas()["scenarios.schema.json"], sc), []);
  assert.equal(sc.scenarios.medium.label, "UN forecast");
  assert.equal(sc.scenarios.constant.label, "If birth rates stay the same");
  const n = sc.endYear - sc.startYear + 1;
  assert.equal(sc.startYear, 2024);
  assert.equal(sc.endYear, 2100);
  for (const c of read("countries.json").countries) {
    const p = sc.places[c.iso3];
    assert.ok(p, `${c.iso3} in scenarios.json`);
    assert.equal(p.medium.length, n, c.iso3);
    assert.equal(p.constant.length, n, c.iso3);
  }
  // Togo uses the UN's 2026 interim update (about 8.4 million in 2024, not the superseded 9.5 million).
  assert.ok(sc.places.TGO.medium[0] < 8.6e6 && sc.places.TGO.medium[0] > 8.2e6, `TGO ${sc.places.TGO.medium[0]}`);
  assert.ok(Math.abs(sc.places.TGO.constant[0] / sc.places.TGO.medium[0] - 1) < 0.01, "both scenarios start from the same Togo population");
  assert.deepEqual(sc.adjustments.map((a) => a.iso3), ["TGO"]);
});

test("published series are the UN's own numbers (Togo interim update, 65+ includes 100+, Hong Kong net migration)", { skip: !has && "no published output yet" }, () => {
  const tgo = read("countries/TGO.json").series.find((r) => r.year === 2023);
  assert.ok(tgo.population < 8.3e6 && tgo.population > 8.1e6, `TGO 2023 ${tgo.population}`);
  // Our World in Data's 65+ stopped at 99: Hong Kong 2100 was 56.5%; the UN's 65+ including 100+ is 61%.
  assert.ok(read("countries/HKG.json").series.find((r) => r.year === 2100).share65 > 60);
  // Tokelau had 2 deaths in 2023 in the single-age sums; the UN file says 14.
  assert.equal(read("countries/TKL.json").series.find((r) => r.year === 2023).deaths, 14);
  // The UN file itself repeats Hong Kong's 2021-2023 net migration (-3,427): kept as published by the UN.
  assert.deepEqual(read("countries/HKG.json").series.filter((r) => r.year >= 2021 && r.year <= 2023).map((r) => r.netMigration), [-3427, -3427, -3427]);
  assert.match(read("countries/KOR.json").links.site, /\/country\/KOR$/);
});
