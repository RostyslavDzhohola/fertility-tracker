#!/usr/bin/env node
// Fertility Tracker data pipeline: fetch the latest public sources, build the API under public/api/v1/, validate, write.
// Zero dependencies, Node 22+.
//
//   node scripts/fetch-data.mjs                 fetch + build + validate + write (only changed files)
//   node scripts/fetch-data.mjs --verify        validate the published files only (no network)
//   node scripts/fetch-data.mjs --write-status --outcome <success|failure|skipped>
//                                               write api/v1/status.json (CI, after committing; never committed)
//   options: --out <publicDir>  --cache <dir> (cache raw downloads, for development)
//            --force (publish despite failed sanity checks or newly missing sources; use with care)
//
// Exit codes: 0 ok (changed or unchanged), 1 refused/failed (published data left untouched).
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDataset } from "./lib/build.mjs";
import { useCache } from "./lib/http.mjs";
import { API_DIR, finalize, renderFiles, writeFiles } from "./lib/publish.mjs";
import { sanityCheck, sourceDecision } from "./lib/sanity.mjs";
import { schemas, validate } from "./lib/schema.mjs";
import { fetchCorridors, fetchSources } from "./lib/sources.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PUBLIC = resolve(opt("--out", fileURLToPath(new URL("../public", import.meta.url))));
const API = join(PUBLIC, API_DIR);
const log = (m) => console.log(m);

const readJson = (p) => readFile(p, "utf8").then(JSON.parse, () => null);

async function readPrevious() {
  const [index, countries] = await Promise.all([readJson(join(API, "index.json")), readJson(join(API, "countries.json"))]);
  const corridorEntry = index?.sources?.flatMap((s) => s.datasets).find((d) => d.id === "migrationCorridors") ?? null;
  let corridors = null;
  if (corridorEntry?.status === "ok") {
    corridors = new Map();
    const names = await readdir(join(API, "countries")).catch(() => []);
    for (const n of names.filter((x) => x.endsWith(".json")).sort()) {
      const d = await readJson(join(API, "countries", n));
      if (d?.migrationCorridors) corridors.set(d.iso3, d.migrationCorridors);
    }
  }
  return { index, countries: countries?.countries ?? null, corridors: corridors && { entry: corridorEntry, data: corridors } };
}

/** Schema-validate every JSON file in a file map. */
function validateFiles(files) {
  const s = schemas();
  const pick = (path) =>
    path.endsWith("/index.json") ? "index.schema.json"
      : path.endsWith("/countries.json") ? "countries.schema.json"
        : path.endsWith("/risk.json") ? "risk.schema.json"
          : /\/countries\/[A-Z]{3}\.json$/.test(path) ? "country.schema.json"
            : null;
  const errors = [];
  for (const [path, content] of files) {
    if (!path.endsWith(".json")) continue;
    let data;
    try {
      data = JSON.parse(content);
    } catch (e) {
      errors.push(`${path}: invalid JSON (${e.message})`);
      continue;
    }
    const name = pick(path);
    if (name) for (const e of validate(s[name], data, { maxErrors: 5 })) errors.push(`${path} ${e}`);
  }
  return errors;
}

async function verifyOnly() {
  const files = new Map();
  const walk = async (dir) => {
    for (const e of await readdir(join(PUBLIC, dir), { withFileTypes: true }).catch(() => [])) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(rel);
      else files.set(rel, await readFile(join(PUBLIC, rel), "utf8"));
    }
  };
  await walk(API_DIR);
  const countries = JSON.parse(files.get(`${API_DIR}/countries.json`) ?? "null");
  const errors = validateFiles(files);
  if (!countries || countries.countries.length < 200) errors.push("countries.json missing or too small");
  else
    for (const c of countries.countries)
      if (!files.has(`${API_DIR}/countries/${c.iso3}.json`)) errors.push(`missing countries/${c.iso3}.json`);
  for (const f of ["risk.json", "index.json", "countries.csv", "timeseries.csv", "openapi.json"])
    if (!files.has(`${API_DIR}/${f}`)) errors.push(`missing ${f}`);
  if (errors.length) {
    console.error(`Verification failed (${errors.length} problems):\n  ${errors.slice(0, 40).join("\n  ")}`);
    process.exit(1);
  }
  log(`Verified ${files.size} files in ${API} (${countries.countries.length} records).`);
}

