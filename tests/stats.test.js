import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ageGenderFinishTimes, comparisonField, comparisonRank, divisionLabel, estimateNextWave, findRiders, findYearRiders, groupsFor, juniorCategoryStats, kde, parseRace,
  passCounts, passDistribution, proWaveStats, raceRecap, riderHistory, riderSplits, selectRaceEvent, waveDistributions, waveStats,
  winnerGaps,
} from "../src/stats/index.js";

const readJson = (path) => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url)));
const dataIndex = readJson("index.json");
const parseIceman = (path) => selectRaceEvent(parseRace(readJson(path)), "iceman", "Iceman Cometh");
const { race, riders, finishers } = parseIceman("2026/results.json");
const { riders: riders2025, finishers: finishers2025 } = parseIceman("2025/results.json");
const { riders: riders2001, finishers: finishers2001 } = parseIceman("2001/results.json");
const { riders: riders2024, finishers: finishers2024 } = parseIceman("2024/results.json");
const josh = riders.find((r) => r.bib === 4026);

test("age and gender finish-time data summarizes all finishers by exact age", () => {
  assert.deepEqual(ageGenderFinishTimes([
    { age: 30, gender: "M", net: 1000, speed: 20, raceGroup: "pro" },
    { age: 30, gender: "M", net: 1200, speed: 16, raceGroup: "amateur" },
    { age: 30, gender: "F", net: 1400, raceGroup: "junior" },
    { age: 32, gender: "F", net: 1600 },
    { age: null, gender: "M", net: 900 },
    { age: 30.5, gender: "F", net: 1000 },
    { age: 0, gender: "F", net: 1000 },
    { age: 31, gender: "X", net: 1000 },
    { age: 31, gender: "M", net: 0 },
  ]), [
    { age: 30, ageMin: 30, ageMax: 30, menMedian: 1100, menFinishers: 2, womenMedian: 1400, womenFinishers: 1, menMedianSpeed: 18, womenMedianSpeed: null },
    { age: 32, ageMin: 32, ageMax: 32, menMedian: null, menFinishers: 0, womenMedian: 1600, womenFinishers: 1, menMedianSpeed: null, womenMedianSpeed: null },
  ]);
});

test("age chart falls back to bounded divisions without merging distinct ranges or overriding ages", () => {
  const rows = ageGenderFinishTimes([
    { division: "Men 46", gender: "M", net: 1000 },
    { division: "M4646", gender: "M", net: 1200 },
    { division: "Women 45-47", gender: "F", net: 1500 },
    { division: "Women 45-47", gender: "F", net: 1700 },
    { division: "Women 45-47", age: 45, gender: "F", net: 1300 },
    { division: "Women 40+", gender: "F", net: 900 },
    { division: "Junior Men U15", gender: "M", net: 800 },
    { division: "Men 99-40", gender: "M", net: 700 },
    { division: "Women 121", gender: "F", net: 600 },
    { division: "Pro/Cat 1 F", gender: "F", net: 500 },
    { division: "Singlespeed Men 40-99", gender: "M", net: 400 },
    { division: "Fat Bike Men 55-99", gender: "M", net: 400 },
    { division: "Women 70-99", gender: "F", net: 400 },
  ]);
  assert.deepEqual(rows.map(({ age, ageMin, ageMax, menFinishers, womenFinishers }) =>
    [age, ageMin, ageMax, menFinishers, womenFinishers]), [
    [45, 45, 45, 0, 1],
    [46, 45, 47, 0, 2],
    [46, 46, 46, 2, 0],
  ]);
  assert.equal(rows[1].womenMedian, 1600);
  assert.equal(rows[2].menMedian, 1100);
});

test("2026 age chart includes both genders from published division ranges", () => {
  const rows = ageGenderFinishTimes(finishers);
  assert.ok(rows.some((row) => row.menFinishers > 0 && row.ageMin === 46 && row.ageMax === 46));
  assert.ok(rows.some((row) => row.womenFinishers > 0 && row.ageMin === 45 && row.ageMax === 47));
  assert.ok(rows.every((row) => row.ageMax !== 99 || row.ageMin === row.ageMax));
});

test("race event selection keeps Slush Cup separate from Iceman results", () => {
  const parsed = {
    race: {
      year: 2026,
      resultsUrl: "https://example.com/iceman",
      dataSources: { additionalResults: [{
        raceEvent: "slush-cup", resultsUrl: "https://example.com/slush", format: "raceresult",
      }] },
    },
    riders: [
      { raceEvent: "iceman", finished: true },
      { raceEvent: "junior-iceman", finished: false },
      { raceEvent: "slush-cup", finished: true },
    ],
    finishers: [{ raceEvent: "iceman", finished: true }, { raceEvent: "slush-cup", finished: true }],
  };
  const iceman = selectRaceEvent(parsed, "iceman", "Iceman Cometh");
  assert.deepEqual(iceman.riders.map((rider) => rider.raceEvent), ["iceman", "junior-iceman"]);
  assert.equal(iceman.race.name, "Iceman Cometh");
  const slush = selectRaceEvent(parsed, "slush-cup", "Slush Cup");
  assert.deepEqual(slush.riders.map((rider) => rider.raceEvent), ["slush-cup"]);
  assert.deepEqual(slush.finishers, slush.riders);
  assert.equal(slush.race.resultsUrl, "https://example.com/slush");
  assert.equal(slush.race.sourceName, "RaceResult results");
});

