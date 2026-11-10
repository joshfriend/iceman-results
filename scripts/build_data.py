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


def parse_registericeman(path, first_start, wave_seconds):
    """Registericeman paginated results, with the wave encoded in the Corral column."""
    source = json.loads(path.read_text())
    pages = source["pages"]
    if not pages:
        raise ValueError(f"{path} contains no result pages")

    headings = {heading["name"]: i for i, heading in enumerate(pages[0]["headings"])}
    required = [
        "Place", "Bib", "Name", "Gender", "Gender Place", "Age Place",
        "Age Group", "City", "Finish Time (Cumulative)", "Corral",
    ]
    missing = [heading for heading in required if heading not in headings]
    if missing:
        raise ValueError(f"{path} is missing columns: {', '.join(missing)}")

    first_set = pages[0]["resultSet"]
    expected = first_set["numResults"]
    rows = []
    for page in pages:
        if page["headings"] != pages[0]["headings"]:
            raise ValueError(f"{path} has inconsistent result columns")
        if page["resultSet"]["setInfo"]["individual_result_set_id"] != first_set["setInfo"]["individual_result_set_id"]:
            raise ValueError(f"{path} contains more than one result set")
        rows.extend(page["resultSet"]["results"])
    if len(rows) != expected:
        raise ValueError(f"{path} contains {len(rows)} of {expected} results")

    def value(row, heading):
        return row[headings[heading]]

    def place_number(value):
        text = str(value).strip()
        return int(text) if text.isdigit() else None

    def rank_number(value):
        rank = place_number(value)
        return rank if rank and rank > 0 else None

    seen_bibs = set()
    for row in rows:
        bib = str(value(row, "Bib")).strip()
        if bib in seen_bibs:
            raise ValueError(f"{path} contains duplicate bib {bib}")
        seen_bibs.add(bib)

        place = value(row, "Place")
        place = place_number(place)
        raw_status = str(value(row, "Place")).strip()
        wave_match = re.fullmatch(r"Wave\s+(\d+)", str(value(row, "Corral")).strip())
        wave = int(wave_match[1]) if wave_match else None
        finish_text = str(value(row, "Finish Time (Cumulative)")).strip()
        net = seconds(finish_text) if re.fullmatch(r"\d+:\d{2}:\d{2}", finish_text) else None

        if place is not None and net is not None:
            status = place
            start = first_start + (wave - 1) * wave_seconds if wave is not None else None
        else:
            status = "DSQ" if raw_status == "DQ" else raw_status or "DNF"
            if place is not None:
                status = "DNF"
            net = None
            start = first_start + (wave - 1) * wave_seconds if wave is not None else None

        yield {
            "bib": int(bib),
            "person": person_key(str(value(row, "Name")).strip()),
            "name": str(value(row, "Name")).strip(),
            "city": str(value(row, "City")).strip(),
            "status": status,
            "net": net,
            "gender": str(value(row, "Gender")).strip(),
            "genderRank": rank_number(value(row, "Gender Place")),
            "division": str(value(row, "Age Group")).strip(),
            "divisionRank": rank_number(value(row, "Age Place")),
            "start": start,
            "wave": wave,
        }


