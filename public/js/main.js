// Fertility Tracker v3: boot, routing and URL state (DESIGN-v3 §6).
// Pages: Globe `/`, Country `/country/{ISO3}`, Rankings `/rankings`. Page changes use pushState (Back works);
// year, scenario and focus tweaks use replaceState only.

import { $, setAttr, focusNoScroll, idle, debounce } from "./dom.js";
import * as L from "./logic.js";
import { data, state, subscribe, fetchJson, applyCountries, applyScenarios, setYear, setScenario, pctNow, yearInt, loadDetail, API } from "./store.js";
import { createHome } from "./home.js";
import { createCountryPage } from "./country.js";
import { createRankings } from "./rankings.js";
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
  const r = L.parseRoute(url.pathname, url.search, url.hash);
  if (r.page === "notfound" || /^\/api\//.test(url.pathname)) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});

// The URL follows the year, scenario and globe focus (replaceState only, so history isn't spammed).
const syncUrl = debounce(() => {
  if (!data.ready || state.playing) return;
  const q = shareQuery(page === "globe" && focusIso ? { focus: focusIso } : {});
  const url = location.pathname + q;
  if (url !== location.pathname + location.search) history.replaceState(history.state, "", url);
}, 250);

subscribe((what) => {
  if (what === "year" || what === "scenario" || what === "play") syncUrl();
});

function render({ first = false, nav = false, pop = false } = {}) {
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
  if (nav && prev !== null) {
    // A new page starts at the top; focus its title for keyboard and screen-reader users.
    window.scrollTo(0, 0);
    const h1 = document.querySelector(`#view-${page} h1`);
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

// ------------------------------------------------------------------ top bar

const topbar = createTopbar({
  getPlaces: () => data.searchPlaces,
  getRecord: (iso3) => data.records.get(iso3),
  getPct: (iso3) => pctNow(iso3),
  getYear: () => yearInt(),
  topPlaces: (n) =>
    data.list
      .filter((r) => Number.isInteger(r.risk?.rank))
      .sort((a, b) => a.risk.rank - b.risk.rank)
      .slice(0, n),
  onSelect: (iso3) => {
    if (page === "globe" && home) home.selectFromSearch(iso3);
    else navigate(L.countryPath(iso3));
  },
  getFeedback: () => data.feedback,
  siteUrl,
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
      updateJsonLd(idx.generatedAt ?? data.generatedAt);
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

function updateJsonLd(date) {
  const node = $("dataset-jsonld");
  if (!node || !date) return;
  try {
    const d = JSON.parse(node.textContent);
    d.dateModified = date;
    node.textContent = JSON.stringify(d);
  } catch {}
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
