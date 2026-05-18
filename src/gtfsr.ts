import trainEndpoints from "./data/train-routes-by-endpoints.json" with {
	type: "json",
};
import trainShapes from "./data/train-shapes.json" with { type: "json" };
import {
	type BusStopArrival,
	decideStopArrival,
	getBusStopArrivals as getBusStopArrivalsFromCache,
	type StopArrivalDecision,
} from "./gtfsr/arrivals";
import {
	getAllBusVehiclesFromCache,
	getBusVehiclesByRouteFromCache,
} from "./gtfsr/busVehicles";
import {
	type BusRouteDirectionShape,
	getBusRouteShape,
	getBusRoutes,
	getDbHealth,
	getOperatorStop,
	type ScheduledRow,
	type StopSearchResult,
	searchAllBusStops,
	searchBusStops,
} from "./gtfsr/schedules";
import type { LiveTripData } from "./gtfsr/timing";
import {
	getBusTripStopsFromCache,
	mergeTripStops,
	type StopTimeUpdate,
	type TripUpdate,
} from "./gtfsr/trips";
import {
	getBusTripUpdateRealtimeHealth,
	getCachedTripUpdates,
	getTripUpdateCacheMeta,
	NTA_TRIP_UPDATES_INTERVAL_MS,
	type RawTripUpdateMap,
	refreshTripUpdatesIfDue,
	resetTripUpdateCacheForTest,
	seedTripUpdateCacheForTest,
} from "./gtfsr/tripUpdates";
import {
	type GtfsVehiclePosition,
	getBusVehicleCacheHealth,
	getCachedVehicles,
	getVehicleCacheMeta,
	NTA_VEHICLES_INTERVAL_MS,
	refreshVehiclesIfDue,
	resetVehicleCacheForTest,
	seedVehicleCacheForTest,
} from "./gtfsr/vehicles";
import { errToMeta, log } from "./logger";
import { REALTIME_AGE_HEADER, REALTIME_STATUS_HEADER } from "./realtime";
import type {
	BusVehicle,
	BusOperator as Operator,
	RealtimeHealth,
} from "./types";
import { OPERATORS } from "./types";
import { dublinSecondsSinceMidnight, isInServiceHours } from "./utils";

export type { BusOperator as Operator, BusRoute, BusVehicle } from "./types";
export type {
	BusRouteDirectionShape,
	BusStopArrival,
	GtfsVehiclePosition,
	ScheduledRow,
	StopArrivalDecision,
	StopSearchResult,
	StopTimeUpdate,
	TripUpdate,
};
export {
	decideStopArrival,
	getBusRouteShape,
	getBusRoutes,
	getBusTripUpdateRealtimeHealth,
	getOperatorStop,
	mergeTripStops,
	searchAllBusStops,
	searchBusStops,
};

// ---------------------------------------------------------------------------
// Cache + NTA rate gate
// ---------------------------------------------------------------------------
// NTA Fair Usage Policy: "each token will be restricted to calling the GTFS Real
// Time API once every 60 seconds." We enforce this per-endpoint: refreshes inside
// the interval return immediately. Frontend can poll at whatever cadence it wants:
// user requests read stale cache, while background refreshes are the only code path
// that waits for NTA.

function resetRealtimeStateForTest(): void {
	resetVehicleCacheForTest();
	resetTripUpdateCacheForTest();
}

function seedRealtimeStateForTest({
	vehicles,
	tripUpdates,
	lastVehicleCallMs = 0,
	lastTripUpdateCallMs = 0,
	vehicleUpdatedAtMs,
	tripUpdateUpdatedAtMs,
}: {
	vehicles?: GtfsVehiclePosition[];
	tripUpdates?: RawTripUpdateMap;
	lastVehicleCallMs?: number;
	lastTripUpdateCallMs?: number;
	vehicleUpdatedAtMs?: number;
	tripUpdateUpdatedAtMs?: number;
}): void {
	seedVehicleCacheForTest({
		vehicles,
		lastVehicleCallMs,
		vehicleUpdatedAtMs,
	});
	seedTripUpdateCacheForTest({
		tripUpdates,
		lastTripUpdateCallMs,
		tripUpdateUpdatedAtMs,
	});
}

export const __testing = {
	resetRealtimeState: resetRealtimeStateForTest,
	seedRealtimeState: seedRealtimeStateForTest,
};

