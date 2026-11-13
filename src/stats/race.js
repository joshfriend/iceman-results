import { median } from "./distributions.js";

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
  assignSpeeds(riders);
  return { race: json.race, riders, finishers };
}

// Fills `speed` (mph) from the published average, else from course distance and finish time.
// Without a published distance, the distance implied by the rest of the event's published
// speeds (median of speed * time) is used.
function assignSpeeds(riders) {
  const implied = new Map();
  for (const rider of riders) {
    if (rider.finished && rider.avgSpeed > 0) {
      const miles = implied.get(rider.raceEvent) ?? [];
      miles.push(rider.avgSpeed * rider.net / 3600);
      implied.set(rider.raceEvent, miles);
    }
  }
  const distances = new Map([...implied].map(([event, miles]) => [event, median(miles)]));
  for (const rider of riders) {
    const miles = rider.courseDistance > 0 ? rider.courseDistance : distances.get(rider.raceEvent);
    rider.speed = rider.avgSpeed > 0 ? rider.avgSpeed
      : rider.finished && miles > 0 ? miles * 3600 / rider.net : null;
  }
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
