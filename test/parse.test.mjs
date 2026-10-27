import assert from "node:assert/strict";
import { test } from "node:test";
import { csvField, parseCsv, toCsv } from "../scripts/lib/csv.mjs";
import {
  normalizeCode,
  parseCorridorCsv,
  parseMdimChoices,
  parseOwidCsv,
  parseOwidMetadata,
  parseWbCountries,
  parseWbLatest,
} from "../scripts/lib/parse.mjs";

test("parseCsv handles quotes, escaped quotes, CRLF, embedded newlines and BOM", () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",3\r\n"multi\nline",,\n');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["x, y", 'say "hi"', "3"],
    ["multi\nline", "", ""],
  ]);
});

test("toCsv round-trips through parseCsv", () => {
  const text = toCsv(["name", "n", "flag", "none"], [["Korea, Rep.", 1.5, true, null], ['a "q"', -2, false, undefined]]);
  assert.deepEqual(parseCsv(text), [
    ["name", "n", "flag", "none"],
    ["Korea, Rep.", "1.5", "true", ""],
    ['a "q"', "-2", "false", ""],
  ]);
  assert.equal(csvField(Number.NaN), "");
});

test("normalizeCode maps OWID world/Kosovo and drops aggregates", () => {
  assert.equal(normalizeCode("OWID_WRL"), "WLD");
  assert.equal(normalizeCode("OWID_KOS"), "XKX");
  assert.equal(normalizeCode("KOR"), "KOR");
  assert.equal(normalizeCode("OWID_AFR"), null);
  assert.equal(normalizeCode(""), null);
});

const OWID_CSV = [
  "entity,code,year,fertility_rate__sex_all__age_all__variant_estimates,fertility_rate__sex_all__age_all__variant_medium__projected",
  "World,OWID_WRL,2023,2.25,",
  "World,OWID_WRL,2024,,2.24",
  "Kosovo,OWID_KOS,2023,1.5,",
  "Africa,OWID_AFR,2023,4.0,",
  '"Korea, South",KOR,2023,0.72,',
  "Micronesia (country),FSM,2023,,",
  "",
].join("\n");

test("parseOwidCsv matches columns by prefix (OWID appends __projected) and keeps ISO3 + WLD", () => {
  const { entities, found, missing } = parseOwidCsv(OWID_CSV, {
    est: "fertility_rate__sex_all__age_all__variant_estimates",
    proj: "fertility_rate__sex_all__age_all__variant_medium",
  });
  assert.deepEqual(missing, []);
  assert.equal(found.proj, "fertility_rate__sex_all__age_all__variant_medium__projected");
  assert.deepEqual([...entities.keys()].sort(), ["FSM", "KOR", "WLD", "XKX"]);
  assert.deepEqual(entities.get("WLD").years.get(2023), { est: 2.25 });
  assert.deepEqual(entities.get("WLD").years.get(2024), { proj: 2.24 });
  assert.equal(entities.get("KOR").name, "Korea, South");
  assert.equal(entities.get("FSM").name, "Micronesia");
  assert.equal(entities.get("FSM").rawName, "Micronesia (country)");
  assert.equal(entities.get("FSM").years.size, 0, "empty cells produce no year entry");
});

test("parseOwidCsv reports missing columns and rejects foreign headers", () => {
  const { missing } = parseOwidCsv(OWID_CSV, { x: "net_migration__sex_all" });
  assert.deepEqual(missing, ["x"]);
  assert.throws(() => parseOwidCsv("a,b\n1,2\n", {}), /Unexpected OWID CSV header/);
});

