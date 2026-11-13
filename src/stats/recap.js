import { ageRange } from "./identity.js";
import { median, percentile } from "./distributions.js";

export function ageGenderFinishTimes(finishers) {
  const grouped = new Map();
  for (const rider of finishers) {
    if (!["M", "F"].includes(rider.gender)
        || !Number.isFinite(rider.net) || rider.net <= 0) continue;
    const hasAge = Number.isInteger(rider.age) && rider.age > 0 && rider.age <= 120;
    const division = String(rider.division ?? "").trim();
    const boundedDivision = /^[MF]\d{2}\d{2,3}$/i.test(division)
      || /\b\d{1,3}\s*-\s*\d{1,3}\b/.test(division)
      || /^(?:Men|Women|M|F)\s+\d{1,3}$/i.test(division);
    if (!hasAge && !boundedDivision) continue;
    const range = ageRange(rider);
    if (!range || range[0] <= 0 || range[1] > 120 || range[0] > range[1]) continue;
    if (!hasAge && range[0] !== range[1] && range[1] === 99) continue;
    const [ageMin, ageMax] = range;
    const key = `${ageMin}:${ageMax}`;
    if (!grouped.has(key)) grouped.set(key, { ageMin, ageMax, M: [], F: [], speedM: [], speedF: [] });
    const group = grouped.get(key);
    group[rider.gender].push(rider.net);
    if (rider.speed > 0) group[`speed${rider.gender}`].push(rider.speed);
  }
  return [...grouped.values()]
    .map((genders) => ({
      age: (genders.ageMin + genders.ageMax) / 2,
      ageMin: genders.ageMin,
      ageMax: genders.ageMax,
      menMedian: genders.M.length ? median(genders.M) : null,
      menFinishers: genders.M.length,
      womenMedian: genders.F.length ? median(genders.F) : null,
      womenFinishers: genders.F.length,
      menMedianSpeed: genders.speedM.length ? median(genders.speedM) : null,
      womenMedianSpeed: genders.speedF.length ? median(genders.speedF) : null,
    }))
    .sort((a, b) => a.age - b.age || a.ageMin - b.ageMin);
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
