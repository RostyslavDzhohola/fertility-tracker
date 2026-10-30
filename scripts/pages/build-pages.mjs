#!/usr/bin/env node
// Share pages: public/country/<ISO3>/index.html for every place and public/rankings/index.html, each a copy of
// public/index.html with its own title, description, canonical link and link-preview card. X, Slack, iMessage and
// search engines read these tags without running JavaScript, so a link to /country/TWN previews Taiwan, not the globe.
// The app itself is the same file: it reads the path and shows the page. For crawlers that don't run JavaScript, each
// page's <noscript> says what the page shows (a place's numbers; the rankings, linking every place) and its JSON-LD
// describes that place's data. public/sitemap.xml lists every page and public/robots.txt points to it.
//
//   node scripts/pages/build-pages.mjs            # pages, sitemap, robots.txt, and the short-link redirects in vercel.json
//
// The deploy workflow runs it on the data it ships; scripts/serve.mjs and the browser tests run it too. The pages are
// not committed (.gitignore); vercel.json is, and the workflow commits it with the data when a place is added.
// Unknown codes have no page, so Vercel answers them with 404.html and a real 404.

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

function withMeta(template, { title, description, url, ogTitle, image, imageAlt, noscript, jsonLd }) {
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
  if (noscript) html = setBlock(html, /(<noscript>)[\s\S]*?(<\/noscript>)/g, noscript, "<noscript>");
  if (jsonLd) html = setBlock(html, /(<script type="application\/ld\+json" id="dataset-jsonld">)[\s\S]*?(<\/script>)/g, `\n${jsonLd}\n`, "dataset JSON-LD");
  return html;
}

// Replace one block's inner HTML (already escaped by the caller); the template must have it exactly once.
function setBlock(html, re, inner, what) {
  let n = 0;
  const out = html.replace(re, (_, before, after) => {
    n++;
    return before + inner + after;
  });
  if (n !== 1) throw new Error(`build-pages: index.html has ${n} ${what} (expected 1)`);
  return out;
}

// The links every <noscript> keeps: the data works without JavaScript.
const DATA_LINKS = [
  ["/api/v1/countries.csv", "Every country (CSV)"],
  ["/api/v1/timeseries.csv", "Yearly data 1950–2100 (CSV)"],
  ["/api/v1/countries.json", "Every country (JSON)"],
  ["/api/", "API documentation"],
  ["/llms.txt", "llms.txt (guide for AI agents)"],
];

function noscriptHtml(parts, links) {
  const li = (href, text) => `<li><a href="${esc(href)}">${esc(text)}</a></li>`;
  return `
    <div class="noscript">
${parts.map((p) => `      ${p}`).join("\n")}
      <ul>
        ${[...links, ...DATA_LINKS].map(([href, text]) => li(href, text)).join("\n        ")}
      </ul>
    </div>
  `;
}

