import { errToMeta, log } from "../logger";
import type { BusVehicle, BusOperator as Operator } from "../types";
import { isInServiceHours } from "../utils";
import { getBusRoutes, getTripLastStopSec, getTripShapeMap } from "./schedules";
import type { RawTripUpdateMap } from "./tripUpdates";
import { getCachedTripUpdates } from "./tripUpdates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// NTA config
// ---------------------------------------------------------------------------

const NTA_VEHICLES_URL =
	"https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json";
export const NTA_MIN_INTERVAL_MS = 35_000;
const NTA_FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Cache + rate gate
// ---------------------------------------------------------------------------

let vehicleCache: GtfsVehiclePosition[] | null = null;
let lastVehicleCall = 0;
let vehicleCacheUpdatedAt = 0;
let vehicleRefreshPromise: Promise<void> | null = null;

export function resetRealtimeStateForTest(): void {
	vehicleCache = null;
	lastVehicleCall = 0;
	vehicleCacheUpdatedAt = 0;
	vehicleRefreshPromise = null;
}

export function seedRealtimeStateForTest({
	vehicles,
	lastVehicleCallMs = 0,
}: {
	vehicles?: GtfsVehiclePosition[];
	lastVehicleCallMs?: number;
}): void {
	if (vehicles !== undefined) {
		vehicleCache = vehicles;
		vehicleCacheUpdatedAt = Date.now();
	}
	lastVehicleCall = lastVehicleCallMs;
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

export function getGtfsrVehiclePositions(): GtfsVehiclePosition[] {
	return getCachedVehicles({ refreshIfStale: true });
}

// ---------------------------------------------------------------------------
// Vehicle enrichment (route short name, shapeId, stale flag)
// ---------------------------------------------------------------------------

const ENDED_TRIP_BUFFER_SEC = 15 * 60;

function isTripEnded(
	operator: Operator,
	tripId: string,
	nowSec: number,
	tripUpdates: RawTripUpdateMap,
): boolean {
	const lastStopSec = getTripLastStopSec(operator, tripId);
	if (lastStopSec === null) return false;

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
	const routes = getBusRoutes(operator);
	const route = routes.find(
		(r) => r.shortName.toLowerCase() === shortName.toLowerCase(),
	);
	if (!route) return [];

	const all = getCachedVehicles({ refreshIfStale: true });
	const shapeMap = getTripShapeMap(operator);
	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	const nowSec =
		new Date().getHours() * 3600 +
		new Date().getMinutes() * 60 +
		new Date().getSeconds();

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
	const routes = getBusRoutes(operator);
	const routeIdToShortName = new Map<string, string>();
	for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

	const all = getCachedVehicles({ refreshIfStale: true });
	const shapeMap = getTripShapeMap(operator);
	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	const nowSec =
		new Date().getHours() * 3600 +
		new Date().getMinutes() * 60 +
		new Date().getSeconds();

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

// ---------------------------------------------------------------------------
// Background polling
// ---------------------------------------------------------------------------

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

	const { startTripUpdatesPolling, NTA_TRIP_UPDATES_INTERVAL_MS } =
		require("./tripUpdates") as typeof import("./tripUpdates");

	tickVehicles();
	setTimeout(startTripUpdatesPolling, 5_000);

	setInterval(tickVehicles, NTA_MIN_INTERVAL_MS);
	setTimeout(
		() => setInterval(startTripUpdatesPolling, NTA_TRIP_UPDATES_INTERVAL_MS),
		7_000,
	);

	log.info("nta.background_polling.started", {
		vehicles_interval_ms: NTA_MIN_INTERVAL_MS,
		trip_updates_interval_ms: NTA_TRIP_UPDATES_INTERVAL_MS,
	});
}

export function getBackgroundPollingStarted(): boolean {
	return backgroundPollingStarted;
}

export function getVehicleCacheInfo(now = Date.now()) {
	return {
		count: vehicleCache?.length ?? 0,
		ageSec:
			vehicleCacheUpdatedAt <= 0
				? null
				: Math.max(0, Math.round((now - vehicleCacheUpdatedAt) / 1000)),
		lastAttemptAgeSec:
			lastVehicleCall <= 0
				? null
				: Math.max(0, Math.round((now - lastVehicleCall) / 1000)),
		intervalMs: NTA_MIN_INTERVAL_MS,
	};
}
