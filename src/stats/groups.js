import { comparisonField } from "./comparison.js";
import { agesCompatible, identityMatches } from "./identity.js";
import { distributionStats, median } from "./distributions.js";
import { clockTime } from "./format.js";

function summarize(key, title, members, rider, officialRank) {
  const times = members.map((r) => r.net);
  const faster = times.filter((t) => t < rider.net).length;
  const slower = times.filter((t) => t > rider.net).length;
  const rank = officialRank ?? faster + 1;
  return {
    key,
    title,
    times,
    n: times.length,
    rank,
    median: median(times),
    topPct: (rank / times.length) * 100,
    behindPct: times.length > 1 ? (slower / (times.length - 1)) * 100 : 0,
  };
}

export function divisionLabel(rider) {
  const division = rider.division || "";
  if (rider.raceGroup !== "junior") {
    // Compact codes (M2527, F7099) and spaced ranges (M 19-44, F 10-14) become "Men 25-27".
    const adult = /^([FM])(\d{2})(\d{2,3})$/.exec(division) ?? /^([FM])\s+(\d{1,2})-(\d{1,3})$/.exec(division);
    if (!adult) return division;
    const [low, high] = [Number(adult[2]), Number(adult[3])];
    const ages = low === high ? `${low}` : high >= 99 ? `${low}+` : `${low}-${high}`;
    return `${adult[1] === "F" ? "Women" : "Men"} ${ages}`;
  }
  const ageGroup = /^([FM])(\d{2})(\d{2})$/.exec(division)
    ?? /^([FM])\s*(\d{1,2})-(\d{1,2})(?:\s+Juniors?)?$/i.exec(division);
  if (ageGroup) {
    return `Junior ${ageGroup[1].toUpperCase() === "F" ? "Women" : "Men"} ${Number(ageGroup[2])}-${Number(ageGroup[3])}`;
  }
  const juniorGroup = /^Juniors?\s+(Men|Women)\s+(.+)$/i.exec(division);
  if (juniorGroup) {
    const gender = juniorGroup[1][0].toUpperCase() + juniorGroup[1].slice(1).toLowerCase();
    const ages = juniorGroup[2].replace(/^U(\d+)$/i, "Under $1")
      .replace(/^(\d+)-under$/i, "$1 and under");
    return `Junior ${gender} ${ages}`;
  }
  const overall = /^([FM]) Overall$/i.exec(division);
  return overall ? `Junior ${overall[1].toUpperCase() === "F" ? "Women" : "Men"} Overall` : division;
}

export function groupsFor(rider, finishers, race) {
  const gender = rider.gender === "F" ? "Women" : rider.gender === "M" ? "Men" : rider.gender;
  const field = comparisonField(rider, finishers);
  const groupTitle = {
    amateur: "Amateur overall", pro: "Pro overall", junior: "Junior overall",
    unclassified: "Overall (pro status unavailable)",
  };
  const groups = [
    summarize("overall", groupTitle[rider.raceGroup] ?? "Overall", field, rider, null),
    summarize("gender", gender, field.filter((r) => r.gender === rider.gender), rider, null),
  ];
  if (rider.division) {
    groups.push(summarize("division", divisionLabel(rider),
      field.filter((r) => r.division === rider.division), rider, rider.divisionRank));
  }
  if (rider.wave !== null && rider.wave !== undefined) {
    const waveTitle = rider.wave === 0 && rider.raceGroup === "junior"
      ? `Junior start (${clockTime(rider.start)})`
      : `Wave ${rider.wave} (${clockTime(rider.start)})`;
    groups.push(summarize("wave", waveTitle,
      field.filter((r) => r.wave === rider.wave), rider, null));
  }
  return groups;
}

export function waveStats(finishers, race) {
  const byWave = new Map();
  for (const r of finishers) {
    if (!Number.isInteger(r.wave)) continue;
    if (!byWave.has(r.wave)) byWave.set(r.wave, []);
    byWave.get(r.wave).push(r.net);
  }
  return [...byWave.keys()].sort((a, b) => a - b).map((wave) => {
    const times = byWave.get(wave);
    const members = finishers.filter((r) => r.wave === wave);
    const label = wave === 0 && members.length > 0
      && members.every((r) => r.raceGroup === "junior") ? "Junior start" : null;
    return {
      wave,
      start: finishers.find((r) => r.wave === wave && Number.isFinite(r.start))?.start ?? null,
      ...(label ? { label } : {}),
      ...distributionStats(times),
    };
  });
}

