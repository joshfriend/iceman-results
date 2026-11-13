import * as d3 from "d3";

export const COLORS = {
  blue: "#8295a8", accent: "#1476c8", slower: "#328c79", red: "#ca453d", ink: "#203346",
  muted: "#657584", grid: "#e8edf0", band: "#f6f8fa", range: "#acbac5",
};

export const fmt = d3.format(",");

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
