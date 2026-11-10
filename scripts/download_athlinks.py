"""Download the Iceman Cometh long-course results available from Athlinks.

Usage: python3 scripts/download_athlinks.py

The script downloads 2001–2025 event-course result pages concurrently and stores
the untouched API responses in data/<year>/raw/athlinks-results.json.
Division metadata and result pages are saved alongside the overall results.
"""

import concurrent.futures
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MASTER_EVENT_ID = 35208
RESULTS_API = "https://results.athlinks.com/event"
MASTER_API = f"https://alaska.athlinks.com/MasterEvents/Api/{MASTER_EVENT_ID}"
PAGE_SIZE = 100
MAX_WORKERS = 8
HEADERS = {
    "Accept": "application/json",
    "User-Agent": "iceman-results data downloader",
}


def fetch_json(url):
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == 4:
                raise
            time.sleep(2**attempt)


def course_group(payload, course_id):
    for group in payload:
        if group.get("eventCourseId") == course_id:
            return group
    raise ValueError(f"Athlinks response has no course {course_id}")


def fetch_course_page(event_id, course_id, offset, expected=None):
    for attempt in range(5):
        page = fetch_json(api_url(event_id, course_id, offset))
        try:
            group = course_group(page, course_id)
        except ValueError:
            if expected and offset >= expected - PAGE_SIZE:
                return page, None
            if attempt == 4:
                raise
            time.sleep(2**attempt)
            continue
        if offset and not group.get("interval", {}).get("intervalResults"):
            if expected and offset >= expected - PAGE_SIZE:
                return page, None
            if attempt == 4:
                raise ValueError(f"Athlinks course {course_id} returned an empty page at {offset}")
            time.sleep(2**attempt)
            continue
        return page, group
    raise RuntimeError(f"Athlinks course {course_id} page {offset} could not be fetched")


def deduplicate_rows(rows, course_id, use_entry_ids=True):
    unique = {}
    for row in rows:
        entry_id = row.get("entryId")
        key = ("entry", entry_id) if use_entry_ids and entry_id not in (None, 0) else (
            "fallback",
            str(row.get("bib", "")).strip(),
            row.get("displayName"),
            row.get("overallRank"),
            row.get("time", {}).get("timeInMillis"),
        )
        if key in unique:
            if row != unique[key]:
                changed = [field for field in row if row[field] != unique[key].get(field)]
                raise ValueError(
                    f"Athlinks course {course_id} has conflicting repeated rows for {key}: {changed}"
                )
            continue
        unique[key] = row
    return list(unique.values())


def api_url(event_id, course_id, offset, division_id=""):
    query = urllib.parse.urlencode({
        "eventCourseId": course_id,
        "divisionId": division_id,
        "intervalId": "",
        "from": offset,
        "limit": PAGE_SIZE,
    })
    return f"{RESULTS_API}/{event_id}?{query}"


def selected_courses(event):
    courses = [
        course for course in event.get("eventCourses", [])
        if int(course.get("resultCount") or 0) > 0
    ]
    year = int(event["raceDate"][:4])

    # These years only expose the main race as gender or category-specific courses.
    if year == 2007:
        return [course for course in courses if float(course.get("distUnit") or 0) > 30000]
    if year == 2003:
        return [course for course in courses if float(course.get("distUnit") or 0) > 30000]

    named_main = [
        course for course in courses
        if course["courseName"].strip().lower() == "iceman"
    ]
    if named_main:
        return [max(named_main, key=lambda course: int(course["resultCount"]))]

    long_course = [
        course for course in courses
        if float(course.get("distUnit") or 0) > 30000
        and not re.search(r"\b(tandem|pro|cat\s*1|singlespeed)\b", course["courseName"], re.I)
    ]
    if not long_course:
        return []
    return [max(long_course, key=lambda course: int(course["resultCount"]))]


def race_date(event):
    if event.get("raceDateString"):
        return datetime.strptime(event["raceDateString"], "%m/%d/%Y").date().isoformat()
    return event["raceDate"][:10]


