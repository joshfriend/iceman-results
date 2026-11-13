// Checkpoint rows for a rider from a year's splits.json: elapsed time, the leg since the previous
// timed point, and the leg's average speed when both checkpoint distances are known. A finish
// row is added from the official finish time and course distance (or the course's estimated one).
// A missed checkpoint is left out of the legs, so the next timed point spans the gap.
export function riderSplits(rider, splits) {
  const bib = String(rider.bib);
  const course = splits?.courses.find((candidate) => bib in candidate.riders);
  if (!course) return null;
  const times = course.riders[bib];
  const points = course.checkpoints.map((checkpoint, i) => ({ ...checkpoint, elapsed: times[i] }));
  if (rider.finished) {
    points.push({
      name: "Finish",
      miles: rider.courseDistance > 0 ? rider.courseDistance : course.finishMiles ?? null,
      location: null, elapsed: rider.net, finish: true,
    });
  }
  let previous = { elapsed: 0, miles: 0 };
  const rows = points.map((point) => {
    if (!Number.isFinite(point.elapsed) || point.elapsed <= previous.elapsed) {
      return { ...point, elapsed: null, leg: null, legMiles: null, speed: null };
    }
    const leg = point.elapsed - previous.elapsed;
    const legMiles = Number.isFinite(point.miles) && Number.isFinite(previous.miles)
      && point.miles > previous.miles ? point.miles - previous.miles : null;
    previous = { elapsed: point.elapsed, miles: point.miles };
    return { ...point, leg, legMiles, speed: legMiles === null ? null : legMiles * 3600 / leg };
  });
  return rows.some((row) => row.elapsed !== null)
    ? { rows, estimated: course.estimated === true } : null;
}
