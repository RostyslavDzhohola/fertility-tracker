# Fertility Tracker v2: design spec

For: the frontend agent (builds it), the backend agent (§11 lists the fields the UI reads), the reviewer (§12 is the
acceptance checklist). Intent comes from `docs/brief/BRIEF.md`. If this spec and the brief disagree, the brief wins and
the orchestrator decides.

Every number marked *measured* below came from the vendored-candidate files or a script run while writing this spec
(world-atlas 2.0.2, v1 `public/data/fertility.json`, OKLab + Machado-2009 color-vision simulation).

---

## 0. Decisions at a glance

1. **Dark theme**, background `#0B0E14`. On a dark map the bright, high-risk countries stand out, and the screenshots
   look good on X, where most heavy users browse in dark mode. System font stack only; no font file.
2. **The map is the hero.** It uses the Equal Earth flat projection by default, plus a Globe toggle (orthographic, drag to
   rotate, turns to face the selected country). Countries are colored by **decline-risk tier** by default, with
   **births per woman** as the alternate mode.
3. **The country view is inline, never in a modal or bottom sheet.** On desktop (≥1100px) it is a 460px column beside a
   **sticky** map column. On mobile and tablet it is a section directly under the map.
4. **Selecting a country never changes `window.scrollY`.** The page moves only when the user presses a control that
   says it will move the page ("Details ↓", "↑ Map", skip link, header section links). §3.4 lists the guardrails.
5. **Highest risk** shows up four ways on first load. The map's brightest colors are the worst tiers. A ranked list sits
   under the map (desktop) or as a chip strip (mobile). The legend shows per-tier counts. The country view opens on
   the **#1-ranked country**.
6. **Small places stay reachable**: dots for the 64 places with no polygon at 110m, a nearest-target hover radius, a
   **"Which place?" chooser** for ambiguous taps, browser pinch-zoom left on, and search, list and chips that reach
   every place. The map has no in-app zoom.
7. **Country view order**: header → 4 headline numbers → why this risk level → population 1950–2100 → what's changing
   the population (latest year, then 1950–2100) → moving in and out → start with 100 people (what-if slider) → births
   per woman over time.
8. **Colors are checked for color-blind readers.** In both map ramps, lightness rises with concern. Adjacent steps keep
   ΔE_OK ≥ 8 under protan, deutan and tritan simulation. The births per woman (TFR) ramp is split on the blue/orange
   axis so the 2.1 boundary survives every color-vision type.
9. **The data is visible to people and agents**: a "For people and AI agents" section with CSV/JSON/OpenAPI/llms.txt
   links, a live curl line, and a copyable agent prompt. The `<head>` also carries `service-desc`, `llms.txt` and
   JSON-LD Dataset tags.
10. **Feedback** goes to a GitHub issue form prefilled with the country, or to email. The X handle stays hidden until it
    exists. Sharing on X uses one static 1200×630 card, re-rendered weekly with live numbers.

---

## 1. Information architecture and layout

### 1.1 Page order (identical on every viewport)

1. **Top bar** (sticky, 56px): wordmark, search combobox, "Data & API", "Feedback".
2. **Hero**: H1, a live subhead, a meta line.
3. **Explorer**: map toolbar → map → legend → highest-risk ranking → country view.
4. **For people and AI agents** (`#data`).
5. **Feedback** (`#feedback`).
6. **How this works** (`#methodology`): methodology, caveats, sources.
7. **Footer**.

Section ids are lowercase words. No element id may ever equal a country code (see §3.4 G2).

### 1.2 Breakpoints

| Name | Width | Layout |
|---|---|---|
| mobile | < 600px | Single column, map full-bleed (edge to edge), 16px gutters elsewhere |
| tablet | 600–1099px | Single column, map inside 24px gutters, KPI tiles 4 across |
| desktop | ≥ 1100px | Two columns: map column `minmax(0,1fr)` (sticky) + country column `460px`, gap 32px, gutters 32px |
| wide | ≥ 1440px | Country column `520px`, content max-width 1360px, centered |

### 1.3 Where the country view lives, and why

**Decision: inline.** On desktop it is a column beside a sticky map; on mobile and tablet it is the section right under
the map.

- On desktop, the map stays on screen while you read, and clicking another country redraws the column you are already
  looking at. Nothing scrolls.
- On mobile, the country's name and tier sit inside the first screen under the map (budget in §1.5), so a tap on the
  map, or on a highest-risk chip, shows its result without scrolling.
- Rejected: a bottom sheet (nested scrolling, gestures that fight page scroll on iOS, focus traps, cramped charts: the
  same kind of jank Ros flagged), a modal (hides the map), and an overlay side panel (covers the map).

### 1.4 Desktop wireframe (1280×800)

The figures in the wireframes and examples (tier counts, −58%, 21.9M, median age) are illustrative. Real values come
from the API. Only the figures marked *measured* are facts.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ● Fertility Tracker   [⌕ Search a country or territory          / ]   Data & API  Feedback│ sticky 56
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Most countries now have too few births to replace their population.          (H1, 1 line)│
│ 132 of 236 countries and territories are under 2.1 births per woman, the level that …    │
│ World 2.19 births per woman · 24 places at critical risk · Updated 26 Oct 2026, checked weekly│
├──────────────────────────────────────────────────────┬─────────────────────────────────┤
│ MAP COLUMN (sticky, top 72px)                        │ COUNTRY COLUMN (460px)          │
│ [Decline risk | Births per woman]         [◐ Globe]  │ EAST ASIA & PACIFIC             │
│ ┌──────────────────────────────────────────────────┐ │ South Korea                     │
│ │                                                  │ │ (● Critical decline risk) #1 of {N}│
│ │            EQUAL EARTH MAP  724×317              │ │ [Share] [Post on X]             │
│ │   (dots over microstates, white+dark outline     │ │ South Korea has 0.75 births per │
│ │    on the selected country)                      │ │ woman, far below the 2.1 …      │
│ └──────────────────────────────────────────────────┘ │ ┌───────────┬───────────┐       │
│ ■ Low 61  ■ Moderate 38  ■ Elevated 52  ■ High 41  ■ Critical 24  ▨ No data │ │ 0.75      │ −58%      │       │
│ ──────────────────────────────────────────────────── │ ├───────────┼───────────┤       │
│ Highest risk of shrinking                            │ │ 36 /100   │ 45.5      │       │
│ Ranked by decline-risk score · births/woman · 2100   │ └───────────┴───────────┘       │
│  1 ■ South Korea                 0.75   −58%         │ Why South Korea is rated Critical │
│  2 ■ Taiwan                      0.87   −49%         │ [meter] • factor • factor …     │
│  3 ■ …            (internal scroll, all 236)         │ Population, 1950–2100 …         │
└──────────────────────────────────────────────────────┴─────────────────────────────────┘
 Country column continues: What's changing the population · Moving in, moving out ·
 Start with 100 people · Births per woman over time · data links for this country.
 Then full width: For people and AI agents │ Feedback │ How this works │ Footer
```

Desktop rules:
- Map column: `position: sticky; top: 72px; max-height: calc(100dvh - 88px); display: flex; flex-direction: column`.
  The ranking list takes the leftover height (`flex: 1 1 auto; min-height: 160px; overflow-y: auto;
  overscroll-behavior: contain`).
- If `(max-height: 699px)`, the map column is not sticky and the list gets `max-height: 360px`.
- Hero on desktop: H1 on one line at 1280 (`font-size: clamp(28px, 2.4vw, 36px)`), subhead on one line, meta on one
  line. The hero must stay ≤ 140px tall so the map and the country header both start above y ≈ 200.
- At 1280×800 the first screen shows: the whole map, the legend, ~4–5 ranking rows, the country header, and the 4 KPI
  tiles.

### 1.5 Mobile wireframe (390×844; about 664px visible in iOS Safari)

```
┌──────────────────────────────────────┐
│ ● [⌕ Search a country…        ] Data │ sticky 56
├──────────────────────────────────────┤
│ Most countries now have too few      │ H1 22px, 3 lines
│ births to replace their population.  │
│ 132 of 236 are under 2.1 births per  │ sub 14px, 2 lines
│ woman, the level that keeps …        │
│ [Decline risk|Births per woman] [◐]  │ toolbar 44
│┌────────────────────────────────────┐│
││        MAP full-bleed 390×171      ││ measured height
│└────────────────────────────────────┘│
│ ■Low ■Moderate ■Elevated ■High ■Critical ▨ │ legend 32 (scrolls sideways if needed)
│ ● South Korea · Critical · 0.75 [Details ↓]│ readout row 44
│ Highest risk: [1 South Korea 0.75][2 Taiwan 0.87][…][All 236 →] │ chips 52, sideways scroll
│ South Korea                          │ country header starts ≈ y 555: on first screen
│ ● Critical decline risk · #1 of {N}    │
│ ┌────────┬────────┐                  │
│ │ 0.75   │ −58%   │ KPI 2×2          │
│ …                                    │
└──────────────────────────────────────┘
```

Mobile rules:
- **Readout row** (mobile and tablet only): sits under the legend and always shows the current selection. In Globe mode
  (frame 390×390) the country header falls below the fold, and this row is what confirms the selection.
  "Details ↓" scrolls to the country header (a user-chosen scroll, §3.4 G8).
- **Chip strip**: `overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain`, 16px right-edge
  fade. The last chip opens the All countries dialog (§3.7).
- Tablet uses the same order, with the map inside gutters and KPI tiles 4 across.

### 1.6 Country mini-bar (all viewports)

- A 44px bar pinned under the top bar (`top: 56px`). It appears once the country header has scrolled under the top
  bar and hides when `#country` leaves the viewport (IntersectionObserver).
- It takes **no layout space**. It is an overlay inside a zero-height sticky wrapper, so its appearance never shifts
  content.
- Appear/disappear: opacity plus translateY(−8px→0), 160ms.
- Desktop: as wide as the country column. Mobile and tablet: full width.
- Content: tier swatch · country name · "0.75 births per woman" · tier name · on mobile and tablet only, an
  "↑ Map" button.
- When the selection changes while the bar is visible, its background flashes from the tier color at 25% opacity back
  to `--surface-2` over 600ms, so the change registers. No flash under reduced motion.

---

## 2. Map

### 2.1 Files (vendored, no CDN)

| File | Source | Notes |
|---|---|---|
| `public/vendor/d3-array.min.js` | npm `d3-array@3` `dist/` UMD | Required by d3-geo's UMD build; load first |
| `public/vendor/d3-geo.min.js` | npm `d3-geo@3` `dist/` UMD | Global `d3`: `geoEqualEarth`, `geoOrthographic`, `geoPath`, `geoCentroid`, `geoInterpolate`, `geoContains`, `geoDistance`, `geoGraticule` |
| `public/vendor/topojson-client.min.js` | npm `topojson-client@3` `dist/` UMD | Global `topojson.feature` |
| `public/vendor/world-110m.json` | `world-atlas@2.0.2/countries-110m.json`, preprocessed once (below) | 108 KB raw / **39 KB gzipped**, 177 features, 8,246 points (*measured*) |
| `public/vendor/world-points.json` | Appendix A of this spec | `{ ISO3: [lon, lat] }` for the 64 places with no 110m polygon |

