// Small shared UI pieces.

import { h } from "./dom.js";
import * as L from "./logic.js";

// The risk chip: a 5-step mini meter and the word. `compact` drops the "Risk of shrinking:" prefix (rankings rows).
export function riskChip(rec, { compact = false } = {}) {
  const step = L.riskStep(rec);
  if (rec.iso3 === "WLD") return h("span", { class: "risk-chip none" }, compact ? "Not ranked" : "The world as a whole isn't ranked");
  if (step < 0 || (rec.ranked !== true && L.isSmallPlace(rec)))
    return h("span", { class: "risk-chip none", title: "Too few people for a fair score" }, compact ? "Not ranked" : "Not ranked: too few people for a fair score");
  const segs = L.RISK_LEVELS.map((_, i) => {
    const sgm = h("i", { class: i <= step ? "on" : "" });
    if (i <= step) sgm.style.background = L.RISK_COLORS[i];
    return sgm;
  });
  return h(
    "span",
    { class: `risk-chip${compact ? " compact" : ""}`, "data-step": String(step), title: compact ? `Risk of shrinking: ${L.RISK_LEVELS[step]}` : null },
    h("span", { class: "mini-meter", "aria-hidden": "true" }, ...segs),
    compact ? h("span", { class: "visually-hidden" }, "Risk of shrinking: ") : "Risk of shrinking: ",
    h("b", null, L.RISK_LEVELS[step]),
  );
}
