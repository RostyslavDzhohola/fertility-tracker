const REPLACEMENT = 2.1;
const GEN_YEARS = 30;
const GENERATIONS = 5;

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 2) => Number(n).toFixed(d);
const fmtPop = (n) =>
  n >= 1e9 ? `${fmt(n / 1e9, 2)}B` : n >= 1e6 ? `${fmt(n / 1e6, 1)}M` : n >= 1e3 ? `${fmt(n / 1e3, 0)}K` : String(n);
const color = (tfr) => (tfr < 1.5 ? "var(--low)" : tfr < REPLACEMENT ? "var(--mid)" : "var(--ok)");

const data = await fetch("data/fertility.json").then((r) => r.json());
const countries = data.countries;
const byName = new Map(Object.entries(countries).map(([code, c]) => [c.name.toLowerCase(), code]));
const ranked = Object.entries(countries)
  .filter(([code]) => code !== "WLD")
  .sort((a, b) => a[1].tfr.value - b[1].tfr.value);

let current = null;
let whatIf = null;

// ---- picker / URL state ----
$("country-list").innerHTML = Object.values(countries)
  .map((c) => c.name)
  .sort()
  .map((n) => `<option value="${n}"></option>`)
  .join("");

$("country").addEventListener("change", (e) => {
  const code = byName.get(e.target.value.trim().toLowerCase());
  if (code) select(code);
});
$("share").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  $("share").textContent = "Copied";
  setTimeout(() => ($("share").textContent = "Copy link"), 1500);
});
$("tfr-slider").addEventListener("input", (e) => {
  whatIf = +e.target.value;
  renderGenerations();
});
$("tfr-reset").addEventListener("click", () => {
  whatIf = null;
  renderGenerations();
});
$("filter").addEventListener("input", renderRanking);
window.addEventListener("hashchange", () => fromHash() !== current && select(fromHash(), false));

function fromHash() {
  const code = location.hash.slice(1).toUpperCase();
  return countries[code] ? code : "KOR";
}

function select(code, push = true) {
  current = code;
  whatIf = null;
  if (push) history.replaceState(null, "", `#${code}`);
  $("country").value = countries[code].name;
  renderCards();
  renderGenerations();
  renderTrend();
  renderRanking();
}

// ---- stat cards ----
function renderCards() {
  const c = countries[current];
  const t = c.tfr.value;
  const ratio = t / REPLACEMENT;
  const rank = ranked.findIndex(([code]) => code === current) + 1;
  const halving = ratio < 1 ? Math.log(0.5) / Math.log(ratio) : null;
  const proj2050 = c.un.proj.find(([y]) => y === 2050)?.[1];

  const cards = [
    { k: "Births per woman", v: fmt(t), s: `${c.tfr.year} · ${c.tfr.source}`, style: `color:${color(t)}` },
    {
      k: "Each generation vs the last",
      v: `${Math.round(ratio * 100)}%`,
      s: ratio < 1 ? `${Math.round((1 - ratio) * 100)}% smaller each ~${GEN_YEARS} years` : "growing or stable",
    },
    {
      k: "Halves every",
      v: halving ? `${fmt(halving * GEN_YEARS, 0)} yrs` : "—",
      s: halving ? `≈ ${fmt(halving, 1)} generations` : "at or above replacement (2.1)",
    },
    c.population && { k: "Population", v: fmtPop(c.population.value), s: `${c.population.year} · World Bank` },
    rank && { k: "Rank", v: `${rank} / ${ranked.length}`, s: "1 = lowest fertility" },
    proj2050 != null && { k: "UN projection, 2050", v: fmt(proj2050), s: "medium variant" },
  ].filter(Boolean);

  $("cards").innerHTML = cards
    .map((x) => `<div class="card"><div class="k">${x.k}</div><div class="v" style="${x.style ?? ""}">${x.v}</div><div class="s">${x.s}</div></div>`)
    .join("");
}

