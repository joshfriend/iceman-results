import * as d3 from "d3";
import { ageGenderFinishTimes, hms } from "../stats/index.js";
import { COLORS, fmt, addChartTooltip } from "./shared.js";
import { chartScope } from "./scope.js";

export function createRecapCharts(root, { index, eventYears, data, raceKey, raceUrl }) {
  const { $, observe, on, destroy } = chartScope(root, { ownsTooltip: true });
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
  observe(container, draw);
  draw();
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
    on(input, "change", () => {
      metric = input.value;
      lastWidth = 0;
      draw();
    });
  }
  observe(container, draw);
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
  observe(container, draw);
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
    const speed = root.querySelector('input[name="course-pace-metric"]:checked')?.value === "speed";
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
  for (const input of root.querySelectorAll('input[name="course-pace-metric"]')) {
    on(input, "change", draw);
  }
  observe(container, draw);
  draw();
}


  return { drawEntriesHistory, drawCoursePaceHistory, drawCourseDistanceHistory, drawAgeGenderFinishTimes, destroy };
}
