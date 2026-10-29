#!/usr/bin/env python3
"""Extract Tables 2 and 3 of the UN Statistics Division's "Population and Vital Statistics Report".

Dev-only. Writes scripts/data/unsd-pvsr.json, a committed input to the data pipeline.

    pip install pypdf
    python3 -P scripts/extract/unsd_pvsr.py                       # downloads both PDFs
    python3 -P scripts/extract/unsd_pvsr.py --t2 t2.pdf --t3 t3.pdf

pypdf's plain text extraction drops the spaces (the PDFs draw them as kerning offsets in a font with no space glyph)
and glues superscript footnote numbers onto names and numbers ("37 513 1682"). So this script reads the content
stream itself: each text run's position, font and size, decoded through the font's ToUnicode map. Footnote markers
are the small (6 pt) runs; italic runs mean "less reliable" (Table 2) or "incomplete civil registers" (Table 3).
Cells are placed in columns by the header positions on each page.
"""

import argparse
import datetime
import gzip
import hashlib
import io
import csv
import json
import os
import re
import ssl
import sys
import unicodedata
import urllib.request

import pypdf
from pypdf.generic import ContentStream

PAGE = "https://unstats.un.org/unsd/demographic-social/products/vitstats/"
URLS = {"2": PAGE + "seratab2.pdf", "3": PAGE + "seratab3.pdf"}
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36"
)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "scripts", "data", "unsd-pvsr.json")
API = os.path.join(REPO, "public", "api", "v1")
WPP_CSV_URL = (
    "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/"
    "WPP2024_TotalPopulationBySex.csv.gz"
)

COLUMNS = {
    "2": ["censusDate", "censusCode", "censusTotal", "censusMale", "censusFemale", "estimateCode", "estimateTotal"],
    "3": [f"{e}{c}" for e in ("births", "deaths", "infantDeaths") for c in ("Year", "Code", "Number", "Rate")],
}
FIRST_HEADER = {"2": "Date", "3": "Year"}

# UNSD names (spaces and punctuation removed by fold()) that match neither the WPP Location nor our display name.
ALIASES = {
    "NAOERO": "NRU",  # Nauru's official name
    "REPUBLICOFSOUTHSUDAN": "SSD",
    "SAINTMARTINFRENCHPART": "MAF",
    "SINTMAARTENDUTCHPART": "SXM",
    "CHINAHONGKONGSAR": "HKG",
    "CHINAMACAOSAR": "MAC",
    "UNITEDSTATESVIRGINISLANDS": "VIR",
    "STATEOFPALESTINE": "PSE",
    "DEMOCRATICPEOPLESREPUBLICOFKOREA": "PRK",
    "UNITEDKINGDOMOFGREATBRITAINANDNORTHERNIRELAND": "GBR",
    "NETHERLANDSKINGDOMOFTHE": "NLD",
    "MICRONESIAFEDERATEDSTATESOF": "FSM",
}
# Not matched on purpose: "Saint Helena ex. dep." and its two dependencies are separate rows, while the WPP's
# Saint Helena (SHN) includes Ascension and Tristan da Cunha.

MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


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
    s = unicodedata.normalize("NFKD", s.replace("’", "'"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9]", "", s.upper())


# ---------------------------------------------------------------- PDF text runs


def parse_cmap(data):
    m = {}
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", data, re.S):
        for a, b in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            m[int(a, 16)] = bytes.fromhex(b.decode()).decode("utf-16-be")
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", data, re.S):
        for a, b, rest in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]+>)", block):
            a, b = int(a, 16), int(b, 16)
            if rest.startswith(b"["):
                for i, h in enumerate(re.findall(rb"<([0-9A-Fa-f]+)>", rest)):
                    m[a + i] = bytes.fromhex(h.decode()).decode("utf-16-be")
            else:
                start = int(rest[1:-1], 16)
                for i in range(b - a + 1):
                    m[a + i] = chr(start + i)
    return m


def cid_widths(desc):
    widths, w, i = {}, list(desc.get("/W", [])), 0
    while i < len(w):
        first = int(w[i])
        if isinstance(w[i + 1], list):
            for k, v in enumerate(w[i + 1]):
                widths[first + k] = float(v)
            i += 2
        else:
            for c in range(first, int(w[i + 1]) + 1):
                widths[c] = float(w[i + 2])
            i += 3
    return widths, float(desc.get("/DW", 1000))


