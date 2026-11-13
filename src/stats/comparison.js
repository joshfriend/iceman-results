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

// Estimated from scheduled wave start + official net time, not observed on-course passes.
export function passCounts(rider, finishers) {
  let passed = 0;
  let passedBy = 0;
  if (!Number.isFinite(rider.start) || !Number.isFinite(rider.clock)) {
    return { passed: 0, passedBy: 0, net: 0 };
  }
  for (const other of comparisonField(rider, finishers)) {
    if (other === rider) continue;
    if (!Number.isFinite(other.start) || !Number.isFinite(other.clock)) continue;
    if (other.start <= rider.start && other.clock > rider.clock) passed++;
    if (other.start >= rider.start && other.clock < rider.clock) passedBy++;
  }
  return { passed, passedBy, net: passed - passedBy };
}

export function passDistribution(rider, finishers) {
  const field = comparisonField(rider, finishers)
    .filter((other) => Number.isFinite(other.start) && Number.isFinite(other.clock));
  return field.map((other) => ({ rider: other, ...passCounts(other, field) }));
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
