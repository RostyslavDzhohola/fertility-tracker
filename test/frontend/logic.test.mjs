// Pure frontend logic (public/js/logic.js): the people ramp, risk words, scenarios, number formatting, routes and URLs,
// feedback links, typo-tolerant search and the plain-language copy. Runs offline with node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as L from "../../public/js/logic.js";

const feedback = JSON.parse(await readFile(new URL("../../public/feedback.json", import.meta.url), "utf8"));
const countries = JSON.parse(await readFile(new URL("../../public/api/v1/countries.json", import.meta.url), "utf8")).countries;
const scen = JSON.parse(await readFile(new URL("../../public/api/v1/scenarios.json", import.meta.url), "utf8"));
const M = L.MINUS;

test("risk words map the five API tiers to plain words; no score on the label", () => {
  assert.deepEqual(L.TIERS.map((t) => L.RISK_WORDS[t]), ["Very low", "Low", "Medium", "High", "Very high"]);
  assert.deepEqual(L.RISK_LEVELS, ["Very low", "Low", "Medium", "High", "Very high"]);
  assert.equal(L.riskWord({ risk: { tier: "Critical" } }), "Very high");
  assert.equal(L.riskWord({ risk: { tier: "Elevated" } }), "Medium");
  assert.equal(L.riskWord({ risk: { tier: null } }), null);
  assert.equal(L.riskStep({ risk: { tier: "Low" } }), 0);
  assert.equal(L.riskStep({ risk: { tier: "Critical" } }), 4);
  assert.equal(L.riskStep({}), -1);
  assert.equal(L.RISK_COLORS.length, 5);
  assert.equal(L.isSmallPlace({ flags: ["small-population"] }), true);
});

test("one four-word scale: the legend, chips, meter and verdicts share bands and colors with the outlook ramp", () => {
  assert.deepEqual(L.OUTLOOK.map((o) => o.label), ["Growing", "About the same", "Shrinking", "Shrinking fast"]);
  const word = (p) => L.outlookOf(p)?.label ?? null;
  assert.equal(word(40), "Growing");
  assert.equal(word(5.6), "Growing");
  assert.equal(word(5.4), "About the same", "shown as +5%");
  assert.equal(word(0), "About the same");
  assert.equal(word(-5), "About the same");
  assert.equal(word(-6), "Shrinking");
  assert.equal(word(-24), "Shrinking");
  assert.equal(word(-25), "Shrinking fast");
  assert.equal(word(-49.6), "Shrinking fast", "no gray half-gone step: red only deepens");
  assert.equal(word(-90), "Shrinking fast");
  assert.equal(word(null), null);
  // Each word's color is the ramp's color inside its band.
  for (const [i, o] of L.OUTLOOK.entries()) assert.equal(L.outlookColor(i), L.changeColor(o.pct));
  assert.equal(L.changeBand(-30), "fast");
  assert.equal(L.changeBand(-70), "fast");
  assert.equal(L.changeBand(12), "growing");
  assert.equal(L.changeColor(null), null);
  assert.equal(L.changeColor(0), "#EEE5CD");
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (hex) => rgb(hex).reduce((a, b) => a + b, 0);
  // Shrinking is warm (red > blue) all the way down, and darker the more is lost: no gray.
  for (const p of [-10, -25, -45, -55, -70, -90]) {
    const [r, , b] = rgb(L.changeColor(p));
    assert.ok(r > b + 60, `${p}% should be orange/red, got ${L.changeColor(p)}`);
  }
  assert.ok(lum(L.changeColor(-90)) < lum(L.changeColor(-70)) && lum(L.changeColor(-70)) < lum(L.changeColor(-55)) && lum(L.changeColor(-55)) < lum(L.changeColor(-30)));
  for (const p of [15, 40, 100]) {
    const [r, g] = rgb(L.changeColor(p));
    assert.ok(g > r + 40, `${p}% should be green`);
  }
  // Stronger growth = darker green.
  assert.ok(lum(L.changeColor(100)) < lum(L.changeColor(30)));
  // The interactive accent (#2457FF) is not a data color.
  for (let p = -100; p <= 250; p += 5) assert.notEqual(L.changeColor(p), "#2457FF");
});

test("the globe's trend scale: % a year over the last 5 years, the same four words, red deepening", () => {
  assert.deepEqual(L.TREND.map((o) => o.label), ["Growing", "About the same", "Shrinking", "Shrinking fast"]);
  const word = (r) => L.TREND[L.trendStep(r)]?.label ?? null;
  assert.equal(word(2.1), "Growing");
  assert.equal(word(0.16), "Growing", "shown as 0.2%");
  assert.equal(word(0.14), "About the same", "shown as 0.1%: the word follows the number people see");
  assert.equal(word(-0.05), "About the same");
  assert.equal(word(-0.16), "Shrinking", "shown as −0.2%");
  assert.equal(word(-0.74), "Shrinking", "shown as −0.7%");
  assert.equal(word(-0.75), "Shrinking fast", "shown as −0.8%");
  assert.equal(word(-1.2), "Shrinking fast");
  assert.equal(word(null), null);
  for (const [i, t] of L.TREND.entries()) assert.equal(L.trendColorOf(i), L.trendColor(t.rate));
  assert.equal(L.trendColor(0), "#EEE5CD");
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (hex) => rgb(hex).reduce((a, b) => a + b, 0);
  assert.ok(lum(L.trendColor(-2.5)) < lum(L.trendColor(-1.5)) && lum(L.trendColor(-1.5)) < lum(L.trendColor(-0.5)));
  for (const r of [-0.3, -1, -3]) {
    const [red, , b] = rgb(L.trendColor(r));
    assert.ok(red > b + 60, `${r}%/yr should be orange/red`);
  }
  assert.equal(L.trendWords(-0.43), "Shrinking 0.4% a year");
  assert.equal(L.trendWords(1.96), "Growing 2.0% a year");
  assert.equal(L.trendWords(0.04), "About the same size");
  assert.equal(L.trendWords(null), "No trend in our sources");
});