test("parseWbLatest keeps the newest non-null value per ISO3 and skips aggregates without iso3", () => {
  const json = [
    { page: 1, lastupdated: "2026-10-08" },
    [
      { countryiso3code: "KOR", date: "2023", value: 0.72, indicator: { value: "Fertility rate" } },
      { countryiso3code: "KOR", date: "2024", value: 0.748 },
      { countryiso3code: "KOR", date: "2025", value: null },
      { countryiso3code: "", date: "2024", value: 9 },
    ],
  ];
  const { values, lastUpdated, indicatorName } = parseWbLatest(json);
  assert.deepEqual(values.get("KOR"), { value: 0.748, year: 2024 });
  assert.equal(values.size, 1);
  assert.equal(lastUpdated, "2026-10-08");
  assert.equal(indicatorName, "Fertility rate");
  assert.throws(() => parseWbLatest([{ message: [{ key: "Invalid value" }] }]), /Unexpected World Bank response/);
});

test("parseWbCountries extracts region and income, nulls 'Not classified' and aggregates", () => {
  const m = parseWbCountries([
    {},
    [
      { id: "KOR", iso2Code: "KR", name: "Korea, Rep.", region: { value: "East Asia & Pacific" }, incomeLevel: { value: "High income" } },
      { id: "VEN", iso2Code: "VE", name: "Venezuela", region: { value: "Latin America & Caribbean " }, incomeLevel: { value: "Not classified" } },
      { id: "EAS", iso2Code: "Z4", name: "East Asia", region: { value: "Aggregates" }, incomeLevel: { value: "Aggregates" } },
    ],
  ]);
  assert.deepEqual(m.get("KOR"), { name: "Korea, Rep.", region: "East Asia & Pacific", incomeGroup: "High income", iso2: "KR", aggregate: false });
  assert.equal(m.get("VEN").incomeGroup, null);
  assert.equal(m.get("VEN").region, "Latin America & Caribbean");
  assert.equal(m.get("EAS").aggregate, true);
});

test("parseCorridorCsv returns top partner countries for the latest year, excluding aggregates and self", () => {
  const csv = [
    "entity,code,year,migrants__country_select_south_korea__metric_immigrants__gender_all",
    "World,OWID_WRL,2024,1811507",
    "Asia,OWID_ASI,2024,1537421",
    "Eastern Asia (UN),,2024,802382",
    "China,CHN,2024,756684",
    "China,CHN,2020,700000",
    "Vietnam,VNM,2024,260609",
    "South Korea,KOR,2024,5",
    "Nowhere,NWH,2024,0",
  ].join("\n");
  const r = parseCorridorCsv(csv, "KOR", { top: 10 });
  assert.equal(r.year, 2024);
  assert.equal(r.total, 1811507);
  assert.deepEqual(r.partners, [
    { iso3: "CHN", name: "China", people: 756684 },
    { iso3: "VNM", name: "Vietnam", people: 260609 },
  ]);
});

test("parseMdimChoices reads dimension choices embedded in a chart page", () => {
  const html = `<script>{"dimensions": [ { "name": "Country", "slug": "country_select", "choices": [ { "name": "Afghanistan", "slug": "afghanistan" }, { "name": "Micronesia (country)", "slug": "micronesia__country" } ] }, { "slug": "metric", "choices": [] } ]}</script>`;
  assert.deepEqual(parseMdimChoices(html, "country_select"), [
    { slug: "afghanistan", name: "Afghanistan" },
    { slug: "micronesia__country", name: "Micronesia (country)" },
  ]);
  assert.equal(parseMdimChoices("<html></html>", "country_select"), null);
});

test("parseOwidMetadata picks the newest lastUpdated and ignores the OWID region column", () => {
  const v = parseOwidMetadata({
    columns: {
      a: { titleShort: "Population", lastUpdated: "2024-07-12", nextUpdate: "2027-07-12", timespan: "1950-2023", citationShort: "UN WPP 2024" },
      b: { titleShort: "Population", lastUpdated: "2024-07-12", timespan: "2024-2100" },
      c: { titleShort: "World region according to OWID", lastUpdated: "2023-01-01" },
    },
  });
  assert.deepEqual(v, { lastUpdated: "2024-07-12", nextUpdate: "2027-07-12", citation: "UN WPP 2024", timespan: "1950-2023, 2024-2100" });
});
