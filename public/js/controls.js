// The year slider, Play and the scenario switch (DESIGN-v3 §2 dock, §3 block 2). One instance on the globe dock and
// one on the country page; both drive the same shared state, so they always agree.

import { h, s, setText, setAttr } from "./dom.js";
import { state, data, subscribe, setYear, setScenario, togglePlay, yearInt } from "./store.js";
import { SCENARIO_LABELS, SCENARIO_SHORT, SCENARIO_HINTS } from "./logic.js";

const TICKS = [2030, 2050, 2075, 2100];

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
export function createTimeControls({ prefix, valueText = (y) => String(y), compact = false }) {
  const playBtn = h("button", { type: "button", class: "tc-play", "aria-label": "Play the years to 2100" }, ICONS.play());
  const yearNum = h("span", { class: "tc-year-num" }, String(yearInt()));
  const yearTag = h("span", { class: "tc-year-tag" }, "");
  const yearBox = h("div", { class: "tc-year", "aria-hidden": "true" }, yearNum, yearTag);
  const input = h("input", {
    type: "range",
    id: `${prefix}-year`,
    class: "tc-range hint",
    min: String(data.today),
    max: String(data.end),
    step: "1",
    value: String(yearInt()),
  });
  const ticks = h("div", { class: "tc-ticks", "aria-hidden": "true" });
  const slider = h("div", { class: "tc-slider" }, h("label", { class: "visually-hidden", for: `${prefix}-year` }, "Year"), input, ticks);
  const segs = ["medium", "constant"].map((sc) =>
    h("button", { type: "button", class: "seg", "data-s": sc, "aria-pressed": String(state.scenario === sc), title: SCENARIO_HINTS[sc] }, h("span", { class: "long" }, SCENARIO_LABELS[sc]), h("span", { class: "short", "aria-hidden": "true" }, SCENARIO_SHORT[sc])),
  );
  const scen = h("div", { class: "tc-scen segmented", role: "group", "aria-label": "Scenario" }, ...segs);
  const time = h("div", { class: "tc-time" }, playBtn, yearBox, slider);
  const root = h("div", { class: `tc${compact ? " tc-compact" : ""}` }, time, scen);

  function buildTicks() {
    const span = data.end - data.today || 1;
    ticks.replaceChildren(
      ...TICKS.filter((y) => y > data.today).map((y) => {
        const t = h("span", { class: "tc-tick" }, String(y));
        t.style.left = `${((y - data.today) / span) * 100}%`;
        if (y === data.end) t.classList.add("end");
        return t;
      }),
    );
  }

  let lastShown = null;
  function sync() {
    const y = yearInt();
    if (input.min !== String(data.today)) {
      input.min = String(data.today);
      input.max = String(data.end);
      buildTicks();
    }
    const span = data.end - data.today || 1;
    const p = ((state.year - data.today) / span) * 100;
    input.style.setProperty("--pf", String(Math.max(0, Math.min(100, p)) / 100));
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
      setAttr(playBtn, "aria-label", playing ? "Pause" : atEnd ? "Play again from today" : "Play the years to 2100");
    }
    for (const b of segs) setAttr(b, "aria-pressed", String(b.dataset.s === state.scenario));
    input.classList.toggle("hint", !state.touched);
  }

  input.addEventListener("input", () => setYear(Number(input.value), { animate: true }));
  playBtn.addEventListener("click", () => togglePlay());
  for (const b of segs) b.addEventListener("click", () => setScenario(b.dataset.s));

  buildTicks();
  sync();
  const off = subscribe((what) => {
    if (what === "year" || what === "play" || what === "scenario" || what === "data" || what === "touched") sync();
  });

  return { root, input, playBtn, sync, destroy: off };
}
