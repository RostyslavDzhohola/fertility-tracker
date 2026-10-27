// Zero-dependency validator for the JSON Schema (2020-12) subset the published api/v1/schema/*.json files use:
// $ref (local "#/..."), type (incl. ["number","null"] unions), const, enum, required, properties,
// additionalProperties (false or a schema), items, minItems, maxItems, minimum, maximum, exclusiveMinimum,
// exclusiveMaximum, minLength, maxLength, pattern, format (date-time, date). Other keywords are annotations
// and are ignored. Returns a list of "path: message" strings, capped at `max`.

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  return type === actual || (type === "number" && actual === "integer");
}

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#")) throw new Error(`only local $ref is supported, got ${ref}`);
  return ref
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((node, key) => (node == null ? undefined : node[key]), root);
}

export function validateSchema(schema, data, { max = 10 } = {}) {
  const errors = [];
  const patterns = new Map();
  const visit = (s, v, path) => {
    if (errors.length >= max || s === true || s == null) return;
    if (s === false) return void errors.push(`${path}: not allowed`);
    if (s.$ref) {
      const target = resolveRef(schema, s.$ref);
      if (!target) return void errors.push(`${path}: unresolvable $ref ${s.$ref}`);
      visit(target, v, path);
    }
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => matchesType(v, t))) return void errors.push(`${path}: expected ${types.join(" or ")}, got ${typeOf(v)}`);
    }
    if ("const" in s && !equal(v, s.const)) errors.push(`${path}: expected ${JSON.stringify(s.const)}`);
    if (Array.isArray(s.enum) && !s.enum.some((e) => equal(v, e))) errors.push(`${path}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`);
    if (typeof v === "number") {
      if (typeof s.minimum === "number" && v < s.minimum) errors.push(`${path}: ${v} < minimum ${s.minimum}`);
      if (typeof s.maximum === "number" && v > s.maximum) errors.push(`${path}: ${v} > maximum ${s.maximum}`);
      if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) errors.push(`${path}: ${v} <= exclusiveMinimum ${s.exclusiveMinimum}`);
      if (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) errors.push(`${path}: ${v} >= exclusiveMaximum ${s.exclusiveMaximum}`);
    }
    if (typeof v === "string") {
      if (typeof s.minLength === "number" && [...v].length < s.minLength) errors.push(`${path}: shorter than ${s.minLength}`);
      if (typeof s.maxLength === "number" && [...v].length > s.maxLength) errors.push(`${path}: longer than ${s.maxLength}`);
      if (typeof s.pattern === "string") {
        if (!patterns.has(s.pattern)) patterns.set(s.pattern, new RegExp(s.pattern, "u"));
        if (!patterns.get(s.pattern).test(v)) errors.push(`${path}: does not match ${s.pattern}`);
      }
      if (s.format === "date-time" && (!DATE_TIME_RE.test(v) || Number.isNaN(Date.parse(v)))) errors.push(`${path}: not an RFC 3339 date-time`);
      if (s.format === "date" && (!DATE_RE.test(v) || Number.isNaN(Date.parse(v)))) errors.push(`${path}: not a date`);
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === "number" && v.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
      if (typeof s.maxItems === "number" && v.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
      if (s.items !== undefined && typeof s.items === "object") v.forEach((item, i) => visit(s.items, item, `${path}[${i}]`));
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const key of s.required ?? []) if (!(key in v)) errors.push(`${path}: missing required "${key}"`);
      const props = s.properties ?? {};
      for (const [key, value] of Object.entries(v)) {
        if (Object.hasOwn(props, key)) visit(props[key], value, `${path}.${key}`);
        else if (s.additionalProperties === false) errors.push(`${path}: unexpected property "${key}"`);
        else if (s.additionalProperties && typeof s.additionalProperties === "object") visit(s.additionalProperties, value, `${path}.${key}`);
      }
    }
  };
  visit(schema, data, "$");
  return errors.slice(0, max);
}
