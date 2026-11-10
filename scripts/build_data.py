"""Build each year's compact results file and the cross-year index.

Every year lives in data/<year>/:
  race.json     hand-written config (date, results URL, wave timing, podium depth, raw sources)
  raw/          untouched source files for that year
  results.json  generated: the table the site loads

data/index.json is generated from the year folders so the site can list and compare years.

Usage: python3 scripts/build_data.py [YEAR ...]   (default: every year folder)
"""

import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RACE_NAME = "Iceman Cometh"

FIELDS = [
    "bib", "person", "name", "city", "status", "net", "gender",
    "genderRank", "division", "divisionRank", "start", "wave", "athlinksRacerId", "age", "raceGroup",
    "raceEvent", "raceGroupSource", "waveSource", "startSource",
]
START_LINE = re.compile(r"^\s*(\d+)\s+(.+?)\s+(\d+)\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s*$")
RANKED = re.compile(r"^\s*(.*?)\s*\((-?\d+)\)\s*$")


def seconds(text):
    parts = text.split(":")
    if len(parts) == 2:
        parts.insert(0, "0")
    h, m = map(int, parts[:2])
    return round(h * 3600 + m * 60 + float(parts[2]))


def published_age(value):
    text = str(value).strip()
    return int(text) if text.isdigit() and 0 < int(text) <= 120 else None


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
            starts[match[1]] = (seconds(match[4]), int(match[3]))
    return starts


class ArchivedResults(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_pre = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "pre":
            self.in_pre = True
        if self.in_pre and tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "pre":
            self.in_pre = False
            self.parts.append("\n")

    def handle_data(self, data):
        if self.in_pre:
            self.parts.append(data)


def parse_runmichigan(path):
    """Read published fixed-width category tables, not inferred age brackets."""
    parser = ArchivedResults()
    parser.feed(path.read_text())
    gender = division = None
    columns = None
    for line in "".join(parser.parts).splitlines():
        text = line.strip()
        if text in {"MALE ICEMAN RESULTS", "FEMALE ICEMAN RESULTS"}:
            gender = "M" if text.startswith("MALE") else "F"
        if text.startswith("CLASS:") or text in {"PRO MEN", "PRO WOMEN"}:
            division = text.removeprefix("CLASS:").strip()
            columns = None
        elif text.startswith("====="):
            columns = [(match.start(), match.end()) for match in re.finditer(r"=+", line)]
        elif re.match(r"^\s*\d+\s", line) and columns and division and gender:
            if "DISQUALIFIED" in division:
                continue
            values = [line[start:end].strip() for start, end in columns]
            has_bib = len(columns) == 7
            finish = re.search(r"(\d+:\d{2}:\d{2})\s*$", line)
            if len(columns) not in {6, 7} or not finish:
                raise ValueError(f"{path}: unrecognized archived result: {line}")
            yield {
                "bib": int(values[2]) if has_bib else None,
                "name": values[1], "gender": gender, "net": seconds(finish[1]),
                "division": division, "divisionRank": int(values[0]),
                "raceGroup": race_group({"division": division}),
            }


def parse_metadata_csv(path):
    with path.open(newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"bib", "name", "gender", "net"}.issubset(reader.fieldnames or []):
            raise ValueError(f"{path}: metadata CSV requires bib, name, gender, net columns")
        allowed = {
            "bib", "name", "gender", "net", "wave", "start", "raceGroup",
            "raceEvent", "division", "divisionRank",
        }
        if set(reader.fieldnames) - allowed:
            raise ValueError(f"{path}: unknown metadata CSV columns")
        if len(set(reader.fieldnames)) != len(reader.fieldnames):
            raise ValueError(f"{path}: duplicate metadata CSV columns")
        for line, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"{path}:{line}: inconsistent metadata CSV columns")
            record = {key: value.strip() for key, value in row.items() if value and key}
            if not record.get("name") or record.get("gender") not in {"M", "F", "U"}:
                raise ValueError(f"{path}:{line}: missing name or invalid gender")
            for key in ("bib", "wave", "divisionRank"):
                if key in record:
                    if not record[key].isdigit() or int(record[key]) <= 0:
                        raise ValueError(f"{path}:{line}: invalid {key}")
                    record[key] = int(record[key])
            for key in ("net", "start"):
                if key in record:
                    if not re.fullmatch(r"\d+:[0-5]\d:[0-5]\d", record[key]):
                        raise ValueError(f"{path}:{line}: invalid {key}")
                    record[key] = seconds(record[key])
            if record.get("net") == 0:
                raise ValueError(f"{path}:{line}: net must be positive or blank for nonfinishers")
            if "start" in record and record["start"] >= 86400:
                raise ValueError(f"{path}:{line}: start must be seconds within the race day")
            if "raceGroup" in record and record["raceGroup"] not in {"amateur", "junior", "pro"}:
                raise ValueError(f"{path}:{line}: invalid raceGroup")
            if "raceEvent" in record and record["raceEvent"] not in {
                "iceman", "junior-iceman", "slush-cup",
            }:
                raise ValueError(f"{path}:{line}: invalid raceEvent")
            record.setdefault("bib", None)
            record.setdefault("net", None)
            yield record


