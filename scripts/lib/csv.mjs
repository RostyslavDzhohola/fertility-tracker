// Minimal RFC 4180 CSV reader/writer (quoted fields, escaped quotes, CRLF, embedded newlines).

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse CSV into { header, rows } where rows are arrays; drops fully empty lines. */
export function readTable(text) {
  const [header = [], ...rows] = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
  return { header, rows };
}

export function csvField(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  const lines = [header.map(csvField).join(",")];
  for (const r of rows) lines.push(r.map(csvField).join(","));
  return lines.join("\n") + "\n";
}
