import { errToMeta, log } from "../logger";
import type { BusOperator as Operator } from "../types";
import { dublinSecondsSinceMidnight, isInServiceHours } from "../utils";
import {
	getTripScheduledStops,
	getTripShapeId,
	operatorStops,
} from "./schedules";
import {
	computeArrivalTiming,
	findClosestTripStop,
	type GpsInferredDelay,
	type LiveTripData,
	type TripStopPoint,
} from "./timing";
import { getCachedVehicles } from "./vehicles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GtfsTripUpdateEntity = {
	trip_update?: {
		trip?: { trip_id?: string; route_id?: string; direction_id?: number };
		stop_time_update?: Array<{
			stop_sequence?: number;
			stop_id?: string;
			arrival?: { delay?: number; time?: number | string };
			departure?: { delay?: number; time?: number | string };
			schedule_relationship?: string;
		}>;
	};
};

export type RawTripUpdateMap = Map<
	string,
	{
		tripId: string;
		routeId: string;
		directionId: number;
		stopTimeUpdates: Array<{
			sequence: number;
			stopId: string;
			arrivalDelaySec: number | null;
			departureDelaySec: number | null;
			scheduleRelationship: string;
		}>;
	}
>;

export type StopTimeUpdate = {
	sequence: number;
	stopId: string;
	name: string;
	lat: number;
	lng: number;
	scheduledArrivalSec: number | null;
	expectedArrivalSec: number | null;
	arrivalDelaySec: number | null;
	departureDelaySec: number | null;
	scheduleRelationship: string;
	isCurrent: boolean;
};

export type TripUpdate = {
	tripId: string;
	routeId: string;
	directionId: number;
	shapeId: string | null;
	stops: StopTimeUpdate[];
};

// ---------------------------------------------------------------------------
// NTA config
// ---------------------------------------------------------------------------

const NTA_TRIP_UPDATES_URL =
	"https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json";
export const NTA_TRIP_UPDATES_INTERVAL_MS = 75_000;
const NTA_FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Cache + rate gate
// ---------------------------------------------------------------------------

let tripUpdateCache: RawTripUpdateMap | null = null;
let lastTripUpdateCall = 0;
let tripUpdateCacheUpdatedAt = 0;
let tripUpdateRefreshPromise: Promise<void> | null = null;

export function resetRealtimeStateForTest(): void {
	tripUpdateCache = null;
	lastTripUpdateCall = 0;
	tripUpdateCacheUpdatedAt = 0;
	tripUpdateRefreshPromise = null;
}

export function seedRealtimeStateForTest({
	tripUpdates,
	lastTripUpdateCallMs = 0,
}: {
	tripUpdates?: RawTripUpdateMap;
	lastTripUpdateCallMs?: number;
}): void {
	if (tripUpdates !== undefined) {
		tripUpdateCache = tripUpdates;
		tripUpdateCacheUpdatedAt = Date.now();
	}
	lastTripUpdateCall = lastTripUpdateCallMs;
}

async function fetchTripUpdates(): Promise<void> {
	const apiKey = process.env.NTA_API_KEY;
	if (!apiKey) {
		log.error("nta.trip_updates.no_api_key");
		return;
	}

	const start = Date.now();
	try {
		const res = await fetch(NTA_TRIP_UPDATES_URL, {
			headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
			signal: AbortSignal.timeout(NTA_FETCH_TIMEOUT_MS),
		});
		const duration_ms = Date.now() - start;

		if (!res.ok) {
			log.warn("nta.trip_updates.http_error", {
				http_status: res.status,
				duration_ms,
				stale_cache_size: tripUpdateCache?.size ?? 0,
			});
			return;
		}

		const data = await res.json();
		const entities: GtfsTripUpdateEntity[] = data.entity ?? [];
		const map: RawTripUpdateMap = new Map();

		for (const entity of entities) {
			const tu = entity.trip_update;
			const tripId = tu?.trip?.trip_id;
			if (!tripId) continue;

			const stopTimeUpdates = (tu.stop_time_update ?? []).map((s) => ({
				sequence: s.stop_sequence ?? 0,
				stopId: s.stop_id ?? "",
				arrivalDelaySec: s.arrival?.delay ?? null,
				departureDelaySec: s.departure?.delay ?? null,
				scheduleRelationship: s.schedule_relationship ?? "SCHEDULED",
			}));

			map.set(tripId, {
				tripId,
				routeId: tu.trip?.route_id ?? "",
				directionId: tu.trip?.direction_id ?? 0,
				stopTimeUpdates,
			});
		}

		tripUpdateCache = map;
		tripUpdateCacheUpdatedAt = Date.now();
		log.info("nta.trip_updates.ok", { trip_count: map.size, duration_ms });
	} catch (err) {
		log.error("nta.trip_updates.exception", {
			...errToMeta(err),
			duration_ms: Date.now() - start,
			stale_cache_size: tripUpdateCache?.size ?? 0,
		});
	}
}

