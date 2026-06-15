import type { BusOperator as Operator } from "../types";
import { dublinSecondsSinceMidnight } from "../utils";
import {
	getTripScheduledStops,
	getTripShapeId,
	operatorStops,
	type ScheduledRow,
	type StopsDict,
} from "./schedules";
import {
	computeArrivalTiming,
	findClosestTripStop,
	type GpsInferredDelay,
	type LiveTripData,
	normalizeGtfsNowSec,
	type TripStopPoint,
} from "./timing";
import type { RawTripUpdateMap } from "./tripUpdates";
import type { GtfsVehiclePosition } from "./vehicles";

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

	// DB not available or trip not in DB - return live data with nulls for scheduled.
	if (!liveTrip) return null;
	const fallbackLiveTrip = liveTrip;
	const fallbackStops: StopTimeUpdate[] = fallbackLiveTrip.stopTimeUpdates.map(
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
		routeId: fallbackLiveTrip.routeId,
		directionId: fallbackLiveTrip.directionId,
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
		delaySec: Math.max(
			0,
			normalizeGtfsNowSec(best.arrivalSec, nowSec) - best.arrivalSec,
		),
	};
}

export function getBusTripStopsFromCache({
	operator,
	tripId,
	tripUpdates,
	vehicles,
	nowSec = dublinSecondsSinceMidnight(),
}: {
	operator: Operator;
	tripId: string;
	tripUpdates: RawTripUpdateMap;
	vehicles: readonly GtfsVehiclePosition[];
	nowSec?: number;
}): TripUpdate | null {
	const stops = operatorStops[operator];
	const liveTrip = tripUpdates.get(tripId);
	const scheduledRows = getTripScheduledStops(operator, tripId);
	const shapeId = getTripShapeId(operator, tripId);
	const vehicle = vehicles.find((v) => v.tripId === tripId) ?? null;
	const gpsInferredDelay = inferDelayFromVehiclePosition(
		scheduledRows,
		stops,
		vehicle,
		nowSec,
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
