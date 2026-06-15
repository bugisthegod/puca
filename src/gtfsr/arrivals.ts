import type { Database } from "bun:sqlite";
import type { BusOperator as Operator } from "../types";
import {
	getScheduleDb,
	getTripLastStopSec,
	getTripScheduledStops,
	operatorRoutes,
	operatorShapes,
	operatorStops,
	type ScheduledRow,
} from "./schedules";
import {
	computeArrivalTiming,
	findClosestTripStop,
	type LiveTripData,
	normalizeGtfsNowSec,
	sortedStopTimeUpdates,
	type TripStopPoint,
} from "./timing";

type StopArrivalRow = {
	trip_id: string;
	stop_sequence: number;
	arrival_sec: number;
};

export type BusArrivalVehicle = {
	tripId: string;
	routeId: string;
	directionId: number;
	lat: number;
	lng: number;
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
	// "running" - trip has a live vehicle_position, can be focused on the map.
	// "scheduled" - NTA has a trip_update prediction but the bus hasn't reported
	// its GPS yet (usually pre-departure). Frontend greys these out.
	status: "running" | "scheduled";
};

export type BusStopArrivalsInput = {
	operator: Operator;
	stopId: string;
	limit?: number;
	tripUpdates: ReadonlyMap<string, LiveTripData>;
	vehicles: readonly BusArrivalVehicle[];
	nowSec: number;
};

// Shared "trip is over" rule. Vehicle markers use this as a stale flag and
// still render the bus; stop arrivals use it to suppress completed trips.
// Latest reported delay shifts the effective end forward, so genuinely late
// buses stay eligible until their delayed trip has actually finished.
const ENDED_TRIP_BUFFER_SEC = 15 * 60;

export function isTripEndedByLastStopSec(
	lastStopSec: number | null,
	live: LiveTripData | undefined,
	nowSec: number,
): boolean {
	if (lastStopSec === null) return false; // unknown trip -> keep (conservative)

	// Shift the effective end time forward by the latest reported delay so
	// genuinely late buses are protected - their TripUpdate keeps reporting
	// larger delays as they run behind, pushing the end past `now`. Stale
	// predictions (trip actually ended but NTA didn't clear TripUpdates) leave
	// small/old delays that don't save them once `now` rolls past.
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

	const effectiveEndSec = lastStopSec + endDelay;
	return (
		normalizeGtfsNowSec(lastStopSec, nowSec) >
		effectiveEndSec + ENDED_TRIP_BUFFER_SEC
	);
}

export function isTripEnded(
	operator: Operator,
	tripId: string,
	nowSec: number,
	tripUpdates: ReadonlyMap<string, LiveTripData>,
): boolean {
	const lastStopSec = getTripLastStopSec(operator, tripId);
	const live = tripUpdates.get(tripId);
	return isTripEndedByLastStopSec(lastStopSec, live, nowSec);
}

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
					delaySec: Math.max(
						0,
						normalizeGtfsNowSec(vehicleScheduledArrivalSec, nowSec) -
							vehicleScheduledArrivalSec,
					),
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
	let etaSec =
		timing.etaSec ??
		row.arrival_sec - normalizeGtfsNowSec(row.arrival_sec, nowSec);
	if (etaSec < 0) {
		if (vehicleSeq !== null && vehicleSeq <= row.stop_sequence) {
			etaSec = 0;
		} else {
			return { keep: false };
		}
	}

	return { keep: true, etaSec, delaySec, vehicleSeq, etaSource: timing.source };
}

