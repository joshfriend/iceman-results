// Pure race statistics shared by the page and the Node tests.

export function parseRace(json) {
  const index = Object.fromEntries(json.fields.map((field, i) => [field, i]));
  const riders = json.riders.map((row) => {
    const rider = Object.fromEntries(json.fields.map((field) => [field, row[index[field]]]));
    rider.finished = Number.isInteger(rider.status);
    rider.clock = rider.finished ? rider.start + rider.net : null;
    return rider;
  });
  const finishers = riders.filter((r) => r.finished);
  return { race: json.race, riders, finishers };
}

export function findRiders(riders, query) {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  if (/^\d+$/.test(text)) return riders.filter((r) => r.bib === Number(text));
  const words = text.split(/\s+/);
  return riders.filter((r) => words.every((w) => r.name.toLowerCase().includes(w)));
}

// Estimated from scheduled wave start + official net time, not observed on-course passes.
export function passCounts(rider, finishers) {
  let passed = 0;
  let passedBy = 0;
  for (const other of finishers) {
    if (other.bib === rider.bib) continue;
    if (other.start <= rider.start && other.clock > rider.clock) passed++;
    if (other.start >= rider.start && other.clock < rider.clock) passedBy++;
  }
  return { passed, passedBy, net: passed - passedBy };
}

// Division podium status; off the podium, the gap is to the last podium place (race.podiumDepth).
export function podium(rider, finishers, depth) {
  if (!rider.finished || !rider.division) return null;
  const division = finishers.filter((r) => r.division === rider.division);
  const place = rider.divisionRank;
  if (place <= depth) return { onPodium: true, place, size: division.length };
  const last = division.find((r) => r.divisionRank === depth);
  return {
    onPodium: false,
    place,
    size: division.length,
    lastPodium: last,
    gap: rider.net - last.net,
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
  return [
    summarize("overall", "Overall", finishers, rider, rider.status),
    summarize("gender", gender, finishers.filter((r) => r.gender === rider.gender), rider,
      rider.genderRank),
    summarize("division", rider.division, finishers.filter((r) => r.division === rider.division),
      rider, rider.divisionRank),
    summarize("wave", `Wave ${rider.wave} (${clockTime(rider.start)})`,
      finishers.filter((r) => r.wave === rider.wave), rider, null),
  ];
}

export function waveStats(finishers, race) {
  const byWave = new Map();
  for (const r of finishers) {
    if (!byWave.has(r.wave)) byWave.set(r.wave, []);
    byWave.get(r.wave).push(r.net);
  }
  return [...byWave.keys()].sort((a, b) => a - b).map((wave) => {
    const times = byWave.get(wave);
    return {
      wave,
      start: race.firstStart + (wave - 1) * race.waveSeconds,
      times,
      n: times.length,
      median: median(times),
      sd: populationSd(times),
      min: Math.min(...times),
      max: Math.max(...times),
    };
  });
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
