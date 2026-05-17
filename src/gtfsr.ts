import type { Database } from "bun:sqlite";
import trainEndpoints from "./data/train-routes-by-endpoints.json" with {
	type: "json",
};
import trainShapes from "./data/train-shapes.json" with { type: "json" };
import {
	type BusRouteDirectionShape,
	getBusRouteShape,
	getBusRoutes,
	getDbHealth,
	getOperatorStop,
	getScheduleDb,
	getTripLastStopSec,
	getTripScheduledStops,
	getTripShapeId,
	getTripShapeMap,
	operatorRoutes,
	operatorShapes,
	operatorStops,
	type ScheduledRow,
	type StopSearchResult,
	type StopsDict,
	searchAllBusStops,
	searchBusStops,
} from "./gtfsr/schedules";
import {
	computeArrivalTiming,
	findClosestTripStop,
	type GpsInferredDelay,
	type LiveTripData,
	sortedStopTimeUpdates,
	type TripStopPoint,
} from "./gtfsr/timing";
import { errToMeta, log } from "./logger";
import { REALTIME_AGE_HEADER, REALTIME_STATUS_HEADER } from "./realtime";
import type {
	BusVehicle,
	BusOperator as Operator,
	RealtimeHealth,
	RealtimeStatus,
} from "./types";
import { OPERATORS } from "./types";
import { dublinSecondsSinceMidnight, isInServiceHours } from "./utils";

const NTA_VEHICLES_URL =
	"https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json";
const NTA_TRIP_UPDATES_URL =
	"https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json";

export type { BusOperator as Operator, BusRoute, BusVehicle } from "./types";
export type { BusRouteDirectionShape, ScheduledRow, StopSearchResult };
export {
	getBusRouteShape,
	getBusRoutes,
	getOperatorStop,
	searchAllBusStops,
	searchBusStops,
};

export type GtfsVehiclePosition = Omit<
	BusVehicle,
	"routeShortName" | "shapeId" | "stale"
>;

export type StopTimeUpdate = {
	sequence: number;
	stopId: string;
	name: string;
	lat: number;
	lng: number;
	scheduledArrivalSec: number | null;
	expectedArrivalSec: number | null;
	arrivalDelaySec: number | null;
	departureDelaySec: number | null;
	scheduleRelationship: string;
	isCurrent: boolean;
};

export type TripUpdate = {
	tripId: string;
	routeId: string;
	directionId: number;
	shapeId: string | null;
	stops: StopTimeUpdate[];
};

type GtfsEntity = {
	vehicle?: {
		trip?: { trip_id?: string; route_id?: string; direction_id?: number };
		position?: {
			latitude?: number;
			longitude?: number;
			bearing?: number;
			speed?: number;
		};
		vehicle?: { id?: string; label?: string };
		timestamp?: number | string;
	};
};

type GtfsTripUpdateEntity = {
	trip_update?: {
		trip?: { trip_id?: string; route_id?: string; direction_id?: number };
		stop_time_update?: Array<{
			stop_sequence?: number;
			stop_id?: string;
			arrival?: { delay?: number; time?: number | string };
			departure?: { delay?: number; time?: number | string };
			schedule_relationship?: string;
		}>;
	};
};

// ---------------------------------------------------------------------------
// Cache + NTA rate gate
// ---------------------------------------------------------------------------
// NTA Fair Usage Policy: "each token will be restricted to calling the GTFS Real
// Time API once every 60 seconds." We enforce this per-endpoint: refreshes inside
// the interval return immediately. Frontend can poll at whatever cadence it wants:
// user requests read stale cache, while background refreshes are the only code path
// that waits for NTA.

// Vehicles at strict 30s started getting NTA 429s ~25% of the time (quota
// appears to be ~3 calls/60s sliding window across V + TU). 35s drops the
// V rate to 1.7/min while staying close to the "every 30s" target.
const NTA_MIN_INTERVAL_MS = 35_000;
// Trip updates (schedule + delays per stop) change much slower than GPS positions.
// 75s lands in the 60-90s ideal range while staying out of phase with the 35s
// vehicles cycle.
const NTA_TRIP_UPDATES_INTERVAL_MS = 75_000;
// NTA occasionally accepts the connection but takes many seconds to respond.
// User requests never await these fetches, but bounding background work keeps
// the polling cadence and connection pool from getting dragged around by a
// single slow upstream response.
const NTA_FETCH_TIMEOUT_MS = 5_000;
const NTA_VEHICLES_STALE_AFTER_SEC = 150;
const NTA_TRIP_UPDATES_STALE_AFTER_SEC = 300;

type RawTripUpdateMap = Map<
	string,
	{
		tripId: string;
		routeId: string;
		directionId: number;
		stopTimeUpdates: Array<{
			sequence: number;
			stopId: string;
			arrivalDelaySec: number | null;
			departureDelaySec: number | null;
			scheduleRelationship: string;
		}>;
	}
