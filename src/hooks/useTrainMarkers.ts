import { useRef, useEffect, useCallback } from "react";
import type { Train, TrainMovement, Station } from "../types";
import type { Feature, LineString } from "geojson";
import { buildRouteLine, buildRouteLookup, projectOntoRoute } from "./routeProjection";
import {
  markerColor,
  trainCategory,
  parseRoute,
  type Filter,
} from "../utils";
import type { Mode } from "./useTrainMap";
import { buildTrainPopupErrorHTML, buildTrainPopupHTML, buildTrainPopupWithMovements } from "./trainPopup";
import { makeTrainIcon } from "./trainMarkerIcon";

// ---------------------------------------------------------------------------
// Module-level train shape cache (survives across renders / updates)
// ---------------------------------------------------------------------------

type TrainShapeCacheEntry =
  | { routeLine: Feature<LineString>; routeLookup: Float64Array | null; routeLengthMeters: number }
  | "not-found";

const TRAIN_SHAPE_CACHE_MAX = 200;
const trainShapeCache = new Map<string, TrainShapeCacheEntry>();

// Single-flight bulk loader: one /api/train/shapes request shared across the
// whole app. Avoids the previous N-parallel-request fan-out that triggered CF
// rate limits when many trains were active.
//
// Failure handling: on 5xx / network error / non-OK, the cached promise is
// cleared so the next caller can retry. The promise itself rejects, letting
// fetchTrainShape() distinguish "bulk failed" (don't poison cache) from
// "bulk succeeded but pair missing" (cache as not-found).
type AllShapesData = {
  endpoints: Record<string, string>;            // pair key -> routeKey
  shapes: Record<string, { coords?: [number, number][] }>;  // routeKey -> shape
};
let allTrainShapesPromise: Promise<AllShapesData> | null = null;
function loadAllTrainShapes(): Promise<AllShapesData> {
  if (allTrainShapesPromise) return allTrainShapesPromise;
  const p = fetch("/api/train/shapes").then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<AllShapesData>;
  });
  allTrainShapesPromise = p;
  // Detached: clear ref on failure so next call retries; don't swallow rejection here
  p.catch(() => {
    if (allTrainShapesPromise === p) allTrainShapesPromise = null;
  });
  return p;
}

