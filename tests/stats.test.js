import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  estimateNextWave, findRiders, findYearRiders, groupsFor, kde, parseRace, passCounts, riderHistory, waveStats,
} from "../js/stats.js";

const readJson = (path) => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url)));
const dataIndex = readJson("index.json");
const { race, riders, finishers } = parseRace(readJson("2026/results.json"));
const { riders: riders2025, finishers: finishers2025 } = parseRace(readJson("2025/results.json"));
const { riders: riders2001, finishers: finishers2001 } = parseRace(readJson("2001/results.json"));
const { riders: riders2024, finishers: finishers2024 } = parseRace(readJson("2024/results.json"));
const josh = riders.find((r) => r.bib === 4026);

test("cross-year matching allows elapsed years plus or minus one and silently excludes age conflicts", () => {
  const rider = {
    name: "Rider One", person: "rider-one", bib: 1, age: 40,
    finished: true, net: 120, status: 1, wave: 1, raceYear: 2025,
  };
  const year = (year, riders) => ({ race: { year }, riders, finishers: riders });
  for (const [gap, age, allowed] of [
    [1, 38, true], [1, 39, true], [1, 40, true], [1, 37, false], [1, 41, false],
    [5, 34, true], [5, 35, true], [5, 36, true], [5, 33, false], [5, 37, false],
  ]) {
    const other = { ...rider, raceYear: 2025 - gap, age, net: 100 };
    const expected = allowed ? [other] : [];
    assert.deepEqual(findYearRiders([rider], "1", [other]), expected);
    const history = riderHistory(rider, [year(2025 - gap, [other])]);
    assert.deepEqual(history.results.map((r) => r.rider), expected);
    assert.deepEqual(history.ambiguousYears, []);
    if (gap === 1) {
      const estimate = estimateNextWave(rider, [year(2024, [other])],
        [{ wave: 1, median: 100 }], { year: 2025 });
      assert.equal(estimate?.average ?? null, allowed ? 100 : null);
    }
    assert.deepEqual(findYearRiders([other], "1", [rider]), allowed ? [rider] : []);
  }
});

test("division age ranges validate missing ages without treating equipment or distance as age", () => {
  const rider = { name: "Rider One", bib: 1, age: 47, raceYear: 2026 };
  for (const [division, year, allowed] of [
    ["M 39-39", 2016, false], ["M 37-37", 2016, true],
    ["M4646", 2025, true], ["M4343", 2025, false],
    ["Men 45", 2024, true], ["Men 42", 2024, false],
    ["Women 45-47", 2025, true], ["Women 35-39", 2025, false],
    ["Expert Men 35-39 - 27Mile", 2016, true],
    ["All Women 12-18 - 27Mile", 2016, false],
    ["Men 45+", 2025, true], ["Men 75+", 2025, false],
    ["M75100", 2025, false], ["M 01-99", 2025, true],
    ["Fat Bike Men U40", 2025, false], ["Men Single Speed 40+", 2025, true],
    ["M Clydesdale 39 & Under", 2025, false], ["Junior Men 14-under", 2025, false],
    ["Men Clydesdale", 2025, true], ["Pro & Cat 1", 2025, true],
    ["Single Speed - 27Mile", 2025, true], ["M N/A", 2025, true], ["", 2025, true],
  ]) {
    const other = { name: rider.name, bib: 2, division, raceYear: year, age: null };
    assert.deepEqual(findYearRiders([rider], "1", [other]), allowed ? [other] : [], division);
  }
  const publishedAge = {
    name: rider.name, bib: 2, age: 46, division: "Men 35", raceYear: 2025,
  };
  assert.deepEqual(findYearRiders([rider], "1", [publishedAge]), [publishedAge]);
});

