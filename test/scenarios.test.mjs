// scenarios.json: contract shape (DESIGN-v3 §7), schema, manifest entries, regression guards and --verify.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildDataset } from "../scripts/lib/build.mjs";
import { API_DIR, finalize, renderFiles, writeFiles } from "../scripts/lib/publish.mjs";
import { sanityCheck, scenarioChecks } from "../scripts/lib/sanity.mjs";
import { openapi, schemas, validate } from "../scripts/lib/schema.mjs";
import { fixtureManifest, fixtureRaw } from "./helpers/fixture.mjs";

const render = (raw = fixtureRaw()) => finalize(renderFiles(buildDataset(raw), fixtureManifest()), { now: new Date("2026-01-01T00:00:00Z") }).files;
const json = (files, path) => JSON.parse(files.get(`${API_DIR}/${path}`));

test("scenarios.json keeps the frontend contract: keys, labels, one integer per year for every record", () => {
  const files = render();
  const sc = json(files, "scenarios.json");
  assert.deepEqual(validate(schemas()["scenarios.schema.json"], sc), []);
  assert.equal(sc.apiVersion, "v1");
  assert.equal(sc.unit, "people");
  assert.equal(sc.startYear, 2024);
  assert.equal(sc.endYear, 2100);
  assert.deepEqual(
    Object.fromEntries(Object.entries(sc.scenarios).map(([k, v]) => [k, [v.label, v.unVariant]])),
    { medium: ["UN forecast", "Medium"], constant: ["If birth rates stay the same", "Constant fertility"] },
  );
  assert.match(sc.scenarios.constant.description, /2023 level/);
  assert.match(sc.scenarios.constant.unDefinition, /remain constant/);
  const codes = json(files, "countries.json").countries.map((c) => c.iso3);
  assert.deepEqual(Object.keys(sc.places), codes, "every record, WLD included, sorted like countries.json");
  for (const [code, p] of Object.entries(sc.places)) {
    assert.deepEqual(Object.keys(p), ["medium", "constant"], code);
    for (const k of ["medium", "constant"]) {
      assert.equal(p[k].length, 77, `${code} ${k}`);
      assert.ok(p[k].every(Number.isInteger), `${code} ${k} integers`);
    }
  }
  const shr = json(files, "countries/SHR.json");
  assert.equal(sc.places.SHR.medium[2050 - 2024], shr.series.find((r) => r.year === 2050).population, "medium = the series projection");
  assert.equal(sc.source.id, "UN-WPP");
  assert.ok(sc.source.url.endsWith("WPP2024_TotalPopulationBySex.csv.gz"));
  assert.equal(sc.source.interimUpdate.released, "2026-01-19");
});

test("index.json, openapi.json and the country links know about scenarios.json and the clean site URLs", () => {
  const files = render();
  const index = json(files, "index.json");
  const ep = index.endpoints.find((e) => e.path === "scenarios.json");
  assert.ok(ep, "listed in endpoints");
  assert.match(ep.schema, /schema\/scenarios\.schema\.json$/);
  assert.match(index.links.scenarios, /api\/v1\/scenarios\.json$/);
  assert.deepEqual(validate(schemas()["index.schema.json"], index), []);
  assert.ok(openapi().paths["/scenarios.json"]);
  assert.ok(files.has(`${API_DIR}/schema/scenarios.schema.json`));
  assert.equal(json(files, "countries/SHR.json").links.site, "https://fertility-tracker-live.vercel.app/country/SHR");
  const wpp = index.sources.find((s) => s.id === "UN-WPP");
  assert.equal(wpp.nextUpdate, "2027-07-11");
  assert.equal(wpp.interimUpdate.released, "2026-01-19");
  assert.match(wpp.via, /population\.un\.org/);
});

test("no scenario data on a first build: no file and no endpoint (and no guard error)", () => {
  const raw = fixtureRaw();
  raw.scenarios = null;
  const ds = buildDataset(raw);
  assert.equal(ds.scenarios, null);
  assert.deepEqual(scenarioChecks(ds, null), []);
  const files = finalize(renderFiles(ds, fixtureManifest())).files;
  assert.equal(files.has(`${API_DIR}/scenarios.json`), false);
  assert.equal(json(files, "index.json").endpoints.some((e) => e.path === "scenarios.json"), false);
});

test("scenario guards: a clean build passes; coverage loss, shrinking years and inconsistent paths are refused", () => {
  const good = buildDataset(fixtureRaw());
  assert.deepEqual(scenarioChecks(good, null), []);
  const previous = json(render(), "scenarios.json");
  assert.deepEqual(scenarioChecks(good, previous), []);

  const withScenarios = (edit) => {
    const raw = fixtureRaw();
    edit(raw.scenarios);
    return buildDataset(raw);
  };
  // A place disappears (e.g. the UN file lost a row).
  const dropped = withScenarios((s) => s.places.delete("GRO"));
  assert.deepEqual(scenarioChecks(dropped, previous), ["scenarios.json: GRO (Growland) missing", "scenarios.json: GRO would be dropped (it was published before)"]);
  // The year range shrinks.
  const shorter = withScenarios((s) => {
    s.endYear = 2090;
    for (const p of s.places.values()) for (const k of ["medium", "constant"]) p[k] = p[k].slice(0, 67);
  });
  assert.ok(scenarioChecks(shorter, previous).includes("scenarios.json: year range would shrink from 2024-2100 to 2024-2090"));
  // Values go missing.
  const holes = withScenarios((s) => (s.places.get("SHR").constant[10] = null));
  const errs = scenarioChecks(holes, previous);
  assert.ok(errs.includes("scenarios.json: SHR constant has missing or invalid values"), errs.join("\n"));
  assert.ok(errs.includes("scenarios.json: SHR constant would lose values (77 -> 76)"), errs.join("\n"));
  // A stale overlay (Togo's superseded figures: 13% too high) no longer matches the series.
  const stale = withScenarios((s) => {
    const p = s.places.get("SHR");
    p.medium = p.medium.map((v) => Math.round(v * 1.13));
  });
  const e2 = scenarioChecks(stale, previous);
  assert.ok(e2.some((e) => /^scenarios\.json: SHR medium differs from the series population in 77 years/.test(e)), e2.join("\n"));
  assert.ok(e2.some((e) => /^scenarios\.json: SHR constant starts .* \(scenarios must share the same base population\)/.test(e)), e2.join("\n"));
  // sanityCheck (the write gate) includes them, and a build that lost scenarios entirely is refused too.
  assert.ok(sanityCheck(stale, { scenarios: previous }).some((e) => /SHR medium differs/.test(e)));
  const none = buildDataset({ ...fixtureRaw(), scenarios: null });
  assert.deepEqual(scenarioChecks(none, previous), ["scenarios.json: no scenario data in this build (it was published before)"]);
});

test("--verify requires scenarios.json once index.json lists it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ft-scen-"));
  try {
    const files = render();
    // The fixture has only 4 records; --verify needs 200, so check just the scenarios-specific errors.
    await writeFiles(dir, files);
    const script = fileURLToPath(new URL("../scripts/fetch-data.mjs", import.meta.url));
    const run = () => spawnSync(process.execPath, [script, "--verify", "--out", dir], { encoding: "utf8" });
    assert.doesNotMatch(run().stderr, /scenarios\.json/);
    await rm(join(dir, API_DIR, "scenarios.json"));
    assert.match(run().stderr, /missing scenarios\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