**Why 110m, not 50m:** 50m weighs 236 KB gzipped and has 80,617 points (*measured*). That is 10× the points to
re-project on every globe frame on a phone. Dots cover what 110m leaves out.

**One-time preprocessing of `world-110m.json`** (commit the output; a one-off script under `scripts/` is fine; the site
has no build step):
- Rewrite each geometry `id` from ISO numeric (e.g. `"410"`) to ISO3 (`"KOR"`).
- Drop `010` (Antarctica) and `260` (Fr. S. Antarctic Lands).
- Three features have no ISO code. Following the UN convention the data uses: Somaliland → `"SOM"`, N. Cyprus → `"CYP"`.
  Kosovo → `"XKX"`, rendered as no-data unless the API has `XKX`.
- Keep `properties.name` as a fallback label.

### 2.2 Flat map (default)

- Projection: `d3.geoEqualEarth()`, rotate `[0, 0]`, `fitWidth(frameWidth, allFeatures)`. Equal-area, so Africa and
  South Asia appear at true size next to Russia and Canada. That matters on a population map.
- Size: the height follows the width at ratio 0.4385. *Measured*: 390px wide → 171px tall; 724 → 317; 748 → 328.
- The SVG `viewBox` uses real CSS pixels (`0 0 W H`), so stroke widths and dot radii are exact. Re-fit on container
  resize (ResizeObserver, 100ms debounce).
- No sphere outline and no graticule. The ocean is the page background.

### 2.3 Globe mode

- Toolbar toggle `[◐ Globe]` (`<button aria-pressed>`). On: orthographic. Off: flat. Crossfade 200ms. The choice is
  stored in `localStorage["ft.view"]` and is not part of the URL.
- Projection: `d3.geoOrthographic().clipAngle(90).precision(0.5)`, fit to a square frame with an 8px margin.
- Frame size:
  - Desktop: side = `min(column width, 560px, 100dvh − 368px)`.
  - Mobile and tablet: side = frame width (390 → 390).
  - Changing the frame size on toggle is fine: the user caused it, and it changes nothing above the map.
- Look:
  - Sphere fill: radial gradient `#18213A` (center, offset 30% toward top-left) → `#0D1220` (rim).
  - Rim stroke: 1px `#2A3550`.
  - Halo: a circle of radius `r × 1.06` filled with a radial gradient from transparent (92%) through
    `rgba(110,150,255,.12)` (96%) to transparent (100%).
  - Graticule: 30° step, 1px `rgba(255,255,255,.06)`.
  - Dots on the far side are not drawn (`geoDistance(point, center) > π/2 − 0.02`).
- Opens already centered on the selected country (lat clamped to ±45°). It never spins on open, and **it never spins
  on its own**.
- **Turning to a new selection:**
  - Target center = the country's point (centroid of its largest polygon, or its dot).
  - Interpolate with `d3.geoInterpolate(currentCenter, target)` over 750ms, easing `easeInOutCubic`, re-rendering paths
    on every `requestAnimationFrame`. A drag interrupts it.
  - Reduced motion: jump straight there.
- **Drag to rotate:**
  - Pointer events. Δλ = dx × (57.3 / r) degrees and Δφ = −dy × (57.3 / r), with φ clamped to ±60°.
  - **Touch rotates longitude only.** The globe SVG has `touch-action: pan-y pinch-zoom`, so a vertical swipe still
    scrolls the page.
  - Movement over 5px counts as a drag and suppresses the click.

### 2.4 Color modes and ramps

A segmented control in the toolbar, `[Decline risk] [Births per woman]` (two `<button aria-pressed>`). The default is
**Decline risk**. The choice is stored in `localStorage["ft.colorMode"]`. It also sets the sort order of the ranking
list and chips (§4.3).

**Decline-risk ramp** (fill by `risk.tier`; the design keys off the tier value only; `null` uses the no-data hatch):

| `risk.tier` | Label | Hex | OKLab L |
|---|---|---|---|
| `Low` | Low | `#2A3A5E` | 35 |
| `Moderate` | Moderate | `#5B4A94` | 46 |
| `Elevated` | Elevated | `#B4508C` | 58 |
| `High` | High | `#F2713F` | 70 |
| `Critical` | Critical | `#FFCB52` | 87 |

**Births-per-woman ramp** (7 bins, lower bound inclusive, value rounded to 2 decimals before binning):

| Bin | Legend label | Hex | Side |
|---|---|---|---|
| < 1.0 | Under 1 | `#FFCB52` | below replacement |
| 1.0–1.3 | 1–1.3 | `#F2713F` | below |
| 1.3–1.6 | 1.3–1.6 | `#B9563A` | below |
| 1.6–2.1 | 1.6–2.1 | `#7A4A34` | below |
| 2.1–3.0 | 2.1–3 | `#2C4C72` | at/above |
| 3.0–4.0 | 3–4 | `#3779B4` | above |
| ≥ 4.0 | 4+ | `#73B7EA` | above |

The 1.3 cut matches the demographers' "lowest-low fertility" line. 2.1 is replacement.

**Verification (*measured*):**
- Risk ramp: smallest adjacent ΔE_OK×100 is 12.8 for normal vision, 8.2 protan, 11.4 deutan, 11.6 tritan.
- TFR ramp: 12.8 normal, 8.3 protan, 12.1 deutan, 11.4 tritan.
- The replacement pair (brown `#7A4A34` vs navy `#2C4C72`) stays ≥ 11 under every simulation, because it sits on the
  blue–orange axis.
- Rejected: a magenta→blue diverging ramp. At that boundary it dropped to ΔE 1.7 under protan.

### 2.5 Legend

- Sits under the map frame, one row: swatch (12×12, radius 3, 1px `rgba(255,255,255,.15)` border) + label +
  count (12px `--text-muted`; counts are hidden below 600px).
- Risk mode: `Low · Moderate · Elevated · High · Critical · No data` (No data uses the hatch swatch).
- TFR mode: the 7 bin labels plus No data. A caption sits under the 2.1 boundary: "2.1 = replacement".
- **Each item is a toggle button** (`aria-pressed`). Pressing one isolates that tier or bin: every other country fades
  to opacity 0.18 (the selected country never fades). Pressing it again, or Escape, clears it. Only one is active at a
  time. Desktop caption, 12px muted: "Click a level to show only those places."
- Below 600px the legend row scrolls sideways if it doesn't fit (`overflow-x: auto`).

### 2.6 Borders and no-data

- Country stroke: `--map-border` `#0B0E14` (the page background), 0.6px, `vector-effect: non-scaling-stroke`. This
  gives a crisp gap between neighbors.
- No data: SVG `<pattern id="hatch">`, 4×4, rotated 45°, base `#1A1F2A`, 1px lines `#2E3544`. No hover change. The
  tooltip says "No data in our sources". It can't be selected.

### 2.7 Hover and tooltip

- **Pointer devices** (`(hover: hover) and (pointer: fine)`):
  - Hover outline: a clone of the path on a top layer, stroke `rgba(255,255,255,.75)` 1px.
  - The tooltip follows the pointer at +14px/+14px and flips left or up so it never leaves the map frame.
  - Tooltip box: max-width 280px, `--surface-2` background, 1px `--border-strong`, radius 10, shadow
    `0 8px 24px rgba(0,0,0,.45)`, `pointer-events: none`. Shows immediately; hides 100ms after the pointer leaves.
- **Touch:** no tooltip. A tap selects (§2.9); the readout row and the country header show the summary.
- **Keyboard:** the same tooltip, anchored to the focused country's point (§2.11).
- Content: the copy templates in §8.4.

### 2.8 Selected styling

- The selected country is drawn on a top `<g class="selection">` layer as two clones of its path:
  1. a **dark halo**, stroke `#0B0E14` 5px;
  2. a **white outline**, stroke `#FFFFFF` 2px.

  Both use non-scaling strokes and no fill. The double stroke is required: plain white on the Critical amber is only
  1.51:1 (*measured*), so the #1 country would barely look selected. The dark halo makes it 12.8:1.
- **Locator ring** at the country's point: a dark 4px ring under a white 1.5px ring, r = 12.
  - Always shown for dots and for polygons under 150px² projected area.
  - On every new selection it pulses once (r 12→22, opacity 0.9→0, 700ms), on any country size. No pulse under
    reduced motion.
- Selected dot: r 5, white 2px stroke over a dark 4px halo, plus the ring.
- Nothing else on the map dims or moves. In flat mode there is no zoom or pan to the selection.

### 2.9 Small places (Singapore, Malta, Hong Kong, Caribbean, Pacific)

*Measured problem:*
- 64 of the 236 data places have **no polygon** at 110m: SGP, MLT, HKG, MAC, BHR, MDV, most of the Caribbean and the
  Pacific.
- At 390px wide, many real polygons are tiny: Luxembourg 0.3px², Trinidad 1.0, Puerto Rico 1.2, Qatar 1.5, Jamaica 1.7.
- **South Korea itself is 13px², about a 3.6px blob.**

Four layers solve this:

1. **Dots.** A `<circle>` is drawn for:
   - every place in `world-points.json`;
   - every polygon whose projected area is under **6px²** at the current size (recomputed on resize). The dot sits at
     the polygon's centroid.

   Radius 3px (map width ≥ 700) or 2.5px (narrower). Fill = the place's tier or bin color. Stroke 1px `--map-border`,
   so overlapping dots stay separate. Hover: r + 1, white 1px stroke. Dots sit above polygons.
2. **Pointer hit-testing.** On hover or click, the nearest dot within 6px of the pointer wins. Otherwise the polygon
   under the pointer. Otherwise nothing.
3. **"Which place?" chooser (touch).** A tap is a pointerup moved < 8px within 500ms and not cancelled by a page scroll.
   On a tap:
   - P = the polygon under the finger.
   - S = every dot, plus the centroid of every polygon under 400px², that lies within **22px** of the finger.
   - Candidates = P ∪ S, minus no-data places.
   - 0 candidates → nothing happens (on a no-data place, the readout row shows "No data for {name}" for 3s).
     1 → select it. ≥ 2 → open the chooser.
   - Sort order: P first if its area is ≥ 400px², otherwise by distance.

   The chooser itself:
   - A popover titled "Which place?" with up to 6 rows, each 44px: swatch, name, births per woman. If there are more
     candidates, a last row reads "Search for a place" and focuses the search box.
   - Placement: anchored at the tap point, clamped to the explorer. Below 600px it docks to the bottom edge of the map
     frame at full width.
   - Closes on selection, Escape, or a tap outside. Focus moves to its first row (`preventScroll`) and returns to the
     map SVG on close.
