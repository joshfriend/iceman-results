"""Write an offline coverage/source inventory from the archived data."""

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def audit_year(folder):
    config = json.loads((folder / "race.json").read_text())
    results = json.loads((folder / "results.json").read_text())
    riders = [dict(zip(results["fields"], row)) for row in results["riders"]]
    included = set(config.get("courseIds", config.get("athlinksIdentity", {}).get("courseIds", [])))
    for source in config.get("additionalResults", []):
        included.update(source.get("courseIds", []))
    metadata_path = folder / "raw/athlinks-metadata.json"
    courses = []
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text())
        courses = [{
            "id": course["eventCourseId"],
            "name": course["eventCourseName"],
            "included": course["eventCourseId"] in included,
            "categoryLabels": [
                division["name"].strip() for division in course["metadata"]["divisions"]
                if division["name"].strip().lower() not in {"overall", "male", "female", "undefined"}
            ],
        } for course in metadata["eventCourseMetadata"]]
    assignment_fields = set()
    raw_path = folder / "raw/athlinks-results.json"
    if raw_path.exists():
        raw = json.loads(raw_path.read_text())
        for course in raw["courses"]:
            for page in course["pages"]:
                for group in page:
                    for row in group["interval"]["intervalResults"]:
                        assignment_fields.update(
                            key for key in row if any(word in key.lower() for word in ("wave", "corral", "start"))
                        )
    event_counts = {}
    for rider in riders:
        event = rider.get("raceEvent", "iceman")
        counts = event_counts.setdefault(event, {"entries": 0, "finishers": 0})
        counts["entries"] += 1
        counts["finishers"] += isinstance(rider["status"], int)
    return {
        "year": config["year"],
        "entries": len(riders),
        "events": dict(sorted(event_counts.items())),
        "withWave": sum(rider["wave"] is not None for rider in riders),
        "withStart": sum(rider["start"] is not None for rider in riders),
        "raceGroups": dict(sorted(Counter(rider["raceGroup"] for rider in riders).items())),
        "raceGroupEvidence": dict(sorted(Counter(
            rider.get("raceGroupSource") or "unknown" for rider in riders
        ).items())),
        "unclassifiedDivisions": dict(sorted(Counter(
            rider["division"] for rider in riders if rider["raceGroup"] == "unclassified"
        ).items())),
        "athlinksAssignmentFields": sorted(assignment_fields),
        "courses": courses,
        "metadataSources": config.get("riderMetadata", []),
        "metadataCoverage": results["race"].get("metadataCoverage", []),
    }


def main():
    years = [
        audit_year(folder) for folder in sorted(DATA.iterdir())
        if folder.is_dir() and (folder / "race.json").exists()
    ]
    path = DATA / "source-audit.json"
    path.write_text(json.dumps({"years": years}, indent=2, ensure_ascii=False) + "\n")
    for year in years:
        print(f"{year['year']}: {year['withWave']}/{year['entries']} waves; "
              f"{year['raceGroups'].get('unclassified', 0)} unclassified")
    print(f"Wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
