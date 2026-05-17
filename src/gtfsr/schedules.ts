import { Database } from "bun:sqlite";
import busEireannRoutes from "../data/buseireann-routes.json" with {
	type: "json",
};
import busEireannShapes from "../data/buseireann-shapes.json" with {
	type: "json",
};
import busEireannStops from "../data/buseireann-stops.json" with {
	type: "json",
};
import dublinBusRoutes from "../data/dublinbus-routes.json" with {
	type: "json",
};
import dublinBusShapes from "../data/dublinbus-shapes.json" with {
	type: "json",
};
import dublinBusStops from "../data/dublinbus-stops.json" with { type: "json" };
import dublinBusVariants from "../data/dublinbus-variants.json" with {
	type: "json",
};
import goAheadRoutes from "../data/goahead-routes.json" with { type: "json" };
import goAheadShapes from "../data/goahead-shapes.json" with { type: "json" };
import goAheadStops from "../data/goahead-stops.json" with { type: "json" };
import { errToMeta, log } from "../logger";
import type { BusRoute, BusVariant, BusOperator as Operator } from "../types";
import { OPERATORS } from "../types";

export type StopsDict = Record<
	string,
	{ name: string; lat: number; lng: number; code?: string }
>;
type ShapesDict = Record<
	string,
	{
		[direction: string]: {
			headsign: string;
			coords: [number, number][];
			stops: { id: string; name: string; lat: number; lng: number }[];
		};
	}
>;
type VariantsDict = Record<string, { [direction: string]: BusVariant[] }>;

export type BusRouteDirectionShape = {
	headsign: string;
	coords: [number, number][];
	stops: { id: string; name: string; lat: number; lng: number }[];
	variants: BusVariant[];
};

export type ScheduledRow = {
	sequence: number;
	stopId: string;
	arrivalSec: number;
};

export type StopSearchResult = {
	id: string;
	name: string;
	code: string;
	lat: number;
	lng: number;
	operator: Operator;
};

export type ScheduleDbHealth = {
	status: "available" | "connected" | "error" | "missing";
};

export const operatorRoutes: Record<Operator, BusRoute[]> = {
	dublinbus: dublinBusRoutes as BusRoute[],
	buseireann: busEireannRoutes as BusRoute[],
	goahead: goAheadRoutes as BusRoute[],
};

export const operatorShapes: Record<Operator, ShapesDict> = {
	dublinbus: dublinBusShapes as unknown as ShapesDict,
	buseireann: busEireannShapes as unknown as ShapesDict,
	goahead: goAheadShapes as unknown as ShapesDict,
};

export const operatorStops: Record<Operator, StopsDict> = {
	dublinbus: dublinBusStops as StopsDict,
	buseireann: busEireannStops as StopsDict,
	goahead: goAheadStops as StopsDict,
};

// Variants are only generated for Dublin Bus today; other operators return [].
const operatorVariants: Record<Operator, VariantsDict> = {
	dublinbus: dublinBusVariants as unknown as VariantsDict,
	buseireann: {} as VariantsDict,
	goahead: {} as VariantsDict,
};

const DB_DIR = process.env.BUS_DB_DIR ?? "./src/data";
const DB_PATHS: Record<Operator, string> = {
	dublinbus: `${DB_DIR}/bus-schedule.db`,
	buseireann: `${DB_DIR}/buseireann-schedule.db`,
	goahead: `${DB_DIR}/goahead-schedule.db`,
};

const scheduleDbMap = new Map<Operator, Database | null>();
const scheduledStopsStmtMap = new Map<
	Operator,
	ReturnType<Database["prepare"]>
>();