4. **Every place is reachable without the map:** the search combobox, the ranking list, the chips and the All countries
   dialog.

Also: **never block browser pinch-zoom**. No `user-scalable=no` and no `maximum-scale`. The flat map is vector, so a
pinch gives a crisp close-up of the Caribbean.

### 2.10 Zoom and pan

**None in-app.** The whole world stays in view, so the "who's in trouble" pattern is always readable. In-app touch
gestures on a 171px-tall map are exactly how scroll-traps happen on phones. The chooser and the dots already solve
reachability. Globe mode is the "closer look".

### 2.11 Keyboard access

- The map SVG is **one tab stop**: `tabindex="0"`, `role="group"`, `aria-roledescription="interactive map"`, and
  `aria-label="World map colored by decline risk. Arrow keys move between countries. Enter selects."` (the label
  changes with the color mode).
- Individual paths are `aria-hidden="true"` and carry `data-iso3`, never an `id`.
- On focus, the keyboard cursor starts on the selected country.
- **Arrow keys** move the cursor to the nearest country in that direction. The geometry uses each place's
  **Equal Earth** screen point, in both modes, so the directions match the flat map:
  - candidates lie within ±60° of the arrow direction;
  - score = distance × (1 + 2·(1 − cos θ));
  - the lowest score wins; dots are included.
- **Enter / Space** selects. **Home** jumps to the #1-ranked place. **Escape** clears legend isolation or closes the
  chooser.
- The cursor country gets the hover outline plus the tooltip. A polite live region announces: "Japan. Critical decline
  risk. 1.15 births per woman. Press Enter to select."
- Globe mode: if the cursor country is more than 60° from the globe's center, the globe turns to it (300ms; instant
  under reduced motion).
- Focus ring: on `:focus-visible` the **map frame** gets the standard focus ring (§9.5).

---

## 3. Selection flow

### 3.1 One entry point

Every source calls `selectCountry(iso3, { source })`. The sources are: `search`, `map`, `chooser`, `list`, `chip`,
`dialog`, `hash`, `keyboard-map`, `init`. The function must never scroll the window.

### 3.2 What happens, in order

