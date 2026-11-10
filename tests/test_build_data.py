import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.build_data import (
    athlinks_divisions, athlinks_race_group, build_year, FIELDS, parse_athlinks,
    parse_metadata_csv, parse_raceresult, parse_registericeman, parse_runmichigan,
    parse_start_list, parse_wave_placements, published_age, race_group, supplement_athlinks_ids,
    supplement_metadata, supplement_wave_placements,
)
from scripts.download_athlinks import deduplicate_rows, division_group, fetch_division_page, write_year
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

    def test_published_corral_without_schedule_keeps_start_unknown(self):
        riders = list(parse_registericeman(Path("data/2025/raw/overall-results.json"), None, None))
        self.assertTrue(any(rider["wave"] is not None for rider in riders))
        self.assertTrue(all(rider["start"] is None for rider in riders))

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

    def test_raceresult_negative_overall_status_is_a_dnf(self):
        riders = list(parse_raceresult(Path("data/2026/raw/slush-cup-results.json")))
        dnf = next(rider for rider in riders if rider["bib"] == "5631")
        self.assertEqual(dnf["status"], "DNF")
        self.assertIsNone(dnf["net"])

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
            ("Single Speed", 16, "amateur"),
            ("M N/A", None, "amateur"),
        ):
            with self.subTest(division=division):
                self.assertEqual(race_group({"division": division, "age": age}), expected)


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.rider = {
            "bib": 123, "name": "Rider One", "gender": "M", "net": 3600,
            "start": None, "wave": None, "raceGroup": "unclassified",
        }

    def test_exact_join_and_field_provenance(self):
        metadata = {
            "bib": 123, "name": " RIDER ONE ", "gender": "M", "net": 3600,
            "wave": 2, "start": 31680, "raceGroup": "amateur",
        }
        self.assertEqual(supplement_metadata([self.rider], [metadata], "metadata:0"), 1)
        self.assertEqual(self.rider["wave"], 2)
        self.assertEqual(self.rider["start"], 31680)
        for field in ("wave", "start", "raceGroup"):
            self.assertEqual(self.rider[f"{field}Source"], "metadata:0")

    def test_missing_bib_can_be_recovered_but_conflicting_bib_cannot(self):
        metadata = {**self.rider, "bib": 456, "raceGroup": "pro"}
        with self.assertRaisesRegex(ValueError, "no unique matching"):
            supplement_metadata([self.rider], [metadata], "metadata:0")
        self.rider["bib"] = None
        supplement_metadata([self.rider], [metadata], "metadata:0")
        self.assertEqual(self.rider["bib"], 456)

    def test_supplemental_division_can_establish_pro_status_without_a_group_column(self):
        record = {**self.rider, "division": "Pro Cat 1 Men"}
        del record["raceGroup"]
        supplement_metadata([self.rider], [record], "metadata:0")
        self.assertEqual(self.rider["raceGroup"], "pro")
        self.assertEqual(self.rider["raceGroupSource"], "metadata:0")

    def test_ambiguous_repeated_and_conflicting_assignments_fail(self):
        metadata = {**self.rider, "wave": 2}
        with self.assertRaisesRegex(ValueError, "no unique matching"):
            supplement_metadata([self.rider, dict(self.rider)], [metadata], "metadata:0")
        with self.assertRaisesRegex(ValueError, "repeated metadata"):
            supplement_metadata([self.rider], [metadata, metadata], "metadata:0")
        with self.assertRaisesRegex(ValueError, "conflicting wave"):
            supplement_metadata([self.rider], [{**metadata, "wave": 3}], "metadata:0")

    def test_archive_unmatched_rows_are_reported_not_fuzzily_joined(self):
        metadata = {**self.rider, "name": "Rider On"}
        output = io.StringIO()
        with patch("sys.stdout", output):
            self.assertEqual(supplement_metadata(
                [self.rider], [metadata], "metadata:0", allow_unmatched=True,
            ), 0)
        self.assertIn("1 unmatched rows", output.getvalue())
        self.assertEqual(self.rider["raceGroup"], "unclassified")

    def test_csv_validates_assignments_and_categories(self):
        path = self.folder / "metadata.csv"
        path.write_text("bib,name,gender,net,wave,start,raceGroup\n"
                        "123,Rider One,M,01:00:00,2,08:48:00,amateur\n")
        row = list(parse_metadata_csv(path))[0]
        self.assertEqual((row["wave"], row["start"], row["net"]), (2, 31680, 3600))
        for text in ("0", "-2", "Wave 2"):
            path.write_text(f"bib,name,gender,net,wave\n123,Rider One,M,01:00:00,{text}\n")
            with self.assertRaisesRegex(ValueError, "invalid wave"):
                list(parse_metadata_csv(path))
        path.write_text("bib,name,gender,net,start\n123,Rider One,M,01:00:00,24:00:00\n")
        with self.assertRaisesRegex(ValueError, "within the race day"):
            list(parse_metadata_csv(path))
        path.write_text("bib,name,gender,net,raceGroup\n123,Rider One,M,01:00:00,elite\n")
        with self.assertRaisesRegex(ValueError, "invalid raceGroup"):
            list(parse_metadata_csv(path))


    def test_published_category_schema_not_presence_of_a_pro_rider(self):
        course = {"courseId": 20, "courseName": "Main"}
        metadata = [{
            "eventCourseId": 20, "eventCourseName": "Main",
            "metadata": {"divisions": [{"name": "M 40-44"}, {"name": "M PRO"}]},
        }]
        self.assertEqual(athlinks_race_group("M 40-44", "M", course, metadata, {}), "amateur")
        self.assertEqual(athlinks_race_group("", "M", course, metadata, {}), "unclassified")
        self.assertEqual(athlinks_race_group("F 40-44", "F", course, metadata, {}), "unclassified")
        self.assertEqual(athlinks_race_group("M 40-44", "M", course, [], {}), "unclassified")
        self.assertEqual(athlinks_race_group("M PRO", "M", course, [], {}), "pro")

    def test_archived_fixed_width_tables_preserve_original_category(self):
        path = self.folder / "results.html"
        path.write_text(
            "<pre>MALE ICEMAN RESULTS<br>CLASS: PRO/SEMI-PRO MEN<br>"
            "Place Name                   No.   Town           Sta Sponsor              Ice<br>"
            "===== ====================== ===== ============== === ==================== =======<br>"
            "    1 Jeremiah Bishop           35 Harrisonburg   VA Trek                 1:28:31<br>"
            "</pre>"
        )
        row = list(parse_runmichigan(path))[0]
        self.assertEqual((row["name"], row["bib"], row["net"]), ("Jeremiah Bishop", 35, 5311))
        self.assertEqual((row["division"], row["raceGroup"]), ("PRO/SEMI-PRO MEN", "pro"))

    def test_real_archives_recover_all_published_pro_finishers_without_guessing(self):
        for year, matched, unmatched, pros in ((2008, 1936, 17, 58), (2010, 2776, 171, 89)):
            with self.subTest(year=year):
                result = json.loads(Path(f"data/{year}/results.json").read_text())
                riders = [dict(zip(result["fields"], row)) for row in result["riders"]]
                self.assertEqual(sum(rider["raceGroup"] == "pro" for rider in riders), pros)
                self.assertEqual(result["race"]["metadataCoverage"], [{
                    "source": "metadata:0", "rows": matched + unmatched,
                    "matched": matched, "unmatched": unmatched,
                }])
                self.assertTrue(all(rider["raceGroupSource"] == "metadata:0"
                                    for rider in riders if rider["raceGroup"] == "pro"))
                self.assertTrue(all(rider["wave"] is None for rider in riders))

    def test_event_identity_is_separate_from_junior_age_categories(self):
        for year in (2003, 2025, 2026):
            with self.subTest(year=year):
                result = json.loads(Path(f"data/{year}/results.json").read_text())
                fields = result["fields"]
                juniors = [dict(zip(fields, row)) for row in result["riders"]
                           if row[fields.index("raceGroup")] == "junior"
                           and row[fields.index("raceEvent")] != "slush-cup"]
                self.assertTrue(juniors)
                event = "iceman" if year == 2003 else "junior-iceman"
                self.assertTrue(all(rider["raceEvent"] == event for rider in juniors))

    def test_downloader_refresh_preserves_supplemental_sources(self):
        folder = self.folder / "2010"
        folder.mkdir()
        extras = [{"format": "athlinks", "results": "raw/pro-results.json", "raceGroup": "pro"}]
        metadata = [{"format": "csv", "path": "raw/metadata.csv"}]
        wave_placements = {"path": "raw/waves.csv", "sourceUrl": "https://example.com/waves.csv"}
        wave_assignments = {"pro": {"M": {"wave": 55, "start": "14:30:00"}}}
        (folder / "race.json").write_text(json.dumps({
            "resultsFormat": "athlinks", "riderMetadata": metadata, "additionalResults": extras,
            "wavePlacements": wave_placements, "waveAssignments": wave_assignments,
        }))
        group = {
            "eventCourseId": 20, "totalAthletes": 1,
            "interval": {"intervalResults": [{"entryId": 1, "overallRank": 1}]},
        }
        with patch("scripts.download_athlinks.DATA", self.folder):
            with patch("scripts.download_athlinks.fetch_course_page", return_value=([group], group)):
                write_year(
                    {"raceID": 100, "raceDate": "2010-11-06"},
                    [{"eventCourseID": 20, "courseName": "Iceman"}],
                )
        config = json.loads((folder / "race.json").read_text())
        self.assertEqual(config["riderMetadata"], metadata)
        self.assertEqual(config["additionalResults"], extras)
        self.assertEqual(config["wavePlacements"], wave_placements)
        self.assertEqual(config["waveAssignments"], wave_assignments)

    def test_csv_wave_derives_start_only_with_published_schedule(self):
        (self.folder / "raw").mkdir()
        source = json.loads(Path("data/2025/raw/overall-results.json").read_text())
        page = source["pages"][0]
        page["resultSet"]["results"] = page["resultSet"]["results"][:1]
        page["resultSet"]["numResults"] = 1
        headings = {heading["name"]: i for i, heading in enumerate(page["headings"])}
        row = page["resultSet"]["results"][0]
        row[headings["Corral"]] = ""
        (self.folder / "raw/results.json").write_text(json.dumps({"pages": [page]}))
        (self.folder / "raw/metadata.csv").write_text(
            "bib,name,gender,net,wave\n"
            f"{row[headings['Bib']]},{row[headings['Name']]},{row[headings['Gender']]},"
            f"{row[headings['Finish Time (Cumulative)']]},2\n"
        )
        config = {
            "year": 2025, "date": "2025-11-08", "resultsUrl": "https://example.com/results",
            "resultsFormat": "registericeman", "firstStart": "08:45:00",
            "waveSeconds": 180, "podiumDepth": 5, "sources": {"results": "raw/results.json"},
            "riderMetadata": [{"format": "csv", "path": "raw/metadata.csv"}],
        }
        (self.folder / "race.json").write_text(json.dumps(config))
        with patch("scripts.build_data.ROOT", self.folder):
            build_year(self.folder)
        result = json.loads((self.folder / "results.json").read_text())
        rider = dict(zip(FIELDS, result["riders"][0]))
        self.assertEqual((rider["wave"], rider["start"]), (2, 31680))
        self.assertEqual((rider["waveSource"], rider["startSource"]), ("metadata:0", "waveSchedule"))
        config.update(firstStart=None, waveSeconds=None)
        (self.folder / "race.json").write_text(json.dumps(config))
        with patch("scripts.build_data.ROOT", self.folder):
            build_year(self.folder)
        result = json.loads((self.folder / "results.json").read_text())
        rider = dict(zip(FIELDS, result["riders"][0]))
        self.assertEqual(rider["wave"], 2)
        self.assertIsNone(rider["start"])
        self.assertIsNone(rider["startSource"])