// ---------------------------------------------------------------------------
// Background polling
// ---------------------------------------------------------------------------
// Without this, every NTA call is request-driven: a cold-cache visitor pays
// the latency AND can fire Vehicles + TripUpdates back-to-back, bursting
// against the shared NTA quota. With background polling, requests always read
// fresh cache and NTA calls happen on a steady cadence.
// Skips outside service hours so we don't burn quota when no buses run.

let backgroundPollingStarted = false;

export function startBackgroundPolling(): void {
	if (backgroundPollingStarted) return;
	backgroundPollingStarted = true;

	const tickVehicles = () => {
		if (!isInServiceHours("bus")) return;
		void refreshVehiclesIfDue().catch((err) =>
			log.error("nta.background_vehicles_failed", errToMeta(err)),
		);
	};
	const tickTripUpdates = () => {
		if (!isInServiceHours("bus")) return;
		void refreshTripUpdatesIfDue().catch((err) =>
			log.error("nta.background_trip_updates_failed", errToMeta(err)),
		);
	};

	// Pre-warm both caches immediately on boot so the first user request after a
	// restart doesn't wait 35s for vehicles. Stagger TripUpdates by 5s so the
	// initial pair doesn't hit NTA in the same tick.
	tickVehicles();
	setTimeout(tickTripUpdates, 5_000);

	// Vehicles is the higher-priority stream (live GPS positions) → 35s cadence.
	setInterval(tickVehicles, NTA_VEHICLES_INTERVAL_MS);
	// TripUpdates offset by 7s. With V=35s and TU=75s, gcd=5 so TU drifts through
	// 7 positions relative to V over ~4min. Phase doesn't really matter for NTA
	// rate limits (it's per-minute count, not spacing) — this offset just keeps
	// the very first interval-driven TU call ~12s away from the first V tick.
	setTimeout(
		() => setInterval(tickTripUpdates, NTA_TRIP_UPDATES_INTERVAL_MS),
		7_000,
	);

	log.info("nta.background_polling.started", {
		vehicles_interval_ms: NTA_VEHICLES_INTERVAL_MS,
		trip_updates_interval_ms: NTA_TRIP_UPDATES_INTERVAL_MS,
	});
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export function getGtfsrVehiclePositions(): GtfsVehiclePosition[] {
	return getCachedVehicles({ refreshIfStale: true });
}

export type GtfsrHealthSnapshot = {
	backgroundPollingStarted: boolean;
	nta: {
		vehicles: {
			count: number;
			ageSec: number | null;
			lastAttemptAgeSec: number | null;
			intervalMs: number;
		};
		tripUpdates: {
			count: number;
			ageSec: number | null;
			lastAttemptAgeSec: number | null;
			intervalMs: number;
		};
	};
	db: Record<
		Operator,
		{
			status: "connected" | "available" | "missing" | "error";
		}
	>;
};

function realtimeHeaders(health: RealtimeHealth): Record<string, string> {
	const headers: Record<string, string> = {
		[REALTIME_STATUS_HEADER]: health.status,
	};
	if (health.ageSec !== null) {
		headers[REALTIME_AGE_HEADER] = String(health.ageSec);
	}
	return headers;
}

export function getBusVehicleRealtimeHealth(now = Date.now()): RealtimeHealth {
	return getBusVehicleCacheHealth(now);
}

export function getBusVehicleRealtimeHeaders(
	now = Date.now(),
): Record<string, string> {
	return realtimeHeaders(getBusVehicleRealtimeHealth(now));
}

export function getBusTripUpdateRealtimeHeaders(
	now = Date.now(),
): Record<string, string> {
	return realtimeHeaders(getBusTripUpdateRealtimeHealth(now));
}

export async function getGtfsrHealthSnapshot(
	now = Date.now(),
): Promise<GtfsrHealthSnapshot> {
	const vehicleMeta = getVehicleCacheMeta(now);
	const tripUpdateMeta = getTripUpdateCacheMeta(now);
	const dbEntries = await Promise.all(
		OPERATORS.map(
			async (operator) => [operator, await getDbHealth(operator)] as const,
		),
	);

	return {
		backgroundPollingStarted,
		nta: {
			vehicles: {
				count: vehicleMeta.count,
				ageSec: vehicleMeta.ageSec,
				lastAttemptAgeSec: vehicleMeta.lastAttemptAgeSec,
				intervalMs: vehicleMeta.intervalMs,
			},
			tripUpdates: {
				count: tripUpdateMeta.count,
				ageSec: tripUpdateMeta.ageSec,
				lastAttemptAgeSec: tripUpdateMeta.lastAttemptAgeSec,
				intervalMs: tripUpdateMeta.intervalMs,
			},
		},
		db: Object.fromEntries(dbEntries) as GtfsrHealthSnapshot["db"],
	};
}

export type { LiveTripData };

export async function getBusTripStops(
	operator: Operator,
	tripId: string,
): Promise<TripUpdate | null> {
	return getBusTripStopsFromCache({
		operator,
		tripId,
		tripUpdates: getCachedTripUpdates({ refreshIfStale: true }),
		vehicles: getCachedVehicles(),
		nowSec: dublinSecondsSinceMidnight(),
	});
}

export async function getBusVehiclesByRoute(
	operator: Operator,
	shortName: string,
	direction?: number,
): Promise<BusVehicle[]> {
	return getBusVehiclesByRouteFromCache({
		operator,
		shortName,
		direction,
		vehicles: getCachedVehicles({ refreshIfStale: true }),
		tripUpdates: getCachedTripUpdates({ refreshIfStale: true }),
		nowSec: dublinSecondsSinceMidnight(),
	});
}

export async function getAllBusVehicles(
	operator: Operator,
): Promise<BusVehicle[]> {
	return getAllBusVehiclesFromCache({
		operator,
		vehicles: getCachedVehicles({ refreshIfStale: true }),
		tripUpdates: getCachedTripUpdates({ refreshIfStale: true }),
		nowSec: dublinSecondsSinceMidnight(),
	});
}

export async function getBusStopArrivals(
	operator: Operator,
	stopId: string,
	limit = 15,
): Promise<BusStopArrival[]> {
	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	return getBusStopArrivalsFromCache({
		operator,
		stopId,
		limit,
		tripUpdates,
		vehicles: getCachedVehicles(),
		nowSec: dublinSecondsSinceMidnight(),
	});
}

export function getTrainRouteShape(
	origin: string,
	destination: string,
): {
	headsign: string;
	coords: [number, number][];
	stops: { id: string; name: string; lat: number; lng: number }[];
} | null {
	const key = `${origin.trim().toLowerCase()}|${destination.trim().toLowerCase()}`;
	const endpoints = trainEndpoints as unknown as Record<
		string,
		{ routeId: string; directionId: number }
	>;
	const match = endpoints[key];
	if (!match) return null;

	const shapes = trainShapes as unknown as Record<
		string,
		Record<
			string,
			{
				headsign: string;
				shapeId: string;
				coords: [number, number][];
				stops: { id: string; name: string; lat: number; lng: number }[];
			}
		>
	>;

	const routeShapes = shapes[match.routeId];
	if (!routeShapes) return null;
	const shape = routeShapes[String(match.directionId)];
	if (!shape) return null;

	return { headsign: shape.headsign, coords: shape.coords, stops: shape.stops };
}

// Two-level shape map for the bulk client endpoint:
//   endpoints: 156 endpoint pair keys -> routeKey (deduped reference)
//   shapes:    36 unique shapes by routeKey, only `coords` (the only field the client uses)
// Avoids the 4× duplication that would happen if every endpoint pair carried its own coords.
// Pre-computed at module load — zero cost per request.
const allTrainShapesPayload: {
	endpoints: Record<string, string>;
	shapes: Record<string, { coords: [number, number][] }>;
} = (() => {
	const endpointsOut: Record<string, string> = {};
	const shapesOut: Record<string, { coords: [number, number][] }> = {};
	const endpoints = trainEndpoints as unknown as Record<
		string,
		{ routeId: string; directionId: number }
	>;
	const shapes = trainShapes as unknown as Record<
		string,
		Record<string, { coords: [number, number][] }>
	>;
	for (const [pairKey, { routeId, directionId }] of Object.entries(endpoints)) {
		const shape = shapes[routeId]?.[String(directionId)];
		if (!shape) continue;
		const routeKey = `${routeId}|${directionId}`;
		endpointsOut[pairKey] = routeKey;
		if (!shapesOut[routeKey]) {
			shapesOut[routeKey] = { coords: shape.coords };
		}
	}
	return { endpoints: endpointsOut, shapes: shapesOut };
})();

export function getAllTrainShapes() {
	return allTrainShapesPayload;
}