test("Slush Cup years and counts are indexed independently", () => {
  const slushIndex = dataIndex.events["slush-cup"];
  assert.equal(slushIndex.name, "Slush Cup");
  assert.deepEqual(slushIndex.years.map((entry) => entry.year),
    [2026, 2025, 2024, 2023, 2022, 2021, 2019, 2018, 2017, 2013, 2012, 2003]);
  const entry2026 = slushIndex.years[0];
  const slush = selectRaceEvent(parseRace(readJson(entry2026.path)), "slush-cup", slushIndex.name);
  assert.equal(slush.riders.length, entry2026.riders);
  assert.equal(slush.finishers.length, entry2026.finishers);
  assert.equal(slush.riders.length, 710);
  assert.equal(slush.finishers.length, 548);
  assert.equal(riders.length, 4900);
});

test("race recap summarizes starts, finishes, time quartiles, and field groups", () => {
  const summary = raceRecap({
    riders: [
      { status: 1, raceGroup: "amateur" },
      { status: 2, raceGroup: "amateur" },
      { status: "DNF", raceGroup: "pro" },
      { status: "DNS", raceGroup: "junior" },
      { status: "DSQ", raceGroup: "unclassified" },
    ],
    finishers: [
      { net: 100, raceGroup: "amateur" },
      { net: 200, raceGroup: "amateur" },
    ],
  });
  assert.deepEqual({
    entries: summary.entries,
    starters: summary.starters,
    finishers: summary.finishers,
    dns: summary.dns,
    dnf: summary.dnf,
    dsq: summary.dsq,
    finishRate: summary.finishRate,
    fastest: summary.fastest,
    q1: summary.q1,
    median: summary.median,
    q3: summary.q3,
  }, {
    entries: 5, starters: 4, finishers: 2, dns: 1, dnf: 1, dsq: 1,
    finishRate: 50, fastest: 100, q1: 125, median: 150, q3: 175,
  });
  assert.deepEqual(summary.groups, [{
    key: "amateur", title: "Amateur", finishers: 2, median: 150,
  }]);
  assert.equal(raceRecap({ riders: [{ status: "DNS" }], finishers: [] }).finishRate, null);
});

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
  const history = dataIndex.years.map((entry) => parseIceman(entry.path));
  const current = history.find((year) => year.race.year === 2026);
  const selected = current.riders.find((r) => r.name === "Jonathan Winters");
  const old = history.find((year) => year.race.year === 2016);
  assert.equal(old.riders.find((r) => r.name === selected.name).division, "M 39-39");
  const { results, ambiguousYears } = riderHistory(selected, history);
  assert.deepEqual(results.map((r) => r.year), [2008, 2022, 2023, 2024, 2025, 2026]);
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
  const history = dataIndex.years.map((entry) => parseIceman(entry.path));
  let linked = 0;
  for (const year of history) {
    if (year.race.year >= 2025) {
      if (year.race.year === 2026) {
        assert.ok(year.riders.every((r) => r.athlinksRacerId === null));
      }
      continue;
    }
    const raw = readJson(`${year.race.year}/raw/athlinks-results.json`);
    const courses = [...raw.courses, ...(year.race.year === 2024
      ? readJson("2024/raw/pro-results.json").courses : [])];
    const sourceIds = new Set(courses.flatMap((course) => course.pages.flatMap((page) =>
      page.filter((group) => group.eventCourseId === course.courseId)
        .flatMap((group) => group.interval.intervalResults.map((r) => r.racerId || null)))));
    assert.deepEqual(new Set(year.riders.map((r) => r.athlinksRacerId)), sourceIds);
    linked += year.riders.filter((r) => r.athlinksRacerId !== null
      && !(year.race.year === 2024 && r.raceGroup === "pro")).length;
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
  const history = dataIndex.years.map((entry) => parseIceman(entry.path));
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
  assert.equal(riders.length, 4900);
  assert.equal(finishers.length, 4005);
  assert.equal(riders.filter((r) => r.raceGroup === "junior").length, 262);
  assert.equal(riders.filter((r) => r.raceGroup === "pro").length, 131);
});