test("age validation disambiguates names and also checks matching Athlinks IDs", () => {
  const rider = { name: "Rider One", bib: 1, age: 40, raceYear: 2025, athlinksRacerId: 123 };
  const conflict = { ...rider, age: 20, raceYear: 2024 };
  const compatible = { ...conflict, age: 39, athlinksRacerId: null };
  assert.deepEqual(findYearRiders([rider], "1", [conflict, compatible]), []);
  assert.deepEqual(findYearRiders([{ ...rider, athlinksRacerId: null }], "1",
    [conflict, compatible]), [compatible]);
  const missing = { ...compatible, age: 0 };
  assert.deepEqual(findYearRiders([rider], "1", [missing]), [missing]);
});

test("category switches without age preserve matches and do not reset age validation", () => {
  const rider = {
    name: "Rider One", person: "rider-one", bib: 1, raceYear: 2026,
    division: "Men 47", age: null, finished: true, net: 100, status: 1, wave: 1,
  };
  const makeYear = (year, division, age = null) => {
    const other = { ...rider, raceYear: year, division, age };
    return { race: { year }, riders: [other], finishers: [other] };
  };
  const current = { race: { year: 2026 }, riders: [rider], finishers: [rider] };
  for (const category of ["Single Speed", "Singlespeed Men", "Tandem", "Single Speed - 27Mile"]) {
    const history = [
      makeYear(2022, "Men 43"),
      makeYear(2023, "Men 38"),
      makeYear(2024, category),
      makeYear(2025, category),
      current,
    ];
    const expected = [2022, 2024, 2025, 2026];
    assert.deepEqual(riderHistory(rider, history).results.map((r) => r.year), expected, category);
    assert.deepEqual(findYearRiders([rider], "1", history[3].riders), history[3].riders);
    assert.deepEqual(findYearRiders(history[3].riders, "1", [rider]), [rider]);
    assert.deepEqual(estimateNextWave(rider, history, [{ wave: 1, median: 100 }],
      current.race).years, [2024, 2025, 2026]);

    const selected = history[3].riders[0];
    assert.deepEqual(riderHistory(selected, history).results.map((r) => r.year), expected, category);
    const estimate = estimateNextWave(selected, history, [{ wave: 1, median: 100 }],
      history[3].race);
    assert.deepEqual(estimate.years, [2022, 2024, 2025]);

    const withPublishedAge = makeYear(2025, category, 20);
    assert.deepEqual(findYearRiders([rider], "1", withPublishedAge.riders), []);
  }
});

test("history validates against accepted years as well as the selected year", () => {
  const rider = {
    name: "Rider One", person: "rider-one", bib: 1, wave: 1,
    age: 40, net: 100, finished: true,
  };
  const earlier = { ...rider, age: 38, net: 110 };
  const conflict = { ...rider, age: 39, net: 120 };
  const history = [
    { race: { year: 2025 }, riders: [rider], finishers: [rider] },
    { race: { year: 2024 }, riders: [earlier], finishers: [earlier] },
    { race: { year: 2023 }, riders: [conflict], finishers: [conflict] },
  ];
  assert.deepEqual(riderHistory(rider, history).results.map((r) => [r.year, r.timeChange]),
    [[2024, null], [2025, -10]]);
  assert.deepEqual(estimateNextWave(rider, history, [{ wave: 1, median: 100 }],
    { year: 2025 }).years, [2024, 2025]);
  const selected = { ...rider, age: null, division: "" };
  history[0] = { race: { year: 2025 }, riders: [selected], finishers: [selected] };
  assert.deepEqual(riderHistory(selected, history).results.map((r) => r.year), [2024, 2025]);
});

test("Jonathan Winters' age-inconsistent 2016 result is excluded without a warning", () => {
  const history = dataIndex.years.map((entry) => parseRace(readJson(entry.path)));
  const current = history.find((year) => year.race.year === 2026);
  const selected = current.riders.find((r) => r.name === "Jonathan Winters");
  const old = history.find((year) => year.race.year === 2016);
  assert.equal(old.riders.find((r) => r.name === selected.name).division, "M 39-39");
  const { results, ambiguousYears } = riderHistory(selected, history);
  assert.deepEqual(results.map((r) => r.year), [2022, 2023, 2024, 2025, 2026]);
  assert.deepEqual(ambiguousYears, []);
  assert.deepEqual(findYearRiders(current.riders, String(selected.bib), old.riders), []);
});

