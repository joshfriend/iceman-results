"""Build the site's compact rider table from the raw RaceResult export and start list.

Usage: python3 scripts/build_data.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "iceman-2026"
OUT = ROOT / "data" / "iceman-2026.json"

RACE = {
    "name": "Iceman Cometh 2026",
    "date": "2026-11-07",
    "resultsUrl": "https://my.raceresult.com/421674/results",
    "firstStart": 8 * 3600 + 45 * 60,
    "waveSeconds": 180,
}
FIELDS = [
    "bib", "name", "city", "status", "net", "gender",
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


def main():
    starts = {}
    for line in (RAW / "start-list.txt").read_text().splitlines():
        match = START_LINE.match(line)
        if match:
            assert match[1] not in starts, f"duplicate start-list bib {match[1]}"
            starts[match[1]] = seconds(match[4])

    rows = json.loads((RAW / "overall-results.json").read_text())["data"]
    riders = []
    for row in rows:
        bib, name, city, net_text = row[0], row[3], row[4], row[5]
        status = int(row[2]) if row[2].isdigit() else row[2]
        net = seconds(net_text) if re.fullmatch(r"\d+:\d{2}:\d{2}", net_text) else None
        gender, gender_rank = ranked(row[7])
        division, division_rank = ranked(row[8])
        start = starts.get(bib)
        wave = None
        if start is not None:
            offset = start - RACE["firstStart"]
            if offset >= 0 and offset % RACE["waveSeconds"] == 0:
                wave = offset // RACE["waveSeconds"] + 1
        if isinstance(status, int):
            assert net is not None and wave is not None, f"finisher {bib} lacks time or wave"
        riders.append([
            int(bib), name, city, status, net, gender,
            gender_rank, division, division_rank, start, wave,
        ])

    finishers = [r for r in riders if isinstance(r[3], int)]
    assert len(riders) == 4507 and len(finishers) == 3667, (len(riders), len(finishers))
    OUT.write_text(json.dumps(
        {"race": RACE, "fields": FIELDS, "riders": riders},
        separators=(",", ":"), ensure_ascii=False,
    ))
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(riders)} riders, {len(finishers)} finishers")


if __name__ == "__main__":
    main()