test("the past: popAt reads the UN estimates before startYear and joins the forecast smoothly; trendAt looks back 5 years", () => {
  const s = { estimateStartYear: 2020, startYear: 2024, endYear: 2027, places: { AAA: { estimate: [100, 110, 121, 133.1], medium: [146.41, 150, 150, 150], constant: [146.41, 140, 130, 120] } } };
  assert.equal(L.firstYear(s), 2020);
  assert.equal(L.popAt(s, "AAA", 2021), 110);
  assert.equal(L.popAt(s, "AAA", 2023.5), (133.1 + 146.41) / 2, "between the last estimate and the first forecast year");
  assert.equal(L.popAt(s, "AAA", 2019), 100, "clamped to the first year");
  assert.equal(L.popAt(s, "AAA", 2022, "constant"), 121, "both futures share the past");
  // 2020 → 2024 is +10% a year (4 years of data before 2025).
  assert.ok(Math.abs(L.trendAt(s, "AAA", 2024) - 10) < 1e-9);
  // At the first year: the change into the next year.
  assert.ok(Math.abs(L.trendAt(s, "AAA", 2020) - 10) < 1e-9);
  // A file without the past still works from startYear.
  const old = { startYear: 2024, endYear: 2025, places: { AAA: { medium: [100, 90], constant: [100, 80] } } };
  assert.equal(L.firstYear(old), 2024);
  assert.equal(L.popAt(old, "AAA", 2000), 100);
  // The published file: Ukraine was shrinking fast in 2026 (the war years), though the UN expected refugees back in 2025.
  assert.equal(scen.estimateStartYear, 1950);
  assert.ok(L.trendAt(scen, "UKR", 2026) < -1.5, `UKR 2026: ${L.trendAt(scen, "UKR", 2026)}`);
  assert.ok(L.popAt(scen, "UKR", 1990) > 50e6, "Ukraine had over 50 million people in 1990");
  assert.equal(L.TREND[L.trendStep(L.trendAt(scen, "NGA", 2026))].label, "Growing");
});

test("past years in captions and post text", () => {
  assert.equal(L.peopleCaption(1.34, 1990, 2026), "In 1990: 13 for every 10 today.");
  assert.equal(L.peopleCaption(1.01, 2015, 2026), "About as many in 2015 as today.");
  assert.equal(L.peopleCaption(0.6, 2070, 2026), "6 of 10 still here in 2070.");
  const rec = { iso3: "UKR", name: "Ukraine", tfr: { value: 0.988 } };
  assert.equal(L.snapshotPostText({ rec, year: 1990, today: 2026, scenario: "medium", ratio: 1.33, lastEstimate: 2023 }), "Ukraine in 1990: about 133 people for every 100 today (UN estimate). 0.99 babies per woman today.");
  // 2025 was not counted: it is the selected future, like the picture's footer.
  assert.equal(L.snapshotPostText({ rec, year: 2025, today: 2026, scenario: "constant", ratio: 0.99, lastEstimate: 2023 }), "Ukraine in 2025: about 99 people for every 100 today (if birth rates stay the same). 0.99 babies per woman today.");
});

test("rounding ties: the printed %, its color and its word always agree, on both sides of every band edge", () => {
  // Halves round away from zero on both signs (Math.round alone would turn −49.5 into −49 while fmtPct prints −50%).
  assert.equal(L.roundPct(-49.5), -50);
  assert.equal(L.roundPct(49.5), 50);
  assert.equal(L.roundPct(-24.5), -25);
  assert.equal(L.roundPct(-5.5), -6);
  assert.equal(L.roundPct(5.5), 6);
  assert.equal(L.roundPct(-0.45), -0.5);
  assert.equal(L.roundPct(-0.04), 0);
  assert.equal(L.roundPct(null), null);
  const parse = (t) => {
    const m = /^([+−])?(\d+(?:\.\d)?)%$/.exec(t);
    return m ? (m[1] === "−" ? -1 : 1) * Number(m[2]) : null;
  };
  const edges = [];
  for (const e of [5, 25, 50]) for (const sgn of [-1, 1]) for (const d of [-0.5, -0.49, 0, 0.49, 0.5]) edges.push(sgn * (e + d));
  for (const x of edges) {
    const shown = parse(L.fmtPct(x));
    assert.equal(shown, L.roundPct(x), `fmtPct(${x}) = ${L.fmtPct(x)}`);
    assert.equal(L.outlookOf(x)?.label, L.outlookOf(shown)?.label, `word for ${x} (shown ${L.fmtPct(x)})`);
    assert.equal(L.changeColor(x), L.changeColor(shown), `color for ${x} (shown ${L.fmtPct(x)})`);
  }
  assert.equal(L.outlookOf(-49.5).label, "Shrinking fast");
  assert.equal(L.fmtPct(-49.5), `${M}50%`);
  assert.equal(L.outlookOf(-24.5).label, "Shrinking fast");
  assert.equal(L.fmtPct(-24.5), `${M}25%`);
  assert.equal(L.outlookOf(-5.5).label, "Shrinking");
  assert.equal(L.fmtPct(-5.5), `${M}6%`);
  assert.equal(L.outlookOf(5.5).label, "Growing");
  assert.equal(L.outlookOf(-4.5).label, "About the same", "−4.5 prints −5%: still about the same");
});