1. If `iso3` is unknown, stop and announce "No data for {name}".
2. Set `state.selected = iso3`.
3. `history.replaceState(null, "", "#" + iso3)`. Skip this for `init` when there was no hash: the first-load default
   (#1 ranked) leaves the URL clean. replaceState is used so that browsing 20 countries doesn't add 20 Back-button
   entries.
4. Map: move the selection layer, pulse the locator ring, and in Globe mode turn to the country (§2.3).
5. Country view: render every block from `countries.json` within one frame, then fill the charts when
   `countries/{ISO3}.json` arrives (§3.8). The content crossfades: opacity 0.4→1 over 160ms on content, never on
   layout.
6. Ranking list, chips and dialog: set `aria-selected` / `aria-pressed`. Keep the selected row visible **by setting that
   list's own `scrollTop`**.
7. Search input: its value becomes the country name (unless the source is the search box itself).
8. `document.title` = the country template (§8.1).
9. Polite live region: "South Korea selected. Critical decline risk. 0.75 births per woman."
10. Readout row and mini-bar update; the mini-bar flashes if visible (§1.6).

### 3.3 Focus rules

- **Focus stays on the control the user used** (search input, map SVG, list option, chip). Selection never moves focus
  into the country view.
- Exceptions: the chooser returns focus to the map SVG; the dialog returns focus to the button that opened it. Both use
  `{ preventScroll: true }`.
- Keyboard users reach the details through a "Skip to {Country} details" link. It is visually hidden until focused,
  sits right after the map in tab order, and is a user-chosen scroll (G8). It focuses the country `<h2 tabindex="-1">`.

### 3.4 Scroll rules (the v1 bug)

**R1. Selecting a country never changes `window.scrollY`, on any device, from any source.**

**Desktop (≥ 1100px):** the map column is sticky and the country column sits beside it, so every change is visible
where the user is. A reader deep in the country column (say, at "Start with 100 people") stays at that block, which now
shows the new country. The mini-bar shows the new name and flashes.

**Mobile and tablet (< 1100px):** the page stays put.
- Selecting from the map, chooser or chips near the top: the readout row and the country header below it update in
  view.
- Selecting from the top-bar search while scrolled down: the block under the reader updates in place, and the mini-bar
  flashes the new name.
- The page moves only when the user taps "Details ↓" (readout row) or "↑ Map" (mini-bar): a smooth scroll (instant
  under reduced motion), then focus on the target heading with `preventScroll`.

**Guardrails (all required):**
- **G1.** Write the selection with `history.replaceState`. Never assign `location.hash`.
- **G2.** No element `id` may equal a selection hash in any letter case (any ISO3, or `WLD`). Option and row ids are
  prefixed and lowercase (`opt-kor`, `row-kor`, `chip-kor`). Paths use `data-iso3`. With no target, the browser can't
  anchor-jump on load or on `hashchange`.
- **G3.** Every programmatic `.focus()` passes `{ preventScroll: true }`.
- **G4.** No `scrollIntoView` anywhere, because it scrolls every ancestor including the window. Keep-in-view inside a
  listbox sets that listbox's `scrollTop`.
- **G5.** Reserved heights: each country-view block has a fixed `min-height` that fits its largest content (table in
  §5.1). Swapping countries doesn't change the document height. Loading and error states render at the same size.
- **G6.** Update nodes in place, or swap the children of fixed-size containers. Never remove and re-insert a whole
  section.
- **G7.** On coarse pointers, record `scrollY` when the search input gains focus. When a selection blurs the input (to
  close the keyboard), restore that `scrollY` in the next frame if it changed. This is the only window scroll allowed in
  the selection path, and it only ever restores.
- **G8.** Window scrolling happens only behind explicit jump controls: skip link, "Details ↓", "↑ Map", and the header
  links to `#data`, `#feedback` and `#methodology`. Smooth scrolling, or `auto` under reduced motion.
- **G9.** Leave `history.scrollRestoration` at its default. The app never scrolls on load, deep links included.

### 3.5 URL hash

- The format is `#KOR` (ISO3, uppercase). `#WLD` = World.
- On load and on `hashchange`, a hash matching `/^#[A-Za-z]{3}$/` that names a known place selects it (source `hash`,
  no scroll). A lowercase hash is normalized with `replaceState`.
- Any other hash (`#data`, `#feedback`, `#methodology`) is an ordinary anchor and leaves the selection alone.
- With no hash, or an unknown one, the app selects the #1-ranked place and doesn't rewrite the URL.
- Share links always carry only the country. Color mode and view mode never go in the URL.

### 3.6 Search combobox (ARIA 1.2 combobox, list autocomplete)

Markup:

```html
<label for="search" class="visually-hidden">Search a country or territory</label>
<input id="search" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
       aria-controls="search-results" aria-activedescendant="" autocomplete="off" autocapitalize="off"
       spellcheck="false" enterkeyhint="go" placeholder="Search a country or territory">
<ul id="search-results" role="listbox" aria-label="Matching places"> … <li role="option" id="opt-kor" aria-selected="false">…</li></ul>
<div class="visually-hidden" aria-live="polite" id="search-status"></div>
```

- **Input font-size is 16px on every viewport.** Anything smaller makes iOS zoom in on focus.
- **Matching:**
  - Normalize both sides: NFD, strip diacritics, lowercase, strip punctuation.
  - Match against the name, an alias table, and the ISO3 code.
  - Score: exact name, alias or code = 0; name starts with the query = 1; a word in the name starts with it = 2; an
    alias starts with it = 3; substring = 4.
  - Ties go to the larger population. Show at most 8.
  - The matched part of the name is bold.
- **Aliases, starter set:**

  | Place | Aliases |
  |---|---|
  | KOR | Korea, Republic of Korea |
  | PRK | North Korea, DPRK |
  | GBR | UK, Britain, Great Britain, England |
  | USA | US, America, United States of America |
  | RUS | Russian Federation |
  | TUR | Türkiye, Turkey |
  | CZE | Czech Republic, Czechia |
  | CIV | Ivory Coast, Côte d'Ivoire |
  | MMR | Burma |
  | NLD | Holland |
  | MAC | Macau |
  | COD | DRC, Congo-Kinshasa |
  | COG | Congo-Brazzaville |
  | SWZ | Swaziland, Eswatini |
  | MKD | Macedonia |
  | CPV | Cabo Verde |
  | TLS | East Timor |
  | VAT | Holy See |
  | PSE | Palestine |
  | WLD | World, Earth, Global |

- **Option content:** tier swatch (10px, radius 3), name, and births per woman right-aligned in `--text-muted`, in a
  single 40px row.
- **Empty input on focus:** show a group "Highest risk" (top 5 in the active color mode) and then "World". Use
  `role="group"` with an `aria-label` inside the listbox.

| Key | Behavior |
|---|---|
| ArrowDown | Opens the list if closed; otherwise moves to the next option (wraps). Updates `aria-activedescendant` |
| ArrowUp | Previous option (wraps) |
| Enter | Selects the active option. If none is active and there are results, selects the first |
| Escape | Closes the list. Pressed again with the list closed, clears the text |
| Tab | Closes the list with **no** selection change |
| Alt+ArrowDown | Opens the list without moving the active option |
| `/` (global) | Focuses the search box, unless the user is typing in another field. The desktop placeholder shows a `/` key hint |

- **Pointer:** a click on an option selects it. Call `preventDefault` on `mousedown` so the input keeps focus.
- **On focus:** select all the text and open suggestions.
- **After a selection:** the list closes and the input shows the name. On coarse pointers, blur the input and apply G7.
- A "×" clear button appears while the input has text. It clears the text only; the selection stays.
- **No results:** a disabled option row (`aria-disabled="true"`) reading "No match. Try a name like 'Korea' or a code
  like KOR." The live status announces "No matches", otherwise "{n} results".
- **List box:** absolutely positioned under the input, `max-height: min(60vh, 336px)`, scrolls internally, full header
  width on mobile, `--surface-2` background, `z-index` above the map.

### 3.7 Ranking list, chips, All countries dialog

- **Ranking list:** one component, used in the desktop map column and inside the dialog.
  - `role="listbox"`, `aria-label="Places ranked by decline risk"` (or "…by births per woman" in TFR mode).
  - **One tab stop** with a roving tabindex. ArrowUp/Down, Home/End and PageUp/PageDown move focus; typing letters
    jumps to the next matching name.
  - **Enter, Space or click selects. Selection does not follow focus.**
  - The selected option has `aria-selected="true"`.
  - Row columns: rank (28px, right-aligned, tabular) · swatch (10px) · name (flex, ellipsis, full name in `title`) ·
    births per woman (44px, right) · change by 2100 (52px, right; this column is hidden in TFR mode).
  - Row height: 36px on desktop, 44px in the dialog.
  - A 12px muted column header row: "births/woman" and "2100".
  - Ranked places come first. Then a `role="group"` labeled **"Not ranked: under 100,000 people or incomplete
    data"** holds the rest, sorted by the same metric with no rank numbers. World is never in the list; it's in search.
- **Chips (mobile and tablet):** `<ul aria-label="Highest risk">` of `<button aria-pressed>` items. Each reads
  "1 · ■ South Korea · 0.75", 44px tall. They show the top 10 in the active mode. The final chip, "All 236 →", opens
  the dialog.
- **All countries dialog:**
  - A `<dialog>` opened with `showModal()`, full-screen below 600px, centered 560×80vh above.
  - Header: "All countries and territories", a 44px close button, and a filter input (`type="search"`, 16px) that
    narrows the listbox.
  - Selecting a place closes the dialog and returns focus to the opener with `preventScroll`.
  - Use `overscroll-behavior: contain` on the dialog's scroller. Don't use the `position: fixed` body hack: it resets
    the scroll position.

### 3.8 Loading and failure during selection

- **Instant:** the header, KPIs, "Why" block, latest-year waterfall, inflow/outflow, and the 100-people block all come
  from `countries.json`, which is already loaded.
- **Lazy:** the 1950–2100 charts, the C6 corridor lists and the "See all factors" list need `countries/{ISO3}.json`.
  - Cache the files in a `Map`.
  - On idle after first render, prefetch the top 10 and `WLD`.
  - While a file loads, the chart shows a skeleton at full reserved size: the axes plus a `--surface-2` shimmer band.
    No shimmer under reduced motion.
  - Ignore late responses for a country that is no longer selected.
- **Failure:** "Couldn't load {Country}'s history." plus a [Try again] button, at the same size.
- **If `countries.json` fails:** the map draws gray land (`--surface-2`). A banner over the explorer reads "Couldn't
  load the latest data." with [Try again].

---

## 4. Highest-risk treatment

### 4.1 Tiers: names and plain-English meaning

The backend owns the tiers (`scripts/lib/risk.mjs`, `RISK_MODEL.tiers`). The API's `risk.tier` values are the
capitalized names below. The UI maps them to CSS classes by lowercasing: `tier-critical` … `tier-low`. The meaning
column is the backend's `description`. **Show it verbatim**, read from `risk.json` → `methodology.tiers`, so the site
and the API never disagree. The text below is a snapshot.

| `risk.tier` | Score | Label in the UI | Meaning (from risk.json; used in the legend tooltip, methodology and "Why" block) |
|---|---|---|---|
| `Critical` | ≥ 70 | Critical decline risk | Shrinking fast and locked in: very low fertility, more deaths than births, steep projected decline. |
| `High` | 55–69 | High decline risk | Decline is underway or close, with fertility far below replacement. |
| `Elevated` | 40–54 | Elevated decline risk | Fertility well below replacement; decline likely within decades unless migration fills the gap. |
| `Moderate` | 20–39 | Moderate decline risk | Some warning signs (below-replacement fertility or aging), but population still growing or stable. |
| `Low` | 0–19 | Low decline risk | Fertility near or above replacement; population projected to keep growing. |
| `null` | — | No score | Shown with the no-data hatch on the map. The tooltip says "Not scored (incomplete data)". |

- On its first mention in a block, a tier always appears with the words "decline risk", so "Critical" can't be misread
  as a judgment of a country.

### 4.2 First load

- The map is colored by risk tier. The worst tiers are the brightest colors (amber `#FFCB52`, orange `#F2713F`), so
  East Asia and much of Europe light up at a glance, and most of Africa recedes in navy.
- The legend shows each tier's count, e.g. "Critical 24".
- The ranking list (desktop) or chip strip (mobile and tablet) is ordered by risk.
- The country view opens on **#1-ranked**. The URL stays clean until the user selects something (§3.5).

### 4.3 Ranking panel

- Heading, risk mode: **"Highest risk of shrinking"**. Subtitle (13px muted): "Ranked by decline-risk score, 0–100".
- In TFR mode the list re-sorts ascending by births per woman, with the heading **"Lowest births per woman"** and the
  subtitle "Places with 100,000+ people".
- The selected row: `rgba(255,255,255,.08)` background, a 3px tier-colored left bar, and semibold text.

### 4.4 Ranking rule

- **Use the API's `risk.rank` as-is, everywhere**: tooltip, list, header, chips, social card. The backend ranks places
  with `ranked: true`: population ≥ 100,000 and every score input present. The UI never computes its own rank, so a
  person and an agent always see the same number.
- `{N}` in "#1 of {N}" is the length of `risk.json` → `ranking`.
- Unranked places (`rank: null`) still show their score and tier when they have one. The reason comes from
  `flags`: "not ranked (under 100,000 people)" if the place carries `small-population`, otherwise "not ranked
  (incomplete data)".
- If the orchestrator later wants a higher bar for the headline list (e.g. 1M people, to keep micro-territories off
  the top), change it in the backend's `RISK_MODEL.minPopulation`, never in the UI.

---

## 5. Country view

### 5.1 Blocks, order and reserved size

| # | Block | Reserved min-height (≥600 / <600) |
|---|---|---|
| C1 | Header | 168 / 184 (the name reserves 2 lines on mobile) |
| C2 | Headline numbers (2×2 tiles; 4 across on tablet) | 204 / 204 (tablet 104) |
| C3 | Why this risk level | 260 / 300 |
| C4 | Population, 1950–2100 | 280 / 300 |
| C5a | What's changing the population: latest year | 236 / 256 |
| C5b | Births, deaths and migration, 1950–2100 | 304 / 324 |
| C6 | Moving in, moving out | 340 / 456 |
| C7 | Start with 100 people (with what-if) | 520 / 540 |
| C8 | Births per woman, 1950–2100 | 280 / 300 |
| C9 | Data for this country and feedback | 56 / 72 |

Shared rules for every chart block (C4, C5, C6, C8):

- **Block head:**
  - A muted 13px **label** names the chart, e.g. "Population, 1950–2100".
  - Below it, an `<h3>` (18px semibold) holds the generated **takeaway sentence**. It reserves 2 lines at ≥ 600px and
    3 lines below, clamped beyond that.
- **Chart frame:** SVG at 100% of the column width, with a fixed height per block. The `viewBox` is in CSS pixels;
  re-render on resize.
- **Axes:**
  - Text: 12px `--text-muted`.
  - Horizontal gridlines only: 1px `--grid`.
  - X ticks: 1950 / 2000 / 2050 / 2100, plus 1975 / 2025 / 2075 at ≥ 600px.
  - Y: 4–5 nice ticks with compact labels ("40M", "200K", "1.5"), left-aligned inside the plot above their gridline.
- **Recorded vs projected:**
  - A **projection zone**: a rect from the boundary to 2100 filled with `--proj-zone`.
  - A **boundary line**: 1px dashed `--boundary` at x = (last year with `variant: "estimate"` in `series`) + 0.5.
  - Top labels in 12px muted: "Recorded" right-aligned left of the boundary, "UN projection" left-aligned right of it.
  - Series are **dashed `5 4`** inside the projection zone, solid before it. Two cues, on purpose.
- **Direct labels** at line ends instead of legends. Nudge labels so they sit at least 14px apart.
- **Crosshair:**
  - On pointermove, or a horizontal touch-drag (`touch-action: pan-y`): snap to the nearest year, draw a 1px vertical
    `--text-muted` line, a dot on each series, and a value box at the top (`--surface-2`, 12px), e.g. "2050 · 45.0M".
  - Hidden on pointerleave.
- **Accessibility:** `role="img"`, with an `aria-label` = the takeaway plus first and last values. The CSV and JSON links
  in C9 are the keyboard-accessible equivalent.
- **On country change:** a 200ms opacity crossfade. No path morphing.

### 5.2 C1 Header

- Eyebrow: region in caps, 12px, letter-spacing .06em, `--text-muted`.
- `<h2 id="country-name" tabindex="-1">`: 28px desktop, 24px mobile, weight 700, `text-wrap: balance`. The longest name
  in the data is "Saint Vincent and the Grenadines".
- Meta row:
  - **Tier chip**: an outline pill with a 1px border in the tier color and a filled 8px swatch, 13px `--text` text,
    e.g. "Critical decline risk". It is an outline chip because white or dark text can't reach 4.5:1 on every tier fill.
  - Rank: "#1 of {N}", or "Not ranked (under 100,000 people)" / "Not ranked (incomplete data)" (§4.4).
  - Buttons: [Share] and [Post on X] (§10.3).
- Summary sentence: 16px `--text`, up to 2 lines. Templates in §8.5.
- **World (`WLD`):** no tier chip, rank or share-by-tier. The meta row reads "The world as a whole isn't scored".

### 5.3 C2 Headline numbers (4 tiles)

- Tile: `--surface-1` background, 1px `--border`, radius 10, padding 14px 16px, height 96px.
- Label: 13px `--text-muted`. Value: 28px weight 650 tabular. Sub: 13px `--text-muted`.

| Tile | Label | Value | Sub |
|---|---|---|---|
| 1 | Births per woman | `0.75` | `in 2024 · 2.1 keeps a population steady` |
| 2 | Population by 2100 | `−58%` | `51.7M now → 21.9M (UN projection)` |
| 3 | Next generation | `36` + small " per 100" | `children for every 100 people today` |
| 4 | Median age | `45.5` | `65 and older: 19%` |

Tile 3 = round(100 × tfr / 2.1), the same model as C7. Values are never colored: the sign and the words carry the
meaning.

### 5.4 C3 Why this risk level

- `<h3>`: "Why {Country} is rated {Tier}".
- **Meter:**
  - A 0–100 track, 10px tall and radius 5, split into the five tier bands from `risk.json` → `methodology.tiers[].min`
    (currently 0 / 20 / 40 / 55 / 70). Each band is its tier color at 35% opacity.
  - Marker: a white 2px × 18px tick at the score with a dark 4px halo, labeled above "92 / 100" in 13px semibold.
  - "Low" and "Critical" end labels in 12px muted.
- **Factors:** the summary's `risk.factors[]` (top 3, most important first), written in plain English by the backend,
  15px `--text`. Reserve 3 factors × 2 lines.
- **"See all factors"** text button, shown when the detail file has more factors: it expands the list in place. This is
  the only block allowed to change height after a selection, and only because the user pressed the button. It collapses
  again on the next selection.
- **Caveat** (13px muted): "This is a population-decline risk indicator, not a judgment of the country or its people.
  How the score works →" The link goes to `#methodology` (a G8 jump).
- **World:** the meter is replaced by "The world as a whole isn't scored. It has 2.19 births per woman, just above the
  2.1 replacement level."

### 5.5 C4 Population, 1950–2100

- **Chart type:** a line with a soft area.
- **Encoding:**
  - x = year; y = population (axis starts at 0).
  - Line `--text` 2px; area `rgba(237,239,244,.06)`.
  - Projection zone, dashed after the boundary.
- **Annotations:**
  - Peak: a dot plus "Peak 51.8M (2020)", only if the peak is not at either end.
  - End label at 2100: "21.9M". Start label at 1950.
- **Height:** 200px.
- **Takeaway templates:**
  - Peak in the past, and 2100 below today: "{Country}'s population peaked in {peakYear} and is projected to fall
    {abs pct}% by 2100."
  - Peak in the future and before 2100: "{Country} keeps growing until about {peakYear}, then the UN expects a slow
    decline."
  - Still rising in 2100: "{Country}'s population keeps growing through 2100, up {pct}% from today."

### 5.6 C5a What's changing the population, latest year

- **Label:** "What's changing the population, {year}". The year is the latest components year in the API.
- **Chart type:** a horizontal **waterfall** with 4 rows of 36px and a 108px label column on the left.
  - "Births": a bar from 0 to +B, `--c-births`.
  - "Deaths": a bar from B to B − D, `--c-deaths`.
  - "Net migration": a bar from B − D to B − D + M, `--c-migration`.
  - "Total change": a bar from 0 to the total, `--c-total`, with a 1px `--border-strong` outline.

  Total = B − D + M, computed so the bars add up exactly. A 1px `--text-muted` zero line. Thin 1px connector lines in
  `--border-strong` join bar ends.
- **Labels:** signed values at bar ends, e.g. "+231,000". The per-1,000 rate shows in muted text after the value
  ("+4.5 per 1,000") at ≥ 600px.
- **Height:** 168px.
- **Takeaway templates** (first match wins; gap = D − B):
  1. B > D and M ≥ 0: "Births outnumber deaths and more people arrive than leave: {+total} people in {year}."
  2. B > D and M < 0: "Births outnumber deaths, but {abs M} more people leave than arrive each year."
  3. B ≤ D and M ≥ gap: "More deaths than births, but immigration more than fills the gap: {±total} people in {year}."
  4. B ≤ D and 0 < M < gap: "Deaths outnumber births by {gap}. Immigration covers {round(100·M/gap)}% of that gap."
  5. B ≤ D and M ≤ 0: "Deaths outnumber births and more people leave than arrive: {total} people in {year}."

### 5.7 C5b Births, deaths and migration, 1950–2100

- **Chart type:** three lines on one axis, in people per year.
  - Births: `--c-births` 2px. Deaths: `--c-deaths` 2px. Net migration: `--c-migration` 2px.
  - The zero line is emphasized: 1px `--text-muted`.
- **Fill between births and deaths:** where births are above deaths, `--c-births` at 14% ("natural growth"); where
  deaths are above births, `--c-deaths` at 22% ("natural decline").
- **Annotation:** the first year after which deaths stay above births for 3 or more years gets a dot on the crossing and
  the label "Deaths overtake births, {year}".
- **Direct labels** at the right end: "Births", "Deaths", "Net migration".
- Projection zone and dashed lines after the boundary.
- **Height:** 220px.
- **Takeaway templates:**
  - Crossing at or before the boundary: "Deaths overtook births in {year}. By 2100 the UN expects {r} deaths for every
    birth." (r = deaths2100 / births2100, 1 decimal)
  - Crossing in the projection: "Births still outnumber deaths, but the UN expects deaths to overtake them around
    {year}."
  - No crossing: "Births outnumber deaths all the way to 2100."

### 5.8 C6 Moving in, moving out

- **Label:** "Moving in, moving out".
- **Chart type:** two horizontal bars on a shared scale, 28px each, labels above each bar.
  - "Born abroad, living in {Country}": a filled bar, `--c-migration`. Value: "1.8M · 3.4% of residents" (`immigrants`, `immigrantsPct`).
  - "Born in {Country}, living abroad": a **hollow** bar with a 2px `--c-migration` stroke and 12% fill. Value:
    "2.6M · equal to 5.0% of {Country}'s population" (`emigrants`, `emigrantsPct`). If `emigrants` is null (the
    World Bank fallback carries immigrants only), the bar reads "No data on people living abroad".

  Filled versus hollow carries in versus out without relying on color.
- **Under the bars:** "Net migration in {year}: {±M} people ({±rate} per 1,000)".
- **Where they come from, where they go:** two side-by-side lists (stacked below 600px) from the detail file's
  `migrationCorridors`:
  - "Most come from": `topOrigins`, top 3.
  - "Most live in": `topDestinations`, top 3.

  Each row is 24px: partner name (a button that selects that country: a normal selection, so R1 applies), then the
  people count right-aligned and tabular. These rows load lazily with the series file and show a skeleton of 3 rows
  meanwhile. If corridors are missing, show "No breakdown by country available." at the same height.
- **Note** (13px muted): "These count people, not yearly moves: everyone born abroad who lives here now, and everyone
  born here who lives abroad. Source: UN migrant stock, {stockYear}."
- **Height:** bars 132px + corridor lists 96px (mobile: 2 × 96px).
- **Takeaway templates:**
  - Emigrants > immigrants: "More people born in {Country} live abroad ({em}) than immigrants live in {Country} ({im})."
  - Otherwise: "{Country} is home to {im} people born abroad, more than the {em} of its own people living abroad."
- **Missing data:** "No migrant-stock data for {Country}." at the same height.
- **World:** "Migration moves people between countries, so it cancels out for the world."

### 5.9 C7 Start with 100 people (key secondary visual)

- **Label:** "Start with 100 people".
- **`<h3>` takeaway** (ratio = tfr / 2.1, gN = 100 × ratio^N):
  - Ratio < 1: "At {tfr} births per woman, 100 people today have {g1} children, {g2} grandchildren and {g3}
    great-grandchildren."
  - Ratio ≥ 1: "At {tfr} births per woman, each generation is bigger than the last: 100 → {g1} → {g2}."
  - While the what-if slider is active: "What if {Country} had {x} births per woman?" plus a "Hypothetical" tag (an
    outline pill in `--accent`).
- **What-if control** (sits above the rows):
  - The label "What if births per woman were…", an `<output>` (16px semibold tabular), and
    `<input type="range" min="0.5" max="4" step="0.05">`. Track 6px, thumb 20px, `accent-color: var(--accent)`.
  - Two labeled tick marks under the track: "{Country} {tfr}" and "Replacement 2.1". If the two are within 0.15 of
    each other, show only "Replacement".
  - A "Reset to {Country}'s rate" text button appears while the value differs.
  - The slider changes **only this block**.
- **Rows:** 5 generations of 64px each:

  | Generation | Label | Year |
  |---|---|---|
  | 0 | Today | current year |
  | 1 | Children | + 30 |
  | 2 | Grandchildren | + 60 |
  | 3 | Great-grandchildren | + 90 |
  | 4 | 4th generation | + 120 |

  - Columns: label (88px; bold name with the muted "~2086" under it) · dot grid · count (44px, 22px weight 650
    tabular, right-aligned).
  - **Dot grid:** 20 × 5 = 100 dots, filled row by row from the top-left.
    - Dot size: 11px with 3px gaps at ≥ 600px; 8px with 3px gaps below.
    - Alive: `--people-alive` `#F3EEE3`. Gone: transparent with a 1px `--people-gone` `#5A6378` stroke (3.0:1 on
      `--surface-1`, *measured*).
    - A fractional dot fills left to right with a linear-gradient.
    - Over 100 people: all 100 dots are filled and a "+{n−100}" chip sits after the grid.
  - **Count format:** ≥ 10 → integer; < 10 → one decimal.
- **Motion:** each dot's fill transitions over 200ms when the value changes, with no stagger. None under reduced motion.
- **Footnote** (13px muted): "Simple model: each generation is today's births per woman ÷ 2.1, about 30 years apart. It
  ignores migration, longer lives and age structure, so it shows the long-run pull of today's rate, not a forecast. The
  UN projection above is the forecast."

### 5.10 C8 Births per woman, 1950–2100 (secondary)

- **Chart type:** lines.
  - The country: `--text` 2.5px, dashed in the projection zone.
  - **World:** 1.5px `--c-deaths` gray, labeled "World" at the right end.
  - Replacement: a horizontal dotted (`2 4`) 1px `--text-muted` line, labeled "Replacement 2.1" at the right.
- **Latest World Bank point:** if its year is newer than the last UN estimate, draw a dot (r 4, `--text`) labeled
  "0.75 (2024)".
- **Y domain:** 0 → max(3, ceil(series max)).
- **Height:** 200px.
- **Takeaway:** "Births per woman fell from {v1950} in 1950 to {latest} in {latestYear}. The UN projects {v2100} by
  2100." If the series rose overall, "fell" becomes "rose".

### 5.11 C9 Data for this country and feedback

One line of links, 14px:
- "{Country} data:" JSON (`api/v1/countries/{ISO3}.json`) · CSV (`api/v1/timeseries.csv`)
- "Report a problem with {Country}'s numbers →" (the GitHub issue, §7)

---

## 6. "For people and AI agents" section (`#data`)

- **Headline:** "Use the data: free for people and AI agents".
- **Subhead:** "Every number on this page is a static file you can download or call. No key, no sign-up, updated
  weekly."
- **Layout:** two cards side by side at ≥ 900px, stacked below.

**Card 1: For people**
- **Download every country (CSV)** → `api/v1/countries.csv`
- **Download yearly data 1950–2100 (CSV)** → `api/v1/timeseries.csv`
- **{Country} as JSON** → `api/v1/countries/{ISO3}.json`. The link follows the selection.
- **API documentation** → `api/`

**Card 2: For AI agents**
- **llms.txt** → `llms.txt` (site root)
- **OpenAPI spec** → `api/v1/openapi.json`
- **Manifest** → `api/v1/index.json`
- **Risk ranking** → `api/v1/risk.json`
- A code block, monospace 13px with a [Copy] button. The ISO3 follows the selection:
  ```
  curl -s https://fertility-tracker-live.vercel.app/api/v1/countries/KOR.json
  ```
- **"Prompt for your agent"**: a block with a [Copy] button. Show it verbatim, with the absolute base URL:
  ```
  Use the Fertility Tracker open data (no key needed).
  Guide: https://fertility-tracker-live.vercel.app/llms.txt
  OpenAPI: https://fertility-tracker-live.vercel.app/api/v1/openapi.json
  Fetch api/v1/countries.json for every country's latest numbers and decline-risk tier, or
  api/v1/countries/{ISO3}.json for yearly 1950–2100 series (UN projection after the last recorded year).
  Question: <your question>
  Cite "Fertility Tracker (UN World Population Prospects, World Bank)" and the generatedAt date from index.json.
  ```
- **Copy feedback:** the button label changes to "Copied" for 1.5s. The live region says "Copied to clipboard".
- **Footer line** (13px muted): "Sources: {sources from index.json, linked, each with its license}. Code MIT. Last
  updated {generatedAt as 26 Oct 2026}, checked every Monday." Don't claim one license for all the data: the publishers
  differ (e.g. World Bank CC BY 4.0, UN WPP CC BY 3.0 IGO).
- **`<head>` tags for agents:**
  - `<link rel="service-desc" type="application/json" href="api/v1/openapi.json">` (RFC 8631)
  - `<link rel="alternate" type="application/json" href="api/v1/index.json" title="Fertility Tracker API manifest">`
  - `<link rel="alternate" type="text/plain" href="llms.txt" title="llms.txt">`
  - A JSON-LD `Dataset`: `name`, `description`, `license`, `creator`, `dateModified` = generatedAt, and a `distribution`
    entry for each of `countries.json`, `countries.csv` and `timeseries.csv`.
- **`<noscript>`:** "This map needs JavaScript. The data works without it:" followed by links to the CSVs, `api/` and
  `llms.txt`.

---

## 7. Feedback entry point

- **Placement:**
  1. A "Feedback" link in the top bar on desktop (a G8 jump to `#feedback`).
  2. The C9 link "Report a problem with {Country}'s numbers →".
  3. The `#feedback` section.
  4. A footer link.
- **Config:** every channel comes from **`public/feedback.json`**, which the ops agent owns. The weekly check reads the
  same file. The frontend fetches it once and hard-codes no address, template or handle. Templates live in
  `.github/ISSUE_TEMPLATE/` as issue forms: `feedback.yml`, `data-problem.yml` and `feature-request.yml`. Each one
  auto-applies its label.
- **`#feedback` section:**
  - Headline: "Spot something wrong? Want something added?"
  - Subhead: "Every message is read. A weekly check folds feedback into the next update."
  - Buttons: **[Give feedback on GitHub]** (primary, opens `github.chooserUrl` so the visitor picks General feedback,
    Data problem or Idea; the prefill parameters carry over) and **[Email us]** (secondary).
  - Under them, 13px muted: "GitHub issues are public; email stays private." Then the selectable `email.address` with a
    small [Copy] button.
- **C9 "Report a problem with {Country}'s numbers →"** goes straight to the `data-problem` template.
- **Building GitHub URLs** (at click time, from the current selection): take the template's `newIssueUrl` (or
  `chooserUrl`), then append `title`, plus only field ids listed in that template's `fields`. Example for the C9 link:
  ```
  https://github.com/RostyslavDzhohola/fertility-tracker/issues/new?template=data-problem.yml
    &title=[Data] South Korea: 
    &country=KOR
    &page=https://fertility-tracker-live.vercel.app/#KOR
  ```
  - Every value is `encodeURIComponent`'d. The title is the template's `titlePrefix` + country name + ": ".
  - **Never add `labels=`**: without triage rights it returns a 404 (per `feedback.json` → `github.prefill.rules`).
  - World: send `country=World`.
