import * as d3 from "d3";
import { hms } from "../stats/format.js";

export const COLORS = {
  blue: "var(--blue)", accent: "var(--accent)", slower: "var(--slower)", red: "var(--red)",
  ink: "var(--ink)", muted: "var(--muted)", band: "var(--band)", range: "var(--range)",
  surface: "var(--surface)", histogram: "var(--histogram)", waveHighlight: "var(--wave-highlight)",
};

export const fmt = d3.format(",");

export function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distributionScale(groups, visibleWidth) {
  const pad = 16;
  const fullMin = Math.floor(d3.min(groups, (group) => group.min) / 60 / 30) * 30;
  const fullMax = Math.ceil(d3.max(groups, (group) => group.max) / 60 / 30) * 30;
  // Keep the central distributions readable; the slower outlier tail is reached by scrolling.
  const coreMax = Math.min(fullMax, Math.ceil(d3.max(groups, (group) =>
    Math.min(group.max, group.q3 + 2 * (group.q3 - group.q1))) / 60 / 30) * 30);
  const pxPerMinute = (visibleWidth - 2 * pad) / Math.max(30, coreMax - fullMin);
  const plotWidth = Math.round((fullMax - fullMin) * pxPerMinute + 2 * pad);
  return {
    pad,
    plotWidth,
    x: d3.scaleLinear([fullMin, fullMax], [pad, plotWidth - pad]),
    ticks: d3.range(fullMin, fullMax + 1, 30),
  };
}

export function distributionColumns(container, height, { left, plotWidth, right }) {
  const track = d3.select(container).html("").append("div")
    .attr("class", "wave-track").style("width", `${left + plotWidth + right}px`);
  const column = (name, width) => track.append("div").attr("class", `wave-col wave-${name}`)
    .style("width", `${width}px`).append("svg")
    .attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  return {
    left: column("left", left).attr("aria-hidden", "true"),
    plot: column("plot", plotWidth),
    right: column("right", right).attr("aria-hidden", "true"),
  };
}

export function drawDistributionRow(row, group, {
  x, cy, rowHeight, color, random, label, aggregate = false, classPrefix = "wave",
}) {
  const isOutlier = (time) => time < group.lowerFence || time > group.upperFence;
  row.append("g").selectAll("circle").data(group.times).join("circle")
    .attr("class", (time) => `${classPrefix}-finisher${isOutlier(time) ? ` ${classPrefix}-outlier` : ""}`)
    .attr("cx", (time) => x(time / 60))
    .attr("cy", () => cy + (random() - 0.5) * rowHeight * 0.56)
    .attr("r", aggregate ? 1.1 : 1.6)
    .attr("fill", (time) => isOutlier(time) ? "none" : color)
    .attr("stroke", (time) => isOutlier(time) ? color : "none")
    .attr("stroke-width", 0.7).attr("opacity", aggregate ? 0.08 : 0.3)
    .append("title").text((time) => `${label} · ${hms(time)}${isOutlier(time)
      ? " · Outlier: outside this group's 1.5×IQR fences" : ""}`);
  const lo = x(group.whiskerMin / 60);
  const hi = x(group.whiskerMax / 60);
  row.append("line").attr("class", `${classPrefix}-whisker`)
    .attr("x1", lo).attr("x2", hi).attr("y1", cy).attr("y2", cy)
    .attr("stroke", COLORS.range).attr("stroke-width", aggregate ? 1.5 : 0.9);
  for (const end of [lo, hi]) row.append("line")
    .attr("class", `${classPrefix}-whisker`)
    .attr("x1", end).attr("x2", end).attr("y1", cy - 2.5).attr("y2", cy + 2.5)
    .attr("stroke", COLORS.range).attr("stroke-width", aggregate ? 1.5 : 0.9);
  row.append("rect").attr("class", `${classPrefix}-box`)
    .attr("x", x(group.q1 / 60)).attr("width", x(group.q3 / 60) - x(group.q1 / 60))
    .attr("y", cy - rowHeight * 0.24).attr("height", rowHeight * 0.48)
    .attr("fill", color).attr("fill-opacity", aggregate ? 0.32 : 0.25)
    .attr("stroke", color).attr("stroke-opacity", aggregate ? 0.9 : 0.5)
    .attr("stroke-width", aggregate ? 1.2 : 1);
  row.append("line").attr("class", `${classPrefix}-median`)
    .attr("x1", x(group.median / 60)).attr("x2", x(group.median / 60))
    .attr("y1", cy - rowHeight * 0.26).attr("y2", cy + rowHeight * 0.26)
    .attr("stroke", COLORS.ink).attr("stroke-width", 2.2);
}

export function addChartTooltip(container, svg, groups, plot) {
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
