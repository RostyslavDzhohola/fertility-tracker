// Social card renderer (public/og.html → og.png via scripts/og/render-og.mjs). Same map renderer and palette as the site.

import { h } from "./dom.js";
import { drawStaticMap } from "./map.js";
import { TIER_COLORS, fmtTfr, tfrValue } from "./logic.js";

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function main() {
  const [countries, topology, points] = await Promise.all([json("api/v1/countries.json"), json("geo/countries-110m.json"), json("geo/world-points.json")]);
  const records = new Map(countries.countries.map((c) => [c.iso3, c]));
  drawStaticMap(document.getElementById("og-map"), topology, points, records, 700, "risk");
  const top = countries.countries
    .filter((c) => Number.isInteger(c.risk?.rank))
    .sort((a, b) => a.risk.rank - b.risk.rank)
    .slice(0, 5);
  document.getElementById("og-rows").replaceChildren(
    ...top.map((c) => {
      const sw = h("span", { class: "sw" });
      sw.style.background = TIER_COLORS[c.risk.tier] ?? "#1A1F2A";
      return h(
        "div",
        { class: "row" },
        h("span", { class: "rank" }, String(c.risk.rank)),
        sw,
        h("span", { class: "name" }, c.name),
        h("span", { class: "tfr" }, fmtTfr(tfrValue(c))),
      );
    }),
  );
  document.body.dataset.ready = "1";
}

main().catch((err) => {
  console.error(err);
  document.body.dataset.ready = "error";
});
