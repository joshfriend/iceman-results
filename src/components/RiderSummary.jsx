import { useEffect, useState } from "react";
import { clockTime, comparisonRank, divisionLabel, duration, hms, ordinal, podium } from "../stats/index.js";
import { AWARDS, capitalize, Facts, fmt, Trophy } from "./common.jsx";

function podiumFact(rider, data) {
  const result = podium(rider, data.finishers, data.race.podiumDepth);
  if (!result) return { label: "Division podium", value: "–", note: "no division listed" };
  const where = `of ${fmt(result.size)} in ${divisionLabel(rider)}`;
  if (result.onPodium) {
    const award = AWARDS[result.place];
    return {
      label: award.name === "Podium" ? "Division podium" : `${award.name} podium`,
      value: <><Trophy color={award.color} label={`${award.name} trophy`} />{ordinal(result.place)}</>,
      note: where, accent: award.color, primary: true,
    };
  }
  return {
    label: "Behind podium", value: result.gap === null ? "–" : `+${duration(result.gap)}`,
    note: `${ordinal(result.place)} ${where} · ${result.lastPodium
      ? `${ordinal(result.lastPodium.divisionRank)} was ${hms(result.lastPodium.net)}`
      : "podium time unavailable"}`, primary: true,
  };
}

export function RiderSummary({ rider, data, hasRiderWave }) {
  const [copyMessage, setCopyMessage] = useState("Copy link");
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (copyMessage !== "Link copied") return;
    const timer = setTimeout(() => setCopyMessage("Copy link"), 1600);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopyError("");
      setCopyMessage("Link copied");
    } catch (error) {
      console.error("Could not copy link", error);
      setCopyError("Could not copy the link. Copy it from your browser's address bar.");
    }
  }

  const finishNote = Number.isFinite(rider.speed) && rider.speed > 0
    ? `${rider.speed.toFixed(1)} mph avg · official finish time` : "official finish time";
  const facts = !rider.finished ? [{ label: "Result", value: rider.status }]
    : hasRiderWave ? [
      { label: "Finish time", value: hms(rider.net), note: finishNote, primary: true },
      podiumFact(rider, data),
      { label: "Start", value: clockTime(rider.start), note: `wave ${rider.wave}` },
      { label: "Finished at", value: hms(rider.clock), note: "time of day" },
    ] : [
      { label: "Finish time", value: hms(rider.net), note: finishNote, primary: true },
      { label: `${capitalize(rider.raceGroup)} place`, value: ordinal(comparisonRank(rider, data.finishers)),
        note: `published overall: ${ordinal(rider.status)}` },
      podiumFact(rider, data),
    ];

  return <section className="rider"><div className="name-row">
    <h2 id="rider-name">{rider.name}</h2><span id="rider-chips" className="chips">
      {[["Bib", rider.bib ?? "Not listed"], ["Division", divisionLabel(rider) || "None listed"],
        ["Field", capitalize(rider.raceGroup)]].map(([label, value]) =>
        <span className="chip" key={label}><span className="chip-label">{label}</span>{value}</span>)}
    </span><button id="copy-link" type="button" className="copy-link" onClick={copyLink}>{copyMessage}</button>
  </div><p id="rider-city" className="muted">{rider.city}</p>
    <Facts id="rider-facts" facts={facts} />
    <p id="rider-status" className="message">{rider.finished ? "" : `Listed as ${rider.status}, so there's no finish time to chart.`}</p>
    {copyError && <p className="message error" role="status">{copyError}</p>}
  </section>;
}
