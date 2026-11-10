import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from scripts.download_splits import (
    athlinks_sources, download, download_interval, interval_url, raceresult_sources,
    registericeman_sources, write_json,
)


class SplitDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        (self.folder / "raw").mkdir()
        self.interval = {"id": 30, "name": "Dockery", "isFull": False}
        self.course = {
            "eventCourseId": 20, "eventCourseName": "Iceman",
            "metadata": {
                "divisions": [{"id": 40, "name": "Overall"}],
                "intervals": [
                    {"id": 31, "name": "Full Course", "isFull": True},
                    self.interval,
                ],
            },
        }

    def page(self, offset, total=101):
        return [{
            "eventId": 10, "eventCourseId": 20, "bracketId": 40,
            "totalAthletes": total,
            "interval": {
                "intervalId": 30,
                "intervalResults": [
                    {"entryId": index + 1, "bib": str(index + 1)}
                    for index in range(offset, min(offset + 100, total))
                ],
            },
        }]

    def test_interval_url_includes_overall_division(self):
        query = parse_qs(urlparse(interval_url(10, 20, 40, 30, 100)).query)
        self.assertEqual(query["divisionId"], ["40"])
        self.assertEqual(query["intervalId"], ["30"])
        self.assertEqual(query["from"], ["100"])

    def test_interval_download_paginates_and_preserves_responses(self):
        def fetch(url):
            return self.page(int(parse_qs(urlparse(url).query)["from"][0]))

        with patch("scripts.download_splits.fetch_json", side_effect=fetch) as mocked:
            result = download_interval(10, self.course, self.interval)
        self.assertEqual(mocked.call_count, 2)
        self.assertEqual(result["totalAthletes"], 101)
        self.assertEqual(result["pages"], [self.page(0), self.page(100)])

    def test_interval_rejects_wrong_identity(self):
        page = self.page(0, 1)
        page[0]["interval"]["intervalId"] = 99
        with patch("scripts.download_splits.fetch_json", return_value=page):
            with self.assertRaisesRegex(ValueError, "no unique interval"):
                download_interval(10, self.course, self.interval)

    def test_interval_rejects_incomplete_or_duplicate_results(self):
        for rows in ([], [{"entryId": 1}, {"entryId": 1}]):
            page = self.page(0, 2)
            page[0]["interval"]["intervalResults"] = rows
            with self.subTest(rows=rows):
                with patch("scripts.download_splits.fetch_json", return_value=page):
                    with self.assertRaisesRegex(ValueError, "expected 2 results"):
                        download_interval(10, self.course, self.interval)

    def test_interval_rejects_changing_count(self):
        with patch("scripts.download_splits.fetch_json", side_effect=[
            self.page(0), self.page(100, 102),
        ]):
            with self.assertRaisesRegex(ValueError, "changed interval count"):
                download_interval(10, self.course, self.interval)

    def test_overlapping_pages_allow_missing_entry_ids(self):
        first = self.page(0)
        first[0]["interval"]["intervalResults"].append({"entryId": 0, "bib": "101"})
        with patch("scripts.download_splits.fetch_json", side_effect=[first, self.page(100)]):
            result = download_interval(10, self.course, self.interval)
        self.assertEqual(result["totalAthletes"], 101)
        self.assertEqual(result["pages"][0], first)

    def test_legacy_entire_course_is_not_an_intermediate_split(self):
        write_json(self.folder / "raw/athlinks-results.json", {
            "eventId": 10, "courses": [{"courseId": 20}],
        })
        self.course["metadata"]["intervals"] = [self.interval]
        write_json(self.folder / "raw/athlinks-metadata.json", {
            "eventId": 10, "eventCourseMetadata": [self.course],
        })
        with patch("scripts.download_splits.fetch_json") as fetch:
            self.assertEqual(athlinks_sources(self.folder), [])
            fetch.assert_not_called()

    def test_compressed_archive_round_trip_is_deterministic(self):
        path = self.folder / "raw/splits.json.gz"
        payload = {"name": "Dockery", "pages": [self.page(0, 1)]}
        write_json(path, payload)
        original = path.read_bytes()
        self.assertEqual(json.loads(gzip.decompress(original)), payload)
        write_json(path, payload)
        self.assertEqual(path.read_bytes(), original)
        self.assertFalse(path.with_suffix(".gz.tmp").exists())

    def test_registericeman_reuses_existing_archives(self):
        result = {
            "splits": [{"split_name": "Dockery"}, {"split_name": "Finish"}],
            "setInfo": {"individual_result_set_id": 50},
            "numResults": 1, "results": [[1, "123", "Test Rider"]],
        }
        path = self.folder / "raw/overall-results.json"
        write_json(path, {"sourceUrl": "https://example.com/results", "pages": [
            {"resultSet": result},
        ]})
        sources = registericeman_sources(self.folder)
        self.assertEqual(sources[0]["path"], "raw/overall-results.json")
        self.assertEqual(sources[0]["results"], 1)
        result["numResults"] = 2
        write_json(path, {"pages": [{"resultSet": result}]})
        with self.assertRaisesRegex(ValueError, "incomplete"):
            registericeman_sources(self.folder)

    def test_raceresult_saves_only_overall_split_lists(self):
        config = {"TabConfig": {"Lists": [
            {"Name": "split", "ShowAs": "Iceman Overall with Splits", "ID": "123"},
            {"Name": "gender", "ShowAs": "Iceman Gender with Splits", "ID": "456"},
        ]}}
        payload = {"DataFields": ["BIB", "ID", "Segment1"], "data": [["1", "2", "34:52"]]}
        with patch("scripts.download_splits.fetch_json", return_value=config):
            with patch("scripts.download_splits.raceresult", return_value=payload) as fetch:
                sources = raceresult_sources(self.folder, {
                    "resultsUrl": "https://my.raceresult.com/421674/results",
                })
        fetch.assert_called_once_with(config, "split")
        self.assertEqual(len(sources), 1)
        archived = json.loads(gzip.decompress((self.folder / sources[0]["path"]).read_bytes()))
        self.assertEqual(archived, payload)

    def test_selected_year_preserves_other_inventory_entries(self):
        year_folder = self.folder / "2026"
        year_folder.mkdir()
        write_json(year_folder / "race.json", {"resultsUrl": "https://example.com/results"})
        previous = {"year": 2025, "sources": [{"path": "raw/existing.json"}]}
        write_json(self.folder / "splits.json", {"years": [previous]})
        with patch("scripts.download_splits.DATA", self.folder):
            with patch("scripts.download_splits.athlinks_sources", return_value=[]):
                with patch("scripts.download_splits.registericeman_sources", return_value=[]):
                    download({2026})
        inventory = json.loads((self.folder / "splits.json").read_text())
        self.assertEqual(inventory["years"], [{"year": 2026, "sources": []}, previous])

    def test_unknown_year_is_rejected(self):
        with patch("scripts.download_splits.DATA", self.folder):
            with self.assertRaisesRegex(ValueError, "no archived race"):
                download({1999})


if __name__ == "__main__":
    unittest.main()
