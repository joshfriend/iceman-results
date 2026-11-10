"""Download separate junior/pro results and archived category tables.

Usage: python3 -m scripts.download_supplemental
Existing primary results and Athlinks identity supplements are left untouched.
"""

import json
import urllib.parse
import urllib.request

from scripts.download_athlinks import (
    DATA, MASTER_API, MASTER_EVENT_ID, PAGE_SIZE, deduplicate_rows, fetch_course_page,
    fetch_json, write_divisions,
)
from scripts.build_data import parse_runmichigan


ARCHIVED_CATEGORIES = {
    2008: "https://www.runmichigan.com/results/full.php/2008/11/08/iceman-cometh-challenge-2.html",
    2010: "https://www.runmichigan.com/results/full.php/2010/11/06/iceman-cometh-challenge-3.html",
}


def download_archived_categories():
    for year, url in ARCHIVED_CATEGORIES.items():
        folder = DATA / str(year)
        relative = "raw/runmichigan-results.html"
        path = folder / relative
        if not path.exists():
            request = urllib.request.Request(url, headers={"User-Agent": "iceman-results data downloader"})
            with urllib.request.urlopen(request, timeout=30) as response:
                html = response.read().decode("utf-8")
            if f"{year} ICEMAN COMETH CHALLENGE" not in html:
                raise ValueError(f"{url}: received the wrong archived event")
            path.write_text(html)
        records = list(parse_runmichigan(path))
        if not records or not any(row["raceGroup"] == "pro" for row in records):
            raise ValueError(f"{url}: no published category results")
        race_path = folder / "race.json"
        race = json.loads(race_path.read_text())
        sources = race.setdefault("riderMetadata", [])
        entry = {"format": "runmichigan", "path": relative, "sourceUrl": url}
        existing = [source for source in sources if source["path"] == relative]
        if existing and existing != [entry]:
            raise ValueError(f"{race_path}: conflicting archived metadata configuration")
        if not existing:
            sources.append(entry)
        race_path.write_text(json.dumps(race, indent=2) + "\n")
        print(f"{year}: archived {len(records)} published category rows")