def supplement_metadata(riders, records, source, allow_unmatched=False):
    by_identity = {}
    for rider in riders:
        key = (person_key(rider["name"]), rider["gender"], rider["net"])
        by_identity.setdefault(key, []).append(rider)
    matched = set()
    missing = 0
    for record in records:
        key = (person_key(record["name"]), record["gender"], record["net"])
        candidates = [
            rider for rider in by_identity.get(key, [])
            if record["bib"] is None or rider["bib"] is None
            or str(rider["bib"]) == str(record["bib"])
        ]
        if not candidates and allow_unmatched:
            missing += 1
            continue
        if len(candidates) != 1:
            raise ValueError(f"{source}: no unique matching result for {record['name']} (bib {record['bib']})")
        rider = candidates[0]
        if id(rider) in matched:
            raise ValueError(f"{source}: repeated metadata for {record['name']}")
        matched.add(id(rider))
        if rider["bib"] is None and record["bib"] is not None:
            if any(other is not rider and str(other["bib"]) == str(record["bib"]) for other in riders):
                raise ValueError(f"{source}: duplicate recovered bib {record['bib']}")
            rider["bib"] = record["bib"]
        for key in ("wave", "start", "raceGroup", "raceEvent", "division", "divisionRank"):
            if key not in record:
                continue
            if key in {"wave", "start"} and rider.get(key) not in {None, record[key]}:
                raise ValueError(f"{source}: conflicting {key} for bib {rider['bib']}")
            rider[key] = record[key]
            if key in {"wave", "start", "raceGroup"}:
                rider[f"{key}Source"] = source
        if "division" in record and "raceGroup" not in record:
            group = race_group(record)
            if group in {"pro", "junior"}:
                rider["raceGroup"] = group
                rider["raceGroupSource"] = source
    print(f"{source}: matched {len(matched)} metadata rows; {missing} unmatched rows left unchanged")
    return len(matched)


def parse_wave_placements(path):
    records = json.loads(path.read_text())
    if not isinstance(records, list):
        raise ValueError(f"{path}: expected a JSON array")
    for line, record in enumerate(records, 1):
        if not isinstance(record, dict) or set(record) != {"name", "division", "wave"}:
            raise ValueError(f"{path}:{line}: expected name, division, and wave fields")
        name, division, wave = record["name"], record["division"], record["wave"]
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"{path}:{line}: missing rider name")
        if not isinstance(division, str):
            raise ValueError(f"{path}:{line}: division must be a string")
        if wave is not None and (not isinstance(wave, int) or isinstance(wave, bool) or wave <= 0):
            raise ValueError(f"{path}:{line}: invalid wave {wave!r}")
        yield {"name": name.strip(), "division": division.strip(), "wave": wave}


def division_key(value):
    text = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    text = re.sub(r"\bsingle\s*speed\b", "singlespeed", text)
    text = re.sub(r"\bclydesdales\b", "clydesdale", text)
    text = re.sub(r"\bfat tire\b", "fat bike", text)
    return text


