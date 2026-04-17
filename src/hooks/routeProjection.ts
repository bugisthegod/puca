// Pure route-math helpers shared by train and bus marker hooks.
// No React imports — no closures over any hook state.

import nearestPointOnLine from "@turf/nearest-point-on-line";
import along from "@turf/along";
import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { Feature, LineString } from "geojson";

export type { Feature, LineString };
export { along, length, lineString };

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
    const turfCoords = coords.map(([lat, lng]) => [lng, lat] as [number, number]);
    const line = lineString(turfCoords);
    const km = length(line, { units: "kilometers" });
    return { routeLine: line, routeLengthMeters: km * 1000 };
  } catch {
    return null;
  }
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
): {
  offRoute: false;
  targetDistanceAlongRoute: number;
  pathSpeedMps: number;
  lastPingTime: number;
} | { offRoute: true } {
  try {
    const pt = nearestPointOnLine(routeLine, [vehicleLng, vehicleLat], { units: "kilometers" });
    const distFromLineKm: number = pt.properties?.dist ?? Infinity;
    if (distFromLineKm * 1000 > offRouteMeters) return { offRoute: true };

    const locationKm: number = pt.properties?.location ?? 0;
    const newDistanceMeters = Math.max(0, Math.min(locationKm * 1000, routeLengthMeters));

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