test("cross-year matching prefers Athlinks IDs and rejects conflicting IDs on every surface", () => {
  const rider = {
    name: "Rider One", person: "rider-one", bib: 1, city: "Town",
    athlinksRacerId: 123, finished: true, net: 120, status: 1, wave: 1,
  };
  const renamed = {
    ...rider, name: "Different Spelling", person: "different-spelling", bib: 2, net: 100,
  };
  const conflicting = { ...rider, athlinksRacerId: 456, bib: 3, net: 90 };
  const unlinked = { ...rider, athlinksRacerId: null, bib: 4, net: 110 };
  const year = (year, riders) => ({ race: { year }, riders, finishers: riders });
  const waves = [{ wave: 1, median: 120 }];
  const race = { year: 2024 };
  for (const [candidates, expected] of [
    [[renamed, conflicting, unlinked], [renamed]],
    [[conflicting], []],
    [[conflicting, unlinked], [unlinked]],
    [[{ ...unlinked, athlinksRacerId: 0 }], [{ ...unlinked, athlinksRacerId: 0 }]],
    [[{ ...unlinked, athlinksRacerId: undefined }], [{ ...unlinked, athlinksRacerId: undefined }]],
  ]) {
    assert.deepEqual(findYearRiders([rider], "1", candidates), expected);
    assert.deepEqual(riderHistory(rider, [year(2023, candidates)]).results.map((r) => r.rider), expected);
    const estimate = estimateNextWave(rider, [year(2023, candidates)], waves, race);
    assert.equal(estimate?.average ?? null, expected[0]?.net ?? null);
  }
  const selectedWithoutId = { ...rider, athlinksRacerId: null };
  assert.deepEqual(findYearRiders([selectedWithoutId], "1", [conflicting]), [conflicting]);
  assert.equal(riderHistory(selectedWithoutId, [year(2023, [conflicting])]).results.length, 1);
  assert.equal(estimateNextWave(selectedWithoutId, [year(2023, [conflicting])], waves, race).average, 90);
});

test("duplicate Athlinks IDs remain ambiguous in rider history", () => {
  const rider = { name: "Rider One", athlinksRacerId: 123 };
  const candidates = [
    { ...rider, name: "Spelling One" },
    { ...rider, name: "Spelling Two" },
  ];
  assert.deepEqual(riderHistory(rider, [
    { race: { year: 2023 }, riders: candidates, finishers: [] },
  ]), { results: [], ambiguousYears: [2023] });
});

test("normalized Athlinks IDs are preserved but do not override conflicting published ages", () => {
  const history = dataIndex.years.map((entry) => parseRace(readJson(entry.path)));
  let linked = 0;
  for (const year of history) {
    if (year.race.year >= 2025) {
      if (year.race.year === 2026) {
        assert.ok(year.riders.every((r) => r.athlinksRacerId === null));
      }
      continue;
    }
    const raw = readJson(`${year.race.year}/raw/athlinks-results.json`);
    const sourceIds = new Set(raw.courses.flatMap((course) => course.pages.flatMap((page) =>
      page.filter((group) => group.eventCourseId === course.courseId)
        .flatMap((group) => group.interval.intervalResults.map((r) => r.racerId || null)))));
    assert.deepEqual(new Set(year.riders.map((r) => r.athlinksRacerId)), sourceIds);
    linked += year.riders.filter((r) => r.athlinksRacerId !== null).length;
  }
  assert.equal(linked, 9749);
  const selected = history.find((year) => year.race.year === 2024).riders
    .find((r) => r.athlinksRacerId === 302506474);
  assert.ok(selected);
  const matches = riderHistory(selected, history).results;
  assert.equal(matches.filter((r) => r.rider.athlinksRacerId === 302506474).length, 18);
  assert.ok(!matches.some((r) => [2001, 2004, 2005, 2006, 2008].includes(r.year)));
  assert.equal(history.filter((year) =>
    year.riders.some((r) => r.athlinksRacerId === 302506474)).length, 23);
});