test("scenarios: popAt interpolates fractional years; % is measured against today's UN forecast", () => {
  const s = { startYear: 2024, endYear: 2027, places: { AAA: { medium: [100, 90, 80, 70], constant: [100, 85, 70, 55] } } };
  assert.equal(L.popAt(s, "AAA", 2024), 100);
  assert.equal(L.popAt(s, "AAA", 2025.5), 85);
  assert.equal(L.popAt(s, "AAA", 2027, "constant"), 55);
  assert.equal(L.popAt(s, "AAA", 2030), 70, "clamped to the last year");
  assert.equal(L.popAt(s, "ZZZ", 2025), null);
  assert.equal(L.popAt({ ...s, places: { AAA: { medium: [100, null, 80, 70] } } }, "AAA", 2025), null);
  assert.equal(L.todayYear(s, new Date("2026-06-01")), 2026);
  assert.equal(L.todayYear(s, new Date("2031-06-01")), 2027);
  assert.equal(L.todayYear(s, new Date("2020-06-01")), 2024);
  // Both scenarios share one baseline: today's UN forecast.
  assert.equal(L.ratioVsToday(s, "AAA", 2027, "medium", 2025), 70 / 90);
  assert.equal(L.ratioVsToday(s, "AAA", 2027, "constant", 2025), 55 / 90);
  assert.ok(Math.abs(L.pctVsToday(s, "AAA", 2026, "medium", 2025) - (80 / 90 - 1) * 100) < 1e-9);
  assert.equal(L.normScenario("constant"), "constant");
  assert.equal(L.normScenario("bogus"), "medium");
  assert.deepEqual(L.SCENARIO_LABELS, { medium: "UN forecast", constant: "If birth rates stay the same" });
});

test("scenarios.json follows the §7 contract the globe reads", () => {
  assert.equal(scen.startYear, 2024);
  assert.equal(scen.endYear, 2100);
  const n = scen.endYear - scen.startYear + 1;
  assert.ok(scen.places.WLD, "WLD included");
  for (const c of countries) {
    const p = scen.places[c.iso3];
    assert.ok(p, `${c.iso3} missing from scenarios.json`);
    assert.equal(p.medium.length, n, c.iso3);
    assert.equal(p.constant.length, n, c.iso3);
  }
  // Taiwan shrinks in both futures; the world still grows in the UN forecast.
  const today = L.todayYear(scen);
  assert.ok(L.pctVsToday(scen, "TWN", 2100, "medium", today) < -40);
  assert.ok(L.pctVsToday(scen, "TWN", 2100, "constant", today) < L.pctVsToday(scen, "TWN", 2100, "medium", today));
  assert.ok(L.pctVsToday(scen, "WLD", 2100, "medium", today) > 0);
});

test("person icons: kept, lost and extra green icons for a ratio vs today", () => {
  assert.deepEqual(L.peopleIcons(1), { kept: 10, lost: 0, extra: 0 });
  const half = L.peopleIcons(0.437);
  assert.ok(Math.abs(half.kept - 4.37) < 1e-9 && Math.abs(half.lost - 5.63) < 1e-9 && half.extra === 0);
  const grow = L.peopleIcons(2.5, 10);
  assert.equal(grow.kept, 10);
  assert.equal(grow.extra, 15);
  assert.deepEqual(L.peopleIcons(null), { kept: 10, lost: 0, extra: 0 });
  assert.deepEqual(L.iconFills(4.3, 6).map((f) => Math.round(f * 10) / 10), [1, 1, 1, 1, 0.3, 0]);
});