/**
 * --write-status: write api/v1/status.json for the deploy (CI runs this after the commit step, so it is never
 * committed). It proves the weekly loop ran even when no number changed (generatedAt only moves on changes).
 */
async function writeStatus() {
  const index = await readJson(join(API, "index.json"));
  if (!index) throw new Error("index.json not found; build the API first");
  const env = process.env;
  const status = {
    apiVersion: "v1",
    checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    refresh: opt("--outcome", "unknown"),
    trigger: env.GITHUB_EVENT_NAME ?? "local",
    run: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    commit: env.GITHUB_SHA ?? null,
    dataChangedAt: index.generatedAt,
    contentHash: index.contentHash,
    latestEstimateYear: index.latestEstimateYear,
    sources: index.sources.map((s) => ({
      id: s.id,
      vintage: s.vintage,
      datasets: s.datasets.map((d) => ({ id: d.id, status: d.status, lastUpdated: d.lastUpdated ?? null })),
    })),
    note: "Written on every deploy and not stored in the repository. generatedAt in the other files changes only when a published number changes.",
  };
  const errors = validate(schemas()["status.schema.json"], status);
  if (errors.length) throw new Error(`status.json invalid: ${errors.join("; ")}`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(API, "status.json"), JSON.stringify(status, null, 2) + "\n");
  log(`Wrote status.json (refresh: ${status.refresh}, data changed ${status.dataChangedAt}).`);
}

async function main() {
  if (flag("--verify")) return verifyOnly();
  if (flag("--write-status")) return writeStatus();
  if (opt("--cache")) useCache(resolve(opt("--cache")));
  const force = flag("--force");
  const t0 = Date.now();

  const previous = await readPrevious();
  const src = await fetchSources(log);

  // Refuse to publish if a required source is down, or if a source that worked last time is down now.
  const decision = sourceDecision([...src.manifest.wpp, ...src.manifest.ims, ...src.manifest.wb], previous.index, { force });
  for (const w of decision.warnings) log(`WARN ${w}`);
  if (!decision.publish) {
    console.error(`Refusing to publish; existing data left untouched:\n  ${decision.problems.join("\n  ")}`);
    process.exit(1);
  }

  const prevEntry = previous.corridors?.entry;
  const corridors = flag("--skip-corridors")
    ? {
        entry: prevEntry ? { ...prevEntry, vintage: { lastUpdated: prevEntry.lastUpdated ?? null, timespan: prevEntry.timespan ?? null } } : null,
        data: previous.corridors?.data ?? null,
      }
    : await fetchCorridors({ codes: [...src.wpp.population.entities.keys()], entities: src.wpp.population.entities, previous: previous.corridors, log });
  const manifest = { ...src.manifest, ims: [...src.manifest.ims, ...(corridors.entry ? [corridors.entry] : [])] };
  const corridorDecision = sourceDecision(corridors.entry ? [corridors.entry] : [], previous.index, { force });
  for (const w of corridorDecision.warnings) log(`WARN ${w}`);
  if (!corridorDecision.publish) {
    console.error(`Refusing to publish; existing data left untouched:\n  ${corridorDecision.problems.join("\n  ")}`);
    process.exit(1);
  }

  const ds = buildDataset({ wpp: src.wpp, ims: src.ims, wb: src.wb, corridors: corridors.data });
  const sanity = sanityCheck(ds, previous);
  if (sanity.length) {
    console.error(`Sanity checks failed (${sanity.length}):\n  ${sanity.slice(0, 40).join("\n  ")}`);
    if (!force) {
      console.error("Refusing to publish; existing data left untouched.");
      process.exit(1);
    }
  }

  const { files, contentHash, generatedAt, unchanged } = finalize(renderFiles(ds, manifest), { previousIndex: previous.index });
  const invalid = validateFiles(files);
  if (invalid.length) {
    console.error(`Schema validation failed (${invalid.length}):\n  ${invalid.slice(0, 40).join("\n  ")}`);
    process.exit(1);
  }

  const res = await writeFiles(PUBLIC, files);
  const top = ds.ranking.slice(0, 5).map((r) => `${r.iso3} ${r.risk.score}`).join(", ");
  log(
    `${unchanged ? "No changes" : "Updated"}: ${ds.records.length} records, ${ds.ranking.length} ranked (top: ${top}). ` +
      `${res.written} written, ${res.same} unchanged, ${res.removed} removed. generatedAt ${generatedAt}, hash ${contentHash.slice(0, 12)}. ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
