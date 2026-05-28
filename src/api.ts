import { XMLParser } from "fast-xml-parser";
import type { StationTrain, Train, TrainMovement } from "./types.ts";

const BASE_URL = "https://api.irishrail.ie/realtime/realtime.asmx";

// --- Cache layer ---
const cache = new Map<string, { data: unknown; expires: number }>();
// Concurrent misses on the same key share one in-flight fetch, so a thundering
// herd on cold cache hits IrishRail once instead of N times.
const inFlight = new Map<string, Promise<unknown>>();

function cached<T>(
	key: string,
	ttlMs: number,
	fn: () => Promise<T>,
): Promise<T> {
	const entry = cache.get(key);
	if (entry && Date.now() < entry.expires)
		return Promise.resolve(entry.data as T);

	const pending = inFlight.get(key);
	if (pending) return pending as Promise<T>;

	const p = fn()
		.then((data) => {
			cache.set(key, { data, expires: Date.now() + ttlMs });
			return data;
		})
		.finally(() => {
			inFlight.delete(key);
		});
	inFlight.set(key, p);
	return p;
}

// Drop expired entries so unread keys (e.g. movements:TRAIN:OLD-DATE) don't
// accumulate forever — read-time TTL only filters them, never deletes them.
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of cache) {
		if (now >= entry.expires) cache.delete(key);
	}
}, 5 * 60_000);

const parser = new XMLParser({
	ignoreAttributes: false,
	parseAttributeValue: true,
	parseTagValue: true,
});

function normalizeArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

export function getCurrentTrains(): Promise<Train[]> {
	return cached("currentTrains", 15_000, async () => {
		const res = await fetch(`${BASE_URL}/getCurrentTrainsXML`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const xml = await res.text();
		const parsed = parser.parse(xml);
		const raw = parsed?.ArrayOfObjTrainPositions?.objTrainPositions;
		const items = normalizeArray(raw);
		return items.map((item: Record<string, unknown>) => ({
			code: String(item.TrainCode ?? ""),
			lat: Number(item.TrainLatitude ?? 0),
			lng: Number(item.TrainLongitude ?? 0),
			status: String(item.TrainStatus ?? "N") as Train["status"],
			message: String(item.PublicMessage ?? ""),
			direction: String(item.Direction ?? ""),
			date: String(item.TrainDate ?? ""),
		}));
	});
}

export function getStationData(
	stationCode: string,
	numMins: number = 90,
): Promise<StationTrain[]> {
	return cached(`station:${stationCode}:${numMins}`, 30_000, async () => {
		const url = `${BASE_URL}/getStationDataByCodeXML_WithNumMins?StationCode=${encodeURIComponent(stationCode)}&NumMins=${numMins}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const xml = await res.text();
		const parsed = parser.parse(xml);
		const raw = parsed?.ArrayOfObjStationData?.objStationData;
		const items = normalizeArray(raw);
		return items.map((item: Record<string, unknown>) => ({
			trainCode: String(item.Traincode ?? "").trim(),
			stationName: String(item.Stationfullname ?? ""),
			stationCode: String(item.Stationcode ?? ""),
			origin: String(item.Origin ?? ""),
			destination: String(item.Destination ?? ""),
			originTime: String(item.Origintime ?? ""),
			destinationTime: String(item.Destinationtime ?? ""),
			status: String(item.Status ?? ""),
			lastLocation: String(item.Lastlocation ?? ""),
			dueIn: Number(item.Duein ?? 0),
			late: Number(item.Late ?? 0),
			expArrival: String(item.Exparrival ?? ""),
			expDepart: String(item.Expdepart ?? ""),
			schArrival: String(item.Scharrival ?? ""),
			schDepart: String(item.Schdepart ?? ""),
			direction: String(item.Direction ?? ""),
			trainType: String(item.Traintype ?? ""),
		}));
	});
}

export function getTrainMovements(
	trainId: string,
	trainDate: string,
): Promise<TrainMovement[]> {
	return cached(`movements:${trainId}:${trainDate}`, 30_000, async () => {
		const url = `${BASE_URL}/getTrainMovementsXML?TrainId=${encodeURIComponent(trainId)}&TrainDate=${encodeURIComponent(trainDate)}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const xml = await res.text();
		const parsed = parser.parse(xml);
		const raw = parsed?.ArrayOfObjTrainMovements?.objTrainMovements;
		const items = normalizeArray(raw);
		return items.map((item: Record<string, unknown>) => ({
			trainCode: String(item.TrainCode ?? ""),
			stationName: String(item.LocationFullName ?? ""),
			stationCode: String(item.LocationCode ?? ""),
			scheduledArrival: String(item.ScheduledArrival ?? ""),
			scheduledDepart: String(item.ScheduledDeparture ?? ""),
			expectedArrival: String(item.ExpectedArrival ?? ""),
			expectedDepart: String(item.ExpectedDeparture ?? ""),
			arrival: String(item.Arrival ?? ""),
			departure: String(item.Departure ?? ""),
			stopType: String(item.StopType ?? ""),
		}));
	});
}
