import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

import {
  ageGenderFinishTimes, clockTime, comparisonRank, divisionLabel, duration, estimateNextWave, findRiders, findYearRiders,
  groupsFor, hm, hms, kde, ordinal, parseRace, passCounts, passDistribution, podium, riderHistory, riderSplits, waveDistributions,
  winnerGaps, raceRecap, selectRaceEvent,
} from "./stats.js?v=19";

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
let historyMetric = "time";
let historyFinishes = [];
const fmt = d3.format(",");
const $ = (id) => document.getElementById(id);

const DATA_VERSION = 5;
const dataUrl = (path) => `data/${path}?v=${DATA_VERSION}`;
const index = await (await fetch(`data/index.json?v=${DATA_VERSION}`)).json();
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
  parseRace(await (await fetch(dataUrl(yearEntry.path))).json()), raceKey, eventInfo.name,
);
const raceCache = new Map([[data.race.year, Promise.resolve(data)]]);
const passDistributions = new Map();
const splitsCache = new Map();
let splitsRequest = 0;
let historyRequest = 0;
async function fetchYearJson(entry, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(dataUrl(entry.path));
      if (!response.ok) throw new Error(`${entry.year}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
}

function loadRace(entry) {
  if (!raceCache.has(entry.year)) {
    const request = fetchYearJson(entry)
      .then((json) => selectRaceEvent(parseRace(json), raceKey, eventInfo.name))
      .catch((error) => {
        raceCache.delete(entry.year);
        throw error;
      });
    raceCache.set(entry.year, request);
  }
  return raceCache.get(entry.year);
}
const hasBibData = data.riders.some((r) => Number.isInteger(r.bib));
const raceHistory = await Promise.all(eventYears
  .filter((entry) => entry.year <= data.race.year && entry.year >= data.race.year - 5)
  .map(loadRace));
const raceTitle = `${data.race.name} ${data.race.year}`;
$("race-title").textContent = raceTitle;
document.title = `${raceTitle} results`;
renderRaceRecap(data);
drawEntriesHistory();
drawCoursePaceHistory();
drawCourseDistanceHistory();
drawAgeGenderFinishTimes(data);
const hasWaveData = data.finishers.some((r) => Number.isInteger(r.wave));
const hasStartData = data.finishers.some((r) => Number.isFinite(r.start) && Number.isInteger(r.wave));
let waves = [];
let waveResizeObserver;
$("source").href = data.race.resultsUrl;
$("source").textContent = data.race.sourceName;
$("source-note").textContent = hasStartData
  ? " with start-wave information."
  : hasWaveData ? " with wave assignments; scheduled start times unavailable."
    : " (start-wave data unavailable for this year).";
$("passes").hidden = !hasStartData;
$("wave-results").hidden = !hasWaveData;

$("event").addEventListener("change", () => {
  const nextEvent = $("event").value;
  const nextYear = index.events[nextEvent].years[0].year;
  location.assign(raceUrl(nextYear, nextEvent));
});
$("lookup").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("query").value.trim()) lookup($("query").value);
  else resetLookup();
});
$("query").addEventListener("input", () => {
  if (!$("query").value.trim()) resetLookup();
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
      const response = await fetch(dataUrl(entry.path));
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
$("history-metric-toggle").addEventListener("change", (event) => {
  if (event.target.name !== "history-metric") return;
  historyMetric = event.target.value;
  renderHistoryCharts();
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
  const container = $("entries-history-chart");
  let lastWidth = 0;
  const draw = () => {
  const width = Math.round(container.clientWidth);
  if (!width || width === lastWidth) return;
  lastWidth = width;
  container.replaceChildren();
  const height = 300;
  const margin = { top: 28, right: 12, bottom: 46, left: 48 };
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
    .call(d3.axisBottom(x).tickValues(years.filter((_, index) =>
      index % Math.max(1, Math.ceil(years.length
        / Math.max(2, Math.floor((width - margin.left - margin.right) / 90)))) === 0))
      .tickSize(0).tickPadding(10));
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
    .text((entry) => width >= 760 ? fmt(entry.riders) : "");
  };
  new ResizeObserver(draw).observe(container);
  draw();
}

function addChartTooltip(container, svg, groups, plot) {
  const visible = groups.filter((group) => group.rows.length);
  if (!visible.length) return;
  // One viewport-fixed tooltip shared by all charts, so it never changes page layout or scroll size.
  let tooltip = document.getElementById("chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "chart-tooltip";
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    document.body.append(tooltip);
  }
  const marks = svg.append("g").attr("class", "hover-marks").attr("pointer-events", "none").attr("display", "none");
  const guide = marks.append("line").attr("class", "hover-guide")
    .attr("y1", plot.top).attr("y2", plot.bottom);
  const dots = marks.append("g");
  svg.append("rect").attr("class", "hover-overlay")
    .attr("x", plot.left).attr("y", plot.top)
    .attr("width", plot.right - plot.left).attr("height", plot.bottom - plot.top)
    .attr("fill", "none").attr("pointer-events", "all")
    .on("pointermove", (event) => {
      const [px] = d3.pointer(event, svg.node());
      const group = d3.least(visible, (candidate) => Math.abs(candidate.x - px));
      guide.attr("x1", group.x).attr("x2", group.x);
      dots.selectAll("circle").data(group.rows).join("circle")
        .attr("cx", group.x).attr("cy", (row) => row.y).attr("r", 6)
        .attr("fill", "none").attr("stroke", (row) => row.color).attr("stroke-width", 2);
      marks.attr("display", null);
      tooltip.replaceChildren();
      const header = document.createElement("strong");
      header.textContent = group.header;
      tooltip.append(header);
      for (const row of group.rows) {
        const line = document.createElement("div");
        const swatch = document.createElement("span");
        swatch.className = "chart-tooltip-swatch";
        swatch.style.background = row.color;
        line.append(swatch, `${row.label ? `${row.label}: ` : ""}${row.value}`);
        if (row.detail) {
          const detail = document.createElement("span");
          detail.className = "chart-tooltip-detail";
          detail.textContent = ` ${row.detail}`;
          line.append(detail);
        }
        tooltip.append(line);
      }
      tooltip.hidden = false;
      const gap = 14;
      const flip = event.clientX + gap + tooltip.offsetWidth > window.innerWidth - 8;
      const left = flip ? event.clientX - gap - tooltip.offsetWidth : event.clientX + gap;
      const top = Math.min(Math.max(8, event.clientY - tooltip.offsetHeight / 2),
        window.innerHeight - tooltip.offsetHeight - 8);
      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${top}px`;
    })
    .on("pointerleave", () => {
      marks.attr("display", "none");
      tooltip.hidden = true;
    });
}

