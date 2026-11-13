import { History } from "./History.jsx";
import { RiderDetails } from "./RiderDetails.jsx";
import { RiderSplits } from "./RiderSplits.jsx";
import { RiderSummary } from "./RiderSummary.jsx";

export function RiderReport({ rider, data, entry, eventYears, loader, raceHistory, raceUrl, searchVersion }) {
  const hasRiderWave = Number.isFinite(rider.start) && Number.isFinite(rider.clock) && Number.isInteger(rider.wave);

  return <div id="report">
    <RiderSummary rider={rider} data={data} hasRiderWave={hasRiderWave} />
    <RiderSplits rider={rider} entry={entry} loader={loader} />
    <History rider={rider} data={data} eventYears={eventYears} loader={loader} raceUrl={raceUrl} searchVersion={searchVersion} />
    {rider.finished && <RiderDetails rider={rider} data={data} raceHistory={raceHistory} hasRiderWave={hasRiderWave} />}
  </div>;
}