>;

let vehicleCache: GtfsVehiclePosition[] | null = null;
let tripUpdateCache: RawTripUpdateMap | null = null;
let lastVehicleCall = 0;
let lastTripUpdateCall = 0;
let vehicleCacheUpdatedAt = 0;
let tripUpdateCacheUpdatedAt = 0;
let vehicleRefreshPromise: Promise<void> | null = null;
let tripUpdateRefreshPromise: Promise<void> | null = null;

function resetRealtimeStateForTest(): void {
	vehicleCache = null;
	tripUpdateCache = null;
	lastVehicleCall = 0;
	lastTripUpdateCall = 0;
	vehicleCacheUpdatedAt = 0;
	tripUpdateCacheUpdatedAt = 0;
	vehicleRefreshPromise = null;
	tripUpdateRefreshPromise = null;
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
	if (vehicles !== undefined) {
		vehicleCache = vehicles;
		vehicleCacheUpdatedAt = vehicleUpdatedAtMs ?? Date.now();
	}
	if (tripUpdates !== undefined) {
		tripUpdateCache = tripUpdates;
		tripUpdateCacheUpdatedAt = tripUpdateUpdatedAtMs ?? Date.now();
	}
	lastVehicleCall = lastVehicleCallMs;
	lastTripUpdateCall = lastTripUpdateCallMs;
}

export const __testing = {
	resetRealtimeState: resetRealtimeStateForTest,
	seedRealtimeState: seedRealtimeStateForTest,
};

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

async function fetchVehicles(): Promise<void> {
	const apiKey = process.env.NTA_API_KEY;
	if (!apiKey) {
		log.error("nta.vehicles.no_api_key");
		return;
	}

	const start = Date.now();
	try {
		const res = await fetch(NTA_VEHICLES_URL, {
			headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
			signal: AbortSignal.timeout(NTA_FETCH_TIMEOUT_MS),
		});
		const duration_ms = Date.now() - start;

		if (!res.ok) {
			log.warn("nta.vehicles.http_error", {
				http_status: res.status,
				duration_ms,
				stale_cache_size: vehicleCache?.length ?? 0,
			});
			return;
		}

		const data = await res.json();
		const entities: GtfsEntity[] = data.entity ?? [];
		const vehicles: GtfsVehiclePosition[] = [];

		for (const entity of entities) {
			const vp = entity.vehicle;
			if (!vp?.position?.latitude || !vp?.position?.longitude) continue;

			vehicles.push({
				tripId: vp.trip?.trip_id ?? "",
				routeId: vp.trip?.route_id ?? "",
				lat: vp.position.latitude,
				lng: vp.position.longitude,
				bearing: vp.position.bearing ?? null,
				speed: vp.position.speed ?? null,
				timestamp: Number(vp.timestamp ?? 0),
				label: vp.vehicle?.label ?? vp.vehicle?.id ?? "",
				directionId: vp.trip?.direction_id ?? 0,
			});
		}

		vehicleCache = vehicles;
		vehicleCacheUpdatedAt = Date.now();
		log.info("nta.vehicles.ok", {
			vehicle_count: vehicles.length,
			duration_ms,
		});
	} catch (err) {
		log.error("nta.vehicles.exception", {
			...errToMeta(err),
			duration_ms: Date.now() - start,
			stale_cache_size: vehicleCache?.length ?? 0,
		});
	}
}

async function refreshVehiclesIfDue(): Promise<void> {
	if (!isInServiceHours("bus")) return;
	if (Date.now() - lastVehicleCall < NTA_MIN_INTERVAL_MS) {
		return;
	}
	if (vehicleRefreshPromise) return vehicleRefreshPromise;
	lastVehicleCall = Date.now();
	vehicleRefreshPromise = fetchVehicles().finally(() => {
		vehicleRefreshPromise = null;
	});
	return vehicleRefreshPromise;
}

function triggerVehicleRefreshIfStale(): void {
	void refreshVehiclesIfDue().catch((err) =>
		log.error("nta.vehicles.refresh_failed", errToMeta(err)),
	);
}

function getCachedVehicles({
	refreshIfStale = false,
}: {
	refreshIfStale?: boolean;
} = {}): GtfsVehiclePosition[] {
	if (!isInServiceHours("bus")) {
		vehicleCache = null;
		vehicleCacheUpdatedAt = 0;
		return [];
	}
	if (refreshIfStale) triggerVehicleRefreshIfStale();
	return vehicleCache ?? [];
}

// ---------------------------------------------------------------------------
// Trip updates
// ---------------------------------------------------------------------------

