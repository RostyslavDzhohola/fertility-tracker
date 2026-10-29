#!/usr/bin/env node
// Which places to hand-check next (docs/CROSS-CHECK-PROCESS.md): the published records, weakest and biggest first,
// skipping places whose notes in scripts/data/crosschecks.json are still fresh.
//
//   node scripts/checks/crosscheck-queue.mjs            the next 8 places, with the reasons
//   node scripts/checks/crosscheck-queue.mjs --n 20 --json
//   options: --api <dir> (default public/api/v1)  --fresh-days <n> (default 180)  --min-pop <n> (default 100000)
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const API = resolve(opt("--api", join(ROOT, "public/api/v1")));
const N = Number(opt("--n", 8));
const FRESH_DAYS = Number(opt("--fresh-days", 180));
const MIN_POP = Number(opt("--min-pop", 100_000));

const LEVEL_POINTS = { poor: 3, fair: 2, good: 0 };

/**
 * Score one place: weak data and large automatic gaps first, bigger populations before smaller ones.
 * detail: countries/{ISO3}.json. Returns { score, reasons }.
 */
export function queueScore(detail, { now = new Date(), freshDays = FRESH_DAYS } = {}) {
  const c = detail.confidence;
  const reasons = [];
  let score = 0;
  for (const part of ["today", "birthsDeaths", "immigration"]) {
    const l = c?.[part]?.level;
    if (l === "poor" || l === "fair") {
      score += LEVEL_POINTS[l];
      reasons.push(`${part} ${l}`);
    }
  }
  const auto = (detail.crossChecks ?? []).filter((x) => x.kind !== "researched" && x.gapPct != null && ["today", "census", "births"].includes(x.key));
  const worst = auto.reduce((m, x) => Math.max(m, Math.abs(x.gapPct)), 0);
  if (worst > 5) {
    score += Math.min(4, worst / 5);
    reasons.push(`a newer figure ${Math.round(worst)}% from the UN`);
  }
  const pop = detail.population?.value ?? 0;
  score *= Math.log10(Math.max(pop, 10));
  const researched = (detail.crossChecks ?? []).filter((x) => x.kind === "researched").map((x) => Date.parse(x.accessed)).filter(Number.isFinite);
  const last = researched.length ? Math.max(...researched) : null;
  const fresh = last != null && now - last < freshDays * 864e5;
  return { score: fresh ? 0 : Math.round(score * 10) / 10, reasons, lastChecked: last ? new Date(last).toISOString().slice(0, 10) : null, fresh };
}

async function main() {
  const countries = JSON.parse(await readFile(join(API, "countries.json"), "utf8")).countries;
  const rows = [];
  for (const c of countries) {
    if (c.iso3 === "WLD" || !((c.population?.value ?? 0) >= MIN_POP)) continue;
    const d = JSON.parse(await readFile(join(API, "countries", `${c.iso3}.json`), "utf8"));
    const q = queueScore(d);
    if (q.fresh || q.score <= 0) continue;
    rows.push({ iso3: c.iso3, name: c.name, population: c.population.value, level: c.confidence, ...q });
  }
  rows.sort((a, b) => b.score - a.score || b.population - a.population);
  const next = rows.slice(0, N);
  if (args.includes("--json")) return console.log(JSON.stringify({ remaining: rows.length, next }, null, 2));
  console.log(`${rows.length} places to check (fresh for ${FRESH_DAYS} days after a check). Next ${next.length}:`);
  for (const r of next) console.log(`${r.iso3}  ${r.name.padEnd(28)} ${String(r.score).padStart(5)}  ${r.reasons.join(", ")}${r.lastChecked ? ` (last checked ${r.lastChecked})` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