export function proWaveStats(finishers) {
  return [
    { gender: "M", label: "Pro men" },
    { gender: "F", label: "Pro women" },
  ].flatMap(({ gender, label }) => {
    const members = finishers.filter((r) => r.raceGroup === "pro" && r.gender === gender);
    if (!members.length) return [];
    return [{
      kind: "pro",
      gender,
      label,
      wave: members.find((r) => Number.isInteger(r.wave))?.wave ?? null,
      start: members.find((r) => Number.isFinite(r.start))?.start ?? null,
      ...distributionStats(members.map((r) => r.net)),
    }];
  });
}

export function juniorCategoryStats(finishers) {
  const categories = new Map();
  for (const rider of finishers) {
    if (rider.raceGroup !== "junior") continue;
    const category = rider.division || `Junior ${rider.gender === "F" ? "women" : "men"}`;
    if (/\boverall$/i.test(category)) continue;
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(rider.net);
  }
  return [...categories].sort(([a], [b]) => a.localeCompare(b)).map(([division, times]) => ({
    kind: "junior",
    division,
    label: divisionLabel({ division, raceGroup: "junior" }),
    wave: null,
    start: null,
    ...distributionStats(times),
  }));
}

export function waveDistributions(rider, finishers, race) {
  const amateurField = finishers.filter((other) => (other.raceGroup ?? "amateur") === "amateur");
  return [
    ...proWaveStats(finishers),
    ...waveStats(amateurField, race),
    ...juniorCategoryStats(finishers),
  ];
}

export function estimateNextWave(rider, history, waves, race) {
  const amateurWaves = waves.filter((wave) =>
    wave.kind !== "pro" && wave.kind !== "junior" && Number.isInteger(wave.wave));
  if (!rider.finished || !rider.person || !rider.wave || amateurWaves.length === 0
    || (rider.raceGroup && rider.raceGroup !== "amateur")) return null;

  const historyStart = race.year - 4;
  const results = [];
  for (const year of [...history].sort((a, b) =>
    Math.abs(a.race.year - race.year) - Math.abs(b.race.year - race.year)
      || b.race.year - a.race.year)) {
    const eligible = year.finishers.filter((r) => Number.isFinite(r.net) && r.net > 0
      && (!r.raceGroup || r.raceGroup === "amateur"));
    const sameName = identityMatches(rider, eligible, (r) =>
      r.person === rider.person,
      (other) => agesCompatible(rider, other, race.year, year.race.year)
        && results.every((result) =>
          agesCompatible(result.rider, other, result.year, year.race.year)));
    const matches = year.race.year === race.year
      ? eligible.filter((r) => r.bib === rider.bib)
      : sameName.length > 1
        ? sameName.filter((r) =>
          String(r.city ?? "").trim().toLowerCase() === String(rider.city ?? "").trim().toLowerCase())
        : sameName;
    if (matches.length === 1) {
      results.push({ year: year.race.year, net: matches[0].net, rider: matches[0] });
    }
  }
  if (results.length === 0) return null;

  const best = results.filter((result) => result.year >= historyStart && result.year <= race.year)
    .sort((a, b) => a.net - b.net).slice(0, 3);
  if (best.length === 0) return null;
  const average = best.reduce((sum, result) => sum + result.net, 0) / best.length;
  const requirements = race.waveTimeRequirements;
  const projectedWave = requirements?.length
    ? requirements.slice(0, -1).findIndex((requirement) => average < requirement) + 1
      || requirements.length
    : amateurWaves.reduce((closest, wave) =>
      Math.abs(wave.median - average) < Math.abs(closest.median - average) ? wave : closest,
    ).wave;
  const projected = amateurWaves.find((wave) => wave.wave === projectedWave);
  return {
    wave: projectedWave,
    currentWave: rider.wave,
    wavesAhead: rider.wave - projectedWave,
    average,
    resultCount: best.length,
    years: best.map((result) => result.year).sort((a, b) => a - b),
    requirement: requirements?.[projectedWave - 1] ?? null,
    requirementType: requirements?.length && projectedWave === requirements.length
      ? "or slower"
      : "faster than",
    waveMedian: projected?.median ?? null,
  };
}
