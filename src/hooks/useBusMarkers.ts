import { useRef, useEffect } from "react";
import type { BusVehicle, BusOperator } from "../types";
import type { Feature, LineString } from "geojson";
import { buildRouteLine, buildRouteLookup, projectOntoRoute } from "./routeProjection";
import type { Mode } from "./useVehicleMap";
import { buildBusPopupHTML as buildBusPopupContentHTML, type BusTripPopupData } from "./busPopup";
import { makeBusIcon as makeBusMarkerIcon } from "./busMarkerIcon";
import { busRouteColor, reconcileSelectedVariant, variantStyleForShape } from "./busVariantStyle";

// ---------------------------------------------------------------------------
// Module-level dedupe for bus trip fetches.
// markercluster can re-fire popupopen when repositioning markers, and the
// upstream GTFS API rate-limits quickly.
// ---------------------------------------------------------------------------
const busTripInFlight = new Set<string>();

// Below this zoom, stops collapse into an overlapping mess that looks worse
// than the polyline alone. Hide them entirely; they only become individually
// meaningful at street scale.
const STOP_MIN_ZOOM = 13;

// ---------------------------------------------------------------------------
// Bus animation timing.
//
// Each ping with a *new* bus.timestamp starts a fresh animation from the
// marker's currently rendered distance to the new GPS-projected distance,
// lerped over `entry.animDurationMs` (set to the measured interval between
// the previous and current GPS captures, clamped). Frontend polls every 15s
// but the backend only refreshes NTA every 35s, so 2/3 of polls return the
// same bus.timestamp — duplicates must skip the animation reset, otherwise
// the lerp restarts every poll and decelerates Zeno-style.
// ---------------------------------------------------------------------------
const DEFAULT_ANIM_DURATION_MS = 30_000;
const MIN_ANIM_DURATION_MS = 5_000;
const MAX_ANIM_DURATION_MS = 60_000;

// Returns the marker's currently rendered distance along its route, lerped
// between prevDistance and currentDistance per the active animation window.
// Used both at ping arrival (to seed the next animation's prev) and in RAF.
export function computeBusCurrentDistance(entry: BusMarkerEntry, now: number): number | null {
  if (entry.currentDistance === null) return null;
  if (
    entry.prevDistance === null ||
    entry.animStartPerfMs === null ||
    entry.animDurationMs <= 0
  ) {
    return entry.currentDistance;
  }
  const t = Math.max(0, Math.min(1, (now - entry.animStartPerfMs) / entry.animDurationMs));
  return entry.prevDistance + (entry.currentDistance - entry.prevDistance) * t;
}

// ---------------------------------------------------------------------------
// Interpolation entry type
// ---------------------------------------------------------------------------

export type BusVariant = {
  shapeId: string;
  tripCount: number;
  branches: [number, number][][];
};

export type BusDirectionShape = {
  headsign: string;
  coords: [number, number][];
  stops: { id: string; name: string; lat: number; lng: number }[];
  variants?: BusVariant[];
};

