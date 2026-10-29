# PDF extraction scripts (dev only)

The UN publishes two per-country quality sources only as PDFs. These scripts turn them into JSON. Their outputs in
`scripts/data/` are committed inputs to the data pipeline: the pipeline reads the JSON and never runs these scripts or
parses a PDF itself.

| Script | Source | Output |
| --- | --- | --- |
| `wpp_data_sources.py` | [World Population Prospects 2024: Data Sources](https://population.un.org/wpp/assets/Files/WPP2024_Data_Sources.pdf) (UN DESA/POP/2024/DC/NO.11, August 2024) | `scripts/data/wpp2024-data-sources.json` |
| `unsd_pvsr.py` | UNSD [Population and Vital Statistics Report](https://unstats.un.org/unsd/demographic-social/products/vitstats/), Table 2 (population, latest census and estimates) and Table 3 (live births, deaths, infant deaths) | `scripts/data/unsd-pvsr.json` |

## Rerun

```sh
pip install pypdf
python3 -P scripts/extract/wpp_data_sources.py
python3 -P scripts/extract/unsd_pvsr.py
```

Each script downloads its PDF(s) by default, using a browser User-Agent because un.org's CDN blocks Python's. To use
local copies, pass `--pdf file.pdf` (WPP) or `--t2 seratab2.pdf --t3 seratab3.pdf` (UNSD). Both scripts read UN
location names from the WPP CSV `WPP2024_TotalPopulationBySex.csv.gz` (downloaded, about 17 MB, or pass
`--wpp-csv`) and our places from `public/api/v1/countries.json`. `unsd_pvsr.py` also reads `public/api/v1/scenarios.json`
and `public/api/v1/countries/*.json` for its checks. Use `-P`, not `-I`: `-I` also hides user-site packages such as
pypdf.

Both scripts print a report to stderr: coverage, unmatched names, every word repair (WPP) and every check result (UNSD).
Read it after a rerun.

## New editions

Each output records the sha256 and byte size of the PDF it came from (`source.sha256`, or
`source.tables["2"|"3"].sha256`). The pipeline and the weekly checks compare these with the live PDF; a different hash
means a new edition. Rerun the script, read its report and review the JSON diff before committing it.

## What each output holds

`wpp2024-data-sources.json`: per ISO3 code, the six labelled paragraphs (`text.population` … `text.migration`,
verbatim with whitespace normalized and pypdf's broken words repaired; `null` when the PDF has no such paragraph), any
`Note:` paragraphs, the printed page, and fields read from the paragraphs: census years (`totalOnlyCensuses` for
"only total population for …"), `registers` / `registerThrough` ("population register through YYYY"), `otherCounts`
(mini-censuses, microcensuses, by-censuses, census updates, household listings, population counts), official and
international estimates, surveys, registered births and deaths through a year, whether births or deaths were adjusted
for under-registration (`deathsAdjustment` holds the phrase; adjustments limited to infant and child deaths or to older
ages do not count), and `migrationBasis` codes. `repairs` lists every word repair with its count.

`unsd-pvsr.json`: per ISO3 code, the latest census (date, code, total, male, female), the mid-year estimate (2025, or
2024 where the PDF marks it ♦), and births, deaths and infant deaths (year, completeness code, number, rate), each with
its provisional flag and footnote numbers. `lessReliable` (Table 2) and `incompleteRegisters` (Table 3) record italic
figures, as the legends define them. `footnotes` holds each table's footnote texts, `codes` the legends, and `checks`
the validation against UN WPP figures. Real gaps between UNSD and WPP figures are kept, not corrected.
