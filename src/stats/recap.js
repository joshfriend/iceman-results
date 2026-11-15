import { ageRange } from "./identity.js";
import { distributionStats, median, percentile } from "./distributions.js";

export function recapCategoryStats(finishers) {
  const groups = new Map();
  const add = (key, label, type, gender, rider) => {
    if (!groups.has(key)) groups.set(key, { key, label, type, gender, times: [] });
    groups.get(key).times.push(rider.net);
  };
  for (const rider of finishers) {
    if (!Number.isFinite(rider.net) || rider.net <= 0) continue;
    const gender = rider.gender === "M" ? "Men" : rider.gender === "F" ? "Women" : "Unspecified Gender";
    const field = { amateur: "amateur", pro: "pro", junior: "junior" }[rider.raceGroup]
      ?? "unclassified";
    const type = `${field[0].toUpperCase()}${field.slice(1)}`;
    add(`${field}:${gender}`, `${gender} ${type}`, type, gender, rider);
    const division = rider.division ?? "";
    const specialty = /tandems?/i.test(division) ? "Tandem"
      : /single[\s-]*speeds?/i.test(division) ? "Singlespeed"
        : /fat\s*(?:bike|tires?)/i.test(division) ? "Fat Tire"
          : /clydesdales?/i.test(division) ? "Clydesdale"
            : /athena|big kneed gals/i.test(division) ? "Athena" : null;
    if (specialty) {
      const label = specialty === "Tandem" ? specialty : `${gender} ${specialty}`;
      add(`specialty:${label}`, label, specialty, specialty === "Tandem" ? "" : gender, rider);
    }
  }
  return [...groups.values()]
    .sort((a, b) => Number(b.type === "Pro") - Number(a.type === "Pro")
      || a.type.localeCompare(b.type) || a.gender.localeCompare(b.gender))
    .map(({ times, ...group }) => ({ ...group, ...distributionStats(times) }));
}

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
