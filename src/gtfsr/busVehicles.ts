import type { BusRoute, BusVehicle, BusOperator as Operator } from "../types";
import { isTripEnded } from "./arrivals";
import { getTripShapeMap, operatorRoutes } from "./schedules";
import type { LiveTripData } from "./timing";
import type { GtfsVehiclePosition } from "./vehicles";

export function getBusVehiclesByRouteFromCache({
	operator,
	shortName,
	direction,
	vehicles,
	tripUpdates,
	nowSec,
}: {
	operator: Operator;
	shortName: string;
	direction?: number;
	vehicles: readonly GtfsVehiclePosition[];
	tripUpdates: ReadonlyMap<string, LiveTripData>;
	nowSec: number;
}): BusVehicle[] {
	const routes = operatorRoutes[operator];
	const route = routes.find(
		(r) => r.shortName.toLowerCase() === shortName.toLowerCase(),
	);
	if (!route) return [];

	const shapeMap = getTripShapeMap(operator);
	const result: BusVehicle[] = [];
	for (const v of vehicles) {
		if (v.routeId !== route.id) continue;
		if (direction !== undefined && v.directionId !== direction) continue;
		result.push(
			enrichBusVehicle(operator, v, route, shapeMap, tripUpdates, nowSec),
		);
	}
	return result;
}

export function getAllBusVehiclesFromCache({
	operator,
	vehicles,
	tripUpdates,
	nowSec,
}: {
	operator: Operator;
	vehicles: readonly GtfsVehiclePosition[];
	tripUpdates: ReadonlyMap<string, LiveTripData>;
	nowSec: number;
}): BusVehicle[] {
	const routes = operatorRoutes[operator];
	const routeById = new Map<string, BusRoute>();
	for (const route of routes) routeById.set(route.id, route);

	const shapeMap = getTripShapeMap(operator);
	const result: BusVehicle[] = [];
	for (const v of vehicles) {
		const route = routeById.get(v.routeId);
		if (!route) continue;
		result.push(
			enrichBusVehicle(operator, v, route, shapeMap, tripUpdates, nowSec),
		);
	}
	return result;
}

function enrichBusVehicle(
	operator: Operator,
	vehicle: GtfsVehiclePosition,
	route: BusRoute,
	shapeMap: ReadonlyMap<string, string>,
	tripUpdates: ReadonlyMap<string, LiveTripData>,
	nowSec: number,
): BusVehicle {
	return {
		...vehicle,
		routeShortName: route.shortName,
		shapeId: shapeMap.get(vehicle.tripId) ?? null,
		stale: isTripEnded(operator, vehicle.tripId, nowSec, tripUpdates),
	};
}