- **Mailto:** `mailto:{email.address}?subject={enc(email.subject + ": " + countryName)}&body={enc("Page: " + url + "\n\nWhat should we fix or add?\n")}`.
- **X handle:** use `x.handle` from `feedback.json`. While it's null or starts with `TODO_`, **no X follow link and no
  `twitter:site` tag render at all**. Don't leave an empty placeholder in the DOM. Swapping the handle in that file is
  the only change needed later.
- **If `feedback.json` fails to load:** show only the mailto button, using the address from the brief.

---

## 8. Copy

Style: plain words, sentence case, no exclamation marks.
- Say "births per woman" in the UI, never "TFR". The methodology introduces "total fertility rate (TFR)" once.
- Say "UN projection", not "medium variant". The methodology explains "medium variant".
- Never use "dying", "collapse", "doomed" or "extinction".
- Use the true minus sign (U+2212).

### 8.1 Titles and meta

- `<title>` default: **Fertility Tracker: which countries are shrinking, and how fast**
- `<title>` with a selection: **{Country}: {tfr} births per woman · Fertility Tracker**
- Meta description: "Live map of births per woman and population-decline risk for every country, with UN projections
  to 2100. Free JSON, CSV and API for people and AI agents."

### 8.2 Hero

- **H1** (static): **Most countries now have too few births to replace their population.**
- **Subhead** (live numbers): "{below} of {total} countries and territories are under 2.1 births per woman, the level
  that keeps a population steady."
