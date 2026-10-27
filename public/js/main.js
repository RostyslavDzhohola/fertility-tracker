// Fertility Tracker v2: page bootstrap and the single selection entry point (DESIGN §3).

import { $, h, setText, setAttr, media, focusNoScroll, announce, jumpTo, copyText, idle } from "./dom.js";
import * as L from "./logic.js";
import { createMap } from "./map.js";
import { createCountryView } from "./country.js";
import { createListbox, createChips, createDialog } from "./lists.js";
import { createSearch } from "./search.js";

const API = "api/v1/";

const state = {
  records: new Map(),
  list: [], // every place except WLD
  searchPlaces: [],
  selected: null,
  colorMode: pref("ft.colorMode", ["risk", "tfr"], "risk"),
  view: pref("ft.view", ["flat", "globe"], "flat"),
  isolate: null,
  rankedN: 0,
  firstRanked: null,
  latestEstimateYear: 2023,
  generatedAt: null,
  index: null,
  risk: null,
  feedback: null,
  feedbackFailed: false,
  status: null,
  details: new Map(),
  siteUrl: L.SITE_URL,
};

function pref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

function loadDetail(iso3) {
  let e = state.details.get(iso3);
  if (e) return e.promise;
  e = { data: null, promise: null };
  e.promise = fetchJson(`${API}countries/${encodeURIComponent(iso3)}.json`).then(
    (d) => {
      e.data = d;
      return d;
    },
    (err) => {
      state.details.delete(iso3);
      throw err;
    },
  );
  state.details.set(iso3, e);
  return e.promise;
}
const cachedDetail = (iso3) => state.details.get(iso3)?.data ?? null;

// ------------------------------------------------------------------ components

const el = {
  heroSub: $("hero-sub"),
  heroMeta: $("hero-meta"),
  banner: $("load-banner"),
  retry: $("load-retry"),
  mapFrame: $("map-frame"),
  mapSvg: $("map-svg"),
  mapCol: $("map-col"),
  legend: $("legend"),
  legendCaption: $("legend-caption"),
  readoutSw: $("readout-swatch"),
  readoutText: $("readout-text"),
  readoutBtn: $("readout-details"),
  skip: $("skip-details"),
  rankingTitle: $("ranking-title"),
  rankingSub: $("ranking-sub"),
  rankingPanel: $("ranking-panel"),
  globeBtn: $("globe-toggle"),
  minibar: $("minibar"),
  minibarSw: $("minibar-swatch"),
  minibarName: $("minibar-name"),
  minibarTfr: $("minibar-tfr"),
  minibarTier: $("minibar-tier"),
  minibarMap: $("minibar-map"),
  countryHeader: document.querySelector(".c1"),
  country: $("country"),
  countryName: $("country-name"),
  dataJson: $("data-country-json"),
  curl: $("curl-code"),
  dataFoot: $("data-foot"),
  fbGithub: $("fb-github"),
  fbEmail: $("fb-email"),
  fbAddress: $("fb-address"),
  tierBody: $("tier-table-body"),
  weights: $("weights"),
  sources: $("sources-list"),
  dialog: $("all-dialog"),
};

const map = createMap({
  frame: el.mapFrame,
  svg: el.mapSvg,
  tooltip: $("map-tooltip"),
  chooser: $("chooser"),
  chooserRows: $("chooser-rows"),
  note: $("map-note"),
  cursorStatus: $("map-cursor-status"),
  onSelect: (iso3, source) => selectCountry(iso3, { source }),
  onNoData: (name) => showNoData(name),
  onEscape: () => setIsolate(null),
  onSearchRequest: () => search.focusInput(),
  rankedCount: () => state.rankedN,
  firstRanked: () => state.firstRanked,
});

const countryView = createCountryView({
  getRecord: (iso3) => state.records.get(iso3),
  rankedCount: () => state.rankedN,
  loadDetail,
  cachedDetail,
  onSelect: (iso3, source) => selectCountry(iso3, { source }),
  issueUrl: (rec) => (state.feedback ? L.buildIssueUrl(state.feedback, "data-problem", ctx(rec)) : state.feedbackFailed ? L.buildMailto(null, ctx(rec)) : null),
  xIntentUrl: (rec) => `https://x.com/intent/post?text=${encodeURIComponent(L.xPostText(rec))}&url=${encodeURIComponent(L.pageUrl(rec.iso3, state.siteUrl))}`,
  onShare: share,
  latestEstimateYear: () => state.latestEstimateYear,
});

