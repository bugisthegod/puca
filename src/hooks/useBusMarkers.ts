import { useRef, useEffect } from "react";
import type { BusVehicle, BusOperator } from "../types";
import type { Feature, LineString } from "geojson";
import { buildRouteLine, projectOntoRoute } from "./routeProjection";
import { escapeHtml } from "../utils";
import type { Mode } from "./useTrainMap";

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

// Inline Púca jack-o'-lantern face used by the stale-trip marker and popup
// banner. Mirrors public/puca-jack-o.svg — duplicated as a raw SVG string
// because Leaflet divIcons and popup HTML can't render React components or
// follow build-time CSS url() imports for files served at runtime.
const PUCA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><g transform="translate(56 52) scale(0.78)"><path d="M 112 152 C 112 88, 168 72, 220 72 L 292 72 C 344 72, 400 88, 400 152 L 400 392 Q 376 444, 340 416 Q 304 390, 272 416 Q 240 442, 210 416 Q 180 390, 148 416 Q 118 442, 112 396 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 110 260 C 70 256, 54 292, 64 324 C 74 348, 104 346, 116 330 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 402 260 C 442 256, 458 292, 448 324 C 438 348, 408 346, 396 330 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 168 208 L 228 232 L 214 272 L 168 276 Z" fill="#16161c"/><path d="M 344 208 L 284 232 L 298 272 L 344 276 Z" fill="#16161c"/><path d="M 214 310 L 228 296 L 242 312 L 256 298 L 270 312 L 284 298 L 298 310 L 298 338 L 284 352 L 270 336 L 256 350 L 242 336 L 228 352 L 214 338 Z" fill="#16161c"/></g></svg>`;

// Side-view bus silhouette for vehicle markers. Body fill uses currentColor so
// per-operator CSS can drive the color via .bus-marker--*.bus-icon { color: ... }.
const BUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 3 Q2 1 4 1 H20 Q22 1 22 3 V12 H2 Z" fill="currentColor"/><rect x="3.5" y="3" width="17" height="3.6" fill="rgba(255,255,255,0.92)" rx="0.5"/><line x1="8" y1="3" x2="8" y2="6.6" stroke="currentColor" stroke-width="0.6"/><line x1="13" y1="3" x2="13" y2="6.6" stroke="currentColor" stroke-width="0.6"/><line x1="18" y1="3" x2="18" y2="6.6" stroke="currentColor" stroke-width="0.6"/><circle cx="6.5" cy="13" r="2" fill="#1a1a1a"/><circle cx="17.5" cy="13" r="2" fill="#1a1a1a"/></svg>`;

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
  pathSpeedMps: number;                    // speed along path, m/s
  lastPingTime: number | null;             // when the last GPS ping was processed (performance.now ms)
  offRoute: boolean;                       // true when GPS >150m from polyline
  // Render-skip flags: avoid redundant setLatLng + along() when position hasn't changed.
  settled: boolean;                        // LERP branch: true after blend completed and target rendered
  lastRenderedDistance: number | null;     // path-constrained branch: last clamped distance written to DOM
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
  function currentRouteColor(): string {
    const op = busOperatorRef.current;
    return op === "buseireann" ? "#d52b1e" : op === "goahead" ? "#1e6bb8" : "#f9a825";
  }

  function applyVariantStyles() {
    const color = currentRouteColor();
    const selected = selectedShapeIdRef.current;
    const active = activeShapeIdsRef.current;
    for (const [shapeId, polylines] of Object.entries(variantLayersRef.current)) {
      const isSelected = shapeId === selected;
      const isActive = active.has(shapeId);
      // Selected wins over inactive — if the user clicked a bus and its shape
      // subsequently leaves the active set (trip ended, bus gone), the
      // buses useEffect clears selectedShapeIdRef below, so we won't end up
      // highlighting something that no longer exists.
      const opacity = isSelected ? 0.95 : isActive ? 0.35 : 0;
      const weight = isSelected ? 5 : 3;
      for (const pl of polylines) {
        pl.setStyle({ color, weight, opacity });
        if (isSelected) pl.bringToFront();
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

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function statusFromDelay(sec: number | null): { text: string; cls: string } {
    if (sec === null) return { text: "", cls: "" };
    const min = Math.round(sec / 60);
    if (min <= 0) {
      const early = Math.abs(min);
      return {
        text: early >= 1 ? `On time (${early} min${early !== 1 ? "s" : ""} early)` : "On time",
        cls: "",
      };
    }
    return {
      text: `${min} min${min !== 1 ? "s" : ""} late`,
      cls: min >= 10 ? "popup-status--red" : "popup-status--yellow",
    };
  }

  function fmtSec(sec: number | null): string {
    if (sec === null) return "—";
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  type BusTripStop = {
    sequence: number;
    name: string;
    lat: number;
    lng: number;
    scheduledArrivalSec: number | null;
    expectedArrivalSec: number | null;
    arrivalDelaySec: number | null;
    isCurrent?: boolean;
  };

  function buildBusPopupHTML(bus: BusVehicle, trip: { stops: BusTripStop[] } | null): string {
    const loading = trip === null;
    let currentIdx = -1;
    if (trip) {
      let minDistSq = Infinity;
      for (let i = 0; i < trip.stops.length; i++) {
        const s = trip.stops[i];
        if (!s || (s.lat === 0 && s.lng === 0)) continue;
        const dLat = s.lat - bus.lat;
        const dLng = s.lng - bus.lng;
        const d = dLat * dLat + dLng * dLng;
        if (d < minDistSq) { minDistSq = d; currentIdx = i; }
      }
    }
    const rows = trip
      ? trip.stops
          .map((s, i) => {
            const isCurrent = i === currentIdx;
            return `
            <tr class="${isCurrent ? "movement-current" : ""}">
              <td>${s.sequence}${isCurrent ? " ▶" : ""}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${fmtSec(s.scheduledArrivalSec)}</td>
              <td>${fmtSec(s.expectedArrivalSec)}</td>
            </tr>
          `;
          })
          .join("")
      : "";
    const body = loading
      ? `<div class="popup-loading">Loading stops…</div>`
      : trip && trip.stops.length > 0
        ? `<div class="popup-table-wrap">
             <table class="movements-table">
               <thead>
                 <tr><th>#</th><th>Stop</th><th>Sched</th><th>Exp</th></tr>
               </thead>
               <tbody>${rows}</tbody>
             </table>
           </div>`
        : `<div class="popup-message">No upcoming stop data available.</div>`;
    const showJump = onSelectBusRouteRef.current && currentBusRouteRef.current !== bus.routeShortName;
    const jumpBtn = showJump
      ? `<button class="popup-route-jump" type="button" data-route="${encodeURIComponent(bus.routeShortName)}" data-dir="${bus.directionId}">Show all ${escapeHtml(bus.routeShortName)}</button>`
      : "";
    const stops = trip?.stops ?? [];
    const originDest = stops.length >= 2
      ? `<div class="popup-route">${escapeHtml(stops[0]!.name)} → ${escapeHtml(stops[stops.length - 1]!.name)}</div>`
      : "";
    const currentStop = trip && currentIdx >= 0 ? trip.stops[currentIdx] : null;
    const status = statusFromDelay(currentStop?.arrivalDelaySec ?? null);
    const vehicleLabel = escapeHtml(bus.label || bus.tripId);
    const metaHtml = `
      <div class="popup-meta">
        ${status.text ? `<span class="popup-status ${status.cls}">${status.text}</span>` : ""}
        <span class="popup-dir">Vehicle ${vehicleLabel}</span>
      </div>
    `;
    const staleBanner = bus.stale
      ? `<div class="popup-stale-banner">
           <div class="popup-stale-icon">${PUCA_SVG}</div>
           <div class="popup-stale-text">
             <strong>Púca ran off with this bus</strong>
             <span>Heh heh, times below may be off.</span>
           </div>
         </div>`
      : "";
    return `
      <div class="popup-content">
        <div class="popup-header-row">
          <div class="popup-title">${escapeHtml(bus.routeShortName)}</div>
          ${jumpBtn}
        </div>
        ${originDest}
        ${metaHtml}
        ${staleBanner}
        ${body}
      </div>
    `;
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

  function makeBusIcon(bus: BusVehicle): L.DivIcon {
    const op = busOperatorRef.current;
    const operatorClass =
      op === "buseireann" ? "bus-marker--buseireann" :
      op === "goahead" ? "bus-marker--goahead" :
      "";
    const classes = ["bus-marker", operatorClass, bus.stale ? "bus-marker--stale" : ""]
      .filter(Boolean).join(" ");
    const label = `<div class="bus-label">${escapeHtml(bus.routeShortName)}</div>`;
    const body = bus.stale
      ? `<div class="bus-puca">${PUCA_SVG}</div>${label}`
      : `<div class="bus-icon">${BUS_SVG}</div>${label}`;
    return L.divIcon({
      className: classes,
      html: body,
      iconSize: bus.stale ? [44, 52] : [44, 30],
      iconAnchor: bus.stale ? [22, 26] : [22, 15],
    });
  }

  function makeBusMarker(bus: BusVehicle): L.Marker {
    const marker = L.marker([bus.lat, bus.lng], { icon: makeBusIcon(bus) });
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
        // If the trip just tipped past the stale threshold (or came back), swap
        // the icon to match — otherwise the Puca/bus icon doesn't update until
        // NTA reassigns the tripId and a fresh marker gets created.
        if (existing.bus.stale !== bus.stale) {
          existing.marker.setIcon(makeBusIcon(bus));
        }
        // Backdate the ping to the GPS capture time so RAF's (tickNow - lastPingTime)
        // reflects real elapsed time since the bus was actually at that location —
        // otherwise the marker starts extrapolating only when the data reaches us,
        // which is 30-60s late, causing visible freezes between updates.
        const staleness = Math.max(0, Date.now() - bus.timestamp * 1000);
        const pingPerfTime = now - staleness;
        // Any ping invalidates the render-skip cache — at minimum the extrap
        // window extends, so the next tick needs to recompute.
        existing.settled = false;
        existing.lastRenderedDistance = null;

        // Backfill routeLine if we now have shape data but didn't before
        if (!existing.routeLine && lineInfo) {
          existing.routeLine = lineInfo.routeLine;
          existing.routeLengthMeters = lineInfo.routeLengthMeters;
        }

        const rl = existing.routeLine;
        const rlm = existing.routeLengthMeters;
        if (rl && rlm !== null) {
          const projection = projectOntoRoute(
            bus.lat, bus.lng,
            rl, rlm,
            existing.targetDistanceAlongRoute,
            existing.lastPingTime,
            pingPerfTime,
          );
          if (!projection.offRoute) {
            existing.offRoute = false;
            // Set distanceAtPing to the current rendered position along the route
            // (clamped to the new target). On first ping just teleport to the projected point.
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
            // Off-route: fall back to LERP
            existing.offRoute = true;
            existing.velocityLat = 0;
            existing.velocityLng = 0;
            const cur = existing.marker.getLatLng();
            existing.correctionFromLat = cur.lat;
            existing.correctionFromLng = cur.lng;
            existing.correctionStartTime = now;
            existing.targetLat = bus.lat;
            existing.targetLng = bus.lng;
          }
        } else {
          // No shape data: LERP fallback
          existing.offRoute = true;
          existing.velocityLat = 0;
          existing.velocityLng = 0;
          const cur = existing.marker.getLatLng();
          existing.correctionFromLat = cur.lat;
          existing.correctionFromLng = cur.lng;
          existing.correctionStartTime = now;
          existing.targetLat = bus.lat;
          existing.targetLng = bus.lng;
        }

        existing.lastUpdateTime = now;
        existing.bus = bus;
      } else {
        // New bus entry
        const now = performance.now();
        const staleness = Math.max(0, Date.now() - bus.timestamp * 1000);
        const pingPerfTime = now - staleness;
        const marker = makeBusMarker(bus);
        cluster.addLayer(marker);

        let distanceAtPing: number | null = null;
        let offRoute = true;
        let targetDistanceAlongRoute: number | null = null;
        let pathSpeedMps = 0;
        let lastPingTime: number | null = null;

        if (lineInfo) {
          const projection = projectOntoRoute(
            bus.lat, bus.lng,
            lineInfo.routeLine, lineInfo.routeLengthMeters,
            null, null, pingPerfTime,
          );
          if (!projection.offRoute) {
            offRoute = false;
            distanceAtPing = projection.targetDistanceAlongRoute;
            targetDistanceAlongRoute = projection.targetDistanceAlongRoute;
            pathSpeedMps = 0; // first ping — no speed yet
            lastPingTime = projection.lastPingTime;
          }
        }

        busMarkers.current.set(bus.tripId, {
          marker,
          bus,
          targetLat: bus.lat,
          targetLng: bus.lng,
          velocityLat: 0,
          velocityLng: 0,
          lastUpdateTime: now,
          correctionFromLat: bus.lat,
          correctionFromLng: bus.lng,
          correctionStartTime: now,
          routeLine: lineInfo?.routeLine ?? null,
          routeLengthMeters: lineInfo?.routeLengthMeters ?? null,
          distanceAtPing,
          targetDistanceAlongRoute,
          pathSpeedMps,
          lastPingTime,
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
    if (selectedShapeIdRef.current && !nextActive.has(selectedShapeIdRef.current)) {
      selectedShapeIdRef.current = null;
    }
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

    const routeColor =
      busOperator === "buseireann" ? "#d52b1e" :
      busOperator === "goahead" ? "#1e6bb8" :
      "#f9a825";

    busShapeLayerRef.current = L.polyline(dirData.coords, {
      color: routeColor,
      weight: 6,
      opacity: 0.85,
    }).addTo(map);

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
      duration: 1.1,
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
