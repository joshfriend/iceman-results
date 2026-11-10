"""Build each year's compact results file and the cross-year index.

Every year lives in data/<year>/:
  race.json     hand-written config (date, results URL, wave timing, podium depth, raw sources)
  raw/          untouched source files for that year
  results.json  generated: the table the site loads

data/index.json is generated from the year folders so the site can list and compare years.

Usage: python3 scripts/build_data.py [YEAR ...]   (default: every year folder)
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RACE_NAME = "Iceman Cometh"

FIELDS = [
    "bib", "person", "name", "city", "status", "net", "gender",
    "genderRank", "division", "divisionRank", "start", "wave",
]
START_LINE = re.compile(r"^\s*(\d+)\s+(.+?)\s+(\d+)\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s*$")
RANKED = re.compile(r"^\s*(.*?)\s*\((-?\d+)\)\s*$")


def seconds(text):
    h, m, s = map(int, text.split(":"))
    return h * 3600 + m * 60 + s


def ranked(text):
    match = RANKED.match(text)
    if not match:
        return text.strip(), None
    rank = int(match[2])
    return match[1], rank if rank > 0 else None


def person_key(name):
    """Year-independent rider key. Bibs change every year, so cross-year matching uses the name."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def parse_start_list(path):
    starts = {}
    for line in path.read_text().splitlines():
        match = START_LINE.match(line)
        if match:
            assert match[1] not in starts, f"duplicate start-list bib {match[1]}"
            starts[match[1]] = seconds(match[4])
    return starts


def parse_raceresult(path):
    """RaceResult overall list: BIB, ID, place|status, name, city, net, BIB, gender (rank), division (rank)."""
    for row in json.loads(path.read_text())["data"]:
        gender, gender_rank = ranked(row[7])
        division, division_rank = ranked(row[8])
        yield {
            "bib": row[0],
            "name": row[3],
            "city": row[4],
            "status": int(row[2]) if row[2].isdigit() else row[2],
            "net": seconds(row[5]) if re.fullmatch(r"\d+:\d{2}:\d{2}", row[5]) else None,
            "gender": gender,
            "genderRank": gender_rank,
            "division": division,
            "divisionRank": division_rank,
        }


def build_year(folder):
    config = json.loads((folder / "race.json").read_text())
    first_start = seconds(config["firstStart"])
    wave_seconds = config["waveSeconds"]
    starts = parse_start_list(folder / config["sources"]["startList"])

    riders = []
    for r in parse_raceresult(folder / config["sources"]["results"]):
        start = starts.get(r["bib"])
        wave = None
        if start is not None and start >= first_start and (start - first_start) % wave_seconds == 0:
            wave = (start - first_start) // wave_seconds + 1
        if isinstance(r["status"], int):
            assert r["net"] is not None and wave is not None, f"finisher {r['bib']} lacks time or wave"
        r.update(bib=int(r["bib"]), person=person_key(r["name"]), start=start, wave=wave)
        riders.append([r[field] for field in FIELDS])

    finishers = sum(isinstance(r[FIELDS.index("status")], int) for r in riders)
    race = {
        "name": RACE_NAME,
        "year": config["year"],
        "date": config["date"],
        "resultsUrl": config["resultsUrl"],
        "firstStart": first_start,
        "waveSeconds": wave_seconds,
        "podiumDepth": config["podiumDepth"],
    }
    (folder / "results.json").write_text(json.dumps(
        {"race": race, "fields": FIELDS, "riders": riders},
        separators=(",", ":"), ensure_ascii=False,
    ))
    print(f"Wrote {(folder / 'results.json').relative_to(ROOT)}: {len(riders)} riders, {finishers} finishers")


def main(years):
    folders = sorted(p for p in DATA.iterdir() if p.is_dir() and (p / "race.json").exists())
    for folder in folders:
        if not years or folder.name in years:
            build_year(folder)
    entries = []
    for folder in folders:
        results = json.loads((folder / "results.json").read_text())
        status = results["fields"].index("status")
        entries.append({
            "year": results["race"]["year"],
            "date": results["race"]["date"],
            "path": f"{folder.name}/results.json",
            "riders": len(results["riders"]),
            "finishers": sum(isinstance(r[status], int) for r in results["riders"]),
        })
    entries.sort(key=lambda e: e["year"], reverse=True)
    (DATA / "index.json").write_text(json.dumps({"race": RACE_NAME, "years": entries}, indent=2) + "\n")
    print(f"Wrote data/index.json: {[e['year'] for e in entries]}")


if __name__ == "__main__":
    main(set(sys.argv[1:]))
