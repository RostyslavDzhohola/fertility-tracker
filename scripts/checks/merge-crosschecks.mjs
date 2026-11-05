#!/usr/bin/env node
// Merge verified hand-checked notes into scripts/data/crosschecks.json (docs/CROSS-CHECK-PROCESS.md, steps 2 and 3).
//
//   node scripts/checks/merge-crosschecks.mjs --research <dir> --verify <dir> [--dry-run]
//
// <research>/{ISO3}.json: the researchers' files. <verify>/{ISO3}.json: the independent check, one entry per check
// ({ index, ok, fix }). Only checks the verifier passed (ok: true) and the researcher marked "verified" are merged, with
// the verifier's fixes applied. A merged country's previous notes are replaced; other countries are left alone.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEYS = ["today", "census", "births", "deaths", "immigrants", "net"];
const VERDICTS = ["matches", "un-higher", "un-lower", "context"];
const FIELDS = ["key", "text", "figure", "unFigure", "verdict", "links", "quotes", "accessed"];

/** Problems with one note as it would be published (empty = fine). */
export function noteProblems(n) {
  const out = [];
  if (!KEYS.includes(n.key)) out.push(`key "${n.key}"`);
  if (!VERDICTS.includes(n.verdict)) out.push(`verdict "${n.verdict}"`);
  if (typeof n.text !== "string" || !n.text.trim()) out.push("no text");
  else if (n.text.split(/\s+/).length > 80) out.push(`text has ${n.text.split(/\s+/).length} words`);
  if (!Array.isArray(n.links) || !n.links.length || n.links.some((l) => !/^https?:\/\//.test(l?.href ?? "") || !l.label)) out.push("links");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.accessed ?? "")) out.push("accessed date");
  for (const f of ["figure", "unFigure"]) if (n[f] != null && (typeof n[f].what !== "string" || n[f].date == null)) out.push(f);
  // "UN higher" means the UN's number is the bigger one, also for losses: −24,230 is higher than −28,531.
  const [other, un] = [n.figure?.value, n.unFigure?.value];
  if (Number.isFinite(other) && Number.isFinite(un) && ((n.verdict === "un-higher" && !(un > other)) || (n.verdict === "un-lower" && !(un < other))))
    out.push(`verdict "${n.verdict}" but the UN's ${un} vs ${other}`);
  return out;
}

/**
 * One country's notes to publish: the research checks the verifier passed, with its fixes. Returns { notes, dropped }.
 * research: the researcher's file; verify: the verifier's file (null = nothing verified, nothing merged).
 */
export function mergeCountry(research, verify) {
  const notes = [];
  const dropped = [];
  (research.checks ?? []).forEach((c, index) => {
    const v = verify?.checks?.find((x) => x.index === index);
    if (!v) return dropped.push({ index, key: c.key, why: "not verified" });
    if (!v.ok) return dropped.push({ index, key: c.key, why: (v.problems ?? []).join("; ") || "verifier said no" });
    if (c.confidence !== "verified" && !v.fix) return dropped.push({ index, key: c.key, why: "researcher could not open the source" });
    const merged = { ...c, ...(v.fix ?? {}), accessed: research.researched };
    const note = Object.fromEntries(FIELDS.map((f) => [f, merged[f] ?? null]));
    note.quotes ??= [];
    for (const f of ["figure", "unFigure"]) if (note[f]) note[f] = { value: note[f].value ?? null, what: note[f].what, date: String(note[f].date ?? "") };
    const problems = noteProblems(note);
    if (problems.length) return dropped.push({ index, key: c.key, why: `invalid: ${problems.join(", ")}` });
    notes.push(note);
  });
  return { notes, dropped };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const research = opt("--research");
  const verify = opt("--verify");
  if (!research || !verify) {
    console.error("usage: merge-crosschecks.mjs --research <dir> --verify <dir> [--dry-run]");
    process.exit(2);
  }
  const target = fileURLToPath(new URL("../data/crosschecks.json", import.meta.url));
  const data = JSON.parse(await readFile(target, "utf8"));
  const readJson = (p) => readFile(p, "utf8").then(JSON.parse, () => null);
  let added = 0;
  for (const f of (await readdir(resolve(research))).filter((x) => /^[A-Z]{3}\.json$/.test(x)).sort()) {
    const r = await readJson(join(resolve(research), f));
    const v = await readJson(join(resolve(verify), f));
    const { notes, dropped } = mergeCountry(r, v);
    console.log(`${r.iso3}: ${notes.length} merged${dropped.length ? `, ${dropped.length} dropped (${dropped.map((d) => `${d.key}: ${d.why}`).join(" | ")})` : ""}`);
    if (notes.length) {
      data.places[r.iso3] = notes;
      added += notes.length;
    }
  }
  data.places = Object.fromEntries(Object.entries(data.places).sort(([a], [b]) => a.localeCompare(b)));
  data.checked = new Date().toISOString().slice(0, 10);
  if (args.includes("--dry-run")) return console.log(`dry run: ${added} notes would be merged`);
  await writeFile(target, JSON.stringify(data, null, 2) + "\n");
  console.log(`${added} notes merged into scripts/data/crosschecks.json (${Object.keys(data.places).length} places).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
