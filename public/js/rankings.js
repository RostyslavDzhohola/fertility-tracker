// The rankings page `/rankings` (DESIGN-v3 §4): visual ranked rows with a % change bar, tabs, region chips and the
// scenario switch. Every row is a link to the country's story.

import { $, h, setText, setAttr, focusNoScroll } from "./dom.js";
import * as L from "./logic.js";
import { data, state, subscribe, pct2100, setScenario } from "./store.js";
import { riskChip } from "./ui.js";

const TABS = {
  shrink: { title: "Shrinking most by 2100", sub: (sc) => `Change in people from today to 2100, ${sc === "constant" ? "if birth rates stay the same" : "UN forecast"}.` },
  risk: { title: "Highest risk", sub: () => "Ranked by how likely a population is to shrink, and how fast." },
  babies: { title: "Fewest babies", sub: () => "Babies per woman. It takes about 2.1 to keep a country the same size." },
};

export function createRankings({ navigate }) {
  const el = {
    view: $("view-rankings"),
    sub: $("rk-sub"),
    tabs: [...document.querySelectorAll("#rk-tabs [role=tab]")],
    scen: $("rk-scen"),
    regions: $("rk-regions"),
    list: $("rk-list"),
    small: $("rk-small"),
    smallTitle: $("rk-small-title"),
    count: $("rk-count"),
  };
  let tab = "shrink";
  let region = "all";
  let built = false;

  // Scenario switch (shared state).
  const segs = ["medium", "constant"].map((sc) =>
    h("button", { type: "button", class: "seg", "data-s": sc, "aria-pressed": String(state.scenario === sc), title: L.SCENARIO_HINTS[sc] }, h("span", { class: "long" }, L.SCENARIO_LABELS[sc]), h("span", { class: "short", "aria-hidden": "true" }, L.SCENARIO_SHORT[sc])),
  );
  el.scen.replaceChildren(...segs);
  for (const b of segs) b.addEventListener("click", () => setScenario(b.dataset.s));

  function buildRegions() {
    const regions = [...new Set(data.list.map((r) => r.region).filter(Boolean))].sort();
    const chip = (key, label) => h("button", { type: "button", class: "chip", "data-region": key, "aria-pressed": String(region === key), title: key === "all" ? "" : key }, label);
    el.regions.replaceChildren(chip("all", "All"), ...regions.map((r) => chip(r, L.REGION_SHORT[r] ?? r)));
  }

  el.regions.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-region]");
    if (!b) return;
    region = b.dataset.region;
    for (const c of el.regions.querySelectorAll("button")) setAttr(c, "aria-pressed", String(c.dataset.region === region));
    render();
  });

  function selectTab(key, focus = false) {
    tab = key;
    for (const t of el.tabs) {
      const on = t.dataset.tab === key;
      setAttr(t, "aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) focusNoScroll(t);
    }
    render();
  }
  for (const t of el.tabs) {
    t.addEventListener("click", () => selectTab(t.dataset.tab));
    t.addEventListener("keydown", (e) => {
      const i = el.tabs.indexOf(t);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const n = el.tabs[(i + (e.key === "ArrowRight" ? 1 : el.tabs.length - 1)) % el.tabs.length];
        selectTab(n.dataset.tab, true);
      }
    });
  }

  function sorted(list) {
    const sc = state.scenario;
    const by = {
      shrink: (a, b) => (pct2100(a.iso3, sc) ?? 1e9) - (pct2100(b.iso3, sc) ?? 1e9) || a.name.localeCompare(b.name),
      risk: (a, b) => (a.risk?.rank ?? 1e9) - (b.risk?.rank ?? 1e9) || (b.risk?.score ?? -1) - (a.risk?.score ?? -1) || a.name.localeCompare(b.name),
      babies: (a, b) => (a.tfr?.value ?? 99) - (b.tfr?.value ?? 99) || a.name.localeCompare(b.name),
    }[tab];
    return [...list].sort(by);
  }

  function bar(pct) {
    const track = h("span", { class: "rk-bar", "aria-hidden": "true" }, h("span", { class: "rk-zero" }));
    if (pct != null) {
      const w = Math.min(50, (Math.abs(pct) / 100) * 50);
      const fill = h("span", { class: `rk-fill ${pct < 0 ? "neg" : "pos"}` });
      fill.style.width = `${Math.max(0.6, w)}%`;
      fill.style.background = L.changeColor(pct);
      if (pct < 0) fill.style.right = "50%";
      else fill.style.left = "50%";
      track.append(fill);
      if (pct > 100) track.append(h("span", { class: "rk-over" }, "›"));
    }
    return track;
  }

  function row(rec, rank, top) {
    const sc = state.scenario;
    const pct = pct2100(rec.iso3, sc);
    const tfr = rec.tfr?.value;
    return h(
      "li",
      { class: top ? "top" : "" },
      h(
        "a",
        { class: "rk-row", href: L.countryPath(rec.iso3), "data-nav": "" },
        h("span", { class: "rk-rank" }, rank == null ? "–" : String(rank)),
        h("span", { class: "rk-name" }, h("b", null, rec.name), h("small", null, L.REGION_SHORT[rec.region] ?? rec.region ?? "")),
        h("span", { class: "rk-risk" }, riskChip(rec, { compact: true })),
        h("span", { class: "rk-change" }, bar(pct), h("span", { class: `rk-pct ${pct != null && pct < 0 ? "neg" : "pos"}` }, pct == null ? "–" : L.fmtPct(pct))),
        h("span", { class: "rk-tfr" }, h("b", null, L.fmtTfr(tfr)), h("small", null, "babies per woman")),
      ),
    );
  }

  function render() {
    if (!data.list.length) return;
    const sc = state.scenario;
    setText(el.sub, TABS[tab].sub(sc));
    for (const b of segs) setAttr(b, "aria-pressed", String(b.dataset.s === sc));
    const inRegion = (r) => region === "all" || r.region === region;
    const ranked = data.list.filter((r) => r.ranked === true && Number.isInteger(r.risk?.rank) && inRegion(r));
    const unranked = data.list.filter((r) => !(r.ranked === true && Number.isInteger(r.risk?.rank)) && inRegion(r));
    const list = sorted(ranked);
    el.list.replaceChildren(...list.map((r, i) => row(r, i + 1, i < 3)));
    const small = sorted(unranked);
    el.small.replaceChildren(...small.map((r) => row(r, null, false)));
    el.smallTitle.hidden = small.length === 0;
    setText(el.count, `${list.length} place${list.length === 1 ? "" : "s"}${region === "all" ? "" : ` in ${L.REGION_SHORT[region] ?? region}`}`);
  }

  el.view.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  });

  subscribe((what) => {
    if (el.view.hidden) return;
    if (what === "scenario") render();
  });

  return {
    show() {
      el.view.hidden = false;
      document.body.classList.add("page-rankings");
      if (!built) {
        built = true;
        buildRegions();
      }
      render();
      document.title = L.documentTitle("rankings");
    },
    hide() {
      el.view.hidden = true;
      document.body.classList.remove("page-rankings");
    },
  };
}