const ranking = createListbox($("ranking-list"), {
  prefix: "row",
  onSelect: (iso3) => selectCountry(iso3, { source: "list" }),
  label: (m) => (m === "tfr" ? "Places ranked by births per woman" : "Places ranked by decline risk"),
});
const dialogList = createListbox($("all-list"), {
  prefix: "dlg",
  onSelect: (iso3) => {
    dialog.close();
    selectCountry(iso3, { source: "dialog" });
  },
  label: (m) => (m === "tfr" ? "All places by births per woman" : "All places ranked by decline risk"),
});
const dialog = createDialog(el.dialog, { listbox: dialogList, filterInput: $("all-filter"), closeBtn: $("all-dialog-close") });
const chips = createChips($("chips"), $("chips-label"), {
  onSelect: (iso3) => selectCountry(iso3, { source: "chip" }),
  onOpenAll: (btn) => dialog.open(btn),
});
const search = createSearch({
  wrap: $("search-wrap"),
  input: $("search"),
  list: $("search-results"),
  clearBtn: $("search-clear"),
  status: $("search-status"),
  getPlaces: () => state.searchPlaces,
  getRecord: (iso3) => state.records.get(iso3),
  getMode: () => state.colorMode,
  topPlaces: (n) => L.orderPlaces(state.list, state.colorMode).ranked.slice(0, n),
  onSelect: (iso3) => selectCountry(iso3, { source: "search" }),
});

function ctx(rec) {
  return { iso3: rec.iso3, name: rec.name, siteUrl: state.siteUrl };
}

// ------------------------------------------------------------------ the one selection entry point (§3.1, §3.2)

function selectCountry(iso3, { source = "init", initial = false } = {}) {
  const rec = state.records.get(iso3);
  if (!rec) {
    announce(`No data for ${iso3}`);
    return;
  }
  const changed = state.selected !== iso3;
  state.selected = iso3;
  // G1: replaceState only, never location.hash. The first-load default leaves the URL clean.
  if (source !== "init" && location.hash !== `#${iso3}`) history.replaceState(null, "", `#${iso3}`);
  map.setSelected(iso3, { animate: !initial && source !== "init" });
  countryView.render(rec, { source: initial || source === "init" ? "init" : source });
  ranking.setSelected(iso3);
  dialogList.setSelected(iso3);
  chips.setSelected(iso3);
  if (source !== "search") search.setValue(rec.name);
  if (source !== "init") document.title = L.documentTitle(rec);
  if (source !== "init" && !initial) announce(L.selectionAnnouncement(rec));
  updateReadout(rec);
  updateMinibar(rec, changed && source !== "init" && !initial);
  updateDataLinks(rec);
  updateFeedbackLinks(rec);
  setText(el.skip, `Skip to ${rec.iso3 === "WLD" ? "World" : rec.name} details`);
}

// ------------------------------------------------------------------ readout row, mini-bar, jumps

let noDataTimer = 0;
function updateReadout(rec) {
  clearTimeout(noDataTimer);
  const color = L.colorFor(rec, state.colorMode);
  if (color) {
    el.readoutSw.style.setProperty("--sw", color);
    el.readoutSw.removeAttribute("data-nodata");
  } else el.readoutSw.setAttribute("data-nodata", "");
  const tier = L.tierOf(rec);
  el.readoutText.replaceChildren(
    h("strong", null, rec.name),
    rec.iso3 !== "WLD" && tier ? ` · ${tier}` : "",
    ` · ${L.fmtTfr(L.tfrValue(rec))}`,
  );
  el.readoutText.title = `${rec.name}: ${L.fmtTfr(L.tfrValue(rec))} births per woman`;
}

function showNoData(name) {
  announce(`No data for ${name}`);
  clearTimeout(noDataTimer);
  el.readoutText.textContent = `No data for ${name}`;
  noDataTimer = setTimeout(() => {
    const rec = state.records.get(state.selected);
    if (rec) updateReadout(rec);
  }, 3000);
}

function updateMinibar(rec, flash) {
  const color = L.colorFor(rec, state.colorMode);
  if (color) el.minibarSw.style.setProperty("--sw", color);
  setText(el.minibarName, rec.name);
  setText(el.minibarTfr, `${L.fmtTfr(L.tfrValue(rec))} births per woman`);
  const tier = L.tierOf(rec);
  setText(el.minibarTier, rec.iso3 !== "WLD" && tier ? tier : "");
  if (flash && el.minibar.classList.contains("visible") && !media.reduced() && typeof el.minibar.animate === "function") {
    const tc = L.TIER_COLORS[tier] ?? "#A3AABA";
    const rgb = tc.match(/\w\w/g).map((x) => parseInt(x, 16));
    el.minibar.animate([{ backgroundColor: `rgba(${rgb.join(",")},.25)` }, { backgroundColor: "#171C26" }], { duration: 600, easing: "ease-out" });
  }
}