def supplement_wave_placements(riders, records, source):
    by_name = {}
    for rider in riders:
        if rider.get("raceEvent") == "iceman":
            by_name.setdefault(person_key(rider["name"]), []).append(rider)

    placements = {}
    for record in records:
        if record["wave"] is None:
            continue
        key = (person_key(record["name"]), division_key(record["division"]))
        placements.setdefault(key, set()).add(record["wave"])

    matched = set()
    unmatched = 0
    for (name, division), waves in placements.items():
        if len(waves) != 1:
            unmatched += 1
            continue
        candidates = by_name.get(name, [])
        if len(candidates) > 1 and division:
            candidates = [
                rider for rider in candidates
                if division_key(rider.get("division", "")) == division
            ]
        if len(candidates) != 1:
            unmatched += 1
            continue
        rider = candidates[0]
        if id(rider) in matched:
            unmatched += 1
            continue
        wave = next(iter(waves))
        if rider.get("wave") is not None and rider["wave"] != wave:
            raise ValueError(f"{source}: conflicting wave for {rider['name']}")
        matched.add(id(rider))
        if rider.get("wave") is None:
            rider["wave"] = wave
            rider["waveSource"] = "bsnyd"

    print(f"{source}: matched {len(matched)} wave placements; {unmatched} ambiguous or unmatched")
    return len(matched)


def parse_raceresult(path):
    """RaceResult overall list: BIB, ID, place|status, name, city, net, BIB, gender (rank), division (rank)."""
    source = json.loads(path.read_text())
    has_division = any("CONTEST.NAME" in field for field in source["DataFields"])
    for row in source["data"]:
        gender, gender_rank = ranked(row[7])
        division, division_rank = ranked(row[8]) if has_division else ("", None)
        raw_status = str(row[2]).strip()
        status = int(raw_status) if raw_status.isdigit() and int(raw_status) > 0 else (
            "DNF" if raw_status == "-1" else raw_status
        )
        yield {
            "bib": row[0],
            "name": row[3],
            "city": row[4],
            "status": status,
            "net": seconds(row[5]) if isinstance(status, int)
            and re.fullmatch(r"\d+:\d{2}(?::\d{2})?(?:\.\d+)?", row[5]) else None,
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
        "Age Group", "City",
    ]
    finish_heading = "Finish Time (Cumulative)" if "Finish Time (Cumulative)" in headings else "Clock Time"
    required.append(finish_heading)
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
        wave_match = re.fullmatch(r"Wave\s+(\d+)", str(value(row, "Corral")).strip()) if "Corral" in headings else None
        wave = int(wave_match[1]) if wave_match else None
        finish_text = str(value(row, finish_heading)).strip()
        net = seconds(finish_text) if re.fullmatch(r"\d+:\d{2}(?::\d{2})?(?:\.\d+)?", finish_text) else None
        start = (
            first_start + (wave - 1) * wave_seconds
            if wave is not None and first_start is not None and wave_seconds is not None else None
        )

        if place is not None and place > 0 and net is not None and net > 0:
            status = place
        else:
            status = "DSQ" if raw_status == "DQ" else raw_status or "DNF"
            if place is not None:
                status = "DNF"
            net = None

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
            "age": published_age(value(row, "Age")) if "Age" in headings else None,
        }


def athlinks_result_key(row):
    return (
        str(row.get("bib", "")).strip(), str(row.get("displayName", "")).strip(),
        row.get("gender"), row.get("time", {}).get("timeInMillis"),
    )