test("number formatting", () => {
  assert.equal(L.fmtTfr(0.748), "0.75");
  assert.equal(L.fmtTfr(2.1), "2.10");
  assert.equal(L.fmtTfr(null), "–");
  assert.equal(L.fmtCompact(51684564), "51.7M");
  assert.equal(L.fmtCompact(820000), "820K");
  assert.equal(L.fmtCompact(8215424893), "8.22B");
  assert.equal(L.fmtCompact(999.6), "1K");
  assert.equal(L.fmtCompact(640), "640");
  assert.equal(L.fmtCompact(-352000), `${M}352K`);
  assert.equal(L.fmtWords(21848795), "21.8 million");
  assert.equal(L.fmtWords(8215424893), "8.22 billion");
  assert.equal(L.fmtWords(820000), "820,000");
  assert.deepEqual(L.splitWords(10180160751), { num: "10.2", unit: "billion" });
  assert.deepEqual(L.splitWords(15023000), { num: "15", unit: "million" });
  assert.deepEqual(L.splitWords(820000), { num: "820,000", unit: "" });
  assert.equal(L.fmtFlow(231394), "+231,000");
  assert.equal(L.fmtFlow(-352000), `${M}352,000`);
  assert.equal(L.fmtFlow(554), "+554");
  assert.equal(L.fmtFlow(70458654), "+70.5 million");
  assert.equal(L.fmtFlow(0), "0");
  assert.equal(L.fmtPct(-57.8), `${M}58%`);
  assert.equal(L.fmtPct(12.3), "+12%");
  assert.equal(L.fmtPct(-0.4), `${M}0.4%`);
  assert.equal(L.fmtPct(0.04), "0%");
  assert.equal(L.fmtPct(57.8, { plus: false }), "58%");
  assert.equal(L.fmtRate(-6.7, { plus: true }), `${M}6.7`);
  assert.equal(L.fmtInt(1811507), "1,811,507");
  assert.equal(L.fmtDate("2026-10-26T23:32:59Z"), "26 Oct 2026");
  assert.ok(!L.fmtPct(-5).includes("-"), "true minus sign, never a hyphen");
  assert.deepEqual(L.niceTicks(0, 51858481), [0, 20000000, 40000000, 60000000]);
  assert.deepEqual(L.axisUnit(23e6), { div: 1e6, unit: "million" });
  assert.deepEqual(L.axisUnit(10.3e9), { div: 1e9, unit: "billion" });
  assert.deepEqual(L.axisUnit(52000), { div: 1e3, unit: "thousand" });
});

test("generations: 100 people, each generation × tfr / 2.1", () => {
  assert.deepEqual(L.generationCounts(1.14).map(L.fmtCount), ["100", "54", "29", "16", "8.7"]);
  assert.deepEqual(L.generationCounts(0.87, 4).map(L.fmtCount), ["100", "41", "17", "7.1"]);
  assert.equal(L.nextGeneration(2.1), 100);
  assert.deepEqual(L.generationCounts(null), []);
  assert.equal(L.generationsSentence(0.87), "At 0.87 babies per woman, 100 people have about 41 children, 17 grandchildren and 7 great-grandchildren.");
  assert.match(L.generationsSentence(6.03), /each generation is bigger/);
  assert.equal(L.generationsSentence(1.5, { whatIfName: "Taiwan" }), "What if Taiwan had 1.50 babies per woman? 100 people have about 71 children, 51 grandchildren and 36 great-grandchildren.");
  assert.match(L.generationsSentence(3, { whatIfName: "the Philippines" }), /^What if the Philippines had 3\.00 babies per woman\? Each generation is bigger/);
  assert.equal(L.fmtPeople(7.1), "7");
  assert.equal(L.fmtPeople(0.3), "less than 1");
});

test("routes: clean paths, legacy /#KOR and /KOR, lowercase codes, the shareable query", () => {
  const r = L.parseRoute;
  assert.deepEqual(r("/", "", ""), { page: "globe", iso3: null, year: null, scenario: null, focus: null, redirect: null });
  assert.deepEqual(r("/", "?year=2070&scenario=constant&focus=twn", ""), { page: "globe", iso3: null, year: 2070, scenario: "constant", focus: "TWN", redirect: null });
  assert.deepEqual(r("/", "", "#KOR"), { page: "country", iso3: "KOR", year: null, scenario: null, focus: null, redirect: "/country/KOR" });
  assert.equal(r("/", "", "#kor").redirect, "/country/KOR");
  assert.equal(r("/", "", "#data").page, "globe", "longer hashes are ordinary anchors");
  assert.deepEqual(r("/country/TWN", "", ""), { page: "country", iso3: "TWN", year: null, scenario: null, focus: null, redirect: null });
  assert.equal(r("/country/twn", "", "").redirect, "/country/TWN");
  assert.equal(r("/country/TWN/", "", "").redirect, "/country/TWN");
  assert.equal(r("/rankings", "", "").page, "rankings");
  assert.equal(r("/rankings/", "", "").redirect, "/rankings");
  assert.equal(r("/KOR", "", "").redirect, "/country/KOR");
  assert.equal(r("/fertility-tracker/KOR", "", "").redirect, "/country/KOR");
  assert.equal(r("/index.html", "", "").page, "globe");
  assert.equal(r("/nope/here", "", "").page, "notfound");
  assert.equal(r("/", "?year=abc&scenario=x&focus=toolong", "").year, null);
  assert.equal(r("/", "?scenario=x", "").scenario, null);
  assert.equal(L.buildQuery({ year: 2100, scenario: "medium" }), "");
  assert.equal(L.buildQuery({ year: 2070, scenario: "constant", focus: "twn" }), "?year=2070&scenario=constant&focus=TWN");
  assert.equal(L.buildQuery({ year: 2050 }, { defaultYear: 2100 }), "?year=2050");
  assert.equal(L.countryPath("KOR"), "/country/KOR");
  assert.equal(L.pageUrl("KOR"), "https://fertility-tracker-live.vercel.app/country/KOR");
  assert.equal(L.pageUrl(null), "https://fertility-tracker-live.vercel.app/");
  assert.equal(L.pageUrl("JPN", "https://example.org"), "https://example.org/country/JPN");
});

