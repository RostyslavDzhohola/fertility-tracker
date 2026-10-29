// Canvas globe (DESIGN-v3 §2): orthographic by default, Equal Earth as the "Flat" toggle. Drag keeps the grabbed
// point under the pointer (north stays up), inertia on release, wheel / pinch / double-click / button zoom toward the
// pointer from 1× to 16×. 110m outlines while moving, 50m at rest or when zoomed in. Small places get dots.
// Uses the vendored UMD globals d3 (d3-array + d3-geo) and topojson (topojson-client).

const d3 = () => globalThis.d3;
const topo = () => globalThis.topojson;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const K_MIN = 1;
const K_MAX = 16;
const LABEL_K = 2.4; // labels from about 2.5×
const MAX_LAT = 72; // the view center never goes past this latitude: no polar views, no pinning on a pole
const FLY_MAX_K = 7; // fly-to keeps neighbours in view; wheel, pinch and buttons still reach K_MAX
const DOT_AREA = 40; // px²: polygons smaller than this on screen are drawn as dots
const CLICK_SLOP = 5; // px: movement under this is a click
const INERTIA_TAU = 260; // ms
const INERTIA_STOP = 0.02; // px/ms on screen: slower than this, the glide is over
const NAME_FALLBACK = { Kosovo: "XKX", Somaliland: "SOM", "N. Cyprus": "CYP" };
const ID_ALIAS = { "248": "FIN" }; // Åland is part of Finland in the data
const UNINHABITED = new Set(["010", "260", "334", "239", "086"]); // Antarctica, French Southern Lands, Heard, S. Georgia, BIOT

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const now = () => performance.now();

// ------------------------------------------------------------------ geometry prep

// Fast-path geometry: each polygon or line as packed unit vectors (x, y, z), with a bounding cap
// (unit center vector + angular radius) so it can be culled, and projected without d3 when it sits wholly on the
// visible hemisphere. Rings and lines are kept as GeoJSON too, for d3 when they cross the horizon.
function packRing(coords) {
  const a = new Float64Array(coords.length * 3);
  for (let i = 0; i < coords.length; i++) {
    const lon = coords[i][0] * RAD;
    const lat = coords[i][1] * RAD;
    const cl = Math.cos(lat);
    a[i * 3] = cl * Math.cos(lon);
    a[i * 3 + 1] = cl * Math.sin(lon);
    a[i * 3 + 2] = Math.sin(lat);
  }
  return a;
}

function capOf(rings) {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const a of rings)
    for (let i = 0; i < a.length; i += 3) {
      sx += a[i];
      sy += a[i + 1];
      sz += a[i + 2];
      n++;
    }
  const len = Math.hypot(sx, sy, sz);
  if (!n || len / n < 0.2) return { c: [1, 0, 0], radius: Math.PI }; // huge or degenerate: always the slow path
  const c = [sx / len, sy / len, sz / len];
  let minDot = 1;
  for (const a of rings)
    for (let i = 0; i < a.length; i += 3) {
      const d = a[i] * c[0] + a[i + 1] * c[1] + a[i + 2] * c[2];
      if (d < minDot) minDot = d;
    }
  return { c, radius: Math.acos(Math.max(-1, Math.min(1, minDot))) + 1e-4 };
}

function prepPolygons(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polys.map((coords) => {
    const rings = coords.map(packRing);
    return { rings, ...capOf(rings), geo: { type: "Polygon", coordinates: coords } };
  });
}

function prepLines(mls) {
  const lines = mls.type === "LineString" ? [mls.coordinates] : mls.type === "MultiLineString" ? mls.coordinates : [];
  return lines.map((coords) => {
    const arr = packRing(coords);
    return { arr, ...capOf([arr]), geo: { type: "LineString", coordinates: coords } };
  });
}

// Join a world-atlas topology to the data: ISO numeric id, then a name fallback. A generator, so the 50m layer can be
// built in small idle slices without a long main-thread task; buildLayer() runs it to the end in one go.
function* layerSteps(topology, records) {
  const D = d3();
  const T = topo();
  const byNumeric = new Map();
  for (const r of records.values()) if (r.isoNumeric) byNumeric.set(String(r.isoNumeric).padStart(3, "0"), r.iso3);
  const groups = new Map();
  const neutral = [];
  for (const g of topology.objects.countries.geometries) {
    const id = g.id == null ? null : String(g.id).padStart(3, "0");
    if (id && UNINHABITED.has(id)) {
      neutral.push(g);
      continue;
    }
    const key = (id && (byNumeric.get(id) ?? ID_ALIAS[id])) || NAME_FALLBACK[g.properties?.name] || `nodata-${id ?? g.properties?.name}`;
    if (!groups.has(key)) groups.set(key, { geoms: [], name: g.properties?.name ?? key });
    groups.get(key).geoms.push(g);
  }
  const feats = new Map();
  for (const [key, { geoms, name }] of groups) {
    const geometry = geoms.length === 1 ? T.feature(topology, geoms[0]).geometry : T.merge(topology, geoms);
    if (!geometry) continue;
    const feature = { type: "Feature", id: key, properties: { name }, geometry };
    const polys = prepPolygons(geometry);
    let largest = geometry;
    let largestArea = 0;
    if (geometry.type === "MultiPolygon") {
      let best = -1;
      for (const coords of geometry.coordinates) {
        const poly = { type: "Polygon", coordinates: coords };
        const a = D.geoArea(poly);
        if (a > best) {
          best = a;
          largest = poly;
        }
      }
      largestArea = best;
    } else largestArea = D.geoArea(geometry);
    const anchor = D.geoCentroid(largest);
    const center = D.geoCentroid(feature);
    // Angular radius from the polygons' bounding caps (cheap), not from every vertex.
    const c = [Math.cos(center[1] * RAD) * Math.cos(center[0] * RAD), Math.cos(center[1] * RAD) * Math.sin(center[0] * RAD), Math.sin(center[1] * RAD)];
    let radius = 0;
    for (const pg of polys) radius = Math.max(radius, Math.acos(clamp(pg.c[0] * c[0] + pg.c[1] * c[1] + pg.c[2] * c[2], -1, 1)) + pg.radius);
    feats.set(key, { key, name, feature, area: D.geoArea(feature), anchor, center, radius: Math.min(Math.PI, radius), largestArea, polys });
    yield;
  }
  const obj = topology.objects.countries;
  const borders = T.mesh(topology, obj, (a, b) => a !== b);
  yield;
  const coast = T.mesh(topology, obj, (a, b) => a === b);
  yield;
  const borderLines = prepLines(borders);
  const coastLines = prepLines(coast);
  yield;
  const neutralGeom = neutral.length ? T.merge(topology, neutral) : null;
  return {
    feats,
    neutral: neutralGeom ? { type: "Feature", geometry: neutralGeom } : null,
    neutralPolys: neutralGeom ? prepPolygons(neutralGeom) : [],
    borders,
    coast,
    borderLines,
    coastLines,
    topology,
  };
}

