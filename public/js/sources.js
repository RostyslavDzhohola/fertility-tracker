// Where a number comes from. sourced() wraps a number in a button; pressing it opens a small card that says what the
// number counts, its year, whether it was measured or forecast, and links to the publisher's own file and to the same
// number in our API. One card at a time; Escape, a click outside or the close button shuts it.

import { h, s, focusNoScroll } from "./dom.js";

const WPP_CSV = "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/";
const DESA_FILES = "https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/";

// The publishers. `file` is the exact file our numbers are read from (or checked against).
export const SRC = {
  wpp: {
    name: "UN World Population Prospects 2024",
    publisher: "UN Population Division",
    home: "https://population.un.org/wpp/",
    file: `${WPP_CSV}WPP2024_Demographic_Indicators_Medium.csv.gz`,
    fileLabel: "UN data file (CSV)",
    method: "https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf",
  },
  wppScenarios: {
    name: "UN World Population Prospects 2024",
    publisher: "UN Population Division",
    home: "https://population.un.org/wpp/",
    file: `${WPP_CSV}WPP2024_TotalPopulationBySex.csv.gz`,
    fileLabel: "UN data file (CSV)",
    method: "https://population.un.org/wpp/definition-of-projection-scenarios",
  },
  desa: {
    name: "UN DESA International Migrant Stock 2024",
    publisher: "UN Population Division",
    home: "https://www.un.org/development/desa/pd/content/international-migrant-stock",
    file: `${DESA_FILES}undesa_pd_2024_ims_stock_by_sex_and_destination.xlsx`,
    fileLabel: "UN table (Excel)",
  },
  desaOrigin: {
    name: "UN DESA International Migrant Stock 2024",
    publisher: "UN Population Division",
    home: "https://www.un.org/development/desa/pd/content/international-migrant-stock",
    file: `${DESA_FILES}undesa_pd_2024_ims_stock_by_sex_and_origin.xlsx`,
    fileLabel: "UN table (Excel)",
  },
  desaCorridors: {
    name: "UN DESA International Migrant Stock 2024",
    publisher: "UN Population Division",
    home: "https://www.un.org/development/desa/pd/content/international-migrant-stock",
    file: `${DESA_FILES}undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx`,
    fileLabel: "UN table by country of birth (Excel)",
  },
  wb: {
    name: "World Bank, World Development Indicators",
    publisher: "World Bank",
    home: "https://data.worldbank.org/",
  },
};

// World Bank indicator codes for the headline fields that can come from it.
export const WB_INDICATORS = {
  population: "SP.POP.TOTL",
  tfr: "SP.DYN.TFRT.IN",
  birthRate: "SP.DYN.CBRT.IN",
  deathRate: "SP.DYN.CDRT.IN",
  netMigration: "SM.POP.NETM",
  populationGrowthPct: "SP.POP.GROW",
  share65: "SP.POP.65UP.TO.ZS",
};

export function wbIndicatorUrl(code, iso2) {
  return `https://data.worldbank.org/indicator/${code}${iso2 ? `?locations=${iso2}` : ""}`;
}

const infoIcon = () =>
  s(
    "svg",
    { class: "src-i", viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": "true", focusable: "false" },
    s("circle", { cx: 8, cy: 8, r: 6.6, fill: "none", stroke: "currentColor", "stroke-width": 1.6 }),
    s("path", { d: "M8 7.2v4", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round" }),
    s("circle", { cx: 8, cy: 4.8, r: 1.05, fill: "currentColor" }),
  );

// info: { title, rows: [[label, text]], src: SRC.*, links: [{ label, href, nav? }], api: { href, field }, note,
//         check: { text, links } (what other primary sources say; crosscheck.js) }
// content: text or nodes shown in the button. Returns the button.
export function sourced(content, info, { cls = "" } = {}) {
  const b = h("button", { type: "button", class: `src${cls ? ` ${cls}` : ""}`, "aria-haspopup": "dialog", "aria-expanded": "false" });
  b.append(...(Array.isArray(content) ? content : [content]));
  b.append(infoIcon());
  b.append(h("span", { class: "visually-hidden" }, " (where this number comes from)"));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (open?.button === b) close();
    else show(b, info);
  });
  return b;
}

let pop = null;
let open = null; // { button }
let onNav = null;

// Same-site page links inside the card (a partner country's page) go through the app's router.
export function setSourceNavigate(fn) {
  onNav = fn;
}

function ensure() {
  if (pop) return pop;
  pop = h("div", { class: "src-pop", id: "src-pop", role: "dialog", "aria-modal": "false", "aria-labelledby": "src-pop-title", hidden: true });
  document.body.append(pop);
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close({ focus: true });
    }
  });
  pop.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || !onNav || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    close();
    onNav(a.getAttribute("href"));
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!open || pop.contains(e.target) || open.button.contains(e.target)) return;
      close();
    },
    true,
  );
  window.addEventListener("resize", () => open && place(open.button));
  return pop;
}