def athlinks_divisions(path, event_id, course_ids):
    source = json.loads(path.read_text())
    if source["eventId"] != event_id:
        raise ValueError(f"{path} contains the wrong Athlinks division event")
    memberships = {}
    for division in source["divisions"]:
        course_id = division["courseId"]
        if course_id not in course_ids:
            raise ValueError(f"{path} contains an unexpected division course")
        if not division.get("available", True):
            print(f"{path}: division {division['divisionId']} has no published result group")
            continue
        seen_rows = set()
        for page in division["pages"]:
            for group in page:
                if group.get("bracketId") != division["divisionId"]:
                    raise ValueError(f"{path} contains the wrong division result group")
                rows = group["interval"]["intervalResults"]
                if rows and group.get("eventCourseId") != course_id:
                    raise ValueError(f"{path} contains division rows from another course")
                for row in rows:
                    key = (course_id, athlinks_result_key(row))
                    rank = row.get("primaryBracketRank")
                    if not isinstance(rank, int) or rank <= 0:
                        raise ValueError(f"{path} has an invalid division rank")
                    seen_rows.add((key, rank))
                    if group.get("bracketType") in {"GENDER", "OVERALL"}:
                        continue
                    memberships.setdefault(key, set()).add((division["name"].strip(), rank))
        if len(seen_rows) != division["returnedResults"]:
            raise ValueError(f"{path} has an incomplete division download")
    return memberships


def athlinks_race_group(division, gender, course, metadata, config):
    group = race_group({"division": division})
    if group != "amateur":
        return group
    if config.get("divisionFromCourse"):
        return "amateur" if division else "unclassified"
    course_metadata = next(
        (item for item in metadata if item["eventCourseId"] == course["courseId"]), None,
    )
    if course_metadata and division:
        names = {item["name"].strip() for item in course_metadata["metadata"]["divisions"]}
        pro_names = [name for name in names if race_group({"division": name}) == "pro"]
        gender_pattern = r"\b(?:M|Men)\b" if gender == "M" else r"\b(?:F|Women)\b"
        if (gender in {"M", "F"} and division in names
                and any(re.search(gender_pattern, name, re.I) for name in pro_names)):
            return "amateur"
    if course["courseName"].strip().lower() == "iceman" and any(
        race_group({"division": item["eventCourseName"]}) == "pro" for item in metadata
    ):
        return "amateur"
    return "unclassified"


def parse_athlinks(path, config):
    source = json.loads(path.read_text())
    if source["eventId"] != config["eventId"]:
        raise ValueError(f"{path} contains the wrong Athlinks event")

    courses = source["courses"]
    expected_course_ids = set(config["courseIds"])
    actual_course_ids = {course["courseId"] for course in courses}
    if actual_course_ids != expected_course_ids:
        raise ValueError(f"{path} course IDs do not match race.json")

    division_source = config.get("divisions") or config.get("sources", {}).get("divisions")
    memberships = athlinks_divisions(
        path.parent.parent / division_source, source["eventId"], expected_course_ids,
    ) if division_source else {}
    metadata_path = (
        path.parent.parent / config["metadata"]
        if config.get("metadata") else path.with_name("athlinks-metadata.json")
    )
    course_intervals = {}
    metadata_courses = []
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text())
        if metadata["eventId"] != source["eventId"]:
            raise ValueError(f"{metadata_path} contains the wrong Athlinks event")
        metadata_courses = metadata["eventCourseMetadata"]
        course_intervals = {
            course["eventCourseId"]: course["metadata"]["intervals"]
            for course in metadata["eventCourseMetadata"]
        }
    matched_memberships = set()
    ambiguous_divisions = 0
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
        result_keys = Counter(athlinks_result_key(row) for row in rows)
        repeated_keys = {key for key, count in result_keys.items() if count > 1}
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
            nonfinish = {
                "DNS": "DNS", "DSQ": "DSQ", "DQ": "DSQ", "DNF": "DNF",
            }.get(raw_status)
            intervals = course_intervals.get(course["courseId"], [])
            full_names = {interval["name"] for interval in intervals if interval["isFull"]}
            if full_names and row.get("intervalName") not in full_names:
                if row.get("intervalName") not in {interval["name"] for interval in intervals}:
                    raise ValueError(f"{path} contains an unknown result interval")
                nonfinish = nonfinish or "DNF"
            if nonfinish:
                net = None
            status = nonfinish or (overall_rank if net is not None else "DNF")
            if net is not None and overall_rank is None and len(courses) == 1:
                raise ValueError(f"{path} has a finish time without an overall place")
            division = course["courseName"] if config.get("divisionFromCourse") else ""
            division_rank = overall_rank if division and net is not None else None
            result_key = athlinks_result_key(row)
            membership_key = (course["courseId"], result_key)
            candidates = memberships.get(membership_key, set())
            if candidates:
                matched_memberships.add(membership_key)
            if not division and candidates:
                if len(candidates) == 1 and result_key not in repeated_keys:
                    division, division_rank = next(iter(candidates))
                else:
                    ambiguous_divisions += 1
            records.append({
                "bib": str(row.get("bib", "")).strip(),
                "name": str(row.get("displayName", "")).strip(),
                "city": str(row.get("locality", "")).strip(),
                "status": status,
                "net": net,
                "gender": str(row.get("gender", "")).strip(),
                "genderRank": row.get("genderRank") if net is not None else None,
                "division": division,
                "divisionRank": division_rank if net is not None else None,
                "timeMs": time_ms if net is not None else None,
                "entryId": row.get("entryId"),
                "athlinksRacerId": row.get("racerId") or None,
                "age": published_age(row.get("age")),
                "raceGroup": athlinks_race_group(
                    division, row.get("gender"), course, metadata_courses, config,
                ),
            })

    unmatched = len(memberships.keys() - matched_memberships)
    if unmatched:
        raise ValueError(f"{path}: {unmatched} division entries do not match the overall results")
    if division_source:
        missing = sum(not record["division"] for record in records)
        print(f"{path.parent.parent.name}: {missing} results without divisions; "
              f"{ambiguous_divisions} ambiguous division memberships omitted")
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


