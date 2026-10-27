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