test("GitHub issue URLs: template + title + only the template's field ids, never labels=", () => {
  const kor = { iso3: "KOR", name: "South Korea" };
  const url = L.buildIssueUrl(feedback, "data-problem", kor);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://github.com/RostyslavDzhohola/fertility-tracker/issues/new");
  assert.equal(u.searchParams.get("template"), "data-problem.yml");
  assert.equal(u.searchParams.get("title"), "[Data] South Korea: ");
  assert.equal(u.searchParams.get("country"), "KOR");
  assert.equal(u.searchParams.get("page"), "https://fertility-tracker-live.vercel.app/country/KOR");
  assert.ok(!url.includes("labels="));
  for (const key of u.searchParams.keys()) assert.ok(["template", "title", ...Object.keys(feedback.github.templates["data-problem"].fields)].includes(key), key);
  const world = new URL(L.buildIssueUrl(feedback, "feedback", { iso3: "WLD", name: "World" }));
  assert.equal(world.searchParams.get("country"), "World");
  const chooser = new URL(L.buildChooserUrl(feedback, kor));
  assert.equal(chooser.pathname, "/RostyslavDzhohola/fertility-tracker/issues/new/choose");
  assert.deepEqual([...chooser.searchParams.keys()].sort(), ["country", "page"]);
  assert.equal(L.buildIssueUrl(feedback, "missing-template", kor), null);
  assert.equal(L.buildIssueUrl(null, "data-problem", kor), null);
});

test("mailto link carries subject and body; falls back to the brief's address", () => {
  const m = L.buildMailto(feedback, { iso3: "JPN", name: "Japan" });
  assert.ok(m.startsWith("mailto:andromedus+fertility@mail.grokbot.com?subject="));
  const q = new URLSearchParams(m.split("?")[1]);
  assert.equal(q.get("subject"), "Fertility Tracker feedback: Japan");
  assert.equal(q.get("body"), "Page: https://fertility-tracker-live.vercel.app/country/JPN\n\nWhat should we fix or add?\n");
  assert.ok(L.buildMailto(null, { iso3: "JPN", name: "Japan" }).startsWith(`mailto:${L.FALLBACK_EMAIL}?`));
});

test("email works without a mail program: Gmail and Outlook links carry the same address, subject and body", () => {
  const m = L.buildEmailLinks(feedback, { iso3: "JPN", name: "Japan" });
  const gmail = new URL(m.gmail);
  assert.equal(gmail.origin, "https://mail.google.com");
  assert.equal(gmail.searchParams.get("view"), "cm");
  assert.equal(gmail.searchParams.get("to"), "andromedus+fertility@mail.grokbot.com");
  assert.equal(gmail.searchParams.get("su"), "Fertility Tracker feedback: Japan");
  assert.equal(gmail.searchParams.get("body"), m.body);
  const outlook = new URL(m.outlook);
  assert.equal(outlook.origin, "https://outlook.live.com");
  assert.equal(outlook.searchParams.get("to"), m.address);
  assert.equal(outlook.searchParams.get("subject"), m.subject);
  assert.equal(outlook.searchParams.get("body"), m.body);
  assert.equal(m.mailto, L.buildMailto(feedback, { iso3: "JPN", name: "Japan" }));
});

test("born, died, moved add up over the years and say whether moving in holds a place up", () => {
  const series = [
    { year: 2026, births: 700, deaths: 1000, netMigration: 200 },
    { year: 2027, births: 700, deaths: 1000, netMigration: 200 },
    { year: 2028, births: 700, deaths: 1000, netMigration: 200 },
  ];
  const f = L.flowsBetween(series, 2026, 2027);
  assert.deepEqual(f, { from: 2026, to: 2027, years: 2, births: 1400, deaths: 2000, netMigration: 400, natural: -600, change: -200 });
  assert.equal(L.flowsSentence(f, "Germany"), "600 more people die than are born. Immigration cuts the loss to 200.");
  assert.equal(L.flowsSentence({ ...f, netMigration: 700, change: 100 }, "the United States"), "600 more people die than are born. Immigration adds 700, so the United States still grows.");
  assert.equal(L.yearlyNetSentence(-57900, 2023), "In 2023, 57,900 more people left than arrived.");
  assert.equal(L.flowsSentence({ ...f, netMigration: -100 }, "Germany"), "More people die than are born, and more people leave than arrive.");
  assert.equal(L.flowsSentence({ ...f, netMigration: 5 }, "Germany"), "More people die than are born. Immigration barely changes it.");
  assert.equal(L.flowsSentence({ births: 3, deaths: 1, netMigration: 0, natural: 2 }, "the world", { world: true }), "More babies are born than people die. Moving doesn't change the world's total.");
  // From 1 July 2026 to 1 July 2028: half of 2026, all of 2027, half of 2028.
  assert.deepEqual(L.flowsBetween(series, 2026, 2028, { midyear: true }), { from: 2026, to: 2028, years: 3, births: 1400, deaths: 2000, netMigration: 400, natural: -600, change: -200 });
  assert.equal(L.flowsSentence({ births: null, deaths: null, netMigration: 0, natural: null }, "Germany"), "No yearly figures for births, deaths and moving.");
  assert.equal(L.flowsBetween(series, 2030, 2040), null);
  assert.equal(L.flowsBetween([{ year: 2026, births: null, deaths: 1 }], 2026, 2026), null);
});

