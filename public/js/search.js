// Search combobox, ARIA 1.2 with list autocomplete. Typo-tolerant (logic.searchPlaces), every place plus the world.

import { h, setAttr, media, focusNoScroll, keepInView } from "./dom.js";
import { searchPlaces, matchRange, fmtPct, outlookStep, outlookColor, OUTLOOK, isSmallPlace } from "./logic.js";

// getPct(iso3) → % change from today to 2100 under the selected scenario: the row's word, swatch and number all say
// the same thing (null on pages without the forecast data: the row then shows the region).
export function createSearch({ wrap, input, list, clearBtn, status, getPlaces, getRecord, getPct, topPlaces, onSelect }) {
  let options = []; // [{ iso3, el }]
  let active = -1;
  let open = false;

  function optionEl(rec, q) {
    const small = rec.iso3 !== "WLD" && isSmallPlace(rec);
    const pct = small ? null : getPct(rec.iso3);
    const step = outlookStep(pct);
    const sw = h("span", { class: "swatch", "aria-hidden": "true" });
    if (step >= 0) sw.style.setProperty("--sw", outlookColor(step));
    else sw.setAttribute("data-nodata", "");
    const name = h("span", { class: "opt-name" });
    const r = q ? matchRange(rec.name, q) : null;
    if (r) name.append(rec.name.slice(0, r[0]), h("b", null, rec.name.slice(r[0], r[1])), rec.name.slice(r[1]));
    else name.textContent = rec.name;
    const sub = small ? "Very small population" : step >= 0 ? `${OUTLOOK[step].label} by 2100` : rec.iso3 === "WLD" ? "Whole world" : rec.region ?? "";
    return h(
      "li",
      { role: "option", id: `opt-${rec.iso3.toLowerCase()}`, "aria-selected": "false", "data-iso3": rec.iso3 },
      sw,
      h("span", { class: "opt-text" }, name, h("span", { class: "opt-sub" }, sub)),
      h("span", { class: "opt-pct", "aria-hidden": "true" }, pct == null ? "" : fmtPct(pct)),
    );
  }

  function render() {
    const q = input.value;
    options = [];
    active = -1;
    setAttr(input, "aria-activedescendant", "");
    const nodes = [];
    if (!q.trim()) {
      const top = topPlaces(5);
      const g1 = h("li", { role: "group", "aria-label": "Shrinking most by 2100" });
      const ul1 = h("ul", { role: "presentation" });
      g1.append(h("div", { class: "group-label", "aria-hidden": "true" }, "Shrinking most by 2100"), ul1);
      for (const rec of top) {
        const el = optionEl(rec, "");
        ul1.append(el);
        options.push({ iso3: rec.iso3, el });
      }
      nodes.push(g1);
      const w = getRecord("WLD");
      if (w) {
        const g2 = h("li", { role: "group", "aria-label": "World" });
        const ul2 = h("ul", { role: "presentation" });
        g2.append(h("div", { class: "group-label", "aria-hidden": "true" }, "Everyone"), ul2);
        const el = optionEl(w, "");
        ul2.append(el);
        options.push({ iso3: "WLD", el });
        nodes.push(g2);
      }
      status.textContent = `${options.length} suggestions`;
    } else {
      const hits = searchPlaces(getPlaces(), q, 8);
      for (const p of hits) {
        const rec = getRecord(p.iso3);
        if (!rec) continue;
        const el = optionEl(rec, q);
        nodes.push(el);
        options.push({ iso3: rec.iso3, el });
      }
      if (!options.length) {
        nodes.push(h("li", { role: "option", id: "opt-none", class: "opt-none", "aria-disabled": "true", "aria-selected": "false" }, "No match. Try a name like Korea, or a code like KOR."));
        status.textContent = "No matches";
      } else status.textContent = `${options.length} result${options.length === 1 ? "" : "s"}`;
    }
    list.replaceChildren(...nodes);
  }

  function show() {
    render();
    list.hidden = false;
    open = true;
    input.setAttribute("aria-expanded", "true");
    wrap.classList.add("open");
  }

  function hide() {
    list.hidden = true;
    open = false;
    active = -1;
    input.setAttribute("aria-expanded", "false");
    setAttr(input, "aria-activedescendant", "");
    wrap.classList.remove("open");
  }

  function setActive(i) {
    if (!options.length) return;
    if (active >= 0) {
      options[active]?.el.classList.remove("active");
      options[active]?.el.setAttribute("aria-selected", "false");
    }
    active = ((i % options.length) + options.length) % options.length;
    const o = options[active];
    o.el.classList.add("active");
    o.el.setAttribute("aria-selected", "true");
    setAttr(input, "aria-activedescendant", o.el.id);
    keepInView(list, o.el, 4);
  }

  function choose(iso3) {
    const rec = getRecord(iso3);
    if (!rec) return;
    input.value = "";
    syncClear();
    hide();
    if (media.coarse()) input.blur();
    onSelect(iso3);
  }

  function syncClear() {
    const has = input.value.length > 0;
    clearBtn.hidden = !has;
    wrap.classList.toggle("has-text", has);
  }

  input.addEventListener("focus", () => {
    input.select();
    show();
  });
  input.addEventListener("blur", () => {
    // Let a click on an option land first (mousedown is prevented, so this is a real blur).
    setTimeout(() => {
      if (document.activeElement !== input) hide();
    }, 0);
  });
  input.addEventListener("input", () => {
    syncClear();
    show();
  });
  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          show();
          if (!e.altKey) setActive(0);
        } else if (!e.altKey) setActive(active + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) show();
        setActive(active < 0 ? options.length - 1 : active - 1);
        break;
      case "Enter":
        if (open && options.length) {
          e.preventDefault();
          choose(options[active >= 0 ? active : 0].iso3);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          hide();
        } else if (input.value) {
          e.preventDefault();
          input.value = "";
          syncClear();
        } else input.blur();
        break;
      case "Tab":
        hide();
        break;
      default:
    }
  });

  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li || li.getAttribute("aria-disabled") === "true") return;
    choose(li.dataset.iso3);
  });

  clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
  clearBtn.addEventListener("click", () => {
    input.value = "";
    syncClear();
    focusNoScroll(input);
    show();
  });

  // "/" focuses the search box unless the user is typing somewhere.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    focusNoScroll(input);
  });

  return {
    focusInput: () => focusNoScroll(input),
    refresh() {
      if (open) render();
    },
    close: hide,
  };
}
