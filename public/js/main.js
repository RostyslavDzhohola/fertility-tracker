// Fertility Tracker v3: boot, routing and URL state (DESIGN-v3 §6).
// Pages: Globe `/`, Country `/country/{ISO3}`, Rankings `/rankings`. Page changes use pushState (Back works);
// year, scenario and focus tweaks use replaceState only.

import { $, setAttr, focusNoScroll, idle } from "./dom.js";
import * as L from "./logic.js";
import { data, state, subscribe, fetchJson, applyCountries, applyScenarios, setYear, setScenario, outlookPct, pct2100, yearInt, loadDetail, API } from "./store.js";
import { createHome } from "./home.js";
import { createCountryPage } from "./country.js";
import { createRankings } from "./rankings.js";
import { closeShare } from "./snapshot.js";
import { createTopbar } from "./topbar.js";

const el = {
  banner: $("load-banner"),
  retry: $("load-retry"),
  loading: $("app-loading"),
};

let route = L.parseRoute(location.pathname, location.search, location.hash);
if (route.redirect) history.replaceState(history.state, "", route.redirect + location.search);
let page = null;
let home = null;
let country = null;
let rankings = null;
let focusIso = route.page === "globe" ? route.focus : null;
// The globe's outlines are only needed on the globe page: start that download with the data, not on other pages.
const geoFetch = route.page === "globe" ? fetchJson("/geo/countries-110m.json") : null;
geoFetch?.catch(() => {});

const siteUrl = () => data.siteUrl;

// ------------------------------------------------------------------ navigation

function shareQuery(extra = {}) {
  return L.buildQuery({ year: yearInt(), scenario: state.scenario, ...extra }, { defaultYear: data.end });
}

function navigate(path) {
  const [p] = path.split("?");
  const target = L.parseRoute(p, "", "");
  const url = (target.redirect ?? p) + shareQuery(target.page === "globe" && target.focus ? { focus: target.focus } : {});
  if (url === location.pathname + location.search) return;
  // The page being left keeps the year and scenario it showed, even if the slider moved in the last 250 ms: Back
  // returns to exactly that.
  clearTimeout(urlTimer);
  writeUrl();
  history.pushState(null, "", url);
  render({ nav: true });
}

window.addEventListener("popstate", () => render({ pop: true }));

