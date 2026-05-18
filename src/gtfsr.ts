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
	type GtfsrHealthSnapshot,
	getBusTripUpdateRealtimeHeaders,
	getBusTripUpdateRealtimeHealth,
	getBusVehicleRealtimeHeaders,
	getBusVehicleRealtimeHealth,
	getGtfsrHealthSnapshot,
	startBackgroundPolling,
} from "./gtfsr/realtimeOrchestration";
import {
	type BusRouteDirectionShape,
	getBusRouteShape,
	getBusRoutes,
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
	getCachedTripUpdates,
	type RawTripUpdateMap,
	resetTripUpdateCacheForTest,
	seedTripUpdateCacheForTest,
} from "./gtfsr/tripUpdates";
import {
	type GtfsVehiclePosition,
	getCachedVehicles,
	resetVehicleCacheForTest,
	seedVehicleCacheForTest,
} from "./gtfsr/vehicles";
import type { BusVehicle, BusOperator as Operator } from "./types";
import { dublinSecondsSinceMidnight } from "./utils";

export type { BusOperator as Operator, BusRoute, BusVehicle } from "./types";
export type {
	BusRouteDirectionShape,
	BusStopArrival,
	GtfsrHealthSnapshot,
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
	getBusTripUpdateRealtimeHeaders,
	getBusTripUpdateRealtimeHealth,
	getBusVehicleRealtimeHeaders,
	getBusVehicleRealtimeHealth,
	getGtfsrHealthSnapshot,
	getOperatorStop,
	mergeTripStops,
	searchAllBusStops,
	searchBusStops,
	startBackgroundPolling,
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
// Public exports
// ---------------------------------------------------------------------------

export function getGtfsrVehiclePositions(): GtfsVehiclePosition[] {
	return getCachedVehicles({ refreshIfStale: true });
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