export function decideScheduleVehicleArrival(
	row: { stop_sequence: number; arrival_sec: number },
	vehicle: { lat: number; lng: number } | null,
	tripStopCoords: TripStopPoint[],
	nowSec: number,
): StopArrivalDecision {
	const closestStop = findClosestTripStop(vehicle, tripStopCoords);
	const vehicleSeq = closestStop?.sequence ?? null;
	const vehicleScheduledArrivalSec = closestStop?.arrivalSec ?? null;

	if (vehicleSeq === null) return { keep: false };
	if (vehicleSeq > row.stop_sequence) return { keep: false };

	const gpsInferredDelay =
		vehicleScheduledArrivalSec !== null
			? {
					fromSequence: vehicleSeq,
					delaySec: Math.max(
						0,
						normalizeGtfsNowSec(vehicleScheduledArrivalSec, nowSec) -
							vehicleScheduledArrivalSec,
					),
				}
			: null;
	const timing = computeArrivalTiming({
		arrivalSec: row.arrival_sec,
		sequence: row.stop_sequence,
		live: undefined,
		gpsInferredDelay,
		nowSec,
		delayFallbackMode: "prior-only",
	});
	const delaySec = timing.delaySec ?? 0;
	let etaSec =
		timing.etaSec ??
		row.arrival_sec - normalizeGtfsNowSec(row.arrival_sec, nowSec);
	if (etaSec < 0) {
		etaSec = 0;
	}

	return { keep: true, etaSec, delaySec, vehicleSeq, etaSource: timing.source };
}

export function shouldConsiderStopArrivalTrip(
	operator: Operator,
	tripId: string,
	hasVehicle: boolean,
	tripUpdates: ReadonlyMap<string, LiveTripData>,
	nowSec: number,
): boolean {
	const live = tripUpdates.get(tripId);
	if (!live && !hasVehicle) return false;
	if (isTripEnded(operator, tripId, nowSec, tripUpdates)) return false;
	return true;
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
			// Chunk batch failed -> fall back to individual queries so these
			// trips still get GPS-aware arrival logic instead of NTA-only.
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
	ReturnType<Database["prepare"]>
>();

export async function getBusStopArrivals({
	operator,
	stopId,
	limit = 15,
	tripUpdates,
	vehicles,
	nowSec,
}: BusStopArrivalsInput): Promise<BusStopArrival[]> {
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
	let rows: StopArrivalRow[];
	try {
		rows = stmt.all(stopId) as StopArrivalRow[];
	} catch {
		return [];
	}

	// Map tripId -> live GPS. Used as ground truth for "is the bus past my stop"
	// because NTA's stopTimeUpdates can drop earlier stops based on schedule
	// alone - when a bus runs late, NTA may strip stops that the bus hasn't
	// actually reached yet, causing the trip to disappear from arrivals.
	const vehicleByTripId = new Map<string, BusArrivalVehicle>();
	for (const v of vehicles) {
		if (v.tripId) vehicleByTripId.set(v.tripId, v);
	}

	const routes = operatorRoutes[operator];
	const shapes = operatorShapes[operator];
	const stopsDict = operatorStops[operator];
	const routeIdToShortName = new Map<string, string>();
	for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

	// Filter to realtime trips that are not clearly ended. GPS-only trips remain
	// fallback candidates when the schedule DB cannot prove they are over; NTA
	// sometimes emits a vehicle position without the matching per-stop prediction.
	const activeRows = rows.filter((r) => {
		return shouldConsiderStopArrivalTrip(
			operator,
			r.trip_id,
			vehicleByTripId.has(r.trip_id),
			tripUpdates,
			nowSec,
		);
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
		const live = tripUpdates.get(r.trip_id);

		// Build trip stop coords from the pre-fetched batch lookup. Vehicles
		// without cached stops (DB missing) fall back to empty coords - decision
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

		const decision = live
			? decideStopArrival(r, live, vehicle ?? null, tripStopCoords, nowSec)
			: decideScheduleVehicleArrival(
					r,
					vehicle ?? null,
					tripStopCoords,
					nowSec,
				);
		if (!decision.keep) continue;
		const { etaSec, delaySec, vehicleSeq, etaSource } = decision;

		const routeId = live?.routeId || vehicle?.routeId;
		const directionId = live?.directionId ?? vehicle?.directionId ?? 0;
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