function show(button, info) {
  ensure();
  if (open) open.button.setAttribute("aria-expanded", "false");
  const ext = (label, href) => h("a", { href, target: "_blank", rel: "noopener" }, label, h("span", { "aria-hidden": "true" }, " ↗"));
  const src = info.src;
  const links = [
    ...(src?.file ? [ext(src.fileLabel ?? "Source file", src.file)] : []),
    ...(info.links ?? []).map((l) => (l.nav ? h("a", { href: l.href, "data-nav": "" }, l.label) : ext(l.label, l.href))),
    ...(info.api ? [ext("This number in our data", info.api.href)] : []),
  ];
  pop.replaceChildren(
    h(
      "div",
      { class: "src-head" },
      h("p", { class: "src-title", id: "src-pop-title", tabindex: "-1" }, info.title),
      h("button", { type: "button", class: "icon-btn src-close", "aria-label": "Close" }, h("span", { "aria-hidden": "true" }, "✕")),
    ),
    info.rows?.length ? h("dl", { class: "src-rows" }, ...info.rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])) : "",
    info.note ? h("p", { class: "src-note" }, info.note) : "",
    info.check ? checkNote(info.check) : "",
    src ? h("p", { class: "src-from" }, "Source: ", ext(src.name, src.home), src.method ? [" · ", ext("how it's made", src.method)] : "") : "",
    links.length ? h("p", { class: "src-links" }, ...links) : "",
    info.api?.field ? h("p", { class: "src-field" }, "Field: ", h("code", null, info.api.field)) : "",
  );
  pop.querySelector(".src-close").addEventListener("click", () => close({ focus: true }));
  pop.hidden = false;
  open = { button };
  button.setAttribute("aria-expanded", "true");
  place(button);
  focusNoScroll(pop.querySelector(".src-title"));
}

function place(button) {
  const r = button.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  // Phones: a sheet along the bottom. Wider screens: under (or above) the number.
  if (vw < 560) {
    pop.classList.add("sheet");
    pop.style.left = pop.style.top = "";
    return;
  }
  pop.classList.remove("sheet");
  const w = pop.offsetWidth;
  const ht = pop.offsetHeight;
  const left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + ht <= vh - 8 || r.top - 8 - ht < 8;
  const top = below ? r.bottom + 8 : r.top - 8 - ht;
  pop.style.left = `${Math.round(left + window.scrollX)}px`;
  pop.style.top = `${Math.round(top + window.scrollY)}px`;
}

// "Other sources: …" with its links: a newer or independent count next to the UN's.
export function checkNote(check, { cls = "src-check" } = {}) {
  return h(
    "div",
    { class: cls },
    h("p", null, h("b", null, "Other sources: "), check.text),
    check.links?.length ? h("p", { class: "src-links" }, ...check.links.map((l) => h("a", { href: l.href, target: "_blank", rel: "noopener" }, l.label, h("span", { "aria-hidden": "true" }, " ↗")))) : "",
  );
}

export function closeSource() {
  close();
}

function close({ focus = false } = {}) {
  if (!open) return;
  const b = open.button;
  open = null;
  pop.hidden = true;
  b.setAttribute("aria-expanded", "false");
  if (focus && b.isConnected) focusNoScroll(b);
}