async function refreshTripUpdatesIfDue(): Promise<void> {
	if (!isInServiceHours("bus")) return;
	if (Date.now() - lastTripUpdateCall < NTA_TRIP_UPDATES_INTERVAL_MS) {
		return;
	}
	if (tripUpdateRefreshPromise) return tripUpdateRefreshPromise;
	lastTripUpdateCall = Date.now();
	tripUpdateRefreshPromise = fetchTripUpdates().finally(() => {
		tripUpdateRefreshPromise = null;
	});
	return tripUpdateRefreshPromise;
}

export function startTripUpdatesPolling(): void {
	void refreshTripUpdatesIfDue().catch((err) =>
		log.error("nta.trip_updates.refresh_failed", errToMeta(err)),
	);
}

function triggerTripUpdatesRefreshIfStale(): void {
	void refreshTripUpdatesIfDue().catch((err) =>
		log.error("nta.trip_updates.refresh_failed", errToMeta(err)),
	);
}

export function getCachedTripUpdates({
	refreshIfStale = false,
}: {
	refreshIfStale?: boolean;
} = {}): RawTripUpdateMap {
	if (!isInServiceHours("bus")) {
		tripUpdateCache = null;
		tripUpdateCacheUpdatedAt = 0;
		return new Map();
	}
	if (refreshIfStale) triggerTripUpdatesRefreshIfStale();
	return tripUpdateCache ?? new Map();
}

export function getTripUpdatesCacheInfo(now = Date.now()) {
	return {
		count: tripUpdateCache?.size ?? 0,
		ageSec:
			tripUpdateCacheUpdatedAt <= 0
				? null
				: Math.max(0, Math.round((now - tripUpdateCacheUpdatedAt) / 1000)),
		lastAttemptAgeSec:
			lastTripUpdateCall <= 0
				? null
				: Math.max(0, Math.round((now - lastTripUpdateCall) / 1000)),
		intervalMs: NTA_TRIP_UPDATES_INTERVAL_MS,
	};
}

// ---------------------------------------------------------------------------
// Trip stop merging
// ---------------------------------------------------------------------------

export type ScheduledRow = {
	sequence: number;
	stopId: string;
	arrivalSec: number;
};

export type { LiveTripData } from "./timing";