def registericeman(result_set):
    url = f"https://www.registericeman.com/Race/Results/86232?resultSetId={result_set}"
    pages = []
    page_number = 1
    while True:
        request = urllib.request.Request(
            f"{url}&page={page_number}&num=100&search=",
            headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            page = json.load(response)
        if page["resultSet"]["setInfo"]["individual_result_set_id"] != result_set:
            raise ValueError(f"{url}: received the wrong result set")
        if not page["resultSet"]["results"]:
            raise ValueError(f"{url}: empty page before all results were downloaded")
        pages.append(page)
        count = sum(len(p["resultSet"]["results"]) for p in pages)
        if count >= page["resultSet"]["numResults"]:
            if count != page["resultSet"]["numResults"]:
                raise ValueError(f"{url}: inconsistent result count")
            return {"sourceUrl": url, "pages": pages}
        page_number += 1


def raceresult(config, name):
    lists = [item for item in config["TabConfig"]["Lists"] if item["Name"] == name]
    if len(lists) != 1:
        raise ValueError(f"RaceResult has no unique list {name}")
    query = urllib.parse.urlencode({
        "key": config["key"], "listname": name, "page": "results",
        "contest": 0, "r": "all", "openedGroups": "{}",
    })
    result = fetch_json(f"https://my.raceresult.com/421674/results/list?{query}")
    if not result["data"] or result["list"]["ListName"] != name:
        raise ValueError(f"RaceResult returned the wrong or empty list for {name}")
    expected = f"Number of records: {len(result['data'])}"
    if result["list"]["ListFooterText"] != expected:
        raise ValueError(f"RaceResult returned an incomplete list for {name}")
    return result


def download_slush_cup_athlinks():
    master = fetch_json(MASTER_API)
    if not master.get("success"):
        raise RuntimeError(f"Athlinks event lookup failed: {master.get('errorMessage')}")

    events = [
        event for event in master["result"]["eventRaces"]
        if 2001 <= int(event["raceDate"][:4]) <= 2025
    ]
    for event in events:
        year = int(event["raceDate"][:4])
        courses = [
            course for course in event["eventCourses"]
            if "slush" in course["courseName"].lower()
            and "tandem" not in course["courseName"].lower()
            and int(course.get("resultCount") or 0) > 0
        ]
        if not courses:
            continue

        event_id = int(event["raceID"])
        course_ids = {course["eventCourseID"] for course in courses}
        folder = DATA / str(year)
        race_path = folder / "race.json"
        race = json.loads(race_path.read_text())
        existing = next((
            item for item in race.get("additionalResults", [])
            if item.get("raceEvent") == "slush-cup"
        ), None)
        if (
            existing
            and existing.get("eventId") == event_id
            and set(existing.get("courseIds", [])) == course_ids
            and all((folder / existing[key]).exists() for key in ("results", "metadata", "divisions"))
        ):
            print(f"{year}: Slush Cup results already downloaded")
            continue
        raw_folder = folder / "raw"
        raw_folder.mkdir(parents=True, exist_ok=True)
        results_path = raw_folder / "slush-cup-results.json"
        downloaded = []
        for course in courses:
            course_id = course["eventCourseID"]
            page, first_group = fetch_course_page(event_id, course_id, 0)
            if first_group is None:
                raise ValueError(f"{year}: empty Slush Cup course {course_id}")
            total = int(first_group["totalAthletes"])
            pages = [page]
            rows = list(first_group["interval"]["intervalResults"])
            for offset in range(PAGE_SIZE, total, PAGE_SIZE):
                page, group = fetch_course_page(event_id, course_id, offset, total)
                if group is None or int(group["totalAthletes"]) != total:
                    raise ValueError(f"{year}: incomplete Slush Cup course {course_id}")
                pages.append(page)
                rows.extend(group["interval"]["intervalResults"])
            unique_rows = deduplicate_rows(rows, course_id)
            highest_place = max(
                (int(row["overallRank"]) for row in unique_rows
                 if str(row.get("overallRank", "")).isdigit()),
                default=0,
            )
            if len(unique_rows) != total or highest_place < int(course["resultCount"]):
                raise ValueError(f"{year}: incomplete Slush Cup results for course {course_id}")
            downloaded.append({
                "courseId": course_id,
                "courseName": course["courseName"],
                "totalAthletes": total,
                "pages": pages,
            })

        results_path.write_text(json.dumps({
            "eventId": event_id,
            "courses": sorted(downloaded, key=lambda course: course["courseId"]),
        }, separators=(",", ":"), ensure_ascii=False))

        metadata_path = raw_folder / "slush-cup-metadata.json"
        metadata = fetch_json(f"https://results.athlinks.com/metadata/event/{event_id}")
        if metadata.get("eventId") != event_id:
            raise ValueError(f"{metadata_path} contains the wrong Athlinks event")
        metadata_path.write_text(json.dumps(metadata, separators=(",", ":"), ensure_ascii=False))
        write_divisions(
            event, courses, metadata_filename="slush-cup-metadata.json",
            divisions_filename="slush-cup-divisions.json",
        )

        source = {
            "raceEvent": "slush-cup",
            "format": "athlinks",
            "eventId": event_id,
            "courseIds": sorted(course_ids),
            "results": "raw/slush-cup-results.json",
            "metadata": "raw/slush-cup-metadata.json",
            "divisions": "raw/slush-cup-divisions.json",
            "resultsUrl": (
                f"https://www.athlinks.com/event/{MASTER_EVENT_ID}/results/"
                f"Event/{event_id}/Course/{min(course_ids)}/Results?page=1"
            ),
        }
        additional = [
            item for item in race.get("additionalResults", [])
            if item.get("raceEvent") != "slush-cup"
        ]
        additional.append(source)
        race["additionalResults"] = additional
        race_path.write_text(json.dumps(race, indent=2) + "\n")
        print(f"{year}: saved {sum(c['totalAthletes'] for c in downloaded)} Slush Cup results")


def download_2026_slush_cup():
    config = fetch_json("https://my.raceresult.com/421674/results/config")
    name = "03: Result Lists|SlushCup {Overall Results}"
    result = raceresult(config, name)
    path = DATA / "2026/raw/slush-cup-results.json"
    path.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
    race_path = DATA / "2026/race.json"
    race = json.loads(race_path.read_text())
    additional = [
        item for item in race.get("additionalResults", [])
        if item.get("raceEvent") != "slush-cup"
    ]
    additional.append({
        "raceEvent": "slush-cup",
        "format": "raceresult",
        "results": "raw/slush-cup-results.json",
        "resultsUrl": "https://my.raceresult.com/421674/results",
    })
    race["additionalResults"] = additional
    race_path.write_text(json.dumps(race, indent=2) + "\n")
    print(f"2026: saved {len(result['data'])} Slush Cup results")


def main():
    download_archived_categories()
    metadata = json.loads((DATA / "2024/raw/athlinks-metadata.json").read_text())
    course_id = 2525753
    course = next(c for c in metadata["eventCourseMetadata"] if c["eventCourseId"] == course_id)
    event_id = metadata["eventId"]
    first, group = fetch_course_page(event_id, course_id, 0)
    total = group["totalAthletes"]
    pages = [first]
    for offset in range(100, total, 100):
        page, group = fetch_course_page(event_id, course_id, offset, total)
        if group is None:
            raise ValueError("Incomplete 2024 pro results")
        pages.append(page)
    sources = {
        2024: [("pro", "athlinks", {
            "eventId": event_id, "courses": [{
                "courseId": course_id, "courseName": course["eventCourseName"],
                "totalAthletes": total, "pages": pages,
            }],
        })],
        2025: [
            ("junior", "registericeman", registericeman(605207)),
            ("pro", "registericeman", registericeman(605208)),
        ],
    }
    config = fetch_json("https://my.raceresult.com/421674/results/config")
    sources[2026] = [
        ("junior", "raceresult", raceresult(config, "03: Result Lists|JrIceMan {Overall Results}")),
        ("pro", "raceresult", raceresult(config, "03: Result Lists|Pro {Overall Results}")),
    ]
    for year, results in sources.items():
        folder = DATA / str(year)
        race_path = folder / "race.json"
        race = json.loads(race_path.read_text())
        additional = []
        for group, format_name, payload in results:
            path = f"raw/{group}-results.json"
            (folder / path).write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
            entry = {"raceGroup": group, "format": format_name, "results": path}
            if group == "junior":
                entry["raceEvent"] = "junior-iceman"
            if format_name == "athlinks":
                entry.update(eventId=event_id, courseIds=[course_id])
            additional.append(entry)
            print(f"{year}: saved {group} results")
        race["additionalResults"] = additional
        race_path.write_text(json.dumps(race, indent=2) + "\n")
    download_slush_cup_athlinks()
    download_2026_slush_cup()


if __name__ == "__main__":
    main()
