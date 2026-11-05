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
  // How sure each number is (countries/{ISO3}.json confidence).
  wppDataSources: {
    name: "World Population Prospects 2024: Data Sources",
    publisher: "UN Population Division",
    home: "https://population.un.org/wpp/",
    file: "https://population.un.org/wpp/assets/Files/WPP2024_Data_Sources.pdf",
    fileLabel: "What the UN used, country by country (PDF)",
  },
  unsd: {
    name: "UN Statistics Division, Population and Vital Statistics Report",
    publisher: "UN Statistics Division",
    home: "https://unstats.un.org/unsd/demographic-social/products/vitstats/",
    file: "https://unstats.un.org/unsd/demographic-social/products/vitstats/seratab3.pdf",
    fileLabel: "Births and deaths each country reported (PDF)",
  },
  wppRange: {
    name: "UN World Population Prospects 2024: probabilistic projections",
    publisher: "UN Population Division",
    home: "https://population.un.org/wpp/",
    file: `${WPP_CSV}WPP2024_TotalPopulationBySex.csv.gz`,
    fileLabel: "UN data file (CSV: Lower/Upper 80 and 95 PI, Zero migration)",
    method: "https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf",
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
//         quote: { text, label, href } (the publisher's own words),
//         check: { text, links } (what other primary sources say; crossChecks) }, or a function returning it (read
//         when the card opens, for a number that changes with the slider).
// content: text or nodes shown in the button. key: names the number across redraws ("flow-births"): when Play redraws
// it, an open card moves to the new button and shows its numbers. Returns the button.
export function sourced(content, info, { cls = "", key = null } = {}) {
  const b = h("button", { type: "button", class: `src${cls ? ` ${cls}` : ""}`, "aria-haspopup": "dialog", "aria-expanded": "false", "data-src-key": key });
  b.srcInfo = info;
  b.append(...(Array.isArray(content) ? content : [content]));
  b.append(infoIcon());
  b.append(h("span", { class: "visually-hidden" }, " (where this number comes from)"));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (open?.button === b) close();
    else show(b);
  });
  return b;
}

let pop = null;
let open = null; // { button }
let onNav = null;
let watcher = null; // while a card is open: notices its button being redrawn

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
  window.addEventListener("resize", () => open && place(open.button, { scroll: false }));
  return pop;
}

function show(button, { focus = true, scroll = true } = {}) {
  ensure();
  const info = typeof button.srcInfo === "function" ? button.srcInfo() : button.srcInfo;
  if (!info) return;
  if (open) open.button.setAttribute("aria-expanded", "false");
  const ext = (label, href) => h("a", { href, target: "_blank", rel: "noopener" }, label, h("span", { "aria-hidden": "true" }, "\u00a0↗"));
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
    info.quote?.text
      ? h(
          "details",
          { class: "src-quote" },
          h("summary", null, "The UN's own words"),
          h("blockquote", null, h("p", null, `“${info.quote.text}”`), info.quote.label ? h("footer", null, "— ", info.quote.href ? ext(info.quote.label, info.quote.href) : info.quote.label) : ""),
        )
      : "",
    info.check ? checkNote(info.check) : "",
    src ? h("p", { class: "src-from" }, "Source: ", ext(src.name, src.home), src.method ? [" · ", ext("how it's made", src.method)] : "") : "",
    links.length ? h("p", { class: "src-links" }, ...links) : "",
    info.api?.field ? h("p", { class: "src-field" }, "Field: ", h("code", null, info.api.field)) : "",
  );
  pop.querySelector(".src-close").addEventListener("click", () => close({ focus: true }));
  pop.hidden = false;
  open = { button };
  button.setAttribute("aria-expanded", "true");
  place(button, { scroll });
  if (focus) focusNoScroll(pop.querySelector(".src-title"));
  watch();
}

// Play and the slider redraw some numbers (births, deaths, immigration for the year). When the open card's button is
// replaced, the card follows the new one with the same key and its new numbers; when it is gone for good, the card
// closes. Focus that was in the card stays in it, or goes to the page's title.
function watch() {
  if (watcher || typeof MutationObserver !== "function") return;
  watcher = new MutationObserver(() => {
    if (!open || open.button.isConnected) return;
    const key = open.button.dataset.srcKey;
    const next = key ? [...document.querySelectorAll(".src[data-src-key]")].find((b) => b.dataset.srcKey === key && b.getClientRects().length) : null;
    const hadFocus = pop.contains(document.activeElement);
    if (next) show(next, { focus: hadFocus, scroll: false });
    else {
      close();
      if (hadFocus) focusNoScroll([...document.querySelectorAll("main h1")].find((x) => x.getClientRects().length));
    }
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}

// The bottom of whatever sticks to the top of the window (the top bar, and the country page's year controls once
// they stick under it).
function stuckBottom() {
  let b = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const cv = document.getElementById("cv-controls");
  if (cv && cv.getClientRects().length) {
    const cr = cv.getBoundingClientRect();
    if (cr.top <= b + 24) b = Math.max(b, cr.bottom);
  }
  return Math.max(0, b);
}

function place(button, { scroll = true } = {}) {
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
  pop.style.maxHeight = "";
  const w = pop.offsetWidth;
  const ht = pop.offsetHeight;
  const left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2));
  // Below the number, or above it, on the side with room; never under the sticky bars or past the bottom. With room
  // on neither side, the page scrolls the number up (staying in view) so the card opens below it; a card taller than
  // the screen scrolls inside.
  let roomBelow = vh - 12 - (r.bottom + 8);
  const roomAbove = r.top - 8 - (stuckBottom() + 8);
  if (scroll && ht > roomBelow && ht > roomAbove) {
    const by = Math.min(ht - roomBelow, r.top - stuckBottom() - 16);
    if (by > 0) {
      window.scrollBy({ top: by, behavior: "instant" });
      return place(button, { scroll: false });
    }
  }
  const below = ht <= roomBelow || roomBelow >= roomAbove;
  roomBelow = Math.max(roomBelow, 0);
  const room = Math.max(160, below ? roomBelow : roomAbove);
  if (ht > room) pop.style.maxHeight = `${Math.floor(room)}px`;
  const h2 = Math.min(ht, room);
  const top = below ? r.bottom + 8 : r.top - 8 - h2;
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

// The slider moved: an open card for a number that follows it (info given as a function) shows the new year.
export function refreshSource() {
  if (open?.button.isConnected && typeof open.button.srcInfo === "function") {
    const hadFocus = pop.contains(document.activeElement);
    show(open.button, { focus: hadFocus, scroll: false });
  }
}

export function closeSource() {
  close();
}

function close({ focus = false } = {}) {
  if (!open) return;
  const b = open.button;
  open = null;
  watcher?.disconnect();
  watcher = null;
  pop.hidden = true;
  b.setAttribute("aria-expanded", "false");
  if (focus && b.isConnected) focusNoScroll(b);
}
