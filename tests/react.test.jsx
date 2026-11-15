// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { select } from "d3";
import App from "../src/App.jsx";
import { Recap } from "../src/components/Recap.jsx";
import { chartScope } from "../src/charts/scope.js";
import { COLORS, distributionScale, drawDistributionRow, seededRandom } from "../src/charts/shared.js";
import { distributionStats } from "../src/stats/distributions.js";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  window.history.replaceState(null, "", "/?year=2026");
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = new URL(url, "http://localhost").pathname.replace(/^\//, "");
    try {
      const content = await readFile(path, "utf8");
      return { ok: true, json: async () => JSON.parse(content) };
    } catch (error) {
      if (error.code === "ENOENT") return { ok: false, status: 404 };
      throw error;
    }
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("results explorer", () => {
  it("draws identical distribution marks for rider and recap charts", () => {
    const group = distributionStats([3600, 3660, 3720, 3780, 18000]);
    const { x, plotWidth, ticks } = distributionScale([group], 360);
    expect(plotWidth).toBeGreaterThan(360);
    expect(ticks[1] - ticks[0]).toBe(30);
    const draw = (classPrefix) => {
      const svg = select(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
      drawDistributionRow(svg, group, {
        x, cy: 11, rowHeight: 22, color: COLORS.blue,
        random: seededRandom(2026), label: "Test", classPrefix,
      });
      return svg.node().innerHTML.replaceAll(classPrefix, "distribution");
    };
    expect(draw("wave")).toBe(draw("category"));
  });

  it("shows category whiskers on the main recap without age divisions or waves", async () => {
    render(<App />);
    const section = await screen.findByRole("region", { name: "Finish times by race category" });
    expect(screen.queryByRole("heading", { name: "Finishers by race group" })).toBeNull();
    await waitFor(() => expect(section.querySelectorAll(".category-row").length).toBeGreaterThan(0));
    const labels = Array.from(section.querySelectorAll(".category-body .wave-left text"),
      (node) => node.textContent);
    expect(labels).toEqual(expect.arrayContaining([
      "Men Amateur", "Women Amateur", "Men Pro", "Women Pro",
      "Men Singlespeed", "Women Singlespeed", "Men Fat Tire", "Women Fat Tire", "Tandem",
    ]));
    expect(labels.some((label) => /wave|\d|U40/i.test(label))).toBe(false);
    const tandem = within(section).getByRole("img", { name: /^Tandem:/ });
    expect(tandem.getAttribute("aria-label")).toContain("median");
    expect(tandem.querySelectorAll(".category-whisker")).toHaveLength(3);
    expect(tandem.querySelector(".category-box")).toBeTruthy();
    expect(tandem.querySelector(".category-median")).toBeTruthy();
    expect(section.querySelectorAll(".category-outlier").length).toBeGreaterThan(0);
    expect(section.querySelectorAll(".wave-left")).toHaveLength(3);
    expect(section.querySelectorAll(".wave-right")).toHaveLength(3);
    expect(section.querySelectorAll(".wave-plot")).toHaveLength(3);
    expect(section.querySelector(".category-header .wave-right").textContent).toBe("FINISHERSMEDIAN");
    const finishers = tandem.querySelectorAll(".category-finisher");
    const count = Number(tandem.getAttribute("aria-label").match(/: ([\d,]+) finishers/)[1].replaceAll(",", ""));
    expect(finishers).toHaveLength(count);
    expect(new Set(Array.from(finishers, (dot) => dot.getAttribute("cy"))).size).toBeGreaterThan(1);
    expect(finishers[0].getAttribute("r")).toBe("1.6");
    expect(finishers[0].getAttribute("opacity")).toBe("0.3");
    const amateur = within(section).getByRole("img", { name: /^Men Amateur:/ });
    expect(amateur.querySelector(".category-finisher").getAttribute("opacity")).toBe("0.08");
  });

  it("shows an explicit empty state when category finish times are unavailable", () => {
    render(<Recap index={{}} eventYears={[{ year: 2026, riders: 0, finishers: 0 }]}
      data={{ race: { year: 2026 }, riders: [], finishers: [] }} raceKey="slush-cup"
      raceUrl={(year) => `?year=${year}`} hidden={false} />);
    const section = screen.getByRole("region", { name: "Finish times by race category" });
    expect(within(section).getByRole("status").textContent).toBe("No published finish times are available.");
    expect(section.querySelector("svg")).toBeNull();
  });

  it("defines every chart color for both system themes", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("style.css", "utf8");
    document.head.append(style);
    try {
      const rules = Array.from(style.sheet.cssRules);
      const light = rules.find((rule) => rule.selectorText === ":root");
      const dark = Array.from(rules.find((rule) =>
        rule.conditionText === "(prefers-color-scheme: dark)").cssRules)
        .find((rule) => rule.selectorText === ":root");
      for (const color of Object.values(COLORS)) {
        const name = color.match(/^var\((--[^)]+)\)$/)?.[1];
        expect(name).toBeTruthy();
        expect(light.style.getPropertyValue(name)).toBeTruthy();
        expect(dark.style.getPropertyValue(name)).toBeTruthy();
      }
    } finally {
      style.remove();
    }
  });

  it("only removes the shared tooltip when the recap charts are destroyed", () => {
    const root = document.createElement("div");
    const tooltip = document.createElement("div");
    tooltip.id = "chart-tooltip";
    document.body.append(tooltip);
    chartScope(root).destroy();
    expect(document.getElementById("chart-tooltip")).toBe(tooltip);
    chartScope(root, { ownsTooltip: true }).destroy();
    expect(document.getElementById("chart-tooltip")).toBeNull();
  });

  it("searches, shows a rider report and history, and returns to the recap", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "2026 race recap" })).toBeTruthy();
    const input = screen.getByRole("searchbox", { name: "Bib number, name, or city/state" });
    fireEvent.change(input, { target: { value: "2798" } });
    fireEvent.submit(input.closest("form"));
    expect(await screen.findByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    expect(window.location.search).toBe("?year=2026&bib=2798");
    expect(screen.queryByRole("heading", { name: "2026 race recap" })).toBeNull();
    expect(within(document.querySelector("#rider-facts")).getByText("2:58:02")).toBeTruthy();
    expect(await screen.findByText("5 matched years", {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Finish / avg speed" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Speed" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Speed" }));
    expect(screen.getByRole("heading", { name: "Average speed" })).toBeTruthy();
    expect(await screen.findByText(/Dockery · ~8.3 mi/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("heading", { name: "2026 race recap" })).toBeTruthy();
    expect(window.location.search).toBe("?year=2026");
  }, 15000);

  it("searches riders by city and state", async () => {
    render(<App />);
    const input = await screen.findByRole("searchbox", { name: "Bib number, name, or city/state" });
    fireEvent.change(input, { target: { value: "Lowell MI" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("status").textContent).toMatch(/riders match/);
    const matches = Array.from(document.querySelectorAll("#matches button"));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((button) => button.textContent.includes("Lowell, MI"))).toBe(true);
  }, 15000);

  it("shows a known pro wave's category in rider history", async () => {
    window.history.replaceState(null, "", "/?year=2026&bib=64");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Trey Shepard" })).toBeTruthy();
    const row = await screen.findByRole("row", { name: /2026.*Pro men/ }, { timeout: 10000 });
    expect(within(row).queryByText("Wave 55")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Division / start group" })).toBeTruthy();
    expect(document.querySelector("#earliest-wave-caught")).toBeNull();
    expect(document.querySelector("#latest-wave-passed-by")).toBeTruthy();
  }, 15000);

  it("shows the published division and place separately from the overall field in history", async () => {
    window.history.replaceState(null, "", "/?year=2026&bib=4806");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Brad White" })).toBeTruthy();
    expect(await screen.findByRole("columnheader", { name: "Division / start group" }, { timeout: 10000 })).toBeTruthy();
    const row = await screen.findByRole("row", { name: /2026.*Tandem · 1st/ }, { timeout: 10000 });
    expect(within(row).getByRole("cell", { name: "Tandem · 1st Wave 8" })).toBeTruthy();
    expect(within(row).getByRole("cell", { name: /208.*Amateur/ })).toBeTruthy();
  }, 15000);

  it("shows the unassigned amateur field as a whisker distribution", async () => {
    window.history.replaceState(null, "", "/?year=2016&bib=2200");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Ryan Stephen" })).toBeTruthy();
    const row = document.querySelector("#wave-rows-content .wave-plot .wave-highlight");
    expect(row.querySelector("title").textContent).toContain("Amateur (unknown)");
    expect(row.querySelector("title").textContent).toContain("3,680 finishers");
    const dots = row.querySelectorAll("circle.wave-finisher");
    expect(dots).toHaveLength(3680);
    expect(dots[0].getAttribute("r")).toBe("1.1");
    expect(dots[0].getAttribute("opacity")).toBe("0.08");
    expect(row.querySelector(".wave-box")).toBeTruthy();
    expect(row.querySelectorAll(".wave-whisker")).toHaveLength(3);
    expect(row.querySelector(".wave-median")).toBeTruthy();
    expect(row.querySelector(".wave-box").compareDocumentPosition(dots[0]) & Node.DOCUMENT_POSITION_PRECEDING)
      .toBeTruthy();
    expect(document.querySelectorAll("#wave-rows-content .wave-plot svg > circle")).toHaveLength(1);
    expect(screen.getByText(/without a wave assignment are summarized together/)).toBeTruthy();
  }, 15000);

  it("shows multiple matches and reports missing bibs", async () => {
    render(<App />);
    const input = await screen.findByRole("searchbox", { name: "Bib number, name, or city/state" });
    fireEvent.change(input, { target: { value: "smith" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("status").textContent).toMatch(/riders match/);
    expect(document.querySelectorAll("#matches button")).toHaveLength(30);
    const first = document.querySelector("#matches button");
    const name = first.textContent.split(" · ")[0];
    fireEvent.click(first);
    expect(screen.getByRole("heading", { name })).toBeTruthy();
    fireEvent.change(input, { target: { value: "99999999" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("status").textContent).toMatch(/No rider with bib 99999999/);
    expect(screen.getByRole("heading", { name: "2026 race recap" })).toBeTruthy();
  }, 15000);

  it("loads shared URLs and restores the recap on browser history changes", async () => {
    window.history.replaceState(null, "", "/?year=2026&bib=2798");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    window.history.pushState(null, "", "?year=2026");
    fireEvent.popState(window);
    expect(await screen.findByRole("heading", { name: "2026 race recap" })).toBeTruthy();
    expect(screen.getByRole("searchbox").value).toBe("");
  }, 15000);

  it("preserves the recap chart metric across searches", async () => {
    render(<App />);
    const input = await screen.findByRole("searchbox");
    const time = screen.getByRole("radio", { name: "Time" });
    fireEvent.click(time);
    fireEvent.change(input, { target: { value: "2798" } });
    fireEvent.submit(input.closest("form"));
    expect(await screen.findByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("radio", { name: "Time" }).checked).toBe(true);
  }, 15000);

  it("shows a non-finisher without finish charts", async () => {
    window.history.replaceState(null, "", "/?year=2026&bib=1185");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Scott Dykema" })).toBeTruthy();
    expect(screen.getByText("Listed as DSQ, so there's no finish time to chart.")).toBeTruthy();
    expect(document.querySelector("#details")).toBeNull();
    expect(await screen.findByText(/matched year/, {}, { timeout: 10000 })).toBeTruthy();
  }, 15000);

  it("replaces rider charts and summary when switching between finishers and non-finishers", async () => {
    window.history.replaceState(null, "", "/?year=2026&bib=2798");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    expect(document.querySelectorAll("#curves svg").length).toBeGreaterThan(0);
    expect(document.querySelector('#curves [stroke="var(--ink)"]')).toBeTruthy();
    const highlightedRows = document.querySelectorAll("#wave-rows-content .wave-highlight");
    expect(highlightedRows).toHaveLength(3);
    for (const row of highlightedRows) {
      expect(row.querySelector(".wave-row-background").getAttribute("fill")).toBe("var(--wave-highlight)");
      expect(row.querySelectorAll(".wave-highlight-edge")).toHaveLength(2);
    }
    expect(document.querySelector("#pass-chart svg")).toBeTruthy();
    expect(document.querySelector("#earliest-wave-caught").textContent).toBe("Earliest wave caught: Wave 23");
    expect(document.querySelector("#latest-wave-passed-by").textContent).toBe("Latest wave to pass you: Wave 40");
    expect(screen.getByText("Wave eligibility / pace estimate")).toBeTruthy();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "4763" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("heading", { name: "Joel Lafrance" })).toBeTruthy();
    expect(document.querySelectorAll("#curves svg").length).toBeGreaterThan(0);
    expect(document.querySelector("#pass-chart svg")).toBeTruthy();
    expect(document.querySelector("#earliest-wave-caught").textContent).toBe("Earliest wave caught: Wave 1");
    expect(document.querySelector("#latest-wave-passed-by").textContent).toBe("Latest wave to pass you: None found");
    fireEvent.change(input, { target: { value: "1185" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("heading", { name: "Scott Dykema" })).toBeTruthy();
    expect(document.querySelector("#details")).toBeNull();
    fireEvent.change(input, { target: { value: "2798" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    expect(document.querySelectorAll("#curves svg").length).toBeGreaterThan(0);
    expect(document.querySelector("#pass-chart svg")).toBeTruthy();
  }, 15000);

  it("copies a rider link and reports clipboard failures", async () => {
    const writeText = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error("clipboard unavailable"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.replaceState(null, "", "/?year=2026&bib=2798");
    render(<App />);
    const button = await screen.findByRole("button", { name: "Copy link" });
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Link copied" });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    fireEvent.click(button);
    expect(await screen.findByText("Could not copy the link. Copy it from your browser's address bar.")).toBeTruthy();
  }, 15000);

  it("reports a checkpoint loading error without hiding the rider report", async () => {
    const fetchData = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => String(url).includes("2026/splits.json")
      ? Promise.resolve({ ok: false, status: 503 }) : fetchData(url));
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.replaceState(null, "", "/?year=2026&bib=2798");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    expect(await screen.findByText("Could not load checkpoint splits.")).toBeTruthy();
    expect(document.querySelectorAll("#curves svg").length).toBeGreaterThan(0);
  }, 15000);

  it("reports loading errors and retries", async () => {
    const fetchData = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockImplementation(fetchData);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not load race results. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "2026 race recap" })).toBeTruthy(), { timeout: 10000 });
  }, 15000);

  it("shows historical results without bibs and filters Slush Cup", async () => {
    window.history.replaceState(null, "", "/?year=2007");
    const first = render(<App />);
    const input = await screen.findByRole("searchbox");
    fireEvent.change(input, { target: { value: "2798" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("status").textContent).toContain("Bib numbers are not listed");
    first.unmount();
    window.history.replaceState(null, "", "/?race=slush-cup&year=2026");
    render(<App />);
    const select = await screen.findByRole("combobox", { name: "Race" });
    expect(within(select).getByRole("option", { name: "Slush Cup" }).selected).toBe(true);
    expect(document.querySelector("#course-pace-history").hidden).toBe(true);
  }, 15000);
});
