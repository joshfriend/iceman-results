import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.build_data import (
    athlinks_divisions, parse_athlinks, parse_raceresult, parse_registericeman,
    parse_start_list, published_age, race_group, supplement_athlinks_ids,
)
from scripts.download_athlinks import deduplicate_rows, division_group, fetch_division_page
from scripts.download_supplemental import raceresult, registericeman


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

    def test_nonfinish_status_overrides_positive_times_and_places(self):
        for raw, expected in (("DNF", "DNF"), ("DNS", "DNS"), ("DQ", "DSQ"), ("DSQ", "DSQ")):
            with self.subTest(status=raw):
                row = {**self.row, "entryStatus": raw}
                self.write_sources([row], [])
                rider = parse_athlinks(self.overall_path, self.config)[0]
                self.assertEqual(rider["status"], expected)
                self.assertIsNone(rider["net"])
                self.assertIsNone(rider["genderRank"])
                self.assertIsNone(rider["divisionRank"])

    def test_intermediate_splits_are_not_finishes_even_when_status_is_confirmed(self):
        (self.folder / "raw/athlinks-metadata.json").write_text(json.dumps({
            "eventId": 100, "eventCourseMetadata": [{
                "eventCourseId": 20, "metadata": {"intervals": [
                    {"name": "Full Course", "isFull": True},
                    {"name": "Dockery", "isFull": False},
                ]},
            }],
        }))
        for name, status in (("Full Course", 10), ("Dockery", "DNF")):
            row = {**self.row, "entryStatus": "CONF", "intervalName": name}
            self.write_sources([row], [])
            rider = parse_athlinks(self.overall_path, self.config)[0]
            self.assertEqual(rider["status"], status)
            self.assertEqual(rider["net"], 3600 if isinstance(status, int) else None)

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


class SupplementalResultsTests(unittest.TestCase):
    def test_downloader_collects_every_junior_page(self):
        source = json.loads(Path("data/2025/raw/junior-results.json").read_text())
        pages = [io.StringIO(json.dumps(page)) for page in source["pages"]]
        with patch("scripts.download_supplemental.urllib.request.urlopen", side_effect=pages) as fetch:
            result = registericeman(605207)
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(sum(len(page["resultSet"]["results"]) for page in result["pages"]), 244)

    def test_downloader_rejects_wrong_registericeman_result_set(self):
        source = json.loads(Path("data/2025/raw/junior-results.json").read_text())
        with patch("scripts.download_supplemental.urllib.request.urlopen",
                   return_value=io.StringIO(json.dumps(source["pages"][0]))):
            with self.assertRaisesRegex(ValueError, "wrong result set"):
                registericeman(605208)

    def test_downloader_checks_raceresult_list_and_completeness(self):
        source = json.loads(Path("data/2026/raw/pro-results.json").read_text())
        name = source["list"]["ListName"]
        config = {"key": "public-test-key", "TabConfig": {"Lists": [{"Name": name}]}}
        with patch("scripts.download_supplemental.fetch_json", return_value=source):
            self.assertEqual(raceresult(config, name), source)
            source["data"].pop()
            with self.assertRaisesRegex(ValueError, "incomplete list"):
                raceresult(config, name)
        with self.assertRaisesRegex(ValueError, "no unique list"):
            raceresult(config, "Wrong list")

    def test_junior_results_do_not_require_corral_and_preserve_published_divisions(self):
        path = Path("data/2025/raw/junior-results.json")
        riders = list(parse_registericeman(path, 31500, 180))
        self.assertEqual(len(riders), 244)
        winner = riders[0]
        self.assertEqual((winner["name"], winner["net"]), ("Rylan Zacharek", 7132))
        self.assertIsNone(winner["start"])
        self.assertIsNone(winner["wave"])
        self.assertTrue(any("Romine" in rider["name"] for rider in riders))

    def test_pro_times_use_total_clock_not_the_last_split(self):
        riders = list(parse_registericeman(Path("data/2025/raw/pro-results.json"), 31500, 180))
        self.assertEqual(len(riders), 123)
        self.assertEqual(riders[0]["net"], 5975)
        self.assertNotEqual(riders[0]["net"], 37 * 60 + 59)

    def test_raceresult_pro_list_has_no_division_column(self):
        riders = list(parse_raceresult(Path("data/2026/raw/pro-results.json")))
        self.assertEqual(len(riders), 131)
        self.assertEqual(riders[0]["net"], 5577)
        self.assertEqual(riders[0]["division"], "")
        self.assertTrue(all(rider["net"] is None for rider in riders
                            if not isinstance(rider["status"], int)))

    def test_junior_wave_is_published_number_not_a_formula_from_main_start(self):
        starts = parse_start_list(Path("data/2026/raw/start-list.txt"))
        self.assertEqual(starts["6003"], (12 * 3600, 49))

    def test_classifies_only_published_age_and_category_evidence(self):
        for division, age, expected in (
            ("Pro/Expert Men - 27Mile", 17, "pro"),
            ("F PAT & CAT 1", None, "pro"),
            ("Junior Men U15", None, "junior"),
            ("Men 15-18", None, "junior"),
            ("Men 15-49", None, "amateur"),
            ("Men 40", 40, "amateur"),
            ("Single Speed", 16, "junior"),
            ("M N/A", None, "amateur"),
        ):
            with self.subTest(division=division):
                self.assertEqual(race_group({"division": division, "age": age}), expected)
