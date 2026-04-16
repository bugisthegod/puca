declare var L: any;

import { useRef, useEffect, type RefObject } from "react";
import type { Train, TrainMovement, Station } from "../types";
import {
  markerColor,
  trainCategory,
  parseLateMinutes,
  parseRoute,
  fmtTime,
  type Filter,
} from "../utils";

// ---------------------------------------------------------------------------
// Popup HTML builders
// ---------------------------------------------------------------------------

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
        <span class="popup-status">${statusText}</span>
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
        <span class="popup-status">${statusText}</span>
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

interface MarkerEntry {
  marker: any;
  train: Train;
  // Position tracking
  targetLat: number;
  targetLng: number;
  velocityLat: number;  // degrees per ms
  velocityLng: number;
  lastUpdateTime: number;
  // Correction blending
  correctionFromLat: number;
  correctionFromLng: number;
  correctionStartTime: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTrainMap(
  mapRef: RefObject<HTMLDivElement | null>,
  trains: Train[],
  filter: Filter,
  searchCodes: string[] | null = null
): { focusTrain: (code: string) => void } {
  const leafletMap = useRef<any>(null);
  const markers = useRef<Map<string, MarkerEntry>>(new Map());
  const rafId = useRef<number>(0);
  const zooming = useRef<boolean>(false);
  const filterRef = useRef<Filter>(filter);
  filterRef.current = filter;
  const searchCodesRef = useRef<string[] | null>(searchCodes);
  searchCodesRef.current = searchCodes;
  const stationsRef = useRef<Map<string, Station>>(new Map());
  const routeLineRef = useRef<any>(null);

  // -------------------------------------------------------------------------
  // Helpers that close over refs
  // -------------------------------------------------------------------------

  function isVisible(train: Train): boolean {
    // Search filter takes priority
    if (searchCodesRef.current !== null) {
      return searchCodesRef.current.includes(train.code);
    }
    if (filterRef.current === "all") return true;
    return trainCategory(train.code) === filterRef.current;
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
    marker.bindPopup(buildPopupHTML(train), { maxWidth: 520, minWidth: 380 }).openPopup();

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

    for (const [, entry] of markers.current) {
      if (!map.hasLayer(entry.marker)) continue;

      const dt = Math.min(now - entry.lastUpdateTime, EXTRAP_CAP);
      // True extrapolated position
      const extrapLat = entry.targetLat + entry.velocityLat * dt;
      const extrapLng = entry.targetLng + entry.velocityLng * dt;

      // Blend from correction origin toward extrapolated track
      const blendElapsed = now - entry.correctionStartTime;
      if (blendElapsed < BLEND_DURATION) {
        const t = blendElapsed / BLEND_DURATION;
        // Smooth ease-out
        const ease = 1 - (1 - t) * (1 - t);
        const lat = entry.correctionFromLat + (extrapLat - entry.correctionFromLat) * ease;
        const lng = entry.correctionFromLng + (extrapLng - entry.correctionFromLng) * ease;
        entry.marker.setLatLng([lat, lng]);
      } else {
        entry.marker.setLatLng([extrapLat, extrapLng]);
      }

    }

    rafId.current = requestAnimationFrame(tickAllMarkers);
  }

  // -------------------------------------------------------------------------
  // Mount / unmount — init Leaflet map, start RAF
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!mapRef.current) return;

    const map = L.map(mapRef.current).setView([53.35, -6.26], 8);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: "abcd",
    }).addTo(map);

    // Railway lines overlay
    L.tileLayer("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
      maxZoom: 19,
      opacity: 0.75,
    }).addTo(map);

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
      const existing = markers.current.get(train.code);

      if (existing) {
        const now = performance.now();
        const color = markerColor(train);
        existing.marker.setStyle({ fillColor: color });
        existing.train = train;

        // Calculate velocity from position change
        const timeDelta = now - existing.lastUpdateTime;
        if (timeDelta > 0 && train.status === "R") {
          existing.velocityLat = (train.lat - existing.targetLat) / timeDelta;
          existing.velocityLng = (train.lng - existing.targetLng) / timeDelta;
        } else {
          existing.velocityLat = 0;
          existing.velocityLng = 0;
        }

        // Record current displayed position as correction origin
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
  }, [filter, searchCodes]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function focusTrain(code: string) {
    const map = leafletMap.current;
    const entry = markers.current.get(code);
    if (!map || !entry) return;
    map.setView(entry.marker.getLatLng(), 13);
    onMarkerClick(code);
  }

  return { focusTrain };
}
