// Pure frontend logic: color scale / tier mapping, number formatting, generations math, hash parsing, feedback URLs,
// search, ordering, keyboard map navigation and takeaway copy. Runs offline with node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as L from "../../public/js/logic.js";

const feedback = JSON.parse(await readFile(new URL("../../public/feedback.json", import.meta.url), "utf8"));
const M = L.MINUS;

test("tier mapping and decline-risk colors", () => {
  assert.equal(L.tierOf({ risk: { tier: "Critical" } }), "Critical");
  assert.equal(L.tierOf({ risk: { tier: "bogus" } }), null);
  assert.equal(L.tierOf({ risk: null }), null);
  assert.equal(L.tierClass("High"), "tier-high");
  assert.equal(L.tierClass(null), "tier-none");
  assert.equal(L.colorFor({ risk: { tier: "Critical" } }, "risk"), "#FFCB52");
  assert.equal(L.colorFor({ risk: { tier: "Low" } }, "risk"), "#2A3A5E");
  assert.equal(L.colorFor({ risk: { tier: null } }, "risk"), null);
  assert.equal(L.legendKey({ risk: { tier: null } }, "risk"), L.NODATA);
  assert.deepEqual(
    L.legendItems("risk").map((i) => i.key),
    ["Low", "Moderate", "Elevated", "High", "Critical"],
  );
});

test("births-per-woman bins: lower bound inclusive, rounded to 2 decimals first", () => {
  const bin = L.tfrBinIndex;
  assert.equal(bin(0.582), 0);
  assert.equal(bin(0.994), 0);
  assert.equal(bin(0.995), 1); // rounds to 1.00
  assert.equal(bin(1.0), 1);
  assert.equal(bin(1.294), 1);
  assert.equal(bin(1.3), 2);
  assert.equal(bin(1.6), 3);
  assert.equal(bin(2.094), 3);
  assert.equal(bin(2.096), 4); // 2.10 is replacement: at/above side
  assert.equal(bin(2.1), 4);
  assert.equal(bin(3.0), 5);
  assert.equal(bin(4.0), 6);
  assert.equal(bin(6.03), 6);
  assert.equal(bin(null), -1);
  assert.equal(bin(NaN), -1);
  assert.equal(L.colorFor({ tfr: { value: 0.75 } }, "tfr"), "#FFCB52");
  assert.equal(L.colorFor({ tfr: { value: 1.8 } }, "tfr"), "#7A4A34");
  assert.equal(L.colorFor({ tfr: { value: 2.2 } }, "tfr"), "#2C4C72");
  assert.equal(L.legendKey({ tfr: null }, "tfr"), L.NODATA);
  const counts = L.countByKey([{ tfr: { value: 0.9 } }, { tfr: { value: 0.8 } }, { tfr: { value: 5 } }], "tfr");
  assert.equal(counts.get("tfr-0"), 2);
  assert.equal(counts.get("tfr-6"), 1);
});