test("shared-picture words follow the slider year and the chosen future", () => {
  const rec = { iso3: "TWN", name: "Taiwan", tfr: { value: 0.87 } };
  assert.equal(L.snapshotPostText({ rec, year: 2070, today: 2026, scenario: "medium", ratio: 0.65 }), "Taiwan in 2070: for every 100 people today, about 65 left (UN forecast). 0.87 babies per woman today.");
  assert.equal(L.snapshotPostText({ rec, year: 2100, today: 2026, scenario: "constant", ratio: 1.2 }), "Taiwan in 2100: for every 100 people today, about 120 (if birth rates stay the same). 0.87 babies per woman today.");
  assert.equal(L.slugOf({ iso3: "CIV", name: "Côte d'Ivoire" }), "cote-d-ivoire");
  assert.equal(L.slugOf({ iso3: "WLD", name: "World" }), "world");
  assert.equal(L.peopleCaption(0.88, 2100, 2026), "9 of 10 still here in 2100.");
  assert.equal(L.peopleCaption(1.2, 2060, 2026), "12 for every 10 today.");
});

test("X handle stays hidden while it is a TODO_ placeholder", () => {
  assert.equal(feedback.x.handle.startsWith("TODO_"), true);
  assert.equal(L.xHandle(feedback), null);
  assert.equal(L.xProfileUrl(feedback), null);
  assert.equal(L.xHandle({ x: { handle: "@FertilityTrack" } }), "FertilityTrack");
});

test("search: names, aliases, ISO3 codes, diacritics, typos; ties go to the larger population", () => {
  const places = countries.map((c) => ({ iso3: c.iso3, name: c.name, population: c.population?.value ?? 0 }));
  assert.equal(places.length, 238);
  const first = (q) => L.searchPlaces(places, q)[0]?.iso3;
  // DESIGN-v3 §9 item 6.
  for (const [q, want] of [
    ["taiwan", "TWN"],
    ["taiwn", "TWN"],
    ["tiawan", "TWN"],
    ["korea", "KOR"],
    ["south korea", "KOR"],
    ["sout korea", "KOR"],
    ["uk", "GBR"],
    ["ivory coast", "CIV"],
    ["hong kong", "HKG"],
    ["hongkong", "HKG"],
    ["macau", "MAC"],
    ["czech", "CZE"],
    ["czeck", "CZE"],
    ["türkiye", "TUR"],
    ["turkiye", "TUR"],
    ["turkey", "TUR"],
    ["TWN", "TWN"],
    ["kor", "KOR"],
    ["jpn", "JPN"],
    ["CÔTE D’IVOIRE", "CIV"],
    ["earth", "WLD"],
    ["germny", "DEU"],
    ["phillipines", "PHL"],
    ["swiss", "CHE"],
    ["tw", "TWN"],
    ["ch", "CHE"],
    ["gb", "GBR"],
    ["dutch", "NLD"],
  ])
    assert.equal(first(q), want, `"${q}" should find ${want}, got ${first(q)}`);
  assert.deepEqual(L.searchPlaces(places, "korea").slice(0, 2).map((p) => p.iso3), ["KOR", "PRK"]);
  assert.deepEqual(L.searchPlaces(places, "zzzzzz"), []);
  assert.deepEqual(L.searchPlaces(places, "   "), []);
  assert.equal(L.searchPlaces(places, "a", 3).length, 3);
  // Every place can be found by its own name and its code.
  for (const p of places) {
    assert.ok(L.searchPlaces(places, p.name, 8).some((x) => x.iso3 === p.iso3), `name ${p.name}`);
    assert.equal(first(p.iso3), p.iso3, `code ${p.iso3}`);
  }
  assert.equal(L.editDistance("taiwn", "taiwan"), 1);
  assert.equal(L.editDistance("cehck", "check"), 1, "adjacent swap counts once");
  assert.ok(L.editDistance("abcdef", "uvwxyz", 2) > 2);
  assert.deepEqual(L.matchRange("Côte d'Ivoire", "cote d"), [0, 6]);
  assert.deepEqual(L.matchRange("South Korea", "KOR"), [6, 9]);
  assert.equal(L.normalizeText("Guinea-Bissau"), "guinea bissau");
});

