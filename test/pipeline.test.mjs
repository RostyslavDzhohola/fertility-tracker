import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildDataset } from "../scripts/lib/build.mjs";
import { parseCsv } from "../scripts/lib/csv.mjs";
import { API_DIR, finalize, renderFiles, writeFiles } from "../scripts/lib/publish.mjs";
import { sanityCheck } from "../scripts/lib/sanity.mjs";
import { schemas, validate } from "../scripts/lib/schema.mjs";
import { fixtureManifest, fixtureRaw } from "./helpers/fixture.mjs";

const build = () => buildDataset(fixtureRaw());

test("buildDataset: provenance, ranking eligibility and risk ordering", () => {
  const ds = build();
  const by = new Map(ds.full.map((r) => [r.iso3, r]));
  const shr = by.get("SHR");
  assert.deepEqual(shr.tfr, { value: 0.75, year: 2024, source: "WB" }, "newer World Bank value wins");
  assert.equal(shr.medianAge.source, "UN-WPP");
  assert.deepEqual(shr.naturalChangeRate, { value: -8.1, year: 2024, source: "WB" }, "WB birth - death rate");
  assert.equal(by.get("GRO").tfr.source, "UN-WPP", "UN fallback when the World Bank has no value");
  assert.equal(shr.components.year, 2023);
  assert.equal(shr.components.populationChange, shr.components.births - shr.components.deaths + shr.components.netMigration);
  assert.equal(shr.migrantStock.emigrants, 2_600_000);
  assert.equal(shr.region, "Europe & Central Asia");

  assert.equal(by.get("TNY").ranked, false);
  assert.ok(by.get("TNY").flags.includes("small-population"));
  assert.equal(by.get("WLD").ranked, false);
  assert.equal(by.get("WLD").risk.rank, null);
  assert.deepEqual(ds.ranking.map((r) => r.iso3), ["SHR", "GRO"]);
  assert.equal(shr.risk.rank, 1);
  assert.ok(shr.risk.score > 70 && shr.risk.tier === "Critical", `SHR ${shr.risk.score}`);
  assert.equal(by.get("GRO").risk.tier, "Low");
  assert.ok(ds.records.find((r) => r.iso3 === "SHR").risk.factors.length <= 3, "summary keeps top 3 factors");
  assert.ok(ds.details.get("SHR").risk.factors.length > 3);
  assert.equal(ds.details.get("SHR").migrationCorridors.topOrigins[0].iso3, "GRO");
});

test("sanityCheck rejects a dataset that is too small or inconsistent", () => {
  const ds = build();
  const errors = sanityCheck(ds);
  assert.ok(errors.some((e) => /only 4 records/.test(e)));
  assert.ok(errors.some((e) => /spot check failed/.test(e)));
  ds.full[0].components.naturalChange += 1;
  assert.ok(sanityCheck(ds).some((e) => /naturalChange != births - deaths/.test(e)));
});

test("rendered files match their JSON Schemas", () => {
  const { files } = finalize(renderFiles(build(), fixtureManifest()), { now: new Date("2026-01-01T00:00:00Z") });
  const s = schemas();
  const check = (path, schema) => assert.deepEqual(validate(s[schema], JSON.parse(files.get(`${API_DIR}/${path}`))), [], path);
  check("index.json", "index.schema.json");
  check("countries.json", "countries.schema.json");
  check("risk.json", "risk.schema.json");
  for (const c of ["SHR", "GRO", "TNY", "WLD"]) check(`countries/${c}.json`, "country.schema.json");
  const countries = JSON.parse(files.get(`${API_DIR}/countries.json`)).countries;
  for (const r of countries) for (const k of ["iso3", "name", "region"]) assert.ok(r[k], `${r.iso3} has ${k}`);
});

test("validator catches schema violations", () => {
  const { files } = finalize(renderFiles(build(), fixtureManifest()));
  const data = JSON.parse(files.get(`${API_DIR}/countries.json`));
  data.countries[0].tfr.value = "1.2";
  delete data.countries[1].region;
  data.countries[2].extra = 1;
  const errors = validate(schemas()["countries.schema.json"], data);
  assert.ok(errors.some((e) => /tfr\.value: expected number, got string/.test(e)));
  assert.ok(errors.some((e) => /missing region/.test(e)));
  assert.ok(errors.some((e) => /unexpected property extra/.test(e)));
});

