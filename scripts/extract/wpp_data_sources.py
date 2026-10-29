#!/usr/bin/env python3
"""Extract per-country data-source notes from "World Population Prospects 2024: Data Sources".

Dev-only. Writes scripts/data/wpp2024-data-sources.json, a committed input to the data pipeline.

    pip install pypdf
    python3 -P scripts/extract/wpp_data_sources.py                 # downloads the PDF
    python3 -P scripts/extract/wpp_data_sources.py --pdf local.pdf # or reads a local copy

Each country has an UPPERCASE heading (listed in the table of contents) followed by paragraphs labelled
Population:, Fertility:, Child Mortality:, Overall Mortality:, Adult Mortality: and Migration: (plus an optional
Note:). The paragraphs are kept verbatim, with whitespace normalized and pypdf's broken words repaired; every
repair is logged. A few structured fields are then read from the paragraphs.
"""

import argparse
import collections
import csv
import datetime
import gzip
import hashlib
import io
import json
import os
import re
import ssl
import sys
import unicodedata
import urllib.request

import pypdf

URL = "https://population.un.org/wpp/assets/Files/WPP2024_Data_Sources.pdf"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36"
)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "scripts", "data", "wpp2024-data-sources.json")
COUNTRIES = os.path.join(REPO, "public", "api", "v1", "countries.json")
WPP_CSV_URL = (
    "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/"
    "WPP2024_TotalPopulationBySex.csv.gz"
)

LABELS = {
    "Population": "population",
    "Fertility": "fertility",
    "Child Mortality": "childMortality",
    "Overall Mortality": "overallMortality",
    "Adult Mortality": "adultMortality",
    "Migration": "migration",
}
LABEL_RE = re.compile(r"^(Population|Fertility|Child Mortality|Overall Mortality|Adult Mortality|Migration|Note):\s*")
HEADER_RES = [
    re.compile(r"^World Population Prospects 2024, Data Sources\s*$"),
    re.compile(r"^(\d+) United Nations Department of Economic and Social Affairs/Population Division\s*$"),
    re.compile(r"^United Nations Department of Economic and Social Affairs/Population Division (\d+)\s*$"),
]
TOC_RE = re.compile(r"^(.+?)\s*\.{5,}\s*(\d+)\s*$")

def log(*args):
    print(*args, file=sys.stderr)


def ssl_context():
    """The python.org macOS build ships without a CA store; fall back to certifi or the system bundle."""
    ctx = ssl.create_default_context()
    if ctx.cert_store_stats()["x509_ca"] == 0:
        try:
            import certifi

            ctx.load_verify_locations(certifi.where())
        except ImportError:
            if os.path.exists("/etc/ssl/cert.pem"):
                ctx.load_verify_locations("/etc/ssl/cert.pem")
    return ctx


def fetch(url):
    # un.org's CDN blocks the default Python user agent.
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120, context=ssl_context()) as r:
        return r.read()


