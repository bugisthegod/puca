import { describe, expect, test } from "bun:test";
import {
	type BusMarkerEntry,
	busAnimationDurationMs,
	clearFocusRouteLine,
} from "../src/hooks/useBusMarkers";

describe("busAnimationDurationMs", () => {
	test("keeps normal route animation matched to the GPS interval", () => {
		expect(busAnimationDurationMs(100, 135, 0, false)).toBe(35_000);
	});

	test("caps focused stop animation so the marker catches up quickly", () => {
		expect(busAnimationDurationMs(100, 135, 0, true)).toBe(4_000);
	});

	test("uses a shorter minimum duration for focused stop animation", () => {
		expect(busAnimationDurationMs(100, 101, 0, true)).toBe(1_500);
	});

	test("clears temporary focus route constraints back to GPS fallback state", () => {
		const markerLatLng = { lat: 53.34, lng: -6.25 };
		const entry: BusMarkerEntry = {
			marker: {
				getLatLng: () => markerLatLng,
			} as L.Marker,
			bus: {
				tripId: "trip-1",
				operator: "dublinbus",
				routeId: "route-1",
				routeShortName: "1",
				lat: 53.3,
				lng: -6.2,
				bearing: null,
				speed: null,
				timestamp: 100,
				label: "Bus 1",
				directionId: 0,
				shapeId: null,
				stale: false,
			},
			targetLat: 53.3,
			targetLng: -6.2,
			correctionFromLat: 0,
			correctionFromLng: 0,
			correctionStartTime: 0,
			routeLine: {} as BusMarkerEntry["routeLine"],
			routeLookup: new Float64Array([0, 53.3, -6.2]),
			routeLengthMeters: 1000,
			routeLineSource: "focus",
			prevDistance: 100,
			currentDistance: 200,
			animStartPerfMs: 10,
			animDurationMs: 30_000,
			offRoute: false,
			settled: true,
			lastRenderedDistance: 150,
			shapeId: null,
		};

		clearFocusRouteLine(entry, { lat: 53.35, lng: -6.26 }, 1234);

		expect(entry.routeLine).toBeNull();
		expect(entry.routeLookup).toBeNull();
		expect(entry.routeLengthMeters).toBeNull();
		expect(entry.routeLineSource).toBeNull();
		expect(entry.offRoute).toBe(true);
		expect(entry.prevDistance).toBeNull();
		expect(entry.currentDistance).toBeNull();
		expect(entry.animStartPerfMs).toBeNull();
		expect(entry.correctionFromLat).toBe(markerLatLng.lat);
		expect(entry.correctionFromLng).toBe(markerLatLng.lng);
		expect(entry.correctionStartTime).toBe(1234);
		expect(entry.targetLat).toBe(53.35);
		expect(entry.targetLng).toBe(-6.26);
		expect(entry.settled).toBe(false);
		expect(entry.lastRenderedDistance).toBeNull();
	});
});
