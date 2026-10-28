// Person icons that gray out as people are lost and gain green ones as the population grows (DESIGN-v3 §2 card,
// §3 block 2). Each icon is a CSS-masked <i> whose fill fraction is the --f custom property, so a 43.7% year shows
// 43 full icons and one 70% icon, and Play glides smoothly.

import { h, setText } from "./dom.js";
import { peopleIcons } from "./logic.js";

export function peopleRow(container, { per = 10, maxExtra = 10, extraLabel = (n) => `+${n} more` } = {}) {
  const base = [];
  const extra = [];
  const baseWrap = h("span", { class: "pp-base" });
  const extraWrap = h("span", { class: "pp-extra" });
  for (let i = 0; i < per; i++) {
    const icon = h("i", { class: "person" });
    base.push({ icon, f: -1 });
    baseWrap.append(icon);
  }
  for (let i = 0; i < maxExtra; i++) {
    const icon = h("i", { class: "person grow", hidden: true });
    extra.push({ icon, f: -1, shown: false });
    extraWrap.append(icon);
  }
  const more = h("span", { class: "pp-more", hidden: true });
  container.replaceChildren(baseWrap, extraWrap, more);

  function setF(item, f) {
    const v = Math.round(f * 100) / 100;
    if (item.f === v) return;
    item.f = v;
    item.icon.style.setProperty("--f", String(v));
  }

  return {
    update(ratio) {
      const { kept, extra: ex } = peopleIcons(ratio, per);
      for (let i = 0; i < per; i++) setF(base[i], Math.max(0, Math.min(1, kept - i)));
      for (let i = 0; i < maxExtra; i++) {
        const f = Math.max(0, Math.min(1, ex - i));
        const show = f > 0.02;
        if (show !== extra[i].shown) {
          extra[i].shown = show;
          extra[i].icon.hidden = !show;
        }
        if (show) setF(extra[i], f);
      }
      const over = Math.round(ex - maxExtra);
      more.hidden = over < 1;
      if (over >= 1) setText(more, extraLabel(over));
      container.classList.toggle("growing", ex > 0.02);
    },
  };
}
