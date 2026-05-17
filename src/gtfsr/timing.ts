export type LiveTripData = {
	routeId: string;
	directionId: number;
	stopTimeUpdates: Array<{
		sequence: number;
		stopId: string;
		arrivalDelaySec: number | null;
		departureDelaySec: number | null;
		scheduleRelationship: string;
	}>;
};

export type GpsInferredDelay = { fromSequence: number; delaySec: number };
export type ArrivalTimingSource = "nta" | "gps-inferred" | "schedule";
export type ArrivalTiming = {
	delaySec: number | null;
	expectedArrivalSec: number | null;
	etaSec: number | null;
	source: ArrivalTimingSource;
};
export type TripStopPoint = {
	sequence: number;
	lat: number;
	lng: number;
	arrivalSec?: number;
};
type DelayFallbackMode = "prior-only" | "forward-if-no-prior";

export function sortedStopTimeUpdates(
	stopTimeUpdates: LiveTripData["stopTimeUpdates"],
): LiveTripData["stopTimeUpdates"] {
	return [...stopTimeUpdates].sort((a, b) => a.sequence - b.sequence);
}

export function findClosestTripStop(
	vehicle: { lat: number; lng: number } | null,
	tripStopCoords: TripStopPoint[],
): TripStopPoint | null {
	if (!vehicle) return null;
	let closest: TripStopPoint | null = null;
	let minDistSq = Infinity;
	for (const ts of tripStopCoords) {
		// Raw degree² rather than meters² — fine for picking the closest stop
		// along a single trip (relative order is preserved as long as stops are
		// roughly collinear). Would need cos(lat) scaling for cross-route nearest-
		// vehicle matching.
		const dLat = ts.lat - vehicle.lat;
		const dLng = ts.lng - vehicle.lng;
		const d = dLat * dLat + dLng * dLng;
		if (d < minDistSq) {
			minDistSq = d;
			closest = ts;
		}
	}
	return closest;
}

export function getPropagatedDelay(
	stopTimeUpdates: LiveTripData["stopTimeUpdates"],
	sequence: number,
	fallbackMode: DelayFallbackMode,
): number | null {
	let propagated: number | null = null;
	for (const stu of sortedStopTimeUpdates(stopTimeUpdates)) {
		if (stu.arrivalDelaySec === null) continue;
		if (stu.sequence <= sequence) propagated = stu.arrivalDelaySec;
		else if (fallbackMode === "forward-if-no-prior" && propagated === null) {
			propagated = stu.arrivalDelaySec;
			break;
		} else break;
	}
	return propagated;
}

export function computeArrivalTiming({
	arrivalSec,
	sequence,
	live,
	gpsInferredDelay,
	nowSec,
	delayFallbackMode,
}: {
	arrivalSec: number;
	sequence: number;
	live: LiveTripData | undefined;
	gpsInferredDelay: GpsInferredDelay | null;
	nowSec: number | null;
	delayFallbackMode: DelayFallbackMode;
}): ArrivalTiming {
	const ntaDelay = live
		? getPropagatedDelay(live.stopTimeUpdates, sequence, delayFallbackMode)
		: null;
	const inferredDelay =
		gpsInferredDelay && sequence >= gpsInferredDelay.fromSequence
			? gpsInferredDelay.delaySec
			: null;
	const delaySec = ntaDelay ?? inferredDelay;
	const source: ArrivalTimingSource =
		ntaDelay !== null
			? "nta"
			: inferredDelay !== null
				? "gps-inferred"
				: "schedule";
	const expectedArrivalSec = delaySec !== null ? arrivalSec + delaySec : null;
	const etaSec =
		nowSec === null ? null : (expectedArrivalSec ?? arrivalSec) - nowSec;
	return { delaySec, expectedArrivalSec, etaSec, source };
}
