import { useRef, useEffect } from "react";
import type { Train, TrainMovement, Station } from "../types";
import type { Feature, LineString } from "geojson";
import { along } from "./routeProjection";
import { buildRouteLine, projectOntoRoute } from "./routeProjection";
import {
  markerColor,
  trainCategory,
  parseLateMinutes,
  parseRoute,
  fmtTime,
  escapeHtml,
  type Filter,
} from "../utils";
import type { Mode } from "./useTrainMap";

// ---------------------------------------------------------------------------
// Module-level train shape cache (survives across renders / updates)
// ---------------------------------------------------------------------------

type TrainShapeCacheEntry =
  | { routeLine: Feature<LineString>; routeLengthMeters: number }
  | "not-found";

const TRAIN_SHAPE_CACHE_MAX = 200;
const trainShapeCache = new Map<string, TrainShapeCacheEntry>();
const trainShapeInFlight = new Map<string, Promise<{ routeLine: Feature<LineString>; routeLengthMeters: number } | null>>();

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
// Popup HTML builders
// ---------------------------------------------------------------------------

function lateClass(status: string, late: number | null): string {
  if (status === "N" || status === "T") return "";
  if (late === null || late <= 0) return "";
  if (late >= 10) return "popup-status--red";
  return "popup-status--yellow";
}

// Irish Rail's PublicMessage sometimes contains literal "\n" (two chars)
// instead of an actual newline — escape first, then normalize both to <br>.
function formatMessage(message: string): string {
  return escapeHtml(message).replace(/\\r?\\n|\r?\n/g, "<br>");
}

