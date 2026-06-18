import { describe, expect, test } from "bun:test";
import {
	boundsSignature,
	busInBounds,
	stableVisibleBuses,
	type VisibleBusCache,
	visibleBusSnapshotSignature,
} from "../src/client/hooks/visibleBuses";
import type { BusVehicle } from "../src/types";

function bus(overrides: Partial<BusVehicle> = {}): BusVehicle {
	return {
		tripId: "trip-1",
		routeId: "route-1",
		routeShortName: "1",
		lat: 53.35,
		lng: -6.26,
		bearing: 90,
		speed: 4,
		timestamp: 100,
		label: "100",
		directionId: 0,
		shapeId: "shape-1",
		stale: false,
		operator: "dublinbus",
		...overrides,
	};
}

describe("visible bus helpers", () => {
	test("checks padded viewport bounds inclusively", () => {
		const bounds = { north: 53.4, south: 53.3, east: -6.2, west: -6.3 };

		expect(busInBounds(bus(), bounds)).toBe(true);
		expect(busInBounds(bus({ lat: 53.41 }), bounds)).toBe(false);
		expect(busInBounds(bus({ lng: -6.31 }), bounds)).toBe(false);
	});

	test("rounds bounds signatures so tiny map jitter does not reset state", () => {
		expect(
			boundsSignature({
				north: 53.400001,
				south: 53.300001,
				east: -6.200001,
				west: -6.300001,
			}),
		).toBe("53.40000,53.30000,-6.20000,-6.30000");
	});

	test("visible snapshot signatures are stable across response order changes", () => {
		const first = bus({ tripId: "trip-1" });
		const second = bus({ tripId: "trip-2", lat: 53.36 });

		expect(visibleBusSnapshotSignature([first, second])).toBe(
			visibleBusSnapshotSignature([second, first]),
		);
	});

	test("stableVisibleBuses reuses the previous array when rendered vehicles are unchanged", () => {
		const cache: VisibleBusCache = { signature: "", buses: [] };
		const first = [bus()];
		const second = [bus()];

		expect(stableVisibleBuses(first, cache)).toBe(first);
		expect(stableVisibleBuses(second, cache)).toBe(first);
	});

	test("stableVisibleBuses ignores sub-visual GPS and speed jitter", () => {
		const cache: VisibleBusCache = { signature: "", buses: [] };
		const first = [
			bus({ lat: 53.350001, lng: -6.260001, bearing: 90.1, speed: 4.1 }),
		];
		const second = [
			bus({ lat: 53.350002, lng: -6.260002, bearing: 90.2, speed: 4.2 }),
		];

		stableVisibleBuses(first, cache);

		expect(stableVisibleBuses(second, cache)).toBe(first);
	});

	test("stableVisibleBuses updates when animation-relevant vehicle state changes", () => {
		const cache: VisibleBusCache = { signature: "", buses: [] };
		const first = [bus({ timestamp: 100 })];
		const second = [bus({ timestamp: 130 })];

		stableVisibleBuses(first, cache);

		expect(stableVisibleBuses(second, cache)).toBe(second);
	});
});
