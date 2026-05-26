import { describe, expect, test } from "bun:test";
import { clearBusRouteLine, tickBusMarker } from "../src/hooks/busAnimation";
import { tickTrainMarker } from "../src/hooks/trainAnimation";
import type { BusMarkerEntry } from "../src/hooks/useBusMarkers";
import type { TrainMarkerEntry } from "../src/hooks/useTrainMarkers";
import { busAnimationDurationMs } from "../src/hooks/useVehicleMap";

function markerWithRecorder() {
	const calls: [number, number][] = [];
	const marker = {
		getLatLng: () => ({ lat: 53.34, lng: -6.25 }),
		setLatLng: (latLng: [number, number]) => {
			calls.push(latLng);
			return marker as L.Marker;
		},
	} as L.Marker;
	return { marker, calls };
}

describe("busAnimationDurationMs", () => {
	test("keeps normal route animation matched to the GPS interval", () => {
		expect(busAnimationDurationMs(100, 135, 0, 5_000, 60_000)).toBe(35_000);
	});

	test("caps focused stop animation so the marker catches up quickly", () => {
		expect(busAnimationDurationMs(100, 135, 0, 1_500, 4_000)).toBe(4_000);
	});

	test("uses a shorter minimum duration for focused stop animation", () => {
		expect(busAnimationDurationMs(100, 101, 0, 1_500, 4_000)).toBe(1_500);
	});

	test("clears temporary focus route constraints back to GPS fallback state", () => {
		const { marker } = markerWithRecorder();
		const markerLatLng = marker.getLatLng();
		const entry: BusMarkerEntry = {
			marker,
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
			prevDistance: 100,
			currentDistance: 200,
			animStartPerfMs: 10,
			animDurationMs: 30_000,
			offRoute: false,
			settled: true,
			lastRenderedDistance: 150,
			shapeId: null,
		};

		clearBusRouteLine(entry, { lat: 53.35, lng: -6.26 }, 1234);

		expect(entry.routeLine).toBeNull();
		expect(entry.routeLookup).toBeNull();
		expect(entry.routeLengthMeters).toBeNull();
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

	test("ticks an off-route bus marker to its GPS target and settles", () => {
		const { marker, calls } = markerWithRecorder();
		const entry: BusMarkerEntry = {
			marker,
			bus: {
				tripId: "trip-1",
				operator: "dublinbus",
				routeId: "route-1",
				routeShortName: "1",
				lat: 10,
				lng: 20,
				bearing: null,
				speed: null,
				timestamp: 100,
				label: "Bus 1",
				directionId: 0,
				shapeId: null,
				stale: false,
			},
			targetLat: 10,
			targetLng: 20,
			correctionFromLat: 0,
			correctionFromLng: 0,
			correctionStartTime: 0,
			routeLine: null,
			routeLookup: null,
			routeLengthMeters: null,
			prevDistance: null,
			currentDistance: null,
			animStartPerfMs: null,
			animDurationMs: 30_000,
			offRoute: true,
			settled: false,
			lastRenderedDistance: null,
			shapeId: null,
		};

		tickBusMarker(entry, 2000);

		expect(calls).toEqual([[10, 20]]);
		expect(entry.settled).toBe(true);
	});

	test("ticks an on-route bus marker along the route and skips duplicate renders", () => {
		const { marker, calls } = markerWithRecorder();
		const entry: BusMarkerEntry = {
			marker,
			bus: {
				tripId: "trip-1",
				operator: "dublinbus",
				routeId: "route-1",
				routeShortName: "1",
				lat: 0,
				lng: 0,
				bearing: null,
				speed: null,
				timestamp: 100,
				label: "Bus 1",
				directionId: 0,
				shapeId: null,
				stale: false,
			},
			targetLat: 0,
			targetLng: 0,
			correctionFromLat: 0,
			correctionFromLng: 0,
			correctionStartTime: 0,
			routeLine: null,
			routeLookup: new Float64Array([0, 0, 0, 100, 1, 1]),
			routeLengthMeters: 100,
			prevDistance: 0,
			currentDistance: 100,
			animStartPerfMs: 0,
			animDurationMs: 1000,
			offRoute: false,
			settled: false,
			lastRenderedDistance: null,
			shapeId: null,
		};

		tickBusMarker(entry, 500);
		tickBusMarker(entry, 500);

		expect(calls).toEqual([[0.5, 0.5]]);
		expect(entry.lastRenderedDistance).toBe(50);
	});

	test("ticks an off-route train marker with velocity extrapolation", () => {
		const { marker, calls } = markerWithRecorder();
		const entry: TrainMarkerEntry = {
			marker,
			lastColor: "green",
			train: {
				code: "E123",
				lat: 1,
				lng: 2,
				status: "R",
				message: "",
				direction: "Northbound",
				date: "09 May 2026",
			},
			targetLat: 1,
			targetLng: 2,
			velocityLat: 0.001,
			velocityLng: 0.002,
			lastUpdateTime: 1000,
			correctionFromLat: 1,
			correctionFromLng: 2,
			correctionStartTime: 0,
			routeLine: null,
			routeLookup: null,
			routeLengthMeters: null,
			distanceAtPing: null,
			targetDistanceAlongRoute: null,
			pathSpeedMps: 0,
			lastPingTime: null,
			offRoute: true,
			originDestKey: null,
		};

		tickTrainMarker(entry, 2000);

		expect(calls).toEqual([[2, 4]]);
	});

	test("ticks an on-route train marker with capped route extrapolation", () => {
		const { marker, calls } = markerWithRecorder();
		const entry: TrainMarkerEntry = {
			marker,
			lastColor: "green",
			train: {
				code: "E123",
				lat: 0,
				lng: 0,
				status: "R",
				message: "",
				direction: "Northbound",
				date: "09 May 2026",
			},
			targetLat: 0,
			targetLng: 0,
			velocityLat: 0,
			velocityLng: 0,
			lastUpdateTime: 0,
			correctionFromLat: 0,
			correctionFromLng: 0,
			correctionStartTime: 0,
			routeLine: {} as TrainMarkerEntry["routeLine"],
			routeLookup: new Float64Array([0, 0, 0, 100, 1, 1]),
			routeLengthMeters: 100,
			distanceAtPing: 10,
			targetDistanceAlongRoute: 20,
			pathSpeedMps: 100,
			lastPingTime: 0,
			offRoute: false,
			originDestKey: null,
		};

		tickTrainMarker(entry, 1_000);

		expect(calls).toEqual([[1, 1]]);
	});

	test("falls back to train velocity path when route lookup is missing", () => {
		const { marker, calls } = markerWithRecorder();
		const entry: TrainMarkerEntry = {
			marker,
			lastColor: "green",
			train: {
				code: "E123",
				lat: 1,
				lng: 2,
				status: "R",
				message: "",
				direction: "Northbound",
				date: "09 May 2026",
			},
			targetLat: 1,
			targetLng: 2,
			velocityLat: 0.001,
			velocityLng: 0.002,
			lastUpdateTime: 1000,
			correctionFromLat: 1,
			correctionFromLng: 2,
			correctionStartTime: 0,
			routeLine: {} as TrainMarkerEntry["routeLine"],
			routeLookup: null,
			routeLengthMeters: 100,
			distanceAtPing: 10,
			targetDistanceAlongRoute: 20,
			pathSpeedMps: 100,
			lastPingTime: 0,
			offRoute: false,
			originDestKey: null,
		};

		tickTrainMarker(entry, 2000);

		expect(calls).toEqual([[2, 4]]);
	});
});
