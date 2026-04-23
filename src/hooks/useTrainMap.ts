import { useRef, useEffect, type RefObject } from "react";
import type { Train, BusVehicle, BusOperator } from "../types";
import { along } from "./routeProjection";
import type { Filter } from "../utils";
import type { MapView } from "../session";
import { useMapInstance } from "./useMapInstance";
import { useTrainMarkers } from "./useTrainMarkers";
import { useBusMarkers } from "./useBusMarkers";

export type Mode = "train" | "bus";

const BLEND_DURATION = 1500;
const EXTRAP_CAP = 35_000;

// Throttle to ~20 FPS — transit markers move slowly and full 60 FPS was
// pinning the CPU (turf's along() call per marker adds up fast with 600+ buses).
const TICK_INTERVAL_MS = 50;

interface UseTrainMapOptions {
  currentBusRoute?: string | null;
  onSelectBusRoute?: (route: string, direction: string) => void;
  initialView?: MapView | null;
}

export function useTrainMap(
  mapRef: RefObject<HTMLDivElement | null>,
  trains: Train[],
  filter: Filter,
  searchCodes: string[] | null = null,
  mode: Mode = "train",
  buses: BusVehicle[] = [],
  busShape: { [direction: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[]; variants?: { shapeId: string; tripCount: number; branches: [number, number][][] }[] } } | null = null,
  busDirection: string | null = null,
  busOperator: BusOperator = "dublinbus",
  options: UseTrainMapOptions = {},
): {
  focusTrain: (code: string) => void;
  locateUser: () => Promise<void>;
  getMapView: () => MapView | null;
  compassPref: boolean;
  startCompass: () => Promise<boolean>;
  stopCompass: () => void;
} {
  const { currentBusRoute = null, onSelectBusRoute, initialView = null } = options;

  const onSelectBusRouteRef = useRef(onSelectBusRoute);
  onSelectBusRouteRef.current = onSelectBusRoute;

  const rafId = useRef<number>(0);
  const lastTickTime = useRef<number>(0);
  const busClusterLayer = useRef<L.MarkerClusterGroup | null>(null);

  // Map first — everything else depends on it.
  const {
    leafletMap,
    stationsRef,
    zoomingRef,
    locateUser,
    getMapView,
    compassPref,
    startCompass,
    stopCompass,
  } = useMapInstance(mapRef, mode, initialView);

  const { markers, clearRouteLine, focusTrain } = useTrainMarkers({
    trains,
    filter,
    searchCodes,
    mode,
    leafletMap,
    stationsRef,
  });

  const { busMarkers } = useBusMarkers({
    buses,
    busShape,
    busDirection,
    busOperator,
    mode,
    currentBusRoute,
    onSelectBusRoute: onSelectBusRouteRef,
    leafletMap,
    busClusterLayer,
  });

  // Bus cluster lifecycle — recreated on mode/operator change so the
  // iconCreateFunction closure captures the current operator color.
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    if (busClusterLayer.current) {
      busClusterLayer.current.clearLayers();
      if (map.hasLayer(busClusterLayer.current)) map.removeLayer(busClusterLayer.current);
      busClusterLayer.current = null;
      busMarkers.current.clear();
    }

    if (mode !== "bus") return;

    const operatorClass =
      busOperator === "buseireann" ? "bus-cluster--buseireann" :
      busOperator === "goahead" ? "bus-cluster--goahead" :
      "";

    busClusterLayer.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 60,
      disableClusteringAtZoom: 18,
      spiderfyOnMaxZoom: false,
      chunkedLoading: true,
      animate: false,
      animateAddingMarkers: false,
      iconCreateFunction: (cluster: L.MarkerCluster) => {
        const count = cluster.getChildCount();
        const size = count >= 100 ? "large" : count >= 20 ? "medium" : "small";
        const dim = size === "large" ? 46 : size === "medium" ? 38 : 30;
        return L.divIcon({
          html: `<span>${count}</span>`,
          className: `bus-cluster bus-cluster--${size} ${operatorClass}`.trim(),
          iconSize: L.point(dim, dim),
        });
      },
    });
    busClusterLayer.current.addTo(map);
  }, [mode, busOperator]);

  // Clear the train route polyline whenever a popup closes.
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;
    const handler = () => clearRouteLine();
    map.on("popupclose", handler);
    return () => {
      map.off("popupclose", handler);
    };
  }, [clearRouteLine, leafletMap]);

  // RAF tick loop — shared across trains + buses, reads from refs only.
  useEffect(() => {
    function tickAllMarkers(now: number) {
      const map = leafletMap.current;
      if (!map || zoomingRef.current) {
        rafId.current = requestAnimationFrame(tickAllMarkers);
        return;
      }
      if (now - lastTickTime.current < TICK_INTERVAL_MS) {
        rafId.current = requestAnimationFrame(tickAllMarkers);
        return;
      }
      lastTickTime.current = now;

      // Viewport culling: targetLat/Lng (latest GPS) vs padded map bounds.
      const bounds = map.getBounds().pad(0.25);

      const TRAIN_EXTRAP_BUFFER_METERS = 5000;
      for (const [, entry] of markers.current) {
        if (!map.hasLayer(entry.marker)) continue;
        if (!bounds.contains([entry.targetLat, entry.targetLng])) continue;

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
          const capped = Math.min(advanced, entry.targetDistanceAlongRoute + TRAIN_EXTRAP_BUFFER_METERS);
          const clamped = Math.max(0, Math.min(capped, entry.routeLengthMeters));
          try {
            const pt = along(entry.routeLine, clamped / 1000, { units: "kilometers" });
            const [lng, lat] = pt.geometry.coordinates as [number, number];
            entry.marker.setLatLng([lat, lng]);
          } catch {
            // along() can throw at end of line — stay put
          }
          continue;
        }

        // Velocity fallback (unmapped routes / off-route)
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

      for (const [, entry] of busMarkers.current) {
        const cluster = busClusterLayer.current;
        if (cluster) {
          if (!cluster.hasLayer(entry.marker)) continue;
          const visible = cluster.getVisibleParent(entry.marker);
          if (visible !== entry.marker) continue;
        } else if (!map.hasLayer(entry.marker)) {
          continue;
        }
        if (!bounds.contains([entry.targetLat, entry.targetLng])) continue;
        if (entry.marker.isPopupOpen?.()) continue;

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
          // Extrap cap 500m — covers ~60s at typical 8 m/s city bus speed,
          // enough headroom for a full NTA 30s poll + frontend 15s delay without freezing.
          const capped = Math.min(advanced, entry.targetDistanceAlongRoute + 500);
          const clamped = Math.max(0, Math.min(capped, entry.routeLengthMeters));
          // Skip along() + setLatLng when the extrapolated distance hasn't advanced
          // (bus hit the 150m extrap cap and is waiting for next ping).
          if (entry.lastRenderedDistance === clamped) continue;
          try {
            const pt = along(entry.routeLine, clamped / 1000, { units: "kilometers" });
            const [lng, lat] = pt.geometry.coordinates as [number, number];
            entry.marker.setLatLng([lat, lng]);
            entry.lastRenderedDistance = clamped;
          } catch {
            // along() can throw at end of line — stay put
          }
          continue;
        }

        // LERP fallback — after blend, marker sits at target until next ping.
        // Short-circuit to avoid 94% wasted setLatLng across the 25s cycle.
        if (entry.settled) continue;
        const blendElapsed = now - entry.correctionStartTime;
        if (blendElapsed < BLEND_DURATION) {
          const t = blendElapsed / BLEND_DURATION;
          const ease = 1 - (1 - t) * (1 - t);
          const lat = entry.correctionFromLat + (entry.targetLat - entry.correctionFromLat) * ease;
          const lng = entry.correctionFromLng + (entry.targetLng - entry.correctionFromLng) * ease;
          entry.marker.setLatLng([lat, lng]);
        } else {
          entry.marker.setLatLng([entry.targetLat, entry.targetLng]);
          entry.settled = true;
        }
      }

      rafId.current = requestAnimationFrame(tickAllMarkers);
    }

    rafId.current = requestAnimationFrame(tickAllMarkers);
    return () => cancelAnimationFrame(rafId.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { focusTrain, locateUser, getMapView, compassPref, startCompass, stopCompass };
}
