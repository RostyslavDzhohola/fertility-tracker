// The country page `/country/{ISO3}` (DESIGN-v3 §3): a vertical visual story. Each block is one picture and at most
// one sentence. Numbers follow the shared year slider and scenario.

import { $, h, s, setText, setAttr, media, focusNoScroll, announce, copyText } from "./dom.js";
import * as L from "./logic.js";
import { data, state, subscribe, popNow, ratioNow, pctNow, pct2100, outlookPct, peakYear, loadDetail, cachedDetail, setYear, yearInt } from "./store.js";
import { createTimeControls } from "./controls.js";
import { createPopChart } from "./charts.js";
import { peopleRow } from "./people.js";
import { emailLink } from "./ui.js";
import { openShare, renderSnapshot, chartVisual } from "./snapshot.js";
import { sourced, setSourceNavigate, closeSource, refreshSource, checkNote, SRC, WB_INDICATORS, wbIndicatorUrl } from "./sources.js";

const GEN_LABELS = ["Today", "Children", "Grandchildren", "Great-grandchildren"];

// Countries that were one country until the early 1990s. People who moved inside the Soviet Union, Yugoslavia or
// Czechoslovakia became "born abroad" when it broke up, without moving again.
const BREAKUPS = [
  { name: "the Soviet Union", until: 1991, members: ["ARM", "AZE", "BLR", "EST", "GEO", "KAZ", "KGZ", "LTU", "LVA", "MDA", "RUS", "TJK", "TKM", "UKR", "UZB"] },
  { name: "Yugoslavia", until: 1992, members: ["BIH", "HRV", "MKD", "MNE", "SRB", "SVN", "XKX"] },
  { name: "Czechoslovakia", until: 1993, members: ["CZE", "SVK"] },
];
const breakupOf = (iso3) => BREAKUPS.find((b) => b.members.includes(iso3)) ?? null;

