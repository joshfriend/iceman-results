import { comparisonField, comparisonRank } from "./comparison.js";

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

export function ageRange(rider, preferDivisionRange = false) {
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

export function agesCompatible(rider, other, year = rider.raceYear, otherYear = other.raceYear) {
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

export function identityMatches(rider, candidates, nameMatches,
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
