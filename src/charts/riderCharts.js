import * as d3 from "d3";
import { clockTime, groupsFor, hm, hms, kde, passDistribution } from "../stats/index.js";
import { COLORS, fmt } from "./shared.js";
import { chartScope } from "./scope.js";

export function createRiderCharts(root, data) {
  const { $, observe, destroy } = chartScope(root);
  const passDistributions = new Map();
  let waves = [];
  let waveResizeObserver;
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
  waveResizeObserver = observe(viewport, () => {
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
}

  return { drawPassDistribution, drawCurves, drawWaves, setWaves: (value) => { waves = value; }, destroy };
}