export interface BusMarkerEntry {
  marker: L.Marker;
  bus: BusVehicle;
  // Latest GPS lat/lng — used for viewport culling and as the off-route LERP target.
  targetLat: number;
  targetLng: number;
  // Off-route LERP source: when GPS leaves the route polyline, the marker
  // blends from (correctionFromLat, correctionFromLng) → (targetLat, targetLng)
  // over BLEND_DURATION starting at correctionStartTime.
  correctionFromLat: number;
  correctionFromLng: number;
  correctionStartTime: number;
  routeLine: Feature<LineString> | null;
  routeLookup: Float64Array | null;
  routeLengthMeters: number | null;
  // Two-point interpolation buffer for the on-route branch. On each ping with
  // a new bus.timestamp:
  //   prevDistance = where the marker is currently rendered (so animation
  //                  always starts from the visible position — no jumps),
  //   currentDistance = newly projected distance from the GPS ping,
  //   animStartPerfMs = perf.now() at ping arrival,
  //   animDurationMs  = measured interval between the two GPS captures
  //                     (clamped 5-60s) — matches lerp speed to real bus speed.
  // RAF lerps prev → current over animDurationMs. After t=1 the marker sits
  // at currentDistance. Duplicate pings (same bus.timestamp from cache) leave
  // these fields untouched so the animation keeps running uninterrupted.
  prevDistance: number | null;
  currentDistance: number | null;
  animStartPerfMs: number | null;
  animDurationMs: number;
  offRoute: boolean;                       // true when GPS >150m from polyline
  // Render-skip flags: avoid redundant setLatLng + along() when position hasn't changed.
  settled: boolean;                        // LERP branch: true after blend completed and target rendered
  lastRenderedDistance: number | null;     // path-constrained branch: last distance written to DOM
  // Cached trip metadata resolved from /api/bus/trip. Lets popupopen re-apply
  // variant highlight instantly on re-open without another round-trip.
  shapeId: string | null;
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

interface UseBusMarkersOptions {
  buses: BusVehicle[];
  busShape: { [direction: string]: BusDirectionShape } | null;
  busDirection: string | null;
  busOperator: BusOperator;
  mode: Mode;
  currentBusRoute: string | null;
  onSelectBusRoute: React.RefObject<((route: string, direction: string) => void) | undefined>;
  leafletMap: React.RefObject<L.Map | null>;
  busClusterLayer: React.RefObject<L.MarkerClusterGroup | L.LayerGroup | null>;
}

export function useBusMarkers({
  buses,
  busShape,
  busDirection,
  busOperator,
  mode,
  currentBusRoute,
  onSelectBusRoute,
  leafletMap,
  busClusterLayer,
}: UseBusMarkersOptions): {
  busMarkers: React.MutableRefObject<Map<string, BusMarkerEntry>>;
  busShapeLayerRef: React.RefObject<L.Polyline | null>;
  busStopMarkersRef: React.MutableRefObject<L.CircleMarker[]>;
} {
  const busMarkers = useRef<Map<string, BusMarkerEntry>>(new Map());
  const busShapeLayerRef = useRef<L.Polyline | null>(null);
  const busStopMarkersRef = useRef<L.CircleMarker[]>([]);
  // Single ring marker on the polyline's terminus stop. Pairs with the search
  // panel "Going to <headsign>" label so the user can spot which end is the
  // destination without overlay markers along the whole line.
  const routeEndMarkerRef = useRef<L.Marker | null>(null);
  // Variant branch polylines for the currently displayed route+direction.
  // shapeId → list of branch polylines. Populated in the shape useEffect,
  // styled (not re-added/removed) by highlightVariant/clearVariantHighlight.
  const variantLayersRef = useRef<Record<string, L.Polyline[]>>({});
  const selectedShapeIdRef = useRef<string | null>(null);
  // Set of shape_ids currently being traveled by at least one live bus on
  // this route. Recomputed each buses update. Variants whose shape isn't
  // here get opacity 0 — only patterns that are actually running right now
  // are visible. E.g. route 38's industrial-loop variant only runs 6-8 am,
  // so outside that window its branches correctly disappear.
  const activeShapeIdsRef = useRef<Set<string>>(new Set());

  // Stable ref so closures always read the latest callback without stale captures
  const onSelectBusRouteRef = onSelectBusRoute;
  const currentBusRouteRef = useRef(currentBusRoute);
  currentBusRouteRef.current = currentBusRoute;
  const busOperatorRef = useRef(busOperator);
  busOperatorRef.current = busOperator;

  // -------------------------------------------------------------------------
  // Variant branch style helpers.
  //
  // Design: never add/removeLayer from popup events — markercluster fires
  // popupopen/popupclose in rapid bursts when it re-anchors markers, and any
  // layer churn there causes visible flicker. Variant branches are drawn ONCE
  // per route+direction change; highlight is purely setStyle + bringToFront,
  // which is idempotent under event storms.
  // -------------------------------------------------------------------------
  function applyVariantStyles() {
    const color = busRouteColor(busOperatorRef.current);
    const selected = selectedShapeIdRef.current;
    const active = activeShapeIdsRef.current;
    for (const [shapeId, polylines] of Object.entries(variantLayersRef.current)) {
      // Selected wins over inactive — if the user clicked a bus and its shape
      // subsequently leaves the active set (trip ended, bus gone), the
      // buses useEffect clears selectedShapeIdRef below, so we won't end up
      // highlighting something that no longer exists.
      const style = variantStyleForShape(shapeId, selected, active, color);
      for (const pl of polylines) {
        pl.setStyle({ color: style.color, weight: style.weight, opacity: style.opacity });
        if (style.bringToFront) pl.bringToFront();
      }
    }
  }

  function highlightVariant(shapeId: string) {
    if (selectedShapeIdRef.current === shapeId) return;
    if (!variantLayersRef.current[shapeId]) return;
    selectedShapeIdRef.current = shapeId;
    applyVariantStyles();
  }

  function clearVariantHighlight() {
    if (selectedShapeIdRef.current === null) return;
    selectedShapeIdRef.current = null;
    applyVariantStyles();
  }

  function buildBusPopupHTML(bus: BusVehicle, trip: BusTripPopupData | null): string {
    return buildBusPopupContentHTML(bus, trip, {
      showRouteJump: Boolean(onSelectBusRouteRef.current && currentBusRouteRef.current !== bus.routeShortName),
    });
  }

  function wireRouteJumpButton(popup: L.Popup) {
    const btn = popup.getElement?.()?.querySelector(".popup-route-jump");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const route = decodeURIComponent(btn.getAttribute("data-route") ?? "");
      const dir = btn.getAttribute("data-dir") ?? "";
      if (route && dir) {
        leafletMap.current?.closePopup();
        onSelectBusRouteRef.current?.(route, dir);
      }
    });
  }

  function scrollPopupToCurrent(marker: L.Marker) {
    requestAnimationFrame(() => {
      const root = (marker.getPopup()?.getElement?.() ?? document) as ParentNode;
      const wrap = root.querySelector(".popup-table-wrap") as HTMLElement | null;
      const current = root.querySelector("tr.movement-current") as HTMLElement | null;
      if (!wrap || !current) return;
      // getBoundingClientRect sidesteps the offsetParent chain — a <tr>'s
      // offsetParent is usually the <table>, not the wrap, so the naive
      // offsetTop subtraction silently produces the wrong scrollTop and the
      // row lands somewhere random (often the bottom edge, half-clipped).
      const currentRect = current.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const currentOffsetInWrap = (currentRect.top - wrapRect.top) + wrap.scrollTop;
      // Centre the current row vertically in the visible area — a few past
      // stops are visible above, upcoming stops below, all at a glance.
      const centerOffset = (wrapRect.height - currentRect.height) / 2;
      wrap.scrollTop = Math.max(0, currentOffsetInWrap - centerOffset);
    });
  }

  async function loadBusTrip(bus: BusVehicle, marker: L.Marker) {
    if (busTripInFlight.has(bus.tripId)) return;
    // If the popup already shows loaded trip data, skip the refetch — but
    // still snap to the current stop, because Leaflet rebuilds the popup DOM
    // on each reopen and scrollTop resets to 0.
    const existingPopup = marker.getPopup();
    const existingContent = existingPopup?.getContent?.();
    if (typeof existingContent === "string" && existingContent.includes("popup-table-wrap")) {
      scrollPopupToCurrent(marker);
      return;
    }
    busTripInFlight.add(bus.tripId);
    try {
      const res = await fetch(`/api/bus/trip/${encodeURIComponent(bus.tripId)}?operator=${encodeURIComponent(busOperatorRef.current)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const trip = await res.json();
      const entry = busMarkers.current.get(bus.tripId);
      if (entry && typeof trip.shapeId === "string") {
        entry.shapeId = trip.shapeId;
        highlightVariant(trip.shapeId);
      }
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(buildBusPopupHTML(bus, trip.stops ? trip : null));
        wireRouteJumpButton(popup);
        scrollPopupToCurrent(marker);
      }
    } catch {
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(buildBusPopupHTML(bus, { stops: [] }));
        wireRouteJumpButton(popup);
      }
    } finally {
      busTripInFlight.delete(bus.tripId);
    }
  }

  function makeBusMarker(bus: BusVehicle): L.Marker {
    const marker = L.marker([bus.lat, bus.lng], { icon: makeBusMarkerIcon(bus, busOperatorRef.current) });
    marker.bindPopup(buildBusPopupHTML(bus, null), {
      maxWidth: 520,
      minWidth: 360,
      // Leave room for the mobile search FAB (40px + 12px top offset + gap) at
      // the top and a little breathing room everywhere else, so popups never
      // sit flush against the search button or the map edge.
      autoPan: true,
      autoPanPaddingTopLeft: L.point(16, 80),
      autoPanPaddingBottomRight: L.point(16, 16),
    });
    marker.on("popupopen", () => {
      // panInside (vs panTo) only shifts the map when the marker is near an
      // edge, so it cooperates with Leaflet's popup autoPan — our padding
      // keeps the popup clear of the search FAB without re-centering on every
      // click and undoing that adjustment.
      leafletMap.current?.panInside(marker.getLatLng(), {
        paddingTopLeft: L.point(16, 80),
        paddingBottomRight: L.point(16, 16),
      });
      const popup = marker.getPopup();
      if (popup) wireRouteJumpButton(popup);
      // Instant re-highlight from cache on re-open (markercluster event storms
      // or second click). Fetch below will overwrite if shapeId resolves later.
      const cached = busMarkers.current.get(bus.tripId)?.shapeId;
      if (cached) highlightVariant(cached);
      void loadBusTrip(bus, marker);
    });
    return marker;
  }

  // -------------------------------------------------------------------------
  // Bus markers sync
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    if (mode !== "bus") {
      busMarkers.current.clear();
      if (busShapeLayerRef.current) {
        map.removeLayer(busShapeLayerRef.current);
        busShapeLayerRef.current = null;
      }
      if (routeEndMarkerRef.current) {
        map.removeLayer(routeEndMarkerRef.current);
        routeEndMarkerRef.current = null;
      }
      return;
    }

    const cluster = busClusterLayer.current;
    if (!cluster) return;

    const shape = busShape;

    // Single-route mode: gate adds by route+direction. The `buses` prop can
    // briefly hold a stale all-buses superset between (a) clicking a popup's
    // "Show all 38A" button and (b) fetchBuses(38A, dir) returning. If
    // busShape arrives in that window, useBusMarkers re-runs on the empty
    // (just-cleared) busMarkers Map and would otherwise dump every bus into
    // the un-clustered LayerGroup for one frame.
    const filteredBuses = currentBusRoute && busDirection
      ? buses.filter((b) => b.routeShortName === currentBusRoute && String(b.directionId) === busDirection)
      : buses;

    const seen = new Set<string>();
    for (const bus of filteredBuses) {
      seen.add(bus.tripId);

      const dirKey = String(bus.directionId);
      const dirData = shape?.[dirKey];
      const lineInfo = dirData ? buildRouteLine(dirData.coords) : null;

      const existing = busMarkers.current.get(bus.tripId);
      if (existing) {
        const now = performance.now();
        // Capture the previous timestamp BEFORE any field updates so we can
        // detect cache-duplicate pings (frontend polls 15s, NTA refresh 35s,
        // so 2/3 of polls return the same bus.timestamp).
        const prevTimestamp = existing.bus.timestamp;
        const isDuplicate = prevTimestamp === bus.timestamp;

        // Always: icon swap if stale flipped, routeLine backfill, bus ref
        // refresh — these matter regardless of GPS freshness.
        if (existing.bus.stale !== bus.stale) {
          existing.marker.setIcon(makeBusMarkerIcon(bus, busOperatorRef.current));
        }
        if (!existing.routeLine && lineInfo) {
          existing.routeLine = lineInfo.routeLine;
          existing.routeLookup = buildRouteLookup(lineInfo.routeLine);
          existing.routeLengthMeters = lineInfo.routeLengthMeters;
        }

        if (isDuplicate) {
          // Same GPS data as before. Don't restart the animation — leaving
          // prevDistance / currentDistance / animStartPerfMs / animDurationMs
          // alone keeps the lerp running smoothly. Don't reset render-skip
          // either; RAF would just recompute the same dist for no reason.
          existing.bus = bus;
          continue;
        }

        // New GPS data — reset render-skip and run the animation update.
        existing.settled = false;
        existing.lastRenderedDistance = null;

        const rl = existing.routeLine;
        const rlm = existing.routeLengthMeters;
        if (rl && rlm !== null) {
          const projection = projectOntoRoute(
            bus.lat, bus.lng,
            rl, rlm,
            null, null, now,
          );
          if (!projection.offRoute) {
            // Seed prev with where the marker is currently rendered, so the
            // next animation always starts from the visible position — even if
            // the previous animation hadn't finished, or the bus was just
            // off-route. computeBusCurrentDistance must be called BEFORE we
            // overwrite animDurationMs so it reads the in-flight animation.
            let seedPrev: number | null = null;
            if (existing.offRoute) {
              const cur = existing.marker.getLatLng();
              const reproj = projectOntoRoute(cur.lat, cur.lng, rl, rlm, null, null, now);
              if (!reproj.offRoute) seedPrev = reproj.targetDistanceAlongRoute;
            } else {
              seedPrev = computeBusCurrentDistance(existing, now);
            }
            const measuredMs = (bus.timestamp - prevTimestamp) * 1000;
            const animDurationMs = Math.max(
              MIN_ANIM_DURATION_MS,
              Math.min(measuredMs, MAX_ANIM_DURATION_MS),
            );
            existing.offRoute = false;
            existing.prevDistance = seedPrev;
            existing.currentDistance = projection.targetDistanceAlongRoute;
            existing.animStartPerfMs = seedPrev !== null ? now : null;
            existing.animDurationMs = animDurationMs;
          } else {
            // Off-route: fall back to lat/lng LERP, reset interp buffer
            existing.offRoute = true;
            const cur = existing.marker.getLatLng();
            existing.correctionFromLat = cur.lat;
            existing.correctionFromLng = cur.lng;
            existing.correctionStartTime = now;
            existing.targetLat = bus.lat;
            existing.targetLng = bus.lng;
            existing.prevDistance = null;
            existing.currentDistance = null;
            existing.animStartPerfMs = null;
          }
        } else {
          // No shape data: lat/lng LERP fallback
          existing.offRoute = true;
          const cur = existing.marker.getLatLng();
          existing.correctionFromLat = cur.lat;
          existing.correctionFromLng = cur.lng;
          existing.correctionStartTime = now;
          existing.targetLat = bus.lat;
          existing.targetLng = bus.lng;
          existing.prevDistance = null;
          existing.currentDistance = null;
          existing.animStartPerfMs = null;
        }

        existing.bus = bus;
      } else {
        // New bus entry
        const now = performance.now();
        const marker = makeBusMarker(bus);
        cluster.addLayer(marker);

        let prevDistance: number | null = null;
        let currentDistance: number | null = null;
        let animStartPerfMs: number | null = null;
        let offRoute = true;

        if (lineInfo) {
          const projection = projectOntoRoute(
            bus.lat, bus.lng,
            lineInfo.routeLine, lineInfo.routeLengthMeters,
            null, null, now,
          );
          if (!projection.offRoute) {
            offRoute = false;
            currentDistance = projection.targetDistanceAlongRoute;
            // First ping: prev null, marker sits at currentDistance until ping 2.
          }
        }

        busMarkers.current.set(bus.tripId, {
          marker,
          bus,
          targetLat: bus.lat,
          targetLng: bus.lng,
          correctionFromLat: bus.lat,
          correctionFromLng: bus.lng,
          correctionStartTime: now,
          routeLine: lineInfo?.routeLine ?? null,
          routeLookup: lineInfo ? buildRouteLookup(lineInfo.routeLine) : null,
          routeLengthMeters: lineInfo?.routeLengthMeters ?? null,
          prevDistance,
          currentDistance,
          animStartPerfMs,
          animDurationMs: DEFAULT_ANIM_DURATION_MS,
          offRoute,
          settled: false,
          lastRenderedDistance: null,
          shapeId: null,
        });
      }
    }
    for (const [tripId, entry] of busMarkers.current) {
      if (!seen.has(tripId)) {
        cluster.removeLayer(entry.marker);
        busMarkers.current.delete(tripId);
      }
    }

    // Recompute the set of shape_ids actually in service right now from the
    // live vehicle list. Variants whose shape isn't in this set fade to 0
    // in applyVariantStyles. If the currently-selected shape drops out of
    // service (e.g. the only industrial 38 finishes its trip), clear the
    // selection too so we don't keep highlighting a pattern that isn't
    // running.
    const nextActive = new Set<string>();
    for (const b of filteredBuses) {
      if (b.shapeId) nextActive.add(b.shapeId);
    }
    activeShapeIdsRef.current = nextActive;
    selectedShapeIdRef.current = reconcileSelectedVariant(selectedShapeIdRef.current, nextActive);
    applyVariantStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buses, mode, busShape, busDirection, busOperator]);

  // -------------------------------------------------------------------------
  // Bus shape polyline + stop markers sync
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    if (busShapeLayerRef.current) {
      map.removeLayer(busShapeLayerRef.current);
      busShapeLayerRef.current = null;
    }

    if (routeEndMarkerRef.current) {
      map.removeLayer(routeEndMarkerRef.current);
      routeEndMarkerRef.current = null;
    }

    for (const m of busStopMarkersRef.current) map.removeLayer(m);
    busStopMarkersRef.current = [];

    // Tear down variant branch polylines from the previous route+direction.
    for (const polylines of Object.values(variantLayersRef.current)) {
      for (const pl of polylines) map.removeLayer(pl);
    }
    variantLayersRef.current = {};
    selectedShapeIdRef.current = null;

    if (mode !== "bus" || !busShape || !busDirection) return;

    const dirData = busShape[busDirection];
    if (!dirData || dirData.coords.length < 2) return;

    const routeColor = busRouteColor(busOperator);

    busShapeLayerRef.current = L.polyline(dirData.coords, {
      color: routeColor,
      weight: 6,
      opacity: 0.85,
    }).addTo(map);

    // Terminus ring marker — single visual cue for "this end is the destination".
    // Coords come from the GTFS shape (road points), not stop locations, so
    // anchor on the last stop in dirData.stops if available, otherwise fall
    // back to the polyline's last vertex.
    const lastStop = dirData.stops?.[dirData.stops.length - 1];
    const endLatLng: [number, number] | null = lastStop
      ? [lastStop.lat, lastStop.lng]
      : (dirData.coords[dirData.coords.length - 1] ?? null);
    if (endLatLng) {
      const ringSvg = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" fill="#fff" stroke="${routeColor}" stroke-width="3"/><circle cx="12" cy="12" r="3" fill="${routeColor}"/></svg>`;
      routeEndMarkerRef.current = L.marker(endLatLng, {
        icon: L.divIcon({
          className: "route-end-marker",
          html: ringSvg,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        zIndexOffset: 800,
      })
        .bindTooltip(dirData.headsign, {
          direction: "top",
          offset: [0, -10],
          className: "stop-tooltip",
          opacity: 1,
        })
        .addTo(map);
    }

    // Variant branches: drawn once here as faint overlays above the main line
    // but below the stop markers. interactive:false so clicks pass through to
    // the map.click handler that clears the highlight.
    const variants = dirData.variants ?? [];
    const newVariantLayers: Record<string, L.Polyline[]> = {};
    for (const v of variants) {
      const polylines: L.Polyline[] = [];
      for (const branch of v.branches) {
        if (branch.length < 2) continue;
        const pl = L.polyline(branch, {
          color: routeColor,
          weight: 3,
          opacity: 0.35,
          interactive: false,
        }).addTo(map);
        polylines.push(pl);
      }
      if (polylines.length > 0) newVariantLayers[v.shapeId] = polylines;
    }
    variantLayersRef.current = newVariantLayers;
    // Immediately reconcile opacity with the currently-running shape set —
    // otherwise new variants display at the default 0.35 until the next
    // buses update fires applyVariantStyles.
    applyVariantStyles();

    // Frame the route so a search or popup "Show all" from off-route gives
    // the user immediate context — otherwise the polyline draws somewhere
    // they can't see and they don't know anything happened.
    map.flyToBounds(busShapeLayerRef.current.getBounds(), {
      paddingTopLeft: [20, 40],
      paddingBottomRight: [20, 60],
      duration: 1.5,
      easeLinearity: 0.3,
    });

    const stopsVisible = map.getZoom() >= STOP_MIN_ZOOM;
    for (const stop of dirData.stops ?? []) {
      const m = L.circleMarker([stop.lat, stop.lng], {
        radius: 6,
        color: routeColor,
        weight: 2.5,
        fillColor: "#fff",
        fillOpacity: 1,
      });
      m.bindTooltip(stop.name, {
        direction: "top",
        offset: [0, -8],
        className: "stop-tooltip",
        opacity: 1,
      });
      if (stopsVisible) m.addTo(map);
      busStopMarkersRef.current.push(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busShape, busDirection, mode]);

  // -------------------------------------------------------------------------
  // Map click → clear variant highlight. Intentionally NOT listening to
  // popupclose: markercluster re-anchoring fires spurious popupclose events
  // and we'd drop the highlight mid-interaction. A real click on the map
  // canvas is the explicit "deselect" signal.
  //
  // Depends on busShape too so the effect re-runs once a route is selected —
  // guards the cold-start race where leafletMap.current hasn't been assigned
  // yet on first render in bus mode.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = leafletMap.current;
    if (!map || mode !== "bus") return;
    const onClick = () => clearVariantHighlight();
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, busShape]);

  // -------------------------------------------------------------------------
  // Stop marker zoom gating: add/remove from map based on current zoom.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const map = leafletMap.current;
    if (!map || mode !== "bus") return;
    const onZoomEnd = () => {
      const visible = map.getZoom() >= STOP_MIN_ZOOM;
      for (const m of busStopMarkersRef.current) {
        const onMap = map.hasLayer(m);
        if (visible && !onMap) m.addTo(map);
        else if (!visible && onMap) map.removeLayer(m);
      }
    };
    map.on("zoomend", onZoomEnd);
    return () => {
      map.off("zoomend", onZoomEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, busShape]);

  return { busMarkers, busShapeLayerRef, busStopMarkersRef };
}