test("loads 2025 Registericeman results, retaining finishers whose wave is unavailable", () => {
  assert.equal(riders2025.length, 4178);
  assert.equal(finishers2025.length, 4067);
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
    const { riders, finishers, race } = parseIceman(entry.path);
    const listed = riders.filter((r) => r.division);
    withDivision += listed.length;
    missing += riders.length - listed.length;
    assert.ok(listed.every((r) => r.finished
      ? Number.isInteger(r.divisionRank) && r.divisionRank > 0 : r.divisionRank === null));
    if (![2001, 2010].includes(entry.year)) assert.equal(listed.length, riders.length);
    const selected = finishers.find((r) => r.division);
    assert.ok(groupsFor(selected, finishers, race).some((g) => g.key === "division"));
  }
  assert.equal(withDivision, 71097);
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
  const { podium } = await import("../src/stats/index.js");
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
  assert.equal(riders2024.length, 4248);
  assert.equal(finishers2024.length, 4179);
  assert.ok(riders2024.every((r) => r.start === null));
  assert.ok(riders2024.some((r) => r.wave !== null));
  assert.ok(riders2024.filter((r) => r.wave !== null).every((r) => r.waveSource === "bsnyd"));
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
    const others = comparisonField(rider, finishers)
      .filter((o) => o !== rider && Number.isFinite(o.start) && Number.isFinite(o.clock));
    const passed = others.filter((o) => o.start <= rider.start && o.clock > rider.clock).length;
    const passedBy = others.filter((o) => o.start >= rider.start && o.clock < rider.clock).length;
    assert.deepEqual(passCounts(rider, finishers), { passed, passedBy, net: passed - passedBy });
  }
});

test("pass distribution includes zeroes and ties, excludes missing timing, and separates fields", () => {
  const field = [
    { bib: null, start: 100, clock: 400 },
    { bib: null, start: 100, clock: 400 },
    { bib: 3, start: 200, clock: 300, raceGroup: "amateur" },
    { bib: 4, start: 200, clock: 300, raceGroup: "amateur" },
    { bib: 5, start: 100, clock: null },
    { bib: 6, start: null, clock: 500 },
    { bib: 7, start: 100, clock: 500, raceGroup: "pro" },
    { bib: 8, start: 100, clock: 500, raceGroup: "junior" },
  ];
  assert.deepEqual(passDistribution(field[2], field), [
    { rider: field[0], passed: 0, passedBy: 2, net: -2 },
    { rider: field[1], passed: 0, passedBy: 2, net: -2 },
    { rider: field[2], passed: 2, passedBy: 0, net: 2 },
    { rider: field[3], passed: 2, passedBy: 0, net: 2 },
  ]);
  assert.deepEqual(passDistribution(field[6], field), [
    { rider: field[6], passed: 0, passedBy: 0, net: 0 },
  ]);
  assert.deepEqual(passDistribution(field[0], field.slice(4, 6)), []);
});

test("pass distribution counts distinct riders even without bib numbers", () => {
  const field = [
    { bib: null, start: 100, clock: 400 },
    { bib: null, start: 100, clock: 300 },
  ];
  assert.deepEqual(passDistribution(field[0], field), [
    { rider: field[0], passed: 0, passedBy: 1, net: -1 },
    { rider: field[1], passed: 1, passedBy: 0, net: 1 },
  ]);
});

test("every rider in the real passing distribution agrees with the brute-force definition", () => {
  const distribution = passDistribution(josh, finishers);
  const field = comparisonField(josh, finishers)
    .filter((rider) => Number.isFinite(rider.start) && Number.isFinite(rider.clock));
  assert.equal(distribution.length, field.length);
  assert.equal(distribution.find((entry) => entry.rider === josh).passed, 531);
  for (const { rider, passed, passedBy, net } of distribution) {
    let expectedPassed = 0, expectedPassedBy = 0;
    for (const other of field) {
      if (other === rider) continue;
      if (other.start <= rider.start && other.clock > rider.clock) expectedPassed++;
      if (other.start >= rider.start && other.clock < rider.clock) expectedPassedBy++;
    }
    assert.deepEqual({ passed, passedBy, net }, {
      passed: expectedPassed,
      passedBy: expectedPassedBy,
      net: expectedPassed - expectedPassedBy,
    });
  }
});

test("groups separate race fields while preserving this amateur's chart values", () => {
  const groups = groupsFor(josh, finishers, race);
  assert.deepEqual(
    groups.map((g) => [g.title, g.n, g.rank]),
    [["Amateur overall", 3667, 1333], ["Men", 3357, 1286], ["Men 35", 63, 31], ["Wave 29 (10:09)", 76, 3]],
  );
});

test("amateur wave stats cover 45 waves, with junior/pro starts separate", () => {
  const waves = waveStats(comparisonField(josh, finishers), race);
  assert.equal(waves.length, 45);
  const w29 = waves.find((w) => w.wave === 29);
  assert.equal(w29.n, 76);
  assert.equal(w29.median, 9940.5);
});

test("junior categories are appended after pro and amateur wave distributions", () => {
  const junior = riders.find((r) => r.bib === 6258);
  const waves = waveDistributions(junior, finishers, race);
  const juniorCategories = juniorCategoryStats(finishers);
  assert.deepEqual(juniorCategories.map(({ label }) => label), [
    "Junior Men 15-16",
    "Junior Men 17-18",
    "Junior Men Under 15",
    "Junior Women 15-16",
    "Junior Women 17-18",
    "Junior Women Under 15",
  ]);
  assert.deepEqual(waves.slice(-juniorCategories.length).map(({ label }) => label),
    juniorCategories.map(({ label }) => label));
  assert.equal(waves.find((w) => w.kind === "junior" && w.label === junior.division).n, 47);
  assert.equal(waves.some((w) => w.wave === 0), false);
  assert.equal(groupsFor(junior, finishers, race).at(-1).title, "Junior start (12:00)");
});