// Visible once the country header has scrolled under the top bar; hidden when #country leaves the viewport.
(function minibarObserver() {
  let headerAbove = false;
  let countryInView = false;
  const sync = () => {
    const on = headerAbove && countryInView;
    el.minibar.classList.toggle("visible", on);
    el.minibarMap.tabIndex = -1;
  };
  new IntersectionObserver(
    ([e]) => {
      headerAbove = !e.isIntersecting && e.boundingClientRect.top < 56;
      sync();
    },
    { rootMargin: "-56px 0px 0px 0px", threshold: 0 },
  ).observe(el.countryHeader);
  new IntersectionObserver(
    ([e]) => {
      countryInView = e.isIntersecting;
      sync();
    },
    { rootMargin: "-100px 0px 0px 0px", threshold: 0 },
  ).observe(el.country);
})();

function jumpToDetails() {
  jumpTo(el.countryHeader, el.countryName);
}
el.readoutBtn.addEventListener("click", jumpToDetails);
el.skip.addEventListener("click", (e) => {
  e.preventDefault();
  jumpToDetails();
});
el.minibarMap.addEventListener("click", () => jumpTo(el.mapCol, el.mapSvg));

// Header, caveat and footer links to #data, #feedback, #methodology: explicit jumps (G8). The URL keeps the country.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-jump]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const section = $(a.dataset.jump);
  if (!section) return;
  e.preventDefault();
  jumpTo(section, section.querySelector("h2") ?? section);
});

// ------------------------------------------------------------------ color mode, legend, isolation, view

function setColorMode(mode, { save = true } = {}) {
  state.colorMode = mode;
  if (save) savePref("ft.colorMode", mode);
  for (const b of document.querySelectorAll(".seg-btn")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  state.isolate = null;
  map.setIsolate(null);
  map.setColorMode(mode);
  document.body.classList.toggle("mode-tfr", mode === "tfr");
  setText(el.rankingTitle, mode === "tfr" ? "Lowest births per woman" : "Highest risk of shrinking");
  setText(el.rankingSub, mode === "tfr" ? "Places with 100,000+ people" : "Ranked by decline-risk score, 0–100");
  if (state.list.length) {
    buildLegend();
    ranking.build(state.list, mode);
    dialogList.build(state.list, mode);
    chips.build(state.list, mode, state.list.length);
    ranking.setSelected(state.selected);
    dialogList.setSelected(state.selected);
    chips.setSelected(state.selected);
    const rec = state.records.get(state.selected);
    if (rec) {
      updateReadout(rec);
      updateMinibar(rec, false);
    }
    search.refresh();
  }
}

for (const b of document.querySelectorAll(".seg-btn")) {
  b.addEventListener("click", () => {
    if (state.colorMode !== b.dataset.mode) setColorMode(b.dataset.mode);
  });
}

function tierDescription(name) {
  return state.risk?.methodology?.tiers?.find((t) => t.name === name)?.description ?? "";
}

function buildLegend() {
  const mode = state.colorMode;
  const counts = L.countByKey(state.list, mode);
  const nodataPolys = map.noDataCount?.() ?? 0;
  const nodataCount = (counts.get(L.NODATA) ?? 0) + nodataPolys;
  const items = [];
  for (const it of L.legendItems(mode)) {
    const n = counts.get(it.key) ?? 0;
    const sw = h("span", { class: "swatch", "aria-hidden": "true" });
    sw.style.setProperty("--sw", it.color);
    const desc = mode === "risk" ? tierDescription(it.key) : "";
    const label = mode === "risk" ? it.label : it.label;
    items.push(
      h(
        "button",
        {
          type: "button",
          class: "legend-item",
          "data-key": it.key,
          "aria-pressed": String(state.isolate === it.key),
          title: desc ? `${it.label} decline risk: ${desc}` : `${label} births per woman`,
          "aria-label": `${mode === "risk" ? `${it.label} decline risk` : `${label} births per woman`}, ${n} places. Show only these.`,
        },
        sw,
        h("span", null, label),
        h("span", { class: "legend-count" }, String(n)),
      ),
    );
    if (mode === "tfr" && it.key === "tfr-3") items.push(h("span", { class: "legend-boundary", "aria-hidden": "true" }, "2.1 = replacement"));
  }
  if (nodataCount > 0) {
    const sw = h("span", { class: "swatch", "data-nodata": "", "aria-hidden": "true" });
    items.push(h("span", { class: "legend-item static", title: "No data in our sources" }, sw, h("span", null, "No data"), h("span", { class: "legend-count" }, String(nodataCount))));
  }
  el.legend.replaceChildren(...items);
  el.legend.setAttribute("aria-label", mode === "tfr" ? "Legend: births per woman" : "Legend: decline risk");
  el.legend.classList.toggle("isolating", state.isolate != null);
}

function setIsolate(key) {
  state.isolate = key;
  map.setIsolate(key);
  for (const b of el.legend.querySelectorAll(".legend-item[data-key]")) b.setAttribute("aria-pressed", String(b.dataset.key === key));
  el.legend.classList.toggle("isolating", key != null);
}

el.legend.addEventListener("click", (e) => {
  const b = e.target.closest(".legend-item[data-key]");
  if (!b) return;
  setIsolate(state.isolate === b.dataset.key ? null : b.dataset.key);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || state.isolate == null || e.defaultPrevented) return;
  const t = e.target;
  if (t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest("dialog, .chooser"))) return;
  setIsolate(null);
});

