import { describe, expect, test } from "bun:test";
import {
	busVehicleSignature,
	snapshotSignature,
	trainSignature,
} from "../src/client/hooks/useVehiclePolling";
import type { BusVehicle, Train } from "../src/types";

function busVehicle(overrides: Partial<BusVehicle> = {}): BusVehicle {
	return {
		tripId: "trip-1",
		routeId: "route-39a",
		routeShortName: "39A",
		lat: 53.355,
		lng: -6.265,
		bearing: 90,
		speed: 0,
		timestamp: 1_000,
		label: "1847",
		directionId: 0,
		shapeId: "shape-1",
		stale: false,
		...overrides,
	};
}

function train(overrides: Partial<Train> = {}): Train {
	return {
		code: "P660",
		lat: 53.35,
		lng: -6.25,
		status: "R",
		message: "Departed Dublin Connolly",
		direction: "Northbound",
		date: "2026-05-16",
		...overrides,
	};
}

describe("vehicle polling signatures", () => {
	test("bus signature ignores upstream timestamp-only changes", () => {
		expect(busVehicleSignature(busVehicle({ timestamp: 1_000 }))).toBe(
			busVehicleSignature(busVehicle({ timestamp: 1_015 })),
		);
	});

	test("bus signature changes when visible vehicle state changes", () => {
		const base = busVehicleSignature(busVehicle());

		expect(busVehicleSignature(busVehicle({ lat: 53.356 }))).not.toBe(base);
		expect(busVehicleSignature(busVehicle({ lng: -6.266 }))).not.toBe(base);
		expect(busVehicleSignature(busVehicle({ bearing: 91 }))).not.toBe(base);
		expect(busVehicleSignature(busVehicle({ speed: 4 }))).not.toBe(base);
		expect(busVehicleSignature(busVehicle({ stale: true }))).not.toBe(base);
	});

	test("snapshot signature is stable when response order changes", () => {
		const first = busVehicle({ tripId: "trip-1", label: "1847" });
		const second = busVehicle({ tripId: "trip-2", label: "1848", lat: 53.36 });

		expect(snapshotSignature([first, second], busVehicleSignature)).toBe(
			snapshotSignature([second, first], busVehicleSignature),
		);
	});

	test("train signature changes when visible train state changes", () => {
		const base = trainSignature(train());

		expect(trainSignature(train({ status: "N" }))).not.toBe(base);
		expect(trainSignature(train({ lat: 53.36 }))).not.toBe(base);
		expect(trainSignature(train({ lng: -6.26 }))).not.toBe(base);
		expect(trainSignature(train({ message: "Arrived Tara Street" }))).not.toBe(
			base,
		);
	});
});