def fold(s):
    """Uppercase ASCII key for matching names: accents, punctuation and spaces dropped."""
    s = unicodedata.normalize("NFKD", s.replace("’", "'"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9]", "", s.upper())


# ---------------------------------------------------------------- page text


def header_match(line):
    return next((m for m in (r.match(line) for r in HEADER_RES) if m), None)


def read_pages(data):
    reader = pypdf.PdfReader(io.BytesIO(data))
    pages = []
    for i, page in enumerate(reader.pages):
        printed = None
        lines = []
        raw = (page.extract_text() or "").split("\n")
        i = 0
        while i < len(raw):
            line = raw[i].strip()
            # The running header is sometimes broken across two lines ("67 Un" / "ited Nations ...").
            m = header_match(line)
            if not m and i + 1 < len(raw) and header_match(line + raw[i + 1].strip()):
                m = header_match(line + raw[i + 1].strip())
                i += 1
            if m:
                if m.groups():
                    printed = int(m.group(1))
            elif line:
                lines.append(raw[i].rstrip())
            i += 1
        pages.append({"index": i + 1, "printed": printed, "lines": lines})
    return pages


def parse_toc(pages):
    toc = []
    for p in pages:
        for line in p["lines"]:
            m = TOC_RE.match(line.strip())
            if m:
                toc.append((m.group(1).strip(), int(m.group(2))))
    return toc


# ---------------------------------------------------------------- word repair


def join_lines(lines):
    """Join wrapped lines; a line ending in a hyphen continues the same word."""
    out = ""
    for line in lines:
        line = line.strip()
        if not out:
            out = line
        elif out.endswith("-"):
            out += line
        else:
            out += " " + line
    return out


def fix_hyphens(s):
    """pypdf puts a space on one side of a hyphen ("Under -five", "2010- 2011"); a hyphen spaced on one side only
    is never a dash in this document."""
    return re.sub(r"(?<=\w) +-(?=\w)|(?<=\w)- +(?=\w)", "-", s)


def normalize_ws(s):
    return re.sub(r"\s+", " ", s).strip()


WORD_RE = re.compile(r"(?<![^\W_])[A-Za-z]+(?![^\W_])")
WORD_PAIR_RE = re.compile(r"(?<![^\W_])([A-Za-z]+) ([A-Za-z]+)(?![^\W_])")


def word_pairs(t):
    """Every pair of adjacent whole words separated by one space, overlapping."""
    pos = 0
    while m := WORD_PAIR_RE.search(t, pos):
        yield m
        pos = m.start(2)


class Repairer:
    """Joins two adjacent fragments ("throug h", "o verall", "le vel") when the joined form appears elsewhere in the
    document as a whole word and one fragment never does (its only occurrences are inside such candidate pairs)."""

    def __init__(self, texts):
        self.words = collections.Counter(w.lower() for t in texts for w in WORD_RE.findall(t))
        self.in_pair = collections.Counter()
        for t in texts:
            for m in word_pairs(t):
                if self._joined_known(m.group(1), m.group(2)):
                    self.in_pair[m.group(1).lower()] += 1
                    self.in_pair[m.group(2).lower()] += 1
        self.log = collections.Counter()

    def _joined_known(self, a, b):
        return self.words[(a + b).lower()] > 0

    def _alone(self, w):
        return self.words[w.lower()] - self.in_pair[w.lower()]

    def joinable(self, a, b):
        return self._joined_known(a, b) and (self._alone(a) <= 0 or self._alone(b) <= 0)

    # Years split by a stray space ("1 975 WFS", "the 197 1 Census", "200 0, 2010") and "24/3 6", "P/ F".
    SPLIT_NUMBER_RE = re.compile(r"(?<![\w/])(?=\d{1,3} \d{1,3}\b)((?:19|20|1|2)\d{0,2}) (\d{1,3})(?=[ ,;)]|$)")

    def _numbers(self, t):
        def year(m):
            joined = m.group(1) + m.group(2)
            if len(joined) == 4 and 1900 <= int(joined) <= 2029:
                self.log[f"{m.group(0)} -> {joined}"] += 1
                return joined
            return m.group(0)

        t = self.SPLIT_NUMBER_RE.sub(year, t)
        for broken, fixed in (("24/3 6)", "24/36)"), ("P/ F", "P/F")):
            if broken in t:
                self.log[f"{broken} -> {fixed}"] += t.count(broken)
                t = t.replace(broken, fixed)
        return t

    def repair(self, t):
        t = self._numbers(t)
        pos = 0
        while m := WORD_PAIR_RE.search(t, pos):
            a, b = m.group(1), m.group(2)
            if self.joinable(a, b):
                self.log[f"{a} {b} -> {a}{b}"] += 1
                t = t[: m.start()] + a + b + t[m.end() :]
                pos = m.start()  # the joined word may pair with the next fragment
            else:
                pos = m.start(2)
        return t


# ---------------------------------------------------------------- sections


def split_sections(pages, toc):
    names = {fold(n): n for n, _ in toc}
    first_page = min(pg for _, pg in toc)
    body = [p for p in pages if p["printed"] is not None and p["printed"] >= first_page]
    sections = []
    cur = None
    for p in body:
        lines = p["lines"]
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            key = fold(line)
            # A heading may wrap onto a second line.
            if key not in names and i + 1 < len(lines) and fold(line + " " + lines[i + 1]) in names and line.isupper():
                key = fold(line + " " + lines[i + 1])
                i += 1
            if key in names and line.upper() == line and not LABEL_RE.match(line):
                cur = {"heading": names[key], "page": p["printed"], "lines": []}
                sections.append(cur)
            elif cur is not None:
                cur["lines"].append(line)
            i += 1
    return sections


def split_paragraphs(lines):
    paras = []
    for line in lines:
        m = LABEL_RE.match(line)
        if m:
            paras.append([m.group(1), [line[m.end() :]]])
        elif paras:
            paras[-1][1].append(line)
        else:
            paras.append([None, [line]])
    return [(label, join_lines(ls)) for label, ls in paras]


# ---------------------------------------------------------------- fields

YEAR = r"(?:19|20)\d\d"


def clauses(text):
    """Split "(a) ...; (b) ...; and with estimates of ..." into its lettered clauses."""
    parts = re.split(r"(?:^|[;:,]?\s+)\(([a-z])\)\s+", text)
    return [p.strip(" ;.") for p in parts[2::2]]


def population_clauses(text):
    cs = clauses(text)
    if not cs:  # Eritrea: "... of the only total population for 2000 Quick Population Count; and with ..."
        m = re.search(r"by age and sex of the (.*)$", text)
        cs = [m.group(1)] if m else []
    return [re.sub(r";?\s*and with estimates of the subsequent trends.*$", "", c).strip(" ;.") for c in cs]


YEARS_PREFIX = rf"((?:{YEAR}(?: ?[-–] ?(?:{YEAR}|\d\d))?)(?:, (?:{YEAR}(?: ?[-–] ?(?:{YEAR}|\d\d))?))*)"


def years_in(s):
    """Years in a list such as "1983-1985, 2014"; a range counts as its first year."""
    s = re.sub(rf"({YEAR}) ?[-–] ?(?:{YEAR}|\d\d)\b", r"\1", s)
    return [int(y) for y in re.findall(rf"\b{YEAR}\b", s)]


def year_groups(s):
    """ "1950, 1960 censuses and 2016 Mini-Census" -> [([1950, 1960], "censuses"), ([2016], "Mini-Census")]."""
    groups = []
    for piece in re.split(rf" and (?={YEAR})", s):
        m = re.match(rf"^{YEARS_PREFIX} (.+)$", piece)
        if not m:
            return None
        groups.append((years_in(m.group(1)), m.group(2)))
    return groups


# Counts that are named next to censuses but are not full censuses; they go to otherCounts.
OTHER_COUNT_RE = re.compile(r"Mini[- ]Census|By-Census|Microcensus|Census Update|HH Listing|Population Count|CBDE")
CENSUS_RE = re.compile(r"^(?:censuses|Census|Housing Census)$")


def population_fields(text):
    """Structured fields from the Population paragraph; returns (fields, clauses that fed no field)."""
    f = {
        "censuses": [],
        "totalOnlyCensuses": [],
        "registers": [],
        "registerThrough": None,
        "otherCounts": [],
        "officialEstimatesThrough": None,
        "internationalEstimatesThrough": None,
        "surveys": [],
    }
    unused = []
    if not text:
        return f, unused
    for c in population_clauses(text):
        lc = c.lower()
        if m := re.fullmatch(rf"official estimates through ({YEAR})", lc):
            f["officialEstimatesThrough"] = int(m.group(1))
        elif m := re.fullmatch(rf"international estimates (?:used|considered) up to ({YEAR})", lc):
            f["internationalEstimatesThrough"] = int(m.group(1))
        elif m := re.fullmatch(rf"population register through ({YEAR})", lc):
            f["registers"].append(int(m.group(1)))
            f["registerThrough"] = int(m.group(1))
        elif lc.startswith("adjusted for "):
            pass
        elif (m := re.fullmatch(r"(.+?) survey estimates", c)) and (groups := year_groups(m.group(1))):
            for years, name in groups:
                f["surveys"] += [{"name": name, "year": y} for y in years]
        elif groups := year_groups(re.sub(r"^only total population for ", "", c)):
            total_only = c.startswith("only total population for ")
            for years, kind in groups:
                if CENSUS_RE.match(kind):
                    f["censuses"] += years
                    if total_only:
                        f["totalOnlyCensuses"] += years
                elif OTHER_COUNT_RE.search(kind):
                    f["otherCounts"] += [{"name": kind, "year": y, "totalOnly": total_only} for y in years]
                else:
                    unused.append(c)
        else:
            unused.append(c)
    for k in ("censuses", "totalOnlyCensuses", "registers"):
        f[k] = sorted(set(f[k]))
    return f, unused


def fertility_fields(text):
    f = {"registeredBirthsThrough": None, "birthsAdjusted": False}
    if not text:
        return f
    m = re.search(rf"registered births\b[^;]*?\bthrough ({YEAR})", text)
    if m:
        f["registeredBirthsThrough"] = int(m.group(1))
    f["birthsAdjusted"] = bool(re.search(r"adjusted for under-registration|adjusted for under-reporting", text))
    return f


def mortality_fields(text):
    f = {"registeredDeathsThrough": None, "deathsAdjusted": False, "deathsAdjustment": None}
    if not text:
        return f
    m = re.search(rf"registered deaths by age and sex available through ({YEAR})", text)
    if m:
        f["registeredDeathsThrough"] = int(m.group(1))
    for c in clauses(text):
        lc = c.lower()
        if "adjust" not in lc:
            continue
        if re.search(r"infant|child|under-five|older ages|old ages|old-age", lc):
            continue
        if re.search(r"under-?registration|under-?reporting|underreporting|underregistration|completeness", lc):
            f["deathsAdjusted"] = True
            f["deathsAdjustment"] = c
            break
    return f


MIGRATION_CODES = [
    ("officialFlows", r"official (?:figures|statistics|data|estimates)[^;]*?migra|official[^;]*?flows"),
    ("flowEstimates", r"estimates of (?:international )?migrant flows"),
    ("destinationCensuses", r"foreign-born populations"),
    ("residual", r"differences? between (?:overall )?population growth and natural increase"),
    ("unhcr", r"unhcr"),
]


def migration_fields(text):
    f = {"migrationBasis": [], "migrationOther": []}
    if not text:
        return f
    for c in clauses(text) or [text]:
        hit = [code for code, rx in MIGRATION_CODES if re.search(rx, c, re.I)]
        if hit:
            f["migrationBasis"] += [h for h in hit if h not in f["migrationBasis"]]
        else:
            if "other" not in f["migrationBasis"]:
                f["migrationBasis"].append("other")
            f["migrationOther"].append(c)
    return f


# ---------------------------------------------------------------- names


def load_un_names(csv_path):
    if csv_path:
        raw = open(csv_path, "rb").read()
    else:
        log("downloading", WPP_CSV_URL)
        raw = fetch(WPP_CSV_URL)
    names = {}
    for row in csv.DictReader(io.StringIO(gzip.decompress(raw).decode("utf-8-sig"))):
        if row["ISO3_code"]:
            names[row["ISO3_code"]] = row["Location"]
    return names


def report(countries, places, unmatched):
    ours = {c["iso3"]: c["name"] for c in countries}
    missing = sorted(set(ours) - set(places))
    log(f"\ncoverage: {len(places)} of our {len(ours)} places; missing: {[f'{i} {ours[i]}' for i in missing]}")
    log(f"sections matching none of our places: {unmatched}")
    fields = [
        ("text.population", lambda r: r["text"]["population"]),
        ("text.fertility", lambda r: r["text"]["fertility"]),
        ("text.childMortality", lambda r: r["text"]["childMortality"]),
        ("text.overallMortality", lambda r: r["text"]["overallMortality"]),
        ("text.adultMortality", lambda r: r["text"]["adultMortality"]),
        ("text.migration", lambda r: r["text"]["migration"]),
        ("notes", lambda r: r.get("notes")),
        ("censuses", lambda r: r["censuses"]),
        ("totalOnlyCensuses", lambda r: r["totalOnlyCensuses"]),
        ("registers", lambda r: r["registers"]),
        ("otherCounts", lambda r: r["otherCounts"]),
        ("officialEstimatesThrough", lambda r: r["officialEstimatesThrough"]),
        ("internationalEstimatesThrough", lambda r: r["internationalEstimatesThrough"]),
        ("surveys", lambda r: r["surveys"]),
        ("registeredBirthsThrough", lambda r: r["registeredBirthsThrough"]),
        ("birthsAdjusted", lambda r: r["birthsAdjusted"]),
        ("registeredDeathsThrough", lambda r: r["registeredDeathsThrough"]),
        ("deathsAdjusted", lambda r: r["deathsAdjusted"]),
        ("migrationOther", lambda r: r.get("migrationOther")),
    ]
    log("places with each field:")
    for name, get in fields:
        log(f"  {sum(1 for r in places.values() if get(r)):4d}  {name}")
    for code in ("officialFlows", "flowEstimates", "destinationCensuses", "residual", "unhcr", "other"):
        log(f"  {sum(1 for r in places.values() if code in r['migrationBasis']):4d}  migrationBasis {code}")
    adj = collections.Counter(r["deathsAdjustment"] for r in places.values() if r["deathsAdjustment"])
    log(f"deathsAdjustment phrases: {dict(adj)}")
    log(f"no censuses: {[i + ' ' + r['unName'] for i, r in places.items() if not r['censuses']]}")
    log(f"empty Population paragraph: {[i for i, r in places.items() if not r['text']['population']]}")
    log(f"missing paragraphs: {[(i, k) for i, r in places.items() for k, v in r['text'].items() if not v]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pdf", help="local copy of the PDF (default: download from the UN)")
    ap.add_argument("--wpp-csv", help="local copy of WPP2024_TotalPopulationBySex.csv.gz (UN location names)")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    if args.pdf:
        data = open(args.pdf, "rb").read()
    else:
        log("downloading", URL)
        data = fetch(URL)

    pages = read_pages(data)
    toc = parse_toc(pages)
    sections = split_sections(pages, toc)
    log(f"{len(pages)} pages, {len(toc)} contents entries, {len(sections)} country sections")
    found = {s["heading"] for s in sections}
    for name, pg in toc:
        if name not in found:
            log("WARNING: no section for contents entry", name, pg)
    for s in sections:
        toc_page = dict(toc).get(s["heading"])
        if toc_page != s["page"]:
            log(f"WARNING: {s['heading']} on page {s['page']}, contents say {toc_page}")

    # Paragraphs, then word repair with a vocabulary built from the whole document.
    for s in sections:
        s["paras"] = [(lab, normalize_ws(fix_hyphens(t))) for lab, t in split_paragraphs(s["lines"])]
    doc_texts = [normalize_ws(fix_hyphens(join_lines(p["lines"]))) for p in pages]
    rep = Repairer(doc_texts)
    for s in sections:
        s["paras"] = [(lab, rep.repair(t)) for lab, t in s["paras"]]
    log(f"word repairs ({sum(rep.log.values())}):")
    for k, n in sorted(rep.log.items()):
        log(f"  {n:4d}  {k}")

    # Match headings to our places.
    countries = [c for c in json.load(open(COUNTRIES))["countries"] if c["iso3"] != "WLD"]
    un_names = load_un_names(args.wpp_csv)
    by_key = {fold(s["heading"]): s for s in sections}
    places, used = {}, set()
    unused_clauses = []
    for c in sorted(countries, key=lambda c: c["iso3"]):
        iso = c["iso3"]
        un = un_names.get(iso)
        cands = [un, c["name"]]  # every heading matches one of these after fold()
        s = next((by_key[fold(n)] for n in cands if n and fold(n) in by_key), None)
        if not s:
            log("NO SECTION for", iso, un or c["name"])
            continue
        used.add(s["heading"])
        text = {v: None for v in LABELS.values()}
        notes = []
        last = None
        for lab, t in s["paras"]:
            if lab in LABELS:
                key = LABELS[lab]
                if text[key] is not None:
                    log(f"WARNING: {iso} repeats {lab}")
                text[key] = t or None
                last = key
            elif lab == "Note":
                notes.append({"after": last, "text": t})
            else:
                log(f"WARNING: {iso} text before the first label: {t[:80]}")
        pf, unused = population_fields(text["population"])
        unused_clauses += [(iso, u) for u in unused]
        rec = {
            "unName": un or s["heading"].title(),
            "heading": s["heading"],
            "page": s["page"],
            "text": text,
            **({"notes": notes} if notes else {}),
            **pf,
            **fertility_fields(text["fertility"]),
            **mortality_fields(text["overallMortality"]),
            **migration_fields(text["migration"]),
        }
        if not rec["migrationOther"]:
            del rec["migrationOther"]
        places[iso] = rec

    unmatched = sorted(s["heading"] for s in sections if s["heading"] not in used)
    if unused_clauses:
        log("Population clauses not read into a field:")
        for iso, u in unused_clauses:
            log(f"  {iso}: {u}")

    out = {
        "source": {
            "title": "World Population Prospects 2024: Data Sources",
            "publisher": "United Nations, Department of Economic and Social Affairs, Population Division",
            "document": "UN DESA/POP/2024/DC/NO.11",
            "published": "2024-08",
            "url": URL,
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "extractedBy": "scripts/extract/wpp_data_sources.py",
            "extracted": datetime.date.today().isoformat(),
        },
        "places": places,
        "unmatched": unmatched,
        "repairs": dict(sorted(rep.log.items())),
    }
    report(countries, places, unmatched)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    log(f"wrote {args.out}: {len(places)} places, {len(unmatched)} unmatched sections {unmatched}")


if __name__ == "__main__":
    main()