function drawCoursePaceHistory() {
  const section = $("course-pace-history");
  if (raceKey !== "iceman") {
    section.hidden = true;
    return;
  }
  const entries = [...index.events.iceman.years].sort((a, b) => a.year - b.year);
  const series = [
    { key: "menFastest", speedKey: "menWinnerSpeed", count: "menFinishers", label: "Men's winner", color: COLORS.accent },
    { key: "womenFastest", speedKey: "womenWinnerSpeed", count: "womenFinishers", label: "Women's winner", color: COLORS.red },
  ];
  const available = entries.flatMap((entry) => series
    .map(({ key }) => entry[key]).filter(Number.isFinite));
  if (!available.length) {
    section.hidden = true;
    return;
  }
  const container = $("course-pace-history-chart");
  let metric = "speed";
  let lastWidth = 0;
  const draw = () => {
    const width = Math.round(container.clientWidth);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    container.replaceChildren();
    const speed = metric === "speed";
    const valueFor = (entry, item) => entry[speed ? item.speedKey : item.key];
    const values = entries.flatMap((entry) => series.map((item) => valueFor(entry, item)))
      .filter(Number.isFinite);
    const formatValue = speed ? (value) => `${value.toFixed(1)} mph` : hms;
    $("course-pace-history-title").textContent = speed
      ? "Winners' average speed by year" : "Winning finish times by year";
    if (!values.length) {
      const message = document.createElement("p");
      message.textContent = "No published winner speeds available. Select Time to see winning finish times.";
      container.append(message);
      return;
    }

    const height = 360;
    const margin = { top: 24, right: 20, bottom: 56, left: 76 };
    const x = d3.scaleLinear(
      [entries[0].year, entries.at(-1).year],
      [margin.left, width - margin.right],
    );
    const minValue = Math.min(...values), maxValue = Math.max(...values);
    const padding = Math.max(speed ? 0.5 : 60, (maxValue - minValue) * 0.08);
    const y = d3.scaleLinear([Math.max(0, minValue - padding), maxValue + padding],
      [height - margin.bottom, margin.top]).nice();
    const svg = d3.select(container).append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `Men's and women's ${speed ? "winning average speeds" : "winning finish times"} by year, ${
        entries[0].year} to ${entries.at(-1).year}. ${speed ? "Higher" : "Lower"} is faster.`);
    svg.append("g").selectAll("line").data(y.ticks(5)).join("line")
      .attr("class", "gridline")
      .attr("x1", margin.left).attr("x2", width - margin.right)
      .attr("y1", (time) => y(time)).attr("y2", (time) => y(time));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x)
        .ticks(Math.max(2, Math.floor((width - margin.left - margin.right) / 90)))
        .tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(speed ? d3.format(".1f") : hms));
    for (const item of series) {
      const dataKey = d3.range(entries[0].year, entries.at(-1).year + 1).map((year) => {
        const entry = entries.find((entry) => entry.year === year);
        return entry ? { ...entry, value: valueFor(entry, item) } : { year, value: null };
      });
      svg.append("path")
        .datum(dataKey)
        .attr("class", `course-pace-line ${item.key}`)
        .attr("fill", "none")
        .attr("stroke", item.color)
        .attr("stroke-width", 2.5)
        .attr("d", d3.line().defined((entry) => Number.isFinite(entry.value))
          .x((entry) => x(entry.year)).y((entry) => y(entry.value)));
      svg.append("g").selectAll("circle")
        .data(dataKey.filter((entry) => Number.isFinite(entry.value)))
        .join("circle")
        .attr("class", "course-pace-point")
        .attr("cx", (entry) => x(entry.year))
        .attr("cy", (entry) => y(entry.value))
        .attr("r", 3.5)
        .attr("fill", item.color);
    }
    svg.append("text").attr("class", "course-pace-axis-label")
      .attr("transform", `translate(16,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .text(speed ? "Average speed, mph (higher = faster)" : "Winning finish time (lower = faster)");
    addChartTooltip(container, svg, entries.map((entry) => ({
      x: x(entry.year),
      header: String(entry.year),
      rows: series.filter((item) => Number.isFinite(valueFor(entry, item))).map((item) => ({
        color: item.color, label: item.label, y: y(valueFor(entry, item)),
        value: formatValue(valueFor(entry, item)),
        detail: `(${fmt(entry[item.count])} finishers)`,
      })),
    })), { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom });
  };
  for (const input of section.querySelectorAll('input[name="course-pace-metric"]')) {
    input.addEventListener("change", () => {
      metric = input.value;
      lastWidth = 0;
      draw();
    });
  }
  new ResizeObserver(draw).observe(container);
  draw();
}

function drawCourseDistanceHistory() {
  const section = $("course-distance-history");
  if (raceKey !== "iceman") {
    section.hidden = true;
    return;
  }
  const years = [...eventYears].sort((a, b) => a.year - b.year);
  const entries = d3.range(years[0].year, years.at(-1).year + 1).map((year) =>
    years.find((entry) => entry.year === year) ?? { year, courseDistance: null });
  const points = entries.filter((entry) => Number.isFinite(entry.courseDistance));
  if (!points.length) {
    section.hidden = true;
    return;
  }
  const container = $("course-distance-history-chart");
  let lastWidth = 0;
  const draw = () => {
    const width = Math.round(container.clientWidth);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    container.replaceChildren();
    const height = 260;
    const margin = { top: 20, right: 20, bottom: 40, left: 76 };
    const x = d3.scaleLinear([entries[0].year, entries.at(-1).year],
      [margin.left, width - margin.right]);
    const distances = points.map((entry) => entry.courseDistance);
    const minDistance = Math.min(...distances), maxDistance = Math.max(...distances);
    const padding = Math.max(0.5, (maxDistance - minDistance) * 0.1);
    const y = d3.scaleLinear([Math.max(0, minDistance - padding), maxDistance + padding],
      [height - margin.bottom, margin.top]).nice();
    const svg = d3.select(container).append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", `Course distance in miles by year, ${entries[0].year} to ${
        entries.at(-1).year}. Hollow points indicate estimates from rounded finisher speeds.`);
    svg.append("g").selectAll("line").data(y.ticks(5)).join("line")
      .attr("class", "gridline")
      .attr("x1", margin.left).attr("x2", width - margin.right)
      .attr("y1", (distance) => y(distance)).attr("y2", (distance) => y(distance));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x)
        .ticks(Math.max(2, Math.floor((width - margin.left - margin.right) / 90)))
        .tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".1f")));
    svg.append("path").datum(entries).attr("class", "course-distance-line")
      .attr("fill", "none").attr("stroke", COLORS.accent).attr("stroke-width", 2.5)
      .attr("d", d3.line().defined((entry) => Number.isFinite(entry.courseDistance))
        .x((entry) => x(entry.year)).y((entry) => y(entry.courseDistance)));
    svg.append("g").selectAll("circle").data(points).join("circle")
      .attr("cx", (entry) => x(entry.year)).attr("cy", (entry) => y(entry.courseDistance))
      .attr("r", 4).attr("stroke", COLORS.accent).attr("stroke-width", 2)
      .attr("fill", (entry) => entry.courseDistanceEstimated ? "#fff" : COLORS.accent);
    addChartTooltip(container, svg, points.map((entry) => ({
      x: x(entry.year),
      header: String(entry.year),
      rows: [{
        color: COLORS.accent, label: "", y: y(entry.courseDistance),
        value: `${entry.courseDistance.toFixed(1)} miles`,
        detail: entry.courseDistanceEstimated ? "(approximate, averaged from finishers' rounded speeds and times)" : "(published distance)",
      }],
    })), { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom });
    svg.append("text").attr("class", "course-pace-axis-label")
      .attr("transform", `translate(16,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle").text("Course distance (miles)");
  };
  new ResizeObserver(draw).observe(container);
  draw();
}

