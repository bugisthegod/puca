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
import type { BusRoute, BusOperator as Operator } from "../types";
import { OPERATORS } from "../types";

// ---------------------------------------------------------------------------
// Operator data sets
// ---------------------------------------------------------------------------

type StopsDict = Record<
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

export type BusVariant = {
	shapeId: string;
	tripCount: number;
	branches: [number, number][][];
};
type VariantsDict = Record<string, { [direction: string]: BusVariant[] }>;

const operatorRoutes: Record<Operator, BusRoute[]> = {
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

const operatorVariants: Record<Operator, VariantsDict> = {
	dublinbus: dublinBusVariants as unknown as VariantsDict,
	buseireann: {} as VariantsDict,
	goahead: {} as VariantsDict,
};

// ---------------------------------------------------------------------------
// SQLite schedule DB — per-operator, lazily opened
// ---------------------------------------------------------------------------

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
	const cached = scheduleDbMap.get(operator);
	if (cached !== undefined) return cached;
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
): { sequence: number; stopId: string; arrivalSec: number }[] {
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

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export type { BusOperator as Operator, BusRoute } from "../types";
export { OPERATORS } from "../types";

export function getBusRoutes(operator: Operator): BusRoute[] {
	return operatorRoutes[operator];
}

export type BusRouteDirectionShape = {
	headsign: string;
	coords: [number, number][];
	stops: { id: string; name: string; lat: number; lng: number }[];
	variants: BusVariant[];
};

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

export type StopSearchResult = {
	id: string;
	name: string;
	code: string;
	lat: number;
	lng: number;
	operator: Operator;
};

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

export async function getDbHealth(
	operator: Operator,
): Promise<{ status: "connected" | "available" | "missing" | "error" }> {
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