test("number formatting follows DESIGN §8.6", () => {
  assert.equal(L.fmtTfr(0.748), "0.75");
  assert.equal(L.fmtTfr(2.1), "2.10");
  assert.equal(L.fmtTfr(null), "–");
  assert.equal(L.fmtCompact(51684564), "51.7M");
  assert.equal(L.fmtCompact(820000), "820K");
  assert.equal(L.fmtCompact(8215424893), "8.22B");
  assert.equal(L.fmtCompact(999.6), "1K");
  assert.equal(L.fmtCompact(640), "640");
  assert.equal(L.fmtCompact(-352000), `${M}352K`);
  assert.equal(L.fmtCompact(76000, { plus: true }), "+76K");
  assert.equal(L.fmtWords(21848795), "21.8 million");
  assert.equal(L.fmtWords(8215424893), "8.22 billion");
  assert.equal(L.fmtWords(820000), "820,000");
  assert.equal(L.fmtFlow(231394), "+231,000");
  assert.equal(L.fmtFlow(-352000), `${M}352,000`);
  assert.equal(L.fmtFlow(-3427), `${M}3,430`);
  assert.equal(L.fmtFlow(554), "+554");
  assert.equal(L.fmtFlow(70458654), "+70.5 million");
  assert.equal(L.fmtFlow(0), "0");
  assert.equal(L.fmtPct(-57.8), `${M}58%`);
  assert.equal(L.fmtPct(12.3), "+12%");
  assert.equal(L.fmtPct(-0.4), `${M}0.4%`);
  assert.equal(L.fmtPct(0.04), "0%");
  assert.equal(L.fmtPct(57.8, { plus: false }), "58%");
  assert.equal(L.fmtRate(4.56), "4.6");
  assert.equal(L.fmtRate(-6.7, { plus: true }), `${M}6.7`);
  assert.equal(L.fmtRate(1.7, { plus: true }), "+1.7");
  assert.equal(L.fmtInt(1811507), "1,811,507");
  assert.equal(L.fmtDate("2026-10-26T23:32:59Z"), "26 Oct 2026");
  assert.equal(L.fmtDate("not a date"), "–");
  assert.equal(L.fmtTick(40000000), "40M");
  assert.equal(L.fmtTick(200000), "200K");
  assert.equal(L.fmtTick(1.5, { kind: "tfr" }), "1.5");
  assert.equal(L.fmtTick(0), "0");
  // Uses the true minus sign, never a hyphen.
  assert.ok(!L.fmtPct(-5).includes("-"));
});

test("niceTicks spans the data with round steps", () => {
  assert.deepEqual(L.niceTicks(0, 51858481), [0, 20000000, 40000000, 60000000]);
  assert.deepEqual(L.niceTicks(-345503, 240982), [-400000, -200000, 0, 200000, 400000]);
  assert.deepEqual(L.niceTicks(0, 3), [0, 1, 2, 3]);
  const t = L.niceTicks(0, 7);
  assert.ok(t[0] <= 0 && t[t.length - 1] >= 7);
});

test("generations: 100 people, each generation × tfr / 2.1", () => {
  // The context post: 1.14 births per woman → 100 → 54 → 29 → 16 → 9 (8.7 with one decimal under 10).
  assert.deepEqual(L.generationCounts(1.14).map(L.fmtCount), ["100", "54", "29", "16", "8.7"]);
  assert.deepEqual(L.generationCounts(0.748).map(L.fmtCount), ["100", "36", "13", "4.5", "1.6"]);
  assert.equal(L.nextGeneration(0.748), 36);
  assert.equal(L.nextGeneration(2.1), 100);
  assert.equal(L.generationCounts(2.1)[4], 100);
  assert.deepEqual(L.generationCounts(null), []);
  assert.equal(L.fmtCount(9.96), "10");
  assert.equal(L.fmtCount(4.53), "4.5");
  const fills = L.dotFills(36.4);
  assert.equal(fills.length, 100);
  assert.equal(fills[35], 1);
  assert.ok(Math.abs(fills[36] - 0.4) < 1e-9);
  assert.equal(fills[37], 0);
  assert.equal(L.dotFills(250).filter((f) => f === 1).length, 100);
  assert.equal(L.dotFills(-5).every((f) => f === 0), true);
});

test("hash parsing selects known places only and normalizes case", () => {
  const known = new Set(["KOR", "JPN", "WLD"]);
  assert.deepEqual(L.parseSelectionHash("#KOR", known), { iso3: "KOR", normalized: false });
  assert.deepEqual(L.parseSelectionHash("#kor", known), { iso3: "KOR", normalized: true });
  assert.deepEqual(L.parseSelectionHash("#Wld", (c) => known.has(c)), { iso3: "WLD", normalized: true });
  assert.equal(L.parseSelectionHash("#XYZ", known), null);
  assert.equal(L.parseSelectionHash("#data", known), null);
  assert.equal(L.parseSelectionHash("#feedback", known), null);
  assert.equal(L.parseSelectionHash("#KO", known), null);
  assert.equal(L.parseSelectionHash("", known), null);
  assert.equal(L.parseSelectionHash(undefined, known), null);
  assert.equal(L.isSelectionLikeHash("#abc"), true);
  assert.equal(L.isSelectionLikeHash("#methodology"), false);
});

