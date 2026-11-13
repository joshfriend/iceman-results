// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../src/App.jsx";
import { chartScope } from "../src/charts/scope.js";

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
    const input = screen.getByRole("searchbox", { name: "Bib number or name" });
    fireEvent.change(input, { target: { value: "2798" } });
    fireEvent.submit(input.closest("form"));
    expect(await screen.findByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    expect(window.location.search).toBe("?year=2026&bib=2798");
    expect(screen.queryByRole("heading", { name: "2026 race recap" })).toBeNull();
    expect(screen.getByText("2:58:02")).toBeTruthy();
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

  it("shows multiple matches and reports missing bibs", async () => {
    render(<App />);
    const input = await screen.findByRole("searchbox", { name: "Bib number or name" });
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
    expect(await screen.findByText(/matched year/)).toBeTruthy();
  }, 15000);

  it("replaces rider charts and summary when switching between finishers and non-finishers", async () => {
    window.history.replaceState(null, "", "/?year=2026&bib=2798");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Matt Huisman" })).toBeTruthy();
    expect(document.querySelectorAll("#curves svg").length).toBeGreaterThan(0);
    expect(document.querySelector("#pass-chart svg")).toBeTruthy();
    expect(screen.getByText("Wave eligibility / pace estimate")).toBeTruthy();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "4763" } });
    fireEvent.submit(input.closest("form"));
    expect(screen.getByRole("heading", { name: "Joel Lafrance" })).toBeTruthy();
    expect(document.querySelectorAll("#curves svg").length).toBeGreaterThan(0);
    expect(document.querySelector("#pass-chart svg")).toBeTruthy();
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