function drawAgeGenderFinishTimes(raceData) {
  const section = $("age-gender-finish-times");
  const container = $("age-gender-finish-times-chart");
  const emptyMessage = $("age-gender-finish-times-empty");
  if (raceKey !== "iceman") {
    section.hidden = true;
    return;
  }
  const ages = ageGenderFinishTimes(raceData.finishers);
  const series = [
    { key: "menMedian", speedKey: "menMedianSpeed", count: "menFinishers", label: "Men", color: COLORS.accent },
    { key: "womenMedian", speedKey: "womenMedianSpeed", count: "womenFinishers", label: "Women", color: COLORS.red },
  ];
  if (!ages.some((entry) => series.some(({ key }) => Number.isFinite(entry[key])))) {
    container.hidden = true;
    emptyMessage.textContent = `No finishers have a published age or bounded age division and gender for ${raceData.race.year}.`;
    emptyMessage.hidden = false;
    return;
  }
  container.hidden = false;
  emptyMessage.hidden = true;
  let lastWidth = 0;
  let lastMetric = null;
  const draw = () => {
    const width = Math.round(container.clientWidth);
    const speed = document.querySelector('input[name="course-pace-metric"]:checked')?.value === "speed";
    if (!width || (width === lastWidth && speed === lastMetric)) return;
    lastWidth = width;
    lastMetric = speed;
    container.replaceChildren();
    const valueKey = (item) => speed ? item.speedKey : item.key;
    const values = ages.flatMap((entry) => series.map((item) => entry[valueKey(item)]))
      .filter(Number.isFinite);
    $("age-gender-finish-times-title").textContent = speed
      ? "Median speed by age category" : "Median finish time by age category";
    if (!values.length) {
      const message = document.createElement("p");
      message.textContent = "No speed data available. Select Time to see median finish times.";
      container.append(message);
      return;
    }

    const height = 360;
    const margin = { top: 24, right: 20, bottom: 56, left: 76 };
    const [minAge, maxAge] = d3.extent(ages, (entry) => entry.age);
    const x = d3.scaleLinear(
      minAge === maxAge ? [minAge - 1, maxAge + 1] : [minAge, maxAge],
      [margin.left, width - margin.right],
    );
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const padding = Math.max(speed ? 0.5 : 60, (maxValue - minValue) * 0.08);
    const y = d3.scaleLinear([Math.max(0, minValue - padding), maxValue + padding],
      [height - margin.bottom, margin.top]).nice();
    const svg = d3.select(container).append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `Median ${speed ? "speeds" : "finish times"} by age and gender for ${
        raceData.race.year}. ${speed ? "Higher" : "Lower"} is faster. Uses published ages or age divisions plotted at their midpoints.`);
    svg.append("g").selectAll("line").data(y.ticks(5)).join("line")
      .attr("class", "gridline")
      .attr("x1", margin.left).attr("x2", width - margin.right)
      .attr("y1", (time) => y(time)).attr("y2", (time) => y(time));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x)
        .ticks(Math.max(2, Math.floor((width - margin.left - margin.right) / 40)))
        .tickFormat(d3.format("d")));
    svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickFormat(speed ? d3.format(".1f") : hms));
    for (const item of series) {
      const key = valueKey(item);
      const formatValue = speed ? (value) => `${value.toFixed(1)} mph` : hms;
      svg.append("path")
        .datum(ages.filter((entry) => Number.isFinite(entry[key])))
        .attr("class", `age-gender-line ${item.key}`)
        .attr("fill", "none")
        .attr("stroke", item.color)
        .attr("stroke-width", 2.5)
        .attr("d", d3.line().defined((entry) => Number.isFinite(entry[key]))
          .x((entry) => x(entry.age)).y((entry) => y(entry[key])));
      svg.append("g").selectAll("circle")
        .data(ages.filter((entry) => Number.isFinite(entry[key])))
        .join("circle")
        .attr("class", "age-gender-point")
        .attr("cx", (entry) => x(entry.age))
        .attr("cy", (entry) => y(entry[key]))
        .attr("r", 3.5)
        .attr("fill", item.color);
    }
    svg.append("text").attr("class", "course-pace-axis-label")
      .attr("x", (margin.left + width - margin.right) / 2)
      .attr("y", height - 8).attr("text-anchor", "middle").text("Age");
    svg.append("text").attr("class", "course-pace-axis-label")
      .attr("transform", `translate(16,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
      .attr("text-anchor", "middle")
      .text(speed ? "Median speed, mph (higher = faster)" : "Median finish time");
    addChartTooltip(container, svg, ages.map((entry) => ({
      x: x(entry.age),
      header: `Age ${entry.ageMin === entry.ageMax ? entry.ageMin : `${entry.ageMin}-${entry.ageMax}`}`,
      rows: series.filter((item) => Number.isFinite(entry[valueKey(item)])).map((item) => ({
        color: item.color, label: item.label, y: y(entry[valueKey(item)]),
        value: speed ? `${entry[valueKey(item)].toFixed(1)} mph` : hms(entry[valueKey(item)]),
        detail: `(${fmt(entry[item.count])} finishers)`,
      })),
    })), { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom });
  };
  for (const input of document.querySelectorAll('input[name="course-pace-metric"]')) {
    input.addEventListener("change", draw);
  }
  new ResizeObserver(draw).observe(container);
  draw();
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

function resetLookup() {
  const url = raceUrl(data.race.year, raceKey);
  if (url !== location.search) window.history.pushState(null, "", url);
  clearResult();
}

function clearResult() {
  historyRequest++;
  splitsRequest++;
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
        divisionLabel(rider),
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

function loadSplits(entry) {
  if (!entry.splits) return Promise.resolve(null);
  if (!splitsCache.has(entry.splits)) {
    const request = fetch(dataUrl(entry.splits)).then((response) => {
      if (!response.ok) throw new Error(`Could not load ${entry.splits}`);
      return response.json();
    });
    request.catch(() => splitsCache.delete(entry.splits));
    splitsCache.set(entry.splits, request);
  }
  return splitsCache.get(entry.splits);
}

async function renderSplits(rider) {
  const request = ++splitsRequest;
  $("rider-splits").hidden = true;
  $("splits-rows").replaceChildren();
  let result = null;
  try {
    result = riderSplits(rider, await loadSplits(yearEntry));
  } catch (error) {
    console.error("Could not load checkpoint splits", error);
  }
  if (request !== splitsRequest || !result) return;
  const { rows, estimated } = result;
  for (const row of rows) {
    const tr = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = [row.location ?? row.name, Number.isFinite(row.miles) ? `${estimated ? "~" : ""}${row.miles.toFixed(1)} mi` : ""]
      .filter(Boolean).join(" · ");
    tr.append(name);
    for (const value of [
      row.elapsed === null ? "—" : hms(row.elapsed),
      row.leg === null ? "—" : hms(row.leg),
      row.speed === null ? "—" : `${row.speed.toFixed(1)} mph`,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.append(cell);
    }
    $("splits-rows").append(tr);
  }
  $("rider-splits").hidden = false;
}

function finishNote(rider) {
  return Number.isFinite(rider.speed) && rider.speed > 0
    ? `${rider.speed.toFixed(1)} mph avg · official finish time` : "official finish time";
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function show(rider) {
  setMessage("");
  $("rider-name").textContent = rider.name;
  $("rider-city").textContent = rider.city;
  $("rider-chips").replaceChildren(
    chip("Bib", rider.bib ?? "Not listed"),
    chip("Division", divisionLabel(rider) || "None listed"),
    chip("Field", capitalize(rider.raceGroup)),
  );
  waves = waveDistributions(rider, data.finishers, data.race);
  const hasRiderWave = Number.isFinite(rider.start) && Number.isFinite(rider.clock)
    && Number.isInteger(rider.wave);
  $("passes").hidden = !hasRiderWave;
  $("pass-distribution").hidden = !hasRiderWave;
  $("wave-results").hidden = !rider.finished || waves.length === 0;
  $("report").hidden = false;
  $("details").hidden = !rider.finished;
  document.title = `${rider.name} — ${raceTitle}`;
  renderSplits(rider);
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
      { label: "Finish time", value: hms(rider.net), note: finishNote(rider), primary: true },
      { label: `${capitalize(rider.raceGroup)} place`, value: ordinal(comparisonRank(rider, data.finishers)),
        note: `published overall: ${ordinal(rider.status)}` },
      podiumFact(rider),
    ]);
    drawCurves(rider);
    if (waves.length) drawWaves(rider);
    return;
  }
  renderWaveEstimate(rider);
  renderFacts([
    { label: "Finish time", value: hms(rider.net), note: finishNote(rider), primary: true },
    podiumFact(rider),
    { label: "Start", value: clockTime(rider.start), note: `wave ${rider.wave}` },
    { label: "Finished at", value: hms(rider.clock), note: "time of day" },
  ]);

  const counts = passCounts(rider, data.finishers);
  $("passed").textContent = fmt(counts.passed);
  $("passed-by").textContent = fmt(counts.passedBy);
  $("net").textContent = `${counts.net > 0 ? "+" : ""}${fmt(counts.net)}`;
  drawPassDistribution(rider, counts.passed);

  drawCurves(rider);
  drawWaves(rider);
}

function drawPassDistribution(rider, passed) {
  const field = rider.raceGroup ?? "amateur";
  if (!passDistributions.has(field)) {
    passDistributions.set(field, passDistribution(rider, data.finishers));
  }
  const values = passDistributions.get(field).map((entry) => entry.passed);
  const lower = values.filter((value) => value < passed).length;
  const summary = `${fmt(values.length)} ${field} finishers with known start times. `
    + `You passed ${fmt(passed)} riders, more than ${(lower / values.length * 100).toFixed(1)}% `
    + `of this field (ties not counted). Median: ${fmt(d3.median(values))} passes.`;
  $("pass-distribution-summary").textContent =
    `More passes than ${(lower / values.length * 100).toFixed(1)}% of field`;
  $("pass-distribution-summary").title = summary;
  $("pass-chart").replaceChildren();

  const width = 300, height = 130;
  const margin = { top: 22, right: 14, bottom: 24, left: 14 };
  const max = d3.max(values);
  const hi = Math.max(10, Math.ceil(max * 1.05 / 10) * 10);
  const x = d3.scaleLinear([0, hi], [margin.left, width - margin.right]);
  const xs = d3.range(301).map((i) => i * hi / 300);
  const density = kde(values, xs);
  const points = xs.map((value, i) => [value, density[i]]);
  const split = [passed, kde(values, [passed])[0]];
  const at = d3.bisector((point) => point[0]).left(points, passed);
  const explanation = "Higher parts of the curve mean more riders with similar pass totals. "
    + "The red line marks you; the dashed line is the median.";
  const y = d3.scaleLinear([0, Math.max(d3.max(density), split[1]) * 1.16],
    [height - margin.bottom, margin.top]);
  const svg = d3.select($("pass-chart")).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", `Distribution of riders passed. ${summary} ${explanation}`);
  svg.append("g").selectAll("line").data(x.ticks(3).filter(Number.isInteger))
    .join("line").attr("class", "gridline")
    .attr("x1", (value) => x(value)).attr("x2", (value) => x(value))
    .attr("y1", margin.top).attr("y2", y(0));
  const area = d3.area().x((point) => x(point[0])).y0(y(0)).y1((point) => y(point[1]));
  svg.append("path").attr("d", area([...points.slice(0, at), split]))
    .attr("fill", COLORS.slower).attr("opacity", 0.37);
  svg.append("path").attr("d", area([split, ...points.slice(at)]))
    .attr("fill", COLORS.blue).attr("opacity", 0.37);
  svg.append("path").attr("d", d3.line().x((point) => x(point[0])).y((point) => y(point[1]))(points))
    .attr("fill", "none").attr("stroke", COLORS.ink).attr("stroke-width", 1.7);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y(0)})`)
    .call(d3.axisBottom(x).tickFormat(fmt).tickValues(x.ticks(3).filter(Number.isInteger)));
  const med = d3.median(values);
  svg.append("line").attr("x1", x(med)).attr("x2", x(med))
    .attr("y1", margin.top).attr("y2", y(0))
    .attr("stroke", COLORS.muted).attr("stroke-width", 1.4).attr("stroke-dasharray", "5 4");
  svg.append("line").attr("x1", x(passed)).attr("x2", x(passed))
    .attr("y1", margin.top - 4).attr("y2", y(0))
    .attr("stroke", COLORS.red).attr("stroke-width", 2.6);
  svg.append("text").attr("x", x(passed)).attr("y", margin.top - 10)
    .attr("text-anchor", passed > max / 2 ? "end" : "start")
    .attr("fill", COLORS.red).attr("font-size", 12).attr("font-weight", 700)
    .text(`You: ${fmt(passed)}`);
}

