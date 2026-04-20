import type { Station } from "./types";
import stationsData from "./data/stations.json" with { type: "json" };

const stations = stationsData as Station[];

export function getStationsOnce(): Promise<Station[]> {
  return Promise.resolve(stations);
}
