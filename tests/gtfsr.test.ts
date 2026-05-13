import { afterEach, describe, expect, test } from "bun:test";
import {
	__testing,
	decideStopArrival,
	type GtfsVehiclePosition,
	getAllBusVehicles,
	getBusRouteShape,
	getBusTripStops,
	getGtfsrHealthSnapshot,
	getGtfsrVehiclePositions,
	getTrainRouteShape,
	type LiveTripData,
	mergeTripStops,
	type ScheduledRow,
} from "../src/gtfsr";

const stops = {
	S1: { name: "Stop One", lat: 53.1, lng: -6.1 },
	S2: { name: "Stop Two", lat: 53.2, lng: -6.2 },
	S3: { name: "Stop Three", lat: 53.3, lng: -6.3 },
	S4: { name: "Stop Four", lat: 53.4, lng: -6.4 },
};

const scheduledFour: ScheduledRow[] = [
	{ sequence: 1, stopId: "S1", arrivalSec: 1000 },
	{ sequence: 2, stopId: "S2", arrivalSec: 1100 },
	{ sequence: 3, stopId: "S3", arrivalSec: 1200 },
	{ sequence: 4, stopId: "S4", arrivalSec: 1300 },
];

describe("mergeTripStops", () => {
	test("returns null when no scheduled rows and no live trip", () => {
		expect(mergeTripStops("T1", [], undefined, stops)).toBeNull();
	});

	test("propagates delay from prior stop with explicit update", () => {
		const live: LiveTripData = {
			routeId: "R1",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 2,
					stopId: "S2",
					arrivalDelaySec: 60,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = mergeTripStops("T1", scheduledFour, live, stops);
		expect(result).not.toBeNull();
		// Stop 1 has no prior delay → null
		expect(result?.stops[0]?.arrivalDelaySec).toBeNull();
		expect(result?.stops[0]?.expectedArrivalSec).toBeNull();
		// Stop 2 has explicit delay
		expect(result?.stops[1]?.arrivalDelaySec).toBe(60);
		expect(result?.stops[1]?.expectedArrivalSec).toBe(1160);
		// Stops 3 and 4 inherit the propagated delay
		expect(result?.stops[2]?.arrivalDelaySec).toBe(60);
		expect(result?.stops[2]?.expectedArrivalSec).toBe(1260);
		expect(result?.stops[3]?.arrivalDelaySec).toBe(60);
		expect(result?.stops[3]?.expectedArrivalSec).toBe(1360);
	});

	test("treats arrivalDelaySec === 0 as an explicit update (not propagation)", () => {
		const live: LiveTripData = {
			routeId: "R1",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 1,
					stopId: "S1",
					arrivalDelaySec: 120,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 3,
					stopId: "S3",
					arrivalDelaySec: 0,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = mergeTripStops("T1", scheduledFour, live, stops)!;
		expect(result.stops[0]?.arrivalDelaySec).toBe(120);
		// Stop 2 has no explicit, inherits 120 from stop 1
		expect(result.stops[1]?.arrivalDelaySec).toBe(120);
		// Stop 3 explicit 0 — should override, NOT inherit 120
		expect(result.stops[2]?.arrivalDelaySec).toBe(0);
		expect(result.stops[2]?.expectedArrivalSec).toBe(1200);
		// Stop 3 was explicit, so stop 4 inherits 0 (not 120)
		expect(result.stops[3]?.arrivalDelaySec).toBe(0);
		expect(result.stops[3]?.expectedArrivalSec).toBe(1300);
		// Both explicit-delay stops get isCurrent? No — only the FIRST.
		expect(result.stops[0]?.isCurrent).toBe(true);
		expect(result.stops[2]?.isCurrent).toBe(false);
	});

	test("isCurrent is set on the first stop with an explicit delay only", () => {
		const live: LiveTripData = {
			routeId: "R1",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 2,
					stopId: "S2",
					arrivalDelaySec: 30,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 3,
					stopId: "S3",
					arrivalDelaySec: 45,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = mergeTripStops("T1", scheduledFour, live, stops)!;
		expect(result.stops[0]?.isCurrent).toBe(false);
		expect(result.stops[1]?.isCurrent).toBe(true);
		expect(result.stops[2]?.isCurrent).toBe(false);
		expect(result.stops[3]?.isCurrent).toBe(false);
	});

	test("no isCurrent when there are no live updates (all delays null)", () => {
		const result = mergeTripStops("T1", scheduledFour, undefined, stops)!;
		for (const s of result.stops) {
			expect(s.isCurrent).toBe(false);
			expect(s.arrivalDelaySec).toBeNull();
			expect(s.expectedArrivalSec).toBeNull();
		}
		expect(result.routeId).toBe("");
		expect(result.directionId).toBe(0);
	});

	test("fills expected arrivals from GPS-inferred delay when live updates have no delays", () => {
		const live: LiveTripData = {
			routeId: "R1",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 3,
					stopId: "S3",
					arrivalDelaySec: null,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = mergeTripStops("T1", scheduledFour, live, stops, null, {
			fromSequence: 2,
			delaySec: 180,
		})!;
		expect(result.stops[0]?.arrivalDelaySec).toBeNull();
		expect(result.stops[0]?.expectedArrivalSec).toBeNull();
		expect(result.stops[1]?.arrivalDelaySec).toBe(180);
		expect(result.stops[1]?.expectedArrivalSec).toBe(1280);
		expect(result.stops[2]?.arrivalDelaySec).toBe(180);
		expect(result.stops[2]?.expectedArrivalSec).toBe(1380);
		expect(result.stops[3]?.arrivalDelaySec).toBe(180);
		expect(result.stops[3]?.expectedArrivalSec).toBe(1480);
	});

	test("scheduled stopId wins over live stopId when sequences match", () => {
		const live: LiveTripData = {
			routeId: "R1",
			directionId: 0,
			stopTimeUpdates: [
				// Live reports a different stopId at sequence 2
				{
					sequence: 2,
					stopId: "X_LIVE",
					arrivalDelaySec: 60,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = mergeTripStops("T1", scheduledFour, live, stops)!;
		expect(result.stops[1]?.stopId).toBe("S2");
		expect(result.stops[1]?.name).toBe("Stop Two");
		expect(result.stops[1]?.lat).toBe(53.2);
	});

	test("falls back to live-only path when scheduledRows is empty", () => {
		const live: LiveTripData = {
			routeId: "R7",
			directionId: 1,
			stopTimeUpdates: [
				{
					sequence: 2,
					stopId: "S2",
					arrivalDelaySec: 30,
					departureDelaySec: 30,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 1,
					stopId: "S1",
					arrivalDelaySec: 0,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = mergeTripStops("T1", [], live, stops)!;
		// Sorted by sequence in the fallback branch
		expect(result.stops.map((s) => s.sequence)).toEqual([1, 2]);
		// All scheduled fields are null in the fallback shape
		for (const s of result.stops) {
			expect(s.scheduledArrivalSec).toBeNull();
			expect(s.expectedArrivalSec).toBeNull();
		}
		// First stop in the original (unsorted) live order is marked current
		// The current implementation marks i === 0 BEFORE sorting,
		// so the stop that was first in the live array is current.
		const current = result.stops.find((s) => s.isCurrent);
		expect(current?.stopId).toBe("S2");
		expect(result.routeId).toBe("R7");
		expect(result.directionId).toBe(1);
	});

	test("uses live stopId as name when stops dict has no entry (fallback path)", () => {
		const live: LiveTripData = {
			routeId: "R1",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 1,
					stopId: "UNKNOWN",
					arrivalDelaySec: null,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = mergeTripStops("T1", [], live, stops)!;
		expect(result.stops[0]?.name).toBe("UNKNOWN");
		expect(result.stops[0]?.lat).toBe(0);
		expect(result.stops[0]?.lng).toBe(0);
	});
});

describe("getBusRouteShape", () => {
	test("matches shortName case-insensitively", () => {
		const upper = getBusRouteShape("dublinbus", "C1");
		const lower = getBusRouteShape("dublinbus", "c1");
		expect(upper).not.toBeNull();
		expect(lower).not.toBeNull();
		expect(lower).toEqual(upper);
	});

	test("returns null for an unknown shortName", () => {
		expect(getBusRouteShape("dublinbus", "NOPE_999")).toBeNull();
	});
});

describe("getGtfsrHealthSnapshot", () => {
	test("returns safe operational metadata without requiring live NTA data", async () => {
		const health = await getGtfsrHealthSnapshot();

		expect(health.backgroundPollingStarted).toBe(false);
		expect(health.nta.vehicles.count).toBe(0);
		expect(health.nta.vehicles.ageSec).toBeNull();
		expect(health.nta.vehicles.intervalMs).toBeGreaterThan(0);
		expect(health.nta.tripUpdates.count).toBe(0);
		expect(health.nta.tripUpdates.ageSec).toBeNull();
		expect(health.nta.tripUpdates.intervalMs).toBeGreaterThan(0);
		expect(Object.keys(health.db).sort()).toEqual([
			"buseireann",
			"dublinbus",
			"goahead",
		]);
		for (const status of Object.values(health.db)) {
			expect(["connected", "available", "missing", "error"]).toContain(
				status.status,
			);
		}
	});
});

describe("realtime cache request path", () => {
	const originalFetch = globalThis.fetch;
	const originalDate = globalThis.Date;
	const originalApiKey = process.env.NTA_API_KEY;

	function pendingFetch() {
		const resolvers: Array<(response: Response) => void> = [];
		const calls: string[] = [];
		const fetch = ((input: RequestInfo | URL) => {
			calls.push(typeof input === "string" ? input : input.toString());
			return new Promise<Response>((resolve) => {
				resolvers.push(resolve);
			});
		}) as typeof globalThis.fetch;
		return {
			calls,
			fetch,
			resolveAll: () =>
				resolvers
					.splice(0)
					.forEach((resolve) => resolve(Response.json({ entity: [] }))),
		};
	}

	async function expectSettlesQuickly<T>(promise: Promise<T>): Promise<T> {
		const timeout = new Promise<"timeout">((resolve) =>
			setTimeout(() => resolve("timeout"), 25),
		);
		const result = await Promise.race([promise, timeout]);
		expect(result).not.toBe("timeout");
		return result as T;
	}

	function mockServiceHourClock(): void {
		const fixedMs = originalDate.parse("2026-05-09T12:00:00+01:00");
		mockClock(fixedMs);
	}

	function mockOffHoursClock(): void {
		const fixedMs = originalDate.parse("2026-05-09T01:00:00+01:00");
		mockClock(fixedMs);
	}

	function mockClock(fixedMs: number): void {
		globalThis.Date = class extends originalDate {
			constructor(...args: any[]) {
				if (args.length > 0) super(args[0]);
				else super(fixedMs);
			}

			static override now() {
				return fixedMs;
			}
		} as DateConstructor;
	}

	afterEach(() => {
		globalThis.fetch = originalFetch;
		globalThis.Date = originalDate;
		if (originalApiKey === undefined) delete process.env.NTA_API_KEY;
		else process.env.NTA_API_KEY = originalApiKey;
		__testing.resetRealtimeState();
	});

	test("returns stale vehicle cache without awaiting a slow NTA refresh", async () => {
		mockServiceHourClock();
		process.env.NTA_API_KEY = "test-key";
		const slowFetch = pendingFetch();
		globalThis.fetch = slowFetch.fetch;
		const cachedVehicle: GtfsVehiclePosition = {
			tripId: "T1",
			routeId: "1 38A c a",
			lat: 53.35,
			lng: -6.26,
			bearing: null,
			speed: null,
			timestamp: 1,
			label: "Bus 1",
			directionId: 0,
		};
		__testing.seedRealtimeState({
			vehicles: [cachedVehicle],
			tripUpdates: new Map(),
			lastVehicleCallMs: 0,
			lastTripUpdateCallMs: Date.now(),
		});

		const vehicles = await expectSettlesQuickly(getAllBusVehicles("dublinbus"));
		slowFetch.resolveAll();

		expect(vehicles).toHaveLength(1);
		expect(vehicles[0]?.tripId).toBe("T1");
		expect(vehicles[0]?.routeShortName).toBe("38A");
		expect(slowFetch.calls).toHaveLength(1);
	});

	test("returns an empty list quickly on cold cache instead of waiting for NTA", async () => {
		mockServiceHourClock();
		process.env.NTA_API_KEY = "test-key";
		const slowFetch = pendingFetch();
		globalThis.fetch = slowFetch.fetch;
		__testing.resetRealtimeState();

		const vehicles = await expectSettlesQuickly(getAllBusVehicles("dublinbus"));
		slowFetch.resolveAll();

		expect(vehicles).toEqual([]);
		expect(slowFetch.calls).toHaveLength(2);
	});

	test("does not serve stale vehicles outside bus service hours", () => {
		mockOffHoursClock();
		__testing.seedRealtimeState({
			vehicles: [
				{
					tripId: "T1",
					routeId: "1 38A c a",
					lat: 53.35,
					lng: -6.26,
					bearing: null,
					speed: null,
					timestamp: 1,
					label: "Bus 1",
					directionId: 0,
				},
			],
		});

		expect(getGtfsrVehiclePositions()).toEqual([]);
	});

	test("does not serve stale TripUpdates outside bus service hours", async () => {
		mockOffHoursClock();
		__testing.seedRealtimeState({
			tripUpdates: new Map([
				[
					"T1",
					{
						tripId: "T1",
						routeId: "1 38A c a",
						directionId: 0,
						stopTimeUpdates: [
							{
								sequence: 1,
								stopId: "S1",
								arrivalDelaySec: 60,
								departureDelaySec: null,
								scheduleRelationship: "SCHEDULED",
							},
						],
					},
				],
			]),
		});

		await expect(getBusTripStops("dublinbus", "T1")).resolves.toBeNull();
	});
});

describe("decideStopArrival", () => {
	// Reusable fixture: a 12-stop trip where the user's stop is sequence 8.
	// Stops are spaced ~0.001° apart (~110 m) along a NW->SE diagonal so
	// closest-stop matching has unambiguous winners.
	const tripStopCoords = Array.from({ length: 12 }, (_, i) => ({
		sequence: i + 1,
		lat: 53.35 + i * 0.001,
		lng: -6.27 + i * 0.001,
		arrivalSec: 71_760 + i * 60,
	}));
	const userRow = { stop_sequence: 8, arrival_sec: 72_240 }; // 20:04
	const nowSec = 72_540; // 20:09 — sched already past

	function liveWithFutureStopsOnly(): LiveTripData {
		return {
			routeId: "R38",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 10,
					stopId: "T10",
					arrivalDelaySec: 0,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 11,
					stopId: "T11",
					arrivalDelaySec: 0,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
	}

	test("the bug: NTA stops 4-9 dropped, GPS shows bus still upstream → keep with Due", () => {
		// Vehicle GPS sits exactly on sequence 8 — closest match is the user's stop.
		const vehicle = {
			lat: tripStopCoords[7]!.lat,
			lng: tripStopCoords[7]!.lng,
		};
		const result = decideStopArrival(
			userRow,
			liveWithFutureStopsOnly(),
			vehicle,
			tripStopCoords,
			nowSec,
		);
		expect(result.keep).toBe(true);
		if (!result.keep) return;
		expect(result.etaSec).toBe(0); // clamped to "Due"
		expect(result.delaySec).toBe(0);
		expect(result.vehicleSeq).toBe(8);
	});

	test("vehicle GPS confirms bus genuinely past user's stop → drop", () => {
		const vehicle = {
			lat: tripStopCoords[10]!.lat,
			lng: tripStopCoords[10]!.lng,
		};
		const result = decideStopArrival(
			userRow,
			liveWithFutureStopsOnly(),
			vehicle,
			tripStopCoords,
			nowSec,
		);
		expect(result.keep).toBe(false);
	});

	test("no GPS + NTA says past → fall back to NTA filter, drop", () => {
		const result = decideStopArrival(
			userRow,
			liveWithFutureStopsOnly(),
			null,
			[],
			nowSec,
		);
		expect(result.keep).toBe(false);
	});

	test("no GPS + NTA seq matches user's stop but ETA already negative → drop", () => {
		const live: LiveTripData = {
			routeId: "R38",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 8,
					stopId: "T8",
					arrivalDelaySec: 60,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 9,
					stopId: "T9",
					arrivalDelaySec: 60,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		// sched 20:04 + 60s delay = 20:05, now = 20:09 → still negative ETA
		// No GPS to override, so this would normally drop.
		const result = decideStopArrival(userRow, live, null, [], nowSec);
		expect(result.keep).toBe(false);
	});

	test("no GPS + sched in future → keep with computed ETA and delay", () => {
		const futureRow = { stop_sequence: 8, arrival_sec: 73_200 }; // 20:20
		const live: LiveTripData = {
			routeId: "R38",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 7,
					stopId: "T7",
					arrivalDelaySec: 120,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 9,
					stopId: "T9",
					arrivalDelaySec: 120,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = decideStopArrival(futureRow, live, null, [], nowSec);
		expect(result.keep).toBe(true);
		if (!result.keep) return;
		expect(result.delaySec).toBe(120); // backward-propagated from stop 7
		expect(result.etaSec).toBe(73_200 + 120 - nowSec); // 780s = 13min
	});

	test("GPS upstream + sched in future → keep with normal ETA, no clamp", () => {
		const futureRow = { stop_sequence: 8, arrival_sec: 73_200 };
		const vehicle = {
			lat: tripStopCoords[5]!.lat,
			lng: tripStopCoords[5]!.lng,
		}; // at stop 6
		const result = decideStopArrival(
			futureRow,
			liveWithFutureStopsOnly(),
			vehicle,
			tripStopCoords,
			nowSec,
		);
		expect(result.keep).toBe(true);
		if (!result.keep) return;
		expect(result.etaSec).toBeGreaterThan(0);
		expect(result.vehicleSeq).toBe(6);
	});

	test("GPS upstream + no NTA delay infers ETA from current scheduled stop", () => {
		const live: LiveTripData = {
			routeId: "R38",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 10,
					stopId: "T10",
					arrivalDelaySec: null,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 11,
					stopId: "T11",
					arrivalDelaySec: null,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const vehicle = {
			lat: tripStopCoords[5]!.lat,
			lng: tripStopCoords[5]!.lng,
		}; // at stop 6
		const result = decideStopArrival(
			userRow,
			live,
			vehicle,
			tripStopCoords,
			nowSec,
		);
		expect(result.keep).toBe(true);
		if (!result.keep) return;
		expect(result.vehicleSeq).toBe(6);
		expect(result.etaSource).toBe("gps-inferred");
		expect(result.delaySec).toBe(nowSec - tripStopCoords[5]!.arrivalSec!);
		expect(result.etaSec).toBe(
			userRow.arrival_sec - tripStopCoords[5]!.arrivalSec!,
		);
	});

	test("GPS at user's stop (sequence equal) → keep, treats as upstream", () => {
		const vehicle = {
			lat: tripStopCoords[7]!.lat,
			lng: tripStopCoords[7]!.lng,
		};
		const result = decideStopArrival(
			userRow,
			liveWithFutureStopsOnly(),
			vehicle,
			tripStopCoords,
			nowSec,
		);
		expect(result.keep).toBe(true);
		if (!result.keep) return;
		expect(result.vehicleSeq).toBe(8);
	});

	test("vehicle present but tripStopCoords empty → falls back to NTA filter", () => {
		const vehicle = { lat: 53.355, lng: -6.265 };
		// Empty coords means we couldn't compute a vehicleSeq — should NOT incorrectly keep.
		// NTA's first stopTimeUpdate is at sequence 10 > 8 → fall back filter drops.
		const result = decideStopArrival(
			userRow,
			liveWithFutureStopsOnly(),
			vehicle,
			[],
			nowSec,
		);
		expect(result.keep).toBe(false);
	});

	test("backward delay propagation wins over forward", () => {
		// Bus has explicit delay at stop 6 (prior) AND at stop 11 (future).
		// For row at stop 8, we should inherit stop 6's delay, not stop 11's.
		const futureRow = { stop_sequence: 8, arrival_sec: 73_200 };
		const live: LiveTripData = {
			routeId: "R38",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 6,
					stopId: "T6",
					arrivalDelaySec: 180,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 11,
					stopId: "T11",
					arrivalDelaySec: 30,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = decideStopArrival(futureRow, live, null, [], nowSec);
		expect(result.keep).toBe(true);
		if (!result.keep) return;
		expect(result.delaySec).toBe(180);
	});

	test("delay propagation is stable when NTA stopTimeUpdates arrive out of order", () => {
		const futureRow = { stop_sequence: 8, arrival_sec: 73_200 };
		const live: LiveTripData = {
			routeId: "R38",
			directionId: 0,
			stopTimeUpdates: [
				{
					sequence: 11,
					stopId: "T11",
					arrivalDelaySec: 30,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
				{
					sequence: 6,
					stopId: "T6",
					arrivalDelaySec: 180,
					departureDelaySec: null,
					scheduleRelationship: "SCHEDULED",
				},
			],
		};
		const result = decideStopArrival(futureRow, live, null, [], nowSec);
		expect(result.keep).toBe(true);
		if (!result.keep) return;
		expect(result.delaySec).toBe(180);
	});
});

describe("getTrainRouteShape", () => {
	test("normalizes origin/destination via trim + lowercase", () => {
		const a = getTrainRouteShape("Malahide", "Greystones");
		const b = getTrainRouteShape("  malahide  ", "  GREYSTONES  ");
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(b).toEqual(a);
	});

	test("returns null for an unknown endpoint pair", () => {
		expect(getTrainRouteShape("Atlantis", "Narnia")).toBeNull();
	});
});
