// Pure race statistics shared by the page and the Node tests.

export function parseRace(json) {
  const index = Object.fromEntries(json.fields.map((field, i) => [field, i]));
  const riders = json.riders.map((row) => {
    const rider = Object.fromEntries(json.fields.map((field) => [field, row[index[field]]]));
    rider.raceYear = json.race.year;
    rider.finished = Number.isInteger(rider.status) && rider.status > 0
      && Number.isFinite(rider.net) && rider.net > 0;
    if (Number.isInteger(rider.status) && !rider.finished) rider.status = "DNF";
    rider.clock = rider.finished && Number.isFinite(rider.start) ? rider.start + rider.net : null;
    return rider;
  });
  const finishers = riders.filter((r) => r.finished);
  return { race: json.race, riders, finishers };
}

export function selectRaceEvent(race, event, name) {
  const riders = race.riders.filter((rider) => event === "iceman"
    ? rider.raceEvent !== "slush-cup"
    : rider.raceEvent === event);
  const source = race.race.dataSources?.additionalResults
    ?.find((result) => result.raceEvent === event);
  return {
    race: {
      ...race.race,
      name,
      ...(source ? {
        resultsUrl: source.resultsUrl,
        sourceName: source.format === "raceresult" ? "RaceResult results" : "Athlinks results",
      } : {}),
    },
    riders,
    finishers: riders.filter((rider) => rider.finished),
  };
}

