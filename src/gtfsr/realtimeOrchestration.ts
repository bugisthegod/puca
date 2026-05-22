import { errToMeta, log } from "../logger";
import { REALTIME_AGE_HEADER, REALTIME_STATUS_HEADER } from "../realtime";
import type { BusOperator as Operator, RealtimeHealth } from "../types";
import { OPERATORS } from "../types";
import { isInServiceHours } from "../utils";
import { getDbHealth } from "./schedules";
import {
	getBusTripUpdateRealtimeHealth as getTripUpdateCacheHealth,
	getTripUpdateCacheMeta,
	NTA_TRIP_UPDATES_INTERVAL_MS,
	refreshTripUpdatesIfDue,
} from "./tripUpdates";
import {
	getBusVehicleCacheHealth,
	getVehicleCacheMeta,
	NTA_VEHICLES_INTERVAL_MS,
	refreshVehiclesIfDue,
} from "./vehicles";

let backgroundPollingStarted = false;

function warnIfTickDelayed({
	event,
	intervalMs,
	lastTickAt,
}: {
	event: string;
	intervalMs: number;
	lastTickAt: number;
}): void {
	if (lastTickAt === 0) return;
	const elapsedMs = Date.now() - lastTickAt;
	if (elapsedMs <= intervalMs * 2) return;
	log.warn(event, {
		elapsed_ms: elapsedMs,
		interval_ms: intervalMs,
		delay_ms: elapsedMs - intervalMs,
	});
}

export function startBackgroundPolling(): void {
	if (backgroundPollingStarted) return;
	backgroundPollingStarted = true;
	let lastVehicleTickAt = 0;
	let lastTripUpdateTickAt = 0;

	const tickVehicles = () => {
		if (!isInServiceHours("bus")) return;
		warnIfTickDelayed({
			event: "nta.vehicles.tick_delayed",
			intervalMs: NTA_VEHICLES_INTERVAL_MS,
			lastTickAt: lastVehicleTickAt,
		});
		lastVehicleTickAt = Date.now();
		void refreshVehiclesIfDue().catch((err) =>
			log.error("nta.background_vehicles_failed", errToMeta(err)),
		);
	};
	const tickTripUpdates = () => {
		if (!isInServiceHours("bus")) return;
		warnIfTickDelayed({
			event: "nta.trip_updates.tick_delayed",
			intervalMs: NTA_TRIP_UPDATES_INTERVAL_MS,
			lastTickAt: lastTripUpdateTickAt,
		});
		lastTripUpdateTickAt = Date.now();
		void refreshTripUpdatesIfDue().catch((err) =>
			log.error("nta.background_trip_updates_failed", errToMeta(err)),
		);
	};

	// Pre-warm both caches immediately on boot so the first user request after a
	// restart doesn't wait 35s for vehicles. Stagger TripUpdates by 5s so the
	// initial pair doesn't hit NTA in the same tick.
	tickVehicles();
	setTimeout(tickTripUpdates, 5_000);

	// Vehicles is the higher-priority stream (live GPS positions) -> 35s cadence.
	setInterval(tickVehicles, NTA_VEHICLES_INTERVAL_MS);
	// TripUpdates offset by 7s. With V=35s and TU=75s, gcd=5 so TU drifts through
	// 7 positions relative to V over ~4min. Phase doesn't really matter for NTA
	// rate limits (it's per-minute count, not spacing) - this offset just keeps
	// the very first interval-driven TU call ~12s away from the first V tick.
	setTimeout(
		() => setInterval(tickTripUpdates, NTA_TRIP_UPDATES_INTERVAL_MS),
		7_000,
	);

	log.info("nta.background_polling.started", {
		vehicles_interval_ms: NTA_VEHICLES_INTERVAL_MS,
		trip_updates_interval_ms: NTA_TRIP_UPDATES_INTERVAL_MS,
	});
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
	return getBusVehicleCacheHealth(now);
}

export function getBusTripUpdateRealtimeHealth(
	now = Date.now(),
): RealtimeHealth {
	return getTripUpdateCacheHealth(now);
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
	const vehicleMeta = getVehicleCacheMeta(now);
	const tripUpdateMeta = getTripUpdateCacheMeta(now);
	const dbEntries = await Promise.all(
		OPERATORS.map(
			async (operator) => [operator, await getDbHealth(operator)] as const,
		),
	);

	return {
		backgroundPollingStarted,
		nta: {
			vehicles: {
				count: vehicleMeta.count,
				ageSec: vehicleMeta.ageSec,
				lastAttemptAgeSec: vehicleMeta.lastAttemptAgeSec,
				intervalMs: vehicleMeta.intervalMs,
			},
			tripUpdates: {
				count: tripUpdateMeta.count,
				ageSec: tripUpdateMeta.ageSec,
				lastAttemptAgeSec: tripUpdateMeta.lastAttemptAgeSec,
				intervalMs: tripUpdateMeta.intervalMs,
			},
		},
		db: Object.fromEntries(dbEntries) as GtfsrHealthSnapshot["db"],
	};
}