- **Meta line** (13px muted): "World: {wld} births per woman · {criticalCount} places at critical risk · Updated {date},
  checked weekly"

### 8.3 Controls and section labels

| Element | Copy |
|---|---|
| Search placeholder | Search a country or territory |
| Toolbar | Decline risk · Births per woman · Globe |
| Legend caption (desktop) | Click a level to show only those places. |
| Ranking (risk / TFR mode) | Highest risk of shrinking / Lowest births per woman |
| Chips label | Highest risk: |
| Chips last item | All {N} → |
| Dialog title | All countries and territories |
| Readout row | {Country} · {Tier} · {tfr} [Details ↓] |
| Mini-bar | {Country} · {tfr} births per woman · {Tier} [↑ Map] |
| Skip link | Skip to {Country} details |
| Chooser title | Which place? |
| Data section | Use the data: free for people and AI agents |
| Feedback section | Spot something wrong? Want something added? |
| Methodology section | How this works |
| Load error | Couldn't load the latest data. [Try again] |
| Series error | Couldn't load {Country}'s history. [Try again] |

### 8.4 Map tooltip templates

```
■ South Korea
Critical decline risk · #1 of {N}
0.75 births per woman (2024)
Population 51.7M → 21.9M by 2100 (−58%)
Click for details                                  ← 12px muted
```

- An unranked place: line 2 reads "{Tier} decline risk · not ranked (under 100,000 people)" or "… · not ranked
  (incomplete data)" (§4.4). With no score at all: "Not scored (incomplete data)".
- No data: "Kosovo" / "No data in our sources".
- World isn't on the map.
- TFR mode uses the same content; the swatch shows the TFR bin color.

### 8.5 Country summary sentence (C1)

Rules: "far below" when tfr < 1.5, "below" when 1.5 ≤ tfr < 2.1.
- tfr < 2.1 and pct2100 < 0: "{Country} has {tfr} births per woman, {far below|below} the 2.1 needed to keep a
  population steady. The UN projects {pop2100} people by 2100, {abs pct}% fewer than today."
- tfr < 2.1 and pct2100 ≥ 0: "{Country} has {tfr} births per woman, below replacement, but immigration and a young
  population keep it growing for now. The UN projects {+pct}% by 2100."
- tfr ≥ 2.1: "{Country} has {tfr} births per woman, {close to|above} the 2.1 replacement level. The UN projects
  {pop2100} people by 2100 ({±pct}%)." Use "close to" if tfr < 2.4.
- World: "The world has {tfr} births per woman, just above the 2.1 replacement level. The UN projects the world
  population to peak at {peak} around {peakYear}."

### 8.6 Number formatting (`Intl.NumberFormat("en-US")`)

- Births per woman: always 2 decimals ("0.75", "2.10").
- Population:
  - Compact in tiles, tooltips, lists and labels: "51.7M", "820K", "8.22B".
  - In words in takeaways and summaries: "21.9 million".
- Yearly flows: 3 significant digits with a sign, "+231,000" and "−352,000". Exact below 1,000.
- Percentages: integer with a sign, "−58%". One decimal when |x| < 1.
- Per-1,000 rates: 1 decimal.
- Dates: "26 Oct 2026".

### 8.7 Methodology (`#methodology`): text to use verbatim

**What the colors mean.** The decline-risk score runs from 0 to 100. It shows how likely a country's population is to
shrink, based on five things: births per woman, the balance of births and deaths, how old the population is, whether
migration fills the gap, and the UN's projected change to 2050 and 2100. It measures population-decline risk only. It
is not a judgment of any country, its people, or their choices.
{tier table from risk.json, §4.1}
{component weights from risk.json → methodology.components, as a short list: label, weight in points, explain}

**Births per woman.** The average number of children a woman would have over her life at today's rates (demographers
call this the total fertility rate, TFR). About 2.1 keeps a population steady over time. The extra 0.1 covers children
who don't survive to adulthood.

**Recorded versus projected.** Solid lines are recorded estimates. Dashed lines in the shaded area are the UN World
Population Prospects medium projection: the UN's central forecast, not a certainty. Real outcomes can land above or
below it.

**Where growth comes from.** A population changes through births, deaths and net migration (people arriving minus
people leaving). "Born abroad, living here" and "born here, living abroad" count people, not yearly moves.

**The 100-people model.** Each generation is today's births per woman ÷ 2.1, about 30 years apart. It deliberately
ignores migration, longer lives and the age structure of today's population, so it shows the long-run pull of a birth
rate, not a forecast. The UN projection is the forecast.

**Small places.** Places with fewer than 100,000 people, or with missing inputs, get no rank. When they have enough data
they still get a score. A few births either way can swing a small place's numbers a lot from one year to the next.

**Sources and updates.** {Linked list from index.json: UN World Population Prospects; World Bank World Development
Indicators; UN DESA International Migrant Stock.} A check runs every Monday, and numbers change when a source
publishes new data. Feedback is folded in on the same schedule.

---

## 9. Tokens, type, spacing, states, motion

### 9.1 Color tokens (copy into `:root`)

```css
:root {
  color-scheme: dark;
  /* surfaces */
  --bg: #0B0E14;
  --surface-1: #11151D;      /* cards, tiles, panels */
  --surface-2: #171C26;      /* popovers, tooltip, inputs, mini-bar */
  --surface-3: #1F2531;      /* hover rows */
  --border: #252C39;
  --border-strong: #343D4E;
  /* text (contrast on --bg / --surface-1, measured) */
  --text: #EDEFF4;           /* 16.8 / 15.9 */
  --text-muted: #A3AABA;     /* 8.3 / 7.9 */
  --text-faint: #8A92A5;     /* 6.2 / 5.9: captions only */
  --link: #8EC5FF;           /* 10.7 / 10.1 */
  --accent: #FFCB52;         /* brand dot, primary button bg (text --bg = 12.8:1), slider */
  --accent-hover: #FFD677;
  --focus: #FFFFFF;
  --focus-halo: #0B0E14;
  /* decline-risk ramp */
  --risk-low: #2A3A5E;
  --risk-moderate: #5B4A94;
  --risk-elevated: #B4508C;
  --risk-high: #F2713F;
  --risk-critical: #FFCB52;
  /* births-per-woman ramp, low → high */
  --tfr-1: #FFCB52;  /* < 1.0 */
  --tfr-2: #F2713F;  /* 1.0–1.3 */
  --tfr-3: #B9563A;  /* 1.3–1.6 */
  --tfr-4: #7A4A34;  /* 1.6–2.1 */
  --tfr-5: #2C4C72;  /* 2.1–3.0 */
  --tfr-6: #3779B4;  /* 3.0–4.0 */
  --tfr-7: #73B7EA;  /* ≥ 4.0 */
  /* map */
  --map-border: #0B0E14;
  --map-nodata: #1A1F2A;
  --map-nodata-hatch: #2E3544;
  --map-select: #FFFFFF;
  --map-select-halo: #0B0E14;
  /* chart components (CVD-checked: min ΔE 10.9 across protan/deutan/tritan) */
  --c-births: #56B4E9;
  --c-deaths: #7C8498;
  --c-migration: #B5DE5A;
  --c-total: #EDEFF4;
  --people-alive: #F3EEE3;
  --people-gone: #5A6378;
  --grid: rgba(255,255,255,.07);
  --proj-zone: rgba(255,255,255,.035);
  --boundary: #4A5366;
}
```