export function buildLayer(topology, records) {
  const it = layerSteps(topology, records);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

// Build in idle slices of about `budget` ms, so no single task blocks a frame.
export function buildLayerIdle(topology, records, { budget = 8 } = {}) {
  const it = layerSteps(topology, records);
  const ric = globalThis.requestIdleCallback ?? ((fn) => setTimeout(() => fn({ timeRemaining: () => budget }), 1));
  return new Promise((resolve, reject) => {
    const step = (deadline) => {
      try {
        const t0 = performance.now();
        while (performance.now() - t0 < Math.max(4, Math.min(budget, deadline?.timeRemaining?.() ?? budget))) {
          const r = it.next();
          if (r.done) return resolve(r.value);
        }
        ric(step, { timeout: 200 });
      } catch (err) {
        reject(err);
      }
    };
    ric(step, { timeout: 200 });
  });
}

// ------------------------------------------------------------------ the globe

// One palette per system appearance (style.css has the page's). Country colors come from colorOf and stay the same at
// night, so they keep their meaning; only the sea, borders, outlines and labels change.
const PALETTES = {
  light: {
    halo: "120,160,195",
    haloA: 0.28,
    sea: ["#F1F7FB", "#DCE9F2", "#C3D7E6"],
    flatSea: "#E3EDF4",
    grat: "rgba(70,105,140,0.13)",
    neutral: "#ECE9E3",
    border: "rgba(255,255,255,0.95)",
    coast: "rgba(55,80,105,0.32)",
    hover: "rgba(31,35,40,0.75)",
    dotHover: "#1F2328",
    rim: "rgba(55,85,115,0.22)",
    nodata: ["#F4F1EC", "#CBC4BA"],
    accent: "#2457FF",
    accentRgb: "36,87,255",
    selHalo: "rgba(255,255,255,0.95)",
    labelInk: "#1F2328",
    labelHalo: "rgba(255,255,255,0.92)",
  },
  dark: {
    halo: "70,120,170",
    haloA: 0.22,
    sea: ["#2A4560", "#213A52", "#182D41"],
    flatSea: "#1D344A",
    grat: "rgba(150,185,215,0.10)",
    neutral: "#2A2F35",
    border: "rgba(16,19,22,0.9)",
    coast: "rgba(170,200,225,0.5)",
    hover: "rgba(235,238,242,0.85)",
    dotHover: "#EEF1F4",
    rim: "rgba(140,175,205,0.25)",
    nodata: ["#22272D", "#3A4048"],
    accent: "#6B8FFF",
    accentRgb: "107,143,255",
    selHalo: "rgba(14,17,20,0.9)",
    labelInk: "#EEF1F4",
    labelHalo: "rgba(14,17,20,0.88)",
  },
};
const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");

export function createGlobe(canvas, opts = {}) {
  const D = d3();
  const ctx = canvas.getContext("2d");
  const {
    colorOf = () => null, // iso3 → css color or null (no data)
    labelOf = () => null, // iso3 → { name, line } for zoomed labels
    frame = (W, H) => ({ cx: W / 2, cy: H / 2, r: Math.min(W, H) * 0.42 }),
    occluders = () => [], // [{ left, top, right, bottom }] screen rects labels must avoid
    onHover = () => {},
    onPick = () => {},
    onInteract = () => {},
    onViewChange = () => {},
    reducedMotion = () => false,
  } = opts;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let F = { cx: 0, cy: 0, r: 100 };
  let mode = "globe";
  let rot = [-60, -22]; // [λ, φ]; the initial view faces Europe, Africa and Asia
  let k = 1;
  let pan = [0, 0]; // flat mode offset from the fitted position
  let flatBase = null; // { scale, translate } fitted at k = 1
  let records = new Map();
  let points = {};
  const layers = { 110: null, 50: null };
  const places = new Map(); // iso3 → { iso3, rec, anchor, area, f110, f50, point }
  let selected = null;
  let hover = null;
  let pulseT0 = -1;
  let visible = false; // until the globe page is shown (setVisible)
  let destroyed = false;

  // Motion state
  let drag = null;
  let inertia = null; // { vl, vp } deg/ms (globe) or { vx, vy } px/ms (flat)
  let zoomGoal = null; // { logk, anchor: { ll, x, y } | null, tau }
  let tween = null; // { t0, dur, step(t) }
  let spin = false;
  let spinPaused = false;
  let raf = 0;
  let lastFrame = 0;
  let dirty = true;
  let moving = false;
  let restTimer = 0;

  // Draw cache (Path2D per feature in screen space), rebuilt when the view changes.
  let cache = { sig: "", view: "", paths: new Map(), dots: [], borders: null, coast: null, neutral: null, grat: null, sphere: null, layer: null };
  let lastLabels = [];
  const stats = { draws: 0, total: 0, max: 0, build: 0, slow: [] };
  let hatch = null;
  let pal = darkQuery?.matches ? PALETTES.dark : PALETTES.light;
  // The system switches between day and night: recolor at once (or on the next show, if hidden).
  darkQuery?.addEventListener?.("change", (e) => {
    pal = e.matches ? PALETTES.dark : PALETTES.light;
    hatch = null;
    requestDraw();
  });

  // ---------------------------------------------------------------- data

  function rebuildPlaces() {
    places.clear();
    const l110 = layers[110];
    const l50 = layers[50];
    for (const rec of records.values()) {
      if (rec.iso3 === "WLD") continue;
      const f110 = l110?.feats.get(rec.iso3) ?? null;
      const f50 = l50?.feats.get(rec.iso3) ?? null;
      const pt = points[rec.iso3] ?? null;
      const anchor = f110?.anchor ?? f50?.anchor ?? pt;
      if (!anchor) continue;
      places.set(rec.iso3, { iso3: rec.iso3, rec, anchor, f110, f50, point: pt });
    }
    dirty = true;
    cache.sig = "";
  }

  function setData({ topology110, topology50, layer50, worldPoints, records: recs } = {}) {
    if (recs) records = recs;
    if (worldPoints) points = worldPoints;
    if (topology110) layers[110] = buildLayer(topology110, records);
    if (topology50) layers[50] = buildLayer(topology50, records);
    if (layer50) layers[50] = layer50;
    if (recs && !topology110 && layers[110]?.topology) {
      // Records changed (retry after a failed load): rebuild the joins from the raw topologies.
      layers[110] = buildLayer(layers[110].topology, records);
    }
    rebuildPlaces();
    flatBase = null;
    requestDraw();
  }

  // ---------------------------------------------------------------- projection

  function R() {
    return F.r * k;
  }

  function fitFlat() {
    const fc = { type: "Sphere" };
    const p = D.geoEqualEarth().rotate([-10, 0]);
    const pad = 16;
    p.fitExtent(
      [
        [pad, F.cy - F.r * 1.05],
        [W - pad, F.cy + F.r * 1.05],
      ],
      fc,
    );
    flatBase = { scale: p.scale(), translate: p.translate() };
  }

  function projection({ precision = 0.7 } = {}) {
    let p;
    if (mode === "globe") {
      p = D.geoOrthographic().translate([F.cx, F.cy]).scale(R()).rotate(rot).clipAngle(90).precision(precision);
    } else {
      if (!flatBase) fitFlat();
      const [tx, ty] = flatBase.translate;
      p = D.geoEqualEarth()
        .rotate([-10, 0])
        .scale(flatBase.scale * k)
        .translate([F.cx + (tx - F.cx) * k + pan[0], F.cy + (ty - F.cy) * k + pan[1]])
        .precision(precision);
    }
    return p.clipExtent([
      [-4, -4],
      [W + 4, H + 4],
    ]);
  }

  function viewCenter() {
    return [-rot[0], -rot[1]];
  }

  // Screen point → [lon, lat] on the globe, or null in space.
  function invert(x, y) {
    if (mode === "globe") {
      const r = R();
      const yt = (x - F.cx) / r;
      const zt = (F.cy - y) / r;
      if (yt * yt + zt * zt > 1) return null;
    }
    const ll = projection().invert([x, y]);
    return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? ll : null;
  }

  // The rotation (north up) that puts `ll` at screen (px, py) at radius r. Exact while it is solvable; clamped near the
  // poles. This is what makes the grabbed point stay under the pointer at every zoom.
  function solveRotation(ll, px, py, r, cur = rot) {
    let yt = (px - F.cx) / r;
    let zt = (F.cy - py) / r;
    const rho = Math.hypot(yt, zt);
    if (rho > 0.9995) {
      yt *= 0.9995 / rho;
      zt *= 0.9995 / rho;
    }
    const xt = Math.sqrt(Math.max(0, 1 - yt * yt - zt * zt));
    const lon0 = ll[0] * RAD;
    const lat0 = ll[1] * RAD;
    const cl = Math.cos(lat0);
    const z = Math.sin(lat0);
    if (cl < 1e-6) return cur.slice();
    const s = clamp(yt / cl, -1, 1);
    const a1 = Math.asin(s);
    let best = null;
    for (const a of [a1, Math.PI - a1]) {
      const x = cl * Math.cos(a);
      let phi = Math.atan2(zt, xt) - Math.atan2(z, x);
      phi = Math.atan2(Math.sin(phi), Math.cos(phi));
      const ok = Math.abs(phi) <= Math.PI / 2 + 1e-9;
      const lam = wrap180((a - lon0) * DEG);
      const ph = clamp(phi * DEG, -MAX_LAT, MAX_LAT);
      const cost = Math.abs(wrap180(lam - cur[0])) + Math.abs(ph - cur[1]) + (ok ? 0 : 1000);
      if (!best || cost < best.cost) best = { cost, r: [lam, ph] };
    }
    return best.r;
  }

  // ---------------------------------------------------------------- drawing

  function sizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (w === W && h === H && d === dpr) return false;
    W = w;
    H = h;
    dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    F = frame(W, H);
    flatBase = null;
    cache.sig = "";
    dirty = true;
    return true;
  }

  function hatchPattern() {
    if (hatch) return hatch;
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g = c.getContext("2d");
    g.fillStyle = pal.nodata[0];
    g.fillRect(0, 0, 8, 8);
    g.strokeStyle = pal.nodata[1];
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-2, 10);
    g.lineTo(10, -2);
    g.moveTo(-2, 2);
    g.lineTo(2, -2);
    g.moveTo(6, 10);
    g.lineTo(10, 6);
    g.stroke();
    hatch = ctx.createPattern(c, "repeat");
    return hatch;
  }

  // 110m while moving at low zoom, and at any zoom on touch devices or when 50m frames run slow; 50m at rest.
  let coarseWhileMoving = !!globalThis.matchMedia?.("(pointer: coarse)").matches;
  let slowEma = 0;
  function activeLayer() {
    const hi = layers[50];
    if (!hi) return { layer: layers[110], level: 110 };
    if (moving && (k < 2 || coarseWhileMoving)) return { layer: layers[110], level: 110 };
    return { layer: hi, level: 50 };
  }

  function visibleAngle() {
    // Angular radius of the part of the sphere inside the viewport (plus margin).
    const r = R();
    const half = Math.hypot(Math.max(F.cx, W - F.cx), Math.max(F.cy, H - F.cy));
    return half >= r ? Math.PI / 2 : Math.asin(half / r) + 0.05;
  }

  // Orthographic projection without d3 for shapes wholly on the front hemisphere: two trig calls a point, and points
  // closer than ~0.6 px to the last one are skipped. Shapes crossing the horizon go through d3's clipping.
  function fastProjector(path, visAngle) {
    const lam = rot[0] * RAD;
    const phi = rot[1] * RAD;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const cL = Math.cos(lam);
    const sL = Math.sin(lam);
    const r = R();
    const { cx, cy } = F;
    // View direction as a unit vector in world coordinates (the point at the center of the screen).
    const vlon = -lam;
    const vlat = -phi;
    const v = [Math.cos(vlat) * Math.cos(vlon), Math.cos(vlat) * Math.sin(vlon), Math.sin(vlat)];
    const front = Math.PI / 2 - 0.02;
    const tol = moving ? 1.2 : 0.5; // px: skip points this close to the last one (coarser while moving)
    // When the rim is off screen, points behind the horizon can be pinned to the rim: the error stays off screen.
    const hd = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    const rimOff = r > hd * 1.08;
    function emit(a, target, close, clamp = false) {
      let lx = 1e9;
      let ly = 1e9;
      const n = a.length / 3;
      for (let i = 0; i < n; i++) {
        const x0 = a[i * 3];
        const y0 = a[i * 3 + 1];
        const z = a[i * 3 + 2];
        const x = x0 * cL - y0 * sL;
        const y = x0 * sL + y0 * cL;
        let yy = y;
        let zz = z * cp + x * sp;
        if (clamp && x * cp - z * sp < 0) {
          const len = Math.hypot(yy, zz) || 1;
          yy /= len;
          zz /= len;
        }
        const X = cx + r * yy;
        const Y = cy - r * zz;
        if (i === 0) target.moveTo(X, Y);
        else if (i === n - 1 || Math.abs(X - lx) + Math.abs(Y - ly) > tol) target.lineTo(X, Y);
        else continue;
        lx = X;
        ly = Y;
      }
      if (close) target.closePath();
    }
    // fill: polygons may pin to the rim even when it is on screen (the fill edge then runs along the rim, which is
    // where the true clipped edge is); lines may not, or they would draw strokes along the rim.
    function classify(item, fill = false) {
      const d = Math.acos(Math.max(-1, Math.min(1, item.c[0] * v[0] + item.c[1] * v[1] + item.c[2] * v[2])));
      if (d - item.radius > visAngle) return 0; // off screen or on the back
      if (d + item.radius < front) return 2; // wholly in front: fast
      // 3: fast, pinned to the off-screen rim. Safe while no point comes within ~30° of the far side of the globe, where
      // neighbouring points would land far apart on the rim. 1: d3 clips at the horizon.
      return (rimOff || fill) && d + item.radius < 2.6 ? 3 : 1;
    }
    return {
      polygons(polys, target) {
        let any = false;
        for (const pg of polys) {
          const c = classify(pg, true);
          if (!c) continue;
          any = true;
          if (c === 1) path.context(target)(pg.geo);
          else for (const ring of pg.rings) emit(ring, target, true, c === 3);
        }
        return any;
      },
      lines(lines, target) {
        for (const ln of lines) {
          const c = classify(ln);
          if (!c) continue;
          if (c === 1) path.context(target)(ln.geo);
          else emit(ln.arr, target, false, c === 3);
        }
      },
    };
  }

  // The draw cache as a generator: run to the end for a frame that must change now, or step through it in idle slices
  // when only the detail changes at rest (110m → 50m), so that switch never blocks a frame.
  function rebuildCache(proj, layer, level) {
    const it = cacheSteps(proj, layer, level);
    for (;;) {
      const r = it.next();
      if (r.done) {
        cache = r.value;
        return;
      }
    }
  }

  function* cacheSteps(proj, layer, level) {
    const path = D.geoPath(proj);
    const paths = new Map();
    const center = viewCenter();
    const vis = mode === "globe" ? visibleAngle() : Infinity;
    const r = R();
    const mk = (geo) => {
      if (!geo) return null;
      const p = new Path2D();
      path.context(p)(geo);
      return p;
    };
    let borders;
    let coast;
    let neutral;
    if (mode === "globe") {
      const fp = fastProjector(path, Math.min(Math.PI / 2, vis));
      let n = 0;
      for (const f of layer.feats.values()) {
        if (D.geoDistance(f.center, center) - f.radius > Math.min(Math.PI / 2, vis)) continue;
        const p = new Path2D();
        if (fp.polygons(f.polys, p)) paths.set(f.key, p);
        if (++n % 24 === 0) yield;
      }
      borders = new Path2D();
      fp.lines(layer.borderLines, borders);
      yield;
      // Coastlines cost as much as every fill and matter least in motion: drawn at rest only.
      if (!moving || level === 110) {
        coast = new Path2D();
        fp.lines(layer.coastLines, coast);
        yield;
      } else coast = null;
      neutral = new Path2D();
      fp.polygons(layer.neutralPolys, neutral);
    } else {
      for (const f of layer.feats.values()) {
        const p = new Path2D();
        path.context(p)(f.feature);
        paths.set(f.key, p);
      }
      borders = mk(layer.borders);
      coast = mk(layer.coast);
      neutral = mk(layer.neutral);
    }
    const gstep = k >= 6 ? 5 : k >= 3 ? 10 : 20;
    const dots = [];
    const flatScale = mode === "flat" ? (flatBase?.scale ?? r) * k : r;
    for (const pl of places.values()) {
      const f = level === 50 ? pl.f50 ?? (layers[50] ? null : pl.f110) : pl.f110;
      const areaPx = f ? f.area * flatScale * flatScale : 0;
      if (f && areaPx >= DOT_AREA) continue;
      if (mode === "globe" && D.geoDistance(pl.anchor, center) > Math.PI / 2 - 0.01) continue;
      const xy = proj(pl.anchor);
      if (!xy || xy[0] < -10 || xy[1] < -10 || xy[0] > W + 10 || xy[1] > H + 10) continue;
      dots.push({ iso3: pl.iso3, x: xy[0], y: xy[1] });
    }
    return {
      sig: cache.sig,
      view: viewSignature(),
      paths,
      dots,
      borders,
      coast,
      neutral,
      grat: mk(D.geoGraticule().step([gstep, gstep])()),
      sphere: mk({ type: "Sphere" }),
      layer,
      level,
      path,
    };
  }

  function viewSignature() {
    return [mode, rot[0].toFixed(3), rot[1].toFixed(3), k.toFixed(4), pan[0].toFixed(1), pan[1].toFixed(1), W, H, places.size].join("|");
  }

  // Background build of the detailed frame for the current (resting) view.
  let bg = null; // { sig, it }
  function startBackground(sig, proj, layer, level) {
    if (bg?.sig === sig) return;
    bg = { sig, it: cacheSteps(proj, layer, level) };
    const job = bg;
    const ric = globalThis.requestIdleCallback ?? ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 1));
    const step = () => {
      if (bg !== job) return;
      const t0 = performance.now();
      while (performance.now() - t0 < 7) {
        const r = job.it.next();
        if (r.done) {
          bg = null;
          if (viewSignature() === r.value.view) {
            cache = r.value;
            cache.sig = job.sig;
            requestDraw();
          }
          return;
        }
      }
      ric(step, { timeout: 100 });
    };
    ric(step, { timeout: 100 });
  }

  function signature(level) {
    return [mode, rot[0].toFixed(3), rot[1].toFixed(3), k.toFixed(4), pan[0].toFixed(1), pan[1].toFixed(1), W, H, level, places.size, moving ? 1 : 0].join("|");
  }

  function draw() {
    if (!layers[110] || !W) return;
    const t = now();
    const { layer, level } = activeLayer();
    const proj = projection({ precision: moving ? 0 : 0.6 });
    const sig = signature(level);
    if (sig !== cache.sig) {
      if (mode === "globe" && level === 50 && !moving && cache.layer && cache.view === viewSignature() && cache.level !== 50) {
        // Same view, only more detail wanted: keep this frame and build the detailed one in the background.
        startBackground(sig, proj, layer, level);
      } else {
        bg = null;
        const b0 = performance.now();
        rebuildCache(proj, layer, level);
        stats.build += performance.now() - b0;
        cache.sig = sig;
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const r = R();

    // Ocean.
    if (mode === "globe") {
      const halo = ctx.createRadialGradient(F.cx, F.cy, r * 0.98, F.cx, F.cy, r * 1.09);
      halo.addColorStop(0, `rgba(${pal.halo},${pal.haloA})`);
      halo.addColorStop(1, `rgba(${pal.halo},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(F.cx, F.cy, r * 1.09, 0, 2 * Math.PI);
      ctx.fill();
      const g = ctx.createRadialGradient(F.cx - r * 0.35, F.cy - r * 0.4, r * 0.05, F.cx, F.cy, r);
      g.addColorStop(0, pal.sea[0]);
      g.addColorStop(0.65, pal.sea[1]);
      g.addColorStop(1, pal.sea[2]);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = pal.flatSea;
    }
    ctx.fill(cache.sphere);

    ctx.lineWidth = 0.6;
    ctx.strokeStyle = pal.grat;
    ctx.stroke(cache.grat);

    if (cache.neutral) {
      ctx.fillStyle = pal.neutral;
      ctx.fill(cache.neutral);
    }

    // Countries.
    const nod = hatchPattern();
    for (const [key, p] of cache.paths) {
      const c = key.startsWith("nodata-") ? null : colorOf(key);
      ctx.fillStyle = c ?? nod;
      ctx.fill(p);
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = k >= 4 ? 1.3 : k >= 2 ? 1 : 0.75;
    ctx.stroke(cache.borders);
    if (cache.coast) {
      ctx.strokeStyle = pal.coast;
      ctx.lineWidth = 0.7;
      ctx.stroke(cache.coast);
    }

    // Hover outline.
    const hp = hover && cache.paths.get(hover);
    if (hp) {
      ctx.strokeStyle = pal.hover;
      ctx.lineWidth = 1.6;
      ctx.stroke(hp);
    }

    // Small places as dots.
    const dotR = W < 600 ? 3.4 : 4;
    for (const d of cache.dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.iso3 === hover ? dotR + 1.5 : dotR, 0, 2 * Math.PI);
      ctx.fillStyle = colorOf(d.iso3) ?? nod;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = d.iso3 === hover ? pal.dotHover : pal.border;
      ctx.stroke();
    }

    // Selection: a thick accent outline with a white halo, plus a pulse.
    if (selected) {
      const sp = cache.paths.get(selected);
      const pl = places.get(selected);
      if (sp) {
        ctx.strokeStyle = pal.selHalo;
        ctx.lineWidth = 6;
        ctx.stroke(sp);
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 3;
        ctx.stroke(sp);
      }
      const dot = cache.dots.find((d) => d.iso3 === selected);
      const xy = dot ? [dot.x, dot.y] : pl && isFront(pl.anchor) ? proj(pl.anchor) : null;
      if (dot) {
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotR + 5, 0, 2 * Math.PI);
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (xy && pulseT0 >= 0) {
        const pt = (t - pulseT0) / 1100;
        if (pt < 0) dirty = true;
        else if (pt < 1) {
          const e = easeOut(pt);
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], 10 + 46 * e, 0, 2 * Math.PI);
          ctx.strokeStyle = `rgba(${pal.accentRgb},${0.55 * (1 - pt)})`;
          ctx.lineWidth = 3;
          ctx.stroke();
          dirty = true;
        } else pulseT0 = -1;
      }
    }

    if (mode === "globe") {
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(F.cx, F.cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }

    drawLabels(proj);
  }

  function isFront(ll) {
    return mode !== "globe" || D.geoDistance(ll, viewCenter()) < Math.PI / 2 - 0.02;
  }

  // ---------------------------------------------------------------- labels (zoomed in)

  const widthCache = new Map();
  function textW(font, s) {
    const key = font + "|" + s;
    let w = widthCache.get(key);
    if (w == null) {
      ctx.font = font;
      w = ctx.measureText(s).width;
      if (widthCache.size > 4000) widthCache.clear();
      widthCache.set(key, w);
    }
    return w;
  }

  const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  // Labels grow with zoom: 14 px at 2.4×, about 20 px at 16×.
  function labelSizes() {
    const t = clamp(Math.log(k / LABEL_K) / Math.log(K_MAX / LABEL_K), 0, 1);
    const name = Math.round((14 + 6 * t) * 2) / 2;
    const line = Math.round((12.5 + 5 * t) * 2) / 2;
    return { name, line, nameFont: `700 ${name}px ${FONT_STACK}`, lineFont: `750 ${line}px ${FONT_STACK}` };
  }

  function drawLabels(proj) {
    lastLabels = [];
    if (k < LABEL_K) return;
    const center = viewCenter();
    const r = mode === "globe" ? R() : (flatBase?.scale ?? R()) * k;
    const cands = [];
    for (const pl of places.values()) {
      const f = pl.f110 ?? pl.f50;
      const area = (f?.largestArea ?? 0) * r * r;
      const isSel = pl.iso3 === selected;
      if (!isSel && area < 2200) continue;
      let cosd = 1;
      if (mode === "globe") {
        const d = D.geoDistance(pl.anchor, center);
        if (d > Math.PI / 2 - 0.08) continue;
        cosd = Math.cos(d);
      }
      const xy = proj(pl.anchor);
      if (!xy || xy[0] < 0 || xy[1] < 0 || xy[0] > W || xy[1] > H) continue;
      if (!isSel && area * cosd < 2200) continue;
      cands.push({ pl, xy, score: isSel ? Infinity : area * cosd });
    }
    cands.sort((a, b) => b.score - a.score);
    const blocked = occluders().map((o) => ({ l: o.left - 4, t: o.top - 4, r: o.right + 4, b: o.bottom + 4 }));
    const placed = [];
    const hit = (b) => placed.some((p) => !(b.r < p.l || b.l > p.r || b.b < p.t || b.t > p.b)) || blocked.some((p) => !(b.r < p.l || b.l > p.r || b.b < p.t || b.t > p.b));
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    const fs = labelSizes();
    const NAME_FONT = fs.nameFont;
    const LINE_FONT = fs.lineFont;
    for (const c of cands) {
      if (placed.length >= 60) break;
      const lab = labelOf(c.pl.iso3);
      if (!lab) continue;
      const w = Math.max(textW(NAME_FONT, lab.name), textW(LINE_FONT, lab.line)) + 10;
      const h = fs.name + fs.line + 10;
      const box = { l: c.xy[0] - w / 2, t: c.xy[1] - h / 2, r: c.xy[0] + w / 2, b: c.xy[1] + h / 2 };
      if (box.l < 2 || box.r > W - 2 || box.t < 2 || box.b > H - 2) continue;
      if (hit(box)) continue;
      placed.push(box);
      lastLabels.push({ iso3: c.pl.iso3, name: lab.name, line: lab.line, x: c.xy[0], y: c.xy[1], size: fs.name });
      const y1 = c.xy[1] - 2;
      const y2 = c.xy[1] + fs.line + 1;
      ctx.strokeStyle = pal.labelHalo;
      ctx.lineWidth = 4 + (fs.name - 14) / 3;
      ctx.font = NAME_FONT;
      ctx.strokeText(lab.name, c.xy[0], y1);
      ctx.fillStyle = pal.labelInk;
      ctx.fillText(lab.name, c.xy[0], y1);
      ctx.font = LINE_FONT;
      ctx.strokeText(lab.line, c.xy[0], y2);
      ctx.fillStyle = pal.labelInk;
      ctx.fillText(lab.line, c.xy[0], y2);
    }
  }

  // ---------------------------------------------------------------- frame loop

  function requestDraw() {
    dirty = true;
    loop();
  }

  // No frames at all while the globe page is hidden: setVisible(true) redraws once and resumes.
  function loop() {
    if (raf || destroyed || !visible) return;
    raf = requestAnimationFrame(tick);
  }

  // "At rest" 140 ms after the last moving frame. The timer is not restarted by frames that don't move (Play recolors
  // every frame), so recoloring never keeps the globe in its coarse moving mode.
  function setMoving(on) {
    if (on) {
      clearTimeout(restTimer);
      restTimer = 0;
      moving = true;
    } else if (moving && !restTimer) {
      restTimer = setTimeout(() => {
        restTimer = 0;
        moving = false;
        requestDraw();
      }, 140);
    }
  }

  function tick(t) {
    raf = 0;
    if (!visible) {
      lastFrame = 0;
      return;
    }
    const dt = lastFrame ? Math.min(64, t - lastFrame) : 16;
    lastFrame = t;
    let active = false;
    let viewChanged = false;

    if (tween) {
      const p = clamp((t - tween.t0) / tween.dur, 0, 1);
      tween.step(p);
      viewChanged = true;
      if (p >= 1) {
        const done = tween.done;
        tween = null;
        done?.();
      } else active = true;
    }
    if (zoomGoal) {
      const lk = Math.log(k);
      const f = 1 - Math.exp(-dt / zoomGoal.tau);
      let nk = Math.exp(lk + (zoomGoal.logk - lk) * f);
      if (Math.abs(zoomGoal.logk - Math.log(nk)) < 0.002) nk = Math.exp(zoomGoal.logk);
      applyZoom(nk, zoomGoal.anchor);
      viewChanged = true;
      if (nk === Math.exp(zoomGoal.logk)) zoomGoal = null;
      else active = true;
    }
    if (inertia && !drag) {
      const decay = Math.exp(-dt / INERTIA_TAU);
      if (mode === "globe") {
        const ph = rot[1] + inertia.vp * dt;
        rot = [wrap180(rot[0] + inertia.vl * dt), clamp(ph, -MAX_LAT, MAX_LAT)];
        if (Math.abs(ph) >= MAX_LAT) inertia.vp = 0; // at the clamp: no vertical drift left to decay
        inertia.vl *= decay;
        inertia.vp *= decay;
        if ((Math.abs(inertia.vl) + Math.abs(inertia.vp)) * RAD * R() < INERTIA_STOP) inertia = null;
      } else {
        pan = clampPan([pan[0] + inertia.vx * dt, pan[1] + inertia.vy * dt]);
        inertia.vx *= decay;
        inertia.vy *= decay;
        if (Math.abs(inertia.vx) + Math.abs(inertia.vy) < INERTIA_STOP) inertia = null;
      }
      viewChanged = true;
      if (inertia) active = true;
    }
    if (spin && !drag && !tween && mode === "globe") {
      rot = [wrap180(rot[0] + 0.0045 * dt), rot[1]];
      viewChanged = true;
      active = true;
    }
    const isMoving = active || !!drag;
    if (isMoving) setMoving(true);
    else setMoving(false);
    if (viewChanged) {
      dirty = true;
      // Whatever was under the pointer has moved: drop the hover until the next real pointer move.
      if (hover && !drag) {
        hover = null;
        canvas.style.cursor = "";
        onHover(null);
      }
      onViewChange();
    }
    if (dirty && visible) {
      dirty = false;
      const t0 = performance.now();
      draw();
      const ms = performance.now() - t0;
      stats.draws++;
      stats.total += ms;
      stats.max = Math.max(stats.max, ms);
      if (ms > 25 && stats.slow.length < 20) stats.slow.push({ t: Math.round(t), ms: Math.round(ms), level: cache.level, k: Math.round(k * 10) / 10, moving });
      // A device that can't draw 50m in motion within a frame keeps 110m while moving from then on.
      if (moving && cache.level === 50) {
        slowEma = slowEma ? slowEma * 0.8 + ms * 0.2 : ms;
        if (slowEma > 14) coarseWhileMoving = true;
      }
    }
    if (active || dirty || pulseT0 >= 0) loop();
    else lastFrame = 0;
  }

  // ---------------------------------------------------------------- view changes

  function applyZoom(nk, anchor) {
    nk = clamp(nk, K_MIN, K_MAX);
    if (mode === "globe") {
      k = nk;
      if (anchor) rot = solveRotation(anchor.ll, anchor.x, anchor.y, R());
    } else {
      const ax = anchor ? anchor.x : F.cx;
      const ay = anchor ? anchor.y : F.cy;
      const p = projection();
      const t = p.translate();
      const ratio = nk / k;
      const ntx = ax - (ax - t[0]) * ratio;
      const nty = ay - (ay - t[1]) * ratio;
      k = nk;
      const [bx, by] = flatBase.translate;
      pan = clampPan([ntx - (F.cx + (bx - F.cx) * k), nty - (F.cy + (by - F.cy) * k)]);
    }
  }

  function clampPan(p) {
    if (mode !== "flat" || !flatBase) return p;
    const half = (W / 2) * k;
    const halfH = (H / 2) * k;
    return [clamp(p[0], -half, half), clamp(p[1], -halfH, halfH)];
  }

  function stopMotion() {
    tween = null;
    inertia = null;
    zoomGoal = null;
  }

  function anchorAt(x, y) {
    const ll = invert(x, y);
    return ll ? { ll, x, y } : null;
  }

  function zoomBy(factor, { x = F.cx, y = F.cy, animate = true } = {}) {
    stopIdle();
    const base = zoomGoal ? Math.exp(zoomGoal.logk) : tween?.k1 ?? k;
    const target = clamp(base * factor, K_MIN, K_MAX);
    const anchor = anchorAt(x, y);
    if (!animate || reducedMotion()) {
      zoomGoal = null;
      applyZoom(target, anchor);
      onViewChange();
      requestDraw();
      return;
    }
    tween = null;
    zoomGoal = { logk: Math.log(target), anchor, tau: 90 };
    loop();
  }

  // The place nearest a screen point, among those facing the viewer.
  function nearestPlace(x, y) {
    const proj = projection();
    let best = null;
    let bd = Infinity;
    for (const pl of places.values()) {
      if (!isFront(pl.anchor)) continue;
      const xy = proj(pl.anchor);
      if (!xy) continue;
      const d = Math.hypot(xy[0] - x, xy[1] - y);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    return best;
  }

  // + and −: zoom in toward a place (the selection, else land at the center, else the nearest land), never into
  // empty ocean. Zooming out stays centered.
  function zoomToward(iso3, factor) {
    stopIdle();
    if (factor < 1 || mode !== "globe") return zoomBy(factor);
    let pl = iso3 ? places.get(iso3) : null;
    if (!pl || !isFront(pl.anchor)) {
      pl = null;
      const hit = pick(F.cx, F.cy, { touch: true });
      if (!hit?.rec) pl = nearestPlace(F.cx, F.cy);
    }
    if (!pl) return zoomBy(factor);
    // Quick repeated presses build on the zoom already on its way, not on the zoom mid-animation.
    const k1 = clamp((tween?.k1 ?? k) * factor, K_MIN, K_MAX);
    const c1 = D.geoInterpolate(viewCenter(), pl.anchor)(0.65);
    tween = null;
    zoomGoal = null;
    animateTo({ rot: [wrap180(-c1[0]), clamp(-c1[1], -MAX_LAT, MAX_LAT)], k: k1 }, 420);
  }

  function reset() {
    stopIdle();
    stopMotion();
    const target = { rot: [rot[0], clamp(rot[1], -25, 25) * 0.5], k: 1, pan: [0, 0] };
    animateTo(target, 650);
  }

  function animateTo(target, dur, done) {
    const k0 = k;
    const k1 = target.k ?? k;
    if (reducedMotion() || dur <= 0) {
      if (target.rot) rot = target.rot;
      if (target.pan) pan = target.pan;
      k = k1;
      onViewChange();
      requestDraw();
      done?.();
      return;
    }
    if (mode === "globe") {
      const c0 = viewCenter();
      const c1 = [-target.rot[0], -target.rot[1]];
      const interp = D.geoInterpolate(c0, c1);
      const dist = D.geoDistance(c0, c1);
      const dip = Math.min(Math.log(Math.max(k0, k1)), dist * 1.3);
      tween = {
        t0: now(),
        dur,
        k1,
        step(p) {
          const e = easeInOut(p);
          const c = interp(e);
          rot = [wrap180(-c[0]), clamp(-c[1], -MAX_LAT, MAX_LAT)];
          k = clamp(Math.exp(Math.log(k0) + (Math.log(k1) - Math.log(k0)) * e - dip * Math.sin(Math.PI * e)), K_MIN, K_MAX);
        },
        done,
      };
    } else {
      const p0 = pan.slice();
      const p1 = target.pan ?? pan;
      tween = {
        t0: now(),
        dur,
        step(p) {
          const e = easeInOut(p);
          k = Math.exp(Math.log(k0) + (Math.log(k1) - Math.log(k0)) * e);
          pan = [p0[0] + (p1[0] - p0[0]) * e, p0[1] + (p1[1] - p0[1]) * e];
        },
        done,
      };
    }
    loop();
  }

  // Fly so the place sits at screen (cx + offset.x, cy + offset.y), zoomed so it fills about a third of the view.
  function flyTo(iso3, { offset = { x: 0, y: 0 }, zoom = null } = {}) {
    const pl = places.get(iso3);
    if (!pl) return false;
    stopIdle();
    stopMotion();
    const f = pl.f50 ?? pl.f110;
    const minDim = Math.min(W, H);
    let k1;
    if (zoom != null) k1 = zoom;
    else if (!f) k1 = 7;
    else {
      const ang = Math.max(0.004, Math.min(f.radius, Math.sqrt(f.largestArea / Math.PI) * 1.6));
      const want = minDim * (W < 600 ? 0.2 : 0.14);
      k1 = want / (F.r * Math.sin(Math.min(Math.PI / 2, ang)));
    }
    k1 = clamp(k1, 1, FLY_MAX_K);
    if (mode === "globe") {
      const r1 = F.r * k1;
      const target = solveRotation(pl.anchor, F.cx + offset.x, F.cy + offset.y, r1, [-pl.anchor[0], -pl.anchor[1]]);
      target[1] = clamp(target[1], -60, 60); // north up, never a polar view
      const dist = D.geoDistance(viewCenter(), [-target[0], -target[1]]);
      const dur = 650 + 650 * Math.min(1, dist / Math.PI) + 120 * Math.abs(Math.log(k1 / k));
      animateTo({ rot: target, k: k1 }, dur);
    } else {
      if (!flatBase) fitFlat();
      const base = D.geoEqualEarth().rotate([-10, 0]).scale(flatBase.scale).translate(flatBase.translate);
      const [bx, by] = base(pl.anchor);
      // Screen x = cx + (bx - cx) * k + pan → solve pan for the target point.
      const px = F.cx + offset.x - (F.cx + (bx - F.cx) * k1);
      const py = F.cy + offset.y - (F.cy + (by - F.cy) * k1);
      animateTo({ k: k1, pan: [px, py] }, 900);
    }
    return true;
  }

  function setSelected(iso3, { pulse = true } = {}) {
    selected = iso3;
    if (iso3 && pulse && !reducedMotion()) pulseT0 = now() + 300;
    requestDraw();
  }

  function setMode(m) {
    if (m === mode) return;
    stopMotion();
    mode = m;
    k = 1;
    pan = [0, 0];
    flatBase = null;
    cache.sig = "";
    requestDraw();
    onViewChange();
  }

  // ---------------------------------------------------------------- idle spin

  function startSpin() {
    if (reducedMotion()) return;
    spin = true;
    loop();
  }
  function stopIdle() {
    // A spin paused while the globe is hidden counts too: any interaction stops it for good.
    if (spin || spinPaused) {
      spin = false;
      spinPaused = false;
      onInteract("spin-stop");
    }
  }

  // ---------------------------------------------------------------- picking

  function pick(x, y, { touch = false } = {}) {
    if (cache.sig === "" || !cache.layer) draw();
    const rad = touch ? 18 : 9;
    let best = null;
    let bd = rad;
    for (const d of cache.dots) {
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd < bd) {
        bd = dd;
        best = d.iso3;
      }
    }
    if (best) return { iso3: best, rec: records.get(best) ?? null };
    if (mode === "globe" && !invert(x, y)) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let hitKey = null;
    for (const [key, p] of cache.paths) if (ctx.isPointInPath(p, x * dpr, y * dpr)) hitKey = key;
    if (!hitKey) return null;
    const f = cache.layer.feats.get(hitKey);
    return { iso3: hitKey, rec: records.get(hitKey) ?? null, name: f?.name ?? hitKey };
  }

  // ---------------------------------------------------------------- input

  const pointers = new Map(); // id → { x, y }
  let lastTap = { t: 0, x: 0, y: 0 };

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    // Mouse and touch never show the focus ring; Tab and keys do (data-input drives :focus-visible styling).
    canvas.dataset.input = e.pointerType;
    if (document.activeElement !== canvas) canvas.focus({ preventScroll: true, focusVisible: false });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y });
    stopIdle();
    stopMotion();
    onInteract("pointer");
    if (pointers.size === 1) {
      drag = { id: e.pointerId, type: e.pointerType, x0: x, y0: y, t0: now(), moved: false, ll: invert(x, y), rot0: rot.slice(), pan0: pan.slice(), samples: [] };
    } else if (pointers.size === 2) {
      startPinch();
    }
  });

  function startPinch() {
    const [a, b] = [...pointers.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    drag = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: k, ll: invert(mx, my), mx0: mx, my0: my, pan0: pan.slice(), moved: true, samples: [], t0: now() };
  }

  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (!drag) {
      if (e.pointerType === "mouse") hoverAt(x, y, e);
      return;
    }
    if (drag.pinch) {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const nk = clamp((drag.k0 * d) / drag.d0, K_MIN, K_MAX);
      if (mode === "globe") {
        k = nk;
        if (drag.ll) rot = solveRotation(drag.ll, mx, my, R());
      } else {
        applyZoom(nk, { x: drag.mx0, y: drag.my0 });
        pan = clampPan([pan[0] + (mx - drag.mx0), pan[1] + (my - drag.my0)]);
        drag.mx0 = mx;
        drag.my0 = my;
      }
      onViewChange();
      requestDraw();
      return;
    }
    if (e.pointerId !== drag.id) return;
    const dx = x - drag.x0;
    const dy = y - drag.y0;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < (drag.type === "touch" ? 8 : CLICK_SLOP)) return;
      drag.moved = true;
      canvas.classList.add("dragging");
      setHover(null);
      onHover(null);
    }
    if (mode === "globe") {
      if (drag.ll) rot = solveRotation(drag.ll, x, y, R());
      else {
        const s = DEG / R();
        rot = [wrap180(drag.rot0[0] + dx * s), clamp(drag.rot0[1] - dy * s, -MAX_LAT, MAX_LAT)];
      }
    } else {
      pan = clampPan([drag.pan0[0] + dx, drag.pan0[1] + dy]);
    }
    const t = now();
    drag.samples.push({ t, a: mode === "globe" ? rot[0] : pan[0], b: mode === "globe" ? rot[1] : pan[1] });
    while (drag.samples.length > 2 && t - drag.samples[0].t > 90) drag.samples.shift();
    setMoving(true);
    onViewChange();
    requestDraw();
  });

  function endPointer(e, cancelled) {
    const had = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (!had || !drag) return;
    if (drag.pinch) {
      if (pointers.size === 1) {
        // Continue as a one-finger drag from where the remaining finger is.
        const [[id, p]] = [...pointers.entries()];
        drag = { id, type: "touch", x0: p.x, y0: p.y, t0: now(), moved: true, ll: invert(p.x, p.y), rot0: rot.slice(), pan0: pan.slice(), samples: [] };
      } else drag = null;
      return;
    }
    if (e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    canvas.classList.remove("dragging");
    if (cancelled) return;
    if (d.moved) {
      // Inertia from the last ~90 ms of movement, unless the pointer rested before release.
      const s = d.samples;
      const t = now();
      if (s.length >= 2 && t - s[s.length - 1].t < 60 && !reducedMotion()) {
        const a = s[0];
        const b = s[s.length - 1];
        const dt = Math.max(8, b.t - a.t);
        if (mode === "globe") inertia = { vl: wrap180(b.a - a.a) / dt, vp: (b.b - a.b) / dt };
        else inertia = { vx: (b.a - a.a) / dt, vy: (b.b - a.b) / dt };
        const speed = mode === "globe" ? Math.abs(inertia.vl) + Math.abs(inertia.vp) : (Math.abs(inertia.vx) + Math.abs(inertia.vy)) / 20;
        if (speed < 0.002) inertia = null;
      }
      loop();
      return;
    }
    // A click or tap: select right away; a second one within 300 ms also zooms in (double-tap).
    const [x, y] = local(e);
    const touch = d.type !== "mouse";
    const t = now();
    if (touch && t - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      lastTap = { t: 0, x: 0, y: 0 };
      zoomBy(2, { x, y });
      return;
    }
    lastTap = { t, x, y };
    const hit = pick(x, y, { touch });
    onPick(hit, { x, y, source: "map" });
  }

  canvas.addEventListener("pointerup", (e) => endPointer(e, false));
  canvas.addEventListener("pointercancel", (e) => endPointer(e, true));
  canvas.addEventListener("lostpointercapture", (e) => {
    if (pointers.has(e.pointerId)) endPointer(e, true);
  });
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !drag) {
      setHover(null);
      onHover(null);
    }
  });

  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    zoomBy(e.shiftKey ? 0.5 : 2, { x, y });
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      stopIdle();
      onInteract("wheel");
      tween = null;
      inertia = null;
      const [x, y] = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
      const dy = e.deltaY * unit;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0024));
      const base = zoomGoal ? Math.exp(zoomGoal.logk) : k;
      const target = clamp(base * factor, K_MIN, K_MAX);
      const anchor = zoomGoal?.anchor && Math.hypot(zoomGoal.anchor.x - x, zoomGoal.anchor.y - y) < 2 ? zoomGoal.anchor : anchorAt(x, y);
      zoomGoal = { logk: Math.log(target), anchor, tau: e.ctrlKey ? 40 : 75 };
      loop();
    },
    { passive: false },
  );

  let hoverRaf = 0;
  function hoverAt(x, y, e) {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (drag) return;
      const hit = pick(x, y);
      setHover(hit?.iso3 ?? null);
      onHover(hit, { x, y, clientX: e.clientX, clientY: e.clientY });
    });
  }

  function setHover(iso3) {
    if (hover === iso3) return;
    hover = iso3;
    canvas.style.cursor = iso3 ? "pointer" : "";
    requestDraw();
  }

  // Keyboard use shows the focus ring again.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Tab") canvas.dataset.input = "key";
  }, true);

  canvas.addEventListener("keydown", (e) => {
    canvas.dataset.input = "key";
    const step = 12 / Math.sqrt(k);
    const keys = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (keys[e.key]) {
      e.preventDefault();
      stopIdle();
      onInteract("key");
      const [a, b] = keys[e.key];
      if (mode === "globe") animateTo({ rot: [wrap180(rot[0] + a), clamp(rot[1] + b, -MAX_LAT, MAX_LAT)], k }, 220);
      else animateTo({ k, pan: clampPan([pan[0] + a * 8, pan[1] + b * 8]) }, 220);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomToward(selected, 2);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomBy(0.5);
    } else if (e.key === "0") {
      e.preventDefault();
      reset();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const hit = pick(F.cx, F.cy, { touch: true });
      onPick(hit, { x: F.cx, y: F.cy, source: "keyboard" });
    }
  });

  // ---------------------------------------------------------------- resize, visibility

  const ro = new ResizeObserver(() => {
    if (sizeCanvas()) requestDraw();
  });
  ro.observe(canvas);

  function relayout() {
    const prev = F;
    F = frame(W, H);
    if (prev.cx !== F.cx || prev.cy !== F.cy || prev.r !== F.r) {
      flatBase = null;
      cache.sig = "";
      requestDraw();
    }
  }

  sizeCanvas();

  return {
    setData,
    recolor: () => requestDraw(),
    redraw: () => requestDraw(),
    relayout,
    setSelected,
    flyTo,
    zoomBy,
    zoomToward,
    zoomTo: (target, o) => zoomBy(target / k, o),
    reset,
    setMode,
    startSpin,
    stopSpin: stopIdle,
    pick,
    // Hidden (another page is showing): cancel the pending frame and drop motion in flight (glide, fly-to, wheel zoom),
    // pause the idle spin, and draw nothing. Shown again: one redraw, and the spin resumes if it was on.
    setVisible(v) {
      if (v === visible) return;
      visible = v;
      if (!v) {
        cancelAnimationFrame(raf);
        raf = 0;
        lastFrame = 0;
        stopMotion();
        bg = null;
        spinPaused = spin;
        spin = false;
        drag = null;
        pointers.clear();
        clearTimeout(restTimer);
        restTimer = 0;
        moving = false;
      } else {
        if (spinPaused) spin = true;
        spinPaused = false;
        sizeCanvas();
        requestDraw();
      }
    },
    get scheduled() {
      return raf !== 0;
    },
    // For tests and debugging.
    get dragging() {
      return drag ? { moved: drag.moved, pinch: !!drag.pinch, ll: drag.ll, pointers: pointers.size } : null;
    },
    get ready() {
      return !!layers[110] && places.size > 0 && cache.sig !== "";
    },
    get moving() {
      return moving || !!tween || !!inertia || !!zoomGoal || !!drag;
    },
    get k() {
      return k;
    },
    // Draw-time counters (ms) for performance checks; reset() starts a new sample.
    stats: {
      get draws() {
        return stats.draws;
      },
      get avg() {
        return stats.draws ? stats.total / stats.draws : 0;
      },
      get max() {
        return stats.max;
      },
      get build() {
        return stats.draws ? stats.build / stats.draws : 0;
      },
      get slow() {
        return stats.slow.slice();
      },
      reset() {
        stats.build = 0;
        stats.draws = 0;
        stats.total = 0;
        stats.max = 0;
      },
    },
    get rotation() {
      return rot.slice();
    },
    get mode() {
      return mode;
    },
    get detail() {
      return cache.level ?? 110;
    },
    get spinning() {
      return spin;
    },
    get theme() {
      return pal === PALETTES.dark ? "dark" : "light";
    },
    get labels() {
      return lastLabels.slice();
    },
    get has50() {
      return !!layers[50];
    },
    get frame() {
      return { ...F, W, H };
    },
    screenOf(iso3) {
      const pl = places.get(iso3);
      if (!pl || !isFront(pl.anchor)) return null;
      const xy = projection()(pl.anchor);
      return xy ? { x: xy[0], y: xy[1] } : null;
    },
    lonLatAt: (x, y) => invert(x, y),
    centerPick: () => pick(F.cx, F.cy, { touch: true }),
  };
}
