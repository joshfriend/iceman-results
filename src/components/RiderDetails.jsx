import { useEffect, useMemo, useRef } from "react";
import { estimateNextWave, hms, passCounts, waveDistributions, winnerGaps } from "../stats/index.js";
import { createRiderCharts } from "../charts/riderCharts.js";
import { Facts, fmt } from "./common.jsx";
import { WaveEstimate } from "./WaveEstimate.jsx";

function WinnerGaps({ rider, data }) {
  const facts = winnerGaps(rider, data.finishers).map((gap) => ({
    label: gap.title, value: gap.percent === null ? "Unavailable" : `${gap.percent >= 0 ? "+" : ""}${gap.percent.toFixed(1)}%`,
    note: gap.winner ? `${gap.winner.name} · ${hms(gap.winner.net)}` : "No published finisher in this category",
  }));
  return <section aria-labelledby="winner-gaps-title"><h3 id="winner-gaps-title">Time behind the winners</h3>
    <Facts id="winner-gaps" facts={facts} />
  </section>;
}

function Passing({ counts }) {
  return <section id="passes" className="passes" aria-label="Passing">
    <div className="tile passed"><span className="tile-label">You passed</span><span id="passed" className="tile-value">{fmt(counts.passed)}</span>
      <span className="tile-note">started with or before you, finished after you</span></div>
    <div className="tile passed-by"><span className="tile-label">Passed you</span><span id="passed-by" className="tile-value">{fmt(counts.passedBy)}</span>
      <span className="tile-note">started with or after you, finished before you</span></div>
    <div className="tile net"><span className="tile-label">Net</span><span id="net" className="tile-value">{counts.net > 0 ? "+" : ""}{fmt(counts.net)}</span>
      <span className="tile-note">positions gained during the race</span></div>
    <div id="pass-distribution" className="tile" aria-labelledby="pass-distribution-title">
      <span id="pass-distribution-title" className="tile-label">Pass distribution</span><div id="pass-chart" className="card"></div>
      <span id="pass-distribution-summary" className="tile-note"></span></div>
  </section>;
}

function FinishTimes() {
  return <section><h3>Finish times</h3><ul className="legend">
    <li><span className="swatch faster"></span>Faster than you</li><li><span className="swatch slower"></span>Slower than you</li>
    <li><span className="line you"></span>Your finish</li><li><span className="line median"></span>Group median</li>
  </ul><div id="curves" className="curves"></div></section>;
}

function WaveResults() {
  return <section id="wave-results"><h3>Finish times by start group</h3><ul className="legend">
    <li><span className="swatch box"></span>Box: middle 50%</li><li><span className="line median-solid"></span>Median</li>
    <li><span className="line range"></span>Whiskers: within 1.5×IQR</li><li><span className="dot"></span>Finishers</li>
    <li><span className="dot outlier"></span>Outliers</li><li><span className="line you dashed"></span>Your finish</li>
  </ul><div className="scroll-x"><div id="waves">
    <div id="wave-rows" tabIndex="0" role="region" aria-label="Start group chart rows" aria-describedby="wave-scroll-note">
      <div id="wave-header"></div><div id="wave-rows-content"></div><div id="wave-axis"></div>
    </div></div></div>
    <p id="wave-scroll-note" className="footnote">Scroll the rows to compare start groups; your group starts centered when space allows. Scroll right to see the slowest finishes beyond 2×IQR.</p>
  </section>;
}

export function RiderDetails({ rider, data, raceHistory, hasRiderWave }) {
  const root = useRef(null);
  const waves = useMemo(() => waveDistributions(rider, data.finishers, data.race), [rider, data]);
  const counts = useMemo(() => hasRiderWave ? passCounts(rider, data.finishers) : null, [rider, data, hasRiderWave]);
  const estimate = hasRiderWave
    ? estimateNextWave(rider, raceHistory, waves.filter((wave) => wave.kind !== "pro"), data.race) : null;

  useEffect(() => {
    const charts = createRiderCharts(root.current, data);
    charts.setWaves(waves);
    charts.drawCurves(rider);
    if (counts) charts.drawPassDistribution(rider, counts.passed);
    if (waves.length) charts.drawWaves(rider);
    return charts.destroy;
  }, [rider, data, waves, counts]);

  return <div id="details" ref={root}>
    <WinnerGaps rider={rider} data={data} />
    {counts && <Passing counts={counts} />}
    <FinishTimes />
    <WaveEstimate estimate={estimate} data={data} />
    {waves.length > 0 && <WaveResults />}
  </div>;
}