function renderWaveEstimate(rider) {
  const estimate = estimateNextWave(rider, raceHistory,
    waves.filter((wave) => wave.kind !== "pro"), data.race);
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
  historyFinishes = [];
  $("history-speed-option").disabled = true;
  $("history-metric-toggle").hidden = true;
  $("history-table").hidden = true;
  $("history-rows").replaceChildren();
  try {
    const history = await Promise.all(eventYears.map(loadRace));
    if (request !== historyRequest) return;
    const { results, ambiguousYears } = riderHistory(rider, history);
    const historyByYear = new Map(history.map((year) => [year.race.year, year]));
    const finishes = results.filter((result) => result.net !== null);
    historyFinishes = finishes;
    const message = [
      `${results.length} matched year${results.length === 1 ? "" : "s"}`,
      results.length > 1 && finishes.length < 2 ? "At least two finishes are needed to show a trend." : "",
      ambiguousYears.length ? `Duplicate names: ${ambiguousYears.join(", ")} omitted.` : "",
    ].filter(Boolean).join(" ");
    $("history-message").textContent = message;
    const hasSpeedTrend = historyFinishes.filter((result) =>
      Number.isFinite(result.rider.speed) && result.rider.speed > 0).length >= 2;
    $("history-speed-option").disabled = !hasSpeedTrend;
    $("history-metric-toggle").hidden = results.length < 2;
    if (!hasSpeedTrend && historyMetric === "speed") {
      historyMetric = "time";
      $('input[name="history-metric"][value="time"]').checked = true;
    }
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
        const icon = trophy(AWARDS[divisionPodium.place].color, "");
        icon.setAttribute("aria-hidden", "true");
        const place = document.createElement("span");
        place.textContent = ordinal(divisionPodium.place);
        mark.append(icon, place);
        mark.title = `${ordinal(divisionPodium.place)} place in ${divisionLabel(result.rider)}`;
        yearCell.append(" ", mark);
      }
      row.append(yearCell);
      const waveCell = document.createElement("td");
      waveCell.textContent = result.rider.wave ? `Wave ${result.rider.wave}` : "—";
      row.append(waveCell);
      const change = result.timeChange;
      for (const value of [
        result.net === null ? String(result.rider.status)
          : `${hms(result.net)}${Number.isFinite(result.rider.speed)
            ? ` · ${result.rider.speed.toFixed(1)} mph` : ""}`,
        change === null ? "—" : change === 0 ? "No change" : `${change < 0 ? "−" : "+"}${duration(Math.abs(change))}`,
        result.net === null ? "—" : `${fmt(result.rank)} / ${fmt(result.fieldSize)} (${capitalize(result.rider.raceGroup ?? "amateur")})`,
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
      renderHistoryCharts(finishes);
    }
  } catch (error) {
    if (request !== historyRequest) return;
    console.error("Could not load rider history", error);
    $("history-message").classList.add("error");
    $("history-message").textContent = "Could not load all years. Search for the rider again to retry.";
  }
}

