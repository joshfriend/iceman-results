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
    charts.drawCategoryFinishTimes();
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
    <section id="category-finish-times" aria-labelledby="category-finish-times-title">
      <h3 id="category-finish-times-title">Finish times by race category</h3>
      <ul className="legend"><li><span className="swatch box"></span>Box: middle 50%</li>
        <li><span className="line median-solid"></span>Median</li>
        <li><span className="line range"></span>Whiskers: within 1.5×IQR</li>
        <li><span className="dot"></span>Finishers</li>
        <li><span className="dot outlier"></span>Outliers</li></ul>
      <p id="category-finish-times-note" className="footnote">Age divisions are combined; waves are not used.
        Amateur and pro overall groups include their specialty-class riders. Tandem combines all genders.
        Unclassified means amateur or pro status was not published. Scroll right to see the slowest finishes beyond 2×IQR.</p>
      <p id="category-finish-times-empty" className="footnote" role="status" hidden></p>
      <div className="scroll-x"><div className="category-chart">
        <div id="category-finish-times-chart" tabIndex="0" role="region"
          aria-label="Race category chart rows" aria-describedby="category-finish-times-note"></div>
      </div></div>
    </section>
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
