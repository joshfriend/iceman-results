"""Download historical Iceman wave placements from the Iceman Race Explorer.

Usage: python3 scripts/download_wave_placements.py
"""

import csv
import io
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BASE_URL = "https://bsnyd.com/iceman/"
MANIFEST_URL = urllib.parse.urljoin(BASE_URL, "data/races.json")
YEARS = (2021, 2022, 2023, 2024)


def fetch(url):
    request = urllib.request.Request(
        url, headers={"User-Agent": "iceman-results wave data downloader"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def source_columns(fields, year):
    name = [field for field in fields if field.lower() in {"name", "racer"}]
    wave = [
        field for field in fields
        if field.lower() == "wave" or field.lower().endswith(" wave")
    ]
    division = [
        field for field in fields
        if "division" in field.lower() or "category" in field.lower()
    ]
    if len(name) != 1 or len(wave) != 1 or len(division) != 1:
        raise ValueError(f"{year}: source CSV must have one name, wave, and division/category column")
    return name[0], division[0], wave[0]


def download():
    manifest = json.loads(fetch(MANIFEST_URL))
    sources = {}
    for race in manifest:
        if race.get("title") == "Iceman" and str(race.get("dateLabel")) in {str(y) for y in YEARS}:
            year = int(race["dateLabel"])
            if year in sources:
                raise ValueError(f"BikeSignup manifest has duplicate Iceman data for {year}")
            sources[year] = race
    if set(sources) != set(YEARS):
        raise ValueError(f"BikeSignup manifest is missing an Iceman year: {sorted(set(YEARS) - set(sources))}")

    for year in YEARS:
        item = sources[year]
        source_url = urllib.parse.urljoin(BASE_URL, urllib.parse.quote(item["file"], safe="/"))
        text = fetch(source_url).decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise ValueError(f"{source_url}: empty CSV")
        name_field, division_field, wave_field = source_columns(reader.fieldnames, year)
        rows = list(reader)
        if len(rows) != item["recordCount"]:
            raise ValueError(
                f"{source_url}: expected {item['recordCount']} rows, received {len(rows)}"
            )

        placements = []
        for line, row in enumerate(rows, 2):
            name, division, value = (
                row[name_field].strip(), row[division_field].strip(), row[wave_field].strip(),
            )
            match = re.fullmatch(r"(?:wave\s*)?(\d+)", value, re.I) if value else None
            if not name or (value and (not match or int(match[1]) <= 0)):
                raise ValueError(f"{source_url}:{line}: invalid rider name or wave")
            placements.append({
                "name": name,
                "division": division,
                "wave": int(match[1]) if match else None,
            })

        folder = DATA / str(year)
        race_path = folder / "race.json"
        relative = "raw/wave-placements.json"
        (folder / relative).write_text(json.dumps(
            placements, ensure_ascii=False, separators=(",", ":"),
        ) + "\n")
        config = json.loads(race_path.read_text())
        config["wavePlacements"] = {"path": relative, "sourceUrl": source_url}
        race_path.write_text(json.dumps(config, indent=2) + "\n")
        print(f"{year}: downloaded {len(placements)} wave placement rows")


if __name__ == "__main__":
    download()
