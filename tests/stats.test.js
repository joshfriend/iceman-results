import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { findRiders, groupsFor, kde, parseRace, passCounts, waveStats } from "../js/stats.js";

const { race, riders, finishers } = parseRace(
  JSON.parse(readFileSync(new URL("../data/iceman-2026.json", import.meta.url))),
);
const josh = riders.find((r) => r.bib === 4026);

test("loads every result row", () => {
  assert.equal(riders.length, 4507);
  assert.equal(finishers.length, 3667);
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
  assert.deepEqual(findRiders(riders, "999999"), []);
});