def division_group(page, course_id, division_id):
    matches = [
        group for group in page
        if group.get("bracketId") == division_id
        and (group.get("eventCourseId") == course_id or group.get("totalAthletes") == 0)
    ]
    if len(matches) != 1:
        raise ValueError(f"Athlinks response has no unique division {division_id} for course {course_id}")
    return matches[0]


def fetch_division_page(event_id, course_id, division_id, offset, expected=None):
    for attempt in range(5):
        page = fetch_json(api_url(event_id, course_id, offset, division_id))
        group = division_group(page, course_id, division_id) if page else None
        if group is not None and group["totalAthletes"] > 0 and (
            expected is None or group["totalAthletes"] == expected
        ):
            return page
        if attempt < 4:
            time.sleep(2**attempt)
    if expected is None or offset >= expected - PAGE_SIZE:
        return page
    raise ValueError(f"Athlinks division {division_id} returned an incomplete page at {offset}")


def write_divisions(event, courses):
    year = int(event["raceDate"][:4])
    event_id = int(event["raceID"])
    folder = DATA / str(year) / "raw"
    metadata_path = folder / "athlinks-metadata.json"
    divisions_path = folder / "athlinks-divisions.json"
    metadata = (
        json.loads(metadata_path.read_text()) if metadata_path.exists()
        else fetch_json(f"https://results.athlinks.com/metadata/event/{event_id}")
    )
    if metadata.get("eventId") != event_id:
        raise ValueError(f"{metadata_path} contains the wrong event")
    course_ids = {course["eventCourseID"] for course in courses}
    selected = [
        course for course in metadata["eventCourseMetadata"]
        if course["eventCourseId"] in course_ids
    ]
    if {course["eventCourseId"] for course in selected} != course_ids:
        raise ValueError(f"{metadata_path} is missing course metadata")
    excluded = {"overall", "male", "female", "undefined", "relay", "team relay"}
    wanted = {
        (course["eventCourseId"], division["id"]): division["name"]
        for course in selected for division in course["metadata"]["divisions"]
        if division["name"].strip().lower() not in excluded
    }
    cached = {}
    if divisions_path.exists():
        existing = json.loads(divisions_path.read_text())
        if existing["eventId"] != event_id:
            raise ValueError(f"{divisions_path} contains the wrong event")
        cached = {
            (d["courseId"], d["divisionId"]): d for d in existing["divisions"]
            if (d["totalAthletes"] > 0 or d.get("emptyChecked"))
            and wanted.get((d["courseId"], d["divisionId"])) == d["name"]
        }
        if set(cached) == set(wanted):
            print(f"{year}: divisions already downloaded", flush=True)
            return

    downloaded = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_division_page, event_id, course_id, division_id, 0):
                (course_id, division_id)
            for course_id, division_id in wanted
            if (course_id, division_id) not in cached
        }
        later = {}
        for future in concurrent.futures.as_completed(futures):
            course_id, division_id = futures[future]
            page = future.result()
            if page == []:
                downloaded[(course_id, division_id)] = {
                    "courseId": course_id, "divisionId": division_id,
                    "name": wanted[(course_id, division_id)],
                    "available": False, "totalAthletes": 0, "returnedResults": 0,
                    "pages": [[]], "emptyChecked": True,
                }
                print(f"{year}: division {division_id} returned no result group", flush=True)
                continue
            group = division_group(page, course_id, division_id)
            total = int(group["totalAthletes"])
            downloaded[(course_id, division_id)] = {
                "courseId": course_id, "divisionId": division_id,
                "name": wanted[(course_id, division_id)],
                "totalAthletes": total, "pages": [(0, page)],
            }
            if total == 0:
                downloaded[(course_id, division_id)]["emptyChecked"] = True
            for offset in range(PAGE_SIZE, total, PAGE_SIZE):
                later[executor.submit(
                    fetch_division_page, event_id, course_id, division_id, offset, total,
                )] = (course_id, division_id, offset)
        for future in concurrent.futures.as_completed(later):
            course_id, division_id, offset = later[future]
            page = future.result()
            if not page:
                downloaded[(course_id, division_id)]["pages"].append((offset, page))
                continue
            group = division_group(page, course_id, division_id)
            result = downloaded[(course_id, division_id)]
            if (
                group["totalAthletes"] == 0
                and not group["interval"]["intervalResults"]
                and offset >= result["totalAthletes"] - PAGE_SIZE
            ):
                result["pages"].append((offset, page))
                continue
            if int(group["totalAthletes"]) != result["totalAthletes"]:
                raise ValueError(
                    f"Athlinks total changed for division {division_id} at {offset}: "
                    f"{result['totalAthletes']} to {group['totalAthletes']}"
                )
            result["pages"].append((offset, page))

    for (course_id, division_id), result in downloaded.items():
        if not result.get("available", True):
            continue
        result["pages"].sort(key=lambda item: item[0])
        try:
            rows = deduplicate_rows([
                row for _, page in result["pages"]
                for row in (
                    division_group(page, course_id, division_id)["interval"]["intervalResults"]
                    if page else []
                )
            ], course_id, use_entry_ids=False)
        except ValueError as error:
            raise ValueError(f"Division {division_id} ({result['name']}): {error}") from error
        highest = max((int(row["primaryBracketRank"] or 0) for row in rows), default=0)
        if len(rows) > result["totalAthletes"] or (
            len(rows) < result["totalAthletes"] and highest < result["totalAthletes"]
        ):
            raise ValueError(f"Incomplete results for Athlinks division {division_id}")
        result["returnedResults"] = len(rows)
        result["pages"] = [page for _, page in result["pages"]]
    metadata_path.write_text(json.dumps(metadata, separators=(",", ":"), ensure_ascii=False))
    cached.update(downloaded)
    divisions_path.write_text(json.dumps({
        "eventId": event_id,
        "divisions": [cached[key] for key in sorted(wanted)],
    }, separators=(",", ":"), ensure_ascii=False))
    print(f"{year}: saved {len(wanted)} divisions", flush=True)