test("junior overall divisions are omitted from category distributions", () => {
  assert.deepEqual(juniorCategoryStats(finishers2025).map(({ label }) => label), [
    "Junior Women 9-14",
    "Junior Women 15-16",
    "Junior Women 17-18",
    "Junior Men 9-14",
    "Junior Men 15-16",
    "Junior Men 17-18",
  ]);
  assert.equal(juniorCategoryStats(finishers2025)[0].division, "F0914");
});

test("junior category labels normalize legacy formats across years", () => {
  const categoriesFor = (year) => juniorCategoryStats(parseIceman(`${year}/results.json`).finishers)
    .map(({ label }) => label);
  assert.ok(categoriesFor(2001).includes("Junior Women 10-14"));
  assert.ok(categoriesFor(2016).includes("Junior Men 9-14"));
  assert.ok(categoriesFor(2017).includes("Junior Women 9-14"));
  assert.ok(categoriesFor(2024).includes("Junior Men 14 and under"));
  assert.ok(categoriesFor(2026).includes("Junior Women Under 15"));
  assert.ok(!categoriesFor(2023).some((label) => /overall$/i.test(label)));
  assert.ok(!categoriesFor(2024).some((label) => /overall$/i.test(label)));
});

test("division display labels are shared without changing division membership", () => {
  for (const year of dataIndex.years) {
    const data = parseIceman(`${year.year}/results.json`);
    for (const category of juniorCategoryStats(data.finishers)) {
      const rider = data.finishers.find((r) =>
        r.raceGroup === "junior" && r.division === category.division);
      if (!rider) continue;
      const originalDivision = rider.division;
      const group = groupsFor(rider, data.finishers, data.race).find((g) => g.key === "division");
      assert.equal(divisionLabel(rider), category.label);
      assert.equal(group.title, category.label);
      assert.equal(group.n, category.n);
      assert.equal(rider.division, originalDivision);
    }
  }
  assert.equal(divisionLabel(riders2025.find((r) => r.bib === 6247)), "Junior Women 9-14");
  assert.equal(divisionLabel({ division: "F Overall", raceGroup: "junior" }), "Junior Women Overall");
  assert.equal(divisionLabel({ division: "M2527", raceGroup: "amateur" }), "Men 25-27");
  assert.equal(divisionLabel({ division: "F7099", raceGroup: "amateur" }), "Women 70+");
  assert.equal(divisionLabel({ division: "M75100", raceGroup: "amateur" }), "Men 75+");
  assert.equal(divisionLabel({ division: "M5050", raceGroup: "amateur" }), "Men 50");
  assert.equal(divisionLabel({ division: "M 19-44", raceGroup: "unclassified" }), "Men 19-44");
  assert.equal(divisionLabel({ division: "Men 19-24", raceGroup: "amateur" }), "Men 19-24");
  assert.equal(divisionLabel({ division: "M Fat Tire Male 40-49", raceGroup: "amateur" }), "M Fat Tire Male 40-49");
  assert.equal(divisionLabel({ raceGroup: "junior" }), "");
});

test("pro comparison distributions merge by gender and precede the selected wave rows", () => {
  const pro = proWaveStats(finishers);
  assert.deepEqual(pro.map(({ label, wave, start, n }) => [label, wave, start, n]), [
    ["Pro men", 55, 52200, 91],
    ["Pro women", 56, 52800, 29],
  ]);
  const waves = [...pro, ...waveStats(comparisonField(josh, finishers), race)];
  assert.deepEqual(waves.slice(0, 2).map((w) => w.label), ["Pro men", "Pro women"]);
  const adam = riders.find((r) => r.person === "adam-govan");
  assert.equal(pro.find((w) => adam.gender === w.gender).n, 91);
  const adamWaves = waveDistributions(adam, finishers, race);
  assert.deepEqual(adamWaves.slice(0, 2).map((w) => w.label), ["Pro men", "Pro women"]);
  assert.equal(adamWaves.length, 53);
  assert.ok(adamWaves.some((w) => w.wave === 1 && w.n > 0));
  assert.ok(adamWaves.some((w) => w.wave === 29 && w.n === 76));
  assert.ok(!adamWaves.some((w) => w.wave === 55 && !w.label));
});

test("wave boxes use interpolated quartiles and observed whiskers, keeping outliers", () => {
  const times = [1000, 17, 12, 16, 10, 1, 15, 13, 14, 11, 18];
  const members = times.map((net) => ({ net, wave: 3, start: 100 }));
  const [wave] = waveStats(members, {});
  assert.equal(wave.q1, 11.5);
  assert.equal(wave.q3, 16.5);
  assert.equal(wave.lowerFence, 4);
  assert.equal(wave.upperFence, 24);
  assert.equal(wave.whiskerMin, 10);
  assert.equal(wave.whiskerMax, 18);
  assert.equal(wave.min, 1);
  assert.equal(wave.max, 1000);
  assert.equal(wave.median, 14);
  assert.equal(wave.n, times.length);
  assert.deepEqual(wave.times, times);
  assert.deepEqual(members.map((r) => r.net), times);
});

