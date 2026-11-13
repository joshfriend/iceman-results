import { useEffect, useRef, useState } from "react";
import { divisionLabel, duration, hms, ordinal, podium, riderHistory } from "../stats/index.js";
import { createHistoryCharts } from "../charts/historyCharts.js";
import { AWARDS, capitalize, fmt, Trophy } from "./common.jsx";

export function History({ rider, data, eventYears, loader, raceUrl, searchVersion }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(false);
  const [metric, setMetric] = useState("time");
  const charts = useRef(null);

  useEffect(() => {
    let active = true;
    setHistory(null);
    setError(false);
    Promise.all(eventYears.map(loader.loadRace)).then((years) => {
      if (active) setHistory({ years, ...riderHistory(rider, years) });
    }).catch((err) => {
      if (!active) return;
      console.error("Could not load rider history", err);
      setError(true);
    });
    return () => { active = false; };
  }, [rider, eventYears, loader, searchVersion]);

  const results = history?.results ?? [];
  const finishes = results.filter((result) => result.net !== null);
  const hasSpeed = finishes.filter((result) =>
    Number.isFinite(result.rider.speed) && result.rider.speed > 0).length >= 2;
  const effectiveMetric = metric === "speed" && !hasSpeed ? "time" : metric;
  useEffect(() => {
    if (history && !hasSpeed && metric === "speed") setMetric("time");
  }, [history, hasSpeed, metric]);
  useEffect(() => {
    createHistoryCharts(charts.current, data, raceUrl).renderHistoryCharts(finishes, effectiveMetric);
  }, [history, effectiveMetric, data, raceUrl]);

  const message = error ? "Could not load all years. Search for the rider again to retry."
    : !history ? "Loading results across all years..."
      : [
        `${results.length} matched year${results.length === 1 ? "" : "s"}`,
        results.length > 1 && finishes.length < 2 ? "At least two finishes are needed to show a trend." : "",
        history.ambiguousYears.length ? `Duplicate names: ${history.ambiguousYears.join(", ")} omitted.` : "",
      ].filter(Boolean).join(" ");
  const yearsByYear = new Map((history?.years ?? []).map((year) => [year.race.year, year]));

  return <section id="rider-history" aria-labelledby="history-title" ref={charts}>
    <div className="section-head">
      <div><h3 id="history-title">Year-by-year progress</h3>
        <p id="history-message" className={`message${error ? " error" : ""}`} role="status">{message}</p></div>
      <fieldset id="history-metric-toggle" className="chart-toggle" hidden={results.length < 2}
        title="Speed uses each year's published average speed, or is calculated from the course distance and finish time when none is published.">
        <legend>Finish chart metric</legend>
        <label><input type="radio" name="history-metric" value="time"
          checked={effectiveMetric === "time"} onChange={() => setMetric("time")} /><span>Time</span></label>
        <label><input id="history-speed-option" type="radio" name="history-metric" value="speed"
          disabled={!hasSpeed} checked={effectiveMetric === "speed"} onChange={() => setMetric("speed")} /><span>Speed</span></label>
      </fieldset>
    </div>
    <div id="history-charts" className="curves"></div>
    <div className="scroll-x">
      <table id="history-table" className="history-table" hidden={!results.length}>
        <thead><tr><th scope="col">Year</th><th scope="col">Wave</th><th scope="col">Finish / avg speed</th>
          <th scope="col">Time change</th><th scope="col">Field place</th><th scope="col">Ahead of field</th></tr></thead>
        <tbody id="history-rows">{results.map((result) => {
          const yearData = yearsByYear.get(result.year);
          const place = yearData && podium(result.rider, yearData.finishers, yearData.race.podiumDepth);
          const award = place?.onPodium ? AWARDS[place.place] : null;
          const change = result.timeChange;
          return <tr key={result.year} className={[
            result.year === data.race.year ? "selected-year" : "", award ? "podium-year" : "",
          ].filter(Boolean).join(" ")} style={award ? { "--podium-color": award.color } : undefined}>
            <th scope="row"><a href={raceUrl(result.year, { bib: result.rider.bib ?? result.rider.name })}
              aria-current={result.year === data.race.year ? "true" : undefined}>{result.year}</a>
              {award && <> <span className="podium-mark" title={`${ordinal(place.place)} place in ${divisionLabel(result.rider)}`}>
                <Trophy color={award.color} label="" /><span>{ordinal(place.place)}</span></span></>}
            </th>
            <td>{result.rider.wave ? `Wave ${result.rider.wave}` : "—"}</td>
            <td>{result.net === null ? String(result.rider.status) : `${hms(result.net)}${Number.isFinite(result.rider.speed)
              ? ` · ${result.rider.speed.toFixed(1)} mph` : ""}`}</td>
            <td>{change === null ? "—" : change === 0 ? "No change"
              : `${change < 0 ? "−" : "+"}${duration(Math.abs(change))}`}</td>
            <td>{result.net === null ? "—"
              : `${fmt(result.rank)} / ${fmt(result.fieldSize)} (${capitalize(result.rider.raceGroup ?? "amateur")})`}</td>
            <td>{result.aheadPct === null ? "—" : `${result.aheadPct.toFixed(1)}%`}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
