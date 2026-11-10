"""Download separately published long-course junior and pro results.

Usage: python3 -m scripts.download_supplemental
Existing primary results and Athlinks identity supplements are left untouched.
"""

import json
import urllib.parse
import urllib.request

from scripts.download_athlinks import DATA, fetch_course_page, fetch_json


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


def main():
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
            if format_name == "athlinks":
                entry.update(eventId=event_id, courseIds=[course_id])
            additional.append(entry)
            print(f"{year}: saved {group} results")
        race["additionalResults"] = additional
        race_path.write_text(json.dumps(race, indent=2) + "\n")


if __name__ == "__main__":
    main()
