import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.build_data import athlinks_divisions, parse_athlinks, published_age, supplement_athlinks_ids
from scripts.download_athlinks import deduplicate_rows, division_group, fetch_division_page


class AthlinksIdentityTests(unittest.TestCase):
    def test_published_age_handles_source_placeholders(self):
        for value in (None, "", 0, -1, "N/A", "unknown", 121):
            with self.subTest(value=value):
                self.assertIsNone(published_age(value))
        for value, expected in ((25, 25), (" 46 ", 46), ("9", 9)):
            self.assertEqual(published_age(value), expected)

    def setUp(self):
        self.rider = {
            "bib": 123, "name": "Rider One", "gender": "M", "net": 3600,
            "wave": 10, "division": "Men 40", "status": 1,
        }
        self.source = {**self.rider, "athlinksRacerId": 456}

    def test_supplements_only_the_id(self):
        original = dict(self.rider)
        self.source["name"] = " RIDER ONE "
        self.source["wave"] = None
        self.assertEqual(supplement_athlinks_ids([self.rider], [self.source]), 1)
        self.assertEqual(self.rider, {**original, "athlinksRacerId": 456})

    def test_skips_missing_ids(self):
        for missing in (None, 0):
            with self.subTest(missing=missing):
                self.source["athlinksRacerId"] = missing
                self.assertEqual(supplement_athlinks_ids([self.rider], [self.source]), 0)
                self.assertNotIn("athlinksRacerId", self.rider)

    def test_rejects_mismatched_results(self):
        for field, value in (("bib", 999), ("name", "Other"), ("gender", "F"), ("net", 3601)):
            with self.subTest(field=field):
                source = {**self.source, field: value}
                with self.assertRaisesRegex(ValueError, "no unique matching result"):
                    supplement_athlinks_ids([self.rider], [source])

    def test_rejects_ambiguous_primary_results(self):
        with self.assertRaisesRegex(ValueError, "no unique matching result"):
            supplement_athlinks_ids([self.rider, dict(self.rider)], [self.source])

    def test_rejects_multiple_source_identities(self):
        with self.assertRaisesRegex(ValueError, "Multiple Athlinks identities"):
            supplement_athlinks_ids([self.rider], [self.source, {**self.source, "athlinksRacerId": 789}])


class AthlinksDivisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        (self.folder / "raw").mkdir()
        self.overall_path = self.folder / "raw" / "athlinks-results.json"
        self.division_path = self.folder / "raw" / "athlinks-divisions.json"
        self.row = {
            "entryId": 1, "bib": "10", "displayName": "Rider One", "gender": "M",
            "overallRank": 10, "primaryBracketRank": 2, "genderRank": 9,
            "time": {"timeInMillis": 3600000},
        }
        self.group = {
            "eventCourseId": 20, "bracketId": 30, "bracketType": "AGE", "totalAthletes": 1,
            "interval": {"intervalResults": [self.row]},
        }
        self.division = {
            "courseId": 20, "divisionId": 30, "name": " M 40-44 ",
            "totalAthletes": 1, "returnedResults": 1, "pages": [[self.group]],
        }
        self.config = {
            "eventId": 100, "courseIds": [20],
            "sources": {"divisions": "raw/athlinks-divisions.json"},
        }
        self.write_sources([self.row], [self.division])

    def write_sources(self, rows, divisions):
        self.overall_path.write_text(json.dumps({
            "eventId": 100,
            "courses": [{
                "courseId": 20, "courseName": "Main", "totalAthletes": len(rows),
                "pages": [[{
                    "eventCourseId": 20, "totalAthletes": len(rows),
                    "interval": {"intervalResults": rows},
                }]],
            }],
        }))
        self.division_path.write_text(json.dumps({"eventId": 100, "divisions": divisions}))

    def test_joins_official_division_rank_without_changing_overall_rank(self):
        rider = parse_athlinks(self.overall_path, self.config)[0]
        self.assertEqual((rider["division"], rider["divisionRank"], rider["status"]), ("M 40-44", 2, 10))
        self.assertIsNone(rider["wave"])

    def test_ignores_gender_only_groups(self):
        self.group["bracketType"] = "GENDER"
        self.write_sources([self.row], [self.division])
        self.assertEqual(parse_athlinks(self.overall_path, self.config)[0]["division"], "")

    def test_ambiguous_memberships_are_not_guessed(self):
        other = {
            **self.division, "divisionId": 31, "name": "Other division",
            "pages": [[{**self.group, "bracketId": 31}]],
        }
        self.write_sources([self.row], [self.division, other])
        self.assertEqual(parse_athlinks(self.overall_path, self.config)[0]["division"], "")

    def test_preserves_course_based_divisions(self):
        self.config["divisionFromCourse"] = True
        rider = parse_athlinks(self.overall_path, self.config)[0]
        self.assertEqual((rider["division"], rider["divisionRank"]), ("Main", 10))

    def test_missing_membership_stays_missing(self):
        self.write_sources([self.row], [])
        self.assertEqual(parse_athlinks(self.overall_path, self.config)[0]["division"], "")

    def test_rejects_wrong_event_and_incomplete_division_rows(self):
        with self.assertRaisesRegex(ValueError, "wrong Athlinks division event"):
            athlinks_divisions(self.division_path, 101, {20})
        self.division["returnedResults"] = 2
        self.write_sources([self.row], [self.division])
        with self.assertRaisesRegex(ValueError, "incomplete division download"):
            parse_athlinks(self.overall_path, self.config)

    def test_rejects_division_result_without_matching_overall_entry(self):
        changed = {**self.row, "time": {"timeInMillis": 3601000}}
        self.write_sources([changed], [self.division])
        with self.assertRaisesRegex(ValueError, "do not match the overall"):
            parse_athlinks(self.overall_path, self.config)

    def test_deduplicates_overlapping_pages(self):
        self.division["pages"].append([self.group])
        self.write_sources([self.row], [self.division])
        self.assertEqual(parse_athlinks(self.overall_path, self.config)[0]["divisionRank"], 2)

    def test_downloader_preserves_same_name_entries_with_shared_entry_id(self):
        other = {**self.row, "bib": "11", "overallRank": 11, "primaryBracketRank": 3}
        self.assertEqual(
            deduplicate_rows([self.row, other, self.row], 20, use_entry_ids=False),
            [self.row, other],
        )

    def test_accepts_empty_group_only_for_the_requested_division(self):
        group = {**self.group, "eventCourseId": 0, "totalAthletes": 0}
        self.assertEqual(division_group([group], 20, 30), group)
        with self.assertRaisesRegex(ValueError, "no unique division"):
            division_group([group], 20, 31)

    def test_retries_inconsistent_pagination_response(self):
        empty = {**self.group, "totalAthletes": 0}
        with patch("scripts.download_athlinks.fetch_json", side_effect=[[empty], [self.group]]) as fetch:
            with patch("scripts.download_athlinks.time.sleep"):
                page = fetch_division_page(100, 20, 30, 100, expected=1)
        self.assertEqual(page, [self.group])
        self.assertEqual(fetch.call_count, 2)

    def test_retries_transiently_empty_first_page(self):
        empty = {
            **self.group, "totalAthletes": 0, "eventCourseId": 0,
            "interval": {"intervalResults": []},
        }
        with patch("scripts.download_athlinks.fetch_json", side_effect=[[empty], [self.group]]) as fetch:
            with patch("scripts.download_athlinks.time.sleep"):
                page = fetch_division_page(100, 20, 30, 0)
        self.assertEqual(page, [self.group])
        self.assertEqual(fetch.call_count, 2)

    def test_reports_persistently_empty_division_without_fabricating_results(self):
        with patch("scripts.download_athlinks.fetch_json", return_value=[]) as fetch:
            with patch("scripts.download_athlinks.time.sleep"):
                page = fetch_division_page(100, 20, 30, 0)
        self.assertEqual(page, [])
        self.assertEqual(fetch.call_count, 5)

    def test_rejects_persistently_incomplete_middle_page(self):
        with patch("scripts.download_athlinks.fetch_json", return_value=[]):
            with patch("scripts.download_athlinks.time.sleep"):
                with self.assertRaisesRegex(ValueError, "incomplete page"):
                    fetch_division_page(100, 20, 30, 100, expected=300)
