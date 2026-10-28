// The country page `/country/{ISO3}` (DESIGN-v3 §3): a vertical visual story. Each block is one picture and at most
// one sentence. Numbers follow the shared year slider and scenario.

import { $, h, s, setText, setAttr, media, focusNoScroll, announce, copyText } from "./dom.js";
import * as L from "./logic.js";
import { data, state, subscribe, popNow, ratioNow, pctNow, pct2100, loadDetail, cachedDetail, setYear, yearInt } from "./store.js";
import { createTimeControls } from "./controls.js";
import { createPopChart } from "./charts.js";
import { peopleRow } from "./people.js";

const GEN_LABELS = ["Today", "Children", "Grandchildren", "Great-grandchildren"];

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
  };

  let current = null; // record
  let token = 0;
  let whatIf = null;

  const controls = createTimeControls({
    prefix: "cv",
    valueText: (y) => (current ? `${y}, ${current.name} ${L.fmtWords(popNow(current.iso3, y))}` : String(y)),
  });
  el.controls.replaceChildren(controls.root);

  const grid = peopleRow(el.ppGrid, { per: 100, maxExtra: 100, extraLabel: (n) => `+${n} more for every 100 today` });

  const chart = createPopChart(el.chart, {
    onScrub: (yr) => setYear(yr, { animate: false }),
  });

  // ---------------------------------------------------------------- hero

  function renderMeter(rec) {
    const step = L.riskStep(rec);
    const unranked = rec.iso3 === "WLD" || step < 0 || (rec.ranked !== true && L.isSmallPlace(rec));
    if (unranked) {
      el.meter.className = "meter none";
      el.meter.replaceChildren(
        h("p", { class: "meter-none" }, rec.iso3 === "WLD" ? "The world as a whole isn't ranked." : L.isSmallPlace(rec) ? "Not ranked: too few people for a fair score." : "Not ranked: some numbers are missing."),
      );
      setAttr(el.meter, "aria-label", null);
      return;
    }
    el.meter.className = "meter";
    setAttr(el.meter, "role", "img");
    setAttr(el.meter, "aria-label", `Risk of shrinking: ${L.RISK_LEVELS[step]}, step ${step + 1} of 5.`);
    el.meter.replaceChildren(
      h("p", { class: "meter-title", "aria-hidden": "true" }, "Risk of shrinking: ", h("b", null, L.RISK_LEVELS[step])),
      h(
        "div",
        { class: "meter-track", "aria-hidden": "true" },
        ...L.RISK_LEVELS.map((word, i) => {
          const seg = h("span", { class: `meter-seg${i === step ? " on" : ""}` }, h("i", { style: { background: L.RISK_COLORS[i] } }), h("span", { class: "meter-word" }, word));
          if (i === step) seg.append(h("span", { class: "meter-pin" }));
          return seg;
        }),
      ),
    );
  }

  function renderHero(rec) {
    setText(el.region, rec.iso3 === "WLD" ? "Whole world" : rec.region ?? "");
    setText(el.name, rec.iso3 === "WLD" ? "The world" : rec.name);
    el.name.classList.toggle("long", rec.name.length > 22);
    const p = pct2100(rec.iso3, "medium");
    setText(el.verdict, L.verdict(rec, p, data.today));
    el.verdict.dataset.band = L.changeBand(p) ?? "";
    renderMeter(rec);
    const r = L.ratioVsToday(data.scen, rec.iso3, data.end, "medium", data.today);
    setText(el.lede, L.hundredSentence(rec, r, "medium"));
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
    else if (y === data.today) sentence = `Each figure is 1 in every 100 people in ${placeName()} today. Press Play to watch them change.`;
    else if (n < 100) sentence = `In ${y}, ${n} of today's 100 are left${state.mix >= 0.5 ? " if birth rates stay the same" : ""}. Gray figures are people who are gone.`;
    else if (n > 100) sentence = `In ${y}, there are ${n} for every 100 today${state.mix >= 0.5 ? " if birth rates stay the same" : ""}. Green figures are new people.`;
    else sentence = `In ${y}, about the same number of people as today.`;
    setText(el.ppSentence, sentence);
    chart.update(state.year, state.mix);
  }

  function placeName() {
    return current?.iso3 === "WLD" ? "the world" : current?.name ?? "";
  }

  function renderChart(rec, detail) {
    const today = data.today;
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
    chart.setData({ past: pastAll, medium, constant, today, peak, name: placeName(), year: state.year, mix: state.mix });
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
    el.babies.replaceChildren(
      h("h3", { class: "tile-title" }, "Babies per woman"),
      h(
        "div",
        { class: "tile-pic babies-pic", "aria-hidden": "true" },
        h("div", { class: "brow" }, h("span", { class: "brow-label" }, h("b", null, L.fmtTfr(tfr)), h("span", null, placeName() === "the world" ? "World" : current.name)), tfr != null ? babyIcons(tfr, "have") : ""),
        h("div", { class: "brow" }, h("span", { class: "brow-label" }, h("b", null, "2.1"), h("span", null, "Same size")), babyIcons(L.REPLACEMENT, "need")),
      ),
      h("p", { class: "tile-text" }, L.babiesSentence(tfr)),
    );

    const c = rec.components;
    const max = Math.max(c?.births ?? 0, c?.deaths ?? 0) || 1;
    const bar = (cls, label, v) =>
      h(
        "div",
        { class: `bd-row ${cls}` },
        h("span", { class: "bd-label" }, label),
        h("span", { class: "bd-track" }, h("span", { class: "bd-fill", style: { width: `${Math.max(2, (100 * (v ?? 0)) / max)}%` } })),
        h("span", { class: "bd-val" }, L.fmtFlow(v, { plus: false })),
      );
    el.born.replaceChildren(
      h("h3", { class: "tile-title" }, `Born vs died${c?.year ? `, ${c.year}` : ""}`),
      h("div", { class: "tile-pic bd-pic", "aria-hidden": "true" }, bar("born", "Born", c?.births), bar("died", "Died", c?.deaths)),
      h("p", { class: "tile-text" }, L.bornDiedSentence(c)),
    );

    const net = c?.netMigration;
    const rate = c?.perThousand?.netMigration;
    const dir = net == null ? "none" : Math.abs(net) < 50 ? "even" : net < 0 ? "out" : "in";
    const arrows = Math.max(1, Math.min(4, Math.round(Math.abs(rate ?? 0) * 0.8) + 1));
    const pic = h("div", { class: `tile-pic move-pic ${dir}`, "aria-hidden": "true" });
    pic.append(moveSvg(dir, arrows));
    el.move.replaceChildren(
      h("h3", { class: "tile-title" }, `Moving in vs out${c?.year ? `, ${c.year}` : ""}`),
      pic,
      h("p", { class: "tile-text" }, L.migrationSentence(net)),
    );
  }

  function moveSvg(dir, n) {
    const svg = s("svg", { viewBox: "0 0 220 96", width: "100%", height: 96, preserveAspectRatio: "xMidYMid meet" });
    svg.append(s("rect", { class: "home", x: 80, y: 14, width: 60, height: 68, rx: 12 }));
    svg.append(s("text", { class: "home-label", x: 110, y: 53, "text-anchor": "middle" }, "here"));
    const arrow = (y, out, faint) => {
      const g = s("g", { class: `arr ${out ? "out" : "in"}${faint ? " faint" : ""}` });
      if (out) {
        g.append(s("path", { d: `M146 ${y} H204`, class: "shaft" }), s("path", { d: `M196 ${y - 7} L206 ${y} L196 ${y + 7}`, class: "head" }));
      } else {
        g.append(s("path", { d: `M16 ${y} H74`, class: "shaft" }), s("path", { d: `M66 ${y - 7} L76 ${y} L66 ${y + 7}`, class: "head" }));
      }
      return g;
    };
    if (dir === "none") return svg;
    const ys = Array.from({ length: n }, (_, i) => 48 + (i - (n - 1) / 2) * 16);
    if (dir === "even") {
      svg.append(arrow(40, false), arrow(56, true));
      return svg;
    }
    for (const y of ys) svg.append(arrow(y, dir === "out"));
    svg.append(arrow(48, dir !== "out", true));
    return svg;
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
    setText(el.genSentence, whatIf != null ? `What if ${placeName()} had ${L.fmtTfr(tfr)} babies per woman? ${L.generationsSentence(tfr).replace(/^At [^,]+, /, "")}` : L.generationsSentence(tfr));
    const counts = L.generationCounts(tfr, 4);
    el.gens.replaceChildren(
      ...counts.map((c, i) =>
        h(
          "li",
          { class: "gen" },
          h("span", { class: "gen-count" }, L.fmtCount(c)),
          dotGroup(c),
          h("span", { class: "gen-label" }, GEN_LABELS[i], i > 0 ? h("small", null, ` ~${data.today + i * L.GEN_YEARS}`) : ""),
        ),
      ),
    );
    setText(el.whatifOut, L.fmtTfr(tfr));
    el.whatif.style.setProperty("--pf", String(Math.max(0, Math.min(1, ((tfr ?? 2.1) - 0.5) / 3.5))));
    if (document.activeElement !== el.whatif) el.whatif.value = String(tfr ?? 2.1);
    el.whatifReset.hidden = whatIf == null;
    setText(el.whatifReset, `Back to ${placeName() === "the world" ? "the world's" : L.possessive(current.name)} ${L.fmtTfr(base)}`);
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
    const stats = h(
      "dl",
      { class: "stats" },
      stat("People", L.fmtWords(rec.population?.value), rec.population?.year ? `(${rec.population.year})` : ""),
      stat("Babies per woman", L.fmtTfr(rec.tfr?.value), rec.tfr?.year ? `(${rec.tfr.year})` : ""),
      stat("Median age", rec.medianAge?.value != null ? `${rec.medianAge.value.toFixed(1)} years` : "–"),
      stat("65 and older", rec.share65?.value != null ? `${Math.round(rec.share65.value)}%` : "–"),
      stat("Born per year", L.fmtFlow(c.births, { plus: false }), c.year ? `(${c.year})` : ""),
      stat("Died per year", L.fmtFlow(c.deaths, { plus: false }), c.year ? `(${c.year})` : ""),
      stat("Net migration", L.fmtFlow(c.netMigration), c.year ? `(${c.year})` : ""),
      stat("UN forecast, 2050", L.fmtWords(p.population2050), p.change2050Pct != null ? `(${L.fmtPct(p.change2050Pct)} vs ${p.baseYear ?? 2023})` : ""),
      stat("UN forecast, 2100", L.fmtWords(p.population2100), p.change2100Pct != null ? `(${L.fmtPct(p.change2100Pct)} vs ${p.baseYear ?? 2023})` : ""),
      stat("If birth rates stay the same, 2100", L.fmtWords(L.popAt(data.scen, rec.iso3, data.end, "constant"))),
      stat("Peak", p.peakYear != null ? String(p.peakYear) : "–", p.peakYear != null && p.peakYear >= L.END_YEAR ? "(still growing)" : ""),
      stat("Half of today's people by", p.halfPopulationYear != null ? String(p.halfPopulationYear) : "Not before 2100"),
      stat("Rank", L.rankLabel(rec, data.rankedN)),
      !world && rec.risk?.score != null
        ? h(
            "div",
            { class: "stat" },
            h("dt", null, "Risk score (0–100, ", h("a", { href: "https://github.com/RostyslavDzhohola/fertility-tracker/blob/main/docs/METHODOLOGY.md", target: "_blank", rel: "noopener" }, "how it works →"), ")"),
            h("dd", null, `${rec.risk.score} / 100`, h("small", null, ` (${L.riskWord(rec)})`)),
          )
        : "",
    );

    const factors = detail?.risk?.factors ?? rec.risk?.factors ?? [];
    const factorBlock = factors.length
      ? h("div", { class: "cv-more-sec" }, h("h3", null, "What pushes the risk up or down"), h("ul", { class: "factors" }, ...factors.map((f) => h("li", null, f))))
      : "";

    const m = rec.migrantStock;
    const corr = detail?.migrationCorridors;
    const partnerList = (list) => {
      if (status === "loading") return h("p", { class: "muted" }, "Loading…");
      if (status === "error") return h("p", { class: "muted" }, "Couldn't load this list.");
      if (!list?.length) return h("p", { class: "muted" }, "No breakdown by country.");
      return h(
        "ol",
        { class: "partners" },
        ...list.slice(0, 5).map((pp) =>
          h(
            "li",
            null,
            pp.iso3 && data.records.has(pp.iso3) ? h("a", { href: L.countryPath(pp.iso3), "data-nav": "" }, pp.name) : h("span", null, pp.name),
            h("span", { class: "num" }, L.fmtCompact(pp.people)),
          ),
        ),
      );
    };
    const migBlock =
      !world && m
        ? h(
            "div",
            { class: "cv-more-sec" },
            h("h3", null, `Moving in and out${m.year ? ` (people, ${m.year})` : ""}`),
            h(
              "dl",
              { class: "stats two" },
              stat(`Born abroad, living in ${rec.name}`, L.fmtWords(m.immigrants), m.immigrantsPct != null ? `(${m.immigrantsPct}% of residents)` : ""),
              stat(`Born in ${rec.name}, living abroad`, L.fmtWords(m.emigrants)),
            ),
            h("div", { class: "corridors" }, h("div", null, h("h4", null, "Most come from"), partnerList(corr?.topOrigins)), h("div", null, h("h4", null, "Most live in"), partnerList(corr?.topDestinations))),
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
    const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(L.xPostText(rec, r2100))}&url=${encodeURIComponent(L.pageUrl(rec.iso3, siteUrl()))}`;
    shareBtn.addEventListener("click", () => share(rec, shareBtn, r2100));
    const fb = data.feedback;
    const issue = fb ? L.buildIssueUrl(fb, "data-problem", { iso3: rec.iso3, name: rec.name, siteUrl: siteUrl() }) : null;
    const mail = L.buildMailto(fb, { iso3: rec.iso3, name: rec.name, siteUrl: siteUrl() });
    const shareSec = h(
      "div",
      { class: "cv-more-sec" },
      h("h3", null, "Share or tell us"),
      h(
        "p",
        { class: "actions" },
        shareBtn,
        h("a", { class: "btn btn-secondary", href: xUrl, target: "_blank", rel: "noopener" }, "Post on X"),
        issue ? h("a", { class: "btn btn-secondary", href: issue, target: "_blank", rel: "noopener", id: "report-link" }, "Report a problem with these numbers") : "",
        h("a", { class: "btn btn-secondary", href: mail }, "Email us"),
      ),
      h("p", { class: "muted small" }, "Sources: UN World Population Prospects 2024 (CC BY 3.0 IGO), UN DESA International Migrant Stock 2024, World Bank (CC BY 4.0). GitHub issues are public; email stays private."),
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

  // ---------------------------------------------------------------- lifecycle

  subscribe((what) => {
    if (!current || el.view.hidden) return;
    if (what === "year" || what === "mix") renderLive();
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
    renderHero(rec);
    setText(el.ppTitle, rec.iso3 === "WLD" ? "Start with 100 people" : `Start with 100 people in ${rec.name}`);
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