test("GitHub issue URLs: template + title + only the template's field ids, never labels=", () => {
  const kor = { iso3: "KOR", name: "South Korea" };
  const url = L.buildIssueUrl(feedback, "data-problem", kor);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://github.com/RostyslavDzhohola/fertility-tracker/issues/new");
  assert.equal(u.searchParams.get("template"), "data-problem.yml");
  assert.equal(u.searchParams.get("title"), "[Data] South Korea: ");
  assert.equal(u.searchParams.get("country"), "KOR");
  assert.equal(u.searchParams.get("page"), "https://rostyslavdzhohola.github.io/fertility-tracker/#KOR");
  assert.ok(!url.includes("labels="));
  for (const key of u.searchParams.keys()) assert.ok(["template", "title", ...Object.keys(feedback.github.templates["data-problem"].fields)].includes(key), key);
  // Values are percent-encoded, so the page URL's '#' does not end the query string.
  assert.ok(url.includes("page=https%3A%2F%2Frostyslavdzhohola.github.io%2Ffertility-tracker%2F%23KOR"));

  const world = new URL(L.buildIssueUrl(feedback, "feedback", { iso3: "WLD", name: "World" }));
  assert.equal(world.searchParams.get("country"), "World");
  assert.equal(world.searchParams.get("title"), "[Feedback] World: ");

  const chooser = new URL(L.buildChooserUrl(feedback, kor));
  assert.equal(chooser.pathname, "/RostyslavDzhohola/fertility-tracker/issues/new/choose");
  assert.deepEqual([...chooser.searchParams.keys()].sort(), ["country", "page"]);
  assert.ok(!chooser.href.includes("labels="));
  assert.equal(L.buildIssueUrl(feedback, "missing-template", kor), null);
  assert.equal(L.buildIssueUrl(null, "data-problem", kor), null);
});

test("mailto link carries subject and body; falls back to the brief's address", () => {
  const m = L.buildMailto(feedback, { iso3: "JPN", name: "Japan" });
  assert.ok(m.startsWith("mailto:andromedus+fertility@mail.grokbot.com?subject="));
  const q = new URLSearchParams(m.split("?")[1]);
  assert.equal(q.get("subject"), "Fertility Tracker feedback: Japan");
  assert.equal(q.get("body"), "Page: https://rostyslavdzhohola.github.io/fertility-tracker/#JPN\n\nWhat should we fix or add?\n");
  assert.ok(L.buildMailto(null, { iso3: "JPN", name: "Japan" }).startsWith(`mailto:${L.FALLBACK_EMAIL}?`));
});

test("X handle stays hidden while it is a TODO_ placeholder", () => {
  assert.equal(feedback.x.handle.startsWith("TODO_"), true);
  assert.equal(L.xHandle(feedback), null);
  assert.equal(L.xProfileUrl(feedback), null);
  assert.equal(L.xHandle({ x: { handle: null } }), null);
  assert.equal(L.xHandle({ x: { handle: "@FertilityTrack" } }), "FertilityTrack");
  assert.equal(L.xProfileUrl({ x: { handle: "FertilityTrack", urlTemplate: "https://x.com/{handle}" } }), "https://x.com/FertilityTrack");
});

