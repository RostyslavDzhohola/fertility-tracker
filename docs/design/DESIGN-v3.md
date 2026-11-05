# Fertility Tracker v3: globe-first redesign

For the frontend agent (builds it), the data agent (§7 is its contract), and the reviewers (§9 is the acceptance list).
This replaces `DESIGN.md` (v2) wherever they disagree. v2 still documents the API page, feedback rules and agent tags,
which carry over unchanged unless this file says otherwise.

## 0. What Ros said about v2 (2026-10-27), and the decision each point drives

| Ros, about v2 | v3 decision |
|---|---|
| "Make the map bigger so you can go full screen." "It has to be bigger, so it's full view." | The home page is the globe filling the whole viewport (100dvh, no page scroll). |
| "The default view should be the globe because the regular view is hard to see." | Globe is the default. The flat map stays as a secondary toggle. |
| "Right now I cannot zoom in." "When I find a place, like Taiwan, I need to be able to zoom in. The mouse should be able to zoom in and back and forth." | Wheel and trackpad zoom, pinch zoom, double-click zoom, + and − buttons. Zoom goes toward the pointer, up to 16×. |
| "When I try to scroll the globe, it catches me. If I click, I have to click again. Make it move around smoothly." | The first pointerdown starts the drag, and the point under the cursor stays under it (versor drag). Inertia on release, 60 fps on canvas, no click-to-activate step. |
| "It's too dark right now." | Light theme. |
| "I need some kind of slider that shows me the population because these colors are hard to understand." "Can I do projections, like if the current rate stays, and then the slider: what's going to happen?" | A big year slider (today → 2100) with Play, and a scenario switch: **UN forecast** or **If birth rates stay the same** (UN constant-fertility variant). Colors mean one thing: people compared with today. |
| "When the people die off, ... going gray." "When you slide, you see the population rising and increasing." | Shrinking countries fade toward gray; growing ones get greener. On the country page, 100 person icons turn gray one by one as the year moves. |
| "When you use the slider, especially when you scroll in, I want to see some kind of visual number." | Big live counters (world, plus the selected country). When zoomed in, labels on the globe show each country's number and % change for the slider year. |
| "I don't know which part is interactive. The interactive part has to be very bright and very easy to understand." | One vivid accent color is used **only** on things you can touch: slider thumb, buttons, search, selected outline. Big hit targets, and a pulsing hint on the slider until first use. |
| "Too much information on one page. ... The first page should be just the globe." | Separate pages: Globe (`/`), Country (`/country/TWN`), Rankings (`/rankings`), Data (`/api/`). |
| "Searching for a country or a territory is kind of hard." | Big search box at the top of every page, typo-tolerant, with aliases and ISO codes, covering all 237 places. |
| "Decline risk per woman, I don't understand." "Like a 5-year-old can understand ... what is the actual risk?" "Some of these charts ... I don't understand what's happening." | No 0–100 score on screen. Risk is a 5-step meter with plain words: **Very low, Low, Medium, High, Very high** (map to API tiers Low, Moderate, Elevated, High, Critical). Each visual has one sentence telling you what it shows. Everything else goes behind "More numbers". |
| "Less text, more visualization." | Each block is one visual plus at most one sentence. |

## 1. Look

- **Light theme.** Warm paper background (around `#F6F4EF`), white cards with soft shadows, text `#1F2328`, muted text
  `#5B6470`. Ocean is a pale blue with a subtle radial shade so the sphere reads as 3-D; the graticule is faint.
- **Interactive accent:** one vivid color used only on interactive things (a saturated blue such as `#2457FF`, or
  similar). It must not appear in the data ramp. Hover and focus get a visible ring, and every control is ≥ 44 px.
- **System font stack.** Big numbers are 40–64 px, tabular figures.
- **Data ramp, "people compared with today":** growing = greens (stronger = more growth); about the same = pale sand;
  shrinking = warm orange → red; **half or more gone = gray**, darkening as more is lost. No data = light hatched
  neutral. Legend in words: "More people", "About the same", "Fewer people", "Half gone". Check that it survives
  color-blind simulation, and that labels carry the meaning too.

## 2. Globe page `/`

Full-viewport canvas globe with these overlays (desktop):

- **Top bar** (transparent over the globe): small logo "Fertility Tracker" (home link); a big centered **search**; nav
  Globe · Rankings · Data. A small Feedback link may sit in the bar or a corner.