async function fetchTripUpdates(): Promise<void> {
	const apiKey = process.env.NTA_API_KEY;
	if (!apiKey) {
		log.error("nta.trip_updates.no_api_key");
		return;
	}

	const start = Date.now();
	try {
		const res = await fetch(NTA_TRIP_UPDATES_URL, {
			headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
			signal: AbortSignal.timeout(NTA_FETCH_TIMEOUT_MS),
		});
		const duration_ms = Date.now() - start;

		if (!res.ok) {
			log.warn("nta.trip_updates.http_error", {
				http_status: res.status,
				duration_ms,
				stale_cache_size: tripUpdateCache?.size ?? 0,
			});
			return;
		}

		const data = await res.json();
		const entities: GtfsTripUpdateEntity[] = data.entity ?? [];
		const map: RawTripUpdateMap = new Map();

		for (const entity of entities) {
			const tu = entity.trip_update;
			const tripId = tu?.trip?.trip_id;
			if (!tripId) continue;

			// Store raw stop IDs only — name resolution is operator-aware and done at read time
			const stopTimeUpdates = (tu.stop_time_update ?? []).map((s) => ({
				sequence: s.stop_sequence ?? 0,
				stopId: s.stop_id ?? "",
				arrivalDelaySec: s.arrival?.delay ?? null,
				departureDelaySec: s.departure?.delay ?? null,
				scheduleRelationship: s.schedule_relationship ?? "SCHEDULED",
			}));

			map.set(tripId, {
				tripId,
				routeId: tu.trip?.route_id ?? "",
				directionId: tu.trip?.direction_id ?? 0,
				stopTimeUpdates,
			});
		}

		tripUpdateCache = map;
		tripUpdateCacheUpdatedAt = Date.now();
		log.info("nta.trip_updates.ok", { trip_count: map.size, duration_ms });
	} catch (err) {
		log.error("nta.trip_updates.exception", {
			...errToMeta(err),
			duration_ms: Date.now() - start,
			stale_cache_size: tripUpdateCache?.size ?? 0,
		});
	}
}

async function refreshTripUpdatesIfDue(): Promise<void> {
	if (!isInServiceHours("bus")) return;
	if (Date.now() - lastTripUpdateCall < NTA_TRIP_UPDATES_INTERVAL_MS) {
		return;
	}
	if (tripUpdateRefreshPromise) return tripUpdateRefreshPromise;
	lastTripUpdateCall = Date.now();
	tripUpdateRefreshPromise = fetchTripUpdates().finally(() => {
		tripUpdateRefreshPromise = null;
	});
	return tripUpdateRefreshPromise;
}

function triggerTripUpdatesRefreshIfStale(): void {
	void refreshTripUpdatesIfDue().catch((err) =>
		log.error("nta.trip_updates.refresh_failed", errToMeta(err)),
	);
}

function getCachedTripUpdates({
	refreshIfStale = false,
}: {
	refreshIfStale?: boolean;
} = {}): RawTripUpdateMap {
	if (!isInServiceHours("bus")) {
		tripUpdateCache = null;
		tripUpdateCacheUpdatedAt = 0;
		return new Map();
	}
	if (refreshIfStale) triggerTripUpdatesRefreshIfStale();
	return tripUpdateCache ?? new Map();
}

// ---------------------------------------------------------------------------
// Background polling
// ---------------------------------------------------------------------------
// Without this, every NTA call is request-driven: a cold-cache visitor pays
// the latency AND can fire Vehicles + TripUpdates back-to-back, bursting
// against the shared NTA quota. With background polling, requests always read
// fresh cache and NTA calls happen on a steady cadence.
// Skips outside service hours so we don't burn quota when no buses run.

let backgroundPollingStarted = false;

