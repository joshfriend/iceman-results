import { useEffect, useState } from "react";
import { hms, riderSplits } from "../stats/index.js";

export function RiderSplits({ rider, entry, loader }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError(false);
    loader.loadSplits(entry).then((splits) => {
      if (active) setResult(riderSplits(rider, splits));
    }).catch((err) => {
      if (!active) return;
      console.error("Could not load checkpoint splits", err);
      setError(true);
    });
    return () => { active = false; };
  }, [rider, entry, loader]);
  if (error) return <p className="message error" role="status">Could not load checkpoint splits.</p>;
  if (!result) return null;
  return <section id="rider-splits" aria-labelledby="splits-title">
    <h3 id="splits-title">Checkpoint splits</h3><div className="scroll-x">
      <table className="history-table"><thead><tr><th scope="col">Checkpoint</th><th scope="col">Elapsed</th>
        <th scope="col">Leg time</th><th scope="col">Leg speed</th></tr></thead>
      <tbody id="splits-rows">{result.rows.map((row, i) => <tr key={i}>
        <th scope="row">{[row.location ?? row.name, Number.isFinite(row.miles)
          ? `${result.estimated ? "~" : ""}${row.miles.toFixed(1)} mi` : ""].filter(Boolean).join(" · ")}</th>
        <td>{row.elapsed === null ? "—" : hms(row.elapsed)}</td>
        <td>{row.leg === null ? "—" : hms(row.leg)}</td>
        <td>{row.speed === null ? "—" : `${row.speed.toFixed(1)} mph`}</td>
      </tr>)}</tbody></table>
    </div>
  </section>;
}
