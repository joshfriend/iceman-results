import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { divisionLabel, findRiders, findYearRiders } from "./stats/index.js";
import { createRaceLoader, loadIndex, raceUrl as makeRaceUrl } from "./data.js";
import { Recap } from "./components/Recap.jsx";
import { RiderReport } from "./components/RiderReport.jsx";
import { fmt } from "./components/common.jsx";

function RacePage({ index, raceKey, eventInfo, entry, data, loader, raceHistory }) {
  const [query, setQuery] = useState("");
  const [rider, setRider] = useState(null);
  const [matches, setMatches] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const eventYears = eventInfo.years;
  const raceTitle = `${data.race.name} ${data.race.year}`;
  const raceUrl = useCallback((year, params = {}) => makeRaceUrl(year, raceKey, params), [raceKey]);

  const lookup = useCallback((value, push = true) => {
    const found = findRiders(data.riders, value);
    setMatches(found.length > 1 ? found.slice(0, 30) : []);
    setError(false);
    setRider(null);
    if (!found.length) {
      const isBib = /^\s*\d+\s*$/.test(value);
      setMessage(isBib
        ? data.riders.some((item) => Number.isInteger(item.bib))
          ? `No rider with bib ${value.trim()} in the results.`
          : "Bib numbers are not listed for this year; search by rider name instead."
        : `No rider named “${value.trim()}” in the results.`);
      setError(true);
    } else if (found.length > 1) {
      setMessage(found.length > 30
        ? `${fmt(found.length)} riders match — showing the first 30, type more of the name to narrow it:`
        : `${fmt(found.length)} riders match — pick one:`);
    } else {
      const selected = found[0];
      setMessage("");
      setRider(selected);
      setSearchVersion((version) => version + 1);
      const url = raceUrl(data.race.year, { bib: selected.bib ?? selected.name });
      if (url !== location.search) window.history[push ? "pushState" : "replaceState"](null, "", url);
    }
  }, [data, raceUrl]);
  const reset = useCallback((updateUrl = true) => {
    if (updateUrl) {
      const url = raceUrl(data.race.year);
      if (url !== location.search) window.history.pushState(null, "", url);
    }
    setRider(null);
    setMatches([]);
    setMessage("");
    setError(false);
  }, [data, raceUrl]);

  useLayoutEffect(() => {
    function loadFromUrl() {
      const value = new URLSearchParams(location.search).get("bib") ?? location.hash.replace(/^#/, "");
      setQuery(value);
      if (value) lookup(value, false);
      else reset(false);
    }
    function onPopState() {
      const params = new URLSearchParams(location.search);
      const requested = Number(params.get("year"));
      const year = eventYears.find((item) => item.year === requested) ?? eventYears[0];
      if (params.get("race") !== (raceKey === "iceman" ? null : raceKey) || year.year !== data.race.year) {
        location.reload();
      } else loadFromUrl();
    }
    loadFromUrl();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [lookup, reset, raceKey, data, eventYears]);

  useEffect(() => {
    document.title = rider ? `${rider.name} — ${raceTitle}` : `${raceTitle} results`;
  }, [rider, raceTitle]);

  async function changeYear(event) {
    const next = eventYears.find((year) => year.year === Number(event.target.value));
    const params = new URLSearchParams(raceUrl(next.year).slice(1));
    const value = query.trim();
    setSwitching(true);
    setMessage(`Loading ${next.year} results...`);
    setError(false);
    try {
      if (value) {
        const nextData = await loader.loadRawRace(next);
        const found = findYearRiders(data.riders, value, nextData.riders);
        if (found.length === 1) params.set("bib", found[0].bib ?? found[0].name);
        else if (found.length > 1) {
          const current = findRiders(data.riders, value);
          params.set("bib", current.length === 1 ? current[0].name : value);
        }
      }
      location.assign(`?${params}`);
    } catch (err) {
      console.error("Could not switch race year", err);
      setSwitching(false);
      setError(true);
      setMessage(`Could not load ${next.year} results. Please try again.`);
    }
  }
  const hasWaveData = data.finishers.some((item) => Number.isInteger(item.wave));
  const hasStartData = data.finishers.some((item) => Number.isFinite(item.start) && Number.isInteger(item.wave));

  return <>
    <header className="masthead">
      <h1 id="race-title" className="eyebrow">{raceTitle}</h1>
      <div className="search-controls">
        <div className="event-picker"><label htmlFor="event">Race</label>
          <select id="event" name="race" aria-label="Race" value={raceKey} onChange={(event) => {
            const nextEvent = event.target.value;
            location.assign(makeRaceUrl(index.events[nextEvent].years[0].year, nextEvent));
          }}>{Object.entries(index.events).map(([key, event]) => <option key={key} value={key}>{event.name}</option>)}</select></div>
        <div className="year-picker"><label htmlFor="year">Year</label>
          <select id="year" name="year" aria-label="Race year" value={entry.year} disabled={switching} onChange={changeYear}>
            {eventYears.map((year) => <option key={year.year} value={year.year}>{year.year}</option>)}
          </select></div>
        <form id="lookup" className="lookup" autoComplete="off" onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) lookup(query); else reset();
        }}><label htmlFor="query">Bib number or name</label><div className="lookup-row">
          <input id="query" name="query" type="search" inputMode="search" placeholder="e.g. 4026" required
            disabled={switching} value={query} onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value.trim()) reset();
            }} />
          <button type="submit" disabled={switching}>Show results</button>
        </div></form>
      </div>
      <p id="message" className={`message${error ? " error" : ""}`} role="status">{message}</p>
      {matches.length > 0 && <div id="matches" className="matches">{matches.map((item, i) =>
        <button type="button" key={`${item.name}-${item.bib}-${i}`} onClick={() => {
          const value = item.bib === null ? item.name : String(item.bib);
          setQuery(value);
          lookup(value);
        }}>{[item.name, item.bib === null ? "" : `#${item.bib}`, item.city, divisionLabel(item)].filter(Boolean).join(" · ")}</button>)}</div>}
    </header>
    <main>
      <Recap index={index} eventYears={eventYears} data={data} raceKey={raceKey} raceUrl={raceUrl} hidden={Boolean(rider)} />
      {rider && <RiderReport rider={rider} data={data} entry={entry} eventYears={eventYears}
        loader={loader} raceHistory={raceHistory} raceUrl={raceUrl} searchVersion={searchVersion} />}
    </main>
    <footer>Data: <a id="source" href={data.race.resultsUrl}>{data.race.sourceName}</a><span id="source-note">
      {hasStartData ? " with start-wave information." : hasWaveData ? " with wave assignments; scheduled start times unavailable."
        : " (start-wave data unavailable for this year)."}</span>
      <br />Hat tip to Stephen Spry and <a href="https://bsnyd.com/iceman">Ben Snyder</a> for historical pass-count and wave placement data.
      {" "}Not affiliated with the Iceman Cometh Challenge.
    </footer>
  </>;
}

