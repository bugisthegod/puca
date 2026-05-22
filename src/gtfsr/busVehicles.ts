import type {
	BusRoute,
	BusVehicle,
	BusOperator as Operator,
	VehicleBounds,
} from "../types";
import { isTripEnded } from "./arrivals";
import { getTripShapeMap, operatorRoutes } from "./schedules";
import type { LiveTripData } from "./timing";
import type { GtfsVehiclePosition } from "./vehicles";

export type OperatorBusVehicle = BusVehicle & { operator: Operator };

function vehicleInBounds(vehicle: BusVehicle, bounds: VehicleBounds): boolean {
	return (
		vehicle.lat >= bounds.south &&
		vehicle.lat <= bounds.north &&
		vehicle.lng >= bounds.west &&
		vehicle.lng <= bounds.east
	);
}

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

export function getAllOperatorsBusVehiclesFromCache({
	vehicles,
	tripUpdates,
	nowSec,
	bounds,
}: {
	vehicles: readonly GtfsVehiclePosition[];
	tripUpdates: ReadonlyMap<string, LiveTripData>;
	nowSec: number;
	bounds?: VehicleBounds;
}): OperatorBusVehicle[] {
	const routeById = new Map<string, { operator: Operator; route: BusRoute }>();
	for (const [operator, routes] of Object.entries(operatorRoutes) as [
		Operator,
		BusRoute[],
	][]) {
		for (const route of routes) {
			// NTA route_id is treated as the global identity for a route across the
			// combined VehiclePositions feed. If a duplicate ever appears, keep the
			// first mapping deterministic rather than changing attribution by import
			// order.
			if (!routeById.has(route.id))
				routeById.set(route.id, { operator, route });
		}
	}

	const shapeMaps = new Map<Operator, Map<string, string>>();
	const result: OperatorBusVehicle[] = [];
	for (const v of vehicles) {
		if (bounds && !vehicleInBounds(v, bounds)) continue;
		const match = routeById.get(v.routeId);
		if (!match) continue;
		let shapeMap = shapeMaps.get(match.operator);
		if (!shapeMap) {
			shapeMap = getTripShapeMap(match.operator);
			shapeMaps.set(match.operator, shapeMap);
		}
		result.push({
			...enrichBusVehicle(
				match.operator,
				v,
				match.route,
				shapeMap,
				tripUpdates,
				nowSec,
			),
			operator: match.operator,
		});
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
