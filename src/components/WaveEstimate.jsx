import { hms } from "../stats/index.js";

export function WaveEstimate({ estimate, data }) {
  if (!estimate) return null;
  const movement = estimate.wavesAhead > 0
    ? `${estimate.wavesAhead} wave${estimate.wavesAhead === 1 ? "" : "s"} earlier than your current wave`
    : estimate.wavesAhead < 0
      ? `${Math.abs(estimate.wavesAhead)} wave${estimate.wavesAhead === -1 ? "" : "s"} later than your current wave`
      : "about the same as your current wave";
  const resultLabel = estimate.resultCount === 1 ? "your only available result" : `your ${estimate.resultCount} best available results`;
  const benchmark = estimate.requirement
    ? `Wave ${estimate.wave} requirement: ${estimate.requirementType === "or slower"
      ? `${hms(estimate.requirement)} or slower` : `faster than ${hms(estimate.requirement)}`}${estimate.waveMedian === null
      ? "; no finishers with a published start in this wave." : `; its ${data.race.year} median was ${hms(estimate.waveMedian)}.`}`
    : `The closest ${data.race.year} wave median was ${hms(estimate.waveMedian)}.`;
  return <section id="wave-estimate" className="wave-estimate" aria-labelledby="wave-estimate-title">
    <h3 id="wave-estimate-title">Wave eligibility / pace estimate</h3>
    <div className="wave-estimate-card"><strong id="next-wave" className="wave-estimate-value">Wave {estimate.wave}</strong>
      <span id="wave-movement">{movement}</span>
      <p id="wave-estimate-note" className="muted">{`Based on ${resultLabel} (${estimate.years.join(", ")}): ${hms(estimate.average)}. ${benchmark} `}
        {estimate.requirement ? "This is time eligibility, not a predicted assignment; capacity and requested moves can change your wave."
          : "This compares pace with wave medians, not official qualifying cutoffs or a predicted assignment."}</p></div>
    <p className="footnote">Best three available amateur finishes in the five calendar years ending with the selected race. Cutoffs, when available, are the selected year's published standards, not confirmed next-year standards. Junior and pro starts are excluded. <a href="https://www.iceman.com/p/faq/wave-placements--start-times">Official wave guidance</a>.</p>
  </section>;
}