// Same-site links to the app's own pages are handled here; /api/ and files load normally.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest("a[href]");
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  // In-page fragment links ("Skip to content" → #main): move focus to the target, keep the route and the URL state.
  // Native anchor jumps would fire popstate and reset the year and scenario from a URL that doesn't carry them.
  if (url.hash && url.pathname === location.pathname && url.search === location.search) {
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    focusNoScroll(target);
    // The user asked to move: bring the target to the top, below the sticky bar.
    const top = target.getBoundingClientRect().top + window.scrollY - (document.querySelector(".topbar")?.offsetHeight ?? 0);
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    return;
  }
  const r = L.parseRoute(url.pathname, url.search, url.hash);
  if (r.page === "notfound" || /^\/api\//.test(url.pathname)) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});

// The URL follows the year, scenario and globe focus (replaceState only, so history isn't spammed), 250 ms after the
// last change; navigate() writes it at once before leaving.
function writeUrl() {
  if (!data.ready || state.playing) return;
  const q = shareQuery(page === "globe" && focusIso ? { focus: focusIso } : {});
  const url = location.pathname + q;
  if (url !== location.pathname + location.search) history.replaceState(history.state, "", url);
}
let urlTimer = 0;
const syncUrl = () => {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(writeUrl, 250);
};

subscribe((what) => {
  if (what === "year" || what === "scenario" || what === "play") syncUrl();
});

function render({ first = false, nav = false, pop = false } = {}) {
  closeShare(); // a picture of the page you are leaving
  route = L.parseRoute(location.pathname, location.search, location.hash);
  if (route.redirect) {
    history.replaceState(history.state, "", route.redirect + location.search);
    route = L.parseRoute(location.pathname, location.search, "");
  }
  // URL → state. A link or Back restores exactly what the URL says (defaults when absent).
  if (first || pop) {
    if (route.year != null) setYear(route.year, { source: "url" });
    else if (!first) setYear(data.end, { source: "url" });
    setScenario(route.scenario ?? "medium", { source: "url", animate: !first });
  }
  const next = route.page === "notfound" ? "globe" : route.page;
  if (page !== next) {
    if (page === "globe") home.hide();
    if (page === "country") country.hide();
    if (page === "rankings") rankings.hide();
  }
  const prev = page;
  page = next;
  topbar.setPage(page);
  if (page === "globe") {
    focusIso = route.focus;
    home.show(route, { first });
    document.title = L.HOME_TITLE;
  } else if (page === "country") {
    country.show(route.iso3);
    if (nav || pop) setCanonical(`country/${route.iso3}`);
  } else if (page === "rankings") {
    rankings.show();
  }
  if (page !== "country") setCanonical(page === "rankings" ? "rankings" : "");
  setJsonLd(page === "country" ? (data.records.get(route.iso3) ?? null) : null);
  if (nav && prev !== null) {
    // A new page starts at the top; focus its title for keyboard and screen-reader users.
    window.scrollTo(0, 0);
    const h1 = [...document.querySelectorAll(`#view-${page} h1`)].find((x) => !x.closest("[hidden]"));
    if (h1) {
      if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      focusNoScroll(h1);
    }
  }
}

function setCanonical(path) {
  const link = document.querySelector('link[rel="canonical"]');
  if (link) setAttr(link, "href", `${L.SITE_URL}${path}`);
}

// The JSON-LD describes the page shown: a place's own Dataset, or the whole one on the globe and the rankings.
let jsonLdRec; // undefined until the first route
function setJsonLd(rec = jsonLdRec) {
  if (rec === undefined) return;
  jsonLdRec = rec;
  const node = $("dataset-jsonld");
  if (!node) return;
  const dateModified = data.index?.generatedAt ?? data.generatedAt ?? null;
  const d = rec ? L.placeDataset(rec, L.SITE_URL, { dateModified }) : { ...L.SITE_DATASET, ...(dateModified ? { dateModified } : {}) };
  node.textContent = JSON.stringify(d);
}

// ------------------------------------------------------------------ top bar

const topbar = createTopbar({
  getPlaces: () => data.searchPlaces,
  getRecord: (iso3) => data.records.get(iso3),
  getPct: (iso3) => outlookPct(iso3),
  topPlaces: (n) =>
    data.list
      .filter((r) => r.ranked === true && pct2100(r.iso3, state.scenario) != null)
      .sort((a, b) => pct2100(a.iso3, state.scenario) - pct2100(b.iso3, state.scenario))
      .slice(0, n),
  onSelect: (iso3) => {
    if (page === "globe" && home) home.selectFromSearch(iso3);
    else navigate(L.countryPath(iso3));
  },
  getFeedback: () => data.feedback,
  siteUrl,
  getContext: () => {
    const iso3 = page === "country" ? route?.iso3 : page === "globe" ? focusIso : null;
    const rec = iso3 ? data.records.get(iso3) : null;
    return rec ? { iso3: rec.iso3, name: rec.name } : {};
  },
});

// ------------------------------------------------------------------ boot

async function loadCore() {
  try {
    const [countries, scen] = await Promise.all([fetchJson(`${API}countries.json`), fetchJson(`${API}scenarios.json`)]);
    applyCountries(countries);
    applyScenarios(scen);
    el.banner.hidden = true;
    return true;
  } catch (err) {
    console.error(err);
    el.banner.hidden = false;
    return false;
  }
}

function startPages() {
  data.ready = true;
  state.year = route.year != null ? Math.max(data.today, Math.min(data.end, route.year)) : data.end;
  home = createHome({
    navigate,
    siteUrl,
    geoFetch,
    onFocusChange: (iso3) => {
      focusIso = iso3;
      syncUrl();
    },
  });
  country = createCountryPage({ navigate, siteUrl });
  rankings = createRankings({ navigate });
  window.FT = { data, state, home, country, rankings, navigate };
  el.loading?.remove();
  render({ first: true });
  document.documentElement.classList.add("ready");
  // Secondary data: feedback links, risk method, freshness. None of it blocks the first paint.
  fetchJson("/feedback.json")
    .then((fb) => {
      data.feedback = fb;
      if (fb?.site?.url) data.siteUrl = fb.site.url.endsWith("/") ? fb.site.url : `${fb.site.url}/`;
      country.refreshLinks();
      topbar.refreshFeedback();
    })
    .catch(() => {
      data.feedbackFailed = true;
    });
  fetchJson(`${API}index.json`)
    .then((idx) => {
      data.index = idx;
      setJsonLd();
    })
    .catch(() => {});
  idle(() => {
    const top = data.list
      .filter((r) => Number.isInteger(r.risk?.rank))
      .sort((a, b) => a.risk.rank - b.risk.rank)
      .slice(0, 6)
      .map((r) => r.iso3);
    for (const iso3 of top) loadDetail(iso3).catch(() => {});
  });
}

el.retry?.addEventListener("click", async () => {
  el.retry.disabled = true;
  const ok = await loadCore();
  el.retry.disabled = false;
  if (ok && !data.ready) startPages();
});

(async () => {
  if (await loadCore()) startPages();
})();