test("plain verdicts and the 100-people sentence", () => {
  const twn = countries.find((c) => c.iso3 === "TWN");
  const today = L.todayYear(scen);
  const p = L.pctVsToday(scen, "TWN", 2100, "medium", today);
  assert.equal(L.verdict(twn, p, today, { peakYear: 2026 }), "Taiwan loses half its people or more by 2100.");
  assert.equal(L.verdictShort(p), "shrinking fast by 2100");
  assert.equal(L.verdict({ name: "X" }, -30, 2026, { peakYear: 2026 }), "X is shrinking fast.");
  assert.equal(L.verdict({ name: "X" }, -20, 2026, { peakYear: 2060 }), "X grows for a while, then shrinks.");
  assert.equal(L.verdict({ name: "X" }, 0, 2026, { peakYear: 2026 }), "X stays about the same size.");
  assert.equal(L.verdict({ name: "X" }, 150, 2026, { peakYear: 2100 }), "X keeps growing fast.");
  assert.equal(L.verdict({ iso3: "WLD", name: "World" }, 24, 2026, { peakYear: 2084 }), "The world keeps growing until about 2084, then levels off.");
  assert.equal(L.verdict({ name: "X" }, null, 2026), "X: no forecast in our sources.");
  assert.equal(L.verdict({ iso3: "USA", name: "United States" }, -30, 2026, { scenario: "constant", peakYear: 2026 }), "If birth rates stay the same, the United States is shrinking fast.");
  assert.equal(L.verdict({ iso3: "VAT", name: "Vatican", flags: ["small-population"] }, 169, 2026), "The Vatican has a very small population: its numbers swing a lot.");
  // Names that take "the".
  assert.equal(L.theName({ iso3: "USA", name: "United States" }), "the United States");
  assert.equal(L.theName({ iso3: "GBR", name: "United Kingdom" }, { start: true }), "The United Kingdom");
  assert.equal(L.theName({ iso3: "PHL", name: "Philippines" }), "the Philippines");
  assert.equal(L.possessiveOf({ iso3: "USA", name: "United States" }), "the United States'");
  assert.equal(L.possessiveOf({ iso3: "TWN", name: "Taiwan" }), "Taiwan's");
  assert.equal(L.hundredSentence({ iso3: "NLD", name: "Netherlands" }, 0.9), "For every 100 people in the Netherlands today, about 90 will be left in 2100 (UN forecast).");
  assert.equal(L.hundredSentence(twn, 0.43), "For every 100 people in Taiwan today, about 43 will be left in 2100 (UN forecast).");
  assert.equal(L.hundredSentence({ name: "Niger" }, 3.5), "For every 100 people in Niger today, there will be about 350 in 2100 (UN forecast).");
  assert.equal(L.hundredSentence({ name: "X" }, 1.01, "constant"), "For every 100 people in X today, there will still be about 100 in 2100 (If birth rates stay the same).");
  assert.equal(L.tfrReason(twn), "0.87 babies per woman; 2.1 keeps a country the same size");
  assert.equal(L.birthsDeathsReason(twn, 2023), "More deaths than births since 2019");
  assert.equal(L.migrationSentence(-32777), `32,800 more people leave than arrive each year.`);
  assert.equal(L.migrationSentence(87800), "87,800 more people arrive than leave each year.");
  assert.equal(L.migrationSentence(10), "About as many people move in as move out.");
  assert.match(L.bornDiedSentence(twn.components), /^132,000 born and 205,000 died in 2023: more people die than are born\.$/);
  assert.equal(L.documentTitle("country", twn, p), "Taiwan: shrinking fast by 2100 · Fertility Tracker");
  assert.equal(L.documentTitle("rankings"), "Where populations will shrink most · Fertility Tracker");
  assert.equal(L.documentTitle("globe"), L.HOME_TITLE);
  assert.match(L.xPostText(twn, 0.437), /^Taiwan: 0\.87 babies per woman\. For every 100 people today, about 44 will be left in 2100 \(UN forecast\)\.$/);
  assert.equal(L.rankLabel(twn, 200), "#3 of 200");
  assert.equal(L.rankLabel({ iso3: "XXX", flags: ["small-population"], risk: {} }, 200), "Not ranked (under 100,000 people)");
});

test("projected % from the API is shown against its own UN base year", () => {
  const nga = { projection: { baseYear: 2023, basePopulation: 227882949, population2100: 476747779, change2100Pct: 109.2 } };
  assert.deepEqual(L.projectionBase(nga), { year: 2023, population: 227882949 });
  const bare = { projection: { population2100: 150, change2100Pct: 50 } };
  assert.deepEqual(L.projectionBase(bare, { series: [{ year: 2023, population: 101 }] }), { year: 2023, population: 101 });
  assert.equal(Math.round(L.projectionBase(bare).population), 100);
});

test("chart helpers: end labels spread apart and stay in bounds; peak finding", () => {
  const ys = L.spreadLabels([100, 104, 106], 14, 0, 200);
  const sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 14 - 1e-9);
  assert.ok(Math.max(...L.spreadLabels([195, 198], 14, 0, 200)) <= 200);
  assert.deepEqual(L.peakOf([[1950, 1], [2019, 9], [2100, 4]]), [2019, 9]);
  assert.equal(L.peakOf([]), null);
});