- **Bottom dock**, the main control: a **year slider** from today (current calendar year, clamped to the data) to 2100,
  with a **Play/Pause** button, a huge year label, and ticks at 2030 / 2050 / 2075 / 2100. Next to it, a **scenario
  switch** with two big segments: "UN forecast" and "If birth rates stay the same". Next to that, the **world counter**,
  e.g. "World in 2100 · 10.2 billion · +23%". Numbers animate (tween) when the year changes.
- **Legend**: one compact horizontal bar with the four words in §1, near the dock.
- **Zoom controls**: +, −, reset (re-centers, zoom 1) on the right edge; Globe/Flat toggle beside them.
- **"Most at risk"** button (bottom-left). It opens a small list of the top 10 by risk; clicking a row flies there.

Behaviour:

- **First visit:** the globe starts on the current year, then auto-plays to 2100 once (about 5 s), so you watch the
  colors change and see that the slider moves. Skip this when `prefers-reduced-motion` is set, when the URL has
  `?year=`, or on later visits (sessionStorage). Before the first interaction, a slow idle spin is allowed; it stops for
  good on any interaction.
- **Drag:** versor drag (the grabbed point stays under the cursor at every zoom), pointer capture, `touch-action: none`
  on the canvas, inertia after release. Movement under 5 px counts as a click; a click never needs a second click.
- **Zoom:** wheel and trackpad (ctrl+wheel = pinch), two-finger pinch on touch, double-click or double-tap, buttons,
  and keyboard + / −. Zoom toward the pointer, range 1×–16×, with a smooth eased animation for buttons and fly-to.
  Arrow keys rotate.
- **Rendering:** Canvas 2D at devicePixelRatio. Use the vendored 110m topology while moving, and lazy-load and vendor
  world-atlas `countries-50m.json` for when the globe is at rest or zoomed past about 2×, so Taiwan's coast looks right.
  Small places with no polygon (Singapore, Malta, Caribbean, Pacific) get dots, using the existing
  `geo/world-points.json`. Target 60 fps while dragging on a laptop.
- **Hover** (mouse): a tooltip with name, population in the slider year, and % vs today.
- **Labels when zoomed** (≥ about 2.5×): country name, population in the slider year, and % change, drawn on
  countries big enough on screen, with collision avoidance. This is the "visual number when you scroll in".