def supplement_athlinks_ids(riders, athlinks_riders):
    def identity_key(rider):
        return (
            rider["bib"], rider["name"].strip().casefold(),
            rider["gender"], rider["net"],
        )

    by_identity = {}
    for rider in riders:
        by_identity.setdefault(identity_key(rider), []).append(rider)

    linked = 0
    for source in athlinks_riders:
        if not source["athlinksRacerId"]:
            continue
        matches = by_identity.get(identity_key(source), [])
        if len(matches) != 1:
            raise ValueError(f"Athlinks identity for bib {source['bib']} has no unique matching result")
        rider = matches[0]
        if rider.get("athlinksRacerId") is not None:
            raise ValueError(f"Multiple Athlinks identities for bib {source['bib']}")
        rider["athlinksRacerId"] = source["athlinksRacerId"]
        linked += 1
    return linked


def race_group(rider):
    division = rider["division"]
    if re.search(r"\bpro\b|pro/1|\bcat\s*1\b", division, re.I):
        return "pro"
    ages = re.search(r"\b(?:men|women|m|f)\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?\b", division, re.I)
    if (re.search(r"\bjunior", division, re.I)
            or ages and 0 < int(ages[2] or ages[1]) <= 18):
        return "junior"
    return "amateur"


def build_year(folder):
    config = json.loads((folder / "race.json").read_text())
    first_start = seconds(config["firstStart"]) if config.get("firstStart") else None
    wave_seconds = config["waveSeconds"]
    wave_schedule = config.get("waveSchedule")
    schedule = json.loads((folder / wave_schedule["path"]).read_text()) if wave_schedule else {}
    scheduled_starts = {
        event: {int(wave): seconds(start) for wave, start in waves.items()}
        for event, waves in schedule.get("starts", {}).items()
    }
    wave_assignments = config.get("waveAssignments", schedule.get("waveAssignments", {}))
    if config.get("resultsFormat") == "registericeman":
        parsed_results = parse_registericeman(
            folder / config["sources"]["results"], first_start, wave_seconds,
        )
    elif config.get("resultsFormat") == "athlinks":
        parsed_results = parse_athlinks(folder / config["sources"]["results"], config)
    else:
        starts = parse_start_list(folder / config["sources"]["startList"])
        parsed_results = parse_raceresult(folder / config["sources"]["results"])

    parsed_results = list(parsed_results)
    for rider in parsed_results:
        rider.update(
            raceEvent=config.get("raceEvent", "iceman"),
            raceGroupSource=None, waveSource=None, startSource=None,
        )
        if rider.get("wave") is not None:
            rider["waveSource"] = "results"
            rider["startSource"] = "waveSchedule" if rider.get("start") is not None else None
    if "athlinksIdentity" in config:
        identity = config["athlinksIdentity"]
        athlinks_riders = parse_athlinks(folder / identity["results"], identity)
        linked = supplement_athlinks_ids(parsed_results, athlinks_riders)
        print(f"{config['year']}: supplemented {linked} Athlinks rider IDs")

    for source in config.get("additionalResults", []):
        path = folder / source["results"]
        if source["format"] == "registericeman":
            extra = parse_registericeman(path, first_start, wave_seconds)
        elif source["format"] == "athlinks":
            extra = parse_athlinks(path, source)
        elif source["format"] == "raceresult":
            extra = parse_raceresult(path)
        else:
            raise ValueError(f"Unknown additional results format: {source['format']}")
        for rider in extra:
            if "raceGroup" in source:
                rider["raceGroup"] = source["raceGroup"]
            rider.update(
                raceEvent=source.get("raceEvent", "iceman"),
                raceGroupSource="resultSet" if "raceGroup" in source else None,
                waveSource=None, startSource=None,
            )
            if rider.get("wave") is not None:
                rider["waveSource"] = "results"
                rider["startSource"] = "waveSchedule" if rider.get("start") is not None else None
            if source.get("raceGroup") == "pro" and not rider["division"]:
                rider["division"] = f"Pro/Cat 1 {rider['gender']}"
                rider["divisionRank"] = rider["genderRank"]
            parsed_results.append(rider)

    metadata_coverage = []
    for index, source in enumerate(config.get("riderMetadata", [])):
        path = folder / source["path"]
        if source["format"] == "runmichigan":
            records = parse_runmichigan(path)
        elif source["format"] == "csv":
            records = parse_metadata_csv(path)
        else:
            raise ValueError(f"Unknown rider metadata format: {source['format']}")
        records = list(records)
        matched = supplement_metadata(
            parsed_results, records, f"metadata:{index}",
            allow_unmatched=source["format"] == "runmichigan",
        )
        metadata_coverage.append({
            "source": f"metadata:{index}", "rows": len(records), "matched": matched,
            "unmatched": len(records) - matched,
        })

    wave_placements = config.get("wavePlacements")
    if wave_placements:
        supplement_wave_placements(
            parsed_results,
            parse_wave_placements(folder / wave_placements["path"]),
            "wavePlacements",
        )

    riders = []
    for r in parsed_results:
        r.setdefault("athlinksRacerId", None)
        r.setdefault("age", None)
        r.setdefault("raceGroup", race_group(r))
        if r["raceGroupSource"] is None:
            r["raceGroupSource"] = (
                None if r["raceGroup"] == "unclassified"
                else "division" if r["division"] else "resultSet"
            )
        group_assignments = (
            wave_assignments.get(r["raceGroup"])
            if r["raceEvent"] == config.get("raceEvent", "iceman") else None
        )
        division_wave = (
            schedule.get("divisionWaves", {}).get(r["division"])
            if r["raceEvent"] == config.get("raceEvent", "iceman") else None
        )
        assignment = group_assignments.get(r["gender"]) if group_assignments else None
        if group_assignments and not assignment and division_wave is None:
            raise ValueError(
                f"{folder}: no configured wave for {r['raceGroup']} gender {r['gender']!r}"
            )
        if config.get("resultsFormat") not in {"registericeman", "athlinks"}:
            start, wave = starts.get(str(r["bib"]), (None, None))
            if assignment:
                start, wave = seconds(assignment["start"]), assignment["wave"]
                start_source = wave_source = "waveSchedule"
            else:
                for key, value in (("start", start), ("wave", wave)):
                    if value is not None and r.get(key) not in {None, value}:
                        raise ValueError(f"{folder}: conflicting {key} for bib {r['bib']}")
                start_source = "startList" if start is not None else r["startSource"]
                wave_source = "startList" if wave is not None else r["waveSource"]
                if not wave and start is not None and r["raceGroup"] == "amateur":
                    if start >= first_start and (start - first_start) % wave_seconds == 0:
                        wave = (start - first_start) // wave_seconds + 1
                        wave_source = "waveSchedule"
            r.update(
                bib=int(r["bib"]), person=person_key(r["name"]),
                start=start if start is not None else r.get("start"),
                wave=wave if wave is not None else r.get("wave"),
                startSource=start_source, waveSource=wave_source,
            )
        elif assignment:
            for key, value in (("wave", assignment["wave"]), ("start", seconds(assignment["start"]))):
                if r.get(key) not in {None, value}:
                    raise ValueError(f"{folder}: conflicting scheduled {key} for bib {r['bib']}")
                if r.get(key) is None:
                    r[key] = value
                    r[f"{key}Source"] = "waveSchedule"
        if division_wave is not None:
            if r.get("wave") not in {None, division_wave}:
                raise ValueError(f"{folder}: conflicting division wave for bib {r['bib']}")
            if r.get("wave") is None:
                r["wave"], r["waveSource"] = division_wave, "waveSchedule"
        scheduled_start = scheduled_starts.get(r["raceEvent"], {}).get(r.get("wave"))
        if scheduled_start is not None:
            if r.get("start") not in {None, scheduled_start}:
                raise ValueError(f"{folder}: conflicting scheduled start for bib {r['bib']}")
            if r.get("start") is None:
                r["start"], r["startSource"] = scheduled_start, "waveSchedule"
        if r.get("start") is None and r.get("wave") is not None and first_start is not None:
            if wave_seconds is None or r["raceGroup"] != "amateur":
                raise ValueError(f"{folder}: wave for bib {r['bib']} requires an explicit start time")
            r["start"] = first_start + (r["wave"] - 1) * wave_seconds
            r["startSource"] = "waveSchedule"
        if isinstance(r["status"], int):
            assert r["net"] is not None, f"finisher {r['bib']} lacks a time"
            if (
                config.get("resultsFormat") not in {"athlinks", "registericeman"}
                and r["raceEvent"] == config.get("raceEvent", "iceman")
            ):
                assert r["wave"] is not None or r["raceGroup"] != "amateur", f"finisher {r['bib']} lacks a wave"
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
        "dataSources": {
            **config["sources"],
            "additionalResults": config.get("additionalResults", []),
            "riderMetadata": config.get("riderMetadata", []),
            **({"wavePlacements": wave_placements} if wave_placements else {}),
            **({"waveSchedule": wave_schedule} if wave_schedule else {}),
        },
        "metadataCoverage": metadata_coverage,
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

    def entries_for_event(event):
        entries = []
        for folder in folders:
            results = json.loads((folder / "results.json").read_text())
            fields = results["fields"]
            event_index = fields.index("raceEvent")
            status_index = fields.index("status")
            riders = [
                rider for rider in results["riders"]
                if rider[event_index] == event
                or event == "iceman" and rider[event_index] != "slush-cup"
            ]
            if not riders:
                continue
            entries.append({
                "year": results["race"]["year"],
                "date": results["race"]["date"],
                "path": f"{folder.name}/results.json",
                "riders": len(riders),
                "finishers": sum(isinstance(rider[status_index], int) for rider in riders),
            })
        return sorted(entries, key=lambda entry: entry["year"], reverse=True)

    events = {
        "iceman": {"name": RACE_NAME, "years": entries_for_event("iceman")},
        "slush-cup": {"name": "Slush Cup", "years": entries_for_event("slush-cup")},
    }
    index = {"race": RACE_NAME, "years": events["iceman"]["years"], "events": events}
    (DATA / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"Wrote data/index.json: {[e['year'] for e in events['iceman']['years']]}")


if __name__ == "__main__":
    main(set(sys.argv[1:]))