function renderHistoryCharts(finishes = historyFinishes) {
  $("history-charts").replaceChildren();
  if (finishes.length < 2) return;
  const yearDomain = d3.extent(finishes, (result) => result.year);
  const speed = historyMetric === "speed";
  const metricResults = speed
    ? finishes.map((result) => ({
      ...result,
      speed: Number.isFinite(result.rider.speed) ? result.rider.speed : null,
    }))
    : finishes;
  const values = speed ? metricResults.filter((result) => Number.isFinite(result.speed)) : finishes;
  drawHistoryChart(metricResults, {
    title: speed ? "Average speed" : "Finish time",
    note: speed ? "Higher is faster" : "Lower is faster",
    key: speed ? "speed" : "net",
    format: speed ? (value) => `${value.toFixed(1)} mph` : hms,
    color: COLORS.blue, yearDomain,
  });
  if (values.length < 2) {
    const card = d3.select($("history-charts")).append("article").attr("class", "card");
    card.append("p").attr("class", "muted")
      .text("Not enough speed data to show a trend.");
  }
  drawHistoryChart(finishes.filter((result) => result.aheadPct !== null), {
    title: "Ahead of field", note: "Higher is better; ties are not counted as behind you",
    key: "aheadPct", format: (value) => `${value.toFixed(1)}%`, color: COLORS.accent, yearDomain,
  });
}

