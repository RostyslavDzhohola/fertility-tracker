// Minimal .xlsx reader (zero dependencies) for the UN DESA International Migrant Stock tables, used by
// scripts/validate-data.mjs. Reads shared strings, inline strings and numbers; ignores styles and formulas.
import { readZip } from "./unwpp.mjs";

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const textOf = (xml) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

/** Column letters -> 0-based index ("A" -> 0, "AA" -> 26). */
export const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Open a workbook: { sheetNames, sheet(name) -> rows (array of arrays of string|number|null) }. */
export function readXlsx(buf) {
  const zip = readZip(buf);
  const file = (name) => {
    const get = zip.get(name);
    if (!get) throw new Error(`xlsx: ${name} missing`);
    return get().toString("utf8");
  };
  const shared = zip.has("xl/sharedStrings.xml") ? [...file("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const rels = new Map([...file("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1]]));
  const sheets = new Map(
    [...file("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => {
      const name = decode(m[0].match(/name="([^"]+)"/)[1]);
      const target = rels.get(m[0].match(/r:id="([^"]+)"/)[1]).replace(/^\/?(xl\/)?/, "");
      return [name, `xl/${target}`];
    }),
  );
  return {
    sheetNames: [...sheets.keys()],
    sheet(name) {
      const path = sheets.get(name);
      if (!path) throw new Error(`xlsx: no sheet ${name}`);
      const rows = [];
      for (const r of file(path).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const at = Number(r[0].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
        const row = [];
        for (const c of (r[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = c[1].match(/\br="([A-Z]+)\d+"/)?.[1];
          const type = c[1].match(/\bt="([^"]+)"/)?.[1];
          const body = c[2] ?? "";
          const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          let value = null;
          if (type === "s") value = v == null ? null : shared[Number(v)];
          else if (type === "inlineStr") value = textOf(body);
          else if (type === "str") value = v == null ? null : decode(v);
          else if (v != null && v !== "") value = Number(v);
          row[ref ? colIndex(ref) : row.length] = value;
        }
        rows[at] = row;
      }
      return rows;
    },
  };
}
