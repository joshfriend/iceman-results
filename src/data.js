import { parseRace, selectRaceEvent } from "./stats/index.js";

const DATA_VERSION = 5;
const dataUrl = (path) => `${import.meta.env.BASE_URL}data/${path}?v=${DATA_VERSION}`;

async function fetchJson(path) {
  const response = await fetch(dataUrl(path));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

export async function loadIndex() {
  return fetchJson("index.json");
}

export function createRaceLoader(raceKey, eventInfo) {
  const races = new Map();
  const splits = new Map();
  return {
    loadRace(entry) {
      if (!races.has(entry.year)) {
        const request = (async () => {
          for (let attempt = 1; ; attempt++) {
            try {
              return selectRaceEvent(parseRace(await fetchJson(entry.path)), raceKey, eventInfo.name);
            } catch (error) {
              if (attempt === 3) throw error;
              await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
            }
          }
        })().catch((error) => {
          races.delete(entry.year);
          throw error;
        });
        races.set(entry.year, request);
      }
      return races.get(entry.year);
    },
    loadRawRace(entry) {
      return fetchJson(entry.path).then(parseRace);
    },
    loadSplits(entry) {
      if (!entry.splits) return Promise.resolve(null);
      if (!splits.has(entry.splits)) {
        const request = fetchJson(entry.splits).catch((error) => {
          splits.delete(entry.splits);
          throw error;
        });
        splits.set(entry.splits, request);
      }
      return splits.get(entry.splits);
    },
  };
}

export function raceUrl(year, event, params = {}) {
  const query = new URLSearchParams();
  if (event !== "iceman") query.set("race", event);
  query.set("year", year);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  return `?${query}`;
}
