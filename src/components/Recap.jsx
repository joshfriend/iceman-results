import { useEffect, useRef } from "react";
import { hms, raceRecap } from "../stats/index.js";
import { createRecapCharts } from "../charts/recapCharts.js";
import { Facts, fmt } from "./common.jsx";

export function Recap({ index, eventYears, data, raceKey, raceUrl, hidden }) {
  const root = useRef(null);
  const recap = raceRecap(data);
  useEffect(() => {
    const charts = createRecapCharts(root.current, { index, eventYears, data, raceKey, raceUrl });
    charts.drawEntriesHistory();
    charts.drawCoursePaceHistory();
    charts.drawCourseDistanceHistory();
    charts.drawAgeGenderFinishTimes(data);
    return charts.destroy;
  }, [index, eventYears, data, raceKey, raceUrl]);

  const facts = [
    { label: "Entries", value: fmt(recap.entries), note: `${fmt(recap.dns)} marked DNS` },
    { label: "Finishers", value: fmt(recap.finishers), note: `${fmt(recap.dnf)} DNF · ${fmt(recap.dsq)} DSQ` },
    { label: "Starter finish rate", value: recap.finishRate === null ? "—" : `${recap.finishRate.toFixed(1)}%`,
      note: `${fmt(recap.finishers)} of ${fmt(recap.starters)} starters` },
    { label: "Median finish", value: recap.median === null ? "—" : hms(recap.median),
      note: recap.fastest === null ? "no published finish times" : `Fastest ${hms(recap.fastest)}` },
  ];
  return <section id="year-recap" aria-labelledby="recap-title" ref={root} hidden={hidden}>
    <div className="recap-heading">
      <div><h2 id="recap-title">{data.race.year} race recap</h2>
        <p id="recap-subtitle" className="muted">{fmt(recap.entries)} entries · {fmt(recap.finishers)} finishers</p></div>
      <p id="recap-middle-half" className="recap-highlight">{recap.q1 === null
        ? "No finish times are available."
        : `The middle half of finishers finished between ${hms(recap.q1)} and ${hms(recap.q3)}.`}</p>
    </div>
    <Facts id="recap-facts" className="recap-facts" facts={facts} />
    <div className="recap-breakdown">
      <div><h3>Finishers by race group</h3>
        <p className="muted">Count and median finish time for each published group.</p>
        {recap.groups.some((group) => group.key === "unclassified") &&
          <p id="recap-unclassified-note" className="footnote">Some historical results do not identify amateur or pro status; those finishers are kept separate.</p>}
      </div>
      <div className="scroll-x"><table className="recap-table">
        <thead><tr><th scope="col">Race group</th><th scope="col">Finishers</th><th scope="col">Median</th></tr></thead>
        <tbody id="recap-groups">{recap.groups.map((group) => <tr key={group.key}>
          <th scope="row">{group.title}</th><td>{fmt(group.finishers)}</td><td>{hms(group.median)}</td>
        </tr>)}</tbody>
      </table></div>
    </div>
    <section className="entries-history" aria-labelledby="entries-history-title">
      <h3 id="entries-history-title">Entries by year</h3>
      <ul className="legend"><li><span className="swatch entries-finished"></span>Finished</li>
        <li><span className="swatch entries-unfinished"></span>Did not finish (DNF / DNS / DSQ)</li></ul>
      <div className="scroll-x"><div id="entries-history-chart"></div></div>
    </section>
    <section id="course-pace-history" aria-labelledby="course-pace-history-title">
      <h3 id="course-pace-history-title">Winners' average speed by year</h3>
      <div className="chart-controls">
        <ul className="legend"><li><span className="line men-fastest"></span>Men</li>
          <li><span className="line women-fastest"></span>Women</li></ul>
        <fieldset className="chart-toggle"><legend>Winner chart metric</legend>
          <label><input type="radio" name="course-pace-metric" value="time" /><span>Time</span></label>
          <label><input type="radio" name="course-pace-metric" value="speed" defaultChecked /><span>Speed</span></label>
        </fieldset>
      </div>
      <div className="scroll-x"><div id="course-pace-history-chart"></div></div>
    </section>
    <section id="age-gender-finish-times" aria-labelledby="age-gender-finish-times-title">
      <h3 id="age-gender-finish-times-title">Median finish time by age and gender</h3>
      <ul className="legend"><li><span className="line age-men"></span>Men</li>
        <li><span className="line age-women"></span>Women</li></ul>
      <p id="age-gender-finish-times-empty" className="footnote" role="status" hidden></p>
      <div id="age-gender-finish-times-chart"></div>
    </section>
    <section id="course-distance-history" aria-labelledby="course-distance-history-title">
      <h3 id="course-distance-history-title">Course distance by year</h3>
      <div className="scroll-x"><div id="course-distance-history-chart"></div></div>
    </section>
  </section>;
}