// ---- 100 people, generation by generation ----
function renderGenerations() {
  const c = countries[current];
  const t = whatIf ?? c.tfr.value;
  const ratio = t / REPLACEMENT;
  $("tfr-slider").value = t;
  $("tfr-out").textContent = fmt(t);
  $("tfr-reset").hidden = whatIf == null;
  $("gen-title").textContent = whatIf == null ? `Start with 100 people in ${c.name}` : `Start with 100 people at ${fmt(t)} births per woman`;
  $("gen-note").textContent =
    ratio < 1
      ? `At ${fmt(t)} births per woman, every 100 people have about ${fmt(ratio * 100, 0)} children between them. Those children have ${fmt(ratio * ratio * 100, 0)} grandchildren, and so on.`
      : `At ${fmt(t)} births per woman, each generation is at least as large as the last.`;

  const startYear = new Date().getFullYear();
  const rows = [];
  for (let g = 0; g <= GENERATIONS; g++) {
    const n = 100 * ratio ** g;
    const shown = Math.min(n, 200);
    const dots = [];
    for (let i = 0; i < Math.max(100, Math.ceil(shown)); i++) {
      const fill = Math.max(0, Math.min(1, shown - i));
      dots.push(fill >= 1 ? "<i></i>" : fill <= 0 ? '<i class="gone"></i>' : `<i class="part" style="--p:${fill * 100}%"></i>`);
    }
    const label = g === 0 ? "Today" : g === 1 ? "Children" : g === 2 ? "Grandchildren" : `Generation ${g}`;
    rows.push(`<div class="gen">
      <div class="label"><b>${label}</b>~${startYear + g * GEN_YEARS}</div>
      <div class="dots">${dots.join("")}</div>
      <div class="count">${n >= 10 ? Math.round(n) : fmt(n, 1)}</div>
    </div>`);
  }
  $("generations").innerHTML = rows.join("");
}

// ---- trend chart (SVG) ----
function renderTrend() {
  const c = countries[current];
  $("trend-title").textContent = `${c.name}: fertility rate, 1950–2100`;
  const W = 900, H = 300, L = 36, R = 12, T = 12, B = 28;
  const est = c.un.est, proj = c.un.proj;
  const all = [...est, ...proj].map((d) => d[1]).concat(c.tfr.value, REPLACEMENT);
  const yMax = Math.ceil(Math.max(...all) + 0.2);
  const x = (yr) => L + ((yr - 1950) / 150) * (W - L - R);
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const path = (pts) => pts.map(([yr, v], i) => `${i ? "L" : "M"}${x(yr).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const grid = [];
  for (let v = 0; v <= yMax; v++) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  for (let yr = 1950; yr <= 2100; yr += 25) grid.push(`<text x="${x(yr)}" y="${H - 8}" text-anchor="middle">${yr}</text>`);
  const now = new Date().getFullYear();

  $("trend").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fertility rate in ${c.name} from 1950 to 2100">
    ${grid.join("")}
    <line x1="${x(now)}" x2="${x(now)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-dasharray="2 4"/>
    <line x1="${L}" x2="${W - R}" y1="${y(REPLACEMENT)}" y2="${y(REPLACEMENT)}" stroke="var(--ok)" stroke-dasharray="6 4" opacity=".7"/>
    <text x="${W - R}" y="${y(REPLACEMENT) - 6}" text-anchor="end" style="fill:var(--ok)">replacement 2.1</text>
    <path d="${path(est)}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <path d="${path(proj)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 5" opacity=".75"/>
    <circle cx="${x(c.tfr.year)}" cy="${y(c.tfr.value)}" r="5" fill="var(--fg)"/>
    <text x="${x(c.tfr.year) + 8}" y="${y(c.tfr.value) - 8}" style="fill:var(--fg)">${fmt(c.tfr.value)} (${c.tfr.year})</text>
  </svg>`;
}

// ---- ranking ----
function renderRanking() {
  const q = $("filter").value.trim().toLowerCase();
  const max = Math.max(...ranked.map(([, c]) => c.tfr.value));
  const below = ranked.filter(([, c]) => c.tfr.value < REPLACEMENT).length;
  $("rank-note").textContent = `${below} of ${ranked.length} countries are below replacement (2.1). World: ${fmt(countries.WLD.tfr.value)}.`;
  $("ranking").innerHTML = ranked
    .map(([code, c], i) => [code, c, i])
    .filter(([, c]) => !q || c.name.toLowerCase().includes(q))
    .map(([code, c, i]) => `<li data-code="${code}" class="${code === current ? "sel" : ""}" style="--rep:${(REPLACEMENT / max) * 100}%">
      <span class="n">${i + 1}</span><span class="name">${c.name}</span>
      <span class="bar"><span style="width:${(c.tfr.value / max) * 100}%;background:${color(c.tfr.value)}"></span></span>
      <span class="val">${fmt(c.tfr.value)}</span></li>`)
    .join("");
}
$("ranking").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (li) {
    select(li.dataset.code);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

// ---- sources ----
const updated = new Date(data.generatedAt).toISOString().slice(0, 10);
$("sources").innerHTML = `Data last changed ${updated} (checked weekly). Sources: <a href="${data.sources.worldBank.url}">${data.sources.worldBank.name}</a>${
  data.sources.worldBank.lastUpdated ? ` (updated ${data.sources.worldBank.lastUpdated})` : ""
}; <a href="${data.sources.un.url}">${data.sources.un.name}</a>.`;

select(fromHash(), false);
