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