test("2025 supplements Athlinks IDs only on matching bib, name, gender, and finish time", () => {
  const raw = readJson("2025/raw/athlinks-results.json");
  const linked = riders2025.filter((r) => r.athlinksRacerId !== null);
  assert.equal(linked.length, 63);
  const source = raw.courses.flatMap((course) => course.pages.flatMap((page) =>
    page.filter((group) => group.eventCourseId === course.courseId)
      .flatMap((group) => group.interval.intervalResults)));
  assert.equal(new Set(source.filter((r) => r.racerId).map((r) => r.racerId)).size, 63);
  for (const rider of linked) {
    const matches = source.filter((r) => Number(r.bib) === rider.bib);
    assert.equal(matches.length, 1);
    const other = matches[0];
    assert.equal(rider.athlinksRacerId, other.racerId);
    assert.equal(rider.name.trim().toLowerCase(), other.displayName.trim().toLowerCase());
    assert.equal(rider.gender, other.gender);
    assert.equal(rider.net, Math.round(other.time.timeInMillis / 1000));
  }
});

test("rider history matches full names across all years and orders results chronologically", () => {
  const rider = { name: "Rider One", person: "shared", bib: 12, finished: true, net: 120, status: 2 };
  const year = (year, riders) => ({
    race: { year }, riders, finishers: riders.filter((r) => r.finished),
  });
  const history = [
    year(2026, [{ ...rider, bib: 99, name: " RIDER ONE ", net: 90, status: 1 },
      { name: "Other", finished: true, net: 100 }]),
    year(2001, [rider, { name: "Other", finished: true, net: 100 }]),
    year(2010, [
      { ...rider, name: "Rider One Jr" },
      { ...rider, name: "Rider Oné" },
      { ...rider, name: "Rider-One" },
      { ...rider, name: "One Rider" },
      { ...rider, name: "Rider  One" },
    ]),
  ];
  const result = riderHistory(rider, history);
  assert.deepEqual(result.results.map((r) => [r.year, r.net, r.timeChange, r.aheadPct]),
    [[2001, 120, null, 0], [2026, 90, -30, 100]]);
  assert.deepEqual(result.ambiguousYears, []);
  assert.equal(history[0].race.year, 2026);
});

test("rider history omits ambiguous years, but retains the selected result", () => {
  const rider = { name: "Rider One", city: "Town", finished: true, net: 100, status: 1 };
  const duplicate = { ...rider, city: "Elsewhere", net: 120, status: 2 };
  const history = [2024, 2025].map((year) => {
    const riders = year === 2025 ? [rider, duplicate] : [{ ...rider }, { ...duplicate }];
    return { race: { year }, riders, finishers: riders };
  });
  const result = riderHistory(rider, history);
  assert.deepEqual(result.ambiguousYears, [2024]);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].rider, rider);
  assert.equal(result.results[0].aheadPct, 100);
});

