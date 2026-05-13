import stationsData from "./data/stations.json" with { type: "json" };
import type { Station } from "./types";

const stations = stationsData as Station[];

export function getStationsOnce(): Promise<Station[]> {
	return Promise.resolve(stations);
}