test("search: names, aliases, ISO3 codes, diacritics; ties go to the larger population", () => {
  const places = [
    { iso3: "KOR", name: "South Korea", population: 51e6 },
    { iso3: "PRK", name: "North Korea", population: 26e6 },
    { iso3: "GBR", name: "United Kingdom", population: 69e6 },
    { iso3: "UKR", name: "Ukraine", population: 39e6 },
    { iso3: "CIV", name: "Cote d'Ivoire", population: 31e6 },
    { iso3: "USA", name: "United States", population: 340e6 },
    { iso3: "ARE", name: "United Arab Emirates", population: 11e6 },
    { iso3: "TUR", name: "Turkey", population: 85e6 },
    { iso3: "WLD", name: "World", population: 8e9 },
  ];
  const codes = (q) => L.searchPlaces(places, q).map((p) => p.iso3);
  assert.equal(codes("kor")[0], "KOR"); // exact ISO3
  assert.equal(codes("korea")[0], "KOR"); // alias
  assert.deepEqual(codes("korea").slice(0, 2), ["KOR", "PRK"]);
  assert.equal(codes("uk")[0], "GBR"); // alias beats a name prefix
  assert.equal(codes("ivory")[0], "CIV");
  assert.equal(codes("CÔTE D’IVOIRE")[0], "CIV"); // diacritics and curly apostrophe
  assert.equal(codes("türkiye")[0], "TUR");
  assert.deepEqual(codes("united"), ["USA", "GBR", "ARE"]);
  assert.equal(codes("earth")[0], "WLD");
  assert.deepEqual(codes("zzzz"), []);
  assert.deepEqual(codes("   "), []);
  assert.equal(L.searchPlaces(places, "a", 3).length, 3);
  assert.deepEqual(L.matchRange("Côte d'Ivoire", "cote d"), [0, 6]);
  assert.deepEqual(L.matchRange("South Korea", "KOR"), [6, 9]);
  assert.equal(L.matchRange("Chad", "xyz"), null);
  assert.equal(L.normalizeText("Guinea-Bissau"), "guinea bissau");
});

test("ordering: risk mode uses the API rank; births mode sorts ascending; unranked kept apart; WLD excluded", () => {
  const recs = [
    { iso3: "WLD", name: "World", ranked: false, tfr: { value: 2.2 }, risk: { score: 2, tier: "Low", rank: null } },
    { iso3: "AAA", name: "Alpha", ranked: true, tfr: { value: 1.5 }, risk: { score: 60, tier: "High", rank: 2 } },
    { iso3: "BBB", name: "Beta", ranked: true, tfr: { value: 0.9 }, risk: { score: 88, tier: "Critical", rank: 1 } },
    { iso3: "CCC", name: "Gamma", ranked: true, tfr: { value: 3.1 }, risk: { score: 5, tier: "Low", rank: 3 } },
    { iso3: "DDD", name: "Delta", ranked: false, flags: ["small-population"], tfr: { value: 0.8 }, risk: { score: 70, tier: "Critical", rank: null } },
  ];
  const r = L.orderPlaces(recs, "risk");
  assert.deepEqual(r.ranked.map((x) => x.iso3), ["BBB", "AAA", "CCC"]);
  assert.deepEqual(r.unranked.map((x) => x.iso3), ["DDD"]);
  const t = L.orderPlaces(recs, "tfr");
  assert.deepEqual(t.ranked.map((x) => x.iso3), ["BBB", "AAA", "CCC"].sort((a, b) => recs.find((x) => x.iso3 === a).tfr.value - recs.find((x) => x.iso3 === b).tfr.value));
  assert.equal(L.rankLabel(recs[2], 200), "#1 of 200");
  assert.equal(L.rankLabel(recs[4], 200), "Not ranked (under 100,000 people)");
  assert.equal(L.rankLabel({ iso3: "XXX", flags: [], risk: { rank: null } }, 200), "Not ranked (incomplete data)");
  assert.equal(L.rankLabel(recs[0], 200), "The world as a whole isn't scored");
});

