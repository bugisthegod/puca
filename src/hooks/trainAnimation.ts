import { alongLookup } from "./routeProjection";
import type { TrainMarkerEntry } from "./useTrainMarkers";

const TRAIN_EXTRAP_BUFFER_METERS = 5000;
const EXTRAP_CAP = 35_000;
const BLEND_DURATION = 1500;

export function tickTrainMarker(entry: TrainMarkerEntry, now: number): void {
	if (
		!entry.offRoute &&
		entry.routeLine &&
		entry.routeLookup &&
		entry.routeLengthMeters !== null &&
		entry.distanceAtPing !== null &&
		entry.targetDistanceAlongRoute !== null &&
		entry.lastPingTime !== null
	) {
		const dtSec = (now - entry.lastPingTime) / 1000;
		const advanced = entry.distanceAtPing + entry.pathSpeedMps * dtSec;
		const capped = Math.min(
			advanced,
			entry.targetDistanceAlongRoute + TRAIN_EXTRAP_BUFFER_METERS,
		);
		const clamped = Math.max(0, Math.min(capped, entry.routeLengthMeters));
		const [lat, lng] = alongLookup(entry.routeLookup, clamped);
		entry.marker.setLatLng([lat, lng]);
		return;
	}

	// Velocity fallback (unmapped routes / off-route)
	const dt = Math.min(now - entry.lastUpdateTime, EXTRAP_CAP);
	const extrapLat = entry.targetLat + entry.velocityLat * dt;
	const extrapLng = entry.targetLng + entry.velocityLng * dt;
	const blendElapsed = now - entry.correctionStartTime;
	if (blendElapsed < BLEND_DURATION) {
		const t = blendElapsed / BLEND_DURATION;
		const ease = 1 - (1 - t) * (1 - t);
		const lat =
			entry.correctionFromLat + (extrapLat - entry.correctionFromLat) * ease;
		const lng =
			entry.correctionFromLng + (extrapLng - entry.correctionFromLng) * ease;
		entry.marker.setLatLng([lat, lng]);
	} else {
		entry.marker.setLatLng([extrapLat, extrapLng]);
	}
}
