// Small shared UI pieces.

import { h, announce, copyText } from "./dom.js";
import * as L from "./logic.js";
import { outlookPct, state } from "./store.js";

// The outlook chip: where a place is headed by 2100 under the selected scenario, compared with today, on the same
// five-word, five-color scale as the globe legend. `compact` drops the "By 2100:" prefix (rankings rows, search).
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

// "Email us" that always does something. A mailto: link does nothing when the computer has no mail program set up, so
// the button opens a choice: Gmail or Outlook (a ready message in a new tab), the mail app, or copy the address.
// Returns the button and the panel it opens, for the caller to place.
export function emailChooser(feedback, ctx, { prefix = "email" } = {}) {
  const m = L.buildEmailLinks(feedback, ctx);
  const toggle = h("button", { type: "button", class: "btn btn-secondary", id: `${prefix}-btn`, "aria-expanded": "false", "aria-controls": `${prefix}-choices` }, "Email us");
  const copyBtn = h("button", { type: "button", class: "btn btn-secondary btn-small", id: `${prefix}-copy` }, "Copy");
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(m.address);
    copyBtn.textContent = ok ? "Copied" : "Copy failed";
    announce(ok ? "Email address copied" : "Couldn't copy");
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  });
  const app = (label, href, ext) => h("a", { class: "btn btn-secondary", href, ...(ext ? { target: "_blank", rel: "noopener" } : {}), "data-mail": label.toLowerCase().replace(/\s+/g, "-") }, label);
  const panel = h(
    "div",
    { class: "email-choices", id: `${prefix}-choices`, hidden: true },
    h("p", { class: "email-label" }, "Send with"),
    h("div", { class: "email-apps" }, app("Gmail", m.gmail, true), app("Outlook", m.outlook, true), app("Mail app", m.mailto, false)),
    h("p", { class: "fb-address" }, h("span", { class: "email-text" }, m.address), copyBtn),
  );
  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) panel.querySelector("a")?.focus({ preventScroll: true });
  });
  return { toggle, panel };
}
