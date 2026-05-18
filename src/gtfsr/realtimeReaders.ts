import type { BusVehicle, BusOperator as Operator } from "../types";
import { dublinSecondsSinceMidnight } from "../utils";
import {
	type BusStopArrival,
	getBusStopArrivals as getBusStopArrivalsFromCache,
} from "./arrivals";
import {
	getAllBusVehiclesFromCache,
	getBusVehiclesByRouteFromCache,
} from "./busVehicles";
import { getBusTripStopsFromCache, type TripUpdate } from "./trips";
import {
	getCachedTripUpdates,
	type RawTripUpdateMap,
	resetTripUpdateCacheForTest,
	seedTripUpdateCacheForTest,
} from "./tripUpdates";
import {
	type GtfsVehiclePosition,
	getCachedVehicles,
	resetVehicleCacheForTest,
	seedVehicleCacheForTest,
} from "./vehicles";

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

export function getGtfsrVehiclePositions(): GtfsVehiclePosition[] {
	return getCachedVehicles({ refreshIfStale: true });
}

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
