import { afterEach, expect, test } from "bun:test";
import luasArrivalsData from "../src/data/luas-arrivals.json" with {
	type: "json",
};
import {
	type RawTripUpdateMap,
	resetTripUpdateCacheForTest,
	seedTripUpdateCacheForTest,
} from "../src/gtfsr/tripUpdates";
import {
	getLuasStopArrivals,
	getLuasStopArrivalsOfficialFirst,
	getLuasStopArrivalsRealtimeFirst,
	resetLuasOfficialForecastCacheForTest,
} from "../src/luas";

const sampleArrivalsDate = new Date(
	`${luasArrivalsData.generatedAt.slice(0, 10)}T16:58:00Z`,
);
const originalFetch = globalThis.fetch;

afterEach(() => {
	resetTripUpdateCacheForTest();
	resetLuasOfficialForecastCacheForTest();
	globalThis.fetch = originalFetch;
});

test("Luas arrivals hide trips whose destination is the selected stop", () => {
	const arrivals = getLuasStopArrivals("8220GA00436", sampleArrivalsDate);

	expect(arrivals.length).toBeGreaterThan(0);
	expect(arrivals.some((arrival) => arrival.headsign === "The Point")).toBe(
		false,
	);
	expect(
		arrivals.some((arrival) =>
			["Tallaght", "Saggart"].includes(arrival.headsign),
		),
	).toBe(true);
});

test("Luas arrivals do not return duplicate display rows", () => {
	const arrivals = getLuasStopArrivals("8220GA00436", sampleArrivalsDate);
	const keys = arrivals.map((arrival) =>
		[arrival.routeShortName, arrival.headsign, arrival.departureSec].join("|"),
	);

	expect(new Set(keys).size).toBe(keys.length);
});

test("Luas arrivals prefer NTA GTFS-R TripUpdates when available", () => {
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			"5242_3825",
			{
				tripId: "5242_3825",
				routeId: "10000 RED g a",
				directionId: 0,
				stopTimeUpdates: [
					{
						sequence: 1,
						stopId: "8220GA00436",
						arrivalDelaySec: null,
						departureDelaySec: 180,
						scheduleRelationship: "SCHEDULED",
					},
					{
						sequence: 2,
						stopId: "8220GA00439",
						arrivalDelaySec: 60,
						departureDelaySec: 60,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst(
		"8220GA00436",
		new Date("2026-06-18T16:58:00Z"),
	);

	expect(arrivals).toHaveLength(1);
	expect(arrivals[0]).toMatchObject({
		headsign: "Tallaght",
		etaSeconds: 300,
		departureTime: "18:03",
	});
});

test("Luas arrivals prefer the official Luas forecast when available", async () => {
	const requestedUrls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		requestedUrls.push(url);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="TPT" lat="53.34835" long="-6.22925833333333" pronunciation="The Point">The Point</stop><stop abrev="SDK" lat="53.3488222222222" long="-6.23714722222222" pronunciation="Spencer Dock">Spencer Dock</stop></line></stops>',
			);
		}
		if (url.includes("action=forecast") && url.includes("stop=SDK")) {
			return new Response(
				'<stopInfo created="2026-06-18T13:45:01" stop="Spencer Dock" stopAbv="SDK"><direction name="Inbound"><tram dueMins="2" destination="The Point" /><tram dueMins="13" destination="The Point" /></direction><direction name="Outbound"><tram dueMins="DUE" destination="Tallaght" /></direction></stopInfo>',
			);
		}
		return new Response("not found", { status: 404 });
	}) as unknown as typeof globalThis.fetch;

	const tripUpdates: RawTripUpdateMap = new Map([
		[
			"5242_5190",
			{
				tripId: "5242_5190",
				routeId: "10000 RED g a",
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: 27,
						stopId: "8220GA00434",
						arrivalDelaySec: null,
						departureDelaySec: 600,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		new Date("2026-06-18T12:45:00Z"),
	);

	expect(requestedUrls.some((url) => url.includes("action=forecast"))).toBe(
		true,
	);
	expect(
		arrivals.map((arrival) => [arrival.headsign, arrival.etaSeconds]),
	).toEqual([
		["Tallaght", 0],
		["The Point", 120],
		["The Point", 780],
	]);
	expect(arrivals[0]?.routeShortName).toBe("Red");
});

test("Luas official forecast cache recomputes ETA on later reads", async () => {
	const requestedUrls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		requestedUrls.push(url);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="SDK" lat="53.3488222222222" long="-6.23714722222222" pronunciation="Spencer Dock">Spencer Dock</stop></line></stops>',
			);
		}
		return new Response(
			'<stopInfo created="2026-06-18T13:45:01" stop="Spencer Dock" stopAbv="SDK"><direction name="Inbound"><tram dueMins="2" destination="The Point" /></direction></stopInfo>',
		);
	}) as unknown as typeof globalThis.fetch;

	const first = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		new Date("2026-06-18T12:45:00Z"),
	);
	const second = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		new Date("2026-06-18T12:45:15Z"),
	);

	expect(first[0]?.etaSeconds).toBe(120);
	expect(second[0]?.etaSeconds).toBe(105);
	expect(
		requestedUrls.filter((url) => url.includes("action=forecast")),
	).toHaveLength(1);
});

