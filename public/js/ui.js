// Small shared UI pieces.

import { h } from "./dom.js";
import * as L from "./logic.js";
import { outlookPct, state } from "./store.js";

// The outlook chip: where a place is headed by 2100 under the selected scenario, compared with today, on the same
// four-word, four-color scale as the globe legend. `compact` drops the "By 2100:" prefix (rankings rows, search).
export function outlookChip(rec, { compact = false, pct = outlookPct(rec.iso3) } = {}) {
  if (rec.iso3 !== "WLD" && L.isSmallPlace(rec))
    return h("span", { class: "risk-chip none", title: "Under 100,000 people: a few births or deaths swing the numbers a lot" }, "Very small population");
  const step = L.outlookStep(pct);
  if (step < 0) return h("span", { class: "risk-chip none" }, "No forecast");
  const segs = L.OUTLOOK.map((o, i) => {
    const sgm = h("i", { class: i === step ? "on" : "" });
    sgm.style.background = L.outlookColor(i);
    return sgm;
  });
  const scen = state.scenario === "constant" ? " if birth rates stay the same" : "";
  return h(
    "span",
    { class: `risk-chip${compact ? " compact" : ""}`, "data-step": String(step), title: `By 2100${scen}: ${L.OUTLOOK[step].label} (${L.fmtPct(pct)} vs today)` },
    h("span", { class: "mini-meter", "aria-hidden": "true" }, ...segs),
    compact ? h("span", { class: "visually-hidden" }, "By 2100: ") : "By 2100: ",
    h("b", null, L.OUTLOOK[step].label),
  );
}

// "Email us": a plain mail link. It opens the mail app with the address, subject and page filled in.
export function emailLink(feedback, ctx, { id = "email-btn" } = {}) {
  return h("a", { class: "btn btn-secondary", id, href: L.buildMailto(feedback, ctx) }, "Email us");
}