test("CSV outputs: flat countries.csv and long-format timeseries.csv", () => {
  const { files } = finalize(renderFiles(build(), fixtureManifest()));
  const [h, ...rows] = parseCsv(files.get(`${API_DIR}/countries.csv`)).filter((r) => r.length > 1);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.length === h.length));
  const shr = rows.find((r) => r[0] === "SHR");
  assert.equal(shr[h.indexOf("risk_rank")], "1");
  assert.equal(shr[h.indexOf("tfr_source")], "WB");
  const [th, ...ts] = parseCsv(files.get(`${API_DIR}/timeseries.csv`)).filter((r) => r.length > 1);
  assert.deepEqual(th, ["iso3", "year", "variant", "metric", "value"]);
  const pick = (metric, year) => ts.find((r) => r[0] === "SHR" && r[3] === metric && r[1] === String(year));
  assert.equal(pick("births", 2023)[2], "estimate");
  assert.equal(pick("births", 2050)[2], "projection");
  assert.equal(pick("emigrants", 2024)[4], "2600000");
  assert.ok(ts.every((r) => r[4] !== ""), "no empty values");
});

test("idempotent output: same input => same bytes, and generatedAt only moves when numbers change", () => {
  const a = finalize(renderFiles(build(), fixtureManifest()), { now: new Date("2026-01-01T00:00:00Z") });
  const index = JSON.parse(a.files.get(`${API_DIR}/index.json`));
  assert.equal(index.generatedAt, "2026-01-01T00:00:00Z");
  assert.equal(index.contentHash, a.contentHash);

  const b = finalize(renderFiles(build(), fixtureManifest()), { previousIndex: index, now: new Date("2026-02-01T00:00:00Z") });
  assert.equal(b.unchanged, true);
  assert.equal(b.generatedAt, "2026-01-01T00:00:00Z");
  for (const [path, content] of a.files) assert.equal(b.files.get(path), content, path);

  const raw = fixtureRaw();
  raw.wb.latest.tfr.set("SHR", { value: 0.74, year: 2024 });
  const c = finalize(renderFiles(buildDataset(raw), fixtureManifest()), { previousIndex: index, now: new Date("2026-02-01T00:00:00Z") });
  assert.equal(c.unchanged, false);
  assert.equal(c.generatedAt, "2026-02-01T00:00:00Z");
  assert.notEqual(c.contentHash, a.contentHash);
});

test("writeFiles writes only changed files and prunes stale country files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ft-"));
  try {
    const { files } = finalize(renderFiles(build(), fixtureManifest()));
    const first = await writeFiles(dir, files);
    assert.equal(first.written, files.size);
    await writeFile(join(dir, API_DIR, "countries", "OLD.json"), "{}");
    const second = await writeFiles(dir, files);
    assert.deepEqual(second, { written: 0, same: files.size, removed: 1 });
    assert.deepEqual((await readdir(join(dir, API_DIR, "countries"))).sort(), ["GRO.json", "SHR.json", "TNY.json", "WLD.json"]);
    assert.equal(await readFile(join(dir, API_DIR, "countries.json"), "utf8"), files.get(`${API_DIR}/countries.json`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sourceDecision: never regress good data, degrade gracefully for sources that never worked", async () => {
  const { sourceDecision } = await import("../scripts/lib/sanity.mjs");
  const ok = (id, required = false) => ({ id, required, status: "ok" });
  const down = (id, required = false) => ({ id, required, status: "unavailable", error: "HTTP 503" });
  const prev = { sources: [{ datasets: [{ id: "medianAge", status: "ok" }, { id: "emigrants", status: "unavailable" }] }] };

  assert.equal(sourceDecision([ok("population", true), ok("medianAge")], prev).publish, true);
  const req = sourceDecision([down("population", true)], prev, { force: true });
  assert.equal(req.publish, false, "required sources block even with --force");
  const regress = sourceDecision([ok("population", true), down("medianAge")], prev);
  assert.equal(regress.publish, false, "a source that worked last time blocks publishing");
  assert.match(regress.problems[0], /worked in the last build/);
  assert.equal(sourceDecision([down("medianAge")], prev, { force: true }).publish, true, "--force overrides a regression");
  const gap = sourceDecision([down("emigrants")], prev);
  assert.equal(gap.publish, true, "never-worked source: publish with nulls");
  assert.equal(gap.warnings.length, 1);
  assert.equal(sourceDecision([down("countries")], null).publish, false, "World Bank country list is required");
  assert.equal(sourceDecision([down("netMigration")], null).publish, true, "first build: optional source may be missing");
});