def page_runs(reader, page):
    """Text runs (one per TJ) as dicts: x0, x1, y, size, italic, bold, text. A kerning offset of more than ~half a
    space becomes a space."""
    fonts = {}
    for name, f in page["/Resources"]["/Font"].items():
        f = f.get_object()
        if f["/Subtype"] != "/Type0" or f.get("/Encoding") != "/Identity-H":
            raise SystemExit(f"unexpected font {f['/BaseFont']} {f['/Subtype']} {f.get('/Encoding')}: format changed?")
        widths, dw = cid_widths(f["/DescendantFonts"][0].get_object())
        fonts[name] = (str(f["/BaseFont"]), parse_cmap(f["/ToUnicode"].get_object().get_data()), widths, dw)
    out = []
    stack, cm = [], (1, 0, 0, 1, 0, 0)
    font, size, tm = None, None, (1, 0, 0, 1, 0, 0)
    for operands, op in ContentStream(page.get_contents(), reader).operations:
        if op == b"q":
            stack.append(cm)
        elif op == b"Q":
            cm = stack.pop()
        elif op == b"cm":
            a, b, c, d, e, f = [float(x) for x in operands]
            A, B, C, D, E, F = cm
            cm = (a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F)
        elif op == b"Tf":
            font, size = str(operands[0]), float(operands[1])
        elif op == b"Tm":
            tm = tuple(float(x) for x in operands)
        elif op in (b"TJ", b"Tj"):
            base, cmap, widths, dw = fonts[font]
            text, adv = "", 0.0
            for el in operands[0] if op == b"TJ" else [operands[0]]:
                if hasattr(el, "original_bytes") or isinstance(el, (bytes, str)):
                    raw = el.original_bytes if hasattr(el, "original_bytes") else el
                    raw = raw.encode("latin-1") if isinstance(raw, str) else raw
                    for i in range(0, len(raw), 2):
                        code = int.from_bytes(raw[i : i + 2], "big")
                        text += cmap.get(code, "�")
                        adv += widths.get(code, dw)
                else:
                    adv -= float(el)
                    if float(el) <= -150:
                        text += " "
            x0 = cm[4] + tm[4] * cm[0]
            out.append(
                {
                    "x0": x0,
                    "x1": x0 + adv * size / 1000 * cm[0],
                    "y": cm[5] + tm[5] * cm[3],
                    "size": size,
                    "italic": "Italic" in base,
                    "bold": "Bold" in base,
                    "text": text.replace("\xa0", " ").strip(),
                }
            )
    return [r for r in out if r["text"]]


# ---------------------------------------------------------------- table rows


def is_sup(r):
    return r["size"] < 7


def group_rows(runs):
    """Main-size runs grouped by baseline; each superscript attaches to the run it follows on the same row."""
    rows = []
    for r in sorted((r for r in runs if not is_sup(r)), key=lambda r: (-r["y"], r["x0"])):
        if rows and abs(rows[-1]["y"] - r["y"]) < 1.5:
            rows[-1]["runs"].append(r)
        else:
            rows.append({"y": r["y"], "runs": [r]})
    for r in rows:
        for run in r["runs"]:
            run["sups"] = []
    for s in (r for r in runs if is_sup(r)):
        row = next((row for row in rows if 0 <= s["y"] - row["y"] <= 6), None)
        if not row:
            continue
        host = max((run for run in row["runs"] if run["x1"] <= s["x0"] + 1.5), key=lambda run: run["x1"], default=None)
        if host:
            host["sups"].append(s["text"])
    return rows


def center(r):
    return (r["x0"] + r["x1"]) / 2


def parse_marks(sups):
    """Superscript text such as "*♦122", "♦8,59" or "2,15" -> (provisional, refers2024, [notes])."""
    s = "".join(sups)
    notes = [int(n) for n in re.findall(r"\d+", s)]
    rest = re.sub(r"[\d,*♦\s]", "", s)
    if rest:
        raise ValueError(f"unexpected footnote marker {s!r}")
    return "*" in s, "♦" in s, notes


NUMBER_RE = re.compile(r"^\d{1,3}(?: \d{3})*$")


