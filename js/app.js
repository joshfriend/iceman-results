import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

import {
  clockTime, comparisonField, comparisonRank, duration, estimateNextWave, findRiders, findYearRiders,
  groupsFor, hm, hms, kde, ordinal, parseRace, passCounts, podium, riderHistory, waveStats, winnerGaps,
  raceRecap, selectRaceEvent,
} from "./stats.js";

const AWARDS = {
  1: { name: "Gold", color: "#c9a227" },
  2: { name: "Silver", color: "#8a96a3" },
  3: { name: "Bronze", color: "#b4733f" },
  4: { name: "Podium", color: "#497cae" },
  5: { name: "Podium", color: "#497cae" },
};
const TROPHY_PATH = "M7 2h10v2h4v3a5 5 0 0 1-4.6 5 5 5 0 0 1-3.4 3.4V18h3v3H8v-3h3v-2.6A5 5 0 0 1 7.6 12 5 5 0 0 1 3 7V4h4V2zm0 4H5v1a3 3 0 0 0 2 2.8V6zm10 0v3.8A3 3 0 0 0 19 7V6h-2z";

const COLORS = {
  blue: "#8295a8", accent: "#1476c8", slower: "#328c79", red: "#ca453d", ink: "#203346",
  muted: "#657584", grid: "#e8edf0", band: "#f6f8fa", range: "#acbac5",
};
const fmt = d3.format(",");
const $ = (id) => document.getElementById(id);

const index = await (await fetch("data/index.json")).json();
const urlParams = new URLSearchParams(location.search);
const requestedEvent = urlParams.get("race");
const raceKey = index.events[requestedEvent] ? requestedEvent : "iceman";
const eventInfo = index.events[raceKey];
const eventYears = eventInfo.years;
const requestedYear = Number(urlParams.get("year"));
const yearEntry = eventYears.find((year) => year.year === requestedYear) ?? eventYears[0];
for (const [key, event] of Object.entries(index.events)) {
  $("event").add(new Option(event.name, key));
}
$("event").value = raceKey;
for (const entry of eventYears) {
  $("year").add(new Option(String(entry.year), String(entry.year)));
}
$("year").value = String(yearEntry.year);
if (requestedYear && yearEntry.year !== requestedYear || requestedEvent && raceKey !== requestedEvent) {
  const params = new URLSearchParams();
  if (raceKey !== "iceman") params.set("race", raceKey);
  if (yearEntry.year !== eventYears[0].year || requestedYear) params.set("year", yearEntry.year);
  const query = params.size ? `?${params}` : location.pathname;
  window.history.replaceState(null, "", query);
}
function raceUrl(year, event = raceKey, params = {}) {
  const query = new URLSearchParams();
  if (event !== "iceman") query.set("race", event);
  query.set("year", year);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  return `?${query}`;
}
const data = selectRaceEvent(
  parseRace(await (await fetch(`data/${yearEntry.path}`)).json()), raceKey, eventInfo.name,
);
const raceCache = new Map([[data.race.year, Promise.resolve(data)]]);
let historyRequest = 0;
function loadRace(entry) {
  if (!raceCache.has(entry.year)) {
    const request = fetch(`data/${entry.path}`).then(async (response) => {
      if (!response.ok) throw new Error(`${entry.year}: HTTP ${response.status}`);
      return selectRaceEvent(parseRace(await response.json()), raceKey, eventInfo.name);
    }).catch((error) => {
      raceCache.delete(entry.year);
      throw error;
    });
    raceCache.set(entry.year, request);
  }
  return raceCache.get(entry.year);
}
const hasBibData = data.riders.some((r) => Number.isInteger(r.bib));
const raceHistory = await Promise.all(eventYears
  .filter((entry) => entry.year <= data.race.year && entry.year >= data.race.year - 4)
  .map(loadRace));
const raceTitle = `${data.race.name} ${data.race.year}`;
$("race-title").textContent = raceTitle;
document.title = `${raceTitle} results`;
renderRaceRecap(data);
drawEntriesHistory();
const hasWaveData = data.finishers.some((r) => r.start !== null && r.wave !== null);
let waves = [];
let waveResizeObserver;
const overallMinutes = data.finishers.map((r) => r.net / 60).sort((a, b) => a - b);
$("source").href = data.race.resultsUrl;
$("source").textContent = data.race.sourceName;
$("source-note").textContent = hasWaveData
  ? " with start-wave information."
  : " (start-wave data unavailable for this year).";
$("passes").hidden = !hasWaveData;
$("pass-note").hidden = !hasWaveData;
$("wave-results").hidden = !hasWaveData;