function buildPopupHTML(train: Train): string {
  const route = parseRoute(train.message);
  const late = parseLateMinutes(train.message);
  const statusText =
    train.status === "N" ? "Not yet running" :
    train.status === "T" ? "Terminated" :
    late === null ? "Running" :
    late <= 0 ? `On time${late < 0 ? ` (${Math.abs(late)} min${Math.abs(late) !== 1 ? "s" : ""} early)` : ""}` :
    `${late} min${late !== 1 ? "s" : ""} late`;

  return `
    <div class="popup-content">
      <div class="popup-title">${escapeHtml(train.code)}</div>
      ${route ? `<div class="popup-route">${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</div>` : ""}
      <div class="popup-meta">
        <span class="popup-status ${lateClass(train.status, late)}">${statusText}</span>
        ${train.direction ? `<span class="popup-dir">${escapeHtml(train.direction)}</span>` : ""}
      </div>
      <div class="popup-loading">Loading stops…</div>
    </div>
  `;
}

function buildPopupWithMovements(train: Train, movements: TrainMovement[]): string {
  const route = parseRoute(train.message);
  const late = parseLateMinutes(train.message);
  const statusText =
    train.status === "N" ? "Not yet running" :
    train.status === "T" ? "Terminated" :
    late === null ? "Running" :
    late <= 0 ? `On time${late < 0 ? ` (${Math.abs(late)} min${Math.abs(late) !== 1 ? "s" : ""} early)` : ""}` :
    `${late} min${late !== 1 ? "s" : ""} late`;

  const stopTypeLabel: Record<string, string> = {
    O: "Origin",
    T: "Terminus",
    C: "Current",
    S: "Stop",
    D: "Destination",
  };

  const rows = movements
    .map((m) => {
      const isCurrent = m.stopType === "C";
      const rowClass = isCurrent ? "movement-current" : "";
      const schArr = fmtTime(m.scheduledArrival);
      const schDep = fmtTime(m.scheduledDepart);
      const expArr = fmtTime(m.expectedArrival);
      const expDep = fmtTime(m.expectedDepart);
      const actArr = fmtTime(m.arrival);
      const actDep = fmtTime(m.departure);

      // Show actual times if available, otherwise expected, otherwise scheduled
      const showArr = actArr !== "—" ? actArr : expArr !== "—" ? expArr : schArr;
      const showDep = actDep !== "—" ? actDep : expDep !== "—" ? expDep : schDep;

      return `
        <tr class="${rowClass}">
          <td>${escapeHtml(m.stationName)}${isCurrent ? " ▶" : ""}</td>
          <td>${escapeHtml(stopTypeLabel[m.stopType] ?? m.stopType)}</td>
          <td>${showArr}</td>
          <td>${showDep}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="popup-content">
      <div class="popup-title">${escapeHtml(train.code)}</div>
      ${route ? `<div class="popup-route">${escapeHtml(route.origin)} → ${escapeHtml(route.destination)}</div>` : ""}
      <div class="popup-meta">
        <span class="popup-status ${lateClass(train.status, late)}">${statusText}</span>
        ${train.direction ? `<span class="popup-dir">${escapeHtml(train.direction)}</span>` : ""}
      </div>
      ${
        movements.length > 0
          ? `<div class="popup-table-wrap">
               <table class="movements-table">
                 <thead>
                   <tr>
                     <th>Station</th>
                     <th>Type</th>
                     <th>Arr</th>
                     <th>Dep</th>
                   </tr>
                 </thead>
                 <tbody>${rows}</tbody>
               </table>
             </div>`
          : `<div class="popup-message">${formatMessage(train.message)}</div>`
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Interpolation entry type
// ---------------------------------------------------------------------------

export interface TrainMarkerEntry {
  marker: L.CircleMarker;
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
  routeLengthMeters: number | null;
  distanceAtPing: number | null;           // distance along route at the moment of last GPS ping
  targetDistanceAlongRoute: number | null; // projected distance from latest GPS, meters
  pathSpeedMps: number;                    // speed along path, m/s (clamped 0–50)
  lastPingTime: number | null;             // when the last GPS ping was processed (performance.now ms)
  offRoute: boolean;                       // true when GPS >500m from polyline
  originDestKey: string | null;            // "origin_lower|dest_lower" — used to dedupe shape fetches
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
  focusTrain: (code: string) => void;
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

  function makeCircleMarker(train: Train): L.CircleMarker {
    const color = markerColor(train);
    return L.circleMarker([train.lat, train.lng], {
      radius: 7,
      fillColor: color,
      color: "#fff",
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.9,
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

  // Async fetch of a train shape, populating the module-level cache.
  // Dedupes concurrent requests; does NOT cache on 429/network error.
  async function fetchTrainShape(
    origin: string,
    destination: string,
  ): Promise<{ routeLine: Feature<LineString>; routeLengthMeters: number } | null> {
    const key = `${origin.toLowerCase()}|${destination.toLowerCase()}`;
    const cached = trainShapeCache.get(key);
    if (cached !== undefined) {
      return cached === "not-found" ? null : cached;
    }
    const inFlight = trainShapeInFlight.get(key);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<{ routeLine: Feature<LineString>; routeLengthMeters: number } | null> => {
      try {
        const res = await fetch(
          `/api/train/shape?from=${encodeURIComponent(origin)}&to=${encodeURIComponent(destination)}`,
        );
        if (res.status === 429) {
          // Transient: don't poison cache; next sync tick will retry
          return null;
        }
        if (!res.ok) {
          setShapeCache(key, "not-found");
          return null;
        }
        const data = await res.json() as { coords?: [number, number][] };
        if (data.coords && data.coords.length >= 2) {
          const built = buildRouteLine(data.coords);
          if (built) {
            setShapeCache(key, built);
            return built;
          }
        }
        setShapeCache(key, "not-found");
        return null;
      } catch {
        // Network error — don't poison cache; retry later
        return null;
      } finally {
        trainShapeInFlight.delete(key);
      }
    })();

    trainShapeInFlight.set(key, promise);
    return promise;
  }

  async function onMarkerClick(trainCode: string) {
    const entry = markers.current.get(trainCode);
    if (!entry) return;

    const { marker, train } = entry;

    clearRouteLine();

    marker.bindPopup(buildPopupHTML(train), { maxWidth: 520, minWidth: 380, autoPan: false }).openPopup();
    leafletMap.current?.panTo(marker.getLatLng(), { animate: true, duration: 0.4 });

    try {
      const res = await fetch(`/api/train/${trainCode}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const movements: TrainMovement[] = await res.json();
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(buildPopupWithMovements(train, movements));
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
          buildPopupHTML(e.train).replace("Loading stops…", "Could not load movement data.")
        );
      }
    }
  }

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
      let lineInfo: { routeLine: Feature<LineString>; routeLengthMeters: number } | null = null;
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
        existing.marker.setStyle({ fillColor: color });
        existing.train = train;

        // If origin/dest changed, clear path state to avoid extrapolating on wrong route
        if (newKey !== existing.originDestKey) {
          existing.originDestKey = newKey;
          existing.routeLine = null;
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
        const marker = makeCircleMarker(train);
        const hitMarker = makeHitMarker(train);

        hitMarker.on("click", () => onMarkerClick(train.code));
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
            routeLengthMeters = lineInfo.routeLengthMeters;
          }
        } else if (lineInfo) {
          // Shape available but train not running yet — store route for later
          routeLine = lineInfo.routeLine;
          routeLengthMeters = lineInfo.routeLengthMeters;
        }

        markers.current.set(train.code, {
          marker,
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

  function focusTrain(code: string) {
    const map = leafletMap.current;
    const entry = markers.current.get(code);
    if (!map || !entry) return;
    map.setView(entry.marker.getLatLng(), 13, { animate: false });
    void onMarkerClick(code);
  }

  return { markers, routeLineRef, clearRouteLine, focusTrain };
}
