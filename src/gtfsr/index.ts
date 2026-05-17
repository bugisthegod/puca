import trainEndpoints from "../data/train-routes-by-endpoints.json" with {
	type: "json",
};
import trainShapes from "../data/train-shapes.json" with { type: "json" };

// NOTE: `require()` is used (not `import`) in `getGtfsrHealthSnapshot` and
// `__testing` to break circular dependencies between vehicles.ts ↔ tripUpdates.ts.
// The module graph is:
//   schedules.ts ← vehicles.ts ↔ tripUpdates.ts ← arrivals.ts
// Dynamic require defers resolution until runtime, avoiding the cycle.

// ---------------------------------------------------------------------------
// Bus exports (re-export from submodules)
// ---------------------------------------------------------------------------

export type { BusStopArrival, StopArrivalDecision } from "./arrivals";
export {
	decideStopArrival,
	getBusStopArrivals,
} from "./arrivals";
export type {
	BusRoute,
	BusRouteDirectionShape,
	BusVariant,
	Operator,
	StopSearchResult,
} from "./schedules";
export {
	getBusRouteShape,
	getBusRoutes,
	getDbHealth,
	getOperatorStop,
	getTripLastStopSec,
	getTripScheduledStops,
	getTripShapeId,
	getTripShapeMap,
	OPERATORS,
	operatorStops,
	searchAllBusStops,
	searchBusStops,
} from "./schedules";
export type {
	ArrivalTiming,
	ArrivalTimingSource,
	GpsInferredDelay,
	LiveTripData,
	TripStopPoint,
} from "./timing";
export type {
	ScheduledRow,
	StopTimeUpdate,
	TripUpdate,
} from "./tripUpdates";
export {
	getBusTripStops,
	getCachedTripUpdates,
	mergeTripStops,
	resetRealtimeStateForTest as resetTripUpdatesStateForTest,
	seedRealtimeStateForTest as seedTripUpdatesStateForTest,
	startTripUpdatesPolling,
} from "./tripUpdates";
export type { GtfsVehiclePosition } from "./vehicles";
export {
	getAllBusVehicles,
	getBackgroundPollingStarted,
	getBusVehiclesByRoute,
	getCachedVehicles,
	getGtfsrVehiclePositions,
	getVehicleCacheInfo,
	resetRealtimeStateForTest as resetVehiclesStateForTest,
	seedRealtimeStateForTest as seedVehiclesStateForTest,
	startBackgroundPolling,
} from "./vehicles";

// Health snapshot (combines data from vehicles, tripUpdates, schedules)
export async function getGtfsrHealthSnapshot(now = Date.now()): Promise<{
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
		import("./schedules").Operator,
		{ status: "connected" | "available" | "missing" | "error" }
	>;
}> {
	const { getBackgroundPollingStarted, getVehicleCacheInfo } =
		require("./vehicles") as typeof import("./vehicles");
	const { getTripUpdatesCacheInfo } =
		require("./tripUpdates") as typeof import("./tripUpdates");
	const { OPERATORS, getDbHealth } =
		require("./schedules") as typeof import("./schedules");

	const dbEntries = await Promise.all(
		OPERATORS.map(
			async (operator) => [operator, await getDbHealth(operator)] as const,
		),
	);

	const vInfo = getVehicleCacheInfo(now);
	const tInfo = getTripUpdatesCacheInfo(now);

	return {
		backgroundPollingStarted: getBackgroundPollingStarted(),
		nta: {
			vehicles: {
				count: vInfo.count,
				ageSec: vInfo.ageSec,
				lastAttemptAgeSec: vInfo.lastAttemptAgeSec,
				intervalMs: vInfo.intervalMs,
			},
			tripUpdates: {
				count: tInfo.count,
				ageSec: tInfo.ageSec,
				lastAttemptAgeSec: tInfo.lastAttemptAgeSec,
				intervalMs: tInfo.intervalMs,
			},
		},
		db: Object.fromEntries(dbEntries) as Record<
			import("./schedules").Operator,
			{ status: "connected" | "available" | "missing" | "error" }
		>,
	};
}

// Combined test helper that resets both caches
export const __testing = {
	resetRealtimeState() {
		const { resetRealtimeStateForTest: resetV } =
			require("./vehicles") as typeof import("./vehicles");
		const { resetRealtimeStateForTest: resetT } =
			require("./tripUpdates") as typeof import("./tripUpdates");
		resetV();
		resetT();
	},
	seedRealtimeState({
		vehicles,
		tripUpdates,
		lastVehicleCallMs = 0,
		lastTripUpdateCallMs = 0,
	}: {
		vehicles?: import("./vehicles").GtfsVehiclePosition[];
		tripUpdates?: import("./tripUpdates").RawTripUpdateMap;
		lastVehicleCallMs?: number;
		lastTripUpdateCallMs?: number;
	}) {
		const { seedRealtimeStateForTest: seedV } =
			require("./vehicles") as typeof import("./vehicles");
		const { seedRealtimeStateForTest: seedT } =
			require("./tripUpdates") as typeof import("./tripUpdates");
		seedV({ vehicles, lastVehicleCallMs });
		seedT({ tripUpdates, lastTripUpdateCallMs });
	},
};

// ---------------------------------------------------------------------------
// Train shape exports
// ---------------------------------------------------------------------------

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