export function findRiders(riders, query) {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  if (/^\d+$/.test(text)) return riders.filter((r) => r.bib === Number(text));
  const words = searchWords(text);
  if (!words.length) return [];

  const candidates = riders.flatMap((rider) => {
    const nameWords = searchWords(rider.name);
    if (nameWords.length === words.length && nameWords.every((word, i) => word === words[i])) {
      return [{ rider, exact: words.length }];
    }

    const used = new Set();
    let exact = 0;
    for (const word of [...words].sort((a, b) => b.length - a.length)) {
      const exactIndex = nameWords.findIndex((nameWord, i) => !used.has(i) && nameWord === word);
      const index = exactIndex >= 0
        ? exactIndex
        : nameWords.findIndex((nameWord, i) => !used.has(i) && nameWord.startsWith(word));
      if (index < 0) return [];
      used.add(index);
      if (nameWords[index] === word) exact++;
    }
    return [{ rider, exact }];
  });
  if (!candidates.length) return [];
  const best = Math.max(...candidates.map(({ exact }) => exact));
  return candidates
    .filter(({ exact }) => exact === best)
    .map(({ rider }) => rider)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function searchWords(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function comparisonField(rider, finishers) {
  return finishers.filter((other) => (other.raceGroup ?? "amateur") === (rider.raceGroup ?? "amateur"));
}

export function comparisonRank(rider, finishers) {
  return comparisonField(rider, finishers).filter((other) => other.net < rider.net).length + 1;
}

export function winnerGaps(rider, finishers) {
  const sameGender = finishers.filter((other) => other.gender === rider.gender);
  return [
    ["pro", "Top pro", sameGender.filter((other) => other.raceGroup === "pro")],
    ["amateur", "Top amateur", sameGender.filter((other) => (other.raceGroup ?? "amateur") === "amateur")],
    ["division", "Division winner", sameGender.filter((other) =>
      rider.division && other.division === rider.division
      && (other.raceGroup ?? "amateur") === (rider.raceGroup ?? "amateur"))],
  ].map(([key, title, members]) => {
    const winner = members.reduce((best, other) =>
      !best || other.net < best.net ? other : best, null);
    return {
      key, title, winner,
      percent: rider.finished && winner ? (rider.net / winner.net - 1) * 100 : null,
    };
  });
}

function ageRange(rider, preferDivisionRange = false) {
  const division = String(rider.division ?? "").trim();
  const compact = /^[MF](\d{2})(\d{2,3})$/i.exec(division);
  const range = compact ?? /\b(\d{1,3})\s*-\s*(\d{1,3})\b/.exec(division);
  const divisionBounds = range && [Number(range[1]), Number(range[2])];
  const divisionRange = divisionBounds && divisionBounds[0] > 0
    && divisionBounds[0] <= divisionBounds[1] && divisionBounds[1] <= 120
    ? divisionBounds : null;
  if (preferDivisionRange && divisionRange) return divisionRange;
  if (Number.isInteger(rider.age) && rider.age > 0 && rider.age <= 120) {
    return [rider.age, rider.age];
  }
  if (divisionRange) return divisionRange;
  const under = /\bU(\d{1,3})\b/i.exec(division);
  if (under) return Number(under[1]) > 1 ? [1, Number(under[1]) - 1] : null;
  const upTo = /\b(\d{1,3})\s*(?:-\s*|&\s*)?under\b/i.exec(division);
  if (upTo) return [1, Number(upTo[1])];
  const plus = /\b(\d{1,3})\s*\+/.exec(division);
  if (plus) return [Number(plus[1]), 120];
  const single = /^(?:Men|Women|M|F)\s+(\d{1,3})$/i.exec(division);
  return single && Number(single[1]) > 0 ? [Number(single[1]), Number(single[1])] : null;
}

function agesCompatible(rider, other, year = rider.raceYear, otherYear = other.raceYear) {
  if (!Number.isInteger(year) || !Number.isInteger(otherYear)) return true;
  const age = ageRange(rider), otherAge = ageRange(other);
  if (!age || !otherAge) return true;
  const elapsed = otherYear - year;
  const compatible = (range, otherRange) =>
    otherRange[1] - range[0] >= elapsed - 1 && otherRange[0] - range[1] <= elapsed + 1;
  if (compatible(age, otherAge)) return true;
  // A verified Athlinks identity keeps age conflicts strict; otherwise use the division range.
  if (Number.isInteger(rider.athlinksRacerId) && rider.athlinksRacerId > 0
    && rider.athlinksRacerId === other.athlinksRacerId) return false;
  const riderDivisionRange = ageRange(rider, true);
  const otherDivisionRange = ageRange(other, true);
  return Boolean(riderDivisionRange && otherDivisionRange
    && compatible(riderDivisionRange, otherDivisionRange));
}

function identityMatches(rider, candidates, nameMatches,
  compatible = (other) => agesCompatible(rider, other)) {
  const hasId = Number.isInteger(rider.athlinksRacerId) && rider.athlinksRacerId > 0;
  if (hasId) {
    const sameId = candidates.filter((other) => other.athlinksRacerId === rider.athlinksRacerId);
    if (sameId.length) return sameId.filter(compatible);
  }
  return candidates.filter((other) =>
    !(hasId && Number.isInteger(other.athlinksRacerId) && other.athlinksRacerId > 0)
    && nameMatches(other) && compatible(other));
}

export function findYearRiders(riders, query, nextRiders) {
  const current = findRiders(riders, query);
  if (current.length !== 1) {
    return /^\s*\d+\s*$/.test(query) ? [] : findRiders(nextRiders, query);
  }
  const rider = current[0];
  const name = searchWords(rider.name).join(" ");
  const matches = identityMatches(rider, nextRiders, (other) =>
    rider.person && other.person
      ? other.person === rider.person
      : searchWords(other.name).join(" ") === name);
  if (matches.length <= 1) return matches;
  const sameCity = matches.filter((other) =>
    String(other.city ?? "").trim().toLowerCase() === String(rider.city ?? "").trim().toLowerCase());
  return sameCity.length === 1 ? sameCity : matches;
}

export function riderHistory(rider, history) {
  const name = rider.name.trim().toLowerCase();
  const results = [];
  const ambiguousYears = [];
  const selectedYear = history.find((year) => year.riders.includes(rider))?.race.year ?? rider.raceYear;
  const accepted = [{ rider, year: selectedYear }];
  const ordered = [...history].sort((a, b) => Number.isInteger(selectedYear)
    ? Math.abs(a.race.year - selectedYear) - Math.abs(b.race.year - selectedYear)
      || b.race.year - a.race.year
    : a.race.year - b.race.year);
  for (const year of ordered) {
    const matches = year.riders.includes(rider)
      ? [rider]
      : identityMatches(rider, year.riders, (other) => other.name.trim().toLowerCase() === name,
        (other) => accepted.every((anchor) =>
          agesCompatible(anchor.rider, other, anchor.year, year.race.year)));
    if (matches.length > 1) {
      ambiguousYears.push(year.race.year);
      continue;
    }
    if (!matches.length) continue;
    const match = matches[0];
    accepted.push({ rider: match, year: year.race.year });
    const timed = match.finished && Number.isFinite(match.net) && match.net > 0;
    const field = comparisonField(match, year.finishers);
    const fieldSize = field.length;
    const slower = timed ? field.filter((other) => other.net > match.net).length : 0;
    results.push({
      year: year.race.year,
      rider: match,
      fieldSize,
      rank: timed ? comparisonRank(match, year.finishers) : null,
      net: timed ? match.net : null,
      aheadPct: timed && fieldSize > 1 ? slower / (fieldSize - 1) * 100 : null,
      timeChange: null,
    });
  }
  results.sort((a, b) => a.year - b.year);
  let previousTime = null;
  for (const result of results) {
    if (result.net === null) continue;
    result.timeChange = previousTime === null ? null : result.net - previousTime;
    previousTime = result.net;
  }
  return { results, ambiguousYears: ambiguousYears.sort((a, b) => a - b) };
}

// Estimated from scheduled wave start + official net time, not observed on-course passes.
export function passCounts(rider, finishers) {
  let passed = 0;
  let passedBy = 0;
  if (!Number.isFinite(rider.start) || !Number.isFinite(rider.clock)) {
    return { passed: 0, passedBy: 0, net: 0 };
  }
  for (const other of comparisonField(rider, finishers)) {
    if (other.bib === rider.bib) continue;
    if (!Number.isFinite(other.start) || !Number.isFinite(other.clock)) continue;
    if (other.start <= rider.start && other.clock > rider.clock) passed++;
    if (other.start >= rider.start && other.clock < rider.clock) passedBy++;
  }
  return { passed, passedBy, net: passed - passedBy };
}

// Division podium status; off the podium, the gap is to the last podium place (race.podiumDepth).
export function podium(rider, finishers, depth) {
  if (!rider.finished || !rider.division || !Number.isInteger(rider.divisionRank)
    || rider.divisionRank <= 0) return null;
  const division = comparisonField(rider, finishers).filter((r) => r.division === rider.division);
  const place = rider.divisionRank;
  if (place <= depth) return { onPodium: true, place, size: division.length };
  const last = division.filter((r) => r.divisionRank > 0 && r.divisionRank <= depth)
    .sort((a, b) => b.divisionRank - a.divisionRank)[0];
  return {
    onPodium: false,
    place,
    size: division.length,
    lastPodium: last,
    gap: last ? rider.net - last.net : null,
    placesBack: place - depth,
  };
}

export function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function duration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function populationSd(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

function percentile(sorted, p) {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function distributionStats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  return {
    times,
    n: times.length,
    median: median(times),
    q1, q3, lowerFence, upperFence,
    whiskerMin: sorted.find((t) => t >= lowerFence),
    whiskerMax: sorted.findLast((t) => t <= upperFence),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

export function raceRecap({ riders, finishers }) {
  const dns = riders.filter((rider) => rider.status === "DNS").length;
  const starters = riders.length - dns;
  const times = finishers.map((rider) => rider.net).sort((a, b) => a - b);
  const groups = new Map();
  for (const rider of finishers) {
    const key = rider.raceGroup || "unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rider.net);
  }
  const groupOrder = ["amateur", "pro", "junior", "unclassified"];
  return {
    entries: riders.length,
    starters,
    finishers: finishers.length,
    dns,
    dnf: riders.filter((rider) => rider.status === "DNF").length,
    dsq: riders.filter((rider) => rider.status === "DSQ").length,
    finishRate: starters ? finishers.length / starters * 100 : null,
    fastest: times.length ? times[0] : null,
    q1: times.length ? percentile(times, 0.25) : null,
    median: times.length ? median(times) : null,
    q3: times.length ? percentile(times, 0.75) : null,
    groups: [...groups]
      .sort(([a], [b]) => (groupOrder.indexOf(a) < 0 ? groupOrder.length : groupOrder.indexOf(a))
        - (groupOrder.indexOf(b) < 0 ? groupOrder.length : groupOrder.indexOf(b)))
      .map(([key, groupTimes]) => ({
        key,
        title: key === "unclassified" ? "Unclassified" : key[0].toUpperCase() + key.slice(1),
        finishers: groupTimes.length,
        median: median(groupTimes),
      })),
  };
}

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
    groups.push(summarize("division", rider.division,
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
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(rider.net);
  }
  return [...categories].sort(([a], [b]) => a.localeCompare(b)).map(([label, times]) => ({
    kind: "junior",
    label,
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
  if (!rider.finished || !rider.person || !rider.wave || waves.length === 0
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
    : waves.reduce((closest, wave) =>
      Math.abs(wave.median - average) < Math.abs(closest.median - average) ? wave : closest,
    ).wave;
  const projected = waves.find((wave) => wave.wave === projectedWave);
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

// Gaussian KDE with Silverman's robust bandwidth so one very slow result can't flatten the curve.
export function kde(values, xs, minBandwidth = 3) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const iqr = (percentile(sorted, 0.75) - percentile(sorted, 0.25)) / 1.34;
  const scale = iqr > 0 ? Math.min(sd, iqr) : sd;
  const bandwidth = Math.max(minBandwidth, 0.9 * scale * n ** -0.2);
  const norm = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));
  return xs.map((x) => {
    let sum = 0;
    for (const v of values) {
      const z = (x - v) / bandwidth;
      sum += Math.exp(-0.5 * z * z);
    }
    return sum * norm;
  });
}

export function hms(totalSeconds) {
  const s = Math.round(totalSeconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function hm(totalMinutes) {
  const m = Math.round(totalMinutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function clockTime(secondsOfDay) {
  return hm(secondsOfDay / 60);
}