test("history preserves non-finishes, handles ties and one-rider fields, and compares matched finishes", () => {
  const rider = { name: "Rider One" };
  const makeYear = (year, net, status, others = []) => {
    const riders = [{ ...rider, net, status, finished: Number.isInteger(status) }, ...others];
    return { race: { year }, riders, finishers: riders.filter((r) => r.finished) };
  };
  const history = [
    makeYear(2021, 100, 1),
    makeYear(2022, null, "DNF"),
    makeYear(2023, 120, 2, [
      { name: "Other A", finished: true, net: 90 },
      { name: "Other B", finished: true, net: 120 },
      { name: "Other C", finished: true, net: 130 },
    ]),
    makeYear(2024, null, "DNS"),
    makeYear(2025, 120, 1),
  ];
  const { results } = riderHistory(rider, history);
  assert.deepEqual(results.map((r) => r.net), [100, null, 120, null, 120]);
  assert.deepEqual(results.map((r) => r.timeChange), [null, null, 20, null, 0]);
  assert.ok(Math.abs(results[2].aheadPct - 100 / 3) < 1e-10);
  assert.deepEqual(results.filter((r) => r.year !== 2023).map((r) => r.aheadPct),
    [null, null, null, null]);
  assert.deepEqual(riderHistory(rider, []), { results: [], ambiguousYears: [] });
  assert.deepEqual(riderHistory({ name: "Unknown" }, history).results, []);
});

test("history finds every unambiguous exact-name result in the archive, including later years", () => {
  const history = dataIndex.years.map((entry) => parseRace(readJson(entry.path)));
  const selected = history.find((year) => year.race.year === 2007).riders
    .find((rider) => rider.name === "Kelli Emmett");
  assert.ok(selected);
  const { results, ambiguousYears } = riderHistory(selected, history);
  const expectedYears = history.filter((year) =>
    year.riders.filter((r) => r.name.trim().toLowerCase() === selected.name.toLowerCase()).length === 1,
  ).map((year) => year.race.year).sort((a, b) => a - b);
  assert.deepEqual(results.map((result) => result.year), expectedYears);
  assert.ok(results.some((result) => result.year > 2007));
  assert.ok(results.some((result) => result.year < 2007));
  assert.deepEqual(ambiguousYears, []);
});

test("year changes follow names rather than reassigned bibs", () => {
  const current = [{ bib: 12, name: "Rider One", person: "rider-one", city: "Town" }];
  const next = [
    { bib: 12, name: "Someone Else", person: "someone-else" },
    { bib: 99, name: "Rider One", person: "rider-one", city: "Elsewhere" },
  ];
  assert.deepEqual(findYearRiders(current, "12", next), [next[1]]);
  assert.deepEqual(findYearRiders(current, "One Rider", next), [next[1]]);
  assert.deepEqual(findYearRiders(current, "12", [next[0]]), []);
  assert.deepEqual(findYearRiders(current, "99", next), []);
  assert.deepEqual(findYearRiders(current, "", next), []);
});

test("year changes handle unsubmitted names, missing bibs, and duplicate names", () => {
  const current = [{ bib: 12, name: "Rider One", person: "rider-one", city: "Town" }];
  const next = [
    { bib: null, name: "Rider One", person: "rider-one", city: " town " },
    { bib: 99, name: "Rider One", person: "rider-one", city: "Elsewhere" },
  ];
  assert.deepEqual(findYearRiders(current, "12", next), [next[0]]);
  assert.deepEqual(findYearRiders([], "Rider", next), next);
  assert.deepEqual(findYearRiders(current, "No Match", next), []);
  assert.deepEqual(findYearRiders([{ ...current[0], city: "Other" }], "12", next), next);
  assert.deepEqual(findYearRiders(current, "12", [
    { bib: 55, name: "Rider One Junior", person: "rider-one-junior" },
  ]), []);
  assert.deepEqual(findYearRiders(
    [{ bib: null, name: "Rider Oné" }], "Rider One", [{ bib: null, name: "Rider One" }],
  ), [{ bib: null, name: "Rider One" }]);
});

test("loads every result row", () => {
  assert.equal(riders.length, 4507);
  assert.equal(finishers.length, 3667);
});

test("loads 2025 Registericeman results, retaining finishers whose wave is unavailable", () => {
  assert.equal(riders2025.length, 3811);
  assert.equal(finishers2025.length, 3709);
  assert.ok(finishers2025.every((r) => r.net !== null));
  assert.equal(finishers2025.filter((r) => r.wave !== null).length, 3708);
  const noCorralFinisher = riders2025.find((r) => r.bib === 4949);
  assert.equal(noCorralFinisher.status, 3709);
  assert.equal(noCorralFinisher.wave, null);
  assert.equal(noCorralFinisher.start, null);
  assert.equal(riders2025.find((r) => r.bib === 481).status, "DSQ");
});

