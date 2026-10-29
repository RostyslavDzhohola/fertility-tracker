// Link-preview cards (public/og-cards.html → public/og/<ISO3>.jpg via scripts/og/render-cards.mjs). X and other sites
// don't run JavaScript, so each place's page names its own picture: the same picture as Share, at the card size X
// shows (1200×630), with the globe turned to the place and the numbers for 2100 (UN forecast).

import * as L from "./logic.js";
import { buildLayer } from "./globe.js";
import { drawSnapshot, globeVisual, SNAP_W, SNAP_H } from "./snapshot.js";

export const CARD_W = 1200;
export const CARD_H = 630;
const GLOBE = 900; // the picture's left half, square

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

let ready = null;
function load() {
  ready ??= (async () => {
    const [countries, scen, topology, points] = await Promise.all([json("/api/v1/countries.json"), json("/api/v1/scenarios.json"), json("/geo/countries-50m.json"), json("/geo/world-points.json")]);
    const records = new Map(countries.countries.map((c) => [c.iso3, c]));
    const layer = buildLayer(topology, records);
    return { records, scen, layer, points, today: L.todayYear(scen), site: L.SITE_URL };
  })();
  return ready;
}

// The globe, turned so the place faces you, colored by 2100 vs today, the place outlined (and ringed when small).
function drawGlobe(d, iso3) {
  const D = globalThis.d3;
  const c = document.createElement("canvas");
  c.width = c.height = GLOBE;
  const g = c.getContext("2d");
  const r = GLOBE * 0.45;
  const feat = d.layer.feats.get(iso3);
  const pt = d.points[iso3];
  const at = iso3 === "WLD" ? [20, 15] : feat?.anchor ?? pt ?? [20, 15];
  const proj = D.geoOrthographic()
    .translate([GLOBE / 2, GLOBE / 2])
    .scale(r)
    .rotate([-at[0], -Math.max(-60, Math.min(60, at[1]))])
    .clipAngle(90)
    .precision(0.3);
  const path = D.geoPath(proj, g);
  const pct = (k) => L.pctVsToday(d.scen, k, L.END_YEAR, "medium", d.today);

  const sea = g.createRadialGradient(GLOBE / 2 - r * 0.35, GLOBE / 2 - r * 0.4, r * 0.05, GLOBE / 2, GLOBE / 2, r);
  sea.addColorStop(0, "#F1F7FB");
  sea.addColorStop(0.65, "#DCE9F2");
  sea.addColorStop(1, "#C3D7E6");
  g.beginPath();
  path({ type: "Sphere" });
  g.fillStyle = sea;
  g.fill();
  if (d.layer.neutral) {
    g.beginPath();
    path(d.layer.neutral);
    g.fillStyle = "#ECE9E3";
    g.fill();
  }
  for (const f of d.layer.feats.values()) {
    g.beginPath();
    path(f.feature);
    g.fillStyle = (d.records.has(f.key) && L.changeColor(pct(f.key))) || L.NODATA_COLOR;
    g.fill();
  }
  g.lineJoin = "round";
  g.beginPath();
  path(d.layer.borders);
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 1;
  g.stroke();
  g.beginPath();
  path(d.layer.coast);
  g.strokeStyle = "rgba(55,80,105,0.32)";
  g.lineWidth = 0.8;
  g.stroke();
  // Small places as dots, like the globe on the site.
  for (const [k, ll] of Object.entries(d.points)) {
    if (d.layer.feats.has(k) || !d.records.has(k)) continue;
    const xy = proj(ll);
    if (!xy || D.geoDistance(ll, [-proj.rotate()[0], -proj.rotate()[1]]) > Math.PI / 2) continue;
    g.beginPath();
    g.arc(xy[0], xy[1], 5, 0, 2 * Math.PI);
    g.fillStyle = L.changeColor(pct(k)) ?? L.NODATA_COLOR;
    g.fill();
    g.lineWidth = 1.4;
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.stroke();
  }
  if (iso3 !== "WLD") {
    if (feat) {
      g.beginPath();
      path(feat.feature);
      g.strokeStyle = "rgba(255,255,255,0.95)";
      g.lineWidth = 7;
      g.stroke();
      g.strokeStyle = "#2457FF";
      g.lineWidth = 3.5;
      g.stroke();
    }
    // Small on the globe (or only a dot): a ring so it's easy to find.
    const xy = proj(at);
    const px = feat ? Math.sqrt(feat.largestArea) * r : 0;
    if (xy && px < 40) {
      g.beginPath();
      g.arc(xy[0], xy[1], 22, 0, 2 * Math.PI);
      g.strokeStyle = "#2457FF";
      g.lineWidth = 4;
      g.stroke();
    }
  }
  g.beginPath();
  path({ type: "Sphere" });
  g.strokeStyle = "rgba(55,85,115,0.25)";
  g.lineWidth = 1.5;
  g.stroke();
  return c;
}

// One card as a JPEG data URL (a PNG of the detailed globe is about 500 KB; this is a fifth), or null without a forecast.
export async function renderCard(iso3) {
  const d = await load();
  const rec = d.records.get(iso3);
  if (!rec) return null;
  const year = L.END_YEAR;
  const pop = L.popAt(d.scen, iso3, year, "medium");
  if (pop == null) return null;
  const pct = L.pctVsToday(d.scen, iso3, year, "medium", d.today);
  const globe = drawGlobe(d, iso3);
  const m = {
    rec,
    year,
    today: d.today,
    scenario: "medium",
    pop,
    pct,
    ratio: L.ratioVsToday(d.scen, iso3, year, "medium", d.today),
    outlookPct: pct,
    url: L.pageUrl(iso3 === "WLD" ? null : iso3, d.site),
    // The card crop takes 30 px off the bottom: lift the legend clear of it.
    visual: globeVisual(globe, { x: 0, y: 0, w: GLOBE, h: GLOBE }, { legendInset: 58 }),
  };
  const big = await drawSnapshot(m);
  // 16:9 → X's 1.91:1: drop 30 px top and bottom (margins only), then scale to 1200×630.
  const out = document.createElement("canvas");
  out.width = CARD_W;
  out.height = CARD_H;
  const g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  const cropH = Math.round((SNAP_W * CARD_H) / CARD_W);
  g.drawImage(big, 0, Math.round((SNAP_H - cropH) / 2), SNAP_W, cropH, 0, 0, CARD_W, CARD_H);
  return out.toDataURL("image/jpeg", 0.88);
}

// Every place that gets a card: all records with a forecast, the world first.
export async function cardPlaces() {
  const d = await load();
  return ["WLD", ...[...d.records.keys()].filter((k) => k !== "WLD").sort()].filter((k) => L.popAt(d.scen, k, L.END_YEAR, "medium") != null);
}

window.FTCards = { renderCard, cardPlaces, ready: () => load().then(() => true) };