def write_year(event, courses):
    year = int(event["raceDate"][:4])
    event_id = int(event["raceID"])
    folder = DATA / str(year)
    raw_folder = folder / "raw"
    raw_path = raw_folder / "athlinks-results.json"
    race_path = folder / "race.json"
    existing_config = json.loads(race_path.read_text()) if race_path.exists() else None
    course_ids = {course["eventCourseID"] for course in courses}
    if raw_path.exists() and race_path.exists():
        existing = json.loads(raw_path.read_text())
        athlinks_config = existing_config.get("athlinksIdentity", existing_config)
        if (
            existing.get("eventId") == event_id
            and athlinks_config.get("eventId") == event_id
            and {course["courseId"] for course in existing.get("courses", [])} == course_ids
        ):
            print(f"{year}: already downloaded", flush=True)
            return

    print(f"{year}: downloading {len(courses)} course(s)", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        first_pages = {
            executor.submit(fetch_course_page, event_id, course["eventCourseID"], 0): course
            for course in courses
        }
        prepared = {}
        later_pages = {}
        for future in concurrent.futures.as_completed(first_pages):
            course = first_pages[future]
            course_id = course["eventCourseID"]
            page, group = future.result()
            expected = int(group["totalAthletes"])
            prepared[course_id] = {
                "courseId": course_id,
                "courseName": course["courseName"],
                "totalAthletes": expected,
                "pages": [(0, page)],
            }
            for offset in range(PAGE_SIZE, expected, PAGE_SIZE):
                later_pages[executor.submit(
                    fetch_course_page, event_id, course_id, offset, expected,
                )] = (course_id, offset)

        for future in concurrent.futures.as_completed(later_pages):
            course_id, offset = later_pages[future]
            page, group = future.result()
            if group is None:
                continue
            course = prepared[course_id]
            if int(group["totalAthletes"]) != course["totalAthletes"]:
                raise ValueError(f"Athlinks total changed for course {course_id}")
            course["pages"].append((offset, page))

    downloaded = []
    for course in courses:
        course_id = course["eventCourseID"]
        result = prepared[course_id]
        result["pages"].sort(key=lambda item: item[0])
        fetched_rows = [
            row
            for _, page in result["pages"]
            for row in course_group(page, course_id)["interval"]["intervalResults"]
        ]
        rows = deduplicate_rows(fetched_rows, course_id)
        if len(rows) > result["totalAthletes"]:
            raise ValueError(
                f"Athlinks course {course_id}: downloaded more rows than its highest place"
            )
        highest_place = max(
            (int(row["overallRank"]) for row in rows if str(row.get("overallRank", "")).isdigit()),
            default=0,
        )
        if highest_place < result["totalAthletes"]:
            raise ValueError(
                f"Athlinks course {course_id}: highest downloaded place {highest_place} "
                f"does not reach {result['totalAthletes']}"
            )
        result["returnedResults"] = len(rows)
        result["highestPlace"] = highest_place
        entry_ids = [row["entryId"] for row in rows if row.get("entryId") not in (None, 0)]
        if len(entry_ids) != len(set(entry_ids)):
            raise ValueError(f"Athlinks course {course_id} has duplicate entries across pages")
        result["pages"] = [page for _, page in result["pages"]]
        downloaded.append(result)

    raw_folder.mkdir(parents=True, exist_ok=True)
    source = {
        "eventId": event_id,
        "courses": sorted(downloaded, key=lambda course: course["courseId"]),
    }
    (raw_folder / "athlinks-results.json").write_text(json.dumps(
        source, separators=(",", ":"), ensure_ascii=False,
    ))

    ordered_course_ids = [course["courseId"] for course in downloaded]
    primary_course_id = courses[0]["eventCourseID"]
    config = {
        "year": year,
        "date": race_date(event),
        "resultsUrl": (
            f"https://www.athlinks.com/event/{MASTER_EVENT_ID}/results/"
            f"Event/{event_id}/Course/{primary_course_id}/Results?page=1"
        ),
        "resultsFormat": "athlinks",
        "sourceName": "Athlinks results",
        "eventId": event_id,
        "courseIds": ordered_course_ids,
        "divisionFromCourse": year == 2003,
        "firstStart": None,
        "waveSeconds": None,
        "podiumDepth": 5,
        "sources": {"results": "raw/athlinks-results.json"},
    }
    if existing_config and existing_config.get("resultsFormat") != "athlinks":
        existing_config["athlinksIdentity"] = {
            "eventId": event_id,
            "courseIds": ordered_course_ids,
            "resultsUrl": config["resultsUrl"],
            "results": "raw/athlinks-results.json",
        }
        config = existing_config
    race_path.write_text(json.dumps(config, indent=2) + "\n")
    total = sum(course["returnedResults"] for course in downloaded)
    listed = sum(course["totalAthletes"] for course in downloaded)
    count_note = f" ({listed} highest places)" if listed != total else ""
    print(f"{year}: saved {total} entries{count_note} from {len(courses)} course(s)", flush=True)


def main():
    master = fetch_json(MASTER_API)
    if not master.get("success"):
        raise RuntimeError(f"Athlinks event lookup failed: {master.get('errorMessage')}")

    events = [
        event for event in master["result"]["eventRaces"]
        if 2001 <= int(event["raceDate"][:4]) <= 2025
    ]
    events.sort(key=lambda event: event["raceDate"], reverse=True)

    for event in events:
        year = int(event["raceDate"][:4])
        courses = selected_courses(event)
        if not courses:
            print(f"{year}: no published results; skipping", flush=True)
            continue
        write_year(event, courses)
        write_divisions(event, courses)
        race_path = DATA / str(year) / "race.json"
        config = json.loads(race_path.read_text())
        if config["resultsFormat"] == "athlinks":
            config["sources"]["divisions"] = "raw/athlinks-divisions.json"
        else:
            config["athlinksIdentity"]["divisions"] = "raw/athlinks-divisions.json"
        race_path.write_text(json.dumps(config, indent=2) + "\n")

    print("Athlinks download complete", flush=True)


if __name__ == "__main__":
    main()
