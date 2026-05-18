import { errToMeta, log } from "../logger";
import type { BusVehicle, RealtimeHealth } from "../types";
import { isInServiceHours } from "../utils";

const NTA_VEHICLES_URL =
	"https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json";

// Vehicles at strict 30s started getting NTA 429s ~25% of the time (quota
// appears to be ~3 calls/60s sliding window across V + TU). 35s drops the
// V rate to 1.7/min while staying close to the "every 30s" target.
export const NTA_VEHICLES_INTERVAL_MS = 35_000;
export const NTA_VEHICLES_STALE_AFTER_SEC = 150;
// NTA occasionally accepts the connection but takes many seconds to respond.
// User requests never await these fetches, but bounding background work keeps
// the polling cadence and connection pool from getting dragged around by a
// single slow upstream response.
const NTA_FETCH_TIMEOUT_MS = 5_000;

export type GtfsVehiclePosition = Omit<
	BusVehicle,
	"routeShortName" | "shapeId" | "stale"
>;

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

let vehicleCache: GtfsVehiclePosition[] | null = null;
let lastVehicleCall = 0;
let vehicleCacheUpdatedAt = 0;
let vehicleRefreshPromise: Promise<void> | null = null;

function ageSec(timestampMs: number, now: number): number | null {
	if (timestampMs <= 0) return null;
	return Math.max(0, Math.round((now - timestampMs) / 1000));
}

function statusFromAge(
	age: number | null,
	staleAfterSec: number,
): RealtimeHealth["status"] {
	if (age === null) return "unavailable";
	if (age > staleAfterSec) return "stale";
	return "ok";
}

export function resetVehicleCacheForTest(): void {
	vehicleCache = null;
	lastVehicleCall = 0;
	vehicleCacheUpdatedAt = 0;
	vehicleRefreshPromise = null;
}

export function seedVehicleCacheForTest({
	vehicles,
	lastVehicleCallMs = 0,
	vehicleUpdatedAtMs,
}: {
	vehicles?: GtfsVehiclePosition[];
	lastVehicleCallMs?: number;
	vehicleUpdatedAtMs?: number;
}): void {
	if (vehicles !== undefined) {
		vehicleCache = vehicles;
		vehicleCacheUpdatedAt = vehicleUpdatedAtMs ?? Date.now();
	}
	lastVehicleCall = lastVehicleCallMs;
}

export function getVehicleCacheMeta(now = Date.now()): {
	count: number;
	ageSec: number | null;
	lastAttemptAgeSec: number | null;
	intervalMs: number;
	updatedAtMs: number;
	lastAttemptAtMs: number;
} {
	return {
		count: vehicleCache?.length ?? 0,
		ageSec: ageSec(vehicleCacheUpdatedAt, now),
		lastAttemptAgeSec: ageSec(lastVehicleCall, now),
		intervalMs: NTA_VEHICLES_INTERVAL_MS,
		updatedAtMs: vehicleCacheUpdatedAt,
		lastAttemptAtMs: lastVehicleCall,
	};
}

export function getBusVehicleCacheHealth(now = Date.now()): RealtimeHealth {
	const vehicleAge = ageSec(vehicleCacheUpdatedAt, now);
	return {
		status: statusFromAge(vehicleAge, NTA_VEHICLES_STALE_AFTER_SEC),
		ageSec: vehicleAge,
	};
}

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

export async function refreshVehiclesIfDue(): Promise<void> {
	if (!isInServiceHours("bus")) return;
	if (Date.now() - lastVehicleCall < NTA_VEHICLES_INTERVAL_MS) {
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

export function getCachedVehicles({
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