- **Select** (click, search, list): fly-to with an eased rotate and zoom to fit, a thick accent outline and a short
  pulse. Then the **country card** opens (desktop: a floating panel about 360 px wide on the right; mobile: a bottom
  sheet). The card holds:
  - the name and a risk-meter chip ("Risk of shrinking: Very high");
  - a big number for the slider year ("15.2 million in 2070 · −35%");
  - a row of 10 person icons that gray out, or gain green ones, as the year changes;
  - two short reasons ("0.87 babies per woman; 2.1 keeps a country the same size", "More deaths than births since
    2019");
  - a big accent button, "See Taiwan's story →", linking to `/country/TWN`.
  The card updates live as the slider moves. Esc or × closes it.
- **URL:** `/?year=2070&scenario=constant&focus=TWN` is shareable; use `history.replaceState` only, so the history
  isn't spammed.

Mobile (390 px): the globe stays full screen; search is in the top bar; the dock is a compact two-row bottom bar
(slider and Play; scenario and counter); the card is a bottom sheet that doesn't hide the slider; the zoom buttons get
smaller. No horizontal overflow.

## 3. Country page `/country/{ISO3}`

The top bar is the same as the globe page. A vertical story; each block is one visual plus at most one sentence, with
generous space.

1. **Hero:** name, region, and a big plain verdict ("Taiwan is shrinking fast."). Under it, the **risk meter**: 5
   colored segments labeled Very low → Very high, with a marker on the country's level. Then one sentence: "For every
   100 people in Taiwan today, about 43 will be left in 2100 (UN forecast)."
2. **100 people:** a 10×10 grid of person icons. As the shared year slider moves, icons turn gray for each person lost;
   for growth, extra green icons appear in more rows, capped with a "+N more" note. It has the same slider, Play button
   and scenario switch as the globe, sharing state through the URL query. Big readout: "2070 · 15.2 million people ·
   −35%".
3. **Population chart, 1950–2100:** big. Past is a solid line, "UN forecast" one future line, "If birth rates stay the
   same" a second, clearly labeled at the line ends (no legend lookup). A vertical marker follows the slider year, and
   hover or tap scrubs it. Annotate the peak. Y-axis in plain units (millions).
4. **Why it's happening:** three tiles, each a picture first:
   - **Babies per woman:** for example, 0.87 filled baby icons next to 2.1 outlined ones; "2.1 keeps a country the
     same size".
   - **Born vs died each year:** two big bars with numbers ("132,000 born · 205,000 died").
   - **Moving in vs out:** in and out arrows with the net ("33,000 more leave than arrive").
5. **Generations:** "100 people → 41 children → 17 grandchildren → 7 great-grandchildren" as shrinking dot groups. The
   existing what-if slider ("What if babies per woman were…") may stay here, styled as a bright interactive control.
6. **More numbers** (collapsed `<details>`): the full stats, risk factors in plain words, migrant stock and top
   origins and destinations, data links for this country (JSON/CSV/API), Share / Post on X, and the feedback links
   prefilled with the country. The 0–100 score may appear here only, labeled "Risk score (0–100, how it works →)".

Small places (under 100k, unranked) show "Not ranked: too few people for a fair score" in place of the meter.

## 4. Rankings page `/rankings`

Title: "Where populations will shrink most". Tabs: **Shrinking most by 2100** (default, sorted by % change),
**Highest risk** (risk score order, showing the meter word, not the number), **Fewest babies** (TFR). The scenario
switch changes the % column. Region filter chips. Each row has the rank, name, risk chip, a horizontal bar of % change
by 2100 (zero axis in the middle; red to the left, green to the right) with the number, and babies per woman. The
whole row is a link to `/country/{ISO3}`. The top 3 may be larger cards. Unranked small places are listed at the end,
under a heading.

## 5. Data page `/api/`

Keep the content, restyle it to the light theme, and use the same top bar. Add `scenarios.json` (§7) to the list.

## 6. Routing, links and URLs

- Clean paths are files: the deploy builds `public/country/<ISO3>/index.html` for every place and
  `public/rankings/index.html` from `index.html` (`scripts/pages/build-pages.mjs`), each with its own title,
  description, canonical link and link-preview card (`/og/<ISO3>.jpg`, `scripts/og/render-cards.mjs`). X and other
  link previews don't run JavaScript, so a link to `/country/TWN` previews Taiwan. Unknown codes have no file and get a
  real 404. Asset and API URLs are root-absolute (`/js/…`, `/api/v1/…`).
- Backward compatibility: `/#KOR` → `/country/KOR` (replaceState on load); `/KOR` → `/country/KOR` is a server
  redirect in `vercel.json` (the list of codes must match the places; `test/frontend/site.test.mjs` checks it), and
  404.html sends lower-case and old forms (`/kor`, `/country/twn`, `/fertility-tracker/KOR`) on without ever looping.
  `pageUrl(iso3)` (Share, OG, feedback context) now returns `https://fertility-tracker-live.vercel.app/country/KOR`.
- The Back button works between pages (pushState for page changes; replaceState for year, scenario and focus tweaks).
- The `<head>` keeps the agent-facing tags (`service-desc`, `llms.txt`, JSON-LD) on every route; the title updates per
  page.

## 7. Data contract: `public/api/v1/scenarios.json` (data agent owns it)

```json
{
  "apiVersion": "v1",
  "generatedAt": "…", "source": { … UN WPP 2024 TotalPopulationBySex, URL, vintage … },
  "unit": "people", "startYear": 2024, "endYear": 2100,
  "scenarios": {
    "medium":   { "label": "UN forecast", "unVariant": "Medium", "description": "…" },
    "constant": { "label": "If birth rates stay the same", "unVariant": "Constant fertility", "description": "…" }
  },
  "places": { "TWN": { "medium": [ …77 ints… ], "constant": [ …77 ints… ] }, "WLD": { … }, … }
}
```

Index = year − startYear. Integers are people, covering all 238 records including `WLD`; `null` means missing. The data
agent may add metadata fields, but must not rename or remove these. A provisional copy built from the UN file is
already in place, so the frontend can build against it now.

"Today" in the UI is the current calendar year; its value comes from the medium array (the estimates end in 2023). The
past (1950–2023) for the country chart comes from `countries/{ISO3}.json` `series`.

## 8. Non-functional

- No framework and no CDN; vendored d3-geo, d3-array and topojson only. Don't add new runtime dependencies beyond the
  vendored world-atlas 50m file.
- First globe paint: under 600 KB of compressed JS, CSS and data before the lazy 50m file and per-country JSON.
- Accessibility: keyboard for every control; the globe takes arrows, + / − and Enter on the focused canvas to open the
  centered country. The slider is a native `<input type=range>` with an aria-valuetext like "2070, world 9.9 billion".
  There is an `aria-live` region for the selection, honour for `prefers-reduced-motion`, and visible focus rings.
- Keep the v2 guardrails that still apply: every `.focus()` passes `preventScroll: true` and nothing uses
  `scrollIntoView`. Country ids are never element ids.

## 9. Acceptance (reviewers check these)

1. The home page is a full-viewport globe at 1440×900 and 390×844, with no page scroll or horizontal overflow.
2. The first drag rotates immediately; a click without movement selects the country; there is no "click twice".
3. Wheel and pinch zoom work toward the pointer; Taiwan is clearly visible and clickable at max zoom with 50m detail.
4. Moving the slider and pressing Play change the globe colors, the world counter and the selected card in real time;
   the scenario switch changes them too.
5. Zoomed-in labels show the population and % for the slider year.
6. Search finds "taiwan", "taiwn", "korea", "south korea", "uk", "ivory coast", "hong kong", "macau", "czech",
   "türkiye/turkey" and ISO codes; selecting a result flies the globe there.
7. A 5-year-old test: every visible block has one sentence that says what it means; the risk shows as words and a
   meter, never as an unexplained number.
8. `/country/TWN`, `/rankings`, `/api/`, `/#KOR`, `/KOR` and the Back button all work; deep links survive a reload on
   Vercel.
9. Light theme throughout; interactive things are the only things in the accent color.
10. All node tests pass. The browser tests are updated and extended for 2–6 and 8.

## 10. As built (frontend, 2026-10-28; fix round 1 the same day)

What shipped, and where it differs from §§1–8 on purpose. Screenshots and the browser tests (`test/frontend/browser.test.mjs`)
are the reference for reviewers. There is a test for each of §9 items 1–6 and 8, and for each fix-round item B1–B4, S1–S3,
S5, S7 and S8.

### One word scale (replaces the risk words of §0 and §3)

The reviewers found the API risk tiers contradicting the numbers next to them: Brazil said "Risk of shrinking: Low" next
to −24%. Every word and meter on screen now describes **where a place is headed by 2100 under the selected scenario,
compared with today**. They use five words, and the globe legend uses the same five words and colors:

| Word | % change, today → 2100 (as displayed, rounded like the number beside it) | Color |
|---|---|---|
| Growing | more than +5% | ramp at +40% (teal) |
| About the same | −5% to +5% | sand |
| Shrinking | below −5% to above −25% | ramp at −15% (orange) |
| Shrinking fast | −25% to above −50% | ramp at −37% (red) |
| Half gone | −50% or less | ramp at −70% (gray) |

The word appears on the card chip ("By 2100: Shrinking fast"), in search rows, on rankings rows, and in the country
meter ("By 2100: Half gone −56% vs today") and verdict. Each re-words when the scenario changes. Places under 100,000
people get "Very small population" and no verdict word. The composite 0–100 score and the API tier appear only under
"More numbers", as "Risk score (0–100), how it works →", with a note that it compares with 2023. Rankings has two tabs,
"Shrinking most by 2100" and "Fewest babies". The globe's "Shrinking most" list shows the top 10 by % change in 2100 under
the current scenario, sorted by the number it shows.

### Modules (`public/js/`)

| File | Role |
|---|---|
| `main.js` | Boot and routing: `pushState` for page changes, debounced `replaceState` for year, scenario and focus. Also link interception, the 110m fetch on the globe route only, and the `window.FT` debug handle for tests. |
| `store.js` | Data and shared state: slider year, scenario, the scenario blend (`mix`), Play, the first-visit intro, `touch()` (the first slider, Play or scenario touch hands control to the user) and the 2100 outlook helpers. |
| `globe.js` | Canvas globe and flat map: drag, inertia, zoom, fly-to, labels, dots, hit testing, and 110m/50m detail. |
| `home.js`, `country.js`, `rankings.js` | The three pages. `controls.js` (slider, Play, scenario, "Drag me" hint), `people.js` (person icons) and `ui.js` (the outlook chip) are shared. |
| `topbar.js`, `search.js` | The top bar on every page, including `/api/` (`apipage.js`). |
| `logic.js` | Pure functions, all under `test/frontend/logic.test.mjs`. |
| `og.js` | The social card (`og.html` → `og.png`). |
| `snapshot.js` | Share a picture: the 1600×900 picture of the view and its dialog (Post on X, Share, Copy, Download). |
| `cards.js` | Link-preview cards (`og-cards.html` → `og/<ISO3>.jpg`): the Share picture for every place, 1200×630. |

### Layout

- **Full view (B2).** The globe runs under the floating top bar and dock. On desktop its diameter is 94% of the
  viewport height, centered. On phones it is 124% of the width, centered between the top bar and the dock. The selected
  country is flown clear of the card.
- **Top bar (B3).** The search box flexes between the wordmark and the nav (`flex: 1`, at most 600 px). Below 1100 px the
  nav and Feedback fold into a menu button and the "/" hint hides. Tested at 700, 768, 820, 1000, 1024, 1180 and 1280 px.
- **Intro (B4).** It starts with the first painted frame and plays today → 2100 in 5.2 s. Any slider, Play or scenario
  touch stops it at once. Afterwards the thumb pulses and a "Drag me" bubble sits on it until the first touch.

### Rendering and speed

- Canvas 2D at up to 2× DPR. Shapes wholly on the front hemisphere are projected directly from precomputed unit vectors,
  a 3×3 multiply per point. Polygon fills that cross the horizon are pinned to the rim, and lines are too once the rim is
  off screen. d3-geo clips only what is left: shapes that reach the far side of the globe. Each polygon is culled against
  the visible cap.
- 110m outlines while moving below 2×. 50m at rest, and while moving at 2× or more, unless the device is touch-first or
  50m frames run over 14 ms; then 110m whenever the globe moves (adaptive). Coastlines are stroked at rest only.
- The 50m file is prepared in idle slices of about 8 ms. At rest, the detailed frame is also built in idle slices while
  the coarse one stays on screen, so the switch never blocks a frame. Measured in headless Chrome after load: one long
  task at boot (about 50–75 ms), none after. Max draw about 20 ms.
- Drag draw time, headless Chrome at 2× DPR: about 4 ms at 1×, 8 ms at 3× over Europe and 5 ms at 8×. At 4× CPU
  throttle it is 14–16 ms (adaptive 110m), against 52 ms before the fix.
- First paint is 312 KB gzipped (budget 600). The 50m file adds 224 KB and loads when the page is idle.

### Deliberate deviations

1. **North stays up while dragging**, and the view center never passes ±72° latitude. Fly-to stays within ±60°, so there
   are no polar views and no inertia pinned on a pole. The grabbed point stays exactly under the pointer except at the
   clamp.
2. **"Today" is the current year's UN figure for every %**, on every page, including "More numbers". So Taiwan reads
   "about 44 of 100 left in 2100", not the 43 in the §3 example. Measured figures keep their own year labels. The only
   thing measured from 2023 is the risk score, and its note says so.
3. **Ranking bars use the people ramp**, so 50% or more lost is gray on the rankings exactly as on the globe.
4. **No "Which place?" chooser** (v2 §2.9). Zoom to 16×, an 18 px touch radius on dots, and search replace it.
5. **Fly-to stops at 7×**, so neighbours stay in view. Wheel, pinch and the buttons still reach 16×.
6. **+ and − zoom toward something.** They head for the selected country, else land at the center, else the nearest
   land. Never into empty ocean.
7. **Uninhabited areas** (Antarctica, French Southern Lands, Heard, South Georgia, BIOT) are plain light land and can't
   be clicked. Åland is part of Finland.
8. **Feedback** in the top bar is a small popover. The country-prefilled "Report a problem" link lives in "More numbers".
9. **Moving in vs out** labels its two arrows with the UN migrant stock: people alive today who moved in, and who moved
   away. Below them, the yearly net in words. No global source publishes yearly arrivals and departures separately.
10. **Partial figures fill from the bottom.** A whole figure filled to its share, not a clipped half figure: in the card,
    the 100 people, and babies per woman (0.87 is 87% of one figure).
11. **Rankings** shows the top 25, then a "Show all" button. Small places sit in a folded section.
12. **Phones** use the short labels "Rates stay the same" and "if rates stay the same", and the card sheet shows one
    reason.

### Color check (§1)

Growth leans teal and decline warm, so the two separate on the blue–yellow axis that survives red–green color blindness.
Machado 2009 simulation, ΔE in OKLab ×100, smallest difference between the legend colors at −65%, −25%, 0 and +40%: normal
14.4, protan 9.8, deutan 10.8, tritan 16.3. All are above v2's bar of 8. The remaining risk: mid-growth teal (+45–55%)
and the lightest "half gone" gray share a lightness, so under protan and deutan they differ only slightly (ΔE 1–2). The
printed % carries that case: on zoomed labels, the tooltip, the card, search rows and rankings. The accent `#2457FF` is
never a data color (enforced in `logic.test.mjs`), and a CSS test checks that every rule painting with it is interactive.

## Round 4 (user review, 29 October 2026)

What changed, and why (the user's words in quotes):

- **The past.** "Can we do before 2026 … all the way back … we have data from the 1950s." The slider runs 1950–2100,
  with "Today" marked between the UN's estimates and its forecast. `scenarios.json` carries the UN's estimates as
  `estimate` (1950–2023), shared by both futures. Play from the end starts again at 2000 ("let's play this out from the
  2000s"), and the first-visit intro plays 2000 → 2100.
- **Globe colors are the trend in the slider year, not the change since today.** "The beginning stage shouldn't be just
  gray … the color should show the risk and the current state on the current date, like increasing or decreasing."
  Each place is colored by its average yearly change over the 5 years up to the slider year (`logic.js` `trendAt`,
  `TREND_RAMP`). Looking back, not ahead: Ukraine in 2026 shows the war years, not the UN's assumed 2025 return. Bands,
  as displayed (one decimal): Growing above +0.1% a year, About the same −0.1 to +0.1, Shrinking −0.1 to above −0.8,
  Shrinking fast −0.8 or less. Legend caption: the years compared, "Change 2021–26, forecast". The tooltip says "Shrinking 0.4% a year" and keeps
  "% vs today" on a second line.
- **No gray "Half gone".** "Remove the half gone. Red will just mean it's super red." Both scales (the globe's trend and
  the 2100 outlook in chips, meter, verdicts, rankings and link cards) have four words; red only deepens, to `#5E120E`.
  The outlook's Shrinking fast is −25% or less; from −50% the verdict still says "loses half its people or more".
- **Labels: the number only.** "Remove percentages … just focus on the number." Room is measured for the widest number
  ("88.8M"), not the digits on screen, so labels don't blink while Play changes them; where the name doesn't fit
  between neighbours (Belarus at 2085), the number alone is drawn.
- **The chart moves the year only on press and drag.** Hovering while Play runs did change the year. Now a pointer
  passing over does nothing; press and drag (or tap) scrubs, past years included.
- **"Immigration".** "Instead of moving in versus out, just change everything to immigration." The tile shows people
  born abroad living here and born here living abroad (mid-2024, everyone alive who ever moved: "not one year's
  arrivals", which "Arrived 52.4 million" wrongly suggested), then net migration each year 1990–2100: dark bars counted,
  light bars the UN's forecast, so its assumption is visible. "Born, died, moved" became "Births, deaths, immigration",
  with births and deaths (and their difference) apart from immigration.
- **Where each number comes from.** "When I click on it, there is no pop-up, nothing for me to validate." Every number
  on the country page is a button (dotted underline, an "i") that opens a card: what it counts, the year, counted or
  forecast, the publisher's file, and the same number in our API (field named). Migration rows open their source, with
  a link to the other country's page, instead of navigating away. Where newer or independent counts differ a lot, an
  "Other sources" note says so with links (`crosscheck.js`; evidence in [DATA-CROSS-CHECK.md](../DATA-CROSS-CHECK.md)).
- **Post on X shares the picture.** "It shares the link instead of … the screenshot." The country page's bottom button
  opens the same picture dialog as "Share a picture" (copy the picture, open the post; phones share the file).
- **Email is a plain mail link.** "Just pop up the mail tool, and that's it." The Gmail / Outlook / copy chooser is gone.
