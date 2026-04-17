declare var L: any;

import { useRef, useEffect, type RefObject } from "react";
import type { Train, TrainMovement, Station, BusVehicle, BusOperator } from "../types";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import along from "@turf/along";
import length from "@turf/length";
import { lineString } from "@turf/helpers";
import type { Feature, LineString } from "geojson";

export type Mode = "train" | "bus";
import {
  markerColor,
  trainCategory,
  parseLateMinutes,
  parseRoute,
  fmtTime,
  type Filter,
} from "../utils";

// ---------------------------------------------------------------------------
// Module-level train shape cache (survives across renders / updates)
// ---------------------------------------------------------------------------

type TrainShapeCacheEntry =
  | { routeLine: Feature<LineString>; routeLengthMeters: number }
  | "not-found";

const trainShapeCache = new Map<string, TrainShapeCacheEntry>();
const trainShapeInFlight = new Map<string, Promise<{ routeLine: Feature<LineString>; routeLengthMeters: number } | null>>();

// ---------------------------------------------------------------------------
// Popup HTML builders
// ---------------------------------------------------------------------------

function lateClass(status: string, late: number | null): string {
  if (status === "N" || status === "T") return "";
  if (late === null || late <= 0) return "";
  if (late >= 10) return "popup-status--red";
  return "popup-status--yellow";
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
      <div class="popup-title">${train.code}</div>
      ${route ? `<div class="popup-route">${route.origin} → ${route.destination}</div>` : ""}
      <div class="popup-meta">
        <span class="popup-status ${lateClass(train.status, late)}">${statusText}</span>
        ${train.direction ? `<span class="popup-dir">${train.direction}</span>` : ""}
      </div>
      <div class="popup-message">${train.message.replace(/\n/g, "<br>")}</div>
      <div class="popup-loading">Loading movements…</div>
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
          <td>${m.stationName}${isCurrent ? " ▶" : ""}</td>
          <td>${stopTypeLabel[m.stopType] ?? m.stopType}</td>
          <td>${showArr}</td>
          <td>${showDep}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="popup-content">
      <div class="popup-title">${train.code}</div>
      ${route ? `<div class="popup-route">${route.origin} → ${route.destination}</div>` : ""}
      <div class="popup-meta">
        <span class="popup-status ${lateClass(train.status, late)}">${statusText}</span>
        ${train.direction ? `<span class="popup-dir">${train.direction}</span>` : ""}
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
          : `<div class="popup-message">${train.message.replace(/\n/g, "<br>")}</div>`
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Interpolation engine
// ---------------------------------------------------------------------------

const BLEND_DURATION = 1500;  // ms to blend from correction to extrapolation
const EXTRAP_CAP = 35_000;    // stop extrapolating after 35s without update

interface TrainMarkerEntry {
  marker: any;
  train: Train;
  targetLat: number;
  targetLng: number;
  velocityLat: number;
  velocityLng: number;
  lastUpdateTime: number;
  correctionFromLat: number;
  correctionFromLng: number;
  correctionStartTime: number;
  // Path-constrained interpolation fields
  routeLine: Feature<LineString> | null;
  routeLengthMeters: number | null;
  distanceAtPing: number | null;           // distance along route at the moment of last GPS ping
  targetDistanceAlongRoute: number | null; // projected distance from latest GPS, meters
  pathSpeedMps: number;                    // speed along path, m/s (clamped 0–50)
  lastPingTime: number | null;             // when the last GPS ping was processed (performance.now ms)
  offRoute: boolean;                       // true when GPS >500m from polyline
  originDestKey: string | null;            // "origin_lower|dest_lower" — used to dedupe shape fetches
}

interface BusMarkerEntry {
  marker: any;
  bus: BusVehicle;
  targetLat: number;
  targetLng: number;
  velocityLat: number;
  velocityLng: number;
  lastUpdateTime: number;
  correctionFromLat: number;
  correctionFromLng: number;
  correctionStartTime: number;
  // Path-constrained interpolation fields
  routeLine: Feature<LineString> | null;
  routeLengthMeters: number | null;
  distanceAtPing: number | null;           // distance along route at the moment of last GPS ping
  targetDistanceAlongRoute: number | null; // projected distance from latest GPS, meters
  pathSpeedMps: number;                    // speed along path, m/s
  lastPingTime: number | null;             // when the last GPS ping was processed (performance.now ms)
  offRoute: boolean;                       // true when GPS >150m from polyline
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTrainMap(
  mapRef: RefObject<HTMLDivElement | null>,
  trains: Train[],
  filter: Filter,
  searchCodes: string[] | null = null,
  mode: Mode = "train",
  buses: BusVehicle[] = [],
  busShape: { [direction: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[] } } | null = null,
  busDirection: string | null = null,
  busOperator: BusOperator = "dublinbus"
): { focusTrain: (code: string) => void } {
  const leafletMap = useRef<any>(null);
  const markers = useRef<Map<string, TrainMarkerEntry>>(new Map());
  const busMarkers = useRef<Map<string, BusMarkerEntry>>(new Map());
  const railwayLayerRef = useRef<any>(null);
  const busShapeLayerRef = useRef<any>(null);
  const busStopMarkersRef = useRef<any[]>([]);
  const rafId = useRef<number>(0);
  const zooming = useRef<boolean>(false);
  const filterRef = useRef<Filter>(filter);
  filterRef.current = filter;
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const searchCodesRef = useRef<string[] | null>(searchCodes);
  searchCodesRef.current = searchCodes;
  const stationsRef = useRef<Map<string, Station>>(new Map());
  const routeLineRef = useRef<any>(null);

  // -------------------------------------------------------------------------
  // Helpers that close over refs
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

  function makeBusMarker(bus: BusVehicle): any {
    const operatorClass =
      busOperator === "buseireann" ? "bus-marker--buseireann" :
      busOperator === "goahead" ? "bus-marker--goahead" :
      "";
    const icon = L.divIcon({
      className: `bus-marker ${operatorClass}`.trim(),
      html: `<div class="bus-triangle"></div><div class="bus-label">${bus.routeShortName}</div>`,
      iconSize: [40, 20],
      iconAnchor: [20, 10],
    });
    const marker = L.marker([bus.lat, bus.lng], { icon });
    marker.bindPopup(buildBusPopupHTML(bus, null), {
      maxWidth: 520,
      minWidth: 360,
      autoPan: false,
    });
    marker.on("popupopen", () => loadBusTrip(bus, marker));
    return marker;
  }

  function fmtDelay(sec: number | null): string {
    if (sec === null) return "—";
    if (Math.abs(sec) < 60) return "on time";
    const min = Math.round(sec / 60);
    return min > 0 ? `${min} min late` : `${Math.abs(min)} min early`;
  }

  function delayClass(sec: number | null): string {
    if (sec === null || Math.abs(sec) < 60) return "";
    const min = Math.round(sec / 60);
    if (min <= 0) return "";
    if (min >= 10) return "delay-red";
    return "delay-yellow";
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
              <td>${s.name}</td>
              <td>${fmtSec(s.scheduledArrivalSec)}</td>
              <td>${fmtSec(s.expectedArrivalSec)}</td>
              <td class="${delayClass(s.arrivalDelaySec)}">${fmtDelay(s.arrivalDelaySec)}</td>
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
                 <tr><th>#</th><th>Stop</th><th>Sched</th><th>Exp</th><th>Delay</th></tr>
               </thead>
               <tbody>${rows}</tbody>
             </table>
           </div>`
        : `<div class="popup-message">No upcoming stop data available.</div>`;
    return `
      <div class="popup-content">
        <div class="popup-title">${bus.routeShortName}</div>
        <div class="popup-route">Vehicle ${bus.label || bus.tripId}</div>
        ${body}
      </div>
    `;
  }

  async function loadBusTrip(bus: BusVehicle, marker: any) {
    try {
      const res = await fetch(`/api/bus/trip/${encodeURIComponent(bus.tripId)}?operator=${encodeURIComponent(busOperator)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const trip = await res.json();
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(buildBusPopupHTML(bus, trip.stops ? trip : null));
        requestAnimationFrame(() => {
          const wrap = document.querySelector(".popup-table-wrap");
          const current = document.querySelector("tr.movement-current");
          if (wrap && current) {
            const rowTop = (current as HTMLElement).offsetTop - (wrap as HTMLElement).offsetTop;
            wrap.scrollTop = rowTop;
          }
        });
      }
    } catch {
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(buildBusPopupHTML(bus, { stops: [] }));
      }
    }
  }

  function makeCircleMarker(train: Train): any {
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

  function clearRouteLine() {
    const map = leafletMap.current;
    if (routeLineRef.current && map) {
      map.removeLayer(routeLineRef.current);
      routeLineRef.current = null;
    }
  }

  async function onMarkerClick(trainCode: string) {
    const entry = markers.current.get(trainCode);
    if (!entry) return;

    const { marker, train } = entry;

    // Clear any existing route line before drawing a new one
    clearRouteLine();

    // Bind and open popup immediately with initial content
    marker.bindPopup(buildPopupHTML(train), { maxWidth: 520, minWidth: 380, autoPan: false }).openPopup();

    // Fetch detailed movements in the background
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
            }).addTo(map);
          }
        }
      }
    } catch {
      const entry = markers.current.get(trainCode);
      if (!entry) return;
      const popup = entry.marker.getPopup();
      if (popup && popup.isOpen()) {
        popup.setContent(
          buildPopupHTML(entry.train).replace(
            "Loading movements…",
            "Could not load movement data."
          )
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // RAF tick — reads from refs only
  // -------------------------------------------------------------------------

  function tickAllMarkers(now: number) {
    const map = leafletMap.current;
    if (!map || zooming.current) {
      rafId.current = requestAnimationFrame(tickAllMarkers);
      return;
    }

    // Train interpolation: path-constrained when on-route, velocity-based fallback otherwise
    const TRAIN_EXTRAP_BUFFER_METERS = 5000; // trains are fast + station updates rare; allow generous lookahead
    function interpolateTrain(entry: TrainMarkerEntry) {
      if (!map.hasLayer(entry.marker)) return;

      // Use path-constrained movement if we have a route line and are on-route
      if (
        !entry.offRoute &&
        entry.routeLine &&
        entry.routeLengthMeters !== null &&
        entry.distanceAtPing !== null &&
        entry.targetDistanceAlongRoute !== null &&
        entry.lastPingTime !== null
      ) {
        const dtSec = (now - entry.lastPingTime) / 1000;
        const advanced = entry.distanceAtPing + entry.pathSpeedMps * dtSec;
        // Cap lookahead: don't run ahead more than TRAIN_EXTRAP_BUFFER_METERS past
        // the last known GPS position (prevents runaway if pings stop)
        const capped = Math.min(advanced, entry.targetDistanceAlongRoute + TRAIN_EXTRAP_BUFFER_METERS);
        const clamped = Math.max(0, Math.min(capped, entry.routeLengthMeters));
        try {
          const pt = along(entry.routeLine, clamped / 1000, { units: "kilometers" });
          const [lng, lat] = pt.geometry.coordinates as [number, number];
          entry.marker.setLatLng([lat, lng]);
        } catch {
          // along() can throw at/beyond end of line — stay put
        }
        return;
      }

      // Fallback: velocity-based extrapolation + correction blend
      // Used for trains without a known route (charter/unmapped) or off-route ones.
      const dt = Math.min(now - entry.lastUpdateTime, EXTRAP_CAP);
      const extrapLat = entry.targetLat + entry.velocityLat * dt;
      const extrapLng = entry.targetLng + entry.velocityLng * dt;
      const blendElapsed = now - entry.correctionStartTime;
      if (blendElapsed < BLEND_DURATION) {
        const t = blendElapsed / BLEND_DURATION;
        const ease = 1 - (1 - t) * (1 - t);
        const lat = entry.correctionFromLat + (extrapLat - entry.correctionFromLat) * ease;
        const lng = entry.correctionFromLng + (extrapLng - entry.correctionFromLng) * ease;
        entry.marker.setLatLng([lat, lng]);
      } else {
        entry.marker.setLatLng([extrapLat, extrapLng]);
      }
    }

    // Bus interpolation: path-constrained when on-route, LERP fallback when off-route
    function interpolateBus(entry: BusMarkerEntry) {
      if (!map.hasLayer(entry.marker)) return;

      // Use path-constrained movement if we have a route line and are on-route
      if (!entry.offRoute && entry.routeLine && entry.routeLengthMeters !== null && entry.distanceAtPing !== null && entry.targetDistanceAlongRoute !== null && entry.lastPingTime !== null) {
        const dtSec = (now - entry.lastPingTime) / 1000;
        const advanced = entry.distanceAtPing + entry.pathSpeedMps * dtSec;
        // Don't overshoot the known GPS position by more than 150m (prevents runaway
        // extrapolation if pings stop, while still covering most of a ~30s ping cycle
        // at typical city bus speeds of ~5-10 m/s)
        const capped = Math.min(advanced, entry.targetDistanceAlongRoute + 150);
        const clamped = Math.max(0, Math.min(capped, entry.routeLengthMeters));
        try {
          const pt = along(entry.routeLine, clamped / 1000, { units: "kilometers" });
          const [lng, lat] = pt.geometry.coordinates as [number, number];
          entry.marker.setLatLng([lat, lng]);
        } catch {
          // along() can throw if distance is at or beyond end of line; just stay put
        }
        return;
      }

      // Fallback: LERP blend from correctionFrom to target (no velocity for buses)
      const blendElapsed = now - entry.correctionStartTime;
      if (blendElapsed < BLEND_DURATION) {
        const t = blendElapsed / BLEND_DURATION;
        const ease = 1 - (1 - t) * (1 - t);
        const lat = entry.correctionFromLat + (entry.targetLat - entry.correctionFromLat) * ease;
        const lng = entry.correctionFromLng + (entry.targetLng - entry.correctionFromLng) * ease;
        entry.marker.setLatLng([lat, lng]);
      } else {
        entry.marker.setLatLng([entry.targetLat, entry.targetLng]);
      }
    }

    for (const [, entry] of markers.current) interpolateTrain(entry);
    for (const [, entry] of busMarkers.current) interpolateBus(entry);

    rafId.current = requestAnimationFrame(tickAllMarkers);
  }

  // -------------------------------------------------------------------------
  // Mount / unmount — init Leaflet map, start RAF
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!mapRef.current) return;

    const map = L.map(mapRef.current, {
      preferCanvas: true,
      fadeAnimation: false,
    }).setView([53.35, -6.26], 8);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: "abcd",
      keepBuffer: 10,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateInterval: 100,
    }).addTo(map);

    // Railway lines overlay (only in train mode)
    railwayLayerRef.current = L.tileLayer("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
      maxZoom: 19,
      opacity: 0.75,
      keepBuffer: 10,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateInterval: 100,
    });
    if (modeRef.current === "train") railwayLayerRef.current.addTo(map);

    map.on("zoomstart", () => { zooming.current = true; });
    map.on("zoomend", () => { zooming.current = false; });
    map.on("popupclose", () => clearRouteLine());

    // Load stations for route line drawing
    fetch("/api/stations")
      .then((r) => r.json())
      .then((data: Station[]) => {
        const m = new Map<string, Station>();
        for (const s of data) m.set(s.code, s);
        stationsRef.current = m;
      })
      .catch(() => {});

    leafletMap.current = map;
    rafId.current = requestAnimationFrame(tickAllMarkers);

    return () => {
      cancelAnimationFrame(rafId.current);
      clearRouteLine();
      map.remove();
      leafletMap.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Update markers when trains data changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const train of trains) {
      seen.add(train.code);
      // Skip trains with no valid coordinates (API returns 0,0 for some)
      if (train.lat === 0 && train.lng === 0) continue;

      // Derive origin/destination key for shape lookup
      const route = parseRoute(train.message);
      const newKey = route
        ? `${route.origin.toLowerCase()}|${route.destination.toLowerCase()}`
        : null;

      // Look up shape from cache (synchronously)
      let lineInfo: { routeLine: Feature<LineString>; routeLengthMeters: number } | null = null;
      if (newKey !== null) {
        const cached = trainShapeCache.get(newKey);
        if (cached === undefined) {
          // Not yet fetched — kick off async fetch without awaiting.
          // On the next trains update, the cache will be populated.
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

        // Visibility based on current filter
        if (isVisible(train)) {
          if (!map.hasLayer(existing.marker)) {
            existing.marker.addTo(map);
          }
        } else {
          if (map.hasLayer(existing.marker)) {
            existing.marker.removeFrom(map);
          }
        }
      } else {
        // New marker
        const now = performance.now();
        const marker = makeCircleMarker(train);

        marker.on("click", () => onMarkerClick(train.code));

        if (isVisible(train)) {
          marker.addTo(map);
        }

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

  // -------------------------------------------------------------------------
  // Apply filter — show/hide existing markers
  // -------------------------------------------------------------------------

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
  // Railway overlay toggle based on mode
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = leafletMap.current;
    const railway = railwayLayerRef.current;
    if (!map || !railway) return;

    if (mode === "train") {
      if (!map.hasLayer(railway)) railway.addTo(map);
    } else {
      if (map.hasLayer(railway)) map.removeLayer(railway);
    }
  }, [mode]);

  // -------------------------------------------------------------------------
  // Bus markers sync
  // -------------------------------------------------------------------------

  // Build a Turf LineString + length from shape coords ([lat,lng] format from API).
  // Turf requires [lng,lat], so we swap.
  function buildRouteLine(coords: [number, number][]): { routeLine: Feature<LineString>; routeLengthMeters: number } | null {
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

  // Project a vehicle GPS position onto the route line. Returns the new path state
  // fields, or { offRoute: true } if the point is too far from the line or an error occurs.
  // offRouteMeters: threshold in metres beyond which we consider the point off-route
  //   (150 for buses, 500 for trains whose station coords can be approximate)
  // maxSpeedMps: clamp for derived speed (25 m/s ≈ 90 km/h for buses, 50 m/s ≈ 180 km/h for trains)
  function projectOntoRoute(
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

      // Speed: prefer computed delta when we have a real forward movement; otherwise
      // fall back to defaultSpeedMps (trains pass 15 m/s to look alive between
      // station updates; buses keep 0 since real GPS gives frequent deltas).
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

  // Async fetch of a train shape, populating the module-level cache.
  // Returns the cache entry (or null if not found/error).
  // Dedupes concurrent requests for the same key to avoid burst on page load.
  // On 429/transient error, does NOT cache "not-found" (so retry on next tick).
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
          trainShapeCache.set(key, "not-found");
          return null;
        }
        const data = await res.json() as { coords?: [number, number][] };
        if (data.coords && data.coords.length >= 2) {
          const built = buildRouteLine(data.coords);
          if (built) {
            trainShapeCache.set(key, built);
            return built;
          }
        }
        trainShapeCache.set(key, "not-found");
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

  // -------------------------------------------------------------------------
  // Bus markers sync
  // -------------------------------------------------------------------------

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    if (mode !== "bus") {
      for (const [, entry] of busMarkers.current) {
        if (map.hasLayer(entry.marker)) map.removeLayer(entry.marker);
      }
      busMarkers.current.clear();
      if (busShapeLayerRef.current) {
        map.removeLayer(busShapeLayerRef.current);
        busShapeLayerRef.current = null;
      }
      return;
    }

    const shape = busShape;

    const seen = new Set<string>();
    for (const bus of buses) {
      seen.add(bus.tripId);

      // Look up the route line for this bus's direction from shape data.
      const dirKey = String(bus.directionId);
      const dirData = shape?.[dirKey];
      const lineInfo = dirData ? buildRouteLine(dirData.coords) : null;

      const existing = busMarkers.current.get(bus.tripId);
      if (existing) {
        const now = performance.now();

        // Backfill routeLine if we now have shape data but didn't before
        if (!existing.routeLine && lineInfo) {
          existing.routeLine = lineInfo.routeLine;
          existing.routeLengthMeters = lineInfo.routeLengthMeters;
        }

        // Project new GPS ping onto the route
        const rl = existing.routeLine;
        const rlm = existing.routeLengthMeters;
        if (rl && rlm !== null) {
          const projection = projectOntoRoute(
            bus.lat, bus.lng,
            rl, rlm,
            existing.targetDistanceAlongRoute,
            existing.lastPingTime,
            now,
          );
          if (!projection.offRoute) {
            existing.offRoute = false;
            // Set distanceAtPing to the current rendered position along the route
            // (clamped to the new target). On first ping just teleport to the projected point.
            if (existing.distanceAtPing === null) {
              existing.distanceAtPing = projection.targetDistanceAlongRoute;
            } else if (existing.lastPingTime !== null) {
              // Advance to where the bus actually is now before updating target
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
        const marker = makeBusMarker(bus);
        marker.addTo(map);

        let distanceAtPing: number | null = null;
        let offRoute = true;
        let targetDistanceAlongRoute: number | null = null;
        let pathSpeedMps = 0;
        let lastPingTime: number | null = null;

        if (lineInfo) {
          const projection = projectOntoRoute(
            bus.lat, bus.lng,
            lineInfo.routeLine, lineInfo.routeLengthMeters,
            null, null, now,
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
        });
      }
    }
    for (const [tripId, entry] of busMarkers.current) {
      if (!seen.has(tripId)) {
        if (map.hasLayer(entry.marker)) map.removeLayer(entry.marker);
        busMarkers.current.delete(tripId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buses, mode, busShape, busDirection, busOperator]);

  // -------------------------------------------------------------------------
  // Bus shape polyline sync
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

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function focusTrain(code: string) {
    const map = leafletMap.current;
    const entry = markers.current.get(code);
    if (!map || !entry) return;
    map.setView(entry.marker.getLatLng(), 13, { animate: false });
    onMarkerClick(code);
  }

  return { focusTrain };
}
