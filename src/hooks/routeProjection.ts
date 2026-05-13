// Pure route-math helpers shared by train and bus marker hooks.
// No React imports — no closures over any hook state.

import { lineString } from "@turf/helpers";
import length from "@turf/length";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import type { Feature, LineString } from "geojson";

export type { Feature, LineString };
export { length, lineString };

// ---------------------------------------------------------------------------
// buildRouteLine
// ---------------------------------------------------------------------------

// Build a Turf LineString + total length from shape coords ([lat,lng] format
// from the API).  Turf requires [lng,lat], so we swap.
export function buildRouteLine(
	coords: [number, number][],
): { routeLine: Feature<LineString>; routeLengthMeters: number } | null {
	if (coords.length < 2) return null;
	try {
		const turfCoords = coords.map(
			([lat, lng]) => [lng, lat] as [number, number],
		);
		const line = lineString(turfCoords);
		const km = length(line, { units: "kilometers" });
		return { routeLine: line, routeLengthMeters: km * 1000 };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// buildRouteLookup / alongLookup
// ---------------------------------------------------------------------------

// Equirectangular approximation — accurate to <0.1% for short segments,
// orders of magnitude faster than Haversine for the precompute step.
function segmentLengthM(
	lat0: number,
	lng0: number,
	lat1: number,
	lng1: number,
): number {
	const R = 6_371_000;
	const dLat = (lat1 - lat0) * (Math.PI / 180);
	const dLng = (lng1 - lng0) * (Math.PI / 180);
	const midLat = ((lat0 + lat1) / 2) * (Math.PI / 180);
	const x = dLng * Math.cos(midLat) * R;
	const y = dLat * R;
	return Math.sqrt(x * x + y * y);
}

const LOOKUP_SAMPLE_M = 10;

// Precompute a flat Float64Array of [dist, lat, lng] triples sampled every
// LOOKUP_SAMPLE_M metres along the route.  Called once per route shape.
export function buildRouteLookup(
	routeLine: Feature<LineString>,
): Float64Array | null {
	const coords = routeLine.geometry.coordinates; // [lng, lat][]
	if (coords.length < 2) return null;

	const cum: number[] = [0];
	for (let i = 1; i < coords.length; i++) {
		const c0 = coords[i - 1]!;
		const c1 = coords[i]!;
		cum.push(cum[i - 1]! + segmentLengthM(c0[1]!, c0[0]!, c1[1]!, c1[0]!));
	}
	const totalM = cum[coords.length - 1]!;
	if (totalM < 1) return null;

	const maxSamples = Math.ceil(totalM / LOOKUP_SAMPLE_M) + 2;
	const buf = new Float64Array(maxSamples * 3);
	let idx = 0;
	let ci = 0;

	for (let d = 0; d <= totalM; d += LOOKUP_SAMPLE_M) {
		while (ci < coords.length - 2 && cum[ci + 1]! <= d) ci++;
		const c0 = coords[ci]!;
		const c1 = coords[ci + 1]!;
		const segLen = cum[ci + 1]! - cum[ci]!;
		const t = segLen > 0 ? (d - cum[ci]!) / segLen : 0;
		buf[idx * 3] = d;
		buf[idx * 3 + 1] = c0[1]! + t * (c1[1]! - c0[1]!);
		buf[idx * 3 + 2] = c0[0]! + t * (c1[0]! - c0[0]!);
		idx++;
	}

	// Always include the exact route endpoint.
	if (idx === 0 || buf[(idx - 1) * 3]! < totalM - 1e-6) {
		const cEnd = coords[coords.length - 1]!;
		buf[idx * 3] = totalM;
		buf[idx * 3 + 1] = cEnd[1]!;
		buf[idx * 3 + 2] = cEnd[0]!;
		idx++;
	}

	return buf.subarray(0, idx * 3);
}

// Binary-search the lookup table and lerp between the two nearest samples.
// Returns [lat, lng].  O(log n) — replaces turf's O(n) along() in the RAF loop.
export function alongLookup(
	lookup: Float64Array,
	distanceMeters: number,
): [number, number] {
	const n = lookup.length / 3;
	if (n === 0) return [0, 0];

	const totalM = lookup[(n - 1) * 3]!;
	const d = Math.max(0, Math.min(distanceMeters, totalM));

	let lo = 0;
	let hi = n - 1;
	while (lo < hi - 1) {
		const mid = (lo + hi) >>> 1;
		if (lookup[mid * 3]! <= d) lo = mid;
		else hi = mid;
	}

	const d0 = lookup[lo * 3]!;
	const lat0 = lookup[lo * 3 + 1]!;
	const lng0 = lookup[lo * 3 + 2]!;
	if (lo >= n - 1) return [lat0, lng0];

	const d1 = lookup[hi * 3]!;
	if (d1 <= d0) return [lat0, lng0];

	const t = (d - d0) / (d1 - d0);
	return [
		lat0 + t * (lookup[hi * 3 + 1]! - lat0),
		lng0 + t * (lookup[hi * 3 + 2]! - lng0),
	];
}

// ---------------------------------------------------------------------------
// projectOntoRoute
// ---------------------------------------------------------------------------

// Project a vehicle GPS position onto the route line. Returns the new path
// state fields, or { offRoute: true } if the point is too far or an error
// occurs.
//   offRouteMeters: threshold beyond which we consider the point off-route
//     (150 for buses, 500 for trains whose station coords can be approximate)
//   maxSpeedMps:    clamp for derived speed (25 m/s for buses, 50 for trains)
//   defaultSpeedMps: used when there is no previous ping delta (trains pass
//     15 m/s so the marker keeps creeping between station updates; buses 0).
export function projectOntoRoute(
	vehicleLat: number,
	vehicleLng: number,
	routeLine: Feature<LineString>,
	routeLengthMeters: number,
	prevTargetDistance: number | null,
	prevPingTime: number | null,
	now: number,
	offRouteMeters: number = 150,
	maxSpeedMps: number = 25,
	defaultSpeedMps: number = 0,
):
	| {
			offRoute: false;
			targetDistanceAlongRoute: number;
			pathSpeedMps: number;
			lastPingTime: number;
	  }
	| { offRoute: true } {
	try {
		const pt = nearestPointOnLine(routeLine, [vehicleLng, vehicleLat], {
			units: "kilometers",
		});
		const distFromLineKm: number = pt.properties?.dist ?? Infinity;
		if (distFromLineKm * 1000 > offRouteMeters) return { offRoute: true };

		const locationKm: number = pt.properties?.location ?? 0;
		const newDistanceMeters = Math.max(
			0,
			Math.min(locationKm * 1000, routeLengthMeters),
		);

		// Speed: prefer computed delta when we have a real forward movement;
		// otherwise fall back to defaultSpeedMps.
		let pathSpeedMps = defaultSpeedMps;
		if (prevTargetDistance !== null && prevPingTime !== null) {
			const deltaDist = newDistanceMeters - prevTargetDistance;
			const deltaTime = (now - prevPingTime) / 1000;
			if (deltaDist > 0 && deltaTime > 0) {
				pathSpeedMps = Math.min(maxSpeedMps, deltaDist / deltaTime);
			}
		}

		return {
			offRoute: false,
			targetDistanceAlongRoute: newDistanceMeters,
			pathSpeedMps,
			lastPingTime: now,
		};
	} catch {
		return { offRoute: true };
	}
}