def parse_number(text):
    """(value, unclear). "..." is missing, "-" is zero; anything not in thousands groups is unclear."""
    if text in ("...", "…"):
        return None, False
    if text == "-":
        return 0, False
    if NUMBER_RE.match(text):
        return int(text.replace(" ", "")), False
    return None, True


def parse_date(text):
    """ "16 Apr 2008" -> "2008-04-16"; a range "6 Nov. - 15 Dec. 2019" -> its first day. Returns (iso, exact)."""
    t = text.replace(".", " ").replace("–", "-")
    years = re.findall(r"\b(?:19|20)\d\d\b", t)
    if not years:
        return None, False
    first = re.split(r"\s-\s|-(?=\s*\d)", t)[0]
    m = re.match(r"^\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s*((?:19|20)\d\d)?", first)
    if m and m.group(2).lower() in MONTHS:
        year = int(m.group(3) or years[-1])
        iso = datetime.date(year, MONTHS[m.group(2).lower()], int(m.group(1))).isoformat()
        exact = bool(re.fullmatch(r"\s*\d{1,2}\s+[A-Za-z]{3,4}\s+(?:19|20)\d\d\s*", t))
        return iso, exact
    return None, False


def read_table(data, table):
    reader = pypdf.PdfReader(io.BytesIO(data))
    meta = {"title": None, "lastUpdated": None}
    rows_out, legend_runs = [], []
    for page in reader.pages:
        runs = page_runs(reader, page)
        runs = [r for r in runs if r["y"] > 55]  # page numbers
        for r in runs:
            if r["bold"] and r["size"] >= 10 and not meta["title"]:
                meta["title"] = re.sub(r"^\d+\.\s*", "", r["text"])
            if m := re.match(r"Last updated (\d{1,2}) (\w+) (\d{4})", r["text"]):
                d = datetime.datetime.strptime(" ".join(m.groups()), "%d %B %Y").date()
                meta["lastUpdated"] = d.isoformat()
        if any(r["text"] == "NOTES" for r in runs):
            legend_runs += [(page, r) for r in runs]
            continue
        if legend_runs:  # notes continue onto the following pages
            legend_runs += [(page, r) for r in runs]
            continue
        rows = group_rows(runs)
        header = next((row for row in rows if any(r["text"] == FIRST_HEADER[table] for r in row["runs"])), None)
        if not header:
            raise SystemExit(f"Table {table}: no header row on a page; format changed?")
        cols = sorted((r for r in header["runs"] if center(r) > 150), key=center)
        names = COLUMNS[table]
        if len(cols) != len(names):
            raise SystemExit(f"Table {table}: {len(cols)} header columns, expected {len(names)}")
        centers = [center(c) for c in cols]
        name_x = min(r["x0"] for row in rows if row["y"] < header["y"] for r in row["runs"])
        for row in rows:
            if row["y"] >= header["y"] - 1:
                continue
            cells, name_runs = {}, []
            for r in row["runs"]:
                if abs(r["x0"] - name_x) < 2:
                    name_runs.append(r)
                    continue
                i = min(range(len(centers)), key=lambda k: abs(centers[k] - center(r)))
                if names[i] in cells:
                    raise SystemExit(f"Table {table}: two runs in {names[i]} at y={row['y']:.1f}: {r['text']!r}")
                cells[names[i]] = r
            rows_out.append({"name": " ".join(r["text"] for r in name_runs), "nameSups": sum((r["sups"] for r in name_runs), []), "cells": cells})
    return meta, rows_out, parse_legend(legend_runs)


CODE_LINE_RE = re.compile(r"^(SSDF|SSDJ|DF|DJ|C|U|\||\+|\.\.\.)\s+(.*)$")


def parse_legend(legend_runs):
    """NOTES pages: markers at the left margin, texts indented. Indented lines with no marker are either a code line
    ("DF      De facto") or the continuation of the text above."""
    codes, footnotes, last = {}, {}, None
    pages = []
    for page, r in legend_runs:
        if not pages or pages[-1][0] is not page:
            pages.append((page, []))
        pages[-1][1].append(r)
    for _, runs in pages:
        rows = group_rows(runs)
        left = min(r["x0"] for row in rows for r in row["runs"])
        for row in rows:
            rs = sorted(row["runs"], key=lambda r: r["x0"])
            if rs[0]["text"] == "NOTES" or rs[0]["text"].startswith("Last updated"):
                continue
            if abs(rs[0]["x0"] - left) < 2 and len(rs) > 1:
                marker, text = rs[0]["text"], " ".join(r["text"] for r in rs[1:])
                last = (footnotes if marker.isdigit() else codes, marker)
                last[0][marker] = text
                continue
            text = " ".join(r["text"] for r in rs)
            # Code lines follow the 'a "Code" indicates ...' line; anything else continues the text above.
            if last and last[0] is codes and (m := CODE_LINE_RE.match(text)):
                codes[m.group(1)] = m.group(2).strip()
                last = (codes, m.group(1))
            elif last:
                last[0][last[1]] += " " + text
    return codes, footnotes