test("supports archived results without start-wave data", () => {
  const archived = parseRace({
    race: { year: 2001 },
    fields: ["bib", "name", "status", "net", "gender", "genderRank", "division", "divisionRank", "start", "wave"],
    riders: [[1, "Rider One", 1, 3600, "M", 1, "", null, null, null]],
  });
  const rider = archived.finishers[0];
  assert.equal(rider.clock, null);
  assert.equal(waveStats(archived.finishers, archived.race).length, 0);
  assert.deepEqual(groupsFor(rider, archived.finishers, archived.race)
    .map((group) => group.key), ["overall", "gender"]);
});

test("historical divisions are recovered without inventing unpublished memberships", () => {
  let withDivision = 0;
  let missing = 0;
  for (const entry of dataIndex.years.filter((entry) => entry.year <= 2024)) {
    const { riders, finishers, race } = parseRace(readJson(entry.path));
    const listed = riders.filter((r) => r.division);
    withDivision += listed.length;
    missing += riders.length - listed.length;
    assert.ok(listed.every((r) => Number.isInteger(r.divisionRank) && r.divisionRank > 0));
    if (![2001, 2010].includes(entry.year)) assert.equal(listed.length, riders.length);
    const selected = finishers.find((r) => r.division);
    assert.ok(groupsFor(selected, finishers, race).some((g) => g.key === "division"));
  }
  assert.equal(withDivision, 70954);
  assert.equal(missing, 52);
});

test("2025 retains all primary divisions despite the less complete Athlinks divisions", () => {
  const raw = readJson("2025/raw/overall-results.json");
  const headings = raw.pages[0].headings.map((h) => h.name);
  const source = raw.pages.flatMap((page) => page.resultSet.results);
  for (let i = 0; i < source.length; i++) {
    assert.equal(riders2025[i].division, source[i][headings.indexOf("Age Group")].trim());
    const rank = Number(source[i][headings.indexOf("Age Place")]);
    assert.equal(riders2025[i].divisionRank, rank > 0 ? rank : null);
  }
});

test("podium gaps handle historical ties and unavailable podium times", async () => {
  const { podium } = await import("../js/stats.js");
  const rider = { division: "Example", divisionRank: 6, net: 200, finished: true };
  const tied = { ...rider, divisionRank: 4, net: 100 };
  const result = podium(rider, [tied, { ...tied }, rider], 5);
  assert.equal(result.gap, 100);
  assert.equal(result.lastPodium.divisionRank, 4);
  assert.equal(podium(rider, [rider], 5).gap, null);
  assert.equal(podium({ ...rider, divisionRank: null }, [rider], 5), null);
  const data = parseRace(readJson("2014/results.json"));
  const historic = data.finishers.find((r) => r.division === "ICEBIKE MEN" && r.divisionRank === 6);
  assert.ok(historic);
  assert.ok(Number.isFinite(podium(historic, data.finishers, 5).gap));
});

test("loads the oldest and newest Athlinks datasets without inventing bibs or waves", () => {
  assert.equal(riders2001.length, 1888);
  assert.equal(finishers2001.length, 1888);
  assert.ok(riders2001.every((r) => r.start === null && r.wave === null));
  assert.equal(findRiders(riders2001, "Steve Tilford")[0].bib, 208);
  assert.ok(riders2001.some((r) => r.bib === null));
  assert.equal(riders2024.length, 4105);
  assert.equal(finishers2024.length, 4105);
  assert.ok(riders2024.every((r) => r.start === null && r.wave === null));
});

