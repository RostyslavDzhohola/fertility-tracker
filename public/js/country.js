// Country view (DESIGN §5). Every block keeps its reserved size; content is updated in place (G5, G6).

import { $, h, setText, setAttr, media, debounce } from "./dom.js";
import {
  REPLACEMENT,
  TIER_COLORS,
  TIERS,
  DEFAULT_TIER_MINS,
  GEN_YEARS,
  tierOf,
  tfrValue,
  fmtTfr,
  fmtCompact,
  fmtPct,
  fmtFlow,
  fmtRate,
  fmtCount,
  generationCounts,
  nextGeneration,
  dotFills,
  rankLabel,
  tierLabel,
  summarySentence,
  populationTakeaway,
  waterfallTakeaway,
  waterfallRows,
  componentsTakeaway,
  migrationTakeaway,
  generationsTakeaway,
  tfrTakeaway,
  possessive,
  lastEstimateYear,
  peakOf,
} from "./logic.js";
import { lineChart, waterfallChart, chartSkeleton, chartError } from "./charts.js";

const GEN_LABELS = ["Today", "Children", "Grandchildren", "Great-grand­children", "4th generation"];

export function createCountryView(opts) {
  const { getRecord, rankedCount, loadDetail, cachedDetail, onSelect, issueUrl, xIntentUrl, onShare, latestEstimateYear } = opts;

  const el = {
    content: $("country-content"),
    region: $("cv-region"),
    name: $("country-name"),
    tier: $("cv-tier"),
    tierSw: $("cv-tier-swatch"),
    tierText: $("cv-tier-text"),
    rank: $("cv-rank"),
    summary: $("cv-summary"),
    share: $("share-btn"),
    postX: $("post-x"),
    kpiTfr: $("kpi-tfr"),
    kpiTfrSub: $("kpi-tfr-sub"),
    kpiPop: $("kpi-pop"),
    kpiPopSub: $("kpi-pop-sub"),
    kpiGen: $("kpi-gen"),
    kpiAge: $("kpi-age"),
    kpiAgeSub: $("kpi-age-sub"),
    whyTitle: $("why-title"),
    meterWrap: $("meter-wrap"),
    meterTrack: $("meter-track"),
    meterMarker: $("meter-marker"),
    meterValue: $("meter-value"),
    meterWorld: $("meter-world"),
    factors: $("factors"),
    allFactors: $("all-factors"),
    popTake: $("pop-takeaway"),
    popChart: $("pop-chart"),
    wfLabel: $("wf-label"),
    wfTake: $("wf-takeaway"),
    wfChart: $("wf-chart"),
    compTake: $("comp-takeaway"),
    compChart: $("comp-chart"),
    migTake: $("mig-takeaway"),
    migBars: $("mig-bars"),
    migNet: $("mig-net"),
    corrOrigins: $("corr-origins"),
    corrDest: $("corr-dest"),
    migNote: $("mig-note"),
    genText: $("gen-takeaway-text"),
    hypo: $("hypo-tag"),
    range: $("whatif-range"),
    out: $("whatif-out"),
    tickCountry: $("tick-country"),
    tickRepl: $("tick-repl"),
    reset: $("whatif-reset"),
    gens: $("gens"),
    tfrTake: $("tfr-takeaway"),
    tfrChart: $("tfr-chart"),
    c9Label: $("c9-label"),
    c9Json: $("c9-json"),
    c9Report: $("c9-report"),
  };

  const H = {
    pop: Number(el.popChart.dataset.height) || 200,
    wf: Number(el.wfChart.dataset.height) || 168,
    comp: Number(el.compChart.dataset.height) || 220,
    tfr: Number(el.tfrChart.dataset.height) || 200,
  };
  for (const [k, c] of [
    ["pop", el.popChart],
    ["wf", el.wfChart],
    ["comp", el.compChart],
    ["tfr", el.tfrChart],
  ])
    c.style.height = `${H[k]}px`;

  let current = null;
  let token = 0;
  let whatIf = null;
  let factorsExpanded = false;
  let tierMins = { ...DEFAULT_TIER_MINS };
  let lazyState = { status: "idle", detail: null, world: null };

  // ------------------------------------------------------------ static structures built once
  const genRows = GEN_LABELS.map((label, i) => {
    const dots = [];
    const grid = h("span", { class: "dots", "aria-hidden": "true" });
    for (let k = 0; k < 100; k++) {
      const fill = h("i");
      dots.push(fill);
      grid.append(h("span", { class: "dot" }, fill));
    }
    const year = h("span");
    const count = h("b");
    const extra = h("span", { class: "gen-extra", hidden: true });
    const nameEl = h("strong", null, label); // the soft hyphen in "Great-grand\u00adchildren" lets it wrap
    const li = h(
      "li",
      { class: "gen" },
      h("span", { class: "gen-label" }, nameEl, year),
      grid,
      h("span", { class: "gen-count" }, count, extra),
    );
    el.gens.append(li);
    return { li, dots, year, count, extra, fills: new Array(100).fill(-1), i };
  });

  function setTierMins(tiers) {
    if (Array.isArray(tiers) && tiers.length) {
      for (const t of tiers) if (TIERS.includes(t.name) && Number.isFinite(t.min)) tierMins[t.name] = t.min;
    }
    el.meterTrack.replaceChildren();
    const order = [...TIERS].sort((a, b) => tierMins[a] - tierMins[b]);
    order.forEach((t, i) => {
      const from = tierMins[t];
      const to = i + 1 < order.length ? tierMins[order[i + 1]] : 100;
      el.meterTrack.append(h("span", { style: { width: `${to - from}%`, background: TIER_COLORS[t] } }));
    });
  }
  setTierMins(null);

  // ------------------------------------------------------------ helpers
  const isWorld = (rec) => rec?.iso3 === "WLD";
  const label = (rec) => (isWorld(rec) ? "the world" : rec.name);

  // ------------------------------------------------------------ C1, C2, C3 (instant)
  function renderHeader(rec, detail) {
    const world = isWorld(rec);
    setText(el.region, world ? "Whole world" : rec.region ?? "");
    setText(el.name, rec.name);
    el.name.classList.toggle("long", rec.name.length > 24);
    setAttr(el.name, "title", rec.name);
    const tier = tierOf(rec);
    el.tier.hidden = world;
    if (!world) {
      el.tier.style.setProperty("--sw", tier ? TIER_COLORS[tier] : "var(--border-strong)");
      el.tierSw.style.setProperty("--sw", tier ? TIER_COLORS[tier] : "var(--map-nodata)");
      setText(el.tierText, tierLabel(tier));
    }
    setText(el.rank, rankLabel(rec, rankedCount()));
    setText(el.summary, summarySentence(rec, detail));
    setAttr(el.postX, "href", xIntentUrl(rec));
  }

  function renderKpis(rec) {
    const tfr = tfrValue(rec);
    setText(el.kpiTfr, fmtTfr(tfr));
    setText(el.kpiTfrSub, tfr != null ? `in ${rec.tfr.year} · 2.1 keeps a population steady` : "no recent figure");
    const p = rec.projection ?? {};
    setText(el.kpiPop, p.change2100Pct != null ? fmtPct(p.change2100Pct) : "–");
    setText(
      el.kpiPopSub,
      rec.population?.value != null && p.population2100 != null
        ? `${fmtCompact(rec.population.value)} now → ${fmtCompact(p.population2100)} (UN projection)`
        : "no UN projection",
    );
    const g = nextGeneration(tfr);
    setText(el.kpiGen, g != null ? String(g) : "–");
    const age = rec.medianAge?.value;
    setText(el.kpiAge, age != null ? age.toFixed(1) : "–");
    const s65 = rec.share65?.value;
    setText(el.kpiAgeSub, s65 != null ? `65 and older: ${Math.round(s65)}%` : "share 65+ not available");
  }

  function renderWhy(rec, detail) {
    const world = isWorld(rec);
    const tier = tierOf(rec);
    const score = rec.risk?.score;
    if (world) setText(el.whyTitle, "The world as a whole");
    else if (!tier || score == null) setText(el.whyTitle, `${rec.name} is not scored`);
    else setText(el.whyTitle, `Why ${rec.name} is rated ${tier} for decline risk`);
    const noMeter = world || !tier || score == null;
    el.meterWrap.classList.toggle("world", noMeter);
    el.meterWorld.hidden = !noMeter;
    if (world) {
      const tfr = tfrValue(rec);
      setText(
        el.meterWorld,
        `The world as a whole isn't scored. It has ${fmtTfr(tfr)} births per woman, ${tfr >= REPLACEMENT ? "just above" : "just below"} the 2.1 replacement level.`,
      );
    } else if (noMeter) {
      setText(el.meterWorld, "Not scored (incomplete data).");
    } else {
      el.meterMarker.style.left = `${Math.max(0, Math.min(100, score))}%`;
      setText(el.meterValue, `${score} / 100`);
      const v = el.meterValue;
      v.style.transform = score < 8 ? "translateX(-4px)" : score > 92 ? "translateX(calc(-100% + 4px))" : "";
    }
    renderFactors(rec, detail);
  }

  function renderFactors(rec, detail) {
    const all = detail?.risk?.factors ?? rec.risk?.factors ?? [];
    const top = rec.risk?.factors ?? all.slice(0, 3);
    const list = factorsExpanded ? all : top.slice(0, 3);
    const items = [...list];
    if (!factorsExpanded) while (items.length < 3) items.push(null);
    el.factors.classList.toggle("expanded", factorsExpanded);
    const lis = items.map((f) => (f == null ? h("li", { class: "skeleton-line", "aria-hidden": "true" }, " ") : h("li", { title: f }, f)));
    el.factors.replaceChildren(...lis);
    const more = (detail?.risk?.factors?.length ?? 0) > Math.min(3, top.length);
    el.allFactors.hidden = !more;
    setText(el.allFactors, factorsExpanded ? "Show fewer factors" : "See all factors");
    setAttr(el.allFactors, "aria-expanded", factorsExpanded ? "true" : "false");
  }

  el.allFactors.addEventListener("click", () => {
    factorsExpanded = !factorsExpanded;
    renderFactors(current, lazyState.detail);
  });

  // ------------------------------------------------------------ C5a waterfall (instant)
  function renderWaterfall(rec, fade) {
    const c = rec.components;
    setText(el.wfLabel, c?.year ? `What's changing the population, ${c.year}` : "What's changing the population");
    setText(el.wfTake, waterfallTakeaway(rec));
    const rows = waterfallRows(c);
    if (!rows) {
      chartError(el.wfChart, H.wf, `No recent births and deaths data for ${label(rec)}.`, null);
      el.wfChart.querySelector(".chart-error button")?.remove();
      return;
    }
    waterfallChart(el.wfChart, rows, {
      height: H.wf,
      fmtValue: (v) => fmtFlow(v),
      fmtRate: (r) => fmtRate(r, { plus: true }),
      ariaLabel: `${el.wfTake.textContent} Births ${fmtFlow(c.births, { plus: false })}, deaths ${fmtFlow(c.deaths, { plus: false })}, net migration ${fmtFlow(c.netMigration ?? 0)}.`,
      fade,
    });
  }

  // ------------------------------------------------------------ C6 moving in, moving out
  function migItem(labelText, valueNode, cls, pct) {
    const track = h("div", { class: "mig-track" });
    if (pct != null) track.append(h("div", { class: `mig-fill ${cls}`, style: { width: `max(2px, ${pct}%)` } }));
    return h("div", { class: "mig-item" }, h("p", { class: "mig-label", title: labelText }, labelText), valueNode, track);
  }

  function renderMigration(rec) {
    setText(el.migTake, migrationTakeaway(rec));
    const m = rec.migrantStock;
    const world = isWorld(rec);
    const items = [];
    if (!m || m.immigrants == null) {
      items.push(h("div", { class: "chart-empty" }, `No migrant-stock data for ${label(rec)}.`));
    } else if (world) {
      items.push(
        migItem(
          "People living outside the country they were born in",
          h("p", { class: "mig-value" }, h("strong", null, fmtCompact(m.immigrants)), ` · ${m.immigrantsPct ?? "–"}% of the world's people`),
          "in",
          100,
        ),
      );
    } else {
      const max = Math.max(m.immigrants ?? 0, m.emigrants ?? 0) || 1;
      items.push(
        migItem(
          `Born abroad, living in ${rec.name}`,
          h("p", { class: "mig-value" }, h("strong", null, fmtCompact(m.immigrants)), m.immigrantsPct != null ? ` · ${m.immigrantsPct.toFixed(1)}% of residents` : ""),
          "in",
          (100 * m.immigrants) / max,
        ),
      );
      if (m.emigrants == null) {
        items.push(
          h(
            "div",
            { class: "mig-item" },
            h("p", { class: "mig-label" }, `Born in ${rec.name}, living abroad`),
            h("p", { class: "mig-value" }, "No data on people living abroad"),
            h("div", { class: "mig-track" }),
          ),
        );
      } else {
        const whose = rec.name.length <= 18 ? `${possessive(rec.name)} population` : "its population";
        items.push(
          migItem(
            `Born in ${rec.name}, living abroad`,
            h(
              "p",
              { class: "mig-value" },
              h("strong", null, fmtCompact(m.emigrants)),
              m.emigrantsPct != null ? ` · equal to ${m.emigrantsPct.toFixed(1)}% of ${whose}` : "",
            ),
            "out",
            (100 * m.emigrants) / max,
          ),
        );
      }
    }
    el.migBars.replaceChildren(...items);
    const c = rec.components;
    if (c && c.netMigration != null) {
      const rate = c.perThousand?.netMigration;
      setText(el.migNet, `Net migration in ${c.year}: ${fmtFlow(c.netMigration)} people${rate != null ? ` (${fmtRate(rate, { plus: true })} per 1,000)` : ""}`);
    } else setText(el.migNet, "Net migration: no recent figure");
    setText(
      el.migNote,
      `These count people, not yearly moves: everyone born abroad who lives here now, and everyone born here who lives abroad. Source: UN migrant stock${m?.year ? `, ${m.year}` : ""}.`,
    );
  }

  function corridorRows(list, partners, state) {
    const rows = [];
    if (state === "loading") {
      for (let i = 0; i < 3; i++) rows.push(h("li", { "aria-hidden": "true" }, h("span", { class: "skel" })));
    } else if (state === "error") {
      rows.push(h("li", null, h("span", { class: "corr-none" }, "Couldn't load this list.")));
    } else if (!partners || !partners.length) {
      rows.push(h("li", null, h("span", { class: "corr-none" }, "No breakdown by country available.")));
    } else {
      for (const p of partners.slice(0, 3)) {
        const known = p.iso3 && getRecord(p.iso3);
        const nameNode = known
          ? h("button", { type: "button", class: "corr-name", "data-iso3": p.iso3, title: p.name }, p.name)
          : h("span", { class: "corr-name", title: p.name }, p.name);
        rows.push(h("li", null, nameNode, h("span", { class: "corr-count" }, fmtCompact(p.people))));
      }
    }
    list.replaceChildren(...rows);
  }

  for (const list of [el.corrOrigins, el.corrDest]) {
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-iso3]");
      if (b) onSelect(b.dataset.iso3, "list");
    });
  }

  function renderCorridors(rec, state, detail) {
    if (isWorld(rec)) {
      corridorRows(el.corrOrigins, [], "done");
      corridorRows(el.corrDest, [], "done");
      return;
    }
    const c = detail?.migrationCorridors;
    corridorRows(el.corrOrigins, c?.topOrigins, state);
    corridorRows(el.corrDest, c?.topDestinations, state);
  }

  // ------------------------------------------------------------ C7 start with 100 people
  function sliderMax(tfr) {
    return Math.max(4, tfr != null ? Math.ceil(tfr * 20) / 20 : 4);
  }

  function renderGenerations(rec) {
    const base = tfrValue(rec);
    const tfr = whatIf ?? base;
    const nameForCopy = isWorld(rec) ? "the world" : rec.name;
    setText(el.genText, generationsTakeaway(nameForCopy, tfr, { whatIf: whatIf != null }));
    el.hypo.hidden = whatIf == null;
    setText(el.out, fmtTfr(tfr));
    el.reset.hidden = whatIf == null;
    setText(el.reset, `Reset to ${isWorld(rec) ? "the world's" : possessive(rec.name)} rate`);
    const counts = generationCounts(tfr, 5);
    const now = new Date().getFullYear();
    genRows.forEach((row, i) => {
      const v = counts[i];
      setText(row.year, i === 0 ? String(now) : `~${now + i * GEN_YEARS}`);
      const txt = v == null ? "–" : v >= 1000 ? Math.round(v).toLocaleString("en-US") : fmtCount(v);
      setText(row.count, txt);
      row.count.classList.toggle("big", txt.length > 4);
      const over = v != null && v > 100 ? Math.round(v) - 100 : 0;
      row.extra.hidden = over <= 0;
      if (over > 0) setText(row.extra, `+${over.toLocaleString("en-US")}`);
      const fills = dotFills(v ?? 0);
      for (let k = 0; k < 100; k++) {
        const f = Math.round(fills[k] * 1000) / 1000;
        if (row.fills[k] !== f) {
          row.fills[k] = f;
          row.dots[k].style.setProperty("--f", f);
        }
      }
      setAttr(row.li, "aria-label", `${GEN_LABELS[i].replace("­", "")}: ${txt} people`);
    });
  }

  function positionTicks(rec) {
    const base = tfrValue(rec);
    const min = Number(el.range.min);
    const max = Number(el.range.max);
    const trackW = el.range.getBoundingClientRect().width || 300;
    const pos = (v) => 10 + (trackW - 20) * ((v - min) / (max - min));
    const place = (node, v, text) => {
      node.textContent = text;
      const px = pos(v);
      node.style.left = `${px}px`;
      const w = text.length * 6.6;
      node.classList.toggle("edge-left", px - w / 2 < 0);
      node.classList.toggle("edge-right", px + w / 2 > trackW);
      return { px, w };
    };
    const r = place(el.tickRepl, REPLACEMENT, "Replacement 2.1");
    if (base == null || Math.abs(base - REPLACEMENT) < 0.15) {
      el.tickCountry.hidden = true;
      return;
    }
    el.tickCountry.hidden = false;
    const name = isWorld(rec) ? "World" : rec.name;
    let text = `${name} ${fmtTfr(base)}`;
    const v = Math.min(base, max);
    let c = { px: pos(v), w: text.length * 6.6 };
    if (Math.abs(c.px - r.px) < c.w / 2 + r.w / 2 + 8) text = fmtTfr(base);
    c = place(el.tickCountry, v, text);
    if (Math.abs(c.px - r.px) < c.w / 2 + r.w / 2 + 4) el.tickCountry.hidden = true;
  }

  function resetSlider(rec) {
    whatIf = null;
    const base = tfrValue(rec);
    el.range.max = String(sliderMax(base));
    el.range.value = String(base ?? REPLACEMENT);
    el.range.disabled = base == null;
    positionTicks(rec);
    renderGenerations(rec);
  }

  el.range.addEventListener("input", () => {
    if (!current) return;
    const v = Number(el.range.value);
    const base = tfrValue(current);
    whatIf = base != null && Math.abs(v - base) < 0.001 ? null : v;
    renderGenerations(current);
  });
  el.reset.addEventListener("click", () => {
    if (!current) return;
    resetSlider(current);
    el.range.focus({ preventScroll: true });
  });

  // ------------------------------------------------------------ lazy charts (C4, C5b, C8, corridors)
  function seriesOf(detail, key) {
    return (detail?.series ?? []).map((r) => [r.year, r[key] ?? null]);
  }

  function renderPopulation(rec, detail, fade) {
    const series = detail.series ?? [];
    const boundary = lastEstimateYear(series, latestEstimateYear());
    setText(el.popTake, populationTakeaway(rec, boundary));
    const values = seriesOf(detail, "population");
    const first = series.find((r) => r.population != null);
    const last = [...series].reverse().find((r) => r.population != null);
    const peak = peakOf(series, "population");
    const ann = [];
    if (peak && peak.year !== first?.year && peak.year !== last?.year)
      ann.push({ year: peak.year, v: peak.population, text: `Peak ${fmtCompact(peak.population)} (${peak.year})`, dot: true });
    lineChart(el.popChart, {
      height: H.pop,
      boundary,
      yKind: "count",
      series: [{ key: "population", color: "var(--text)", width: 2, values, area: "rgba(237,239,244,.06)", endLabel: last ? fmtCompact(last.population) : null, labelColor: "var(--text)" }],
      annotations: ann,
      startLabel: first ? { year: first.year, v: first.population, text: fmtCompact(first.population) } : null,
      fmt: (v) => fmtCompact(v),
      ariaLabel: `${el.popTake.textContent} ${first ? `${first.year}: ${fmtCompact(first.population)}.` : ""} ${last ? `${last.year}: ${fmtCompact(last.population)}.` : ""}`,
      fade,
    });
  }

  function renderComponents(rec, detail, fade) {
    const series = detail.series ?? [];
    const boundary = lastEstimateYear(series, latestEstimateYear());
    setText(el.compTake, componentsTakeaway(rec, series, boundary));
    const since = rec.projection?.naturalDeclineSince;
    const ann = [];
    if (since != null) {
      const row = series.find((r) => r.year === since);
      if (row) ann.push({ year: since, v: (row.births + row.deaths) / 2, text: `Deaths overtake births, ${since}`, dot: true, dotColor: "var(--text)" });
    }
    const first = series[0];
    const last = series[series.length - 1];
    lineChart(el.compChart, {
      height: H.comp,
      boundary,
      yKind: "count",
      emphasizeZero: true,
      series: [
        { key: "births", color: "var(--c-births)", width: 2, values: seriesOf(detail, "births"), endLabel: "Births" },
        { key: "deaths", color: "var(--c-deaths)", width: 2, values: seriesOf(detail, "deaths"), endLabel: "Deaths", labelColor: "#A3AABA" },
        { key: "migration", color: "var(--c-migration)", width: 2, values: seriesOf(detail, "netMigration"), endLabel: "Net migration" },
      ],
      fillBetween: { a: "births", b: "deaths", aboveColor: "rgba(86,180,233,.14)", belowColor: "rgba(124,132,152,.22)" },
      annotations: ann,
      fmt: (v, key) => fmtCompact(v, { plus: key === "migration" }),
      ariaLabel: `${el.compTake.textContent} ${first ? `${first.year}: ${fmtCompact(first.births)} births, ${fmtCompact(first.deaths)} deaths.` : ""} ${last ? `${last.year}: ${fmtCompact(last.births)} births, ${fmtCompact(last.deaths)} deaths.` : ""}`,
      fade,
    });
  }

  function renderTfr(rec, detail, world, fade) {
    const series = detail.series ?? [];
    const boundary = lastEstimateYear(series, latestEstimateYear());
    setText(el.tfrTake, tfrTakeaway(rec, series));
    const values = seriesOf(detail, "tfr");
    let maxV = 0;
    for (const [, v] of values) if (v != null) maxV = Math.max(maxV, v);
    const worldVals = !isWorld(rec) && world ? seriesOf(world, "tfr") : null;
    if (worldVals) for (const [, v] of worldVals) if (v != null) maxV = Math.max(maxV, v);
    const last = [...series].reverse().find((r) => r.tfr != null);
    const sr = [];
    if (worldVals) sr.push({ key: "world", color: "var(--c-deaths)", width: 1.5, values: worldVals, endLabel: "World", labelColor: "#A3AABA" });
    sr.push({ key: "tfr", color: "var(--text)", width: 2.5, values, endLabel: last ? fmtTfr(last.tfr) : null, labelColor: "var(--text)" });
    const ann = [];
    const t = rec.tfr;
    if (t?.value != null && t.year > boundary) ann.push({ year: t.year, v: t.value, text: `${fmtTfr(t.value)} (${t.year})`, dot: true, r: 4, below: t.value > 2.6 });
    lineChart(el.tfrChart, {
      height: H.tfr,
      boundary,
      yKind: "tfr",
      yDomain: [0, Math.max(3, Math.ceil(maxV))],
      series: sr,
      refLines: [{ v: REPLACEMENT, label: "Replacement 2.1", dash: "2 4" }],
      annotations: ann,
      fmt: (v, key) => (key === "world" ? `World ${fmtTfr(v)}` : fmtTfr(v)),
      ariaLabel: `${el.tfrTake.textContent}`,
      fade,
    });
  }

  function renderLazy(rec, detail, world, fade) {
    lazyState = { status: "done", detail, world };
    renderPopulation(rec, detail, fade);
    renderComponents(rec, detail, fade);
    renderTfr(rec, detail, world, fade);
    renderCorridors(rec, "done", detail);
    renderFactors(rec, detail);
    if (isWorld(rec)) setText(el.summary, summarySentence(rec, detail));
  }

  function renderLoading(rec) {
    lazyState = { status: "loading", detail: null, world: null };
    const boundary = latestEstimateYear();
    setText(el.popTake, populationTakeaway(rec, boundary));
    setText(el.compTake, componentsTakeaway(rec, null, boundary));
    setText(el.tfrTake, `Births per woman in ${label(rec)}, 1950–2100.`);
    chartSkeleton(el.popChart, H.pop);
    chartSkeleton(el.compChart, H.comp);
    chartSkeleton(el.tfrChart, H.tfr);
    renderCorridors(rec, "loading", null);
  }

  function renderLazyError(rec) {
    lazyState = { status: "error", detail: null, world: null };
    const msg = `Couldn't load ${isWorld(rec) ? "the world's" : possessive(rec.name)} history.`;
    const retry = () => loadLazy(rec, true);
    chartError(el.popChart, H.pop, msg, retry);
    chartError(el.compChart, H.comp, msg, retry);
    chartError(el.tfrChart, H.tfr, msg, retry);
    renderCorridors(rec, "error", null);
  }

  function loadLazy(rec, fade) {
    const my = token;
    const d = cachedDetail(rec.iso3);
    const w = cachedDetail("WLD");
    if (d && (w || isWorld(rec))) {
      renderLazy(rec, d, isWorld(rec) ? d : w, fade);
      return;
    }
    renderLoading(rec);
    const pd = loadDetail(rec.iso3);
    const pw = isWorld(rec) ? pd : loadDetail("WLD").catch(() => null);
    Promise.all([pd, pw]).then(
      ([detail, world]) => {
        if (my !== token) return; // a newer selection won
        renderLazy(rec, detail, world, true);
      },
      () => {
        if (my !== token) return;
        renderLazyError(rec);
      },
    );
  }

  // ------------------------------------------------------------ C9
  function renderLinks(rec) {
    const world = isWorld(rec);
    setText(el.c9Label, `${world ? "World" : rec.name} data:`);
    setAttr(el.c9Json, "href", `api/v1/countries/${encodeURIComponent(rec.iso3)}.json`);
    setText(el.c9Report, `Report a problem with ${world ? "the world's" : possessive(rec.name)} numbers →`);
    const url = issueUrl(rec);
    if (url) setAttr(el.c9Report, "href", url);
  }

  // ------------------------------------------------------------ public
  function render(rec, { source } = {}) {
    if (!rec) return;
    token++;
    const changed = current?.iso3 !== rec.iso3;
    current = rec;
    if (changed) factorsExpanded = false;
    const cached = cachedDetail(rec.iso3);
    renderHeader(rec, cached);
    renderKpis(rec);
    renderWhy(rec, cached);
    renderWaterfall(rec, false);
    renderMigration(rec);
    resetSlider(rec);
    renderLinks(rec);
    loadLazy(rec, source !== "init");
    if (source !== "init" && changed && !media.reduced()) {
      el.content.classList.remove("xfade");
      void el.content.offsetWidth;
      el.content.classList.add("xfade");
    }
  }

  function refreshLinks() {
    if (current) renderLinks(current);
  }

  function refreshHeader() {
    if (current) setText(el.rank, rankLabel(current, rankedCount()));
  }

  // Re-render charts on width changes (viewBox is in CSS pixels).
  let lastW = 0;
  const ro = new ResizeObserver(
    debounce(() => {
      const w = Math.round(el.content.getBoundingClientRect().width);
      if (!current || w === lastW) return;
      lastW = w;
      renderWaterfall(current, false);
      positionTicks(current);
      if (lazyState.status === "done") {
        renderPopulation(current, lazyState.detail, false);
        renderComponents(current, lazyState.detail, false);
        renderTfr(current, lazyState.detail, lazyState.world, false);
      } else if (lazyState.status === "loading") {
        chartSkeleton(el.popChart, H.pop);
        chartSkeleton(el.compChart, H.comp);
        chartSkeleton(el.tfrChart, H.tfr);
      }
    }, 120),
  );
  ro.observe(el.content);

  el.share.addEventListener("click", () => current && onShare(current, el.share));

  return {
    render,
    setTierMins,
    refreshLinks,
    refreshHeader,
    get current() {
      return current;
    },
  };
}