// What a place's page says, for crawlers that don't run JavaScript: the same sentences the page shows. Exported for tests.
export function placeNoscript(L, rec, scen, { now = new Date(), rankedN = null } = {}) {
  const today = L.todayYear(scen, now);
  const pct = L.pctVsToday(scen, rec.iso3, L.END_YEAR, "medium", today);
  const ratio = L.ratioVsToday(scen, rec.iso3, L.END_YEAR, "medium", today);
  const small = L.isSmallPlace(rec);
  const parts = [`<h1>${esc(L.displayName(rec))}: population, births, deaths and moving, 1950 to ${L.END_YEAR}</h1>`];
  const said = [L.verdict(rec, pct, today, { scenario: "medium", small }), small ? "" : L.hundredSentence(rec, ratio, "medium")];
  const tfr = L.tfrReason(rec);
  if (tfr) said.push(`${tfr}.`);
  parts.push(`<p>${esc(said.filter(Boolean).join(" "))}</p>`);
  if (rec.iso3 !== "WLD" && rec.risk?.score != null) {
    const rank = L.rankLabel(rec, rankedN).replace(/^Not ranked/, "not ranked");
    parts.push(`<p>Risk score: ${rec.risk.score} / 100, tier ${esc(rec.risk.tier ?? "–")}, ${esc(rank)}.</p>`);
    if (rec.risk.factors?.length) parts.push(`<ul>${rec.risk.factors.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
  }
  parts.push("<p>The charts on this page need JavaScript. The data works without it:</p>");
  return noscriptHtml(parts, [
    [`/api/v1/countries/${rec.iso3}.json`, `${L.displayName(rec)}: every year, 1950–${L.END_YEAR} (JSON)`],
    ["/rankings", "Every country ranked"],
    ["/", "The globe"],
  ]);
}

// The rankings page without JavaScript: the same list, each place linking to its page. Exported for tests.
export function rankingsNoscript(L, countries, scen, { now = new Date() } = {}) {
  const today = L.todayYear(scen, now);
  const pct = (r) => L.pctVsToday(scen, r.iso3, L.END_YEAR, "medium", today);
  const main = countries
    .filter((r) => r.ranked === true && !L.isSmallPlace(r))
    .sort((a, b) => (pct(a) ?? 1e9) - (pct(b) ?? 1e9) || a.name.localeCompare(b.name));
  const row = (r) => {
    const p = pct(r);
    const tfr = r.tfr?.value;
    return `<li><a href="${L.countryPath(r.iso3)}">${esc(r.name)}</a>: ${p == null ? "no forecast" : `${esc(L.fmtPct(p))} by ${L.END_YEAR}`}${Number.isFinite(tfr) ? `, ${esc(L.fmtTfr(tfr))} babies per woman` : ""}</li>`;
  };
  return noscriptHtml(
    [
      `<h1>Where populations will shrink most by ${L.END_YEAR}</h1>`,
      `<p>Change in people from today to ${L.END_YEAR}, UN forecast. ${main.length} places, the biggest fall first.</p>`,
      `<ol>\n        ${main.map(row).join("\n        ")}\n      </ol>`,
      "<p>The table on this page needs JavaScript. The data works without it:</p>",
    ],
    [["/", "The globe"]],
  );
}

// A place's own Dataset (its JSON file), part of the whole dataset the home page describes. Exported for tests.
export function placeJsonLd(L, rec, site, base, { dateModified = null } = {}) {
  const who = L.displayName(rec);
  const where = rec.iso3 === "WLD" ? "the world" : L.theName(rec);
  const keywords = rec.iso3 === "WLD" ? ["world population", "world fertility rate"] : [`${rec.name} population`, `${rec.name} fertility rate`, `${rec.name} birth rate`];
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${who}: population, births per woman and UN forecast to ${L.END_YEAR}`,
    description: `People in ${where} each year from 1950 to ${L.END_YEAR} (UN World Population Prospects 2024: estimates to 2023, forecast after, with its 80% and 95% ranges), births per woman, births, deaths, net migration, people born abroad, a 0-100 population-decline risk score, and how sure each number is. Static JSON, no key, refreshed weekly.`,
    url: L.pageUrl(rec.iso3, site),
    license: base.license,
    isAccessibleForFree: true,
    creator: base.creator,
    isPartOf: { "@type": "Dataset", name: base.name, url: base.url },
    keywords: [...keywords, ...(base.keywords ?? [])],
    temporalCoverage: `1950/${L.END_YEAR}`,
    spatialCoverage: rec.iso3 === "WLD" ? "World" : { "@type": "Place", name: rec.name },
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${site}api/v1/countries/${rec.iso3}.json` }],
    ...(dateModified ? { dateModified } : {}),
  };
  return JSON.stringify(dataset, null, 2).replace(/</g, "\\u003c");
}

// Every page, for search engines. Exported for tests.
export function sitemapXml(site, paths, lastmod) {
  const urls = paths.map((p) => `  <url><loc>${esc(site + p)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function robotsTxt(site) {
  return `# Fertility Tracker: every page and data file is open to search engines and AI agents.\nUser-agent: *\nAllow: /\n\nSitemap: ${site}sitemap.xml\n`;
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
  // Search results show about 160 characters: the population and the fertility rate first.
  const babies = Number.isFinite(tfr) ? `Fertility rate: ${L.fmtTfr(tfr)} babies per woman; 2.1 keeps a country the same size.` : "";
  const of = rec.iso3 === "WLD" ? "World population" : `Population of ${L.theName(rec)}`;
  if (pop2100 == null || popToday == null || pct == null) {
    return {
      title: L.documentTitle("country", rec, null),
      ogTitle: `${who}: population, births, deaths and moving, today to 2100`,
      description: `${of}, births, deaths and moving, each year from 1950. ${babies}`.trim(),
      url,
      image: `${site}og.png`,
      imageAlt: "A globe colored by how many people each country will have in 2100 compared with today",
      card: false,
    };
  }
  return {
    title: L.documentTitle("country", rec, pct),
    ogTitle: `${who}: ${L.fmtWords(pop2100)} people by ${end}, ${L.fmtPct(pct)} vs today`,
    description: `${of}: ${L.fmtWords(popToday)} today, ${L.fmtWords(pop2100)} by ${end} (UN forecast, ${L.fmtPct(pct)}). ${babies}`.trim(),
    url,
    image: `${site}og/${iso3}.jpg`,
    imageAlt: `${who} on a globe colored by how many people each country will have in ${end} compared with today: ${L.fmtWords(pop2100)} people in ${end}, ${L.fmtPct(pct)} vs today (UN forecast).`,
    card: true,
  };
}

// Server redirects for every place, so links that crawlers and link previews follow (they don't run JavaScript) land
// on the page: "/KOR" and "/kor" → "/country/KOR", "/country/kor" → "/country/KOR". Vercel matches vercel.json
// sources case-sensitively, so the upper-case page never matches a lower-case rule. Exported for tests.
export function placeRedirects(codes) {
  const up = [...codes].filter((c) => /^[A-Z]{3}$/.test(c)).sort();
  return [
    { source: `/:code(${up.join("|")})`, destination: "/country/:code", permanent: false },
    { source: `/:code(${up.map((c) => c.toLowerCase()).join("|")})`, destination: "/country/:code", permanent: false },
    ...up.map((c) => ({ source: `/country/${c.toLowerCase()}`, destination: `/country/${c}`, permanent: false })),
  ];
}

// vercel.json with the place redirects replaced (any redirect into /country/ is ours), one redirect per line.
export function withPlaceRedirects(vercel, codes) {
  const mine = (r) => typeof r.destination === "string" && r.destination.startsWith("/country/");
  const redirects = [...(vercel.redirects ?? []).filter((r) => !mine(r)), ...placeRedirects(codes)];
  const json = JSON.stringify({ ...vercel, redirects: "\u0000" }, null, 2);
  return json.replace('"\\u0000"', `[\n${redirects.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`) + "\n";
}

export async function syncVercelRedirects({ repoDir = path.resolve(publicDir, ".."), dir = publicDir, quiet = false } = {}) {
  const countries = JSON.parse(await readFile(path.join(dir, "api/v1/countries.json"), "utf8"));
  const file = path.join(repoDir, "vercel.json");
  const before = await readFile(file, "utf8");
  const after = withPlaceRedirects(JSON.parse(before), countries.countries.map((c) => c.iso3));
  if (after !== before) await writeFile(file, after);
  if (!quiet) console.log(after !== before ? "Updated the place redirects in vercel.json" : "vercel.json redirects are up to date");
  return after !== before;
}

export async function buildPages({ dir = publicDir, quiet = false } = {}) {
  const L = await import(pathToFileURL(path.join(dir, "js/logic.js")).href);
  const template = await readFile(path.join(dir, "index.html"), "utf8");
  const countries = JSON.parse(await readFile(path.join(dir, "api/v1/countries.json"), "utf8"));
  const scen = JSON.parse(await readFile(path.join(dir, "api/v1/scenarios.json"), "utf8"));
  const feedback = JSON.parse(await readFile(path.join(dir, "feedback.json"), "utf8").catch(() => "{}"));
  const site0 = feedback?.site?.url || L.SITE_URL;
  const site = site0.endsWith("/") ? site0 : `${site0}/`;

  const base = JSON.parse(template.match(/<script type="application\/ld\+json" id="dataset-jsonld">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
  const dateModified = countries.generatedAt ?? null;
  const rankedN = countries.countries.filter((r) => Number.isInteger(r.risk?.rank)).length;

  await rm(path.join(dir, "country"), { recursive: true, force: true });
  await rm(path.join(dir, "rankings"), { recursive: true, force: true });
  const written = [];
  for (const rec of countries.countries) {
    if (!/^[A-Z]{3}$/.test(rec.iso3)) continue;
    const meta = {
      ...placeMeta(L, rec, scen, site),
      noscript: placeNoscript(L, rec, scen, { rankedN }),
      jsonLd: placeJsonLd(L, rec, site, base, { dateModified }),
    };
    const out = path.join(dir, "country", rec.iso3, "index.html");
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, withMeta(template, meta));
    written.push(rec.iso3);
  }
  const rankings = withMeta(template, {
    title: L.documentTitle("rankings"),
    ogTitle: "Where populations will shrink most by 2100",
    description: "Every country ranked by how much its population will shrink by 2100 (UN forecast), and by fertility rate (babies per woman). Free data, sources linked.",
    url: `${site}rankings`,
    image: `${site}og.png`,
    imageAlt: "A globe colored by how many people each country will have in 2100 compared with today, with the countries most at risk of shrinking",
    noscript: rankingsNoscript(L, countries.countries, scen),
  });
  await mkdir(path.join(dir, "rankings"), { recursive: true });
  await writeFile(path.join(dir, "rankings", "index.html"), rankings);
  const paths = ["", "rankings", "api/", ...written.map((c) => L.countryPath(c).slice(1))];
  await writeFile(path.join(dir, "sitemap.xml"), sitemapXml(site, paths, dateModified?.slice(0, 10)));
  await writeFile(path.join(dir, "robots.txt"), robotsTxt(site));
  if (!quiet) console.log(`Wrote ${written.length} country pages, the rankings page, sitemap.xml and robots.txt`);
  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  buildPages()
    .then(() => syncVercelRedirects())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