Tier and bin colors are used **only** for map fills, swatches, chips, the meter, and the selected-row bar. They are
never used for text.

### 9.2 Typography

- **Font stacks:**
  - Sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
  - Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
  - No font file: system UI fonts are fast and good with tabular numbers, and a custom face doesn't earn its weight.
- `font-variant-numeric: tabular-nums` on KPIs, lists, tooltips, axes and counts.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `--fs-hero` | `clamp(22px, 2.4vw + 2px, 36px)` / 1.15 | 700 | H1 |
| `--fs-28` | 28px / 1.15 | 700 (name), 650 (KPI) | Country name (24px mobile), KPI values |
| `--fs-22` | 22px / 1.25 | 650 | Section headings (`#data`, `#feedback`, `#methodology`), generation counts |
| `--fs-18` | 18px / 1.3 | 600 | Chart takeaways (h3) |
| `--fs-16` | 16px / 1.5 | 400 | Body, inputs (always 16 for inputs) |
| `--fs-14` | 14px / 1.45 | 400/600 | List rows, secondary body, links row |
| `--fs-13` | 13px / 1.4 | 400 | Labels, captions, KPI subs |
| `--fs-12` | 12px / 1.35 | 400/600 | Axis text, legend counts, direct labels (600) |

Headings at 22px and above use `letter-spacing: -0.01em`.

### 9.3 Spacing, radius, elevation

- Spacing (4px base): `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32 · `--sp-7` 48 ·
  `--sp-8` 64.
- Block rhythm: 32px between country-view blocks, 64px between page sections.
- Radius: `--r-sm` 6 (swatches 3) · `--r-md` 10 (tiles, inputs, tooltip) · `--r-lg` 14 (cards, dialog) · `--r-pill`
  999.
- Shadow, popovers only: `0 8px 24px rgba(0,0,0,.45)`.
- Top bar: `background: rgba(11,14,20,.85); backdrop-filter: blur(8px)`, with a 1px `--border` bottom line.

### 9.4 Hit targets

- Touch: at least 44×44px for every primary control (chips, toolbar buttons, chooser rows, dialog rows, close button).
- Pointer: at least 24×24px (WCAG 2.2 AA).

### 9.5 Component states

The **focus-visible ring is the same everywhere**: `outline: 2px solid var(--focus); outline-offset: 2px; box-shadow: 0
0 0 4px var(--focus-halo)`. It reads on both the dark background and amber fills. Inset version for list rows:
`outline-offset: -2px`. Never remove an outline without replacing it.

| Component | Hover | Focus-visible | Selected / pressed | Disabled |
|---|---|---|---|---|
| Primary button (amber) | `--accent-hover` | ring | `translateY(1px)` while active | `--surface-3` bg, `--text-faint`, `cursor: not-allowed` |
| Secondary button | `--surface-3` bg | ring | — | as above |
| Segmented control / Globe toggle | `--surface-3` | ring | `--surface-3` bg, 1px inset `--border-strong`, `--text`; unpressed text `--text-muted` | — |
| Legend item | text → `--text` | ring | isolating: swatch gets a 2px white ring, other items 0.5 opacity | — |
| List row / chip | `--surface-3` | inset ring | `rgba(255,255,255,.08)` bg + 3px tier bar (row) or 1.5px white border (chip), weight 600 | — |
| Combobox option | `--surface-3` | — (focus stays in the input) | active descendant: `--surface-3` + 1px `--border-strong` outline | `aria-disabled`: `--text-faint` |
| Map country | white 1px outline clone | keyboard cursor = hover look + tooltip | halo + white outline + ring (§2.8) | no-data: no hover |
| Map dot | r + 1, white 1px stroke | as country | r 5, white 2px over a dark 4px halo + ring | — |
| Link | underline | ring | — | — |
| Slider | thumb grows to 22px | ring on the thumb | — | — |

### 9.6 Motion

| Token | Value | Used for |
|---|---|---|
| `--dur-fast` | 120ms | Hover color and stroke |
| `--dur-base` | 200ms | Crossfades (view toggle, charts, content), dot fills |
| `--dur-slow` | 320ms | Mini-bar enter, dialog open |
| globe turn | 750ms | Rotate to a selection (300ms for keyboard-cursor follow) |
| ring pulse | 700ms | Locator ring on a new selection |
| `--ease` | `cubic-bezier(.2,.7,.2,1)` | All CSS transitions; the globe uses easeInOutCubic |

Under `prefers-reduced-motion: reduce`:
- All transitions and animations take 0.01ms.
- The globe jumps instead of turning.
- No ring pulse, no mini-bar flash, no skeleton shimmer.
- Jump controls use `behavior: "auto"`.

Nothing auto-plays, and nothing loops.

### 9.7 Semantics

- `<html lang="en">`.
- Landmarks: `<header>` (top bar), `<main>`, `<footer>`.
- Headings: one `<h1>` (hero). An `<h2>` for the country name and for each page section; the map region gets a
  visually hidden `<h2>Map</h2>`. An `<h3>` for each country-view block.
- One shared polite live region (`#announcer`, visually hidden) for selection, copy and error messages. The search box
  keeps its own status region (§3.6).

---

## 10. Social card and sharing

### 10.1 The card (`public/og.png`, 1200×630)

**One static card for the whole site.** A `#KOR` URL can't carry its own meta tags, and X's crawler doesn't run
JavaScript. Per-country cards are out of scope for v2.

- **Background:** `#0B0E14`.
- **Left 64%:** the Equal Earth map colored by risk tier, the same rendering and palette as the site, with no labels.
- **Top-left:** the amber dot plus the wordmark "Fertility Tracker" (28px).
- **Headline** over the top of the map, 56px, weight 700, max 2 lines: **"Which countries are shrinking, and how
  fast"**.
- **Right panel**, `--surface-1`, radius 14:
  - Title "Highest decline risk" (26px muted).
  - The **live top 5**, 34px rows: rank · swatch · name · births per woman, e.g. "1 ■ South Korea 0.75".
- **Bottom strip:** the 5-swatch risk legend (Low → Critical, 22px labels) on the left. On the right, the URL
  `fertility-tracker-live.vercel.app` (24px muted).
- **Size rules:** no text under 22px. Keep everything inside x 60–1140, y 40–590, since X can crop slightly toward
  1.91:1.
- **Production:**
  - Build `public/og.html`, a fixed 1200×630 page that reuses the map renderer and `countries.json`.
  - Screenshot it with headless Chrome. Chrome is preinstalled on GitHub's Ubuntu runners, so the workflow can refresh
    it weekly after the data step:
    `google-chrome --headless=new --hide-scrollbars --window-size=1200,630 --virtual-time-budget=5000 --screenshot=public/og.png http://localhost:8080/og.html`.
  - Commit the PNG along with the data.
- **Meta tags:**
  - `og:title` = the default `<title>`.
  - `og:description` = "Live map of births per woman and population-decline risk for every country, with UN projections
    to 2100. Free data for people and AI agents."
  - `og:image` = `https://fertility-tracker-live.vercel.app/og.png`, with `og:image:width` 1200,
    `og:image:height` 630, and `og:image:alt` = "World map colored by population-decline risk, with the five
    highest-risk countries listed".
  - `twitter:card` = `summary_large_image`. No `twitter:site` until the handle exists.
- **Also:** `<meta name="theme-color" content="#0B0E14">`, and an inline SVG favicon (an amber `#FFCB52` dot).

### 10.2 Share button (C1)

- When `navigator.share` exists and the pointer is coarse: `navigator.share({ title, text, url })`.
- Otherwise: copy the URL, and the button shows "Link copied" for 1.5s, announced through the live region.

### 10.3 Post on X (C1)

- `https://x.com/intent/post?text={enc}&url={enc url with #ISO3}`.
- Text, under 250 characters: "{Country}: {tfr} births per woman. Start with 100 people → {g1} children → {g2}
  grandchildren. The UN projects a {abs pct}% population {drop|rise} by 2100."

---

## 11. Data the design reads (for the backend agent)

Checked against the backend's in-progress `scripts/lib/schema.mjs`, `build.mjs` and `risk.mjs`. Names in parentheses
are what that code uses today. The frontend takes the final names from `openapi.json`.

**From `countries.json`, per record (plus `WLD`):**
- iso3, name, region, `flags` (e.g. `small-population`), `ranked`
- population, tfr, medianAge and share65, each with its year (and source for tfr)
- `risk`:
  - score 0–100;
  - tier ∈ `Critical | High | Elevated | Moderate | Low | null`;
  - rank, or null;
  - factors[]: top 3 strings, plain English.
- `components`: year, births, deaths, naturalChange, netMigration, populationChange, `perThousand` rates,
  `migrationOffsetPct`
- `migrantStock`: year, immigrants, immigrantsPct, emigrants (may be null), emigrantsPct
- `projection`: population 2050 and 2100, change2050Pct, change2100Pct, peakYear, baseYear, basePopulation
- `generations`: ratio, halvingYears

**From `countries/{ISO3}.json`:**
- `series[]` 1950–2100 with `variant: "estimate" | "projection"`. The boundary is the last `estimate` year, so no
  separate field is needed.
- tfr, population, births, deaths, netMigration, populationChange.
- `risk.factors` (all of them), `migrationCorridors.topOrigins` and `topDestinations`, and `projection.peakPopulation`.

**From `risk.json`:** `ranking` (its length is {N}), `unranked`, and `methodology.tiers` (names, `min`, descriptions)
plus `methodology.components` for the methodology section.

**From `index.json`:** generatedAt and the sources list (name, url, license).

**From `public/feedback.json`** (ops agent): every feedback channel (§7).

**Requests to the backend** (the rest is already covered by the code above):
1. Ship `countries/WLD.json` with `series`. C8's world line and the World view use it.
2. Keep `risk.tier` values exactly as listed. The CSS classes key off them.

---

## 12. Acceptance checklist (frontend self-check and reviewer)

1. At 1280×800 and 390×844, selecting a country by search, map click, chooser, list, chip, dialog and `#hash` edit
   leaves `window.scrollY` unchanged. Check by logging scrollY before and after each one.
2. Loading `…/#JPN` opens on Japan without scrolling. Loading with no hash opens on the #1-ranked country and leaves
   the URL clean.