test("how sure: the head count says how old it is, whether the UN uses it, and when a newer figure disagrees", () => {
  const t = { level: "poor", lastCount: 2001, unCensuses: [1989, 2001], unRegisters: [], register: false, latestCensus: { date: "2001-12-05", total: 48240902 }, downgraded: false };
  assert.equal(L.sureTodayText(t, 2026), "Last census: 2001, 25 years ago. Since then, the UN adds births and deaths and estimates who moved.");
  const newer = { ...t, level: "fair", lastCount: 2024, latestCensus: { date: "2024-05-09", total: 45905417 }, downgraded: true };
  assert.equal(
    L.sureTodayText(newer, 2026),
    "Last census: 2024, 2 years ago. The UN's numbers don't use it yet: they rest on the 2001 count. The country's newest official figure is more than 5% away from the UN's: see below.",
  );
  assert.equal(L.sureTodayWord(newer), "Official figure differs");
  assert.equal(L.sureTodayWord(t), "Not counted in a long time");
  assert.match(L.sureTodayText({ ...t, register: true }, 2026), /population register/);
  assert.match(L.sureTodayText({ ...t, lastCount: null }, 2026), /^No census on record/);
});

test("how sure: births and deaths, people born abroad and the forecast in plain words", () => {
  assert.equal(L.sureBirthsDeathsText({ level: "good", births: { year: 2025, code: "C" }, deaths: { year: 2025, code: "C" } }), "Every birth and death is registered (latest year reported: 2025).");
  assert.match(L.sureBirthsDeathsText({ level: "fair", births: { year: 2024, code: "U" }, deaths: { year: 2024, code: "U" } }), /some are missed/);
  assert.match(L.sureBirthsDeathsText({ level: "poor", births: null, deaths: null }), /from surveys/);
  assert.equal(L.sureImmigrationText({ dataType: "B", reassessed2024: false, refugeesAdded: false }), "Counted by country of birth. The UN carried its 2020 figure forward to 2024.");
  assert.equal(
    L.sureImmigrationText({ dataType: "C", reassessed2024: true, refugeesAdded: true }),
    "Counted by citizenship, which misses people who became citizens, and updated by the UN for 2024. Refugees counted by the UN refugee agency are added.",
  );
  assert.match(L.sureImmigrationText({ dataType: "I", reassessed2024: false }), /^No count exists/);
  assert.equal(L.sureImmigrationText({ dataType: null }), null);
  const f = { at: [{ year: 2050, medium: 381e6, lower95: 342e6, upper95: 420e6, zeroMigration: 350e6 }, { year: 2100, medium: 421e6, lower95: 256e6, upper95: 625e6, zeroMigration: 268e6 }] };
  assert.equal(L.sureForecastText(f), "The UN gives a 95% chance of 342M to 420M people in 2050 (its forecast: 381M), and 256M to 625M in 2100. If nobody moved in or out, 268M in 2100 instead of 421M.");
});

test("how sure: one summary sentence names the weakest part", () => {
  const ukr = countries.find((c) => c.iso3 === "UKR");
  const conf = (o) => ({ level: "poor", today: { level: "poor", lastCount: 2001 }, birthsDeaths: { level: "good" }, ...o });
  assert.equal(L.sureSummary(ukr, conf(), 2026), "Ukraine's numbers are mostly estimated: its last census was in 2001.");
  assert.equal(
    L.sureSummary(ukr, conf({ level: "good", today: { level: "good", lastCount: 2022 } }), 2026),
    "Ukraine's numbers are solid: its last census was in 2022, and every birth and death is registered.",
  );
  assert.equal(L.sureSummary(ukr, conf({ level: "fair", today: { level: "good", lastCount: 2022 }, birthsDeaths: { level: "fair" } }), 2026), "Ukraine's numbers are partly estimated: not every birth and death is registered.");
  assert.equal(L.sureSummary(ukr, { level: null }, 2026), null);
});

test("how sure: automatic comparisons with newer national figures, in words", () => {
  const today = { kind: "eurostat", key: "today", figure: { value: 83467117, date: "2026-01-01" }, unFigure: { value: 83859667 }, gapPct: 0.5, verdict: "matches" };
  assert.equal(L.checkText(today), "The national statistics office counted 83.5 million people on 1 Jan 2026 (reported to Eurostat). The UN's figure for that day is 83.9 million (within 2%).");
  const births = { kind: "unsd", key: "births", figure: { value: 433678, date: "2025" }, unFigure: { value: 692792, forecast: true }, gapPct: 59.7, verdict: "un-higher" };
  assert.equal(L.checkText(births), "434,000 births were registered in 2025, with registration reported as complete. The UN forecast 693,000: the UN's is 60% higher.");
  const fb = { kind: "eurostat", key: "immigrants", figure: { value: 940259, date: "2025-01-01" }, unFigure: { value: 1739901 }, gapPct: 85, verdict: "un-higher", unAddsRefugees: true };
  assert.match(L.checkText(fb), /the UN's is 85% higher\. The UN adds refugees, whom national counts often leave out\.$/);
  assert.match(L.checkText({ ...today, gapPct: -2.4, verdict: "un-lower" }), /the UN's is 2\.4% lower\.$/);
  assert.equal(L.checkText({ kind: "researched", text: "Hand-checked." }), "Hand-checked.");
});
