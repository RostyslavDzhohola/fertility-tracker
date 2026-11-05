// What other primary sources say, where they differ a lot from the UN figure on screen or explain it. Each note sits
// next to the number it qualifies. Checked 29 October 2026; the evidence, with quotes, is in docs/DATA-CROSS-CHECK.md.
// Keys: today (people today, a UN forecast), net (moving in minus moving out each year), immigrants (born abroad).

const WPP_METHOD = "https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf";
const DESA_FACTS = "https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2025_intlmigstock_2024_key_facts_and_figures_advance-unedited.pdf";

export const CROSS_CHECKS = {
  UKR: {
    today: {
      text:
        "The UN's forecast assumed two thirds of Ukraine's refugees would be home by 2026. Newer counts don't show that: " +
        "4.36 million Ukrainians were under temporary protection in the EU in August 2026, more than in December 2024 " +
        "(4.19 million), and the UN refugee agency recorded about 350,000 refugee returns in 2024–2025.",
      links: [
        { label: "UN assumption (table II.3.B, p. 49)", href: WPP_METHOD },
        { label: "Eurostat: temporary protection", href: "https://ec.europa.eu/eurostat/databrowser/view/migr_asytpsm/default/table?lang=en" },
        { label: "UNHCR: refugees from Ukraine", href: "https://data.unhcr.org/en/documents/details/121051" },
        { label: "UNHCR: returns", href: "https://api.unhcr.org/population/v1/population/?year=2025&coo=UKR" },
      ],
    },
    net: {
      text:
        "The light bars for 2024 and 2025 are the UN's assumed return of two thirds of refugees (+2.85 million). Newer " +
        "counts don't show it: Ukrainians under temporary protection in the EU rose to 4.36 million by August 2026, and " +
        "the UN refugee agency recorded about 350,000 refugee returns in 2024–2025.",
      links: [
        { label: "UN assumption (table II.3.B, p. 49)", href: WPP_METHOD },
        { label: "Eurostat: temporary protection", href: "https://ec.europa.eu/eurostat/databrowser/view/migr_asytpsm/default/table?lang=en" },
        { label: "UNHCR: returns", href: "https://api.unhcr.org/population/v1/population/?year=2025&coo=UKR" },
      ],
    },
    immigrants: {
      text:
        "The UN didn't newly assess Ukraine for 2024: it carried forward its 2020 estimate. Ukraine's last census was in " +
        "2001, and the mix of birth countries matches it, scaled down.",
      links: [{ label: "UN key facts, p. 1", href: DESA_FACTS }],
    },
  },
  USA: {
    net: {
      text:
        "Newer US numbers are much lower than the UN's 2024 forecast (1.18 million for 2026): the Census Bureau counted " +
        "1.26 million for July 2024–June 2025 and expects about 321,000 for the year to July 2026; the Congressional " +
        "Budget Office projects 570,000 for 2026.",
      links: [
        { label: "Census Bureau, Jan 2026", href: "https://www.census.gov/newsroom/press-releases/2026/population-growth-slows.html" },
        { label: "CBO, Jan 2026", href: "https://www.cbo.gov/publication/61879" },
      ],
    },
    immigrants: {
      text:
        "Checks out: the Census Bureau's 2024 count is 50.2 million, plus 2.0 million born in Puerto Rico and the US " +
        "island areas, whom the UN counts as born abroad. Both include people without legal status.",
      links: [{ label: "Census Bureau: the foreign-born", href: "https://www.census.gov/topics/population/foreign-born/about.html" }],
    },
  },
  GBR: {
    immigrants: {
      text: "The UK's statistics office counts more: 13.1 million people born outside the UK in June 2024 (18.9%).",
      links: [
        {
          label: "ONS, May 2026",
          href: "https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/internationalmigration/bulletins/longterminternationalmigrationprovisional/yearendingdecember2025",
        },
      ],
    },
  },
};

export function crossCheck(iso3, key) {
  return CROSS_CHECKS[iso3]?.[key] ?? null;
}