3. No DOM element has an `id` equal to any 3-letter country code in any case. No `scrollIntoView` appears in the code.
4. Swapping between the country with the longest name and the shortest (e.g. "Saint Vincent and the Grenadines" ↔
   "Chad") doesn't change `document.documentElement.scrollHeight` at ≥ 600px.
5. Singapore, Malta, Hong Kong, Macao, Barbados and Tuvalu can each be selected by tapping the map at 390px (direct or
   through the chooser), and through search.
6. At 390px, a tap near South Korea opens "Which place?" listing South Korea, North Korea and Japan.
7. A vertical swipe that starts on the map, flat or globe, scrolls the page and selects nothing.
8. The search combobox works by keyboard alone (ArrowDown, Enter, Escape, Tab behave as in §3.6), and screen readers
   announce the active option.
9. The map is one tab stop. Arrow keys move the cursor geographically, Enter selects, and a live region announces the
   cursor country.
10. Under reduced motion the globe jumps, nothing pulses, and nothing transitions.
11. The selected Critical (amber) country is clearly outlined: the dark halo plus white stroke is visible.
12. Legend isolation dims every other tier and leaves the selected country at full opacity.
13. Every chart shows the recorded/projection boundary with both labels, and dashed series after it.
14. The what-if slider changes only the 100-people block. "Reset" restores the country's rate.
15. The C9 link opens the `data-problem` form with `country` and `page` prefilled. The feedback-section button opens
    the template chooser with the same parameters. No URL contains `labels=`. Mailto opens with the subject and body
    filled. Every channel comes from `public/feedback.json`. No X link or `twitter:site` appears while `x.handle` starts
    with `TODO_`.
16. The data section's curl line and JSON link follow the selected country. Both Copy buttons work and announce
    "Copied".
17. With JavaScript off, the `<noscript>` block links the CSVs, `api/` and `llms.txt`.
18. Transfer for the first screen: the topology (39 KB gz), vendor JS, app JS and CSS stay ≤ 120 KB gzipped, excluding
    `countries.json`.
19. Every text color pair meets WCAG AA (4.5:1 for body text, 3:1 for ≥ 18px text and for meaningful graphics).
    Interactive targets are ≥ 44px on touch.
20. `og.png` exists at 1200×630 and lists the current top 5. The X card validator shows `summary_large_image`.

---

## Appendix A. `public/vendor/world-points.json`

Coordinates (lon, lat) for the 64 data places with no polygon in `countries-110m`. 55 are centroids of each place's
**largest** Natural Earth 50m polygon (computed with `d3.geoCentroid`, so multi-island and antimeridian places get a
sensible point). 9 are hand-entered because 50m lacks them: BES, GUF, GIB, GLP, MTQ, MYT, REU, TKL, TUV. GUF sits
inside France's 110m polygon, and its dot draws on top.

```json
{"ABW":[-69.98,12.52],"AIA":[-63.07,18.22],"AND":[1.56,42.54],"ASM":[-170.72,-14.3],"ATG":[-61.79,17.08],"BES":[-68.27,12.18],"BHR":[50.54,26.04],"BLM":[-62.84,17.9],"BMU":[-64.76,32.31],"BRB":[-59.56,13.18],"COK":[-159.79,-21.22],"COM":[43.34,-11.65],"CPV":[-23.64,15.08],"CUW":[-68.97,12.2],"CYM":[-81.29,19.32],"DMA":[-61.36,15.44],"FRO":[-6.88,62.17],"FSM":[158.23,6.89],"GGY":[-2.57,49.47],"GIB":[-5.35,36.14],"GLP":[-61.55,16.25],"GRD":[-61.68,12.12],"GUF":[-53.13,3.93],"GUM":[144.77,13.44],"HKG":[114.14,22.44],"IMN":[-4.54,54.22],"JEY":[-2.13,49.22],"KIR":[-157.37,1.85],"KNA":[-62.75,17.33],"LCA":[-60.97,13.89],"LIE":[9.54,47.14],"MAC":[113.51,22.22],"MAF":[-63.06,18.09],"MCO":[7.41,43.75],"MDV":[73.5,4.2],"MHL":[171.19,7.11],"MLT":[14.44,35.89],"MNP":[145.74,15.18],"MSR":[-62.19,16.74],"MTQ":[-61.02,14.64],"MUS":[57.57,-20.28],"MYT":[45.15,-12.83],"NIU":[-169.87,-19.05],"NRU":[166.93,-0.52],"PLW":[134.58,7.51],"PYF":[-149.42,-17.66],"REU":[55.54,-21.12],"SGP":[103.82,1.36],"SHN":[-5.72,-15.96],"SMR":[12.46,43.94],"SPM":[-56.33,46.94],"STP":[6.61,0.24],"SXM":[-63.06,18.05],"SYC":[55.48,-4.66],"TCA":[-71.74,21.81],"TKL":[-171.85,-9.17],"TON":[-175.22,-21.17],"TUV":[179.19,-8.52],"VAT":[12.43,41.9],"VCT":[-61.2,13.25],"VGB":[-64.62,18.42],"VIR":[-64.77,17.74],"WLF":[-178.13,-14.29],"WSM":[-172.44,-13.63]}
```

If the backend adds places that are in neither 110m nor this table (e.g. `XKX` has a 110m polygon, so it's fine), the
frontend logs a console warning and the place stays reachable through search and the list.

---

## Implementation deviations

Notes from the frontend build (October 2026). Each one is the smallest change that kept a rule of this spec working with
the real data; everything else is implemented as written.

1. **Map files.** The world outline is vendored unmodified at `public/geo/countries-110m.json` (world-atlas 2.0.2) and
   the dots at `public/geo/world-points.json` (Appendix A), not a preprocessed `public/vendor/world-110m.json`. The
   browser does the join: `isoNumeric` → ISO3, then a name fallback (Kosovo → XKX, Somaliland → SOM, N. Cyprus → CYP;
   features sharing a code are merged with `topojson.merge`), and drops Antarctica and the French Southern Lands. No
   build step and no preprocessing script to keep in sync.
2. **Reserved heights (§5.1) are taller**, measured from the real copy, so every block keeps a constant height:
   C1 252 / 344, C2 232 (tiles 112px: the subs need two lines; tablet 132), C3 352 / 452, C5a 252 / 276,
   C6 456 / 590, C7 612 / 672, C9 64 / 92. The C1 summary reserves 4 lines (5 on mobile): real summaries reach
   172 characters. C6 and C7 takeaways reserve 3 lines (4 on mobile): they reach 143 characters. Every text region
   inside a block has a fixed height and is clamped, so swapping countries cannot change the document height.
3. **C1 buttons.** [Share] and [Post on X] sit on their own row under the summary; the meta row (tier chip + rank) is
   one line at ≥ 600px with the rank text ellipsized if needed. This keeps C1's height constant.
4. **C3 heading** reads "Why {Country} is rated {Tier} for decline risk", to honour §4.1's first-mention rule.
5. **C5a with zero net migration** (the World): "Births outnumber deaths: {total} people in {year}." Template 1 would
   claim more people arrive than leave.
6. **C5b crossing year** comes from the API's `projection.naturalDeclineSince` instead of being recomputed from the
   series (a recompute flags South Korea's 1950–52 war years).
7. **C8 labels.** The country line gets an end label with its 2100 value; "Replacement 2.1" sits inside the plot at
   the right end above the dotted line, which saves right-margin width on phones.
8. **C7 dots** are 10px at ≥ 600px (5 rows × 10px + 4 × 3px gaps fit the 64px row; 11px would need 67px) and 8px with
   2px gaps below 600px (so label + grid + count fit 358px). The what-if slider's max rises above 4 when a country's
   rate is higher (Niger 6.03), so the thumb starts on the real rate. Counts of 1,000 or more use thousands separators.
   At a rate within 0.5% of 2.1 the takeaway reads "each generation is about the same size".
9. **Large flows** of a million or more are written in words ("+70.5 million") instead of "+70,500,000".
10. **Births-per-woman mode ranking** numbers ranked places by list position (1, 2, 3 …). Risk mode shows the API's
    `risk.rank` as-is everywhere.
11. **Legend "No data"** renders only when at least one map place lacks data. Today every polygon and dot joins.
12. **Globe size on tablets** is min(column width, 600px). A full-width globe at 1000px would fill the screen.
13. **Chooser on mobile** docks just below the map frame at full width. Six 44px rows would not fit over a 171px map.
14. **Hero H1** uses `clamp(26px, 2.4vw, 36px)` at ≥ 1100px; 28px was cut off between 1100 and 1180px.
15. **Jump links** (`#data`, `#feedback`, `#methodology`, skip link, "Details ↓", "↑ Map") scroll with JS and keep
    `#ISO3` in the URL. Incoming links to `#feedback` (from the issue forms) still work natively.
16. **Dialog focus** lands in the filter box on fine pointers and on the selected row on touch (no on-screen keyboard).
17. **Keyboard tooltip hint** reads "Press Enter to select" instead of "Click for details".
18. **X handle.** While `x.handle` starts with `TODO_` nothing X-related renders. Once a real handle is set, the page
    adds the follow links at runtime; add `<meta name="twitter:site" content="@handle">` to `index.html` by hand then,
    because crawlers don't run JavaScript.
19. **Social card.** `public/og.html` + `public/js/og.js` render the card from live data; `scripts/og/render-og.mjs`
    (zero dependencies: local server + headless Chrome) writes `public/og.png`. The deploy workflow is ops-owned and
    not changed: to refresh the card weekly, run `node scripts/og/render-og.mjs` after the data step and commit
    `public/og.png` with the data.
20. **Extras.** `public/404.html` redirects `/KOR` (and the old GitHub Pages form `/fertility-tracker/KOR`) to `/#KOR`.
    `public/js/package.json` (`"type": "module"`) lets Node import `logic.js` for `test/frontend/`.
21. **Review fixes (PR #2).** `html` has no `scroll-padding-top`: Chrome applied it when revealing the caret of the
    sticky search input and scrolled the page 53px per keystroke. Anchor targets use `scroll-margin-top` instead, and
    the search box also undoes any window scroll that happens while typing. Every projected % names its baseline
    ("−58% vs 2023", "51.7M in 2023 → 21.8M in 2100"; the ranking column reads "2023→2100"), using
    `projection.baseYear`/`basePopulation`. Below-replacement growth is described from the latest births, deaths and
    net migration (momentum first; immigration only when positive and at least a quarter of the growth), never inferred
    from the projection. On touch, migration-partner rows are 44px, so C6 reserves 516 / 710px there. Generation
    labels get 116px (104px on phones, where the dots shrink to 6–8px) and wrap only at spaces or hyphens.
22. **Headless-Chrome regression checks:** `FT_BROWSER_TESTS=1 node --test test/frontend/browser.test.mjs` types into
    search at depth, toggles Globe → Flat on a phone, retries a failed data load and checks caption overlap, touch
    targets, label wrapping and page-height stability. Skipped by default so CI and `node --test` stay browser-free.