test("pass counts match the start-list analysis", () => {
  assert.equal(josh.clock, 12 * 3600 + 32 * 60 + 5);
  const counts = passCounts(josh, finishers);
  assert.equal(counts.passed, 531);
  assert.ok(counts.passedBy > 0);
  assert.equal(counts.net, counts.passed - counts.passedBy);
});

test("pass counts agree with a brute-force definition", () => {
  for (const bib of [4763, 309, 4026, 1185 /* DSQ, skipped */, 2000, 4500]) {
    const rider = finishers.find((r) => r.bib === bib);
    if (!rider) continue;
    const others = finishers.filter((o) => o !== rider);
    const passed = others.filter((o) => o.start <= rider.start && o.clock > rider.clock).length;
    const passedBy = others.filter((o) => o.start >= rider.start && o.clock < rider.clock).length;
    assert.deepEqual(passCounts(rider, finishers), { passed, passedBy, net: passed - passedBy });
  }
});

test("groups use official places and match the earlier charts", () => {
  const groups = groupsFor(josh, finishers, race);
  assert.deepEqual(
    groups.map((g) => [g.title, g.n, g.rank]),
    [["Overall", 3667, 1333], ["Men", 3357, 1286], ["Men 35", 63, 31], ["Wave 29 (10:09)", 76, 3]],
  );
});

test("wave stats cover 45 waves", () => {
  const waves = waveStats(finishers, race);
  assert.equal(waves.length, 45);
  const w29 = waves.find((w) => w.wave === 29);
  assert.equal(w29.n, 76);
  assert.equal(w29.median, 9940.5);
});

test("next-wave estimate uses time requirements and shows the selected wave median", () => {
  const rider = { bib: 123, person: "rider", city: "Town", finished: true, wave: 5 };
  const history = [
    { race: { year: 2020 }, finishers: [{ ...rider, net: 60 }] },
    { race: { year: 2021 }, finishers: [{ ...rider, net: 130 }] },
    { race: { year: 2022 }, finishers: [{ ...rider, net: 119 }] },
    { race: { year: 2023 }, finishers: [{ ...rider, net: 108 }] },
    { race: { year: 2024 }, finishers: [{ ...rider, net: 102 }] },
    { race: { year: 2025 }, finishers: [{ ...rider, net: 140 }] },
  ];
  const waves = [100, 110, 120].map((median, i) => ({ wave: i + 1, median }));
  assert.deepEqual(estimateNextWave(rider, history, waves, {
    year: 2025,
    waveTimeRequirements: [110, 140, 180],
  }), {
    wave: 1,
    currentWave: 5,
    wavesAhead: 4,
    average: 109.66666666666667,
    resultCount: 3,
    years: [2022, 2023, 2024],
    requirement: 110,
    requirementType: "faster than",
    waveMedian: 100,
  });
});

test("next-wave estimate returns null for non-finishers and disambiguates repeated names by city", () => {
  const rider = { bib: 123, person: "rider", city: "Town", finished: true, wave: 2 };
  const history = [
    {
      race: { year: 2024 },
      finishers: [
        { ...rider, bib: 777, net: 80 },
        { ...rider, bib: 778, city: "Elsewhere", net: 60 },
      ],
    },
    {
      race: { year: 2025 },
      finishers: [
        { ...rider, net: 100 },
        { ...rider, bib: 124, net: 70 },
      ],
    },
  ];
  const waves = [{ wave: 1, median: 70 }, { wave: 2, median: 100 }];
  assert.equal(estimateNextWave({ ...rider, finished: false }, history, waves, { year: 2025 }), null);
  assert.deepEqual(estimateNextWave(rider, history, waves, { year: 2025 }), {
    wave: 2,
    currentWave: 2,
    wavesAhead: 0,
    average: 90,
    resultCount: 2,
    years: [2024, 2025],
    requirement: null,
    requirementType: "faster than",
    waveMedian: 100,
  });
  assert.equal(estimateNextWave(rider, [], waves, { year: 2025 }), null);
});