# ---------------------------------------------------------------- places


def load_un_names(csv_path):
    raw = open(csv_path, "rb").read() if csv_path else fetch(WPP_CSV_URL)
    names = {}
    for row in csv.DictReader(io.StringIO(gzip.decompress(raw).decode("utf-8-sig"))):
        if row["ISO3_code"]:
            names[row["ISO3_code"]] = row["Location"]
    return names


REGION_RE = re.compile(r"^[A-Z][A-Z ,]+(?: \(cont\.\))?$")


def merge_names(rows):
    """A row with a name and no cells is a region heading (UPPERCASE) or the first line of a wrapped name."""
    out, pending, pending_sups = [], "", []
    for r in rows:
        if not r["cells"]:
            if REGION_RE.match(r["name"]):
                pending, pending_sups = "", []
            else:
                pending = (pending + " " + r["name"]).strip()
                pending_sups += r["nameSups"]
            continue
        r["name"] = (pending + " " + r["name"]).strip()
        r["nameSups"] = pending_sups + r["nameSups"]
        pending, pending_sups = "", []
        out.append(r)
    return out


def num_cell(cell, rate=False):
    """(value, unclear, raw text) for a number cell; None when the cell is absent."""
    if cell is None:
        return None, False, None
    t = cell["text"]
    if rate:
        if t in ("...", "…"):
            return None, False, t
        if re.fullmatch(r"\d*\.\d", t):
            return float(t), False, t
        return None, True, t
    v, unclear = parse_number(t)
    return v, unclear, t


def marks(cells):
    prov, y2024, notes = False, False, []
    for c in cells:
        if c is None:
            continue
        p, d, n = parse_marks(c["sups"])
        prov, y2024 = prov or p, y2024 or d
        notes += [x for x in n if x not in notes]
    return prov, y2024, notes


def census_record(cells):
    c = {k: cells.get("census" + k) for k in ("Date", "Code", "Total", "Male", "Female")}
    if not c["Date"] or c["Date"]["text"] == "...":
        return None
    date, exact = parse_date(c["Date"]["text"])
    total, unclear, raw = num_cell(c["Total"])
    male, _, _ = num_cell(c["Male"])
    female, _, _ = num_cell(c["Female"])
    prov, _, notes = marks(c.values())
    rec = {"date": date}
    if not exact:
        rec["dateText"] = c["Date"]["text"]
    rec.update(
        {
            "code": c["Code"]["text"] if c["Code"] else None,
            "total": total,
            "male": male,
            "female": female,
            "provisional": prov,
            "notes": notes,
        }
    )
    if unclear:
        rec.update({"numberUnclear": True, "totalText": raw})
    return rec


def estimate_record(cells):
    code, tot = cells.get("estimateCode"), cells.get("estimateTotal")
    total, unclear, raw = num_cell(tot)
    if total is None and not unclear:
        return None
    prov, y2024, notes = marks([code, tot])
    rec = {
        "year": 2024 if y2024 else 2025,
        "code": code["text"] if code else None,
        "total": total,
        "provisional": prov,
        "lessReliable": bool(tot and tot["italic"]),
        "notes": notes,
    }
    if unclear:
        rec.update({"numberUnclear": True, "totalText": raw})
    return rec


def event_record(cells, event):
    year, code, number, rate = (cells.get(event + k) for k in ("Year", "Code", "Number", "Rate"))
    if not year or not re.fullmatch(r"(?:19|20)\d\d", year["text"]):
        return None
    codetext = code["text"] if code else None
    value, unclear, raw = num_cell(number)
    r, _, _ = num_cell(rate, rate=True)
    prov, _, notes = marks([year, code, number, rate])
    rec = {
        "year": int(year["text"]),
        "code": codetext.replace("+", "") if codetext and codetext != "..." else None,
        "byRegistration": bool(codetext and "+" in codetext),
        "number": value,
        "rate": r,
        "provisional": prov,
        "incompleteRegisters": bool(number and number["italic"]),
        "notes": notes,
    }
    if unclear:
        rec.update({"numberUnclear": True, "numberText": raw})
    return rec