function setView(v, { save = true } = {}) {
  state.view = v;
  if (save) savePref("ft.view", v);
  el.globeBtn.setAttribute("aria-pressed", String(v === "globe"));
  map.setView(v);
}
el.globeBtn.addEventListener("click", () => setView(state.view === "globe" ? "flat" : "globe"));

// ------------------------------------------------------------------ share, copy

async function share(rec, btn) {
  const url = L.pageUrl(rec.iso3, state.siteUrl);
  const title = L.documentTitle(rec);
  if (navigator.share && media.coarse()) {
    try {
      await navigator.share({ title, text: L.xPostText(rec), url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  const ok = await copyText(url);
  flashLabel(btn, ok ? "Link copied" : "Copy failed", "Share");
  announce(ok ? "Link copied to clipboard" : "Couldn't copy the link");
}

function flashLabel(btn, text, restore) {
  clearTimeout(btn._t);
  btn.textContent = text;
  btn._t = setTimeout(() => (btn.textContent = restore), 1500);
}

for (const b of document.querySelectorAll(".copy-btn")) {
  b.addEventListener("click", async () => {
    const src = $(b.dataset.copy);
    if (!src) return;
    const ok = await copyText(src.textContent.trim());
    flashLabel(b, ok ? "Copied" : "Copy failed", "Copy");
    announce(ok ? "Copied to clipboard" : "Couldn't copy");
  });
}

// ------------------------------------------------------------------ data section, feedback

function updateDataLinks(rec) {
  const world = rec.iso3 === "WLD";
  setText(el.dataJson, `${world ? "World" : rec.name} as JSON`);
  setAttr(el.dataJson, "href", `${API}countries/${encodeURIComponent(rec.iso3)}.json`);
  setText(el.curl, `curl -s ${state.siteUrl}${API}countries/${rec.iso3}.json`);
}

function updateFeedbackLinks(rec) {
  const c = rec ? ctx(rec) : { siteUrl: state.siteUrl };
  const fb = state.feedback;
  if (fb) {
    const gh = L.buildChooserUrl(fb, c);
    if (gh) setAttr(el.fbGithub, "href", gh);
  }
  setAttr(el.fbEmail, "href", L.buildMailto(fb, c));
  countryView.refreshLinks();
}

function sourceLabel(src) {
  const pub = src.publisher ?? "";
  const prefix = /^United Nations/.test(pub) ? (src.id === "UN-DESA" ? "UN DESA " : "UN ") : /^World Bank/.test(pub) ? "World Bank " : "";
  return prefix + src.name;
}
function licenseLabel(src) {
  return String(src.license ?? "").split(";")[0].replace(/\s*\((UN|World Bank)\)\s*$/, "").trim();
}

function renderSources() {
  const idx = state.index;
  const srcs = idx?.sources ?? [];
  const date = state.generatedAt ? L.fmtDate(state.generatedAt) : null;
  const checked = state.status?.checkedAt ? L.fmtDate(state.status.checkedAt) : null;
  if (srcs.length) {
    const parts = [];
    srcs.forEach((src, i) => {
      if (i) parts.push(i === srcs.length - 1 ? " and " : ", ");
      parts.push(h("a", { href: src.homepage }, sourceLabel(src)), ` (${licenseLabel(src)})`);
    });
    el.dataFoot.replaceChildren(
      "Sources: ",
      ...parts,
      `, the UN data via Our World in Data (CC BY 4.0). Code MIT.${date ? ` Last updated ${date}, checked every Monday.` : " Checked every Monday."}${checked ? ` Last check ${checked}.` : ""}`,
    );
    el.sources.replaceChildren(
      ...srcs.map((src) =>
        h("li", null, h("a", { href: src.homepage }, sourceLabel(src)), ` · ${src.publisher}${src.vintage ? `, ${src.vintage}` : ""} · ${licenseLabel(src)}`),
      ),
    );
  } else if (date) {
    el.dataFoot.append(` Last updated ${date}.`);
  }
}

function renderMethodology() {
  const m = state.risk?.methodology;
  if (!m) return;
  const tiers = [...(m.tiers ?? [])].sort((a, b) => b.min - a.min);
  el.tierBody.replaceChildren(
    ...tiers.map((t, i) => {
      const upper = i === 0 ? null : tiers[i - 1].min - 1;
      const range = upper == null ? `≥ ${t.min}` : `${t.min}–${upper}`;
      const sw = h("span", { class: "swatch", "aria-hidden": "true" });
      sw.style.setProperty("--sw", L.TIER_COLORS[t.name] ?? "#1A1F2A");
      return h("tr", null, h("td", null, sw, `${t.name} decline risk`), h("td", null, range), h("td", null, t.description ?? ""));
    }),
  );
  el.weights.replaceChildren(
    ...(m.components ?? []).map((c) => h("li", null, h("b", null, c.label), h("span", { class: "w-pts" }, ` · ${c.weight} points · `), c.explain ?? "")),
  );
  countryView.setTierMins(m.tiers);
  if (state.list.length && state.colorMode === "risk") buildLegend();
}

function renderFeedbackConfig() {
  const fb = state.feedback;
  if (state.feedbackFailed) {
    // Only the mailto channel, with the address from the brief.
    el.fbGithub.remove();
    setText(el.fbAddress, L.FALLBACK_EMAIL);
  } else if (fb?.email?.address) {
    setText(el.fbAddress, fb.email.address);
  }
  if (fb?.site?.url) state.siteUrl = fb.site.url.endsWith("/") ? fb.site.url : `${fb.site.url}/`;
  const xUrl = L.xProfileUrl(fb);
  const handle = L.xHandle(fb);
  // While the handle is a TODO_ placeholder nothing X-related is rendered at all.
  if (xUrl && handle) {
    $("feedback").append(h("p", { class: "fb-x" }, "Follow updates on X: ", h("a", { href: xUrl, rel: "noopener" }, `@${handle}`)));
    document.querySelector(".footer-links")?.append(h("a", { href: xUrl, rel: "noopener" }, `@${handle} on X`));
  }
  const rec = state.records.get(state.selected);
  updateFeedbackLinks(rec);
  if (rec) updateDataLinks(rec);
}

// ------------------------------------------------------------------ hero

function renderHero() {
  const total = state.list.length;
  const below = state.list.filter((r) => L.tfrValue(r) != null && L.tfrValue(r) < L.REPLACEMENT).length;
  setText(el.heroSub, `${below} of ${total} countries and territories are under 2.1 births per woman, the level that keeps a population steady.`);
  const w = state.records.get("WLD");
  const critical = state.list.filter((r) => L.tierOf(r) === "Critical").length;
  const parts = [];
  if (w) parts.push(`World: ${L.fmtTfr(L.tfrValue(w))} births per woman`);
  parts.push(`${critical} places at critical risk`);
  if (state.generatedAt) parts.push(`Updated ${L.fmtDate(state.generatedAt)}, checked weekly`);
  setText(el.heroMeta, parts.join(" · "));
}

function updateJsonLd() {
  const node = $("dataset-jsonld");
  if (!node || !state.generatedAt) return;
  try {
    const data = JSON.parse(node.textContent);
    data.dateModified = state.generatedAt;
    node.textContent = JSON.stringify(data);
  } catch {}
}

// ------------------------------------------------------------------ hash (§3.5)

function hashSelection() {
  return L.parseSelectionHash(location.hash, (c) => state.records.has(c));
}

window.addEventListener("hashchange", () => {
  const hs = hashSelection();
  if (!hs) return; // #data, #feedback, ... are ordinary anchors
  if (hs.normalized) history.replaceState(null, "", `#${hs.iso3}`);
  if (hs.iso3 !== state.selected) selectCountry(hs.iso3, { source: "hash" });
});

// ------------------------------------------------------------------ boot

function applyCountries(data) {
  state.records = new Map(data.countries.map((c) => [c.iso3, c]));
  state.list = data.countries.filter((c) => c.iso3 !== "WLD");
  state.searchPlaces = data.countries.map((c) => ({ iso3: c.iso3, name: c.name, population: c.population?.value ?? 0 }));
  state.generatedAt = data.generatedAt ?? state.generatedAt;
  state.latestEstimateYear = data.latestEstimateYear ?? state.latestEstimateYear;
  const ranked = state.list.filter((c) => Number.isInteger(c.risk?.rank)).sort((a, b) => a.risk.rank - b.risk.rank);
  state.rankedN = state.risk?.ranking?.length ?? ranked.length;
  state.firstRanked = ranked[0]?.iso3 ?? state.list[0]?.iso3 ?? null;
}

let topology = null;
let points = {};

async function loadCountries() {
  try {
    const data = await fetchJson(`${API}countries.json`);
    el.banner.hidden = true;
    return data;
  } catch (err) {
    console.error(err);
    el.banner.hidden = false;
    return null;
  }
}

async function start() {
  setText(el.rankingTitle, state.colorMode === "tfr" ? "Lowest births per woman" : "Highest risk of shrinking");
  for (const b of document.querySelectorAll(".seg-btn")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.colorMode));
  el.globeBtn.setAttribute("aria-pressed", String(state.view === "globe"));
  document.body.classList.toggle("mode-tfr", state.colorMode === "tfr");

  const pGeo = Promise.all([fetchJson("geo/countries-110m.json"), fetchJson("geo/world-points.json").catch(() => ({}))]);
  const pCountries = loadCountries();
  const pRisk = fetchJson(`${API}risk.json`).catch(() => null);
  const pIndex = fetchJson(`${API}index.json`).catch(() => null);
  const pFeedback = fetchJson("feedback.json").catch(() => {
    state.feedbackFailed = true;
    return null;
  });
  const pStatus = fetchJson(`${API}status.json`).catch(() => null); // only exists on the deployed site

  let data = null;
  try {
    [[topology, points], data] = await Promise.all([pGeo, pCountries]);
  } catch (err) {
    console.error(err);
    setText($("map-note"), "Couldn't load the map outline.");
    data = await pCountries;
  }
  if (data) applyCountries(data);
  if (topology) {
    map.setTopology(topology, points, state.records);
    if (state.view === "globe") map.setView("globe");
  }
  if (data) afterData();

  pRisk.then((risk) => {
    state.risk = risk;
    if (risk?.ranking) state.rankedN = risk.ranking.length;
    renderMethodology();
    countryView.refreshHeader();
  });
  pIndex.then((idx) => {
    state.index = idx;
    if (idx?.generatedAt && !state.generatedAt) state.generatedAt = idx.generatedAt;
    renderSources();
    renderHero();
    updateJsonLd();
  });
  pFeedback.then((fb) => {
    state.feedback = fb;
    renderFeedbackConfig();
  });
  pStatus.then((st) => {
    state.status = st;
    if (st) renderSources();
  });
}

function afterData() {
  renderHero();
  updateJsonLd();
  setColorMode(state.colorMode, { save: false });
  const hs = hashSelection();
  if (hs) {
    if (hs.normalized) history.replaceState(null, "", `#${hs.iso3}`);
    selectCountry(hs.iso3, { source: "hash", initial: true });
  } else if (state.firstRanked) {
    selectCountry(state.firstRanked, { source: "init" });
  }
  // Prefetch the top 10 and the world once the page is idle (§3.8).
  idle(() => {
    const top = L.orderPlaces(state.list, "risk").ranked.slice(0, 10).map((r) => r.iso3);
    for (const iso3 of ["WLD", ...top]) loadDetail(iso3).catch(() => {});
  });
}

el.retry.addEventListener("click", async () => {
  el.retry.disabled = true;
  const data = await loadCountries();
  el.retry.disabled = false;
  if (!data) return;
  applyCountries(data);
  if (topology) map.setRecords(state.records);
  afterData();
});

start();