function historyLink(result) {
  return raceUrl(result.year, raceKey, { bib: result.rider.bib ?? result.rider.name });
}

function drawHistoryChart(results, { title, note, key, format, color, yearDomain }) {
  const pointsData = results.filter((result) => Number.isFinite(result[key]));
  if (pointsData.length < 2) return;
  const width = 520;
  const height = 250;
  const margin = { top: 16, right: 20, bottom: 40, left: 66 };
  const card = d3.select($("history-charts")).append("article").attr("class", "card");
  card.append("div").attr("class", "card-head").append("h4").text(title);
  card.append("p").attr("class", "card-sub").text(note);
  const x = d3.scaleLinear(yearDomain, [margin.left, width - margin.right]);
  const [min, max] = d3.extent(pointsData, (result) => result[key]);
  const padding = Math.max((max - min) * 0.15, key === "speed" ? 0.5 : 60);
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
    .attr("d", d3.line().defined((result) => Number.isFinite(result[key]))
      .x((result) => x(result.year)).y((result) => y(result[key])))
    .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
  const points = svg.append("g").selectAll("a").data(pointsData).join("a")
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
  const where = `of ${fmt(result.size)} in ${divisionLabel(rider)}`;
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

function domainFor(minutes, riderMinutes) {
  const sorted = [...minutes].sort((a, b) => a - b);
  const p995 = d3.quantileSorted(sorted, 0.995);
  return [
    Math.floor(Math.min(sorted[0], riderMinutes) / 30) * 30,
    Math.ceil(Math.max(p995, riderMinutes + 10) / 30) * 30,
  ];
}

function drawCurves(rider) {
  const mine = rider.net / 60;
  const width = 520;
  const height = 230;
  const margin = { top: 24, right: 14, bottom: 34, left: 14 };
  const container = $("curves");
  container.replaceChildren();

  for (const [i, group] of groupsFor(rider, data.finishers, data.race).entries()) {
    const minutes = group.times.map((t) => t / 60);
    const [lo, hi] = domainFor(minutes, mine);
    const x = d3.scaleLinear([lo, hi], [margin.left, width - margin.right]);
    const xs = d3.range(lo, hi + 0.001, 0.25);
    const card = d3.select(container).append("article").attr("class", "card");
    const head = card.append("div").attr("class", "card-head");
    head.append("h4").text(group.title);
    head.append("span").attr("class", "rank").text(`${fmt(group.rank)} / ${fmt(group.n)}`);
    const sub = card.append("div").attr("class", "card-sub");
    sub.append("span").text(`Median ${hms(group.median)}`);
    sub.append("span").text(`Top ${group.topPct.toFixed(1)}%  ·  ahead of ${group.behindPct.toFixed(1)}%`);

    const density = kde(minutes, xs);
    const binCount = 24;
    const thresholds = d3.range(1, binCount).map((i) => lo + (hi - lo) * i / binCount);
    const bins = d3.bin().domain([lo, hi]).thresholds(thresholds)(minutes.filter((m) => m <= hi));
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
  const margin = { top: 34, right: 160, bottom: 48, left: 140 };
  const pad = 16;
  const height = rowH * waves.length;
  const viewport = $("wave-rows");
  const drawnWidth = viewport.clientWidth;

  // The plot is drawn at a fixed pixels-per-minute scale so that everything up to 2×IQR fills the
  // visible width; the slower tail of outliers extends past it and is reached by scrolling.
  const fullMin = Math.floor(d3.min(waves, (w) => w.min) / 60 / 30) * 30;
  const fullMax = Math.ceil(d3.max(waves, (w) => w.max) / 60 / 30) * 30;
  const coreMax = Math.min(fullMax, Math.ceil(d3.max(waves, (w) =>
    Math.min(w.max, w.q3 + 2 * (w.q3 - w.q1))) / 60 / 30) * 30);
  const visibleWidth = Math.max(360, (drawnWidth || 1000) - margin.left - margin.right);
  const pxPerMinute = (visibleWidth - 2 * pad) / Math.max(30, coreMax - fullMin);
  const plotWidth = Math.round((fullMax - fullMin) * pxPerMinute + 2 * pad);
  const totalWidth = margin.left + plotWidth + margin.right;
  const x = d3.scaleLinear([fullMin, fullMax], [pad, plotWidth - pad]);
  const ticks = d3.range(fullMin, fullMax + 1, 30);

  const rowY = (i) => rowH * i + rowH / 2;
  const random = mulberry32(data.race.year);

  // Each band is three columns: pinned labels, the wide scrolling plot, and pinned stats.
  const columns = (container, h) => {
    const track = d3.select(container).html("").append("div")
      .attr("class", "wave-track").style("width", `${totalWidth}px`);
    const column = (name, w) => track.append("div").attr("class", `wave-col wave-${name}`)
      .style("width", `${w}px`).append("svg")
      .attr("width", w).attr("height", h).attr("viewBox", `0 0 ${w} ${h}`);
    return {
      left: column("left", margin.left).attr("aria-hidden", "true"),
      plot: column("plot", plotWidth),
      right: column("right", margin.right).attr("aria-hidden", "true"),
    };
  };
  const head = columns($("wave-header"), margin.top);
  const body = columns($("wave-rows-content"), height);
  const axis = columns($("wave-axis"), margin.bottom);
  head.plot.attr("role", "img")
    .attr("aria-label", `Start group, start, finishers and median columns; your finish ${hms(rider.net)}`);
  body.plot.attr("role", "img")
    .attr("aria-label", "Finish time distributions by start group, including pro men and pro women");
  axis.plot.attr("role", "img").attr("aria-label", "Finish time axis in hours and minutes");

  body.plot.append("g").selectAll("line").data(ticks).join("line")
    .attr("class", "gridline")
    .attr("x1", (t) => x(t)).attr("x2", (t) => x(t))
    .attr("y1", 0).attr("y2", height);

  const header = head.left.append("g").attr("fill", COLORS.muted).attr("font-size", 11);
  header.append("text").attr("x", 8).attr("y", 18).text("START GROUP / START");
  const headerStats = head.right.append("g").attr("fill", COLORS.muted).attr("font-size", 11);
  headerStats.append("text").attr("x", 18).attr("y", 18).text("FINISHERS");
  headerStats.append("text").attr("x", 96).attr("y", 18).text("MEDIAN");

  waves.forEach((w, i) => {
    const mineRow = w.kind === "pro"
      ? rider.raceGroup === "pro" && rider.gender === w.gender
      : w.kind === "junior"
        ? rider.raceGroup === "junior"
          && (rider.division || `Junior ${rider.gender === "F" ? "women" : "men"}`) === w.division
        : rider.raceGroup === "amateur" && w.wave === rider.wave;
    const color = mineRow ? COLORS.accent : COLORS.blue;
    const cy = rowY(i);
    const rowName = w.label ?? `Wave ${w.wave}`;
    const startLabel = Number.isFinite(w.start) ? `${clockTime(w.start)} start` : null;
    const summary = [
      `${rowName}${w.kind === "pro" && w.wave !== null ? ` (wave ${w.wave})` : ""}`,
      startLabel,
      `${fmt(w.n)} finishers`,
      `median ${hms(w.median)}`,
    ].filter(Boolean).join(" · ");
    const [leftRow, row, rightRow] = [body.left, body.plot, body.right].map((svg) => {
      const group = svg.append("g").attr("class", mineRow ? "wave-highlight" : null);
      group.append("title").text(summary);
      if (mineRow || i % 2 === 0) {
        group.append("rect").attr("x", 0).attr("width", "100%").attr("y", cy - rowH / 2 + 0.5).attr("height", rowH - 1)
          .attr("fill", mineRow ? COLORS.accent : COLORS.band).attr("opacity", mineRow ? 0.1 : 1);
      }
      return group;
    });
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
      .append("title").text((t) => `${rowName} · ${hms(t)}${isOutlier(t)
        ? " · Outlier: outside this start group's 1.5×IQR fences" : ""}`);
    row.append("rect")
      .attr("x", x(w.q1 / 60)).attr("width", x(w.q3 / 60) - x(w.q1 / 60))
      .attr("y", cy - rowH * 0.24).attr("height", rowH * 0.48)
      .attr("fill", color).attr("fill-opacity", 0.25).attr("stroke", color).attr("stroke-opacity", 0.5);
    row.append("line").attr("x1", x(w.median / 60)).attr("x2", x(w.median / 60))
      .attr("y1", cy - rowH * 0.26).attr("y2", cy + rowH * 0.26)
      .attr("stroke", COLORS.ink).attr("stroke-width", 2.2);

    const labelColor = mineRow ? COLORS.accent : COLORS.ink;
    const weight = mineRow ? 700 : 400;
    const labels = (group) => group.append("g").attr("font-size", 12).attr("dominant-baseline", "middle")
      .attr("font-weight", weight);
    const label = labels(leftRow);
    label.append("text").attr("x", 8).attr("y", cy).attr("fill", labelColor)
      .text(w.label ?? String(w.wave).padStart(2, "0"));
    if (Number.isFinite(w.start)) {
      label.append("text").attr("x", w.label ? 78 : 44).attr("y", cy).attr("fill", labelColor)
        .text(clockTime(w.start));
    }
    const stat = labels(rightRow);
    stat.append("text").attr("x", 18).attr("y", cy)
      .attr("fill", mineRow ? COLORS.accent : COLORS.muted).text(fmt(w.n));
    stat.append("text").attr("x", 96).attr("y", cy).attr("fill", COLORS.ink)
      .text(hms(w.median));
  });

  const mine = x(rider.net / 60);
  body.plot.append("line").attr("x1", mine).attr("x2", mine)
    .attr("y1", 0).attr("y2", height)
    .attr("stroke", COLORS.red).attr("stroke-width", 1.4).attr("stroke-dasharray", "6 4");
  const myRow = waves.findIndex((w) => w.kind === "pro"
    ? rider.raceGroup === "pro" && rider.gender === w.gender
    : w.kind === "junior"
      ? rider.raceGroup === "junior"
        && (rider.division || `Junior ${rider.gender === "F" ? "women" : "men"}`) === w.division
      : rider.raceGroup === "amateur" && w.wave === rider.wave);
  if (myRow >= 0) {
    body.plot.append("circle").attr("cx", mine).attr("cy", rowY(myRow)).attr("r", 5)
      .attr("fill", COLORS.red).attr("stroke", "#fff").attr("stroke-width", 1.2);
  }
  const nearEnd = mine > plotWidth - 100;
  head.plot.append("text").attr("x", nearEnd ? mine - 6 : mine + 6).attr("y", margin.top - 8)
    .attr("text-anchor", nearEnd ? "end" : "start")
    .attr("fill", COLORS.red).attr("font-size", 11).attr("font-weight", 700).text(`YOU ${hms(rider.net)}`);

  axis.plot.append("g").attr("class", "axis")
    .call(d3.axisBottom(x).tickValues(ticks).tickFormat(hm).tickPadding(8));
  axis.left.append("text").attr("x", margin.left - 8).attr("y", 24)
    .attr("text-anchor", "end").attr("fill", COLORS.muted).attr("font-size", 12).text("Finish time (h:mm)");

  let positioned = false;
  waveResizeObserver = new ResizeObserver(() => {
    if (!viewport.clientHeight) return;
    if (Math.abs(viewport.clientWidth - drawnWidth) > 2) {
      drawWaves(rider);
      return;
    }
    viewport.scrollTop = rowY(myRow) - (viewport.clientHeight - margin.top - margin.bottom) / 2;
    if (positioned) return;
    positioned = true;
    // Start at the fast end, unless the rider finished in the scrolled-off tail.
    const visible = viewport.clientWidth - margin.left - margin.right;
    viewport.scrollLeft = mine > visible - pad ? mine - visible / 2 : 0;
  });
  waveResizeObserver.observe(viewport);
}
