import * as d3 from "d3";
import { hms } from "../stats/index.js";
import { COLORS } from "./shared.js";

export function createHistoryCharts(root, data, raceUrl) {
  const $ = (id) => root.querySelector(`#${id}`);
  const historyLink = (result) => raceUrl(result.year, { bib: result.rider.bib ?? result.rider.name });
function renderHistoryCharts(finishes, historyMetric) {
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


  return { renderHistoryCharts };
}
