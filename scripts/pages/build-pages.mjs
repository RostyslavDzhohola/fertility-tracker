#!/usr/bin/env node
// Share pages: public/country/<ISO3>/index.html for every place and public/rankings/index.html, each a copy of
// public/index.html with its own title, description, canonical link and link-preview card. X, Slack, iMessage and
// search engines read these tags without running JavaScript, so a link to /country/TWN previews Taiwan, not the globe.
// The app itself is the same file: it reads the path and shows the page.
//
//   node scripts/pages/build-pages.mjs
//
// The deploy workflow runs it on the data it ships; scripts/serve.mjs and the browser tests run it too. Not committed
// (.gitignore). Unknown codes have no page, so Vercel answers them with 404.html and a real 404.

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../public");

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// Replace one tag's value in the template; the template must have it exactly once.
function setTag(html, re, value, what) {
  let n = 0;
  const out = html.replace(re, (_, before, after) => {
    n++;
    return before + esc(value) + after;
  });
  if (n !== 1) throw new Error(`build-pages: index.html has ${n} ${what} (expected 1)`);
  return out;
}

function withMeta(template, { title, description, url, ogTitle, image, imageAlt }) {
  let html = template;
  html = setTag(html, /(<title>)[^<]*(<\/title>)/g, title, "<title>");
  html = setTag(html, /(<meta name="description" content=")[^"]*(">)/g, description, "meta description");
  html = setTag(html, /(<link rel="canonical" href=")[^"]*(">)/g, url, "canonical link");
  html = setTag(html, /(<meta property="og:url" content=")[^"]*(">)/g, url, "og:url");
  html = setTag(html, /(<meta property="og:title" content=")[^"]*(">)/g, ogTitle, "og:title");
  html = setTag(html, /(<meta property="og:description" content=")[^"]*(">)/g, description, "og:description");
  html = setTag(html, /(<meta property="og:image" content=")[^"]*(">)/g, image, "og:image");
  html = setTag(html, /(<meta property="og:image:alt" content=")[^"]*(">)/g, imageAlt, "og:image:alt");
  html = setTag(html, /(<meta name="twitter:title" content=")[^"]*(">)/g, ogTitle, "twitter:title");
  html = setTag(html, /(<meta name="twitter:description" content=")[^"]*(">)/g, description, "twitter:description");
  html = setTag(html, /(<meta name="twitter:image" content=")[^"]*(">)/g, image, "twitter:image");
  html = setTag(html, /(<meta name="twitter:image:alt" content=")[^"]*(">)/g, imageAlt, "twitter:image:alt");
  return html;
}

// The words for one place's link preview. Exported for tests.
export function placeMeta(L, rec, scen, site, { now = new Date() } = {}) {
  const iso3 = rec.iso3;
  const today = L.todayYear(scen, now);
  const who = L.displayName(rec);
  const end = L.END_YEAR;
  const pop2100 = L.popAt(scen, iso3, end, "medium");
  const popToday = L.popAt(scen, iso3, today, "medium");
  const pct = L.pctVsToday(scen, iso3, end, "medium", today);
  const tfr = rec.tfr?.value;
  const url = L.pageUrl(iso3, site);
  const babies = Number.isFinite(tfr) ? `${L.fmtTfr(tfr)} babies per woman (2.1 keeps a country the same size). ` : "";
  if (pop2100 == null || popToday == null || pct == null) {
    return {
      title: L.documentTitle("country", rec, null),
      ogTitle: `${who}: population, births, deaths and moving, today to 2100`,
      description: `${babies}See how many people ${L.theName(rec)} has each year, and how many are born, die and move in. Free data, sources linked.`,
      url,
      image: `${site}og.png`,
      imageAlt: "A globe colored by how many people each country will have in 2100 compared with today",
      card: false,
    };
  }
  return {
    title: L.documentTitle("country", rec, pct),
    ogTitle: `${who}: ${L.fmtWords(pop2100)} people by ${end}, ${L.fmtPct(pct)} vs today`,
    description: `${babies}UN forecast: ${L.fmtWords(popToday)} people today, ${L.fmtWords(pop2100)} in ${end}. Slide through the years to see how many are born, die and move in. Free data, sources linked.`,
    url,
    image: `${site}og/${iso3}.jpg`,
    imageAlt: `${who} on a globe colored by how many people each country will have in ${end} compared with today: ${L.fmtWords(pop2100)} people in ${end}, ${L.fmtPct(pct)} vs today (UN forecast).`,
    card: true,
  };
}

export async function buildPages({ dir = publicDir, quiet = false } = {}) {
  const L = await import(pathToFileURL(path.join(dir, "js/logic.js")).href);
  const template = await readFile(path.join(dir, "index.html"), "utf8");
  const countries = JSON.parse(await readFile(path.join(dir, "api/v1/countries.json"), "utf8"));
  const scen = JSON.parse(await readFile(path.join(dir, "api/v1/scenarios.json"), "utf8"));
  const feedback = JSON.parse(await readFile(path.join(dir, "feedback.json"), "utf8").catch(() => "{}"));
  const site0 = feedback?.site?.url || L.SITE_URL;
  const site = site0.endsWith("/") ? site0 : `${site0}/`;

  await rm(path.join(dir, "country"), { recursive: true, force: true });
  await rm(path.join(dir, "rankings"), { recursive: true, force: true });
  const written = [];
  for (const rec of countries.countries) {
    if (!/^[A-Z]{3}$/.test(rec.iso3)) continue;
    const meta = placeMeta(L, rec, scen, site);
    const out = path.join(dir, "country", rec.iso3, "index.html");
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, withMeta(template, meta));
    written.push(rec.iso3);
  }
  const rankings = withMeta(template, {
    title: L.documentTitle("rankings"),
    ogTitle: "Where populations will shrink most by 2100",
    description: "Every country and territory ranked by how much its population will shrink by 2100 (UN forecast), and by babies per woman. Free data, sources linked.",
    url: `${site}rankings`,
    image: `${site}og.png`,
    imageAlt: "A globe colored by how many people each country will have in 2100 compared with today, with the countries most at risk of shrinking",
  });
  await mkdir(path.join(dir, "rankings"), { recursive: true });
  await writeFile(path.join(dir, "rankings", "index.html"), rankings);
  if (!quiet) console.log(`Wrote ${written.length} country pages and the rankings page`);
  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  buildPages().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
