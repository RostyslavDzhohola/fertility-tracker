// Social card renderer (public/og.html → og.png via scripts/og/render-og.mjs): the globe colored by people in 2100
// compared with today (UN forecast), same ramp and outlines as the site, plus the five places shrinking most.

import { h } from "./dom.js";
import { buildLayer } from "./globe.js";
import { changeColor, pctVsToday, todayYear, fmtPct, END_YEAR } from "./logic.js";

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function main() {
  const [countries, scen, topology] = await Promise.all([json("/api/v1/countries.json"), json("/api/v1/scenarios.json"), json("/geo/countries-50m.json")]);
  const records = new Map(countries.countries.map((c) => [c.iso3, c]));
  const today = todayYear(scen);
  const pct = (iso3) => pctVsToday(scen, iso3, END_YEAR, "medium", today);
  const d3 = globalThis.d3;
  const layer = buildLayer(topology, records);

  const canvas = document.getElementById("og-globe");
  const dpr = 1;
  const size = canvas.width;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const r = size / 2 - 8;
  const proj = d3.geoOrthographic().translate([size / 2, size / 2]).scale(r).rotate([-75, -22]).clipAngle(90).precision(0.4);
  const path = d3.geoPath(proj, ctx);
  const g = ctx.createRadialGradient(size / 2 - r * 0.35, size / 2 - r * 0.4, r * 0.05, size / 2, size / 2, r);
  g.addColorStop(0, "#F1F7FB");
  g.addColorStop(0.65, "#DCE9F2");
  g.addColorStop(1, "#C3D7E6");
  ctx.beginPath();
  path({ type: "Sphere" });
  ctx.fillStyle = g;
  ctx.fill();
  if (layer.neutral) {
    ctx.beginPath();
    path(layer.neutral);
    ctx.fillStyle = "#ECE9E3";
    ctx.fill();
  }
  for (const f of layer.feats.values()) {
    ctx.beginPath();
    path(f.feature);
    ctx.fillStyle = (records.has(f.key) && changeColor(pct(f.key))) || "#E7E3DC";
    ctx.fill();
  }
  ctx.beginPath();
  path(layer.borders);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  path(layer.coast);
  ctx.strokeStyle = "rgba(55,80,105,0.32)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.beginPath();
  path({ type: "Sphere" });
  ctx.strokeStyle = "rgba(55,85,115,0.25)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const top = countries.countries
    .filter((c) => c.ranked === true && Number.isInteger(c.risk?.rank) && pct(c.iso3) != null)
    .sort((a, b) => pct(a.iso3) - pct(b.iso3))
    .slice(0, 5);
  document.getElementById("og-rows").replaceChildren(
    ...top.map((c) => {
      const sw = h("span", { class: "sw" });
      sw.style.background = changeColor(pct(c.iso3));
      return h("div", { class: "row" }, sw, h("span", { class: "name" }, c.name), h("span", { class: "pct" }, `${fmtPct(pct(c.iso3))} by 2100`));
    }),
  );
  document.body.dataset.ready = "1";
}

main().catch((err) => {
  console.error(err);
  document.body.dataset.ready = "error";
});
