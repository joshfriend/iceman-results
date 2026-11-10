"""Archive published split reports without downloading individual certificates.

Usage: python3 -m scripts.download_splits [YEAR ...]
"""

import concurrent.futures
import gzip
import json
import sys
import urllib.parse

from scripts.download_athlinks import DATA, PAGE_SIZE, RESULTS_API, deduplicate_rows, fetch_json
from scripts.download_supplemental import raceresult


def write_json(path, payload):
    content = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if path.suffix == ".gz":
        content = gzip.compress(content, mtime=0)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def interval_url(event_id, course_id, division_id, interval_id, offset):
    query = urllib.parse.urlencode({
        "eventCourseId": course_id, "divisionId": division_id,
        "intervalId": interval_id, "from": offset, "limit": PAGE_SIZE,
    })
    return f"{RESULTS_API}/{event_id}?{query}"


def interval_group(page, event_id, course_id, division_id, interval_id):
    groups = [
        group for group in page
        if group.get("eventId") == event_id
        and group.get("eventCourseId") == course_id
        and group.get("bracketId") == division_id
        and group.get("interval", {}).get("intervalId") == interval_id
    ]
    if len(groups) != 1:
        raise ValueError(f"Athlinks {event_id}/{course_id}/{interval_id}: no unique interval")
    return groups[0]


def download_interval(event_id, course, interval):
    course_id = course["eventCourseId"]
    divisions = [
        division for division in course["metadata"]["divisions"]
        if division["name"].strip().lower() == "overall"
    ]
    if len(divisions) != 1:
        raise ValueError(f"Athlinks {event_id}/{course_id}: no unique overall division")
    division_id = divisions[0]["id"]

    def fetch_page(offset):
        url = interval_url(event_id, course_id, division_id, interval["id"], offset)
        page = fetch_json(url)
        group = interval_group(page, event_id, course_id, division_id, interval["id"])
        return page, group

    first, group = fetch_page(0)
    total = group["totalAthletes"]
    pages = [first]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        for page, later in executor.map(fetch_page, range(PAGE_SIZE, total, PAGE_SIZE)):
            if later["totalAthletes"] != total:
                raise ValueError(f"Athlinks {event_id}/{course_id}: changed interval count")
            pages.append(page)
    rows = [
        row for page in pages
        for row in interval_group(page, event_id, course_id, division_id, interval["id"])[
            "interval"
        ]["intervalResults"]
    ]
    # Overlapping Athlinks pages can return the same reading with entryId=0
    # in cached rows and a populated ID in uncached rows. Keep original pages.
    unique = deduplicate_rows(
        [{**row, "entryId": 0} for row in rows], course_id, use_entry_ids=False,
    )
    if len(unique) != total:
        raise ValueError(
            f"Athlinks {event_id}/{course_id}/{interval['id']}: "
            f"expected {total} results, received {len(unique)}"
        )
    return {
        "metadata": interval, "divisionId": division_id, "totalAthletes": total,
        "sourceUrl": interval_url(event_id, course_id, division_id, interval["id"], 0),
        "pages": pages,
    }


def athlinks_sources(folder):
    """Use every archived course, including separate pro and short-course results."""
    events = {}
    for path in sorted((folder / "raw").glob("*results.json")):
        source = json.loads(path.read_text())
        if "eventId" in source and "courses" in source:
            events.setdefault(source["eventId"], set()).update(
                course["courseId"] for course in source["courses"]
            )
    sources = []
    for event_id, course_ids in events.items():
        metadata_paths = sorted((folder / "raw").glob("*metadata.json"))
        metadata = next((
            payload for path in metadata_paths
            if (payload := json.loads(path.read_text())).get("eventId") == event_id
        ), None)
        if metadata is None:
            metadata = fetch_json(f"https://results.athlinks.com/metadata/event/{event_id}")
        if metadata.get("eventId") != event_id:
            raise ValueError(f"{folder}: received wrong Athlinks metadata")
        courses = []
        found = set()
        for course in metadata["eventCourseMetadata"]:
            course_id = course["eventCourseId"]
            if course_id not in course_ids:
                continue
            found.add(course_id)
            intervals = course["metadata"]["intervals"]
            # Legacy single-leg races mark their entire course as isFull=false.
            if not any(interval["isFull"] for interval in intervals):
                continue
            splits = [
                download_interval(event_id, course, interval)
                for interval in intervals if not interval["isFull"]
            ]
            if splits:
                courses.append({
                    "courseId": course_id, "courseName": course["eventCourseName"],
                    "intervals": splits,
                })
        if found != course_ids:
            raise ValueError(f"{folder}: missing Athlinks course metadata: {course_ids - found}")
        if courses:
            relative = f"raw/athlinks-splits-{event_id}.json.gz"
            write_json(folder / relative, {"eventId": event_id, "courses": courses})
            sources.append({
                "format": "athlinks", "path": relative, "eventId": event_id,
                "courses": [{
                    "courseId": course["courseId"], "name": course["courseName"],
                    "intervals": [{
                        "name": interval["metadata"]["name"],
                        "id": interval["metadata"]["id"],
                        "results": interval["totalAthletes"],
                        "sourceUrl": interval["sourceUrl"],
                    } for interval in course["intervals"]],
                } for course in courses],
            })
    return sources