export function startBackgroundPolling(): void {
	if (backgroundPollingStarted) return;
	backgroundPollingStarted = true;

	const tickVehicles = () => {
		if (!isInServiceHours("bus")) return;
		void refreshVehiclesIfDue().catch((err) =>
			log.error("nta.background_vehicles_failed", errToMeta(err)),
		);
	};
	const tickTripUpdates = () => {
		if (!isInServiceHours("bus")) return;
		void refreshTripUpdatesIfDue().catch((err) =>
			log.error("nta.background_trip_updates_failed", errToMeta(err)),
		);
	};

	// Pre-warm both caches immediately on boot so the first user request after a
	// restart doesn't wait 35s for vehicles. Stagger TripUpdates by 5s so the
	// initial pair doesn't hit NTA in the same tick.
	tickVehicles();
	setTimeout(tickTripUpdates, 5_000);

	// Vehicles is the higher-priority stream (live GPS positions) → 35s cadence.
	setInterval(tickVehicles, NTA_MIN_INTERVAL_MS);
	// TripUpdates offset by 7s. With V=35s and TU=75s, gcd=5 so TU drifts through
	// 7 positions relative to V over ~4min. Phase doesn't really matter for NTA
	// rate limits (it's per-minute count, not spacing) — this offset just keeps
	// the very first interval-driven TU call ~12s away from the first V tick.
	setTimeout(
		() => setInterval(tickTripUpdates, NTA_TRIP_UPDATES_INTERVAL_MS),
		7_000,
	);

	log.info("nta.background_polling.started", {
		vehicles_interval_ms: NTA_MIN_INTERVAL_MS,
		trip_updates_interval_ms: NTA_TRIP_UPDATES_INTERVAL_MS,
	});
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export function getGtfsrVehiclePositions(): GtfsVehiclePosition[] {
	return getCachedVehicles({ refreshIfStale: true });
}

export type GtfsrHealthSnapshot = {
	backgroundPollingStarted: boolean;
	nta: {
		vehicles: {
			count: number;
			ageSec: number | null;
			lastAttemptAgeSec: number | null;
			intervalMs: number;
		};
		tripUpdates: {
			count: number;
			ageSec: number | null;
			lastAttemptAgeSec: number | null;
			intervalMs: number;
		};
	};
	db: Record<
		Operator,
		{
			status: "connected" | "available" | "missing" | "error";
		}
	>;
};

function ageSec(timestampMs: number, now: number): number | null {
	if (timestampMs <= 0) return null;
	return Math.max(0, Math.round((now - timestampMs) / 1000));
}

function statusFromAge(
	age: number | null,
	staleAfterSec: number,
): RealtimeStatus {
	if (age === null) return "unavailable";
	if (age > staleAfterSec) return "stale";
	return "ok";
}

function worstRealtimeStatus(...statuses: RealtimeStatus[]): RealtimeStatus {
	if (statuses.includes("unavailable")) return "unavailable";
	if (statuses.includes("stale")) return "stale";
	return "ok";
}

function realtimeHeaders(health: RealtimeHealth): Record<string, string> {
	const headers: Record<string, string> = {
		[REALTIME_STATUS_HEADER]: health.status,
	};
	if (health.ageSec !== null) {
		headers[REALTIME_AGE_HEADER] = String(health.ageSec);
	}
	return headers;
}

export function getBusVehicleRealtimeHealth(now = Date.now()): RealtimeHealth {
	const vehicleAge = ageSec(vehicleCacheUpdatedAt, now);
	const tripUpdateAge = ageSec(tripUpdateCacheUpdatedAt, now);
	const vehicleStatus = statusFromAge(vehicleAge, NTA_VEHICLES_STALE_AFTER_SEC);
	const tripUpdateStatus =
		tripUpdateAge === null
			? "stale"
			: statusFromAge(tripUpdateAge, NTA_TRIP_UPDATES_STALE_AFTER_SEC);

	return {
		status: worstRealtimeStatus(vehicleStatus, tripUpdateStatus),
		ageSec: vehicleAge,
	};
}

export function getBusTripUpdateRealtimeHealth(
	now = Date.now(),
): RealtimeHealth {
	const tripUpdateAge = ageSec(tripUpdateCacheUpdatedAt, now);
	return {
		status: statusFromAge(tripUpdateAge, NTA_TRIP_UPDATES_STALE_AFTER_SEC),
		ageSec: tripUpdateAge,
	};
}

export function getBusVehicleRealtimeHeaders(
	now = Date.now(),
): Record<string, string> {
	return realtimeHeaders(getBusVehicleRealtimeHealth(now));
}

export function getBusTripUpdateRealtimeHeaders(
	now = Date.now(),
): Record<string, string> {
	return realtimeHeaders(getBusTripUpdateRealtimeHealth(now));
}

export async function getGtfsrHealthSnapshot(
	now = Date.now(),
): Promise<GtfsrHealthSnapshot> {
	const dbEntries = await Promise.all(
		OPERATORS.map(
			async (operator) => [operator, await getDbHealth(operator)] as const,
		),
	);

	return {
		backgroundPollingStarted,
		nta: {
			vehicles: {
				count: vehicleCache?.length ?? 0,
				ageSec: ageSec(vehicleCacheUpdatedAt, now),
				lastAttemptAgeSec: ageSec(lastVehicleCall, now),
				intervalMs: NTA_MIN_INTERVAL_MS,
			},
			tripUpdates: {
				count: tripUpdateCache?.size ?? 0,
				ageSec: ageSec(tripUpdateCacheUpdatedAt, now),
				lastAttemptAgeSec: ageSec(lastTripUpdateCall, now),
				intervalMs: NTA_TRIP_UPDATES_INTERVAL_MS,
			},
		},
		db: Object.fromEntries(dbEntries) as GtfsrHealthSnapshot["db"],
	};
}

export type { LiveTripData };

export function mergeTripStops(
	tripId: string,
	scheduledRows: ScheduledRow[],
	liveTrip: LiveTripData | undefined,
	stops: StopsDict,
	shapeId: string | null = null,
	gpsInferredDelay: GpsInferredDelay | null = null,
): TripUpdate | null {
	if (scheduledRows.length === 0 && !liveTrip) return null;

	const liveBySeq = new Map<number, LiveTripData["stopTimeUpdates"][number]>();
	if (liveTrip) {
		for (const u of liveTrip.stopTimeUpdates) {
			liveBySeq.set(u.sequence, u);
		}
	}

	if (scheduledRows.length > 0) {
		// GTFS-R delay propagation: stops without a specific update inherit
		// the delay from the most recent prior stop that had one.
		// isCurrent marks the first stop with an explicit live update (bus is at or approaching).
		let currentAssigned = false;
		const mergedStops: StopTimeUpdate[] = scheduledRows.map((row) => {
			const live = liveBySeq.get(row.sequence);
			const stopName = stops[row.stopId]?.name ?? live?.stopId ?? row.stopId;
			const hasExplicitDelay =
				live?.arrivalDelaySec !== undefined && live.arrivalDelaySec !== null;
			const timing = computeArrivalTiming({
				arrivalSec: row.arrivalSec,
				sequence: row.sequence,
				live: liveTrip,
				gpsInferredDelay,
				nowSec: null,
				delayFallbackMode: "prior-only",
			});
			const isCurrent = hasExplicitDelay && !currentAssigned;
			if (isCurrent) currentAssigned = true;
			return {
				sequence: row.sequence,
				stopId: row.stopId,
				name: stopName,
				lat: stops[row.stopId]?.lat ?? 0,
				lng: stops[row.stopId]?.lng ?? 0,
				scheduledArrivalSec: row.arrivalSec,
				expectedArrivalSec: timing.expectedArrivalSec,
				arrivalDelaySec: timing.delaySec,
				departureDelaySec: live?.departureDelaySec ?? null,
				scheduleRelationship: live?.scheduleRelationship ?? "SCHEDULED",
				isCurrent,
			};
		});

		return {
			tripId,
			routeId: liveTrip?.routeId ?? "",
			directionId: liveTrip?.directionId ?? 0,
			shapeId,
			stops: mergedStops,
		};
	}

	// DB not available or trip not in DB — return live data with nulls for scheduled
	const fallbackStops: StopTimeUpdate[] = liveTrip!.stopTimeUpdates.map(
		(u, i) => ({
			sequence: u.sequence,
			stopId: u.stopId,
			name: stops[u.stopId]?.name ?? u.stopId,
			lat: stops[u.stopId]?.lat ?? 0,
			lng: stops[u.stopId]?.lng ?? 0,
			scheduledArrivalSec: null,
			expectedArrivalSec: null,
			arrivalDelaySec: u.arrivalDelaySec,
			departureDelaySec: u.departureDelaySec,
			scheduleRelationship: u.scheduleRelationship,
			isCurrent: i === 0,
		}),
	);

	return {
		tripId,
		routeId: liveTrip!.routeId,
		directionId: liveTrip!.directionId,
		shapeId,
		stops: fallbackStops.sort((a, b) => a.sequence - b.sequence),
	};
}

function inferDelayFromVehiclePosition(
	scheduledRows: ScheduledRow[],
	stops: StopsDict,
	vehicle: { lat: number; lng: number } | null,
	nowSec: number,
): GpsInferredDelay | null {
	if (!vehicle || scheduledRows.length === 0) return null;
	const tripStopCoords = scheduledRows.flatMap((row): TripStopPoint[] => {
		const stop = stops[row.stopId];
		return stop
			? [
					{
						sequence: row.sequence,
						lat: stop.lat,
						lng: stop.lng,
						arrivalSec: row.arrivalSec,
					},
				]
			: [];
	});
	const best = findClosestTripStop(vehicle, tripStopCoords);
	if (!best || best.arrivalSec === undefined) return null;
	return {
		fromSequence: best.sequence,
		delaySec: Math.max(0, nowSec - best.arrivalSec),
	};
}

export async function getBusTripStops(
	operator: Operator,
	tripId: string,
): Promise<TripUpdate | null> {
	const stops = operatorStops[operator];
	const updates = getCachedTripUpdates({ refreshIfStale: true });
	const liveTrip = updates.get(tripId);
	const scheduledRows = getTripScheduledStops(operator, tripId);
	const shapeId = getTripShapeId(operator, tripId);
	const vehicle = getCachedVehicles().find((v) => v.tripId === tripId) ?? null;
	const gpsInferredDelay = inferDelayFromVehiclePosition(
		scheduledRows,
		stops,
		vehicle,
		dublinSecondsSinceMidnight(),
	);
	return mergeTripStops(
		tripId,
		scheduledRows,
		liveTrip,
		stops,
		shapeId,
		gpsInferredDelay,
	);
}

// "Stale" flag attached to each returned vehicle: true when the trip NTA has
// tagged this bus with is clearly over (scheduled last stop + latest reported
// delay + 15 min buffer is in the past). We DON'T hide these — the app's core
// purpose is showing what's on the road. The client uses the flag to swap in
// a Puca marker ("Puca took this bus") so users can recognise at a glance
// that the popup's schedule may be for a completed trip, not the one the bus
// is actually running. Genuinely late buses keep reporting growing delays
// that push the effective end forward, so they stay non-stale until truly done.
const ENDED_TRIP_BUFFER_SEC = 15 * 60;

function isTripEnded(
	operator: Operator,
	tripId: string,
	nowSec: number,
	tripUpdates: RawTripUpdateMap,
): boolean {
	const lastStopSec = getTripLastStopSec(operator, tripId);
	if (lastStopSec === null) return false; // unknown trip → keep (conservative)

	// Shift the effective end time forward by the latest reported delay so
	// genuinely late buses are protected — their TripUpdate keeps reporting
	// larger delays as they run behind, pushing the end past `now`. Stale
	// predictions (trip actually ended but NTA didn't clear TripUpdates) leave
	// small/old delays that don't save them once `now` rolls past.
	const live = tripUpdates.get(tripId);
	let endDelay = 0;
	if (live) {
		let maxSeq = -1;
		for (const stu of live.stopTimeUpdates) {
			if (stu.arrivalDelaySec !== null && stu.sequence > maxSeq) {
				maxSeq = stu.sequence;
				endDelay = stu.arrivalDelaySec;
			}
		}
	}

	return nowSec > lastStopSec + endDelay + ENDED_TRIP_BUFFER_SEC;
}

export async function getBusVehiclesByRoute(
	operator: Operator,
	shortName: string,
	direction?: number,
): Promise<BusVehicle[]> {
	const routes = operatorRoutes[operator];
	const route = routes.find(
		(r) => r.shortName.toLowerCase() === shortName.toLowerCase(),
	);
	if (!route) return [];

	const all = getCachedVehicles({ refreshIfStale: true });
	const shapeMap = getTripShapeMap(operator);
	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	const nowSec = dublinSecondsSinceMidnight();

	const result: BusVehicle[] = [];
	for (const v of all) {
		if (v.routeId !== route.id) continue;
		if (direction !== undefined && v.directionId !== direction) continue;
		const stale = isTripEnded(operator, v.tripId, nowSec, tripUpdates);
		result.push({
			...v,
			routeShortName: route.shortName,
			shapeId: shapeMap.get(v.tripId) ?? null,
			stale,
		});
	}
	return result;
}

export async function getAllBusVehicles(
	operator: Operator,
): Promise<BusVehicle[]> {
	const routes = operatorRoutes[operator];
	const routeIdToShortName = new Map<string, string>();
	for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

	const all = getCachedVehicles({ refreshIfStale: true });
	const shapeMap = getTripShapeMap(operator);
	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	const nowSec = dublinSecondsSinceMidnight();

	const result: BusVehicle[] = [];
	for (const v of all) {
		const shortName = routeIdToShortName.get(v.routeId);
		if (!shortName) continue;
		const stale = isTripEnded(operator, v.tripId, nowSec, tripUpdates);
		result.push({
			...v,
			routeShortName: shortName,
			shapeId: shapeMap.get(v.tripId) ?? null,
			stale,
		});
	}
	return result;
}

const stopArrivalsStmtMap = new Map<
	Operator,
	ReturnType<Database["prepare"]>
>();

export type StopArrivalDecision =
	| { keep: false }
	| {
			keep: true;
			etaSec: number;
			delaySec: number;
			vehicleSeq: number | null;
			etaSource: "nta" | "gps-inferred" | "schedule";
	  };

// Pure per-row decision used by getBusStopArrivals. Extracted so the filter
// rules can be unit-tested without mocking SQLite, NTA, or the date clock.
// GPS-first: when we have a vehicle ping, its closest-stop sequence is the
// authoritative "where is the bus" signal. NTA's stopTimeUpdates is fallback.
export function decideStopArrival(
	row: { stop_sequence: number; arrival_sec: number },
	live: LiveTripData,
	vehicle: { lat: number; lng: number } | null,
	tripStopCoords: TripStopPoint[],
	nowSec: number,
): StopArrivalDecision {
	const closestStop = findClosestTripStop(vehicle, tripStopCoords);
	const vehicleSeq = closestStop?.sequence ?? null;
	const vehicleScheduledArrivalSec = closestStop?.arrivalSec ?? null;
	const sortedUpdates = sortedStopTimeUpdates(live.stopTimeUpdates);

	if (vehicleSeq !== null) {
		if (vehicleSeq > row.stop_sequence) return { keep: false };
	} else if (
		sortedUpdates.length > 0 &&
		(sortedUpdates[0] as NonNullable<(typeof sortedUpdates)[number]>).sequence >
			row.stop_sequence
	) {
		return { keep: false };
	}

	const gpsInferredDelay =
		vehicleSeq !== null && vehicleScheduledArrivalSec !== null
			? {
					fromSequence: vehicleSeq,
					delaySec: Math.max(0, nowSec - vehicleScheduledArrivalSec),
				}
			: null;
	const timing = computeArrivalTiming({
		arrivalSec: row.arrival_sec,
		sequence: row.stop_sequence,
		live: { ...live, stopTimeUpdates: sortedUpdates },
		gpsInferredDelay,
		nowSec,
		delayFallbackMode: "forward-if-no-prior",
	});
	const delaySec = timing.delaySec ?? 0;
	let etaSec = timing.etaSec ?? row.arrival_sec - nowSec;
	if (etaSec < 0) {
		if (vehicleSeq !== null && vehicleSeq <= row.stop_sequence) {
			etaSec = 0;
		} else {
			return { keep: false };
		}
	}

	return { keep: true, etaSec, delaySec, vehicleSeq, etaSource: timing.source };
}

// SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999. Chunk well below that
// so a single hot stop won't blow past the parameter limit.
const BATCH_TRIP_CHUNK = 500;

function getBatchTripScheduledStops(
	operator: Operator,
	tripIds: string[],
): Map<string, ScheduledRow[]> {
	if (tripIds.length === 0) return new Map();
	const db = getScheduleDb(operator);
	if (!db) return new Map();
	const map = new Map<string, ScheduledRow[]>();

	for (let i = 0; i < tripIds.length; i += BATCH_TRIP_CHUNK) {
		const chunk = tripIds.slice(i, i + BATCH_TRIP_CHUNK);
		try {
			const placeholders = chunk.map(() => "?").join(",");
			const stmt = db.prepare(
				`SELECT trip_id, stop_sequence, stop_id, arrival_sec FROM stop_times WHERE trip_id IN (${placeholders}) ORDER BY trip_id, stop_sequence`,
			);
			const rows = stmt.all(...chunk) as {
				trip_id: string;
				stop_sequence: number;
				stop_id: string;
				arrival_sec: number;
			}[];
			for (const r of rows) {
				let arr = map.get(r.trip_id);
				if (!arr) {
					arr = [];
					map.set(r.trip_id, arr);
				}
				arr.push({
					sequence: r.stop_sequence,
					stopId: r.stop_id,
					arrivalSec: r.arrival_sec,
				});
			}
		} catch {
			// Chunk batch failed → fall back to individual queries so these
			// trips still get GPS-aware arrival logic instead of NTA-only.
			for (const tid of chunk) {
				const stops = getTripScheduledStops(operator, tid);
				if (stops.length > 0) map.set(tid, stops);
			}
		}
	}
	return map;
}

export type BusStopArrival = {
	tripId: string;
	routeShortName: string;
	headsign: string;
	etaSeconds: number;
	delaySec: number;
	stopSequence: number;
	stopsAway: number | null;
	etaSource: "nta" | "gps-inferred" | "schedule";
	direction: string;
	// "running" — trip has a live vehicle_position, can be focused on the map.
	// "scheduled" — NTA has a trip_update prediction but the bus hasn't reported
	// its GPS yet (usually pre-departure). Frontend greys these out.
	status: "running" | "scheduled";
};

export async function getBusStopArrivals(
	operator: Operator,
	stopId: string,
	limit = 15,
): Promise<BusStopArrival[]> {
	if (!operatorStops[operator][stopId]) return [];
	const db = getScheduleDb(operator);
	if (!db) return [];

	if (!stopArrivalsStmtMap.has(operator)) {
		try {
			stopArrivalsStmtMap.set(
				operator,
				db.prepare(
					"SELECT trip_id, stop_sequence, arrival_sec FROM stop_times WHERE stop_id = ?",
				),
			);
		} catch {
			return [];
		}
	}
	const stmt = stopArrivalsStmtMap.get(operator)!;
	let rows: { trip_id: string; stop_sequence: number; arrival_sec: number }[];
	try {
		rows = stmt.all(stopId) as typeof rows;
	} catch {
		return [];
	}

	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	const nowSec = dublinSecondsSinceMidnight();

	// Map tripId → live GPS. Used as ground truth for "is the bus past my stop"
	// because NTA's stopTimeUpdates can drop earlier stops based on schedule
	// alone — when a bus runs late, NTA may strip stops that the bus hasn't
	// actually reached yet, causing the trip to disappear from arrivals.
	const vehicleByTripId = new Map<string, GtfsVehiclePosition>();
	for (const v of getCachedVehicles()) {
		if (v.tripId) vehicleByTripId.set(v.tripId, v);
	}

	const routes = operatorRoutes[operator];
	const shapes = operatorShapes[operator];
	const stopsDict = operatorStops[operator];
	const routeIdToShortName = new Map<string, string>();
	for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

	// Filter to live, non-ended trips first — only these are arrival candidates.
	// This prunes the 6k-row set down to a few hundred before the batch query,
	// keeping the batch result small and avoiding wasted work on ended trips.
	const activeRows = rows.filter((r) => {
		const live = tripUpdates.get(r.trip_id);
		if (!live) return false;
		return !isTripEnded(operator, r.trip_id, nowSec, tripUpdates);
	});

	// Collect vehicle-equipped trip IDs (deduped) from the pruned set, then
	// fetch all trip stops in one batched query instead of N individual calls.
	const vehicleTripIds = new Set<string>();
	for (const r of activeRows) {
		if (vehicleByTripId.has(r.trip_id)) {
			vehicleTripIds.add(r.trip_id);
		}
	}
	const tripStopsMap = getBatchTripScheduledStops(operator, [
		...vehicleTripIds,
	]);

	const candidates: BusStopArrival[] = [];
	for (const r of activeRows) {
		const live = tripUpdates.get(r.trip_id)!;

		// Build trip stop coords from the pre-fetched batch lookup. Vehicles
		// without cached stops (DB missing) fall back to empty coords — decision
		// uses NTA stopTimeUpdates alone.
		const vehicle = vehicleByTripId.get(r.trip_id);
		let tripStopCoords: Array<{
			sequence: number;
			lat: number;
			lng: number;
			arrivalSec: number;
		}> = [];
		if (vehicle) {
			const tripStops = tripStopsMap.get(r.trip_id);
			if (tripStops) {
				tripStopCoords = tripStops.flatMap((ts) => {
					const s = stopsDict[ts.stopId];
					return s
						? [
								{
									sequence: ts.sequence,
									lat: s.lat,
									lng: s.lng,
									arrivalSec: ts.arrivalSec,
								},
							]
						: [];
				});
			}
		}

		const decision = decideStopArrival(
			r,
			live,
			vehicle ?? null,
			tripStopCoords,
			nowSec,
		);
		if (!decision.keep) continue;
		const { etaSec, delaySec, vehicleSeq, etaSource } = decision;

		const routeId = live.routeId;
		const directionId = live.directionId;
		if (!routeId) continue;

		const shortName = routeIdToShortName.get(routeId);
		if (!shortName) continue;

		const dirKey = String(directionId);
		const routeShape = shapes[routeId];
		const headsign =
			routeShape?.[dirKey]?.headsign ??
			routeShape?.["0"]?.headsign ??
			shortName;

		candidates.push({
			tripId: r.trip_id,
			routeShortName: shortName,
			headsign,
			etaSeconds: etaSec,
			delaySec,
			stopSequence: r.stop_sequence,
			stopsAway:
				vehicleSeq === null ? null : Math.max(0, r.stop_sequence - vehicleSeq),
			etaSource,
			direction: dirKey,
			status: vehicleByTripId.has(r.trip_id) ? "running" : "scheduled",
		});
	}

	candidates.sort((a, b) => a.etaSeconds - b.etaSeconds);
	return candidates.slice(0, limit);
}

export function getTrainRouteShape(
	origin: string,
	destination: string,
): {
	headsign: string;
	coords: [number, number][];
	stops: { id: string; name: string; lat: number; lng: number }[];
} | null {
	const key = `${origin.trim().toLowerCase()}|${destination.trim().toLowerCase()}`;
	const endpoints = trainEndpoints as unknown as Record<
		string,
		{ routeId: string; directionId: number }
	>;
	const match = endpoints[key];
	if (!match) return null;

	const shapes = trainShapes as unknown as Record<
		string,
		Record<
			string,
			{
				headsign: string;
				shapeId: string;
				coords: [number, number][];
				stops: { id: string; name: string; lat: number; lng: number }[];
			}
		>
	>;

	const routeShapes = shapes[match.routeId];
	if (!routeShapes) return null;
	const shape = routeShapes[String(match.directionId)];
	if (!shape) return null;

	return { headsign: shape.headsign, coords: shape.coords, stops: shape.stops };
}

// Two-level shape map for the bulk client endpoint:
//   endpoints: 156 endpoint pair keys -> routeKey (deduped reference)
//   shapes:    36 unique shapes by routeKey, only `coords` (the only field the client uses)
// Avoids the 4× duplication that would happen if every endpoint pair carried its own coords.
// Pre-computed at module load — zero cost per request.
const allTrainShapesPayload: {
	endpoints: Record<string, string>;
	shapes: Record<string, { coords: [number, number][] }>;
} = (() => {
	const endpointsOut: Record<string, string> = {};
	const shapesOut: Record<string, { coords: [number, number][] }> = {};
	const endpoints = trainEndpoints as unknown as Record<
		string,
		{ routeId: string; directionId: number }
	>;
	const shapes = trainShapes as unknown as Record<
		string,
		Record<string, { coords: [number, number][] }>
	>;
	for (const [pairKey, { routeId, directionId }] of Object.entries(endpoints)) {
		const shape = shapes[routeId]?.[String(directionId)];
		if (!shape) continue;
		const routeKey = `${routeId}|${directionId}`;
		endpointsOut[pairKey] = routeKey;
		if (!shapesOut[routeKey]) {
			shapesOut[routeKey] = { coords: shape.coords };
		}
	}
	return { endpoints: endpointsOut, shapes: shapesOut };
})();

export function getAllTrainShapes() {
	return allTrainShapesPayload;
}
