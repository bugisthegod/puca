import type { BusVehicle, VehicleBounds } from "../types";

export type VisibleBusCache = {
	signature: string;
	buses: BusVehicle[];
};

export function busInBounds(
	bus: Pick<BusVehicle, "lat" | "lng">,
	bounds: VehicleBounds,
): boolean {
	return (
		bus.lat >= bounds.south &&
		bus.lat <= bounds.north &&
		bus.lng >= bounds.west &&
		bus.lng <= bounds.east
	);
}

export function boundsSignature(bounds: VehicleBounds | null): string | null {
	if (!bounds) return null;
	return [bounds.north, bounds.south, bounds.east, bounds.west]
		.map((n) => n.toFixed(5))
		.join(",");
}

export function busViewportRenderSignature(bus: BusVehicle): string {
	return [
		bus.tripId || bus.label,
		bus.operator ?? "",
		bus.routeId,
		bus.routeShortName,
		bus.directionId,
		bus.lat.toFixed(5),
		bus.lng.toFixed(5),
		Math.round(bus.bearing ?? -1),
		Math.round(bus.speed ?? -1),
		bus.timestamp,
		bus.shapeId ?? "",
		bus.stale ? 1 : 0,
	].join("|");
}

export function visibleBusSnapshotSignature(buses: BusVehicle[]): string {
	return buses.map(busViewportRenderSignature).sort().join("\n");
}

export function stableVisibleBuses(
	nextBuses: BusVehicle[],
	cache: VisibleBusCache,
): BusVehicle[] {
	const signature = visibleBusSnapshotSignature(nextBuses);
	if (signature === cache.signature) return cache.buses;
	cache.signature = signature;
	cache.buses = nextBuses;
	return nextBuses;
}