test("historical junior category distributions do not require scheduled start times", () => {
  for (const year of [2021, 2022, 2023, 2024, 2025]) {
    const data = parseIceman(`${year}/results.json`);
    const rider = year === 2022
      ? data.riders.find((r) => r.person === "adam-govan")
      : data.finishers.find((r) => r.raceGroup === "amateur");
    const waves = waveDistributions(rider, data.finishers, data.race);
    assert.deepEqual(waves.slice(0, 2).map((w) => w.label), ["Pro men", "Pro women"]);
    assert.ok(waves.some((w) => w.kind !== "pro" && w.wave === 1), `${year}: amateur waves`);
    assert.ok(waves.every((w) => Number.isFinite(w.median)), `${year}: valid distributions`);
    const pros = data.finishers.filter((r) => r.raceGroup === "pro");
    assert.equal(waves.slice(0, 2).reduce((sum, w) => sum + w.n, 0), pros.length);
    if (year === 2022) {
      assert.equal(rider.start, null);
      assert.ok(waves.some((w) => w.kind === "junior" && w.label === rider.division && w.start === null));
    }
  }
});

test("wave stats retain unknown starts without inventing midnight or wave assignments", () => {
  const members = [
    { wave: 1, start: null, net: 100 },
    { wave: 1, start: null, net: 200 },
    { wave: null, start: null, net: 50 },
  ];
  assert.deepEqual(waveStats(members, {}).map(({ wave, start, n, median }) =>
    ({ wave, start, n, median })), [{ wave: 1, start: null, n: 2, median: 150 }]);
  assert.equal(waveStats([...members, { wave: 1, start: 1000, net: 300 }], {})[0].start, 1000);
});

test("wave whiskers include fence boundaries and handle small or identical samples", () => {
  for (const [times, q1, q3, min, max] of [
    [[10], 10, 10, 10, 10],
    [[10, 20], 12.5, 17.5, 10, 20],
    [[10, 10, 10, 10], 10, 10, 10, 10],
    [[10, 10, 10, 10, 100], 10, 10, 10, 10],
    [[4, 10, 12, 13, 14, 15, 16, 18, 24], 12, 16, 10, 18],
    [[6, 10, 12, 13, 14, 15, 16, 18, 22], 12, 16, 6, 22],
  ]) {
    const [wave] = waveStats(times.map((net) => ({ net, wave: 1, start: 0 })), {});
    assert.deepEqual([wave.q1, wave.q3, wave.whiskerMin, wave.whiskerMax], [q1, q3, min, max]);
  }
  assert.deepEqual(waveStats([], {}), []);
});