test("2026 wave requirements are included in results and distinguish Wave 38's slower cutoff", () => {
  assert.equal(race.waveTimeRequirements.length, 38);
  assert.equal(race.waveTimeRequirements[0], 1 * 3600 + 51 * 60 + 38);
  assert.equal(race.waveTimeRequirements[37], 3 * 3600 + 44 * 60 + 35);
  const rider = { bib: 1, person: "rider", city: "Town", finished: true, wave: 45 };
  const history = [{
    race: { year: 2026 },
    finishers: [{ ...rider, net: race.waveTimeRequirements[37] }],
  }];
  const result = estimateNextWave(rider, history, waveStats(finishers, race), race);
  assert.equal(result.wave, 38);
  assert.equal(result.requirementType, "or slower");
});

test("kde integrates to ~1", () => {
  const minutes = finishers.map((r) => r.net / 60);
  const xs = Array.from({ length: 2000 }, (_, i) => 60 + i * 0.25);
  const density = kde(minutes, xs);
  const area = density.reduce((a, d) => a + d * 0.25, 0);
  assert.ok(area > 0.99 && area < 1.01, area);
});

test("finds riders by bib or name", () => {
  assert.deepEqual(findRiders(riders, " 4026 ").map((r) => r.name), ["Josh Friend"]);
  assert.ok(findRiders(riders, "friend josh").some((r) => r.bib === 4026));
  assert.deepEqual(findRiders(riders, "Lauren Henry").map((r) => r.bib), [1608]);
  assert.deepEqual(findRiders(riders, "lauren").map((r) => r.bib), [1608, 3077, 4178]);
  assert.deepEqual(findRiders(riders, "lauren h").map((r) => r.bib), [1608]);
  assert.ok(findRiders(riders, "laur").some((r) => r.bib === 2462));
  assert.deepEqual(findRiders(riders, "999999"), []);
});

test("sorts matching names alphabetically without case sensitivity", () => {
  const matches = [
    { name: "zoe Rider", bib: 3 },
    { name: "ALICE Rider", bib: 2 },
    { name: "Bob Rider", bib: 1 },
  ];
  assert.deepEqual(findRiders(matches, "rider").map((r) => r.name), [
    "ALICE Rider",
    "Bob Rider",
    "zoe Rider",
  ]);
});

test("podium gap is measured to the division's 5th place", async () => {
  const { podium, duration, ordinal } = await import("../js/stats.js");
  assert.equal(race.podiumDepth, 5);
  const result = podium(josh, finishers, race.podiumDepth);
  const fifth = finishers.find((r) => r.division === "Men 35" && r.divisionRank === 5);
  assert.equal(result.onPodium, false);
  assert.equal(result.place, 31);
  assert.equal(result.size, 63);
  assert.equal(result.gap, josh.net - fifth.net);
  assert.ok(result.gap > 0);
  const winner = finishers.find((r) => r.division === "Men 35" && r.divisionRank === 1);
  assert.deepEqual(podium(winner, finishers, 5), { onPodium: true, place: 1, size: 63 });
  assert.equal(podium(riders.find((r) => r.bib === 4838), finishers, 5), null);
  assert.equal(podium(riders.find((r) => r.bib === 315), finishers, 5), null);
  assert.equal(duration(201), "3:21");
  assert.equal(duration(3725), "1:02:05");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "31st"]);
});

test("index lists every year folder, newest first, with matching counts", () => {
  assert.equal(dataIndex.race, "Iceman Cometh");
  const years = dataIndex.years.map((y) => y.year);
  assert.deepEqual(years, [...years].sort((a, b) => b - a));
  for (const entry of dataIndex.years) {
    const yearData = parseRace(readJson(entry.path));
    assert.equal(yearData.race.year, entry.year);
    assert.equal(yearData.riders.length, entry.riders);
    assert.equal(yearData.finishers.length, entry.finishers);
  }
  assert.equal(josh.person, "josh-friend");
});