class WaveScheduleTests(unittest.TestCase):
    def test_configured_pro_schedule_corrects_anomalous_start_list_wave(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            raw = folder / "raw"
            raw.mkdir()
            (raw / "overall.json").write_text(json.dumps({
                "DataFields": [], "data": [],
            }))
            (raw / "pro.json").write_text(json.dumps({
                "DataFields": ["BIB", "ID", "Status", "Name", "City", "Net", "BIB",
                               "Gender", "Division"],
                "data": [
                    ["101", "1", "1", "Matt Acker", "Town", "1:36:00", "101", "M (1)", ""],
                    ["204", "2", "2", "Samanth Johnson", "Town", "1:50:00", "204", "F (1)", ""],
                ],
            }))
            (raw / "start-list.txt").write_text(
                "101 Acker Matt 0 14:30:00 91\n"
                "204 Johnson Samanth 56 14:40:00 4\n"
            )
            (folder / "race.json").write_text(json.dumps({
                "year": 2026, "date": "2026-11-07", "resultsUrl": "https://example.com",
                "firstStart": "08:45:00", "waveSeconds": 180, "podiumDepth": 5,
                "sources": {"results": "raw/overall.json", "startList": "raw/start-list.txt"},
                "additionalResults": [{
                    "raceGroup": "pro", "format": "raceresult", "results": "raw/pro.json",
                }],
                "waveAssignments": {
                    "pro": {
                        "M": {"wave": 55, "start": "14:30:00"},
                        "F": {"wave": 56, "start": "14:40:00"},
                    },
                },
            }))
            with patch("scripts.build_data.ROOT", folder):
                build_year(folder)
            result = json.loads((folder / "results.json").read_text())
            riders = {row[1]: dict(zip(FIELDS, row)) for row in result["riders"]}
            self.assertEqual(
                (riders["matt-acker"]["wave"], riders["matt-acker"]["start"]),
                (55, 52200),
            )
            self.assertEqual(
                (riders["samanth-johnson"]["wave"], riders["samanth-johnson"]["start"]),
                (56, 52800),
            )
            self.assertTrue(all(
                rider["waveSource"] == rider["startSource"] == "waveSchedule"
                for rider in riders.values()
            ))


class WavePlacementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "wave-placements.json"

    def test_parser_accepts_archived_source_column_names(self):
        self.path.write_text('[{"name":"Rider One","division":"Men 40","wave":2}]')
        self.assertEqual(list(parse_wave_placements(self.path)), [
            {"name": "Rider One", "division": "Men 40", "wave": 2},
        ])

    def test_parser_rejects_invalid_waves(self):
        self.path.write_text('[{"name":"Rider One","division":"Men 40","wave":0}]')
        with self.assertRaisesRegex(ValueError, "invalid wave"):
            list(parse_wave_placements(self.path))

    def test_wave_join_uses_exact_names_and_divisions_to_resolve_duplicates(self):
        first = {
            "name": "Rider One", "division": "Men Single Speed 40+", "raceEvent": "iceman",
            "wave": None,
        }
        second = {"name": "Rider One", "division": "Women 40", "raceEvent": "iceman", "wave": None}
        slush = {"name": "Other Rider", "division": "Men 40", "raceEvent": "slush-cup", "wave": None}
        records = [
            {"name": "Rider One", "division": "Men Singlespeed 40+", "wave": 2},
            {"name": "Other Rider", "division": "Men 40", "wave": 3},
        ]
        output = io.StringIO()
        with patch("sys.stdout", output):
            self.assertEqual(supplement_wave_placements(
                [first, second, slush], records, "wavePlacements",
            ), 1)
        self.assertEqual((first["wave"], first["waveSource"]), (2, "bsnyd"))
        self.assertIsNone(second["wave"])
        self.assertIsNone(slush["wave"])

    def test_wave_join_skips_ambiguous_names_and_preserves_existing_waves(self):
        existing = {"name": "Rider One", "division": "Men 40", "raceEvent": "iceman", "wave": 4}
        same_name = {"name": "Rider One", "division": "Men 41", "raceEvent": "iceman", "wave": None}
        records = [
            {"name": "Rider One", "division": "Men 40", "wave": 4},
            {"name": "Rider One", "division": "Men 42", "wave": 2},
        ]
        with patch("sys.stdout", io.StringIO()):
            self.assertEqual(supplement_wave_placements(
                [existing, same_name], records, "wavePlacements",
            ), 1)
        self.assertEqual(existing["wave"], 4)
        self.assertIsNone(same_name["wave"])

    def test_wave_join_rejects_conflicts_with_existing_assignments(self):
        rider = {"name": "Rider One", "division": "Men 40", "raceEvent": "iceman", "wave": 4}
        with self.assertRaisesRegex(ValueError, "conflicting wave"):
            supplement_wave_placements(
                [rider], [{"name": "Rider One", "division": "Men 40", "wave": 2}],
                "wavePlacements",
            )

    def test_wave_join_skips_conflicting_source_duplicates(self):
        rider = {"name": "Rider One", "division": "Men 40", "raceEvent": "iceman", "wave": None}
        records = [
            {"name": "Rider One", "division": "Men 40", "wave": 2},
            {"name": "Rider One", "division": "Men 40", "wave": 3},
        ]
        with patch("sys.stdout", io.StringIO()):
            self.assertEqual(supplement_wave_placements([rider], records, "wavePlacements"), 0)
        self.assertIsNone(rider["wave"])

    def test_historical_wave_sources_fill_assignments_without_inventing_starts(self):
        for year, matched in ((2021, 3286), (2022, 3391), (2023, 3943), (2024, 4029)):
            with self.subTest(year=year):
                result = json.loads(Path(f"data/{year}/results.json").read_text())
                riders = [dict(zip(result["fields"], row)) for row in result["riders"]]
                sourced = [rider for rider in riders if rider["waveSource"] == "bsnyd"]
                self.assertEqual(len(sourced), matched)
                self.assertTrue(all(rider["start"] is None for rider in sourced))
                self.assertIn("bsnyd.com/iceman/data/Iceman", result["race"]["dataSources"]
                              ["wavePlacements"]["sourceUrl"])