export function mergeTripStops(
	tripId: string,
	scheduledRows: ScheduledRow[],
	liveTrip: LiveTripData | undefined,
	stops: Record<
		string,
		{ name: string; lat: number; lng: number; code?: string }
	>,
	shapeId: string | null = null,
	gpsInferredDelay: GpsInferredDelay | null = null,
): TripUpdate | null {
	if (scheduledRows.length === 0 && !liveTrip) return null;

	const liveBySeq = new Map<number, LiveTripData["stopTimeUpdates"][number]>();
	if (liveTrip) {
		for (const u of liveTrip.stopTimeUpdates) {
			liveBySeq.set(u.sequence, u);
		}
	}

	if (scheduledRows.length > 0) {
		let currentAssigned = false;
		const mergedStops: StopTimeUpdate[] = scheduledRows.map((row) => {
			const live = liveBySeq.get(row.sequence);
			const stopName = stops[row.stopId]?.name ?? live?.stopId ?? row.stopId;
			const hasExplicitDelay =
				live?.arrivalDelaySec !== undefined && live.arrivalDelaySec !== null;
			const timing = computeArrivalTiming({
				arrivalSec: row.arrivalSec,
				sequence: row.sequence,
				live: liveTrip,
				gpsInferredDelay,
				nowSec: null,
				delayFallbackMode: "prior-only",
			});
			const isCurrent = hasExplicitDelay && !currentAssigned;
			if (isCurrent) currentAssigned = true;
			return {
				sequence: row.sequence,
				stopId: row.stopId,
				name: stopName,
				lat: stops[row.stopId]?.lat ?? 0,
				lng: stops[row.stopId]?.lng ?? 0,
				scheduledArrivalSec: row.arrivalSec,
				expectedArrivalSec: timing.expectedArrivalSec,
				arrivalDelaySec: timing.delaySec,
				departureDelaySec: live?.departureDelaySec ?? null,
				scheduleRelationship: live?.scheduleRelationship ?? "SCHEDULED",
				isCurrent,
			};
		});

		return {
			tripId,
			routeId: liveTrip?.routeId ?? "",
			directionId: liveTrip?.directionId ?? 0,
			shapeId,
			stops: mergedStops,
		};
	}

	if (!liveTrip) return null;

	const fallbackStops: StopTimeUpdate[] = liveTrip.stopTimeUpdates.map(
		(u, i) => ({
			sequence: u.sequence,
			stopId: u.stopId,
			name: stops[u.stopId]?.name ?? u.stopId,
			lat: stops[u.stopId]?.lat ?? 0,
			lng: stops[u.stopId]?.lng ?? 0,
			scheduledArrivalSec: null,
			expectedArrivalSec: null,
			arrivalDelaySec: u.arrivalDelaySec,
			departureDelaySec: u.departureDelaySec,
			scheduleRelationship: u.scheduleRelationship,
			isCurrent: i === 0,
		}),
	);

	return {
		tripId,
		routeId: liveTrip.routeId,
		directionId: liveTrip.directionId,
		shapeId,
		stops: fallbackStops.sort((a, b) => a.sequence - b.sequence),
	};
}

function inferDelayFromVehiclePosition(
	scheduledRows: ScheduledRow[],
	stops: Record<
		string,
		{ name: string; lat: number; lng: number; code?: string }
	>,
	vehicle: { lat: number; lng: number } | null,
	nowSec: number,
): GpsInferredDelay | null {
	if (!vehicle || scheduledRows.length === 0) return null;
	const tripStopCoords = scheduledRows.flatMap((row): TripStopPoint[] => {
		const stop = stops[row.stopId];
		return stop
			? [
					{
						sequence: row.sequence,
						lat: stop.lat,
						lng: stop.lng,
						arrivalSec: row.arrivalSec,
					},
				]
			: [];
	});
	const best = findClosestTripStop(vehicle, tripStopCoords);
	if (!best || best.arrivalSec === undefined) return null;
	return {
		fromSequence: best.sequence,
		delaySec: Math.max(0, nowSec - best.arrivalSec),
	};
}

export async function getBusTripStops(
	operator: Operator,
	tripId: string,
): Promise<TripUpdate | null> {
	const stops = operatorStops[operator];
	const updates = getCachedTripUpdates({ refreshIfStale: true });
	const liveTrip = updates.get(tripId);
	const scheduledRows = getTripScheduledStops(operator, tripId);
	const shapeId = getTripShapeId(operator, tripId);
	const vehicle = getCachedVehicles().find((v) => v.tripId === tripId) ?? null;
	const gpsInferredDelay = inferDelayFromVehiclePosition(
		scheduledRows,
		stops,
		vehicle,
		dublinSecondsSinceMidnight(),
	);
	return mergeTripStops(
		tripId,
		scheduledRows,
		liveTrip,
		stops,
		shapeId,
		gpsInferredDelay,
	);
}