export function getScheduleDb(operator: Operator): Database | null {
	if (scheduleDbMap.has(operator)) return scheduleDbMap.get(operator) ?? null;
	// Open read-write first so we can create the stop_id index on cold start
	// (needed for the stop-arrivals endpoint). Falls back to read-only if the
	// filesystem is read-only (e.g. Fly volume), in which case arrivals-by-stop
	// queries degrade to slow table scans — we accept that rather than fail boot.
	try {
		const db = new Database(DB_PATHS[operator], {
			readwrite: true,
			create: false,
		});
		try {
			db.exec(
				"CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id)",
			);
		} catch (err) {
			log.warn("schedule_db.index_create_failed", {
				operator,
				...errToMeta(err),
			});
		}
		scheduleDbMap.set(operator, db);
		return db;
	} catch {
		try {
			const db = new Database(DB_PATHS[operator], { readonly: true });
			scheduleDbMap.set(operator, db);
			return db;
		} catch {
			scheduleDbMap.set(operator, null);
			return null;
		}
	}
}

export function getTripScheduledStops(
	operator: Operator,
	tripId: string,
): ScheduledRow[] {
	const db = getScheduleDb(operator);
	if (!db) return [];
	try {
		if (!scheduledStopsStmtMap.has(operator)) {
			scheduledStopsStmtMap.set(
				operator,
				db.prepare(
					"SELECT stop_sequence, stop_id, arrival_sec FROM stop_times WHERE trip_id = ? ORDER BY stop_sequence",
				),
			);
		}
		const stmt = scheduledStopsStmtMap.get(operator);
		if (!stmt) return [];
		const rows = stmt.all(tripId) as {
			stop_sequence: number;
			stop_id: string;
			arrival_sec: number;
		}[];
		return rows.map((r) => ({
			sequence: r.stop_sequence,
			stopId: r.stop_id,
			arrivalSec: r.arrival_sec,
		}));
	} catch {
		return [];
	}
}

const tripShapeStmtMap = new Map<Operator, ReturnType<Database["prepare"]>>();

export function getTripShapeId(
	operator: Operator,
	tripId: string,
): string | null {
	const db = getScheduleDb(operator);
	if (!db) return null;
	try {
		if (!tripShapeStmtMap.has(operator)) {
			tripShapeStmtMap.set(
				operator,
				db.prepare("SELECT shape_id FROM trips WHERE trip_id = ?"),
			);
		}
		const row = tripShapeStmtMap.get(operator)?.get(tripId) as
			| { shape_id?: string }
			| undefined;
		return row?.shape_id ?? null;
	} catch {
		return null;
	}
}

const lastStopSecStmtMap = new Map<Operator, ReturnType<Database["prepare"]>>();

// Lightweight lookup for the stale-trip flag — we only need the last stop's
// arrival time, not the full stop list (which getTripScheduledStops returns).
export function getTripLastStopSec(
	operator: Operator,
	tripId: string,
): number | null {
	const db = getScheduleDb(operator);
	if (!db) return null;
	try {
		if (!lastStopSecStmtMap.has(operator)) {
			lastStopSecStmtMap.set(
				operator,
				db.prepare(
					"SELECT arrival_sec FROM stop_times WHERE trip_id = ? ORDER BY stop_sequence DESC LIMIT 1",
				),
			);
		}
		const row = lastStopSecStmtMap.get(operator)?.get(tripId) as
			| { arrival_sec?: number }
			| undefined;
		return row?.arrival_sec ?? null;
	} catch {
		return null;
	}
}

// Preloaded trip_id → shape_id map, built once per operator. /api/bus/vehicles
// enriches every vehicle with shapeId on each poll, so we want this O(1) in
// memory rather than N SQLite calls per request. ~56k entries (~1.7 MB) for
// Dublin Bus. Empty map for operators without a trips table — degrades
// gracefully (vehicles get shapeId: null, variant filter ignores them).
const tripShapeMapCache = new Map<Operator, Map<string, string>>();

export function getTripShapeMap(operator: Operator): Map<string, string> {
	const cached = tripShapeMapCache.get(operator);
	if (cached) return cached;
	const map = new Map<string, string>();
	const db = getScheduleDb(operator);
	if (db) {
		try {
			const rows = db.prepare("SELECT trip_id, shape_id FROM trips").all() as {
				trip_id: string;
				shape_id: string;
			}[];
			for (const r of rows) map.set(r.trip_id, r.shape_id);
		} catch {
			// trips table may not exist on operators where it hasn't been generated yet
		}
	}
	tripShapeMapCache.set(operator, map);
	return map;
}