# ---------------------------------------------------------------- checks


def wpp_population(scenarios, iso, year):
    p = scenarios["places"].get(iso)
    if not p:
        return None
    if 1950 <= year <= 2023:
        return p["estimate"][year - 1950]
    if 2024 <= year <= 2100:
        return p["medium"][year - 2024]
    return None


def pct(a, b):
    return round((a - b) / b * 100, 1)


def run_checks(places, scenarios):
    checks = {}
    # 1. Census total vs male + female.
    sums = []
    for iso, p in places.items():
        c = p.get("census")
        if c and c["total"] and c["male"] is not None and c["female"] is not None:
            sums.append((iso, c["total"], c["male"] + c["female"]))
    bad = [(i, t, s, pct(s, t)) for i, t, s in sums if abs(s - t) / t > 0.01]
    checks["censusSexSum"] = {"checked": len(sums), "over1pct": [{"iso3": i, "total": t, "malePlusFemale": s, "diffPct": d} for i, t, s, d in bad]}

    # 2. Census and estimate totals vs the UN WPP 1 July population of the same year.
    for kind in ("census", "estimate"):
        checked, far = 0, []
        for iso, p in places.items():
            r = p.get(kind)
            if not r or not r.get("total"):
                continue
            year = int(r["date"][:4]) if kind == "census" else r["year"]
            un = wpp_population(scenarios, iso, year)
            if not un:
                continue
            checked += 1
            if abs(r["total"] - un) / un > 0.10:
                far.append({"iso3": iso, "year": year, "unsd": r["total"], "wpp": un, "diffPct": pct(r["total"], un)})
        checks[f"{kind}VsWpp"] = {"checked": checked, "over10pct": sorted(far, key=lambda x: -abs(x["diffPct"]))}

    # 3. Births and deaths vs the UN WPP series.
    for kind in ("births", "deaths"):
        checked, far = 0, []
        for iso, p in places.items():
            r = p.get(kind)
            if not r or r.get("number") is None:
                continue
            path = os.path.join(API, "countries", f"{iso}.json")
            if not os.path.exists(path):
                continue
            row = next((s for s in json.load(open(path))["series"] if s["year"] == r["year"]), None)
            if not row or not row.get(kind):
                continue
            checked += 1
            if abs(r["number"] - row[kind]) / row[kind] > 0.15:
                far.append({"iso3": iso, "year": r["year"], "code": r["code"], "unsd": r["number"], "wpp": row[kind], "diffPct": pct(r["number"], row[kind])})
        checks[f"{kind}VsWpp"] = {"checked": checked, "over15pct": sorted(far, key=lambda x: -abs(x["diffPct"]))}
    return checks


def rate_check(rec, pop):
    """A number should agree with rate x population / 1000. A reading off by 5x or more means a footnote digit was read
    into the number (or the number was misread): drop it rather than guess."""
    if not rec or rec["number"] is None or rec["rate"] is None or not pop:
        return None
    implied = rec["rate"] * pop / 1000
    ratio = rec["number"] / implied if implied else None
    if ratio is not None and not 0.2 <= ratio <= 5:
        rec["numberText"] = str(rec["number"])
        rec["number"] = None
        rec["numberUnclear"] = True
    return ratio