def parse_athlinks(path, config):
    source = json.loads(path.read_text())
    if source["eventId"] != config["eventId"]:
        raise ValueError(f"{path} contains the wrong Athlinks event")

    courses = source["courses"]
    expected_course_ids = set(config["courseIds"])
    actual_course_ids = {course["courseId"] for course in courses}
    if actual_course_ids != expected_course_ids:
        raise ValueError(f"{path} course IDs do not match race.json")

    records = []
    for course in courses:
        pages = course["pages"]
        if not pages:
            raise ValueError(f"{path} has no pages for course {course['courseId']}")
        expected = course["totalAthletes"]
        rows = []
        for page in pages:
            group = next(
                (group for group in page if group.get("eventCourseId") == course["courseId"]),
                None,
            )
            if group is None:
                raise ValueError(f"{path} is missing course {course['courseId']}")
            if group["totalAthletes"] != expected:
                raise ValueError(f"{path} has inconsistent totals for course {course['courseId']}")
            rows.extend(group["interval"]["intervalResults"])
        unique_rows = {}
        for row in rows:
            entry_id = row.get("entryId")
            key = ("entry", entry_id) if entry_id not in (None, 0) else (
                "fallback",
                str(row.get("bib", "")).strip(),
                row.get("displayName"),
                row.get("overallRank"),
                row.get("time", {}).get("timeInMillis"),
            )
            if key in unique_rows:
                if row != unique_rows[key]:
                    raise ValueError(f"{path} has conflicting repeated rows")
                continue
            unique_rows[key] = row
        rows = list(unique_rows.values())
        returned = course.get("returnedResults", expected)
        if len(rows) != returned or len(rows) > expected:
            raise ValueError(
                f"{path} has {len(rows)} rows; metadata lists {returned} results and a highest place of {expected}"
            )
        if "highestPlace" in course and course["highestPlace"] < expected:
            raise ValueError(f"{path} does not cover every place in course {course['courseId']}")
        for row in rows:
            time_ms = row.get("time", {}).get("timeInMillis")
            net = round(time_ms / 1000) if isinstance(time_ms, (int, float)) and time_ms > 0 else None
            raw_status = str(row.get("entryStatus", "")).upper()
            overall_rank = row.get("overallRank")
            overall_rank = int(overall_rank) if str(overall_rank).isdigit() else None
            status = overall_rank if net is not None else {
                "DNS": "DNS", "DSQ": "DSQ", "DQ": "DSQ", "DNF": "DNF",
            }.get(raw_status, "DNF")
            if net is not None and overall_rank is None and len(courses) == 1:
                raise ValueError(f"{path} has a finish time without an overall place")
            division = course["courseName"] if config.get("divisionFromCourse") else ""
            division_rank = overall_rank if division and net is not None else None
            records.append({
                "bib": str(row.get("bib", "")).strip(),
                "name": str(row.get("displayName", "")).strip(),
                "city": str(row.get("locality", "")).strip(),
                "status": status,
                "net": net,
                "gender": str(row.get("gender", "")).strip(),
                "genderRank": row.get("genderRank"),
                "division": division,
                "divisionRank": division_rank,
                "timeMs": time_ms if net is not None else None,
                "entryId": row.get("entryId"),
            })

    entry_ids = [record["entryId"] for record in records if record["entryId"] not in (None, 0)]
    if len(entry_ids) != len(set(entry_ids)):
        raise ValueError(f"{path} contains duplicate entry IDs")
    if any(not record["name"] for record in records):
        raise ValueError(f"{path} contains a result without a name")

    if len(courses) > 1:
        records.sort(key=lambda record: (record["timeMs"] is None, record["timeMs"] or 0))
        gender_places = {}
        overall_place = 0
        for record in records:
            if record["timeMs"] is None:
                continue
            overall_place += 1
            record["status"] = overall_place
            gender = record["gender"]
            gender_places[gender] = gender_places.get(gender, 0) + 1
            record["genderRank"] = gender_places[gender]

    for record in records:
        record.pop("timeMs")
        record.pop("entryId")
        record.update(
            bib=int(record["bib"]) if record["bib"].isdigit() else None,
            person=person_key(record["name"]),
            start=None,
            wave=None,
        )
        if record["genderRank"] is not None:
            record["genderRank"] = int(record["genderRank"])
        if record["divisionRank"] is not None:
            record["divisionRank"] = int(record["divisionRank"])
    return records


def build_year(folder):
    config = json.loads((folder / "race.json").read_text())
    first_start = seconds(config["firstStart"]) if config.get("firstStart") else None
    wave_seconds = config["waveSeconds"]
    if config.get("resultsFormat") == "registericeman":
        parsed_results = parse_registericeman(
            folder / config["sources"]["results"], first_start, wave_seconds,
        )
    elif config.get("resultsFormat") == "athlinks":
        parsed_results = parse_athlinks(folder / config["sources"]["results"], config)
    else:
        starts = parse_start_list(folder / config["sources"]["startList"])
        parsed_results = parse_raceresult(folder / config["sources"]["results"])

    riders = []
    for r in parsed_results:
        if config.get("resultsFormat") not in {"registericeman", "athlinks"}:
            start = starts.get(r["bib"])
            wave = None
            if start is not None and start >= first_start and (start - first_start) % wave_seconds == 0:
                wave = (start - first_start) // wave_seconds + 1
            r.update(bib=int(r["bib"]), person=person_key(r["name"]), start=start, wave=wave)
        if isinstance(r["status"], int):
            assert r["net"] is not None, f"finisher {r['bib']} lacks a time"
            if config.get("resultsFormat") not in {"athlinks", "registericeman"}:
                assert r["wave"] is not None, f"finisher {r['bib']} lacks a wave"
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
        "sourceName": config.get("sourceName", {
            "athlinks": "Athlinks results",
            "registericeman": "Registericeman results",
        }.get(config.get("resultsFormat"), "official overall results")),
    }
    if "waveTimeRequirements" in config:
        race["waveTimeRequirements"] = [
            seconds(requirement) for requirement in config["waveTimeRequirements"]
        ]
    if "waveTimeRequirements" in config:
        race["waveTimeRequirements"] = [
            seconds(requirement) for requirement in config["waveTimeRequirements"]
        ]
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
