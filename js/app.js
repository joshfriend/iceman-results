import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

import {
  clockTime, findRiders, groupsFor, hm, hms, kde, parseRace, passCounts, waveStats,
} from "./stats.js";

const COLORS = {
  blue: "#497cae", teal: "#328c79", red: "#ca453d", ink: "#203346",
  muted: "#657584", grid: "#e8edf0", band: "#f6f8fa", range: "#acbac5",
};
const fmt = d3.format(",");
const $ = (id) => document.getElementById(id);

const data = parseRace(await (await fetch("data/iceman-2026.json")).json());
const waves = waveStats(data.finishers, data.race);
const overallMinutes = data.finishers.map((r) => r.net / 60).sort((a, b) => a - b);
$("source").href = data.race.resultsUrl;

$("lookup").addEventListener("submit", (event) => {
  event.preventDefault();
  lookup($("query").value);
});
window.addEventListener("popstate", () => loadFromUrl());
loadFromUrl();

function loadFromUrl() {
  const bib = new URLSearchParams(location.search).get("bib") ?? location.hash.replace(/^#/, "");
  if (bib) {
    $("query").value = bib;
    lookup(bib, false);
  }
}

function setMessage(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}

function lookup(query, push = true) {
  const matches = findRiders(data.riders, query);
  $("matches").hidden = true;
  $("matches").replaceChildren();
  if (matches.length === 0) {
    $("report").hidden = true;
    setMessage(/^\s*\d+\s*$/.test(query)
      ? `No rider with bib ${query.trim()} in the results.`
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
      button.textContent = `${rider.name} · #${rider.bib} · ${rider.division}`;
      button.addEventListener("click", () => {
        $("query").value = String(rider.bib);
        lookup(String(rider.bib));
      });
      $("matches").append(button);
    }
    $("matches").hidden = false;
    return;
  }
  const rider = matches[0];
  if (push) history.pushState(null, "", `?bib=${rider.bib}`);
  show(rider);
}

function show(rider) {
  setMessage("");
  $("rider-name").textContent = rider.name;
  $("report").hidden = false;
  $("details").hidden = !rider.finished;
  if (!rider.finished) {
    $("rider-meta").textContent = `Bib ${rider.bib} · ${rider.city} · ${rider.division} — listed as ${rider.status}, so there's no finish time to chart.`;
    document.title = `${rider.name} — Iceman Cometh 2026`;
    return;
  }
  $("rider-meta").textContent = [
    `Bib ${rider.bib}`, rider.city, rider.division,
    `Wave ${rider.wave} · ${clockTime(rider.start)} start`,
    `${hms(rider.net)} · crossed at ${hms(rider.clock)}`,
  ].join("  ·  ");

  const counts = passCounts(rider, data.finishers);
  $("passed").textContent = fmt(counts.passed);
  $("passed-by").textContent = fmt(counts.passedBy);
  $("net").textContent = `${counts.net > 0 ? "+" : ""}${fmt(counts.net)}`;

  drawCurves(rider);
  drawWaves(rider);
  document.title = `${rider.name} — Iceman Cometh 2026`;
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
    plot.append("path").attr("d", area(slower)).attr("fill", COLORS.teal).attr("opacity", 0.37);
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
  const rowH = 22;
  const width = 1000;
  const margin = { top: 34, right: 170, bottom: 48, left: 112 };
  const height = margin.top + rowH * waves.length + margin.bottom;
  const bounds = waves.flatMap((w) => [w.min, w.max, w.median - w.sd, w.median + w.sd]).map((s) => s / 60);
  const x = d3.scaleLinear(
    [Math.floor(d3.min(bounds) / 30) * 30, Math.ceil(d3.max(bounds) / 30) * 30],
    [margin.left, width - margin.right],
  );
  const rowY = (i) => margin.top + rowH * i + rowH / 2;
  const random = mulberry32(20261107);

  const svg = d3.select($("waves")).html("").append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Finish time distribution for every start wave");

  svg.append("g").selectAll("line").data(d3.range(x.domain()[0], x.domain()[1] + 1, 30)).join("line")
    .attr("class", "gridline")
    .attr("x1", (t) => x(t)).attr("x2", (t) => x(t))
    .attr("y1", margin.top - 4).attr("y2", height - margin.bottom);

  const header = svg.append("g").attr("fill", COLORS.muted).attr("font-size", 11);
  header.append("text").attr("x", 8).attr("y", 18).text("WAVE / START");
  header.append("text").attr("x", width - margin.right + 18).attr("y", 18).text("FINISHERS");
  header.append("text").attr("x", width - margin.right + 96).attr("y", 18).text("MEDIAN");

  waves.forEach((w, i) => {
    const mineRow = w.wave === rider.wave;
    const color = mineRow ? COLORS.teal : COLORS.blue;
    const cy = rowY(i);
    const row = svg.append("g");
    row.append("title").text(
      `Wave ${w.wave} · ${clockTime(w.start)} start · ${fmt(w.n)} finishers · median ${hms(w.median)}`,
    );
    if (mineRow || i % 2 === 0) {
      row.append("rect").attr("x", 0).attr("width", width).attr("y", cy - rowH / 2 + 0.5).attr("height", rowH - 1)
        .attr("fill", mineRow ? COLORS.teal : COLORS.band).attr("opacity", mineRow ? 0.1 : 1);
    }
    const lo = x(w.min / 60);
    const hi = x(w.max / 60);
    row.append("line").attr("x1", lo).attr("x2", hi).attr("y1", cy).attr("y2", cy)
      .attr("stroke", COLORS.range).attr("stroke-width", 0.9);
    for (const end of [lo, hi]) {
      row.append("line").attr("x1", end).attr("x2", end).attr("y1", cy - 2.5).attr("y2", cy + 2.5)
        .attr("stroke", COLORS.range).attr("stroke-width", 0.9);
    }
    row.append("g").selectAll("circle").data(w.times).join("circle")
      .attr("cx", (t) => x(t / 60)).attr("cy", () => cy + (random() - 0.5) * rowH * 0.56)
      .attr("r", 1.6).attr("fill", color).attr("opacity", 0.3);
    row.append("rect")
      .attr("x", x((w.median - w.sd) / 60)).attr("width", x((w.median + w.sd) / 60) - x((w.median - w.sd) / 60))
      .attr("y", cy - rowH * 0.24).attr("height", rowH * 0.48)
      .attr("fill", color).attr("fill-opacity", 0.25).attr("stroke", color).attr("stroke-opacity", 0.5);
    row.append("line").attr("x1", x(w.median / 60)).attr("x2", x(w.median / 60))
      .attr("y1", cy - rowH * 0.26).attr("y2", cy + rowH * 0.26)
      .attr("stroke", COLORS.ink).attr("stroke-width", 2.2);

    const labelColor = mineRow ? COLORS.teal : COLORS.ink;
    const weight = mineRow ? 700 : 400;
    const label = row.append("g").attr("font-size", 12).attr("dominant-baseline", "middle")
      .attr("font-weight", weight);
    label.append("text").attr("x", 8).attr("y", cy).attr("fill", labelColor)
      .text(String(w.wave).padStart(2, "0"));
    label.append("text").attr("x", 44).attr("y", cy).attr("fill", labelColor).text(clockTime(w.start));
    label.append("text").attr("x", width - margin.right + 18).attr("y", cy)
      .attr("fill", mineRow ? COLORS.teal : COLORS.muted).text(fmt(w.n));
    label.append("text").attr("x", width - margin.right + 96).attr("y", cy).attr("fill", COLORS.ink)
      .text(hms(w.median));
  });

  const mine = x(rider.net / 60);
  svg.append("line").attr("x1", mine).attr("x2", mine)
    .attr("y1", margin.top - 4).attr("y2", height - margin.bottom)
    .attr("stroke", COLORS.red).attr("stroke-width", 1.4).attr("stroke-dasharray", "6 4");
  const myRow = waves.findIndex((w) => w.wave === rider.wave);
  svg.append("circle").attr("cx", mine).attr("cy", rowY(myRow)).attr("r", 5)
    .attr("fill", COLORS.red).attr("stroke", "#fff").attr("stroke-width", 1.2);
  svg.append("text").attr("x", mine + 6).attr("y", margin.top - 8)
    .attr("fill", COLORS.red).attr("font-size", 11).attr("font-weight", 700).text(`YOU ${hms(rider.net)}`);

  svg.append("g").attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(d3.range(x.domain()[0], x.domain()[1] + 1, 30)).tickFormat(hm).tickPadding(8));
  svg.append("text").attr("x", (margin.left + width - margin.right) / 2).attr("y", height - 8)
    .attr("text-anchor", "middle").attr("fill", COLORS.muted).attr("font-size", 12).text("Finish time (h:mm)");
}
