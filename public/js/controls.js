// The year slider, Play and the scenario switch (DESIGN-v3 §2 dock, §3 block 2). One instance on the globe dock and
// one on the country page; both drive the same shared state, so they always agree.

import { h, s, setText, setAttr } from "./dom.js";
import { state, data, subscribe, setYear, setScenario, togglePlay, yearInt } from "./store.js";
import { SCENARIO_LABELS, SCENARIO_SHORT, SCENARIO_HINTS, REPLAY_FROM } from "./logic.js";

// Labelled years under the slider; "Today" sits between the past and the forecast.
const TICKS = [1950, 2000, 2050, 2100];

export const ICONS = {
  play: () => s("svg", { viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true", focusable: "false" }, s("path", { d: "M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z", fill: "currentColor" })),
  pause: () =>
    s(
      "svg",
      { viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true", focusable: "false" },
      s("rect", { x: 6.5, y: 5, width: 4, height: 14, rx: 1.2, fill: "currentColor" }),
      s("rect", { x: 13.5, y: 5, width: 4, height: 14, rx: 1.2, fill: "currentColor" }),
    ),
  replay: () =>
    s(
      "svg",
      { viewBox: "0 0 24 24", width: 22, height: 22, "aria-hidden": "true", focusable: "false" },
      s("path", { d: "M5 12a7 7 0 1 0 2.05-4.95", fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round" }),
      s("path", { d: "M4.2 4.5v4.3h4.3", fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    ),
};

// valueText(year) → the slider's aria-valuetext, e.g. "2070, world 9.9 billion".
// hint: show a "Drag me" bubble on the thumb until the first slider, Play or scenario touch (not while playing).
export function createTimeControls({ prefix, valueText = (y) => String(y), compact = false, hint = false }) {
  const playBtn = h("button", { type: "button", class: "tc-play", "aria-label": "Play the years to 2100" }, ICONS.play());
  const yearNum = h("span", { class: "tc-year-num" }, String(yearInt()));
  const yearTag = h("span", { class: "tc-year-tag" }, "");
  const yearBox = h("div", { class: "tc-year", "aria-hidden": "true" }, yearNum, yearTag);
  const input = h("input", {
    type: "range",
    id: `${prefix}-year`,
    class: "tc-range hint",
    min: String(data.first),
    max: String(data.end),
    step: "1",
    value: String(yearInt()),
  });
  const ticks = h("div", { class: "tc-ticks", "aria-hidden": "true" });
  const bubble = h("span", { class: "tc-bubble", "aria-hidden": "true", hidden: true }, "Drag me");
  const slider = h("div", { class: "tc-slider" }, h("label", { class: "visually-hidden", for: `${prefix}-year` }, "Year"), input, ticks, bubble);
  const segs = ["medium", "constant"].map((sc) =>
    h("button", { type: "button", class: "seg", "data-s": sc, "aria-pressed": String(state.scenario === sc), title: SCENARIO_HINTS[sc] }, h("span", { class: "long" }, SCENARIO_LABELS[sc]), h("span", { class: "short", "aria-hidden": "true" }, SCENARIO_SHORT[sc])),
  );
  const scen = h("div", { class: "tc-scen segmented", role: "group", "aria-label": "Scenario" }, ...segs);
  const time = h("div", { class: "tc-time" }, playBtn, yearBox, slider);
  const root = h("div", { class: `tc${compact ? " tc-compact" : ""}` }, time, scen);

  function buildTicks() {
    const span = data.end - data.first || 1;
    // Years too close to today give way to it (2020 or 2030 would collide with "Today").
    const years = TICKS.filter((y) => y >= data.first && y <= data.end && (y === data.first || y === data.end || Math.abs(y - data.today) >= 15));
    const marks = [...years, data.today].sort((a, b) => a - b);
    ticks.replaceChildren(
      ...marks.map((y) => {
        const isToday = y === data.today;
        const t = h("span", { class: `tc-tick${isToday ? " today" : y === data.first ? " start" : y === data.end ? " end" : " minor"}` }, isToday ? "Today" : String(y));
        t.style.left = `${((y - data.first) / span) * 100}%`;
        return t;
      }),
    );
    slider.style.setProperty("--today", String((data.today - data.first) / span));
  }

  let lastShown = null;
  function sync() {
    const y = yearInt();
    if (input.min !== String(data.first)) {
      input.min = String(data.first);
      input.max = String(data.end);
      buildTicks();
    }
    const span = data.end - data.first || 1;
    const p = ((state.year - data.first) / span) * 100;
    input.style.setProperty("--pf", String(Math.max(0, Math.min(100, p)) / 100));
    slider.style.setProperty("--pf", String(Math.max(0, Math.min(100, p)) / 100));
    if (document.activeElement !== input || state.playing) {
      if (input.value !== String(y)) input.value = String(y);
    }
    if (lastShown !== y) {
      lastShown = y;
      setText(yearNum, String(y));
      setText(yearTag, y === data.today ? "today" : "");
    }
    setAttr(input, "aria-valuetext", valueText(y));
    const playing = state.playing;
    playBtn.classList.toggle("playing", playing);
    const atEnd = !playing && y >= data.end;
    const icon = playing ? "pause" : atEnd ? "replay" : "play";
    if (playBtn.dataset.icon !== icon) {
      playBtn.dataset.icon = icon;
      playBtn.replaceChildren(ICONS[icon]());
      setAttr(playBtn, "aria-label", playing ? "Pause" : atEnd ? `Play again from ${Math.max(data.first, REPLAY_FROM)}` : "Play the years to 2100");
    }
    for (const b of segs) setAttr(b, "aria-pressed", String(b.dataset.s === state.scenario));
    // The thumb pulses, and the bubble says "Drag me", until the user takes over (never while the intro plays).
    const waiting = !state.touched && !state.playing;
    input.classList.toggle("hint", waiting);
    if (hint) bubble.hidden = !waiting;
  }

  // The thumb is the year: no glide while dragging, so the readout never trails the thumb.
  input.addEventListener("input", () => setYear(Number(input.value), { animate: false }));
  playBtn.addEventListener("click", () => togglePlay());
  for (const b of segs) b.addEventListener("click", () => setScenario(b.dataset.s));

  buildTicks();
  sync();
  const off = subscribe((what) => {
    if (what === "year" || what === "play" || what === "scenario" || what === "mix" || what === "data" || what === "touched" || what === "intro-end") sync();
  });

  return { root, input, playBtn, sync, destroy: off };
}