// Insertion-order LRU cap: drop oldest entries once the cache exceeds the limit.
function setShapeCache(key: string, value: TrainShapeCacheEntry): void {
  trainShapeCache.delete(key); // ensure re-insertion moves key to the end of insertion order
  trainShapeCache.set(key, value);
  while (trainShapeCache.size > TRAIN_SHAPE_CACHE_MAX) {
    const oldest = trainShapeCache.keys().next().value;
    if (oldest === undefined) break;
    trainShapeCache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Interpolation entry type
// ---------------------------------------------------------------------------

export interface TrainMarkerEntry {
  marker: L.Marker;
  lastColor: string;                       // tracks current marker color so we only setIcon on threshold changes
  train: Train;
  targetLat: number;
  targetLng: number;
  velocityLat: number;
  velocityLng: number;
  lastUpdateTime: number;
  correctionFromLat: number;
  correctionFromLng: number;
  correctionStartTime: number;
  routeLine: Feature<LineString> | null;
  routeLookup: Float64Array | null;
  routeLengthMeters: number | null;
  distanceAtPing: number | null;           // distance along route at the moment of last GPS ping
  targetDistanceAlongRoute: number | null; // projected distance from latest GPS, meters
  pathSpeedMps: number;                    // speed along path, m/s (clamped 0–50)
  lastPingTime: number | null;             // when the last GPS ping was processed (performance.now ms)
  offRoute: boolean;                       // true when GPS >500m from polyline
  originDestKey: string | null;            // "origin_lower|dest_lower" — used to dedupe shape fetches
}

// ---------------------------------------------------------------------------
// Helper: poll a markers map until an entry appears (async retry loop).
// Used by focusTrain to handle the gap between search-result click and the
// main trains poll landing, or a running train whose GPS is temporarily (0,0).
// ---------------------------------------------------------------------------

type SleepFn = (ms: number) => Promise<void>;

export async function pollForMarker(
  markers: Map<string, TrainMarkerEntry>,
  code: string,
  maxAttempts: number,
  intervalMs: number,
  alive: () => boolean,
  sleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<TrainMarkerEntry | undefined> {
  let entry = markers.get(code);
  let attempts = 0;
  while (!entry && attempts < maxAttempts && alive()) {
    await sleep(intervalMs);
    entry = markers.get(code);
    attempts++;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseTrainMarkersOptions {
  trains: Train[];
  filter: Filter;
  searchCodes: string[] | null;
  mode: Mode;
  leafletMap: React.RefObject<L.Map | null>;
  stationsRef: React.MutableRefObject<Map<string, Station>>;
}

export function useTrainMarkers({
  trains,
  filter,
  searchCodes,
  mode,
  leafletMap,
  stationsRef,
}: UseTrainMarkersOptions): {
  markers: React.MutableRefObject<Map<string, TrainMarkerEntry>>;
  routeLineRef: React.RefObject<L.Polyline | null>;
  clearRouteLine: () => void;
  focusTrain: (code: string) => Promise<void>;
} {
  const markers = useRef<Map<string, TrainMarkerEntry>>(new Map());
  const routeLineRef = useRef<L.Polyline | null>(null);

  // Stable refs for values used in closures (avoids stale captures)
  const filterRef = useRef<Filter>(filter);
  filterRef.current = filter;
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const searchCodesRef = useRef<string[] | null>(searchCodes);
  searchCodesRef.current = searchCodes;
  const onMarkerClickRef = useRef<(trainCode: string) => void>(() => {});

  // Monotonic counter so each focusTrain call invalidates any still-running
  // earlier call. Prevents stale retries from stealing focus after the user
  // already clicked a different train.
  const focusRequestIdRef = useRef(0);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function isVisible(train: Train): boolean {
    // Hide all trains in bus mode
    if (modeRef.current === "bus") return false;
    if (searchCodesRef.current !== null) {
      return searchCodesRef.current.includes(train.code);
    }
    if (filterRef.current === "all") return true;
    return trainCategory(train.code) === filterRef.current;
  }

  function clearRouteLine() {
    const map = leafletMap.current;
    if (routeLineRef.current && map) {
      map.removeLayer(routeLineRef.current);
      routeLineRef.current = null;
    }
  }

  function makeTrainMarker(train: Train): L.Marker {
    // interactive:false so clicks pass through to the oversized invisible
    // hitMarker — without this, the divIcon (markerPane z=600) sits above the
    // SVG hitMarker (overlayPane z=400) and swallows the tap.
    return L.marker([train.lat, train.lng], {
      icon: makeTrainIcon(markerColor(train)),
      interactive: false,
    });
  }

  // Invisible oversize hit target that catches taps around the visible marker.
  // Rendered above (added after) so it receives the click; fully transparent so
  // the visible marker shows through.
  function makeHitMarker(train: Train): L.CircleMarker {
    return L.circleMarker([train.lat, train.lng], {
      radius: 18,
      stroke: false,
      fillOpacity: 0,
    });
  }

  // Looks up a train shape from the bulk in-memory map (loaded once on first call).
  // Caches the derived routeLine/routeLookup per (origin, destination) pair.
  // On bulk-load failure, returns null without caching — next call retries.
  async function fetchTrainShape(
    origin: string,
    destination: string,
  ): Promise<{ routeLine: Feature<LineString>; routeLookup: Float64Array | null; routeLengthMeters: number } | null> {
    const key = `${origin.toLowerCase()}|${destination.toLowerCase()}`;
    const cached = trainShapeCache.get(key);
    if (cached !== undefined) {
      return cached === "not-found" ? null : cached;
    }
    let allShapes: AllShapesData;
    try {
      allShapes = await loadAllTrainShapes();
    } catch {
      // Transient: don't poison cache so next tick can retry once promise is reset
      return null;
    }
    const routeKey = allShapes.endpoints[key];
    const data = routeKey ? allShapes.shapes[routeKey] : undefined;
    if (data?.coords && data.coords.length >= 2) {
      const built = buildRouteLine(data.coords);
      if (built) {
        const entry = { ...built, routeLookup: buildRouteLookup(built.routeLine) };
        setShapeCache(key, entry);
        return entry;
      }
    }
    setShapeCache(key, "not-found");
    return null;
  }

  async function onMarkerClick(trainCode: string) {
    const entry = markers.current.get(trainCode);
    if (!entry) return;

    const { marker, train } = entry;

    clearRouteLine();

    marker.bindPopup(buildTrainPopupHTML(train), { maxWidth: 520, minWidth: 380, autoPan: false }).openPopup();
    leafletMap.current?.panTo(marker.getLatLng(), { animate: true, duration: 0.4 });

    try {
      const res = await fetch(`/api/train/${trainCode}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const movements: TrainMovement[] = await res.json();
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(buildTrainPopupWithMovements(train, movements));
        // Scroll to current stop after DOM updates
        requestAnimationFrame(() => {
          const wrap = document.querySelector(".popup-table-wrap");
          const current = document.querySelector("tr.movement-current");
          if (wrap && current) {
            const rowTop = (current as HTMLElement).offsetTop - (wrap as HTMLElement).offsetTop;
            wrap.scrollTop = rowTop;
          }
        });

        // Draw route polyline using station coordinates
        const map = leafletMap.current;
        if (map) {
          const latlngs = movements
            .map((m) => {
              const station = stationsRef.current.get(m.stationCode);
              return station ? [station.lat, station.lng] : null;
            })
            .filter((ll): ll is [number, number] => ll !== null);

          if (latlngs.length >= 2) {
            routeLineRef.current = L.polyline(latlngs, {
              color: "#25a864",
              weight: 3,
              opacity: 0.7,
              dashArray: "8, 8",
              interactive: false,
            }).addTo(map);
          }
        }
      }
    } catch {
      const e = markers.current.get(trainCode);
      if (!e) return;
      const popup = e.marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(
          buildTrainPopupErrorHTML(e.train)
        );
      }
    }
  }
  onMarkerClickRef.current = onMarkerClick;

  // -------------------------------------------------------------------------
  // Sync train markers when trains data changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const train of trains) {
      seen.add(train.code);
      // Skip trains with no valid coordinates (API returns 0,0 for some)
      if (train.lat === 0 && train.lng === 0) continue;

      const route = parseRoute(train.message);
      const newKey = route
        ? `${route.origin.toLowerCase()}|${route.destination.toLowerCase()}`
        : null;

      // Look up shape from cache (synchronously)
      let lineInfo: { routeLine: Feature<LineString>; routeLookup: Float64Array | null; routeLengthMeters: number } | null = null;
      if (newKey !== null) {
        const cached = trainShapeCache.get(newKey);
        if (cached === undefined) {
          // Not yet fetched — kick off async fetch; cache populated on completion
          void fetchTrainShape(route!.origin, route!.destination);
        } else if (cached !== "not-found") {
          lineInfo = cached;
        }
      }

      const existing = markers.current.get(train.code);

      if (existing) {
        const now = performance.now();
        const color = markerColor(train);
        if (color !== existing.lastColor) {
          existing.marker.setIcon(makeTrainIcon(color));
          existing.lastColor = color;
        }
        existing.train = train;

        // If origin/dest changed, clear path state to avoid extrapolating on wrong route
        if (newKey !== existing.originDestKey) {
          existing.originDestKey = newKey;
          existing.routeLine = null;
          existing.routeLookup = null;
          existing.routeLengthMeters = null;
          existing.distanceAtPing = null;
          existing.targetDistanceAlongRoute = null;
          existing.lastPingTime = null;
          existing.offRoute = true;
          lineInfo = null; // treat as fresh — next tick will re-evaluate
        }

        // Backfill routeLine if shape just arrived
        if (!existing.routeLine && lineInfo) {
          existing.routeLine = lineInfo.routeLine;
          existing.routeLookup = lineInfo.routeLookup;
          existing.routeLengthMeters = lineInfo.routeLengthMeters;
        }

        // Project new GPS ping onto the route (trains: 500m threshold, 50 m/s cap)
        const rl = existing.routeLine;
        const rlm = existing.routeLengthMeters;
        if (rl && rlm !== null && train.status === "R") {
          const projection = projectOntoRoute(
            train.lat, train.lng,
            rl, rlm,
            existing.targetDistanceAlongRoute,
            existing.lastPingTime,
            now,
            500,  // off-route threshold: 500m for trains
            50,   // max speed: 50 m/s ≈ 180 km/h
            15,   // default speed: 15 m/s ≈ 54 km/h — keeps marker creeping between station updates
          );
          if (!projection.offRoute) {
            existing.offRoute = false;
            // Advance distanceAtPing to where the train actually is before updating target
            if (existing.distanceAtPing === null) {
              existing.distanceAtPing = projection.targetDistanceAlongRoute;
            } else if (existing.lastPingTime !== null) {
              const dtSec = (now - existing.lastPingTime) / 1000;
              const advanced = existing.distanceAtPing + existing.pathSpeedMps * dtSec;
              const capped = Math.min(advanced, projection.targetDistanceAlongRoute);
              existing.distanceAtPing = Math.max(0, Math.min(capped, existing.routeLengthMeters!));
            }
            existing.targetDistanceAlongRoute = projection.targetDistanceAlongRoute;
            existing.pathSpeedMps = projection.pathSpeedMps;
            existing.lastPingTime = projection.lastPingTime;
          } else {
            // Off-route: fall back to velocity-based extrapolation
            existing.offRoute = true;
          }
        }

        // Zero path speed when train is not running (prevents creep after termination)
        if (train.status !== "R") {
          existing.pathSpeedMps = 0;
        }

        // Always maintain velocity for the fallback interpolation path
        const timeDelta = now - existing.lastUpdateTime;
        if (timeDelta > 0 && train.status === "R") {
          existing.velocityLat = (train.lat - existing.targetLat) / timeDelta;
          existing.velocityLng = (train.lng - existing.targetLng) / timeDelta;
        } else {
          existing.velocityLat = 0;
          existing.velocityLng = 0;
        }

        // Record current displayed position as correction origin (for LERP fallback)
        const cur = existing.marker.getLatLng();
        existing.correctionFromLat = cur.lat;
        existing.correctionFromLng = cur.lng;
        existing.correctionStartTime = now;

        existing.targetLat = train.lat;
        existing.targetLng = train.lng;
        existing.lastUpdateTime = now;

        if (isVisible(train)) {
          if (!map.hasLayer(existing.marker)) existing.marker.addTo(map);
        } else {
          if (map.hasLayer(existing.marker)) existing.marker.removeFrom(map);
        }
      } else {
        // New marker
        const now = performance.now();
        const marker = makeTrainMarker(train);
        const hitMarker = makeHitMarker(train);

        hitMarker.on("click", () => onMarkerClickRef.current(train.code));
        // Keep hit target in sync: mirror position on every frame, follow
        // visible marker on/off the map so there's no stray hit layer.
        marker.on("move", (e) => hitMarker.setLatLng((e as L.LeafletEvent & { latlng: L.LatLng }).latlng));
        marker.on("add", () => hitMarker.addTo(map));
        marker.on("remove", () => map.removeLayer(hitMarker));

        if (isVisible(train)) marker.addTo(map);

        let distanceAtPing: number | null = null;
        let offRoute = true;
        let targetDistanceAlongRoute: number | null = null;
        let pathSpeedMps = 0;
        let lastPingTime: number | null = null;
        let routeLine: Feature<LineString> | null = null;
        let routeLookup: Float64Array | null = null;
        let routeLengthMeters: number | null = null;

        if (lineInfo && train.status === "R") {
          const projection = projectOntoRoute(
            train.lat, train.lng,
            lineInfo.routeLine, lineInfo.routeLengthMeters,
            null, null, now,
            500,
            50,
            15,
          );
          if (!projection.offRoute) {
            offRoute = false;
            distanceAtPing = projection.targetDistanceAlongRoute;
            targetDistanceAlongRoute = projection.targetDistanceAlongRoute;
            pathSpeedMps = projection.pathSpeedMps; // defaults to 15 m/s on first ping
            lastPingTime = projection.lastPingTime;
            routeLine = lineInfo.routeLine;
            routeLookup = lineInfo.routeLookup;
            routeLengthMeters = lineInfo.routeLengthMeters;
          }
        } else if (lineInfo) {
          // Shape available but train not running yet — store route for later
          routeLine = lineInfo.routeLine;
          routeLookup = lineInfo.routeLookup;
          routeLengthMeters = lineInfo.routeLengthMeters;
        }

        markers.current.set(train.code, {
          marker,
          lastColor: markerColor(train),
          train,
          targetLat: train.lat,
          targetLng: train.lng,
          velocityLat: 0,
          velocityLng: 0,
          lastUpdateTime: now,
          correctionFromLat: train.lat,
          correctionFromLng: train.lng,
          correctionStartTime: now,
          routeLine,
          routeLookup,
          routeLengthMeters,
          distanceAtPing,
          targetDistanceAlongRoute,
          pathSpeedMps,
          lastPingTime,
          offRoute,
          originDestKey: newKey,
        });
      }
    }

    // Remove trains that are no longer in the feed
    for (const [code, entry] of markers.current) {
      if (!seen.has(code)) {
        entry.marker.removeFrom(map);
        markers.current.delete(code);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trains]);

  // Apply filter / search / mode — show or hide existing markers
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    for (const [, entry] of markers.current) {
      if (isVisible(entry.train)) {
        if (!map.hasLayer(entry.marker)) entry.marker.addTo(map);
      } else {
        if (map.hasLayer(entry.marker)) entry.marker.removeFrom(map);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, searchCodes, mode]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const focusTrain = useCallback(async (code: string) => {
    const requestId = ++focusRequestIdRef.current;
    if (!leafletMap.current) return;

    const entry = await pollForMarker(
      markers.current,
      code,
      30,
      200,
      () => !!leafletMap.current && requestId === focusRequestIdRef.current,
    );

    if (!entry || requestId !== focusRequestIdRef.current || !leafletMap.current) return;
    leafletMap.current.setView(entry.marker.getLatLng(), 13, { animate: false });
    void onMarkerClickRef.current(code);
  }, []);

  return { markers, routeLineRef, clearRouteLine, focusTrain };
}