export async function getDbHealth(
	operator: Operator,
): Promise<ScheduleDbHealth> {
	const cached = scheduleDbMap.get(operator);
	if (cached) {
		try {
			cached.query("SELECT 1").get();
			return { status: "connected" };
		} catch {
			return { status: "error" };
		}
	}

	try {
		const exists = await Bun.file(DB_PATHS[operator]).exists();
		if (cached === null) return { status: exists ? "error" : "missing" };
		return { status: exists ? "available" : "missing" };
	} catch {
		return { status: "error" };
	}
}

export function getBusRoutes(operator: Operator): BusRoute[] {
	return operatorRoutes[operator];
}

export function getBusRouteShape(
	operator: Operator,
	shortName: string,
): { [direction: string]: BusRouteDirectionShape } | null {
	const routes = operatorRoutes[operator];
	const shapes = operatorShapes[operator];
	const variants = operatorVariants[operator];
	const route = routes.find(
		(r) => r.shortName.toLowerCase() === shortName.toLowerCase(),
	);
	if (!route) return null;
	const shape = shapes[route.id];
	if (!shape) return null;
	const routeVariants = variants[route.id] ?? {};
	const out: { [direction: string]: BusRouteDirectionShape } = {};
	for (const [dir, data] of Object.entries(shape)) {
		out[dir] = {
			headsign: data.headsign,
			coords: data.coords,
			stops: data.stops,
			variants: routeVariants[dir] ?? [],
		};
	}
	return out;
}

export function getOperatorStop(
	operator: Operator,
	stopId: string,
): { name: string; lat: number; lng: number; code?: string } | null {
	return operatorStops[operator][stopId] ?? null;
}

export function searchBusStops(
	operator: Operator,
	query: string,
	limit = 10,
): StopSearchResult[] {
	const stops = operatorStops[operator];
	const q = query.trim();
	if (!q) return [];
	const out: StopSearchResult[] = [];
	// Exact ID match first — lets session/favorite rehydration round-trip a
	// stopId back to a full StopSearchResult without a separate endpoint.
	const direct = stops[q];
	if (direct) {
		out.push({
			id: q,
			name: direct.name,
			code: direct.code ?? "",
			lat: direct.lat,
			lng: direct.lng,
			operator,
		});
	}
	const isDigits = /^\d+$/.test(q);
	if (isDigits) {
		for (const [id, s] of Object.entries(stops)) {
			if (s.code && s.code === q)
				out.push({
					id,
					name: s.name,
					code: s.code,
					lat: s.lat,
					lng: s.lng,
					operator,
				});
			if (out.length >= limit) break;
		}
		if (out.length < limit) {
			for (const [id, s] of Object.entries(stops)) {
				if (out.find((r) => r.id === id)) continue;
				if (s.code?.startsWith(q))
					out.push({
						id,
						name: s.name,
						code: s.code,
						lat: s.lat,
						lng: s.lng,
						operator,
					});
				if (out.length >= limit) break;
			}
		}
		return out;
	}
	const qLower = q.toLowerCase();
	for (const [id, s] of Object.entries(stops)) {
		if (s.name.toLowerCase().startsWith(qLower)) {
			out.push({
				id,
				name: s.name,
				code: s.code ?? "",
				lat: s.lat,
				lng: s.lng,
				operator,
			});
			if (out.length >= limit) break;
		}
	}
	return out;
}

// Cross-operator stop search. Each operator gets its own per-call limit so a
// dense match in one operator's stops can't starve the others — the user
// typing "1234" should see Dublin Bus 1234, Bus Éireann 1234, Go-Ahead 1234
// in the same dropdown rather than the first one that fills the cap.
export function searchAllBusStops(
	query: string,
	perOperatorLimit = 5,
): StopSearchResult[] {
	const out: StopSearchResult[] = [];
	for (const op of OPERATORS) {
		out.push(...searchBusStops(op, query, perOperatorLimit));
	}
	return out;
}
