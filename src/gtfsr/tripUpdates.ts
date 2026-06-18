import { errToMeta, log } from "../logger";
import type { RealtimeHealth } from "../types";
import { isInServiceHours } from "../utils";
import { ageSec, statusFromAge } from "./realtimeHealth";
import type { LiveTripData } from "./timing";

const NTA_TRIP_UPDATES_URL =
	"https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json";

// Trip updates (schedule + delays per stop) change much slower than GPS positions.
// 75s lands in the 60-90s ideal range while staying out of phase with the 35s
// vehicles cycle.
export const NTA_TRIP_UPDATES_INTERVAL_MS = 75_000;
export const NTA_TRIP_UPDATES_STALE_AFTER_SEC = 300;
// NTA occasionally accepts the connection but takes many seconds to respond.
// User requests never await these fetches, but bounding background work keeps
// the polling cadence and connection pool from getting dragged around by a
// single slow upstream response.
const NTA_FETCH_TIMEOUT_MS = 5_000;
const NTA_REFRESH_WATCHDOG_MS = NTA_FETCH_TIMEOUT_MS * 2;

export type RawTripUpdate = LiveTripData & {
	tripId: string;
};

export type RawTripUpdateMap = Map<string, RawTripUpdate>;

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

let tripUpdateCache: RawTripUpdateMap | null = null;
let lastTripUpdateCall = 0;
let tripUpdateCacheUpdatedAt = 0;
let tripUpdateRefreshPromise: Promise<void> | null = null;
let latestTripUpdateRefreshId = 0;

export function resetTripUpdateCacheForTest(): void {
	tripUpdateCache = null;
	lastTripUpdateCall = 0;
	tripUpdateCacheUpdatedAt = 0;
	tripUpdateRefreshPromise = null;
	latestTripUpdateRefreshId = 0;
}

export function seedTripUpdateCacheForTest({
	tripUpdates,
	lastTripUpdateCallMs = 0,
	tripUpdateUpdatedAtMs,
}: {
	tripUpdates?: RawTripUpdateMap;
	lastTripUpdateCallMs?: number;
	tripUpdateUpdatedAtMs?: number;
}): void {
	if (tripUpdates !== undefined) {
		tripUpdateCache = tripUpdates;
		tripUpdateCacheUpdatedAt = tripUpdateUpdatedAtMs ?? Date.now();
	}
	lastTripUpdateCall = lastTripUpdateCallMs;
}

export function getTripUpdateCacheMeta(now = Date.now()): {
	count: number;
	ageSec: number | null;
	lastAttemptAgeSec: number | null;
	intervalMs: number;
	updatedAtMs: number;
	lastAttemptAtMs: number;
} {
	return {
		count: tripUpdateCache?.size ?? 0,
		ageSec: ageSec(tripUpdateCacheUpdatedAt, now),
		lastAttemptAgeSec: ageSec(lastTripUpdateCall, now),
		intervalMs: NTA_TRIP_UPDATES_INTERVAL_MS,
		updatedAtMs: tripUpdateCacheUpdatedAt,
		lastAttemptAtMs: lastTripUpdateCall,
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

async function fetchTripUpdates(refreshId: number): Promise<void> {
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

			// Store raw stop IDs only - name resolution is operator-aware and done at read time.
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

		if (refreshId !== latestTripUpdateRefreshId) {
			log.warn("nta.trip_updates.stale_refresh_ignored", {
				trip_count: map.size,
				duration_ms,
			});
			return;
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

function withTripUpdateRefreshWatchdog(refresh: Promise<void>): Promise<void> {
	const startedAt = Date.now();
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			log.warn("nta.trip_updates.refresh_watchdog_timeout", {
				duration_ms: Date.now() - startedAt,
				watchdog_ms: NTA_REFRESH_WATCHDOG_MS,
				stale_cache_size: tripUpdateCache?.size ?? 0,
			});
			resolve();
		}, NTA_REFRESH_WATCHDOG_MS);
		timeout.unref?.();

		refresh.then(
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				resolve();
			},
			(err) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				reject(err);
			},
		);
	});
}

export async function refreshTripUpdatesIfDue(): Promise<void> {
	if (!isInServiceHours("bus")) return;
	if (Date.now() - lastTripUpdateCall < NTA_TRIP_UPDATES_INTERVAL_MS) {
		return;
	}
	if (tripUpdateRefreshPromise) return tripUpdateRefreshPromise;
	lastTripUpdateCall = Date.now();
	const refreshId = ++latestTripUpdateRefreshId;
	let refreshPromise: Promise<void>;
	refreshPromise = withTripUpdateRefreshWatchdog(
		fetchTripUpdates(refreshId),
	).finally(() => {
		if (tripUpdateRefreshPromise === refreshPromise) {
			tripUpdateRefreshPromise = null;
		}
	});
	tripUpdateRefreshPromise = refreshPromise;
	return tripUpdateRefreshPromise;
}

function triggerTripUpdatesRefreshIfStale(): void {
	void refreshTripUpdatesIfDue().catch((err) =>
		log.error("nta.trip_updates.refresh_failed", errToMeta(err)),
	);
}

export function getCachedTripUpdates({
	refreshIfStale = false,
}: {
	refreshIfStale?: boolean;
} = {}): RawTripUpdateMap {
	if (!isInServiceHours("bus")) {
		return new Map();
	}
	if (refreshIfStale) triggerTripUpdatesRefreshIfStale();
	return tripUpdateCache ?? new Map();
}
