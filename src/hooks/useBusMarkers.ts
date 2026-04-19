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

// ---------------------------------------------------------------------------
// Interpolation entry type
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

interface UseBusMarkersOptions {
  buses: BusVehicle[];
  busShape: { [direction: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[] } } | null;
  busDirection: string | null;
  busOperator: BusOperator;
  mode: Mode;
  currentBusRoute: string | null;
  onSelectBusRoute: React.RefObject<((route: string, direction: string) => void) | undefined>;
  leafletMap: React.RefObject<L.Map | null>;
  busClusterLayer: React.RefObject<L.MarkerClusterGroup | null>;
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

  // Stable ref so closures always read the latest callback without stale captures
  const onSelectBusRouteRef = onSelectBusRoute;
  const currentBusRouteRef = useRef(currentBusRoute);
  currentBusRouteRef.current = currentBusRoute;
  const busOperatorRef = useRef(busOperator);
  busOperatorRef.current = busOperator;

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
    return `
      <div class="popup-content">
        <div class="popup-header-row">
          <div class="popup-title">${escapeHtml(bus.routeShortName)}</div>
          ${jumpBtn}
        </div>
        ${originDest}
        ${metaHtml}
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
      if (route && dir) onSelectBusRouteRef.current?.(route, dir);
    });
  }

  function scrollPopupToCurrent(marker: L.Marker) {
    requestAnimationFrame(() => {
      const root = (marker.getPopup()?.getElement?.() ?? document) as ParentNode;
      const wrap = root.querySelector(".popup-table-wrap") as HTMLElement | null;
      const current = root.querySelector("tr.movement-current") as HTMLElement | null;
      if (wrap && current) {
        wrap.scrollTop = current.offsetTop - wrap.offsetTop;
      }
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
    const op = busOperatorRef.current;
    const operatorClass =
      op === "buseireann" ? "bus-marker--buseireann" :
      op === "goahead" ? "bus-marker--goahead" :
      "";
    const icon = L.divIcon({
      className: `bus-marker ${operatorClass}`.trim(),
      html: `<div class="bus-triangle"></div><div class="bus-label">${escapeHtml(bus.routeShortName)}</div>`,
      iconSize: [40, 20],
      iconAnchor: [20, 10],
    });
    const marker = L.marker([bus.lat, bus.lng], { icon });
    marker.bindPopup(buildBusPopupHTML(bus, null), {
      maxWidth: 520,
      minWidth: 360,
      autoPan: false,
    });
    marker.on("popupopen", () => {
      const popup = marker.getPopup();
      if (popup) wireRouteJumpButton(popup);
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

    const seen = new Set<string>();
    for (const bus of buses) {
      seen.add(bus.tripId);

      const dirKey = String(bus.directionId);
      const dirData = shape?.[dirKey];
      const lineInfo = dirData ? buildRouteLine(dirData.coords) : null;

      const existing = busMarkers.current.get(bus.tripId);
      if (existing) {
        const now = performance.now();
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
        });
      }
    }
    for (const [tripId, entry] of busMarkers.current) {
      if (!seen.has(tripId)) {
        cluster.removeLayer(entry.marker);
        busMarkers.current.delete(tripId);
      }
    }
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

    if (mode !== "bus" || !busShape || !busDirection) return;

    const dirData = busShape[busDirection];
    if (!dirData || dirData.coords.length < 2) return;

    const routeColor =
      busOperator === "buseireann" ? "#d52b1e" :
      busOperator === "goahead" ? "#1e6bb8" :
      "#f9a825";

    busShapeLayerRef.current = L.polyline(dirData.coords, {
      color: routeColor,
      weight: 4,
      opacity: 0.85,
    }).addTo(map);

    for (const stop of dirData.stops ?? []) {
      const m = L.circleMarker([stop.lat, stop.lng], {
        radius: 5,
        color: routeColor,
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      });
      m.bindTooltip(stop.name, {
        direction: "top",
        offset: [0, -4],
        className: "stop-tooltip",
        opacity: 1,
      });
      m.addTo(map);
      busStopMarkersRef.current.push(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busShape, busDirection, mode]);

  return { busMarkers, busShapeLayerRef, busStopMarkersRef };
}
