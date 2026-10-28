// The Data page (/api/): the same top bar and search as the app. Choosing a place opens its story.

import { fetchJson, API } from "./store.js";
import { createTopbar } from "./topbar.js";

const state = { records: new Map(), places: [], feedback: null };

createTopbar({
  getPlaces: () => state.places,
  getRecord: (iso3) => state.records.get(iso3),
  getPct: () => null,
  topPlaces: (n) =>
    [...state.records.values()]
      .filter((r) => Number.isInteger(r.risk?.rank))
      .sort((a, b) => a.risk.rank - b.risk.rank)
      .slice(0, n),
  onSelect: (iso3) => location.assign(`/country/${iso3}`),
  getFeedback: () => state.feedback,
  siteUrl: () => "https://fertility-tracker-live.vercel.app/",
});

fetchJson(`${API}countries.json`)
  .then((d) => {
    state.records = new Map(d.countries.map((c) => [c.iso3, c]));
    state.places = d.countries.map((c) => ({ iso3: c.iso3, name: c.name, population: c.population?.value ?? 0 }));
  })
  .catch(() => {});
fetchJson("/feedback.json")
  .then((fb) => (state.feedback = fb))
  .catch(() => {});
