import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSchema } from "../../scripts/checks/lib/json-schema.mjs";

const schema = {
  type: "object",
  required: ["iso3", "count", "items"],
  properties: {
    iso3: { type: "string", pattern: "^[A-Z]{3}$" },
    count: { type: "integer", minimum: 0, maximum: 300 },
    share: { type: ["number", "null"], minimum: 0, maximum: 1 },
    tier: { type: "string", enum: ["low", "high"] },
    api: { type: "string", const: "v1" },
    at: { type: "string", format: "date-time" },
    items: { type: "array", minItems: 1, maxItems: 2, items: { $ref: "#/$defs/item" } },
    names: { type: "object", additionalProperties: { type: "string" } },
  },
  additionalProperties: false,
  $defs: { item: { type: "object", required: ["id"], properties: { id: { type: "integer" } } } },
};

test("validateSchema accepts a conforming document", () => {
  const ok = { iso3: "JPN", count: 3, share: null, tier: "low", api: "v1", at: "2026-10-26T06:21:00Z", items: [{ id: 1 }], names: { a: "x" } };
  assert.deepEqual(validateSchema(schema, ok), []);
  assert.deepEqual(validateSchema(schema, { ...ok, share: 0.5, count: 0 }), []);
});

test("validateSchema reports each kind of violation with a path", () => {
  const errors = (doc) => validateSchema(schema, doc, { max: 20 });
  assert.deepEqual(errors({ oops: true }), ['$: missing required "iso3"', '$: missing required "count"', '$: missing required "items"', '$: unexpected property "oops"']);
  const base = { iso3: "JPN", count: 3, items: [{ id: 1 }] };
  assert.match(errors({ ...base, iso3: "jp" })[0], /\$\.iso3: does not match/);
  assert.match(errors({ ...base, count: 1.5 })[0], /\$\.count: expected integer, got number/);
  assert.match(errors({ ...base, count: 301 })[0], /maximum 300/);
  assert.match(errors({ ...base, share: "x" })[0], /\$\.share: expected number or null/);
  assert.match(errors({ ...base, tier: "mid" })[0], /is not one of/);
  assert.match(errors({ ...base, api: "v2" })[0], /expected "v1"/);
  assert.match(errors({ ...base, at: "yesterday" })[0], /date-time/);
  assert.match(errors({ ...base, items: [] })[0], /fewer than 1 items/);
  assert.match(errors({ ...base, items: [{ id: 1 }, { id: 2 }, { id: 3 }] })[0], /more than 2 items/);
  assert.match(errors({ ...base, items: [{ id: "a" }] })[0], /\$\.items\[0\]\.id: expected integer/);
  assert.match(errors({ ...base, names: { a: 1 } })[0], /\$\.names\.a: expected string/);
  assert.equal(validateSchema(schema, { oops: true }, { max: 2 }).length, 2);
});