$("event").addEventListener("change", () => {
  const nextEvent = $("event").value;
  const nextYear = index.events[nextEvent].years[0].year;
  location.assign(raceUrl(nextYear, nextEvent));
});
$("lookup").addEventListener("submit", (event) => {
  event.preventDefault();
  lookup($("query").value);
});
$("year").addEventListener("change", async () => {
  const entry = eventYears.find((year) => year.year === Number($("year").value));
  const params = new URLSearchParams(raceUrl(entry.year).slice(1));
  const query = $("query").value.trim();
  $("year").disabled = true;
  $("query").disabled = true;
  $("lookup").querySelector("button").disabled = true;
  setMessage(`Loading ${entry.year} results...`);
  try {
    if (query) {
      const response = await fetch(`data/${entry.path}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextData = parseRace(await response.json());
      const matches = findYearRiders(data.riders, query, nextData.riders);
      if (matches.length === 1) params.set("bib", matches[0].bib ?? matches[0].name);
      else if (matches.length > 1) {
        const current = findRiders(data.riders, query);
        params.set("bib", current.length === 1 ? current[0].name : query);
      }
    }
    location.assign(`?${params}`);
  } catch (error) {
    console.error("Could not switch race year", error);
    $("year").value = String(data.race.year);
    $("year").disabled = false;
    $("query").disabled = false;
    $("lookup").querySelector("button").disabled = false;
    setMessage(`Could not load ${entry.year} results. Please try again.`, true);
  }
});
window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  const requested = Number(params.get("year"));
  const year = eventYears.find((entry) => entry.year === requested) ?? eventYears[0];
  if (params.get("race") !== (raceKey === "iceman" ? null : raceKey)
      || year.year !== data.race.year) location.reload();
  else loadFromUrl();
});
$("copy-link").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  $("copy-link").textContent = "Link copied";
  setTimeout(() => { $("copy-link").textContent = "Copy link"; }, 1600);
});
loadFromUrl();

function renderRaceRecap(raceData) {
  const recap = raceRecap(raceData);
  $("recap-title").textContent = `${raceData.race.year} race recap`;
  $("recap-subtitle").textContent = `${fmt(recap.entries)} entries · ${fmt(recap.finishers)} finishers`;
  renderFacts([
    { label: "Entries", value: fmt(recap.entries), note: `${fmt(recap.dns)} marked DNS` },
    { label: "Finishers", value: fmt(recap.finishers), note: `${fmt(recap.dnf)} DNF · ${fmt(recap.dsq)} DSQ` },
    { label: "Starter finish rate", value: recap.finishRate === null ? "—" : `${recap.finishRate.toFixed(1)}%`,
      note: `${fmt(recap.finishers)} of ${fmt(recap.starters)} starters` },
    { label: "Median finish", value: recap.median === null ? "—" : hms(recap.median),
      note: recap.fastest === null ? "no published finish times" : `Fastest ${hms(recap.fastest)}` },
  ], "recap-facts");
  $("recap-groups").replaceChildren(...recap.groups.map((group) => {
    const row = document.createElement("tr");
    const title = document.createElement("th");
    title.scope = "row";
    title.textContent = group.title;
    const count = document.createElement("td");
    count.textContent = fmt(group.finishers);
    const median = document.createElement("td");
    median.textContent = hms(group.median);
    row.append(title, count, median);
    return row;
  }));
  $("recap-unclassified-note").hidden = !recap.groups.some((group) => group.key === "unclassified");
  $("recap-middle-half").textContent = recap.q1 === null
    ? "No finish times are available."
    : `The middle half of finishers finished between ${hms(recap.q1)} and ${hms(recap.q3)}.`;
}

function drawEntriesHistory() {
  const entries = [...eventYears].sort((a, b) => a.year - b.year);
  const years = d3.range(entries[0].year, entries.at(-1).year + 1);
  const width = 1000;
  const height = 300;
  const margin = { top: 28, right: 12, bottom: 46, left: 54 };
  const x = d3.scaleBand(years, [margin.left, width - margin.right]).padding(0.25);
  const y = d3.scaleLinear([0, d3.max(entries, (entry) => entry.riders)],
    [height - margin.bottom, margin.top]).nice();
  const svg = d3.select($("entries-history-chart")).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "group")
    .attr("aria-label", `Published entries by year, stacked by finish status, ${years[0]} to ${years.at(-1)}`)
    .attr("aria-describedby", "entries-history-note");
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "gridline")
    .attr("x1", margin.left).attr("x2", width - margin.right)
    .attr("y1", (count) => y(count)).attr("y2", (count) => y(count));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(fmt).tickPadding(8));
  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(10))
    .selectAll("text").attr("transform", "rotate(-45)").attr("text-anchor", "end");
  const bars = svg.append("g").selectAll("a").data(entries).join("a")
    .attr("href", (entry) => raceUrl(entry.year))
    .attr("aria-label", (entry) => `${entry.year}: ${fmt(entry.riders)} entries, ${
      fmt(entry.finishers)} finished, ${fmt(entry.riders - entry.finishers)} did not finish, view recap`)
    .attr("aria-current", (entry) => entry.year === data.race.year ? "true" : null);
  bars.append("title").text((entry) => `${entry.year}: ${fmt(entry.riders)} entries · ${
    fmt(entry.finishers)} finished · ${fmt(entry.riders - entry.finishers)} did not finish${
    entry.year === data.race.year ? " (selected year)" : ""}`);
  bars.append("rect")
    .attr("class", "entries-finished")
    .attr("x", (entry) => x(entry.year)).attr("y", (entry) => y(entry.finishers))
    .attr("width", x.bandwidth()).attr("height", (entry) => y(0) - y(entry.finishers))
    .attr("fill", (entry) => entry.year === data.race.year ? COLORS.accent : COLORS.blue);
  bars.append("rect")
    .attr("class", "entries-unfinished")
    .attr("x", (entry) => x(entry.year)).attr("y", (entry) => y(entry.riders))
    .attr("width", x.bandwidth()).attr("height", (entry) => y(entry.finishers) - y(entry.riders));
  bars.append("text")
    .attr("x", (entry) => x(entry.year) + x.bandwidth() / 2)
    .attr("y", (entry) => y(entry.riders) - 7)
    .attr("text-anchor", "middle").attr("font-size", 10).attr("fill", COLORS.ink)
    .text((entry) => fmt(entry.riders));
}

function loadFromUrl() {
  const bib = new URLSearchParams(location.search).get("bib") ?? location.hash.replace(/^#/, "");
  $("query").value = bib;
  if (bib) {
    lookup(bib, false);
  } else {
    clearResult();
  }
}

// Shared links always pin the year, since bibs are reassigned every year.
function setUrlRider(rider, replace = false) {
  const url = raceUrl(data.race.year, raceKey, { bib: rider.bib ?? rider.name });
  if (url === location.search) return;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

function clearResult() {
  historyRequest++;
  $("year-recap").hidden = false;
  $("report").hidden = true;
  $("matches").hidden = true;
  $("matches").replaceChildren();
  setMessage("");
  document.title = `${raceTitle} results`;
}

function setMessage(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}

function lookup(query, push = true) {
  historyRequest++;
  const matches = findRiders(data.riders, query);
  $("year-recap").hidden = matches.length === 1;
  $("matches").hidden = true;
  $("matches").replaceChildren();
  if (matches.length === 0) {
    $("report").hidden = true;
    const isBib = /^\s*\d+\s*$/.test(query);
    setMessage(isBib
      ? hasBibData
        ? `No rider with bib ${query.trim()} in the results.`
        : "Bib numbers are not listed for this year; search by rider name instead."
      : `No rider named “${query.trim()}” in the results.`, true);
    return;
  }
  if (matches.length > 1) {
    $("report").hidden = true;
    setMessage(matches.length > 30
      ? `${fmt(matches.length)} riders match — showing the first 30, type more of the name to narrow it:`
      : `${fmt(matches.length)} riders match — pick one:`);
    for (const rider of matches.slice(0, 30)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = [
        rider.name,
        rider.bib === null ? "" : `#${rider.bib}`,
        rider.city,
        rider.division,
      ].filter(Boolean).join(" · ");
      button.addEventListener("click", () => {
        const query = rider.bib === null ? rider.name : String(rider.bib);
        $("query").value = query;
        lookup(query);
      });
      $("matches").append(button);
    }
    $("matches").hidden = false;
    return;
  }
  const rider = matches[0];
  setUrlRider(rider, !push);
  show(rider);
}

function show(rider) {
  setMessage("");
  $("rider-name").textContent = rider.name;
  $("rider-city").textContent = rider.city;
  $("rider-chips").replaceChildren(
    chip("Bib", rider.bib ?? "Not listed"),
    chip("Division", rider.division || "None listed"),
    chip("Field", rider.raceGroup),
  );
  const field = comparisonField(rider, data.finishers);
  waves = waveStats(field, data.race);
  const hasRiderWave = Number.isFinite(rider.start) && Number.isFinite(rider.clock)
    && Number.isInteger(rider.wave);
  $("passes").hidden = !hasRiderWave;
  $("pass-note").hidden = !hasRiderWave;
  $("wave-results").hidden = !hasRiderWave;
  $("report").hidden = false;
  $("details").hidden = !rider.finished;
  document.title = `${rider.name} — ${raceTitle}`;
  renderHistory(rider);
  if (!rider.finished) {
    $("wave-estimate").hidden = true;
    renderFacts([{ label: "Result", value: rider.status }]);
    $("rider-status").textContent = `Listed as ${rider.status}, so there's no finish time to chart.`;
    return;
  }
  $("rider-status").textContent = "";
  renderFacts(winnerGaps(rider, data.finishers).map((gap) => ({
    label: gap.title,
    value: gap.percent === null ? "Unavailable"
      : `${gap.percent >= 0 ? "+" : ""}${gap.percent.toFixed(1)}%`,
    note: gap.winner ? `${gap.winner.name} · ${hms(gap.winner.net)}` : "No published finisher in this category",
  })), "winner-gaps");
  if (!hasRiderWave) {
    $("wave-estimate").hidden = true;
    renderFacts([
      { label: "Finish time", value: hms(rider.net), note: "official finish time", primary: true },
      { label: `${rider.raceGroup} place`, value: ordinal(comparisonRank(rider, data.finishers)),
        note: `published overall: ${ordinal(rider.status)}` },
      podiumFact(rider),
    ]);
    drawCurves(rider);
    return;
  }
  renderWaveEstimate(rider);
  renderFacts([
    { label: "Finish time", value: hms(rider.net), note: "official finish time", primary: true },
    podiumFact(rider),
    { label: "Start", value: clockTime(rider.start), note: `wave ${rider.wave}` },
    { label: "Finished at", value: hms(rider.clock), note: "time of day" },
  ]);

  const counts = passCounts(rider, data.finishers);
  $("passed").textContent = fmt(counts.passed);
  $("passed-by").textContent = fmt(counts.passedBy);
  $("net").textContent = `${counts.net > 0 ? "+" : ""}${fmt(counts.net)}`;

  drawCurves(rider);
  drawWaves(rider);
}

function renderWaveEstimate(rider) {
  const estimate = estimateNextWave(rider, raceHistory, waves, data.race);
  $("wave-estimate").hidden = !estimate;
  if (!estimate) return;

  $("next-wave").textContent = `Wave ${estimate.wave}`;
  $("wave-movement").textContent = estimate.wavesAhead > 0
    ? `${estimate.wavesAhead} wave${estimate.wavesAhead === 1 ? "" : "s"} earlier than your current wave`
    : estimate.wavesAhead < 0
      ? `${Math.abs(estimate.wavesAhead)} wave${estimate.wavesAhead === -1 ? "" : "s"} later than your current wave`
      : "about the same as your current wave";
  const resultLabel = estimate.resultCount === 1
    ? "your only available result"
    : `your ${estimate.resultCount} best available results`;
  const benchmark = estimate.requirement
    ? `Wave ${estimate.wave} requirement: ${estimate.requirementType === "or slower"
      ? `${hms(estimate.requirement)} or slower`
      : `faster than ${hms(estimate.requirement)}`}${estimate.waveMedian === null
      ? "; no finishers with a published start in this wave."
      : `; its ${data.race.year} median was ${hms(estimate.waveMedian)}.`}`
    : `The closest ${data.race.year} wave median was ${hms(estimate.waveMedian)}.`;
  $("wave-estimate-note").textContent =
    `Based on ${resultLabel} (${estimate.years.join(", ")}): ${hms(estimate.average)}. ${benchmark} `
    + (estimate.requirement ? "This is time eligibility, not a predicted assignment; capacity and requested moves can change your wave."
      : "This compares pace with wave medians, not official qualifying cutoffs or a predicted assignment.");
}

async function renderHistory(rider) {
  const request = ++historyRequest;
  $("history-message").textContent = "Loading results across all years...";
  $("history-message").classList.remove("error");
  $("history-charts").replaceChildren();
  $("history-table").hidden = true;
  $("history-rows").replaceChildren();
  try {
    const history = await Promise.all(eventYears.map(loadRace));
    if (request !== historyRequest) return;
    const { results, ambiguousYears } = riderHistory(rider, history);
    const historyByYear = new Map(history.map((year) => [year.race.year, year]));
    const finishes = results.filter((result) => result.net !== null);
    const message = [
      `${results.length} matched year${results.length === 1 ? "" : "s"}`,
      finishes.length < 2 ? "At least two finishes are needed to show a trend." : "",
      ambiguousYears.length ? `Duplicate names: ${ambiguousYears.join(", ")} omitted.` : "",
    ].filter(Boolean).join(" ");
    $("history-message").textContent = message;
    for (const result of results) {
      const row = document.createElement("tr");
      if (result.year === data.race.year) row.className = "selected-year";
      const yearCell = document.createElement("th");
      yearCell.scope = "row";
      const link = document.createElement("a");
      link.href = historyLink(result);
      link.textContent = result.year;
      if (result.year === data.race.year) link.setAttribute("aria-current", "true");
      yearCell.append(link);
      const yearData = historyByYear.get(result.year);
      const divisionPodium = yearData
        && podium(result.rider, yearData.finishers, yearData.race.podiumDepth);
      if (divisionPodium?.onPodium) {
        row.classList.add("podium-year");
        row.style.setProperty("--podium-color", AWARDS[divisionPodium.place].color);
        const mark = document.createElement("span");
        mark.className = "podium-mark";
        mark.textContent = `${ordinal(divisionPodium.place)} podium`;
        mark.title = `${ordinal(divisionPodium.place)} place in ${result.rider.division}`;
        yearCell.append(" ", mark);
      }
      row.append(yearCell);
      const change = result.timeChange;
      for (const value of [
        result.net === null ? String(result.rider.status) : hms(result.net),
        change === null ? "—" : change === 0 ? "No change" : `${change < 0 ? "−" : "+"}${duration(Math.abs(change))}`,
        result.net === null ? "—" : `${fmt(result.rank)} / ${fmt(result.fieldSize)} (${result.rider.raceGroup ?? "amateur"})`,
        result.aheadPct === null ? "—" : `${result.aheadPct.toFixed(1)}%`,
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      $("history-rows").append(row);
    }
    $("history-table").hidden = results.length === 0;
    if (finishes.length >= 2) {
      const yearDomain = d3.extent(finishes, (result) => result.year);
      drawHistoryChart(finishes, {
        title: "Finish time", note: "Lower is faster", key: "net",
        format: hms, color: COLORS.blue, yearDomain,
      });
      drawHistoryChart(finishes.filter((result) => result.aheadPct !== null), {
        title: "Ahead of field", note: "Higher is better; ties are not counted as behind you",
        key: "aheadPct", format: (value) => `${value.toFixed(1)}%`, color: COLORS.accent, yearDomain,
      });
    }
  } catch (error) {
    if (request !== historyRequest) return;
    console.error("Could not load rider history", error);
    $("history-message").classList.add("error");
    $("history-message").textContent = "Could not load all years. Search for the rider again to retry.";
  }
}

function historyLink(result) {
  return raceUrl(result.year, raceKey, { bib: result.rider.bib ?? result.rider.name });
}

function drawHistoryChart(results, { title, note, key, format, color, yearDomain }) {
  if (results.length < 2) return;
  const width = 520;
  const height = 250;
  const margin = { top: 16, right: 20, bottom: 40, left: 66 };
  const card = d3.select($("history-charts")).append("article").attr("class", "card");
  card.append("div").attr("class", "card-head").append("h4").text(title);
  card.append("p").attr("class", "card-sub").text(note);
  const x = d3.scaleLinear(yearDomain, [margin.left, width - margin.right]);
  const [min, max] = d3.extent(results, (result) => result[key]);
  const padding = Math.max((max - min) * 0.15, 60);
  const y = d3.scaleLinear(key === "aheadPct" ? [0, 100] : [Math.max(0, min - padding), max + padding],
    [height - margin.bottom, margin.top]).nice();
  const svg = card.append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img").attr("aria-label", `${title} by year. ${note}. Values in the table below.`);
  svg.append("g").selectAll("line").data(y.ticks(5)).join("line").attr("class", "gridline")
    .attr("x1", margin.left).attr("x2", width - margin.right)
    .attr("y1", (value) => y(value)).attr("y2", (value) => y(value));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(format));
  const ticks = x.ticks(5).filter(Number.isInteger);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(ticks).tickFormat(d3.format("d")).tickPadding(8));
  svg.append("path").datum(results)
    .attr("d", d3.line().x((result) => x(result.year)).y((result) => y(result[key])))
    .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
  const points = svg.append("g").selectAll("a").data(results).join("a")
    .attr("href", historyLink)
    .attr("aria-label", (result) => `${result.year}: ${format(result[key])}, view result`);
  points.append("circle")
    .attr("cx", (result) => x(result.year)).attr("cy", (result) => y(result[key]))
    .attr("r", (result) => result.year === data.race.year ? 6 : 4)
    .attr("fill", (result) => result.year === data.race.year ? COLORS.red : color);
  points.append("title").text((result) => `${result.year}: ${format(result[key])}`);
}

function chip(label, value) {
  const el = document.createElement("span");
  el.className = "chip";
  const key = document.createElement("span");
  key.className = "chip-label";
  key.textContent = label;
  el.append(key, String(value));
  return el;
}

function trophy(color, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "trophy");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.style.color = color;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", TROPHY_PATH);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

function podiumFact(rider) {
  const depth = data.race.podiumDepth;
  const result = podium(rider, data.finishers, depth);
  if (!result) {
    return { label: "Division podium", value: "–", note: "no division listed" };
  }
  const where = `of ${fmt(result.size)} in ${rider.division}`;
  if (result.onPodium) {
    const award = AWARDS[result.place];
    const value = document.createDocumentFragment();
    value.append(trophy(award.color, `${award.name} trophy`), ordinal(result.place));
    return {
      label: award.name === "Podium" ? "Division podium" : `${award.name} podium`,
      value,
      note: where,
      accent: award.color,
      primary: true,
    };
  }
  return {
    label: "Behind podium",
    value: result.gap === null ? "–" : `+${duration(result.gap)}`,
    note: `${ordinal(result.place)} ${where} · ${result.lastPodium
      ? `${ordinal(result.lastPodium.divisionRank)} was ${hms(result.lastPodium.net)}`
      : "podium time unavailable"}`,
    primary: true,
  };
}

function renderFacts(facts, target = "rider-facts") {
  $(target).style.setProperty("--cols", facts.length);
  $(target).replaceChildren(...facts.map(({ label, value, note, primary, accent }) => {
    const item = document.createElement("div");
    item.className = primary ? "fact primary" : "fact";
    if (accent) item.style.setProperty("--accent", accent);
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.append(value);
    item.append(dt, dd);
    if (note) {
      const small = document.createElement("span");
      small.className = "fact-note";
      small.textContent = note;
      item.append(small);
    }
    return item;
  }));
}

function domainFor(riderMinutes) {
  const p995 = d3.quantileSorted(overallMinutes, 0.995);
  return [
    Math.floor(Math.min(overallMinutes[0], riderMinutes) / 30) * 30,
    Math.ceil(Math.max(p995, riderMinutes + 10) / 30) * 30,
  ];
}

function drawCurves(rider) {
  const mine = rider.net / 60;
  const [lo, hi] = domainFor(mine);
  const width = 520;
  const height = 230;
  const margin = { top: 24, right: 14, bottom: 34, left: 14 };
  const x = d3.scaleLinear([lo, hi], [margin.left, width - margin.right]);
  const xs = d3.range(lo, hi + 0.001, 0.25);
  const container = $("curves");
  container.replaceChildren();

  for (const [i, group] of groupsFor(rider, data.finishers, data.race).entries()) {
    const card = d3.select(container).append("article").attr("class", "card");
    const head = card.append("div").attr("class", "card-head");
    head.append("h4").text(group.title);
    head.append("span").attr("class", "rank").text(`${fmt(group.rank)} / ${fmt(group.n)}`);
    const sub = card.append("div").attr("class", "card-sub");
    sub.append("span").text(`Median ${hms(group.median)}`);
    sub.append("span").text(`Top ${group.topPct.toFixed(1)}%  ·  ahead of ${group.behindPct.toFixed(1)}%`);

    const minutes = group.times.map((t) => t / 60);
    const density = kde(minutes, xs);
    const bins = d3.bin().domain([lo, hi]).thresholds(d3.range(lo, hi, 10))(minutes.filter((m) => m <= hi));
    const binDensity = (b) => b.length / (minutes.length * (b.x1 - b.x0));
    const y = d3.scaleLinear(
      [0, Math.max(d3.max(density), d3.max(bins, binDensity)) * 1.16],
      [height - margin.bottom, margin.top],
    );

    const svg = card.append("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `${group.title}: place ${group.rank} of ${group.n}, median ${hms(group.median)}`);
    const clipId = `clip-${i}`;
    svg.append("clipPath").attr("id", clipId).append("rect")
      .attr("x", margin.left).attr("y", 0)
      .attr("width", width - margin.left - margin.right).attr("height", height);

    svg.append("g").selectAll("line").data(x.ticks(Math.round((hi - lo) / 30)).filter((t) => t % 30 === 0))
      .join("line").attr("class", "gridline")
      .attr("x1", (t) => x(t)).attr("x2", (t) => x(t))
      .attr("y1", margin.top).attr("y2", height - margin.bottom);

    svg.append("g").selectAll("rect").data(bins).join("rect")
      .attr("x", (b) => x(b.x0) + 0.5).attr("width", (b) => Math.max(0, x(b.x1) - x(b.x0) - 1))
      .attr("y", (b) => y(binDensity(b))).attr("height", (b) => y(0) - y(binDensity(b)))
      .attr("fill", "#92a5b5").attr("opacity", 0.16);

    const points = xs.map((xv, j) => [xv, density[j]]);
    const at = d3.bisector((p) => p[0]).left(points, mine);
    const split = [mine, kde(minutes, [mine])[0]];
    const faster = [...points.slice(0, at), split];
    const slower = [split, ...points.slice(at)];
    const area = d3.area().x((p) => x(p[0])).y0(y(0)).y1((p) => y(p[1]));
    const plot = svg.append("g").attr("clip-path", `url(#${clipId})`);
    plot.append("path").attr("d", area(faster)).attr("fill", COLORS.blue).attr("opacity", 0.37);
    plot.append("path").attr("d", area(slower)).attr("fill", COLORS.slower).attr("opacity", 0.37);
    plot.append("path").attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1]))(points))
      .attr("fill", "none").attr("stroke", COLORS.ink).attr("stroke-width", 1.7);

    const med = group.median / 60;
    svg.append("line").attr("x1", x(med)).attr("x2", x(med))
      .attr("y1", margin.top).attr("y2", y(0))
      .attr("stroke", COLORS.muted).attr("stroke-width", 1.4).attr("stroke-dasharray", "5 4");
    svg.append("line").attr("x1", x(mine)).attr("x2", x(mine))
      .attr("y1", margin.top - 6).attr("y2", y(0))
      .attr("stroke", COLORS.red).attr("stroke-width", 2.6);
    const labelLeft = med > mine && x(mine) - margin.left > 30;
    svg.append("text").attr("x", x(mine) + (labelLeft ? -5 : 5)).attr("y", margin.top + 4)
      .attr("text-anchor", labelLeft ? "end" : "start")
      .attr("fill", COLORS.red).attr("font-size", 11).attr("font-weight", 700).text("YOU");

    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickValues(d3.range(lo, hi + 1, 30)).tickFormat(hm).tickPadding(8));
  }
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawWaves(rider) {
  waveResizeObserver?.disconnect();
  const rowH = 22;
  const width = 1000;
  const margin = { top: 34, right: 170, bottom: 48, left: 112 };
  const height = rowH * waves.length;
  const bounds = waves.flatMap((w) => [w.min, w.max]).map((s) => s / 60);
  const x = d3.scaleLinear(
    [Math.floor(d3.min(bounds) / 30) * 30, Math.ceil(d3.max(bounds) / 30) * 30],
    [margin.left, width - margin.right],
  );
  const rowY = (i) => rowH * i + rowH / 2;
  const random = mulberry32(data.race.year);

  const headerSvg = d3.select($("wave-header")).html("").append("svg")
    .attr("viewBox", `0 0 ${width} ${margin.top}`)
    .attr("role", "img")
    .attr("aria-label", `Wave, start, finishers and median columns; your finish ${hms(rider.net)}`);
  const svg = d3.select($("wave-rows-content")).html("").append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Finish time distribution for every start wave");

  svg.append("g").selectAll("line").data(d3.range(x.domain()[0], x.domain()[1] + 1, 30)).join("line")
    .attr("class", "gridline")
    .attr("x1", (t) => x(t)).attr("x2", (t) => x(t))
    .attr("y1", 0).attr("y2", height);

  const header = headerSvg.append("g").attr("fill", COLORS.muted).attr("font-size", 11);
  header.append("text").attr("x", 8).attr("y", 18).text("WAVE / START");
  header.append("text").attr("x", width - margin.right + 18).attr("y", 18).text("FINISHERS");
  header.append("text").attr("x", width - margin.right + 96).attr("y", 18).text("MEDIAN");

  waves.forEach((w, i) => {
    const mineRow = w.wave === rider.wave;
    const color = mineRow ? COLORS.accent : COLORS.blue;
    const cy = rowY(i);
    const row = svg.append("g").attr("class", mineRow ? "wave-highlight" : null);
    row.append("title").text(
      `Wave ${w.wave} · ${clockTime(w.start)} start · ${fmt(w.n)} finishers · median ${hms(w.median)}`,
    );
    if (mineRow || i % 2 === 0) {
      row.append("rect").attr("x", 0).attr("width", width).attr("y", cy - rowH / 2 + 0.5).attr("height", rowH - 1)
        .attr("fill", mineRow ? COLORS.accent : COLORS.band).attr("opacity", mineRow ? 0.1 : 1);
    }
    const lo = x(w.whiskerMin / 60);
    const hi = x(w.whiskerMax / 60);
    const isOutlier = (t) => t < w.lowerFence || t > w.upperFence;
    row.append("line").attr("x1", lo).attr("x2", hi).attr("y1", cy).attr("y2", cy)
      .attr("stroke", COLORS.range).attr("stroke-width", 0.9);
    for (const end of [lo, hi]) {
      row.append("line").attr("x1", end).attr("x2", end).attr("y1", cy - 2.5).attr("y2", cy + 2.5)
        .attr("stroke", COLORS.range).attr("stroke-width", 0.9);
    }
    row.append("g").selectAll("circle").data(w.times).join("circle")
      .attr("cx", (t) => x(t / 60)).attr("cy", () => cy + (random() - 0.5) * rowH * 0.56)
      .attr("r", 1.6)
      .attr("fill", (t) => isOutlier(t) ? "none" : color)
      .attr("stroke", (t) => isOutlier(t) ? color : "none")
      .attr("stroke-width", 0.7)
      .attr("opacity", 0.3)
      .append("title").text((t) => `Wave ${w.wave} · ${hms(t)}${isOutlier(t)
        ? " · Outlier: outside this wave's 1.5×IQR fences" : ""}`);
    row.append("rect")
      .attr("x", x(w.q1 / 60)).attr("width", x(w.q3 / 60) - x(w.q1 / 60))
      .attr("y", cy - rowH * 0.24).attr("height", rowH * 0.48)
      .attr("fill", color).attr("fill-opacity", 0.25).attr("stroke", color).attr("stroke-opacity", 0.5);
    row.append("line").attr("x1", x(w.median / 60)).attr("x2", x(w.median / 60))
      .attr("y1", cy - rowH * 0.26).attr("y2", cy + rowH * 0.26)
      .attr("stroke", COLORS.ink).attr("stroke-width", 2.2);

    const labelColor = mineRow ? COLORS.accent : COLORS.ink;
    const weight = mineRow ? 700 : 400;
    const label = row.append("g").attr("font-size", 12).attr("dominant-baseline", "middle")
      .attr("font-weight", weight);
    label.append("text").attr("x", 8).attr("y", cy).attr("fill", labelColor)
      .text(String(w.wave).padStart(2, "0"));
    label.append("text").attr("x", 44).attr("y", cy).attr("fill", labelColor).text(clockTime(w.start));
    label.append("text").attr("x", width - margin.right + 18).attr("y", cy)
      .attr("fill", mineRow ? COLORS.accent : COLORS.muted).text(fmt(w.n));
    label.append("text").attr("x", width - margin.right + 96).attr("y", cy).attr("fill", COLORS.ink)
      .text(hms(w.median));
  });

  const mine = x(rider.net / 60);
  svg.append("line").attr("x1", mine).attr("x2", mine)
    .attr("y1", 0).attr("y2", height)
    .attr("stroke", COLORS.red).attr("stroke-width", 1.4).attr("stroke-dasharray", "6 4");
  const myRow = waves.findIndex((w) => w.wave === rider.wave);
  svg.append("circle").attr("cx", mine).attr("cy", rowY(myRow)).attr("r", 5)
    .attr("fill", COLORS.red).attr("stroke", "#fff").attr("stroke-width", 1.2);
  headerSvg.append("text").attr("x", mine + 6).attr("y", margin.top - 8)
    .attr("fill", COLORS.red).attr("font-size", 11).attr("font-weight", 700).text(`YOU ${hms(rider.net)}`);

  const axisSvg = d3.select($("wave-axis")).html("").append("svg")
    .attr("viewBox", `0 0 ${width} ${margin.bottom}`)
    .attr("role", "img")
    .attr("aria-label", "Finish time axis in hours and minutes");
  axisSvg.append("g").attr("class", "axis")
    .call(d3.axisBottom(x).tickValues(d3.range(x.domain()[0], x.domain()[1] + 1, 30)).tickFormat(hm).tickPadding(8));
  axisSvg.append("text").attr("x", (margin.left + width - margin.right) / 2).attr("y", margin.bottom - 8)
    .attr("text-anchor", "middle").attr("fill", COLORS.muted).attr("font-size", 12).text("Finish time (h:mm)");

  const viewport = $("wave-rows");
  waveResizeObserver = new ResizeObserver(() => {
    const scale = svg.node().getBoundingClientRect().width / width;
    if (!scale || !viewport.clientHeight) return;
    viewport.scrollTop = rowY(myRow) * scale - viewport.clientHeight / 2;
  });
  waveResizeObserver.observe(viewport);
}
