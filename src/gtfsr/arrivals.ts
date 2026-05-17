import type { BusOperator as Operator } from "../types";
import { dublinSecondsSinceMidnight } from "../utils";
import {
	getBusRoutes,
	getScheduleDb,
	getTripLastStopSec,
	getTripScheduledStops,
	operatorShapes,
	operatorStops,
} from "./schedules";
import {
	computeArrivalTiming,
	findClosestTripStop,
	type LiveTripData,
	sortedStopTimeUpdates,
	type TripStopPoint,
} from "./timing";
import type { ScheduledRow } from "./tripUpdates";
import { getCachedTripUpdates } from "./tripUpdates";
import { type GtfsVehiclePosition, getCachedVehicles } from "./vehicles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
	status: "running" | "scheduled";
};

export type StopArrivalDecision =
	| { keep: false }
	| {
			keep: true;
			etaSec: number;
			delaySec: number;
			vehicleSeq: number | null;
			etaSource: "nta" | "gps-inferred" | "schedule";
	  };

// ---------------------------------------------------------------------------
// Arrival decision logic (pure, testable)
// ---------------------------------------------------------------------------

// Pure per-row decision used by getBusStopArrivals. Extracted so the filter
// rules can be unit-tested without mocking SQLite, NTA, or the date clock.
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

// ---------------------------------------------------------------------------
// Stop arrivals endpoint
// ---------------------------------------------------------------------------

const ENDED_TRIP_BUFFER_SEC = 15 * 60;

function isTripEnded(
	operator: Operator,
	tripId: string,
	nowSec: number,
	tripUpdates: Map<
		string,
		{
			stopTimeUpdates: Array<{
				arrivalDelaySec: number | null;
				sequence: number;
			}>;
		}
	>,
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

// SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999. Chunk well below that.
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
			for (const tid of chunk) {
				const stops = getTripScheduledStops(operator, tid);
				if (stops.length > 0) map.set(tid, stops);
			}
		}
	}
	return map;
}

const stopArrivalsStmtMap = new Map<
	Operator,
	ReturnType<import("bun:sqlite").Database["prepare"]>
>();

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
	const stmt = stopArrivalsStmtMap.get(operator);
	if (!stmt) return [];
	let rows: { trip_id: string; stop_sequence: number; arrival_sec: number }[];
	try {
		rows = stmt.all(stopId) as typeof rows;
	} catch {
		return [];
	}

	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	const nowSec = dublinSecondsSinceMidnight();

	const vehicleByTripId = new Map<string, GtfsVehiclePosition>();
	for (const v of getCachedVehicles()) {
		if (v.tripId) vehicleByTripId.set(v.tripId, v);
	}

	const routes = getBusRoutes(operator);
	const stopsDict = operatorStops[operator];
	const routeIdToShortName = new Map<string, string>();
	for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

	const activeRows = rows.filter((r) => {
		const live = tripUpdates.get(r.trip_id);
		if (!live) return false;
		return !isTripEnded(
			operator,
			r.trip_id,
			nowSec,
			tripUpdates as Map<
				string,
				{
					stopTimeUpdates: Array<{
						arrivalDelaySec: number | null;
						sequence: number;
					}>;
				}
			>,
		);
	});

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
		const live = tripUpdates.get(r.trip_id);
		if (!live) continue;

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
			live as unknown as LiveTripData,
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
		const routeShape = operatorShapes[operator]?.[routeId];
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