# ---------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--t2", help="local copy of Table 2 (seratab2.pdf)")
    ap.add_argument("--t3", help="local copy of Table 3 (seratab3.pdf)")
    ap.add_argument("--wpp-csv", help="local copy of WPP2024_TotalPopulationBySex.csv.gz (UN location names)")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    data = {}
    for t, path in (("2", args.t2), ("3", args.t3)):
        if path:
            data[t] = open(path, "rb").read()
        else:
            log("downloading", URLS[t])
            data[t] = fetch(URLS[t])

    countries = [c for c in json.load(open(os.path.join(API, "countries.json")))["countries"] if c["iso3"] != "WLD"]
    ours = {c["iso3"] for c in countries}
    un_names = load_un_names(args.wpp_csv)
    index = {}
    for c in countries:
        index[fold(c["name"])] = c["iso3"]
        if c["iso3"] in un_names:
            index[fold(un_names[c["iso3"]])] = c["iso3"]
    index.update(ALIASES)
    scenarios = json.load(open(os.path.join(API, "scenarios.json")))

    tables, codes, footnotes, places, unmatched = {}, {}, {}, {}, []
    for t in ("2", "3"):
        meta, rows, (legend, notes) = read_table(data[t], t)
        tables[t] = {
            "title": meta["title"],
            "url": URLS[t],
            "lastUpdated": meta["lastUpdated"],
            "sha256": hashlib.sha256(data[t]).hexdigest(),
            "bytes": len(data[t]),
        }
        for k, v in legend.items():
            if k == "italic":
                codes.setdefault("italic", {})[t] = v
            elif k not in ("a", "..."):  # 'a: "Code" indicates ...'; "..." (not available) is null in the output
                if codes.get(k, v) != v:
                    raise SystemExit(f"code {k!r} means different things in the two tables")
                codes[k] = v
        footnotes[t] = {k: notes[k] for k in sorted(notes, key=int)}
        for r in merge_names(rows):
            iso = index.get(fold(r["name"]))
            if not iso or iso not in ours:
                unmatched.append({"table": t, "name": r["name"]})
                continue
            p = places.setdefault(iso, {})
            if t == "2" and "census" in p or t == "3" and "births" in p:
                raise SystemExit(f"two rows for {iso} in Table {t}: {r['name']}")
            p["unsdName"] = r["name"]
            _, _, name_notes = parse_marks(r["nameSups"])
            if name_notes:
                p.setdefault("notes", {})[t] = name_notes
            if t == "2":
                p["census"] = census_record(r["cells"])
                p["estimate"] = estimate_record(r["cells"])
            else:
                for event in ("births", "deaths", "infantDeaths"):
                    p[event] = event_record(r["cells"], event)

    ratios = []
    for iso, p in places.items():
        for event in ("births", "deaths"):
            rec = p.get(event)
            if rec:
                ratio = rate_check(rec, wpp_population(scenarios, iso, rec["year"]))
                if ratio is not None:
                    ratios.append((iso, event, round(ratio, 2)))
    checks = run_checks(places, scenarios)
    checks["rateConsistency"] = {
        "checked": len(ratios),
        "unclear": [f"{i} {e}" for i, e, r in ratios if not 0.2 <= r <= 5],
        "over15pct": [{"iso3": i, "event": e, "numberOverRateTimesPop": r} for i, e, r in ratios if abs(r - 1) > 0.15],
    }
    places = {k: places[k] for k in sorted(places)}
    report(places, ours, unmatched, checks, tables)

    out = {
        "source": {
            "title": "Population and Vital Statistics Report",
            "publisher": "United Nations Statistics Division",
            "page": PAGE,
            "tables": tables,
            "codes": codes,
            "extractedBy": "scripts/extract/unsd_pvsr.py",
            "extracted": datetime.date.today().isoformat(),
        },
        "places": places,
        "footnotes": footnotes,
        "unmatched": unmatched,
        "checks": checks,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    log(f"wrote {args.out}")


def report(places, ours, unmatched, checks, tables):
    for t, m in tables.items():
        log(f"Table {t}: {m['title']} (last updated {m['lastUpdated']}), {m['bytes']} bytes")
    log(f"\nplaces matched: {len(places)} of our {len(ours)}")
    for k in ("census", "estimate", "births", "deaths", "infantDeaths"):
        log(f"  {sum(1 for p in places.values() if p.get(k)):4d} with {k}")
    log(f"our places in neither table: {sorted(ours - set(places))}")
    log(f"UNSD rows not matched to our places: {[u['table'] + ':' + u['name'] for u in unmatched]}")
    unclear = [(i, k) for i, p in places.items() for k, v in p.items() if isinstance(v, dict) and v.get("numberUnclear")]
    log(f"numberUnclear: {unclear}")
    for name, c in checks.items():
        lists = {k: v for k, v in c.items() if isinstance(v, list)}
        log(f"\ncheck {name}: {c['checked']} checked")
        for k, v in lists.items():
            log(f"  {k} ({len(v)}):")
            for x in v:
                log(f"    {x}")


if __name__ == "__main__":
    main()