export function createCountryPage({ navigate, siteUrl }) {
  const el = {
    view: $("view-country"),
    story: $("story"),
    missing: $("cv-missing"),
    region: $("cv-region"),
    name: $("cv-name"),
    verdict: $("cv-verdict"),
    meter: $("cv-meter"),
    lede: $("cv-lede"),
    controls: $("cv-controls"),
    ppTitle: $("pp-title"),
    ppYear: $("pp-year"),
    ppNum: $("pp-num"),
    ppUnit: $("pp-unit"),
    ppPct: $("pp-pct"),
    ppGrid: $("pp-grid"),
    ppSentence: $("pp-sentence"),
    chTitle: $("ch-title"),
    chSentence: $("ch-sentence"),
    chart: $("pop-chart"),
    babies: $("why-babies"),
    born: $("why-born"),
    move: $("why-move"),
    genSentence: $("gen-sentence"),
    gens: $("gens"),
    whatif: $("whatif-range"),
    whatifOut: $("whatif-out"),
    whatifReset: $("whatif-reset"),
    more: $("more"),
    moreBody: $("more-body"),
    share: $("cv-share"),
    sureChip: $("cv-sure"),
    sure: $("sure"),
    sureSentence: $("sure-sentence"),
    sureRows: $("sure-rows"),
    sureChecksWrap: $("sure-checks-wrap"),
    sureChecks: $("sure-checks"),
    sureHow: $("sure-how"),
    chRange: $("ch-range"),
  };

  let current = null; // record
  let chartModel = null; // what the chart shows, for the shared picture
  let series = null; // the place's yearly UN figures, once its file has loaded
  let detailNow = null; // the place's full file (countries/{ISO3}.json), once loaded
  let token = 0;
  let whatIf = null;

  // What other sources say about the chart's "today" (hand-checked crossChecks), under the chart's sentence.
  el.chCheck = h("div", { class: "xcheck-wrap", hidden: true });
  el.chSentence.after(el.chCheck);
  // …and about immigration, under the "Why it's happening" tiles, so the tiles keep similar heights.
  el.whyCheck = h("div", { class: "xcheck-wrap", hidden: true });
  el.move.parentElement.after(el.whyCheck);

  const controls = createTimeControls({
    prefix: "cv",
    valueText: (y) => (current ? `${y}, ${current.name} ${L.fmtWords(popNow(current.iso3, y))}` : String(y)),
  });
  el.controls.replaceChildren(controls.root);

  const grid = peopleRow(el.ppGrid, { per: 100, maxExtra: 100, extraLabel: (n) => `+${n} more for every 100 today` });

  // The readout's number opens its source too, for whatever year the slider shows.
  {
    const at = el.ppNum.nextSibling;
    const parent = el.ppNum.parentNode;
    const btn = sourced(el.ppNum, () => (current ? popInfo(current, yearInt(), popNow(current.iso3, yearInt())) : null), { key: "pp-num", cls: "ro-src" });
    parent.insertBefore(btn, at);
  }

  const chart = createPopChart(el.chart, {
    onScrub: (yr) => setYear(yr, { animate: false }),
  });

  setSourceNavigate(navigate);

  // A hand-checked note on one of the place's numbers (countries/{ISO3}.json crossChecks; scripts/data/crosschecks.json).
  const crossCheck = (iso3, key) => (detailNow?.iso3 === iso3 ? (detailNow.crossChecks ?? []).find((c) => c.kind === "researched" && c.key === key) : null) ?? null;

  // ---------------------------------------------------------------- where each number comes from

  const apiOf = (rec) => `/api/v1/countries/${rec.iso3}.json`;
  const iso2Of = (rec) => Object.keys(L.ISO2).find((k) => L.ISO2[k] === rec.iso3) ?? null;
  const measured = (year) => year <= data.latestEstimateYear;
  const kindOf = (year) =>
    measured(year)
      ? "UN estimate: from censuses, population registers and surveys"
      : `UN forecast (medium scenario), made in 2024 from data up to ${data.latestEstimateYear}`;
  const forecastNote = (year) =>
    measured(year) ? null : `${year} hasn't been counted yet: this is what the UN expected in 2024. Its next update is due in July 2027.`;

  // A headline field ({ value, year, source }) from countries.json: World Bank or UN.
  function headlineInfo(rec, key, title) {
    const f = rec[key];
    if (!f) return null;
    if (f.source === "WB") {
      const code = WB_INDICATORS[key];
      return {
        title,
        rows: [
          ["Year", String(f.year)],
          ["Kind", "Reported by the World Bank (for many countries it is the UN's own estimate)"],
        ],
        src: SRC.wb,
        links: code ? [{ label: "World Bank chart for this country", href: wbIndicatorUrl(code, iso2Of(rec)) }] : [],
        api: { href: apiOf(rec), field: key },
      };
    }
    return {
      title,
      rows: [
        ["Year", String(f.year)],
        ["Kind", kindOf(f.year)],
      ],
      src: SRC.wpp,
      api: { href: apiOf(rec), field: key },
    };
  }

  // People in a year from the UN's paths (scenarios.json): the estimate, or the selected future.
  function popInfo(rec, year, value, scenario = state.scenario) {
    const future = year > data.latestEstimateYear;
    return {
      title: `${L.fmtWords(value)} people in ${L.theName(rec)} on 1 July ${year}`,
      rows: [
        ["Counts", "Everyone living there, wherever they were born"],
        ["Kind", future && scenario === "constant" ? "UN what-if: every country keeps its 2023 babies per woman (constant-fertility scenario)" : kindOf(year)],
      ],
      note: forecastNote(year),
      quote: detailNow?.iso3 === rec.iso3 && detailNow.confidence?.unSources?.population
        ? { text: detailNow.confidence.unSources.population, label: "What the UN based it on (WPP 2024 Data Sources)", href: SRC.wppDataSources.file }
        : null,
      // Ukraine's "today" rests on an assumed return of refugees: say what newer counts show.
      check: year > data.latestEstimateYear && year <= data.today ? crossCheck(rec.iso3, "today") : null,
      src: SRC.wppScenarios,
      api: { href: "/api/v1/scenarios.json", field: year < data.start ? `places.${rec.iso3}.estimate[${year - data.first}]` : `places.${rec.iso3}.${scenario}[${year - data.start}]` },
    };
  }

  // Births, deaths or net migration, one year or added up over a span (series from countries/{ISO3}.json).
  function flowInfo(rec, what, value, f) {
    const one = f.from === f.to;
    const span = one ? String(f.from) : `1 July ${f.from} to 1 July ${f.to}`;
    const words = {
      births: [`${L.fmtWords(value)} babies born in ${L.theName(rec)}`, "Live births", "Births"],
      deaths: [`${L.fmtWords(value)} people died in ${L.theName(rec)}`, "Deaths", "Deaths"],
      netMigration: [
        value < 0 ? `${L.fmtWords(Math.abs(value))} more people left ${L.theName(rec)} than moved in` : `${L.fmtWords(value)} more people moved to ${L.theName(rec)} than left`,
        "People who moved in minus people who moved out (the UN publishes only this net figure for every country)",
        "NetMigrations",
      ],
      naturalChange: [
        `Born minus died in ${L.theName(rec)}: ${L.fmtFlow(value)}`,
        "Births minus deaths, from the UN's own figures for each",
        "Births and Deaths",
      ],
      populationChange: [
        `${L.possessiveOf(rec, { start: true })} population changed by ${L.fmtFlow(value)}`,
        "Births minus deaths plus net immigration",
        "Births, Deaths and NetMigrations",
      ],
    }[what];
    return {
      title: `${words[0]}, ${one ? `in ${f.from}` : `${f.from}–${f.to}`}`,
      rows: [
        ["Counts", words[1]],
        [one ? "Year" : "Years", span],
        ["Kind", one ? kindOf(f.from) : f.to <= data.latestEstimateYear ? kindOf(f.to) : f.from > data.latestEstimateYear ? kindOf(f.to) : `UN estimates to ${data.latestEstimateYear}, then the UN forecast`],
      ],
      note: one ? forecastNote(f.from) : `Added up from the UN's yearly figures (${words[2]}), counting half of the first and last year, so it runs 1 July to 1 July like the population.${f.to > data.latestEstimateYear ? " Years after " + data.latestEstimateYear + " are the UN's 2024 forecast." : ""}`,
      src: SRC.wpp,
      api: { href: apiOf(rec), field: `series[year].${what}` },
    };
  }

  function stockInfo(rec, m, kind) {
    const where = L.theName(rec);
    const b = breakupOf(rec.iso3);
    const imm = kind === "immigrants";
    return {
      title: imm ? `${L.fmtWords(m.immigrants)} people living in ${where} were born in another country` : `${L.fmtWords(m.emigrants)} people born in ${where} live in another country`,
      rows: [
        ["Counts", `Everyone alive in mid-${m.year} ${imm ? `who lives in ${where} and was born elsewhere` : `who was born in ${where} and lives elsewhere`}, whenever they moved. Not one year's arrivals.`],
        ["Year", `Mid-${m.year}`],
        ["Kind", "UN estimate for mid-2024, from censuses and population registers. The UN fully reassessed 60 countries for 2024; for the rest it carried its 2020 estimate forward."],
      ],
      note: b && imm ? `${rec.name} was part of ${b.name} until ${b.until}. People who moved between its republics before then count as born abroad now, though they didn't cross a border at the time.` : null,
      check: imm ? crossCheck(rec.iso3, "immigrants") : null,
      src: imm ? SRC.desa : SRC.desaOrigin,
      api: { href: apiOf(rec), field: `migrantStock.${kind}` },
    };
  }

  function corridorInfo(rec, pp, dir) {
    const where = L.theName(rec);
    const other = pp.name;
    const people = L.fmtWords(pp.people);
    const b = breakupOf(rec.iso3);
    const shared = b && pp.iso3 && b.members.includes(pp.iso3);
    const link = pp.iso3 && data.records.has(pp.iso3) ? [{ label: `${other}: its own page →`, href: L.countryPath(pp.iso3), nav: true }] : [];
    return {
      title: dir === "in" ? `${people} people born in ${other} live in ${where}` : `${people} people born in ${where} live in ${other}`,
      rows: [
        ["Counts", "Everyone alive in mid-2024 with that country of birth and that country of residence, whenever they moved"],
        ["Year", "Mid-2024"],
        ["Kind", "UN estimate for mid-2024, from the country of residence's censuses and population registers. The UN fully reassessed 60 countries for 2024; for the rest it carried its 2020 estimate forward."],
      ],
      note: shared ? `Both were part of ${b.name} until ${b.until}: many of these people moved inside one country back then, and count as migrants since the breakup.` : null,
      src: SRC.desaCorridors,
      links: link,
      api: { href: apiOf(rec), field: dir === "in" ? "migrationCorridors.topOrigins" : "migrationCorridors.topDestinations" },
    };
  }

  // ---------------------------------------------------------------- hero

  // The meter says where the place is headed by 2100 under the selected scenario, on the globe legend's four words
  // and colors. The 0–100 risk score lives under "More numbers" only.
  function renderMeter(rec) {
    const small = rec.iso3 !== "WLD" && L.isSmallPlace(rec);
    const pct = pct2100(rec.iso3, state.scenario);
    const step = L.outlookStep(pct);
    if (small || step < 0) {
      // Micro-places: the verdict already says why there's no word, so no meter at all.
      el.meter.className = "meter none";
      el.meter.replaceChildren(...(small ? [] : [h("p", { class: "meter-none" }, "No forecast for this place.")]));
      setAttr(el.meter, "role", null);
      setAttr(el.meter, "aria-label", null);
      return;
    }
    const scen = state.scenario === "constant" ? ", if birth rates stay the same" : "";
    el.meter.className = "meter";
    setAttr(el.meter, "role", "img");
    setAttr(el.meter, "aria-label", `By 2100${scen}: ${L.OUTLOOK[step].label}, ${L.fmtPct(pct)} compared with today.`);
    el.meter.replaceChildren(
      h("p", { class: "meter-title", "aria-hidden": "true" }, `By 2100${scen}: `, h("b", null, L.OUTLOOK[step].label), h("span", { class: "meter-pct" }, ` ${L.fmtPct(pct)} vs today`)),
      h(
        "div",
        { class: "meter-track", "aria-hidden": "true" },
        ...L.OUTLOOK.map((o, i) => h("span", { class: `meter-seg${i === step ? " on" : ""}` }, h("i", { style: { background: L.outlookColor(i) } }), h("span", { class: "meter-word" }, o.label))),
      ),
    );
  }

  function renderHero(rec) {
    setText(el.region, rec.iso3 === "WLD" ? "Whole world" : rec.region ?? "");
    setText(el.name, rec.iso3 === "WLD" ? "The world" : rec.name);
    el.name.classList.toggle("long", rec.name.length > 22);
    const sc = state.scenario;
    const small = rec.iso3 !== "WLD" && L.isSmallPlace(rec);
    const p = pct2100(rec.iso3, sc);
    setText(el.verdict, L.verdict(rec, p, data.today, { scenario: sc, peakYear: peakYear(rec.iso3, sc), small }));
    el.verdict.dataset.band = small ? "" : L.changeBand(p) ?? "";
    renderMeter(rec);
    const r = L.ratioVsToday(data.scen, rec.iso3, data.end, sc, data.today);
    setText(el.lede, small ? "" : L.hundredSentence(rec, r, sc));
  }

  // ---------------------------------------------------------------- 100 people + chart (follow the slider)

  function renderLive() {
    if (!current) return;
    const iso3 = current.iso3;
    const y = yearInt();
    const v = popNow(iso3);
    const pct = pctNow(iso3);
    const sp = L.splitWords(v);
    setText(el.ppYear, y === data.today ? "Today" : String(y));
    setText(el.ppNum, sp.num);
    setText(el.ppUnit, sp.unit ? `${sp.unit} people` : "people");
    setText(el.ppPct, y === data.today || pct == null ? "" : L.fmtPct(pct));
    el.ppPct.dataset.band = L.changeBand(pct) ?? "";
    const r = ratioNow(iso3);
    grid.update(r);
    const n = r == null ? null : Math.round(r * 100);
    let sentence;
    if (r == null) sentence = "No forecast for this place.";
    else if (y === data.today) sentence = `Each figure is 1 in every 100 people in ${placeName()} today. Press Play to watch them change.${assumedSince()}`;
    else if (y < data.today) sentence = n === 100 ? `In ${y}, about as many people as today.` : `In ${y}, there were ${n} people for every 100 today.`;
    else if (n < 100) sentence = `In ${y}, ${n} of today's 100 are left${state.mix >= 0.5 ? " if birth rates stay the same" : ""}. Gray figures are people who are gone.`;
    else if (n > 100) sentence = `In ${y}, there are ${n} for every 100 today${state.mix >= 0.5 ? " if birth rates stay the same" : ""}. Green figures are new people.`;
    else sentence = `In ${y}, about the same number of people as today.`;
    setText(el.ppSentence, sentence);
    chart.update(state.year, state.mix);
    if (y !== lastFlowsYear) {
      lastFlowsYear = y;
      renderFlows();
      refreshSource();
    }
  }
  let lastFlowsYear = null;

  // Today's number is the UN's 2024 forecast (its last count is for latestEstimateYear). Where that forecast assumes a
  // lot of moving since then (2% of the people or more: Ukrainians coming home in 2024–2025), say so.
  // Said only where the forecast departs from the last counted year's pace by 2% of the people or more.
  function assumedSince() {
    if (!series || current?.iso3 === "WLD") return "";
    const est = data.latestEstimateYear;
    const last = series.find((r) => r.year === est);
    const base = last?.population;
    let net = 0;
    let years = 0;
    for (const r of series)
      if (r.year > est && r.year <= data.today && Number.isFinite(r.netMigration)) {
        net += r.netMigration;
        years++;
      }
    const pace = years * (last?.netMigration ?? 0);
    if (!base || !years || Math.abs(net - pace) < 0.02 * base) return "";
    const moved = (v) => (Math.abs(v) < 0.001 * base ? "about as many people moved in as left" : `${L.fmtWords(Math.abs(v))} more people ${v > 0 ? "moved in than left" : "left than moved in"}`);
    return ` Today's number is the UN's forecast from 2024 (its last count is for ${est}): it assumes ${moved(net)} in ${est + 1}–${data.today}. In ${est}, ${moved(last.netMigration)}.`;
  }

  function placeName() {
    return L.theName(current);
  }

  function renderChart(rec, detail) {
    const today = data.today;
    series = detail?.series ?? null;
    detailNow = detail ?? null;
    lastFlowsYear = null;
    renderFlows();
    renderMove(rec);
    if (series) renderLive();
    const past = (detail?.series ?? []).filter((r) => r.variant === "estimate" && r.population != null).map((r) => [r.year, r.population]);
    const arr = (sc) => (data.scen?.places?.[rec.iso3]?.[sc] ?? []).map((v, i) => [data.start + i, v]);
    const medium = arr("medium");
    const constant = arr("constant");
    // The past line runs up to today using the UN's own path between its last estimate and today.
    const bridge = medium.filter((p) => p[0] <= today && (!past.length || p[0] > past[past.length - 1][0]));
    const pastAll = [...past, ...bridge];
    const peak = L.peakOf([...pastAll, ...medium.filter((p) => p[0] > today)]);
    setText(el.chTitle, `People in ${placeName()}, 1950–2100`);
    const endM = medium[medium.length - 1]?.[1];
    const endC = constant[constant.length - 1]?.[1];
    let sentence = "";
    if (endM != null && endC != null) {
      const diff = (endC / endM - 1) * 100;
      sentence =
        Math.abs(diff) < 3
          ? "Both futures end up in about the same place."
          : diff < 0
            ? `If birth rates stay where they are, ${placeName()} ends up ${L.fmtPct(Math.abs(diff), { plus: false })} smaller than the UN forecast.`
            : `If birth rates stay where they are, ${placeName()} ends up ${L.fmtPct(diff, { plus: false })} bigger than the UN forecast.`;
    }
    setText(el.chSentence, sentence);
    const chk = crossCheck(rec.iso3, "today");
    el.chCheck.replaceChildren(...(chk ? [checkNote(chk, { cls: "xcheck" })] : []));
    el.chCheck.hidden = !chk;
    chartModel = { iso3: rec.iso3, past: pastAll, medium, constant, today };
    const range = rangePoints(detail?.forecastRange);
    chart.setData({ past: pastAll, medium, constant, range, today, lastEstimate: data.latestEstimateYear, peak, name: placeName(), year: state.year, mix: state.mix });
    renderRangeNote(rec, detail);
    renderSure(rec, detail);
  }

  // The UN's own range around its forecast, as chart points: { lower80, upper80, lower95, upper95 } of [year, people].
  function rangePoints(fr) {
    if (!fr) return null;
    const pts = (k) => (fr[k] ?? []).map((v, i) => [fr.startYear + i, v]);
    return { lower80: pts("lower80"), upper80: pts("upper80"), lower95: pts("lower95"), upper95: pts("upper95") };
  }

  function renderRangeNote(rec, detail) {
    const f = detail?.confidence?.forecast;
    const ok = !!(detail?.forecastRange && f?.at?.length);
    el.chRange.hidden = !ok;
    if (!ok) return el.chRange.replaceChildren();
    el.chRange.replaceChildren(
      h("span", { class: "ch-range-key", "aria-hidden": "true" }, h("i", { class: "k80" }), h("i", { class: "k95" })),
      sourced("Shaded: the UN's own range for its forecast", () => forecastInfo(rec, detailNow?.confidence?.forecast), { key: "ch-range" }),
      " (darker: 80% likely, lighter: 95%).",
    );
  }

  // ---------------------------------------------------------------- how sure is this

  const sureLink = "https://github.com/RostyslavDzhohola/fertility-tracker/blob/main/docs/METHODOLOGY.md#how-sure-is-each-number";
  const ownLink = "https://github.com/RostyslavDzhohola/fertility-tracker/blob/main/docs/METHODOLOGY.md";
  const listYears = (ys) => (ys?.length ? (ys.length > 6 ? `${ys.slice(0, 2).join(", ")} … ${ys.slice(-3).join(", ")} (${ys.length} in all)` : ys.join(", ")) : "none");
  const regWords = { C: "complete (90% or more registered)", U: "incomplete (under 90%)", "|": "from other sources, not the register" };
  const regRow = (label, v) => [label, v ? `${v.year}: ${regWords[v.code] ?? "no completeness given"}${v.byRegistration ? ", counted by date registered" : ""}` : "not reported"];

  function todayInfo(rec, c) {
    const t = c.today;
    const u = c.unSources;
    return {
      title: `When ${L.theName(rec)} was last counted`,
      rows: [
        ["Censuses the UN used", listYears(t.unCensuses)],
        ...(t.unRegisters?.length ? [["Population registers", listYears(t.unRegisters)]] : []),
        ["Official estimates", t.unOfficialEstimatesThrough ? `used by the UN up to ${t.unOfficialEstimatesThrough}` : "none used"],
        ["Latest census reported", t.latestCensus ? `${L.fmtDate(t.latestCensus.date)}: ${L.fmtWords(t.latestCensus.total)} people${t.latestCensus.provisional ? " (first results)" : ""}` : "none reported to the UN Statistics Division"],
      ],
      note: "A census counts everyone on one day. Between censuses, the UN adds births, takes away deaths and estimates who moved, so the older the count, the bigger the guess.",
      quote: u?.population ? { text: u.population, label: `UN, WPP 2024 Data Sources${u.page ? `, p. ${u.page}` : ""}`, href: SRC.wppDataSources.file } : null,
      src: SRC.wppDataSources,
      links: [{ label: "Latest censuses, UN Statistics Division (PDF)", href: "https://unstats.un.org/unsd/demographic-social/products/vitstats/seratab2.pdf" }],
      api: { href: apiOf(rec), field: "confidence.today" },
    };
  }

  function birthsDeathsInfo(rec, c) {
    const b = c.birthsDeaths;
    const u = c.unSources;
    return {
      title: `How births and deaths are counted in ${L.theName(rec)}`,
      rows: [
        regRow("Births registered", b.births),
        regRow("Deaths registered", b.deaths),
        ["The UN used", [b.unRegisteredBirthsThrough ? `registered births to ${b.unRegisteredBirthsThrough}` : "no registered births", b.unRegisteredDeathsThrough ? `registered deaths to ${b.unRegisteredDeathsThrough}` : "no registered deaths"].join("; ")],
        ...(b.unBirthsAdjusted || b.unDeathsAdjusted ? [["Corrected", `The UN adjusted ${[b.unBirthsAdjusted && "births", b.unDeathsAdjusted && "deaths"].filter(Boolean).join(" and ")} for ones that weren't registered`]] : []),
      ],
      quote: u?.fertility ? { text: u.fertility, label: `UN, WPP 2024 Data Sources${u.page ? `, p. ${u.page}` : ""}`, href: SRC.wppDataSources.file } : null,
      src: SRC.unsd,
      links: [{ label: "What the UN used (PDF)", href: SRC.wppDataSources.file }],
      api: { href: apiOf(rec), field: "confidence.birthsDeaths" },
    };
  }

  function immigrationInfo(rec, c) {
    const m = c.immigration;
    const how = { B: "By country of birth", C: "By citizenship", I: "Not counted: modelled by the UN" };
    const basis = {
      officialFlows: "official counts of people moving",
      flowEstimates: "estimates of people moving",
      destinationCensuses: "people born here counted in other countries' censuses",
      residual: "what's left after births and deaths are taken from the change in population",
      unhcr: "refugee counts from the UN refugee agency",
      other: "other sources",
    };
    return {
      title: `How ${L.theName(rec)}'s people born abroad were counted`,
      rows: [
        ["Counted", [...(m.dataType ?? "")].map((k) => how[k]).filter(Boolean).join(", and ") || "–"],
        ["Updated for 2024", m.reassessed2024 == null ? "–" : m.reassessed2024 ? "Yes: one of 60 places the UN fully reassessed" : "No: the UN carried its 2020 figure forward"],
        ["Refugees", m.refugeesAdded ? "Added from the UN refugee agency's counts" : "Not added"],
        ...(m.netMigrationBasis?.length ? [["Net migration from", m.netMigrationBasis.map((k) => basis[k] ?? k).join("; ")]] : []),
      ],
      quote: c.unSources?.migration ? { text: c.unSources.migration, label: "UN, WPP 2024 Data Sources (net migration)", href: SRC.wppDataSources.file } : null,
      src: SRC.desa,
      links: [{ label: "UN key facts: the 60 places reassessed (PDF, p. 1)", href: "https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2025_intlmigstock_2024_key_facts_and_figures_advance-unedited.pdf" }],
      api: { href: apiOf(rec), field: "confidence.immigration" },
    };
  }

  function forecastInfo(rec, f) {
    if (!f?.at?.length) return null;
    const r = (p, a, b) => `${L.fmtWords(p[a])} to ${L.fmtWords(p[b])}`;
    return {
      title: `How sure the UN is about ${possessive(L.theName(rec))} future`,
      rows: f.at.flatMap((p) => [
        [`${p.year}, forecast`, L.fmtWords(p.medium)],
        [`${p.year}, 80% likely`, r(p, "lower80", "upper80")],
        [`${p.year}, 95% likely`, r(p, "lower95", "upper95")],
        ...(p.zeroMigration != null ? [[`${p.year}, if nobody moved`, L.fmtWords(p.zeroMigration)]] : []),
      ]),
      note:
        "The UN runs its model thousands of times with different births, deaths and migration. The range holds the middle 80% and 95% of those runs. It can't foresee wars, pandemics or new laws, so the real range is wider.",
      src: SRC.wppRange,
      api: { href: apiOf(rec), field: "forecastRange" },
    };
  }

  const possessive = (n) => L.possessive(n);
  const levelWord = (part, level) => L.SURE_WORDS[part]?.[level] ?? "";

  function sureRow(rec, part, level, text, info, word = levelWord(part, level)) {
    return h(
      "li",
      { class: "sure-row", "data-level": level ?? "none" },
      h("span", { class: "sure-dot", "aria-hidden": "true" }),
      h(
        "div",
        { class: "sure-body" },
        h("p", { class: "sure-head" }, h("b", null, L.SURE_TITLES[part]), " ", sourced(h("span", { class: "sure-word" }, word || "Unknown"), info, { key: `sure-${part}` })),
        h("p", { class: "sure-text" }, text),
      ),
    );
  }

  function checkItem(c) {
    const when = c.kind === "researched" ? `Checked by hand, ${L.fmtDate(c.accessed)}` : `${L.checkSourceLabel(c)}${c.asOf ? `, as of ${L.fmtDate(c.asOf)}` : ""}`;
    const badge = { matches: "Matches", "un-higher": "UN higher", "un-lower": "UN lower", context: "Context" }[c.verdict];
    return h(
      "li",
      { class: "sure-check", "data-verdict": c.verdict },
      h("p", null, h("span", { class: "sure-badge" }, badge), " ", L.checkText(c)),
      c.notes?.length ? h("p", { class: "sure-note" }, "Their note: ", c.notes.join(" ")) : "",
      h(
        "p",
        { class: "src-links" },
        ...c.links.map((l) => h("a", { href: l.href, target: "_blank", rel: "noopener" }, l.label, h("span", { "aria-hidden": "true" }, " ↗"))),
        h("span", { class: "sure-when" }, when),
      ),
    );
  }

  function renderSure(rec, detail) {
    const c = detail?.confidence;
    const ok = !!c?.level || !!c?.forecast?.at?.length;
    el.sure.hidden = !ok;
    el.sureChip.hidden = !c?.level;
    if (!ok) {
      el.sureChip.replaceChildren();
      return;
    }
    const now = data.today;
    if (c.level) {
      const go = h("button", { type: "button", class: "sure-chip", "data-level": c.level }, h("span", { class: "sure-dot", "aria-hidden": "true" }), `${L.SURE_WORDS.overall[c.level]}: how sure is this?`);
      // Jump to the section, below the sticky bars (scroll-margin-top in style.css), then move focus there.
      go.addEventListener("click", () => {
        const margin = parseFloat(getComputedStyle(el.sure).scrollMarginTop) || 0;
        window.scrollTo({ top: Math.max(0, el.sure.getBoundingClientRect().top + window.scrollY - margin), behavior: media.reduced() ? "auto" : "smooth" });
        focusNoScroll(el.sure);
      });
      el.sureChip.replaceChildren(go);
    }
    setText(el.sureSentence, L.sureSummary(rec, c, now) ?? "How sure the UN is about the future, from its own range.");
    const rows = [];
    if (c.today?.level) rows.push(sureRow(rec, "today", c.today.level, L.sureTodayText(c.today, now), () => todayInfo(rec, c), L.sureTodayWord(c.today)));
    if (c.birthsDeaths?.level) rows.push(sureRow(rec, "birthsDeaths", c.birthsDeaths.level, L.sureBirthsDeathsText(c.birthsDeaths), () => birthsDeathsInfo(rec, c)));
    if (c.immigration?.level) rows.push(sureRow(rec, "immigration", c.immigration.level, L.sureImmigrationText(c.immigration), () => immigrationInfo(rec, c)));
    if (c.forecast?.level) rows.push(sureRow(rec, "forecast", c.forecast.level, L.sureForecastText(c.forecast), () => forecastInfo(rec, c.forecast)));
    el.sureRows.replaceChildren(...rows);
    const checks = detail.crossChecks ?? [];
    el.sureChecksWrap.hidden = !checks.length;
    el.sureChecks.replaceChildren(...checks.map(checkItem));
    el.sureHow.replaceChildren(
      "How we grade: ",
      h("a", { href: sureLink, target: "_blank", rel: "noopener" }, "the rules", h("span", { "aria-hidden": "true" }, " ↗")),
      ". The colors, the risk score and the 100 people are our own simple math on these numbers: ",
      h("a", { href: ownLink, target: "_blank", rel: "noopener" }, "how it works", h("span", { "aria-hidden": "true" }, " ↗")),
      ".",
    );
  }

  // ---------------------------------------------------------------- why it's happening

  function babyIcons(count, cls, max = 8) {
    const n = Math.min(max, Math.ceil(count - 1e-9));
    const wrap = h("span", { class: `babies ${cls}` });
    for (let i = 0; i < Math.max(1, n); i++) {
      const f = Math.max(0, Math.min(1, count - i));
      const icon = h("i", { class: "person baby" });
      icon.style.setProperty("--f", String(Math.round(f * 100) / 100));
      wrap.append(icon);
    }
    return wrap;
  }

  function renderWhy(rec) {
    const tfr = rec.tfr?.value;
    const tfrInfo = headlineInfo(rec, "tfr", `${L.fmtTfr(tfr)} babies per woman in ${L.theName(rec)}`);
    if (tfrInfo) tfrInfo.rows.unshift(["Counts", "Babies a woman would have over her life at this year's birth rates for each age (total fertility rate)"]);
    el.babies.replaceChildren(
      h("h3", { class: "tile-title" }, "Babies per woman"),
      h(
        "div",
        { class: "tile-pic babies-pic" },
        h(
          "div",
          { class: "brow" },
          h("span", { class: "brow-label" }, tfr != null && tfrInfo ? sourced(h("b", null, L.fmtTfr(tfr)), tfrInfo) : h("b", null, L.fmtTfr(tfr)), h("span", null, rec.iso3 === "WLD" ? "World" : current.name)),
          tfr != null ? babyIcons(tfr, "have") : "",
        ),
        h("div", { class: "brow", "aria-hidden": "true" }, h("span", { class: "brow-label" }, h("b", null, "2.1"), h("span", null, "Same size")), babyIcons(L.REPLACEMENT, "need")),
      ),
      h("p", { class: "tile-text" }, L.babiesSentence(tfr), rec.tfr?.year ? ` (${rec.tfr.year})` : ""),
    );
    renderFlows();
    renderMove(rec);
  }

  // Immigration: who lives here but was born elsewhere, and the reverse (UN migrant stock: everyone alive in 2024 who
  // ever moved), then the UN's yearly net figure, past and forecast, so the forecast's assumption is on screen.
  function renderMove(rec) {
    const m = rec.migrantStock;
    const c = rec.components;
    const world = rec.iso3 === "WLD";
    const pic = h("div", { class: "tile-pic move-pic" });
    if (world && m?.immigrants != null) {
      pic.append(h("p", { class: "move-world" }, sourced(h("b", null, L.fmtWords(m.immigrants)), stockInfo(rec, m, "immigrants")), " people live outside the country they were born in."));
    } else if (m?.immigrants != null || m?.emigrants != null) {
      const mx = Math.max(m.immigrants ?? 0, m.emigrants ?? 0) || 1;
      const row = (cls, label, v, kind, sub) =>
        h(
          "div",
          { class: `mv-row ${cls}` },
          h("span", { class: "mv-label" }, label),
          h("span", { class: "mv-track", "aria-hidden": "true" }, h("span", { class: "mv-arrow", style: { width: `${Math.max(14, (100 * (v ?? 0)) / mx)}%` } })),
          h("span", { class: "mv-val" }, v == null ? "–" : sourced(L.fmtWords(v), stockInfo(rec, m, kind)), sub ? h("small", null, sub) : ""),
        );
      pic.append(
        row("in", "Born abroad, living here", m.immigrants, "immigrants", m.immigrantsPct != null ? `${m.immigrantsPct}% of residents` : ""),
        row("out", "Born here, living abroad", m.emigrants, "emigrants", ""),
        h("p", { class: "mv-note" }, `Everyone alive in mid-${m.year ?? 2024}, whenever they moved: not one year's arrivals.`),
      );
    }
    const yearly = world ? null : netChart(rec);
    const chk = world ? null : crossCheck(rec.iso3, "net");
    el.whyCheck.replaceChildren(...(chk ? [checkNote(chk, { cls: "xcheck" })] : []));
    el.whyCheck.hidden = !chk;
    el.move.replaceChildren(
      h("h3", { class: "tile-title" }, "Immigration"),
      pic,
      yearly ?? "",
      world ? h("p", { class: "tile-text" }, "Moving doesn't change the world's total.") : yearly ? "" : h("p", { class: "tile-text" }, L.yearlyNetSentence(c?.netMigration, c?.year)),
    );
  }

  // People moving in minus moving out, each year 1990–2100: the UN's estimates, then its forecast (lighter). Shows what
  // the forecast assumes, e.g. Ukrainians returning in 2024–2025, or the United States taking about a million a year.
  function netChart(rec) {
    if (!series) return null;
    const pts = series.filter((r) => r.year >= 1990 && Number.isFinite(r.netMigration)).map((r) => [r.year, r.netMigration]);
    if (pts.length < 10) return null;
    const W = 240;
    const H = 110;
    const top = 6;
    const bottom = 18;
    const y0 = pts[0][0];
    const y1 = pts[pts.length - 1][0];
    const hi = Math.max(0, ...pts.map((p) => p[1]));
    const lo = Math.min(0, ...pts.map((p) => p[1]));
    const k = (H - top - bottom) / (hi - lo || 1);
    const zero = top + hi * k;
    const bw = W / (y1 - y0 + 1);
    const x = (yr) => (yr - y0) * bw;
    const est = data.latestEstimateYear;
    const svg = s("svg", { class: "net-chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": netAria(rec, pts) });
    for (const [yr, v] of pts) {
      const hgt = Math.max(0.6, Math.abs(v) * k);
      svg.append(s("rect", { class: `nb ${v < 0 ? "neg" : "pos"}${yr > est ? " fc" : ""}`, x: x(yr) + 0.3, y: v < 0 ? zero : zero - hgt, width: Math.max(0.8, bw - 0.6), height: hgt }));
    }
    svg.append(s("line", { class: "nz", x1: 0, x2: W, y1: zero, y2: zero }));
    const tx = x(data.today);
    svg.append(s("line", { class: "nt", x1: tx, x2: tx, y1: 0, y2: H - bottom + 2 }));
    for (const [yr, label, anchor] of [
      [y0, String(y0), "start"],
      [data.today, "Today", "middle"],
      [y1, String(y1), "end"],
    ])
      svg.append(s("text", { class: `nl${yr === data.today ? " today" : ""}`, x: yr === y0 ? 0 : yr === y1 ? W : x(yr), y: H - 4, "text-anchor": anchor }, label));
    const at = (yr) => series.find((r) => r.year === yr)?.netMigration;
    const last = at(est);
    const now = at(data.today);
    const val = (yr, v) => sourced(L.fmtFlow(v), flowInfo(rec, "netMigration", v, { from: yr, to: yr }));
    return h(
      "div",
      { class: "net-yearly" },
      h("p", { class: "net-title" }, "Net immigration each year (in minus out)"),
      svg,
      h(
        "p",
        { class: "net-keys" },
        Number.isFinite(last) ? h("span", null, `${est}: `, val(est, last)) : "",
        Number.isFinite(now) ? h("span", { class: "fc" }, `UN forecast for ${data.today}: `, val(data.today, now)) : "",
      ),
      h("p", { class: "tile-note" }, "Dark bars were counted. Light bars are the UN's forecast, made in 2024: policies and events can change it."),
    );
  }

  function netAria(rec, pts) {
    const lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    const hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    return `People moving to ${L.theName(rec)} minus people leaving, each year ${pts[0][0]} to ${pts[pts.length - 1][0]}: highest ${L.fmtFlow(hi[1])} in ${hi[0]}, lowest ${L.fmtFlow(lo[1])} in ${lo[0]}. Years after ${data.latestEstimateYear} are the UN forecast.`;
  }

  // Births, deaths, immigration: where the change comes from, at the slider year (one year) or from now to it. The UN
  // counts moving as one yearly net figure (moved in minus moved out). Births and deaths come first, immigration apart.
  function renderFlows() {
    if (!current) return;
    const rec = current;
    const world = rec.iso3 === "WLD";
    const y = yearInt();
    const today = data.today;
    let f = series ? (y > today ? L.flowsBetween(series, today, y, { midyear: true }) : L.flowsBetween(series, y, y)) : null;
    let span = y > today ? `From now to ${y}` : `In ${y}, one year`;
    let kind = y > data.latestEstimateYear ? "UN forecast" : "UN estimate";
    if (!f && rec.components) {
      // Until the place's file loads: its latest year from countries.json.
      const c = rec.components;
      const natural = Number.isFinite(c.births) && Number.isFinite(c.deaths) ? c.births - c.deaths : null;
      f = { from: c.year, to: c.year, births: c.births, deaths: c.deaths, netMigration: c.netMigration ?? 0, natural, change: natural == null ? null : natural + (c.netMigration ?? 0) };
      span = `In ${c.year}, one year`;
      kind = "UN estimate";
    }
    const net = world ? 0 : f?.netMigration ?? 0;
    const max = Math.max(f?.births ?? 0, f?.deaths ?? 0, Math.abs(net)) || 1;
    const val = (what, v, sign) => (v == null || !f ? "–" : sourced(sign + L.fmtFlow(Math.abs(v), { plus: false }), flowInfo(rec, what, v, f), { key: `flow-${what}` }));
    const bar = (cls, label, what, v, sign = "") =>
      h(
        "div",
        { class: `bd-row ${cls}` },
        h("span", { class: "bd-label" }, label),
        h("span", { class: "bd-track", "aria-hidden": "true" }, h("span", { class: "bd-fill", style: { width: `${Math.max(2, (100 * Math.abs(v ?? 0)) / max)}%` } })),
        h("span", { class: "bd-val" }, val(what, v, sign)),
      );
    const sub = (label, v) => h("p", { class: "bd-sub" }, h("span", null, label), h("b", null, v == null || !f ? "–" : sourced(L.fmtFlow(v, { plus: true }), flowInfo(rec, "naturalChange", v, f), { key: "flow-naturalChange" })));
    const rows = [h("p", { class: "bd-group" }, "Births and deaths"), bar("born", "Born", "births", f?.births, "+"), bar("died", "Died", "deaths", f?.deaths, L.MINUS), sub("Born minus died", f?.natural)];
    if (!world)
      rows.push(
        h("p", { class: "bd-group" }, "Immigration"),
        bar(net < 0 ? "left" : "moved", "Net", "netMigration", net, net < 0 ? L.MINUS : "+"),
      );
    const change = f?.change;
    const total = h(
      "p",
      { class: "bd-total" },
      h("span", null, "Change"),
      h("b", { "data-band": change == null ? "" : change < 0 ? "down" : "up" }, change == null ? "–" : sourced(L.fmtFlow(change, { plus: true }), flowInfo(rec, "populationChange", change, f), { key: "flow-populationChange" })),
    );
    el.born.replaceChildren(
      h("h3", { class: "tile-title" }, world ? "Born and died" : "Births, deaths, immigration"),
      h("p", { class: "tile-span" }, span, ` (${kind})`),
      h("div", { class: "tile-pic bd-pic flows" }, ...rows, total),
      h("p", { class: "tile-text" }, L.flowsSentence(f, placeName(), { world }), world ? "" : immigrationShare(f)),
      world ? "" : h("p", { class: "tile-note" }, "Immigration, net: people who moved in minus people who moved out."),
    );
  }

  // " Immigration adds 69% of the growth." when both add people; nothing otherwise (the sentence already says it).
  function immigrationShare(f) {
    if (!f || !(f.change > 0) || !(f.netMigration > 0) || !(f.natural > 0)) return "";
    return ` Immigration is ${Math.round((100 * f.netMigration) / f.change)}% of the growth.`;
  }

  // ---------------------------------------------------------------- generations

  function dotGroup(count) {
    const shown = Math.min(400, Math.round(count));
    const cols = shown > 100 ? 20 : 10;
    const wrap = h("span", { class: "gdots", style: { "--cols": String(cols) } });
    for (let i = 0; i < shown; i++) wrap.append(h("i"));
    if (count - shown >= 1) wrap.append(h("span", { class: "gmore" }, `+${Math.round(count - shown)}`));
    return wrap;
  }

  function renderGens(rec) {
    const base = rec.tfr?.value;
    const tfr = whatIf ?? base;
    setText(el.genSentence, whatIf != null ? L.generationsSentence(tfr, { whatIfName: placeName() }) : L.generationsSentence(tfr));
    const counts = L.generationCounts(tfr, 4);
    el.gens.replaceChildren(
      ...counts.map((c, i) =>
        h(
          "li",
          { class: "gen" },
          h("span", { class: "gen-count" }, L.fmtPeople(c)),
          dotGroup(c),
          h("span", { class: "gen-label" }, GEN_LABELS[i], i > 0 ? h("small", null, ` ~${data.today + i * L.GEN_YEARS}`) : ""),
        ),
      ),
    );
    setText(el.whatifOut, L.fmtTfr(tfr));
    el.whatif.style.setProperty("--pf", String(Math.max(0, Math.min(1, ((tfr ?? 2.1) - 0.5) / 3.5))));
    if (document.activeElement !== el.whatif) el.whatif.value = String(tfr ?? 2.1);
    el.whatifReset.hidden = whatIf == null;
    setText(el.whatifReset, `Back to ${L.possessiveOf(current)} ${L.fmtTfr(base)}`);
  }

  el.whatif.addEventListener("input", () => {
    whatIf = Number(el.whatif.value);
    if (current) renderGens(current);
  });
  el.whatifReset.addEventListener("click", () => {
    whatIf = null;
    if (current) renderGens(current);
    focusNoScroll(el.whatif);
  });

  // ---------------------------------------------------------------- more numbers

  function stat(label, value, sub) {
    return h("div", { class: "stat" }, h("dt", null, label), h("dd", null, value, sub ? h("small", null, ` ${sub}`) : ""));
  }

  function renderMore(rec, detail, status) {
    const p = rec.projection ?? {};
    const c = rec.components ?? {};
    const world = rec.iso3 === "WLD";
    // Every % here is vs today (this year's UN figure), like the rest of the page. Measured figures keep their year.
    const today = data.today;
    const vsToday = (year, sc) => {
      const v = L.popAt(data.scen, rec.iso3, year, sc);
      const pct = L.pctVsToday(data.scen, rec.iso3, year, sc, today);
      return [v == null ? "–" : sourced(L.fmtWords(v), popInfo(rec, year, v, sc)), pct == null ? "" : `(${L.fmtPct(pct)} vs today)`];
    };
    const medArr = data.scen?.places?.[rec.iso3]?.medium ?? [];
    const base = L.popAt(data.scen, rec.iso3, today, "medium");
    let halfYear = null;
    for (let i = Math.max(0, today - data.start); i < medArr.length; i++)
      if (base && medArr[i] != null && medArr[i] <= base / 2) {
        halfYear = data.start + i;
        break;
      }
    // A headline value with its source card, or a dash.
    const head = (key, text, title) => {
      const info = rec[key]?.value != null ? headlineInfo(rec, key, title) : null;
      return info ? sourced(text, info) : text;
    };
    const one = { from: c.year, to: c.year };
    const flow = (what, v) => (v == null || c.year == null ? "–" : sourced(L.fmtFlow(v, { plus: what === "netMigration" }), flowInfo(rec, what, v, one)));
    const where = L.theName(rec);
    const stats = h(
      "dl",
      { class: "stats" },
      stat("People, latest reported", head("population", L.fmtWords(rec.population?.value), `${L.fmtWords(rec.population?.value)} people in ${where}`), rec.population?.year ? `(${rec.population.year}, ${rec.population.source === "WB" ? "World Bank" : "UN"})` : ""),
      stat(`People today (${today})`, base == null ? "–" : sourced(L.fmtWords(base), popInfo(rec, today, base, "medium")), "(UN forecast)"),
      stat("Babies per woman", head("tfr", L.fmtTfr(rec.tfr?.value), `${L.fmtTfr(rec.tfr?.value)} babies per woman in ${where}`), rec.tfr?.year ? `(${rec.tfr.year})` : ""),
      stat("Median age", rec.medianAge?.value != null ? head("medianAge", `${rec.medianAge.value.toFixed(1)} years`, `Half the people in ${where} are older than ${rec.medianAge.value.toFixed(1)}`) : "–", rec.medianAge?.year ? `(${rec.medianAge.year})` : ""),
      stat("65 and older", rec.share65?.value != null ? head("share65", `${Math.round(rec.share65.value)}%`, `${Math.round(rec.share65.value)}% of people in ${where} are 65 or older`) : "–", rec.share65?.year ? `of people (${rec.share65.year})` : ""),
      stat("Born per year", flow("births", c.births), c.year ? `(${c.year})` : ""),
      stat("Died per year", flow("deaths", c.deaths), c.year ? `(${c.year})` : ""),
      stat("Net immigration", flow("netMigration", c.netMigration), c.year ? `(${c.year})` : ""),
      stat("UN forecast, 2050", ...vsToday(2050, "medium")),
      stat("UN forecast, 2100", ...vsToday(data.end, "medium")),
      stat("If birth rates stay the same, 2100", ...vsToday(data.end, "constant")),
      stat(
        "Peak",
        p.peakYear != null
          ? sourced(String(p.peakYear), {
              title: p.peakYear >= L.END_YEAR ? `${L.theName(rec, { start: true })} is still growing in 2100 (UN forecast)` : `${L.possessiveOf(rec, { start: true })} population peaks at ${L.fmtWords(p.peakPopulation)} in ${p.peakYear}`,
              rows: [
                ["Counts", "The year with the most people on 1 July, 1950–2100"],
                ["Kind", kindOf(p.peakYear)],
              ],
              src: SRC.wpp,
              api: { href: apiOf(rec), field: "projection.peakYear" },
            })
          : "–",
        p.peakYear != null && p.peakYear >= L.END_YEAR ? "(still growing)" : "",
      ),
      stat(
        "Down to half of today's people",
        halfYear != null
          ? sourced(`In ${halfYear}`, {
              title: `${L.theName(rec, { start: true })} has half of today's ${L.fmtWords(base)} people in ${halfYear} (UN forecast)`,
              rows: [
                ["Counts", "The first year the UN forecast is at or below half of today's population"],
                ["Kind", kindOf(halfYear)],
              ],
              note: forecastNote(halfYear),
              src: SRC.wppScenarios,
              api: { href: "/api/v1/scenarios.json", field: `places.${rec.iso3}.medium` },
            })
          : "Not before 2100",
        "(UN forecast)",
      ),
    );

    // The composite risk score (API) and its inputs, kept apart and labelled: it measures change from 2023.
    const factors = detail?.risk?.factors ?? rec.risk?.factors ?? [];
    const factorBlock =
      !world && rec.risk?.score != null
        ? h(
            "div",
            { class: "cv-more-sec" },
            h("h3", null, "Risk score (0–100), ", h("a", { href: "https://github.com/RostyslavDzhohola/fertility-tracker/blob/main/docs/METHODOLOGY.md", target: "_blank", rel: "noopener" }, "how it works →")),
            h(
              "p",
              { class: "score-line" },
              h("b", null, `${rec.risk.score} / 100`),
              ` · tier ${rec.risk.tier ?? "–"}`,
              Number.isInteger(rec.risk?.rank) ? ` · ${L.rankLabel(rec, data.rankedN)}` : ` · ${L.rankLabel(rec, data.rankedN)}`,
            ),
            h("p", { class: "muted small" }, "A summary of five signals: babies per woman, births vs deaths, age, migration and the UN forecast. Unlike the rest of this page, it compares with 2023."),
            factors.length ? h("ul", { class: "factors" }, ...factors.map((f) => h("li", null, f))) : "",
          )
        : "";

    const m = rec.migrantStock;
    const corr = detail?.migrationCorridors;
    // Each row opens where its number comes from (and from there, the other country's page).
    const partnerList = (list, dir) => {
      if (status === "loading") return h("p", { class: "muted" }, "Loading…");
      if (status === "error") return h("p", { class: "muted" }, "Couldn't load this list.");
      if (!list?.length) return h("p", { class: "muted" }, "No breakdown by country.");
      return h(
        "ol",
        { class: "partners" },
        ...list.slice(0, 5).map((pp) => h("li", null, sourced([h("span", { class: "p-name" }, pp.name), h("span", { class: "num" }, L.fmtCompact(pp.people))], corridorInfo(rec, pp, dir), { cls: "partner" }))),
      );
    };
    const b = breakupOf(rec.iso3);
    const migBlock =
      !world && m
        ? h(
            "div",
            { class: "cv-more-sec" },
            h("h3", null, `Immigration${m.year ? ` (people, ${m.year})` : ""}`),
            h(
              "dl",
              { class: "stats two" },
              stat(`Born abroad, living in ${L.theName(rec)}`, m.immigrants == null ? "–" : sourced(L.fmtWords(m.immigrants), stockInfo(rec, m, "immigrants")), m.immigrantsPct != null ? `(${m.immigrantsPct}% of residents)` : ""),
              stat(`Born in ${L.theName(rec)}, living abroad`, m.emigrants == null ? "–" : sourced(L.fmtWords(m.emigrants), stockInfo(rec, m, "emigrants"))),
            ),
            h("p", { class: "muted small" }, `Everyone alive in mid-${m.year}, whenever they moved.${b ? ` Until ${b.until}, ${rec.name} was part of ${b.name}: people who moved between its republics then count as migrants now.` : ""} Press a row to see where its number comes from.`),
            h("div", { class: "corridors" }, h("div", null, h("h4", null, "Born in"), partnerList(corr?.topOrigins, "in")), h("div", null, h("h4", null, "Living in"), partnerList(corr?.topDestinations, "out"))),
          )
        : "";

    const api = `/api/v1/countries/${rec.iso3}.json`;
    const links = h(
      "div",
      { class: "cv-more-sec" },
      h("h3", null, "Get the data"),
      h(
        "p",
        { class: "links" },
        h("a", { href: api }, `${world ? "World" : rec.name} as JSON`),
        h("a", { href: "/api/v1/timeseries.csv", download: "" }, "Every year, every place (CSV)"),
        h("a", { href: "/api/v1/scenarios.json" }, "Both futures, every place (JSON)"),
        h("a", { href: "/api/", "data-nav-external": "" }, "API docs"),
      ),
      h("pre", { class: "code" }, h("code", null, `curl -s ${siteUrl()}api/v1/countries/${rec.iso3}.json`)),
    );

    const shareBtn = h("button", { type: "button", class: "btn btn-secondary", id: "share-btn" }, "Copy link");
    const r2100 = L.ratioVsToday(data.scen, rec.iso3, data.end, "medium", data.today);
    shareBtn.addEventListener("click", () => share(rec, shareBtn, r2100));
    // Post on X shares the picture of this page (the chart and its numbers), like "Share a picture" at the top.
    const xBtn = h("button", { type: "button", class: "btn btn-secondary", id: "x-btn" }, "Post on X");
    xBtn.addEventListener("click", () => sharePicture());
    const fb = data.feedback;
    const issue = fb ? L.buildIssueUrl(fb, "data-problem", { iso3: rec.iso3, name: rec.name, siteUrl: siteUrl() }) : null;
    const shareSec = h(
      "div",
      { class: "cv-more-sec" },
      h("h3", null, "Share or tell us"),
      h(
        "p",
        { class: "actions" },
        xBtn,
        shareBtn,
        issue ? h("a", { class: "btn btn-secondary", href: issue, target: "_blank", rel: "noopener", id: "report-link" }, "Report a problem with these numbers") : "",
        emailLink(fb, { iso3: rec.iso3, name: rec.name, siteUrl: siteUrl() }, { id: "cv-email-btn" }),
      ),
      h("p", { class: "muted small" }, "Sources: UN World Population Prospects 2024 (CC BY 3.0 IGO), UN DESA International Migrant Stock 2024, World Bank (CC BY 4.0). Press any underlined number to see its source. GitHub issues are public; email stays private."),
    );
    el.moreBody.replaceChildren(stats, factorBlock, migBlock, links, shareSec);
  }

  async function share(rec, btn, r2100) {
    const url = L.pageUrl(rec.iso3, siteUrl());
    if (navigator.share && media.coarse()) {
      try {
        await navigator.share({ title: document.title, text: L.xPostText(rec, r2100), url });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    const ok = await copyText(url);
    btn.textContent = ok ? "Link copied" : "Copy failed";
    announce(ok ? "Link copied to clipboard" : "Couldn't copy the link");
    setTimeout(() => (btn.textContent = "Copy link"), 1600);
  }

  // ---------------------------------------------------------------- share a picture: the chart and the numbers

  function sharePicture() {
    const rec = current;
    if (!rec) return;
    const y = yearInt();
    const arr = (sc) => (data.scen?.places?.[rec.iso3]?.[sc] ?? []).map((v, i) => [data.start + i, v]);
    const model = chartModel?.iso3 === rec.iso3 ? chartModel : { past: [], medium: arr("medium"), constant: arr("constant"), today: data.today };
    const url = L.pageUrl(rec.iso3, siteUrl()) + L.buildQuery({ year: y, scenario: state.scenario }, { defaultYear: data.end });
    const m = {
      rec,
      year: y,
      today: data.today,
      lastEstimate: data.latestEstimateYear,
      scenario: state.scenario,
      pop: popNow(rec.iso3),
      pct: pctNow(rec.iso3),
      ratio: ratioNow(rec.iso3),
      outlookPct: outlookPct(rec.iso3),
      url,
      visual: chartVisual(model, { year: y, scenario: state.scenario, name: placeName() }),
    };
    openShare({
      make: () => renderSnapshot(m),
      text: L.snapshotPostText(m),
      url,
      fileName: `fertility-tracker-${L.slugOf(rec)}-${y}.png`,
      alt: `People in ${placeName()}, 1950 to 2100, with ${L.fmtWords(m.pop)} people in ${y}, ${L.fmtPct(m.pct)} vs today.`,
    });
  }
  el.share?.addEventListener("click", () => sharePicture());

  // ---------------------------------------------------------------- lifecycle

  subscribe((what) => {
    if (!current || el.view.hidden) return;
    if (what === "year" || what === "mix") renderLive();
    if (what === "scenario") {
      renderHero(current);
      renderFlows();
    }
  });

  async function show(iso3) {
    el.view.hidden = false;
    document.body.classList.add("page-country");
    const rec = data.records.get(iso3);
    if (!rec) {
      current = null;
      el.story.hidden = true;
      el.missing.hidden = false;
      setText($("cv-missing-code"), iso3);
      document.title = "Place not found · Fertility Tracker";
      return null;
    }
    el.story.hidden = false;
    el.missing.hidden = true;
    const changed = current?.iso3 !== iso3;
    current = rec;
    if (changed) {
      whatIf = null;
      el.more.open = false;
    }
    const my = ++token;
    series = null;
    detailNow = null;
    lastFlowsYear = null;
    renderHero(rec);
    setText(el.ppTitle, `Start with 100 people in ${L.theName(rec)}`);
    renderLive();
    renderWhy(rec);
    renderGens(rec);
    const cached = cachedDetail(iso3);
    renderChart(rec, cached);
    renderMore(rec, cached, cached ? "done" : "loading");
    if (!cached) {
      loadDetail(iso3).then(
        (d) => {
          if (my !== token) return;
          renderChart(rec, d);
          renderMore(rec, d, "done");
        },
        () => {
          if (my !== token) return;
          renderMore(rec, null, "error");
        },
      );
    }
    const p = pct2100(rec.iso3, "medium");
    document.title = L.documentTitle("country", rec, p);
    return rec;
  }

  function hide() {
    closeSource();
    el.view.hidden = true;
    document.body.classList.remove("page-country");
  }

  // Links inside "More numbers" to other countries.
  el.moreBody.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  });

  return {
    show,
    hide,
    focusTitle: () => focusNoScroll(el.name),
    refreshLinks() {
      if (current) renderMore(current, cachedDetail(current.iso3), cachedDetail(current.iso3) ? "done" : "loading");
    },
    get current() {
      return current;
    },
  };
}