def registericeman_sources(folder):
    sources = []
    for path in sorted((folder / "raw").glob("*results.json")):
        source = json.loads(path.read_text())
        if "pages" not in source or "resultSet" not in source["pages"][0]:
            continue
        result_sets = [page["resultSet"] for page in source["pages"]]
        first = result_sets[0]
        splits = first["splits"]
        if len(splits) < 2:
            continue
        result_set_id = first["setInfo"]["individual_result_set_id"]
        if any(
            result["splits"] != splits
            or result["setInfo"]["individual_result_set_id"] != result_set_id
            or result["numResults"] != first["numResults"]
            for result in result_sets
        ):
            raise ValueError(f"{path}: inconsistent split result pages")
        count = sum(len(result["results"]) for result in result_sets)
        if count != first["numResults"]:
            raise ValueError(f"{path}: incomplete split result pages")
        sources.append({
            "format": "registericeman", "path": str(path.relative_to(folder)),
            "sourceUrl": source["sourceUrl"], "resultSetId": result_set_id,
            "results": count, "intervals": splits,
        })
    return sources


def raceresult_sources(folder, race):
    url = race["resultsUrl"].split("/results")[0]
    config = fetch_json(f"{url}/results/config")
    sources = []
    for report in config["TabConfig"]["Lists"]:
        if "overall with splits" not in report.get("ShowAs", "").lower():
            continue
        # The existing helper is tied to the 2026 event.
        if url != "https://my.raceresult.com/421674":
            raise ValueError(f"{url}: unsupported RaceResult event")
        payload = raceresult(config, report["Name"])
        if payload["DataFields"][:2] != ["BIB", "ID"]:
            raise ValueError(f"{url}: split report is missing participant identifiers")
        relative = f"raw/raceresult-splits-{report['ID']}.json.gz"
        write_json(folder / relative, payload)
        sources.append({
            "format": "raceresult", "path": relative, "name": report["ShowAs"],
            "sourceUrl": f"{url}/results#0_{report['ID']}",
            "results": len(payload["data"]),
        })
    if not sources:
        raise ValueError(f"{url}: no published overall split reports")
    return sources


def download(years=None):
    inventory_path = DATA / "splits.json"
    inventory = json.loads(inventory_path.read_text()) if inventory_path.exists() else {"years": []}
    existing = {entry["year"]: entry for entry in inventory["years"]}
    folders = sorted(path for path in DATA.iterdir() if path.name.isdigit() and path.is_dir())
    if years and set(years) - {int(folder.name) for folder in folders}:
        raise ValueError("Requested year has no archived race")
    for folder in folders:
        year = int(folder.name)
        if years and year not in years:
            continue
        race = json.loads((folder / "race.json").read_text())
        sources = athlinks_sources(folder) + registericeman_sources(folder)
        if "my.raceresult.com" in race["resultsUrl"]:
            sources.extend(raceresult_sources(folder, race))
        existing[year] = {"year": year, "sources": sources}
        inventory["years"] = [existing[key] for key in sorted(existing, reverse=True)]
        write_json(inventory_path, inventory)
        print(f"{year}: saved {len(sources)} split sources", flush=True)


if __name__ == "__main__":
    download({int(year) for year in sys.argv[1:]} or None)