test("real slow wave finishes are flagged without changing counts or medians", () => {
  const waves = waveStats(comparisonField(josh, finishers), race);
  const w3 = waves.find((w) => w.wave === 3);
  const w4 = waves.find((w) => w.wave === 4);
  assert.equal(w3.n, 94);
  assert.equal(w3.median, 7196);
  assert.ok(w3.max > w3.upperFence);
  assert.ok(w3.whiskerMax < w3.max);
  assert.ok(w4.max > 7 * 3600);
  assert.ok(w4.max > w4.upperFence);
  assert.ok(w4.times.includes(w4.max));
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

test("next-wave estimate ignores pro and junior distributions without amateur wave assignments", () => {
  const rider = { bib: 123, person: "rider", finished: true, wave: 2, raceGroup: "amateur" };
  const history = [2023, 2024, 2025].map((year, i) => ({
    race: { year },
    finishers: [{ ...rider, net: [80, 90, 100][i] }],
  }));
  const waves = [
    { kind: "pro", wave: 1, median: 80 },
    { wave: 1, median: 95 },
    { wave: 2, median: 120 },
    { kind: "junior", wave: null, median: 91 },
  ];

  const result = estimateNextWave(rider, history, waves, { year: 2025 });
  assert.equal(result.wave, 1);
  assert.equal(result.wavesAhead, 1);
  assert.equal(result.waveMedian, 95);
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
  assert.deepEqual(findRiders(riders, "lauren").map((r) => r.bib), [6076, 1608, 3077, 4178]);
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
  const { podium, duration, ordinal } = await import("../src/stats/index.js");
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
    const eventEntry = dataIndex.events.iceman.years.find((year) => year.year === entry.year);
    assert.deepEqual(eventEntry, entry, `${entry.year} Iceman event index`);
    const yearData = parseIceman(entry.path);
    assert.equal(yearData.race.year, entry.year);
    assert.equal(yearData.riders.length, entry.riders);
    assert.equal(yearData.finishers.length, entry.finishers);
    for (const [key, members] of [
      ["men", yearData.finishers.filter((rider) => rider.gender === "M")],
      ["women", yearData.finishers.filter((rider) => rider.gender === "F")],
    ]) {
      const times = members.map((rider) => rider.net).sort((a, b) => a - b);
      const expectedFastest = times[0] ?? null;
      assert.equal(entry[`${key}Fastest`], expectedFastest, `${entry.year} ${key} fastest`);
      assert.equal(entry[`${key}Finishers`], times.length, `${entry.year} ${key} count`);
      const winner = [...members].sort((a, b) => a.net - b.net)[0];
      assert.equal(entry[`${key}WinnerSpeed`], winner?.avgSpeed ?? null,
        `${entry.year} ${key} speed belongs to fastest finisher`);
    }
  }
  assert.equal(josh.person, "josh-friend");
});

test("winner speeds use source values or published distance and time with only a 2020 gap", () => {
  const year = (year) => dataIndex.years.find((entry) => entry.year === year);
  assert.equal(year(2026).menWinnerSpeed, 20);
  assert.equal(year(2025).menWinnerSpeed, 18.6);
  assert.ok(Math.abs(year(2018).menWinnerSpeed - (47476 / 1609.344) / (5507 / 3600)) < 1e-10);
  assert.ok(Math.abs(year(2018).womenWinnerSpeed - (47476 / 1609.344) / (6418 / 3600)) < 1e-10);
  const missingYears = [];
  for (let yearNumber = 2001; yearNumber <= 2026; yearNumber++) {
    const entry = year(yearNumber);
    if (!entry || !Number.isFinite(entry.menWinnerSpeed)
        || !Number.isFinite(entry.womenWinnerSpeed) || !Number.isFinite(entry.courseDistance)) {
      missingYears.push(yearNumber);
    }
  }
  assert.deepEqual(missingYears, [2020]);
  for (const entry of dataIndex.years) {
    const data = parseIceman(entry.path);
    for (const rider of data.riders) {
      if (!rider.finished) assert.equal(rider.avgSpeed, null);
      else assert.ok(rider.avgSpeed === null || Number.isFinite(rider.avgSpeed) && rider.avgSpeed > 0);
    }
    const winner = [...data.finishers].sort((a, b) => a.net - b.net)[0];
    const implied = data.finishers.filter((r) => r.avgSpeed > 0).map((r) => r.avgSpeed * r.net / 3600);
    const estimated = winner.courseDistance === null && implied.length > 0;
    assert.equal(entry.courseDistanceEstimated, estimated);
    if (estimated) {
      const mean = implied.reduce((sum, miles) => sum + miles, 0) / implied.length;
      assert.ok(Math.abs(entry.courseDistance - mean) < 1e-9);
    } else {
      assert.equal(entry.courseDistance, winner.courseDistance);
    }
  }
});

test("course distance includes published distances without speeds and flags rounded-speed estimates", () => {
  const year = (year) => dataIndex.years.find((entry) => entry.year === year);
  assert.ok(Math.abs(year(2025).courseDistance - 30.9) < 1e-10);
  assert.equal(year(2025).courseDistanceEstimated, false);
  assert.ok(Math.abs(year(2018).courseDistance - 47476 / 1609.344) < 1e-10);
  assert.equal(year(2018).courseDistanceEstimated, false);
  assert.ok(Math.abs(year(2026).courseDistance - 30.87) < 0.01);
  assert.equal(year(2026).courseDistanceEstimated, true);
});

test("name variants require shared IDs rather than rider-specific aliases", () => {
  const selected = { bib: 1, age: 60, raceYear: 2026, athlinksRacerId: 123,
    finished: true, net: 200, wave: 5 };
  const year = (riders) => ({ race: { year: 2025 }, riders, finishers: riders });
  const waves = [{ wave: 1, median: 100 }];
  for (const [name, otherName] of [
    ["Bob Cooper", "Robert Cooper"],
    ["Bob Cooper", "Robert Lee Cooper"],
    ["Mike von Wihl", "Mike Vonwihl"],
  ]) {
    const rider = { ...selected, name, person: name.toLowerCase().replaceAll(" ", "-") };
    const alternate = { ...rider, name: otherName,
      person: otherName.toLowerCase().replaceAll(" ", "-"),
      bib: 2, age: 59, raceYear: 2025, net: 100, athlinksRacerId: null };
    assert.deepEqual(findRiders([rider], otherName), []);
    assert.deepEqual(findYearRiders([rider], "1", [alternate]), []);
    assert.deepEqual(riderHistory(rider, [year([alternate])]).results, []);
    assert.equal(estimateNextWave(rider, [year([alternate])], waves, { year: 2026 }), null);
    const linked = { ...alternate, athlinksRacerId: rider.athlinksRacerId };
    assert.deepEqual(findYearRiders([rider], "1", [linked]), [linked]);
    assert.equal(riderHistory(rider, [year([linked])]).results[0].rider, linked);
    assert.equal(estimateNextWave(rider, [year([linked])], waves, { year: 2026 }).average, 100);
  }
});

test("non-finishes and intermediate splits never become chart, benchmark, or wave times", () => {
  const history = dataIndex.years.map((entry) => parseIceman(entry.path));
  const old = history.find((year) => year.race.year === 2021);
  for (const name of ["Doug Helland", "William Gallagher Jr."]) {
    const rider = old.riders.find((r) => r.name === name);
    assert.equal(rider.status, "DNF", name);
    assert.equal(rider.net, null, name);
    assert.ok(!old.finishers.includes(rider));
    assert.equal(riderHistory(rider, [old]).results[0].net, null);
  }
  for (const year of history) {
    assert.ok(year.finishers.every((r) => r.status > 0 && r.net > 0 && Number.isFinite(r.net)));
    assert.ok(year.riders.filter((r) => !r.finished).every((r) => r.net === null));
  }
  const raw = parseRace({
    race: { year: 2026 }, fields: ["bib", "status", "net"],
    riders: [[1, "DNF", 10], [2, 0, 10], [3, 1, null], [4, 2, 0], [5, 3, 100]],
  });
  assert.deepEqual(raw.finishers.map((r) => r.bib), [5]);
});

test("amateur history and chart rankings remove pros and juniors without changing published places", () => {
  const rider = { name: "Rider One", person: "rider-one", raceGroup: "amateur",
    gender: "M", division: "Men 40", status: 4, genderRank: 4, net: 120, finished: true };
  const pro = { ...rider, name: "Pro", raceGroup: "pro", net: 80, status: 1 };
  const junior = { ...rider, name: "Junior", raceGroup: "junior", net: 90, status: 2 };
  const tie = { ...rider, name: "Tie", status: 3 };
  const slower = { ...rider, name: "Slower", net: 140, status: 5 };
  const finishers = [pro, junior, tie, rider, slower];
  assert.equal(comparisonRank(rider, finishers), 1);
  assert.equal(rider.status, 4);
  const groups = groupsFor(rider, finishers, {});
  assert.deepEqual(groups.slice(0, 2).map((g) => [g.rank, g.n]), [[1, 3], [1, 3]]);
  const result = riderHistory(rider, [{ race: { year: 2026 }, riders: finishers, finishers }]).results[0];
  assert.equal(result.rank, 1);
  assert.equal(result.fieldSize, 3);
  assert.equal(result.aheadPct, 50);
  assert.equal(groupsFor(pro, finishers, {})[0].n, 1);
});

test("same-gender winner gaps use elapsed-time percentages and exclude other fields from amateur results", () => {
  const rider = { gender: "F", raceGroup: "amateur", division: "Women 40",
    net: 150, finished: true };
  const pro = { ...rider, raceGroup: "pro", net: 100, name: "Pro" };
  const amateur = { ...rider, division: "Women 30", net: 120, name: "Amateur" };
  const division = { ...rider, net: 125, name: "Division" };
  const men = { ...pro, gender: "M", net: 50 };
  const junior = { ...rider, raceGroup: "junior", net: 60 };
  const finishers = [rider, pro, amateur, division, men, junior];
  const gaps = winnerGaps(rider, finishers);
  assert.deepEqual(gaps.map((g) => g.winner.name), ["Pro", "Amateur", "Division"]);
  for (const [i, expected] of [50, 25, 20].entries()) {
    assert.ok(Math.abs(gaps[i].percent - expected) < 1e-10);
  }
  assert.equal(winnerGaps(pro, finishers)[0].percent, 0);
  assert.ok(winnerGaps(pro, finishers)[1].percent < 0);
  assert.equal(winnerGaps(rider, [rider])[0].percent, null);
  assert.equal(winnerGaps({ ...rider, finished: false }, finishers)[0].percent, null);
  const unknown = { ...rider, raceGroup: "unclassified" };
  assert.equal(winnerGaps(unknown, [unknown])[1].percent, null);
});

test("restored juniors are searchable in 2025 and 2026 with correct special-wave starts", () => {
  assert.equal(riders2025.filter((r) => r.raceGroup === "junior").length, 244);
  assert.ok(findRiders(riders2025, "Romine").some((r) => r.raceGroup === "junior"));
  const junior = riders.find((r) => r.bib === 6003);
  assert.equal(junior.raceGroup, "junior");
  assert.equal(junior.wave, 49);
  assert.equal(junior.start, 12 * 3600);
  assert.equal(waveStats(comparisonField(junior, finishers), race)
    .find((w) => w.wave === 49).start, 12 * 3600);
  assert.equal(estimateNextWave(junior, [], waveStats(finishers, race), race), null);
});

test("wave estimates exclude invalid and special-race times and cover fractional cutoff boundaries", () => {
  const rider = { bib: 1, person: "rider", finished: true, wave: 5, raceGroup: "amateur" };
  const history = [{
    race: { year: 2026 }, finishers: [{ ...rider, net: 110.5 }],
  }, {
    race: { year: 2025 }, finishers: [{ ...rider, raceGroup: "pro", net: 10 }],
  }, {
    race: { year: 2024 }, finishers: [{ ...rider, net: null }],
  }];
  const waves = [{ wave: 1, median: 100 }, { wave: 2, median: 200 }];
  const result = estimateNextWave(rider, history, waves,
    { year: 2026, waveTimeRequirements: [100, 110, 111] });
  assert.equal(result.wave, 3);
  assert.equal(result.waveMedian, null);
  assert.deepEqual(result.years, [2026]);
  assert.equal(result.average, 110.5);
  assert.equal(estimateNextWave({ ...rider, raceGroup: "pro" }, history, waves, { year: 2026 }), null);
});

test("missing starts do not create phantom passes", () => {
  const rider = { bib: 1, start: 100, clock: 200 };
  const missing = { bib: 2, start: null, clock: null };
  assert.deepEqual(passCounts(rider, [rider, missing]), { passed: 0, passedBy: 0, net: 0 });
  assert.deepEqual(passCounts(missing, [rider, missing]), { passed: 0, passedBy: 0, net: 0 });
});

test("parseRace derives missing speeds from course distance and finish time", () => {
  const fields = ["bib", "status", "net", "avgSpeed", "courseDistance", "raceEvent"];
  const { riders } = parseRace({
    race: { year: 2030 },
    fields,
    riders: [
      [1, 1, 3600, 20, null, "iceman"],
      [2, 2, 7200, 10, null, "iceman"],
      [3, 3, 5400, null, null, "iceman"],
      [4, 4, 3600, null, 12, "slush-cup"],
      [5, "DNF", null, null, null, "iceman"],
    ],
  });
  assert.deepEqual(riders.map((rider) => rider.speed), [20, 10, 20 * 3600 / 5400, 12, null]);
});

test("rider splits derive leg times and speeds, bridging missed checkpoints", () => {
  const splits = {
    courses: [{
      checkpoints: [
        { name: "A", miles: 8, location: "Alder Rd" },
        { name: "B", miles: 16, location: null },
        { name: "C", miles: 24, location: null },
      ],
      riders: { 7: [1800, null, 5400], 8: [1800, 4200, 5400] },
    }],
  };
  const rider = { bib: 7, finished: true, net: 7200, courseDistance: 30 };
  const { rows, estimated } = riderSplits(rider, splits);
  assert.equal(estimated, false);
  assert.deepEqual(rows.map((row) => [row.name, row.elapsed, row.leg, row.legMiles]), [
    ["A", 1800, 1800, 8], ["B", null, null, null], ["C", 5400, 3600, 16], ["Finish", 7200, 1800, 6],
  ]);
  assert.deepEqual(rows.map((row) => row.speed), [16, null, 16, 12]);
  assert.equal(rows[0].location, "Alder Rd");
  assert.equal(riderSplits({ bib: 9, finished: true, net: 100 }, splits), null);
  assert.equal(riderSplits(rider, null), null);
});

test("rider splits omit speeds without checkpoint distances and skip finish for non-finishers", () => {
  const splits = {
    courses: [{ checkpoints: [{ name: "Dockery", miles: null, location: null }], riders: { 1: [1500] } }],
  };
  const finisher = riderSplits({ bib: 1, finished: true, net: 5000, courseDistance: 30 }, splits).rows;
  assert.deepEqual(finisher.map((row) => [row.leg, row.speed]), [[1500, null], [3500, null]]);
  const dnf = riderSplits({ bib: 1, finished: false, net: null }, splits).rows;
  assert.deepEqual(dnf.map((row) => row.name), ["Dockery"]);
});

test("published split files line up with every year's riders and finish times", () => {
  const entries = dataIndex.events.iceman.years.filter((entry) => entry.splits);
  assert.ok(entries.some((entry) => entry.year === 2026) && entries.some((entry) => entry.year === 2025));
  for (const entry of entries) {
    const year = parseRace(readJson(entry.path));
    const splits = readJson(entry.splits);
    const byBib = new Map(year.riders.map((rider) => [String(rider.bib), rider]));
    for (const course of splits.courses) {
      for (const [bib, times] of Object.entries(course.riders)) {
        const rider = byBib.get(bib);
        assert.ok(rider, `${entry.year}: bib ${bib} is not in the results`);
        assert.equal(times.length, course.checkpoints.length);
        const known = times.filter((time) => time !== null);
        assert.deepEqual(known, [...known].sort((a, b) => a - b), `${entry.year}: bib ${bib}`);
      }
    }
  }
});

test("2026 splits use GPS-estimated distances scaled to the course; 2025 uses published ones", () => {
  const { rows: rows2026, estimated } = riderSplits(josh, readJson("2026/splits.json"));
  assert.equal(estimated, true);
  assert.deepEqual(rows2026.map((row) => row.name), ["Dockery", "Williamsburg", "Ice Station Zebra", "Finish"]);
  assert.deepEqual(rows2026.map((row) => row.miles), [...rows2026.map((row) => row.miles)].sort((a, b) => a - b));
  assert.ok(Math.abs(rows2026.at(-1).miles - 30.9) < 0.1);
  assert.ok(rows2026.every((row) => row.speed > 10 && row.speed < 25));
  const winner = riders2025.find((rider) => rider.bib === 311);
  const result2025 = riderSplits(winner, readJson("2025/splits.json"));
  assert.equal(result2025.estimated, false);
  assert.deepEqual(result2025.rows.map((row) => row.location), ["Dockery Rd", "North Broomhead Rd", null]);
  assert.equal(result2025.rows.at(-1).elapsed, winner.net);
  assert.ok(result2025.rows.every((row) => row.speed > 10 && row.speed < 25));
});