test("Luas official empty forecast falls back to NTA TripUpdates", async () => {
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="TPT" lat="53.34835" long="-6.22925833333333" pronunciation="The Point">The Point</stop></line></stops>',
			);
		}
		return new Response(
			'<stopInfo created="2026-06-18T13:45:01" stop="The Point" stopAbv="TPT"><direction name="Outbound"></direction></stopInfo>',
		);
	}) as unknown as typeof globalThis.fetch;
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			"5242_3825",
			{
				tripId: "5242_3825",
				routeId: "10000 RED g a",
				directionId: 0,
				stopTimeUpdates: [
					{
						sequence: 1,
						stopId: "8220GA00436",
						arrivalDelaySec: null,
						departureDelaySec: 180,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst(
		"8220GA00436",
		new Date("2026-06-18T16:58:00Z"),
	);

	expect(arrivals).toHaveLength(1);
	expect(arrivals[0]).toMatchObject({
		headsign: "Tallaght",
		etaSeconds: 300,
	});
});

test("Luas arrivals fall back from official forecast to NTA TripUpdates", async () => {
	globalThis.fetch = (async () => {
		return new Response("upstream failed", { status: 500 });
	}) as unknown as typeof globalThis.fetch;
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			"5242_3825",
			{
				tripId: "5242_3825",
				routeId: "10000 RED g a",
				directionId: 0,
				stopTimeUpdates: [
					{
						sequence: 1,
						stopId: "8220GA00436",
						arrivalDelaySec: null,
						departureDelaySec: 180,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst(
		"8220GA00436",
		new Date("2026-06-18T16:58:00Z"),
	);

	expect(arrivals).toHaveLength(1);
	expect(arrivals[0]).toMatchObject({
		headsign: "Tallaght",
		etaSeconds: 300,
		departureTime: "18:03",
	});
});

test("Luas official forecast failures are not cached", async () => {
	let forecastCalls = 0;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="SDK" lat="53.3488222222222" long="-6.23714722222222" pronunciation="Spencer Dock">Spencer Dock</stop></line></stops>',
			);
		}
		forecastCalls += 1;
		if (forecastCalls === 1) {
			return new Response("temporary failure", { status: 503 });
		}
		return new Response(
			'<stopInfo created="2026-06-18T13:45:01" stop="Spencer Dock" stopAbv="SDK"><direction name="Inbound"><tram dueMins="2" destination="The Point" /></direction></stopInfo>',
		);
	}) as unknown as typeof globalThis.fetch;
	seedTripUpdateCacheForTest({
		tripUpdates: new Map(),
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const fallback = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		new Date("2026-06-18T12:45:00Z"),
	);
	const official = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		new Date("2026-06-18T12:45:01Z"),
	);

	expect(fallback).toEqual(
		getLuasStopArrivals("8220GA00433", new Date("2026-06-18T12:45:00Z")),
	);
	expect(official[0]).toMatchObject({
		headsign: "The Point",
		etaSeconds: 120,
	});
	expect(forecastCalls).toBe(2);
});

test("Luas arrivals fall back from official forecast and TripUpdates to static GTFS", async () => {
	const now = new Date("2026-06-18T16:58:00Z");
	globalThis.fetch = (async () => {
		return new Response("upstream failed", { status: 500 });
	}) as unknown as typeof globalThis.fetch;
	seedTripUpdateCacheForTest({
		tripUpdates: new Map(),
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst("8220GA00436", now);

	expect(arrivals).toEqual(getLuasStopArrivals("8220GA00436", now));
});

test("Luas realtime arrivals ignore TripUpdates for inactive service days", () => {
	const now = new Date("2026-06-20T04:53:00Z");
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			"5242_1247",
			{
				tripId: "5242_1247",
				routeId: "10000 GREEN g a",
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: 14,
						stopId: "8220GA00031",
						arrivalDelaySec: null,
						departureDelaySec: 180,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	expect(getLuasStopArrivalsRealtimeFirst("8220GA00031", now)).toEqual(
		getLuasStopArrivals("8220GA00031", now),
	);
});

test("Luas arrivals fall back to static GTFS when TripUpdates are unavailable", () => {
	const now = new Date("2026-06-18T16:58:00Z");
	seedTripUpdateCacheForTest({
		tripUpdates: new Map(),
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst("8220GA00436", now);

	expect(arrivals).toEqual(getLuasStopArrivals("8220GA00436", now));
});

test("Luas realtime arrivals dedupe rows with the same displayed minutes", () => {
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			"5242_5190",
			{
				tripId: "5242_5190",
				routeId: "10000 RED g a",
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: 27,
						stopId: "8220GA00434",
						arrivalDelaySec: null,
						departureDelaySec: 176,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
		[
			"5242_5206",
			{
				tripId: "5242_5206",
				routeId: "10000 RED g a",
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: 25,
						stopId: "8220GA00434",
						arrivalDelaySec: null,
						departureDelaySec: -140,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst(
		"8220GA00433",
		new Date("2026-06-18T12:33:30Z"),
	);
	const pointFiveMinuteRows = arrivals.filter(
		(arrival) =>
			arrival.headsign === "The Point" &&
			Math.ceil(arrival.etaSeconds / 60) === 5,
	);

	expect(pointFiveMinuteRows).toHaveLength(1);
});

test("Luas realtime arrivals ignore trips without an update for the selected stop", () => {
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			"5242_5190",
			{
				tripId: "5242_5190",
				routeId: "10000 RED g a",
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: 27,
						stopId: "8220GA00434",
						arrivalDelaySec: null,
						departureDelaySec: 176,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
		[
			"5242_5206",
			{
				tripId: "5242_5206",
				routeId: "10000 RED g a",
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: 24,
						stopId: "8220GA00431",
						arrivalDelaySec: -140,
						departureDelaySec: -140,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst(
		"8220GA00433",
		new Date("2026-06-18T12:33:30Z"),
	);

	expect(
		arrivals.filter((arrival) => arrival.headsign === "The Point"),
	).toHaveLength(1);
});