export default function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    (async () => {
      const index = await loadIndex();
      const params = new URLSearchParams(location.search);
      const requestedEvent = params.get("race");
      const raceKey = index.events[requestedEvent] ? requestedEvent : "iceman";
      const eventInfo = index.events[raceKey];
      const requestedYear = Number(params.get("year"));
      const entry = eventInfo.years.find((year) => year.year === requestedYear) ?? eventInfo.years[0];
      if ((requestedYear && entry.year !== requestedYear) || (requestedEvent && raceKey !== requestedEvent)) {
        const normalized = new URLSearchParams();
        if (raceKey !== "iceman") normalized.set("race", raceKey);
        if (entry.year !== eventInfo.years[0].year || requestedYear) normalized.set("year", entry.year);
        window.history.replaceState(null, "", normalized.size ? `?${normalized}` : location.pathname);
      }
      const loader = createRaceLoader(raceKey, eventInfo);
      const data = await loader.loadRace(entry);
      const raceHistory = await Promise.all(eventInfo.years.filter((year) =>
        year.year <= data.race.year && year.year >= data.race.year - 5).map(loader.loadRace));
      if (active) setState({ index, raceKey, eventInfo, entry, data, loader, raceHistory });
    })().catch((err) => {
      if (!active) return;
      console.error("Could not load race results", err);
      setError(err);
    });
    return () => { active = false; };
  }, [attempt]);
  if (error) return <main><p className="message error" role="alert">Could not load race results. Please try again.</p>
    <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></main>;
  if (!state) return <main><p className="message" role="status">Loading race results...</p></main>;
  return <RacePage {...state} />;
}
