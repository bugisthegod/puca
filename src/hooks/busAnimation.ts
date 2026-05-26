import { alongLookup } from "./routeProjection";
import type { BusMarkerEntry } from "./useBusMarkers";

export type BusAnimationDurationStrategy = (
	prevTimestamp: number,
	nextTimestamp: number,
	realtimeAgeSec: number | null,
	tripId: string,
) => number;

// Returns the marker's currently rendered distance along its route, lerped
// between prevDistance and currentDistance per the active animation window.
// Used both at ping arrival (to seed the next animation's prev) and in RAF.
export function computeBusCurrentDistance(
	entry: BusMarkerEntry,
	now: number,
): number | null {
	if (entry.currentDistance === null) return null;
	if (
		entry.prevDistance === null ||
		entry.animStartPerfMs === null ||
		entry.animDurationMs <= 0
	) {
		return entry.currentDistance;
	}
	const t = Math.max(
		0,
		Math.min(1, (now - entry.animStartPerfMs) / entry.animDurationMs),
	);
	return entry.prevDistance + (entry.currentDistance - entry.prevDistance) * t;
}

export function clearBusRouteLine(
	entry: BusMarkerEntry,
	bus: { lat: number; lng: number },
	now: number,
): void {
	const cur = entry.marker.getLatLng();
	entry.routeLine = null;
	entry.routeLookup = null;
	entry.routeLengthMeters = null;
	entry.offRoute = true;
	entry.prevDistance = null;
	entry.currentDistance = null;
	entry.animStartPerfMs = null;
	entry.correctionFromLat = cur.lat;
	entry.correctionFromLng = cur.lng;
	entry.correctionStartTime = now;
	entry.targetLat = bus.lat;
	entry.targetLng = bus.lng;
	entry.settled = false;
	entry.lastRenderedDistance = null;
}

export function tickBusMarker(entry: BusMarkerEntry, now: number): void {
	// On-route: lerp between prevDistance (where the marker was at last ping)
	// and currentDistance (latest GPS projection) over the fixed animation
	// window. After t hits 1 the marker sits at currentDistance.
	if (!entry.offRoute && entry.routeLookup && entry.currentDistance !== null) {
		const dist = computeBusCurrentDistance(entry, now);
		if (dist === null) return;
		if (entry.lastRenderedDistance === dist) return;
		const [lat, lng] = alongLookup(entry.routeLookup, dist);
		entry.marker.setLatLng([lat, lng]);
		entry.lastRenderedDistance = dist;
		return;
	}

	// Off-route fallback: blend lat/lng over BLEND_DURATION, then settle.
	if (entry.settled) return;
	const blendElapsed = now - entry.correctionStartTime;
	if (blendElapsed < 1500) {
		const t = blendElapsed / 1500;
		const ease = 1 - (1 - t) * (1 - t);
		const lat =
			entry.correctionFromLat +
			(entry.targetLat - entry.correctionFromLat) * ease;
		const lng =
			entry.correctionFromLng +
			(entry.targetLng - entry.correctionFromLng) * ease;
		entry.marker.setLatLng([lat, lng]);
	} else {
		entry.marker.setLatLng([entry.targetLat, entry.targetLng]);
		entry.settled = true;
	}
}