test("keyboard map navigation picks the nearest place within ±60° of the arrow", () => {
  const pts = [
    { iso3: "KOR", x: 100, y: 100 },
    { iso3: "JPN", x: 120, y: 102 },
    { iso3: "PRK", x: 98, y: 90 },
    { iso3: "CHN", x: 60, y: 95 },
    { iso3: "TWN", x: 92, y: 130 },
  ];
  const from = pts[0];
  assert.equal(L.nearestInDirection(pts, from, "right").iso3, "JPN");
  assert.equal(L.nearestInDirection(pts, from, "up").iso3, "PRK");
  assert.equal(L.nearestInDirection(pts, from, "left").iso3, "CHN");
  assert.equal(L.nearestInDirection(pts, from, "down").iso3, "TWN");
  assert.equal(L.nearestInDirection([from], from, "left"), null);
  assert.equal(L.nearestInDirection(pts, from, "sideways"), null);
});

test("takeaway copy: waterfall cases, generations, summary, X post", () => {
  const rec = (B, D, Mig) => ({ iso3: "TST", name: "Testland", components: { year: 2023, births: B, deaths: D, netMigration: Mig } });
  assert.match(L.waterfallTakeaway(rec(300, 200, 50)), /^Births outnumber deaths and more people arrive than leave: \+150 people in 2023\.$/);
  assert.match(L.waterfallTakeaway(rec(300, 200, -50)), /^Births outnumber deaths, but 50 more people leave than arrive each year\.$/);
  assert.match(L.waterfallTakeaway(rec(200, 300, 150)), /^More deaths than births, but immigration more than fills the gap: \+50 people in 2023\.$/);
  assert.equal(L.waterfallTakeaway(rec(236394, 345503, 87800)), "Deaths outnumber births by 109,000. Immigration covers 80% of that gap.");
  assert.equal(L.waterfallTakeaway(rec(200, 300, -10)), `Deaths outnumber births and more people leave than arrive: ${M}110 people in 2023.`);
  const rows = L.waterfallRows({ births: 300, deaths: 200, netMigration: -50, perThousand: {} });
  assert.deepEqual(rows.map((r) => [r.from, r.to]), [
    [0, 300],
    [300, 100],
    [100, 50],
    [0, 50],
  ]);
  assert.equal(L.generationsTakeaway("Japan", 1.15), "At 1.15 births per woman, 100 people today have 55 children, 30 grandchildren and 16 great-grandchildren.");
  assert.equal(L.generationsTakeaway("Niger", 6.03), "At 6.03 births per woman, each generation is bigger than the last: 100 → 287 → 825.");
  assert.equal(L.generationsTakeaway("Japan", 2.5, { whatIf: true }), "What if Japan had 2.50 births per woman?");
  const kor = { iso3: "KOR", name: "South Korea", tfr: { value: 0.748, year: 2024 }, projection: { change2100Pct: -57.8, population2100: 21848795 } };
  assert.equal(
    L.summarySentence(kor),
    "South Korea has 0.75 births per woman, far below the 2.1 needed to keep a population steady. The UN projects 21.8 million people by 2100, 58% fewer than today.",
  );
  const post = L.xPostText(kor);
  assert.equal(post, "South Korea: 0.75 births per woman. Start with 100 people → 36 children → 13 grandchildren. The UN projects a 58% population drop by 2100.");
  assert.ok(post.length < 250);
  assert.equal(L.possessive("Philippines"), "Philippines'");
  assert.equal(L.documentTitle(kor), "South Korea: 0.75 births per woman · Fertility Tracker");
  assert.equal(L.documentTitle(null), "Fertility Tracker: which countries are shrinking, and how fast");
});

test("direct labels are spread at least 14px apart and kept in bounds", () => {
  const ys = L.spreadLabels([100, 104, 106], 14, 0, 200);
  const sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 14 - 1e-9);
  const top = L.spreadLabels([195, 198], 14, 0, 200);
  assert.ok(Math.max(...top) <= 200);
});
