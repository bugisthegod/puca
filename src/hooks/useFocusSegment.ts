import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import lineSliceAlong from "@turf/line-slice-along";
import type { BusVehicle, BusOperator, FocusContext } from "../types";
import type { BusMarkerEntry } from "./useBusMarkers";
import type { Mode } from "./useTrainMap";
import { buildRouteLine, projectOntoRoute } from "./routeProjection";

function operatorColor(op: BusOperator): string {
  return op === "buseireann" ? "#d52b1e" : op === "goahead" ? "#1e6bb8" : "#f9a825";
}

type ShapeResponse = {
  [direction: string]: {
    headsign: string;
    coords: [number, number][];
    stops: { id: string; name: string; lat: number; lng: number }[];
  };
};

interface UseFocusSegmentOptions {
  focusContext: FocusContext | null;
  leafletMap: RefObject<L.Map | null>;
  busMarkers: MutableRefObject<Map<string, BusMarkerEntry>>;
  buses: BusVehicle[];
  mode: Mode;
}

export function useFocusSegment({ focusContext, leafletMap, busMarkers, mode }: UseFocusSegmentOptions): void {
  const layersRef = useRef<{
    polyline: L.Polyline | null;
    intermediates: L.Marker[];
    target: L.Marker | null;
  }>({ polyline: null, intermediates: [], target: null });

  // Cache shape responses by operator+route so rapid arrival switches don't refetch.
  const shapeCacheRef = useRef<Map<string, ShapeResponse>>(new Map());

  useEffect(() => {
    function removeLayers() {
      const map = leafletMap.current;
      const prev = layersRef.current;
      if (map) {
        if (prev.polyline) map.removeLayer(prev.polyline);
        for (const c of prev.intermediates) map.removeLayer(c);
        if (prev.target) map.removeLayer(prev.target);
      }
      layersRef.current = { polyline: null, intermediates: [], target: null };
    }

    removeLayers();

    if (!focusContext || mode !== "bus") return;

    const map = leafletMap.current;
    if (!map) return;

    // Custom pane z=550, sits between shadowPane (500) and markerPane (600).
    // This keeps focus-stop divIcons above polylines/shadows but below bus
    // markers — same visual stacking as the old CircleMarker impl. Using
    // divIcons (HTML) instead of CircleMarker (SVG) means they don't visually
    // scale during flyToBounds zoom animation.
    if (!map.getPane("focusPane")) {
      const pane = map.createPane("focusPane");
      pane.style.zIndex = "550";
    }

    let cancelled = false;

    (async () => {
      const cacheKey = `${focusContext.operator}:${focusContext.routeShortName}`;
      let shape = shapeCacheRef.current.get(cacheKey);
      if (!shape) {
        try {
          const res = await fetch(
            `/api/bus/shape/${encodeURIComponent(focusContext.routeShortName)}?operator=${encodeURIComponent(focusContext.operator)}`,
          );
          if (!res.ok || cancelled) return;
          shape = (await res.json()) as ShapeResponse;
          shapeCacheRef.current.set(cacheKey, shape);
        } catch {
          return;
        }
      }
      if (cancelled) return;

      const dirData = shape[focusContext.direction];
      if (!dirData || dirData.coords.length < 2) return;

      // Wait briefly for the bus marker to appear — onPickArrival clears the
      // selected route, which triggers fetchAllBuses, which usually lands within
      // a second. Retry up to 6s before giving up.
      let busEntry = busMarkers.current.get(focusContext.tripId);
      let attempts = 0;
      while (!busEntry && attempts < 30 && !cancelled) {
        await new Promise((r) => setTimeout(r, 200));
        busEntry = busMarkers.current.get(focusContext.tripId);
        attempts++;
      }
      if (cancelled || !busEntry) return;

      const busLatLng = busEntry.marker.getLatLng();
      const lineInfo = buildRouteLine(dirData.coords);
      if (!lineInfo) return;

      const busProj = projectOntoRoute(
        busLatLng.lat, busLatLng.lng,
        lineInfo.routeLine, lineInfo.routeLengthMeters,
        null, null, 0,
      );
      const targetProj = projectOntoRoute(
        focusContext.targetStopLat, focusContext.targetStopLng,
        lineInfo.routeLine, lineInfo.routeLengthMeters,
        null, null, 0,
      );
      if (busProj.offRoute || targetProj.offRoute) return;
      const busD = busProj.targetDistanceAlongRoute;
      const targetD = targetProj.targetDistanceAlongRoute;
      if (busD >= targetD) return;

      let slicedCoords: [number, number][];
      try {
        const sliced = lineSliceAlong(lineInfo.routeLine, busD / 1000, targetD / 1000, { units: "kilometers" });
        slicedCoords = sliced.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      } catch {
        return;
      }
      if (cancelled || slicedCoords.length < 2) return;

      const color = operatorColor(focusContext.operator);

      // Polyline starts invisible; flyToBounds' zoom animation applies
      // transform:scale on the overlayPane SVG, which inflates stroke width
      // until the animation lands. vector-effect: non-scaling-stroke would be
      // the elegant fix but fails on WebKit when the transform is on an SVG
      // ancestor. Hiding the line during the 1.1s animation and restoring
      // opacity on zoom-end avoids the "stroke bleeds into a blob" look.
      const polyline = L.polyline(slicedCoords, {
        color,
        weight: 4,
        opacity: 0,
      }).addTo(map);

      const intermediates: L.Marker[] = [];
      for (const stop of dirData.stops) {
        if (stop.id === focusContext.targetStopId) continue;
        const sp = projectOntoRoute(
          stop.lat, stop.lng,
          lineInfo.routeLine, lineInfo.routeLengthMeters,
          null, null, 0,
        );
        if (sp.offRoute) continue;
        if (sp.targetDistanceAlongRoute <= busD || sp.targetDistanceAlongRoute >= targetD) continue;
        const m = L.marker([stop.lat, stop.lng], {
          icon: L.divIcon({
            className: `focus-stop focus-stop--intermediate focus-stop--${focusContext.operator}`,
            html: "",
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          }),
          pane: "focusPane",
        });
        m.bindTooltip(stop.name, { direction: "top", offset: [0, -6], className: "stop-tooltip", opacity: 1 });
        m.addTo(map);
        intermediates.push(m);
      }

      // Target stop uses the same hollow-ring style but larger + thicker ring,
      // so the user can see "this is where I get off" without needing the
      // tooltip to be permanent. zIndexOffset keeps target above any
      // overlapping intermediate within the same pane.
      const target = L.marker(
        [focusContext.targetStopLat, focusContext.targetStopLng],
        {
          icon: L.divIcon({
            className: `focus-stop focus-stop--target focus-stop--${focusContext.operator}`,
            html: "",
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          pane: "focusPane",
          zIndexOffset: 1000,
        },
      );
      target.bindTooltip(focusContext.targetStopName, {
        direction: "top",
        offset: [0, -11],
        className: "stop-tooltip",
        opacity: 1,
      });
      target.addTo(map);

      layersRef.current = { polyline, intermediates, target };

      // Frame the whole segment (bus → target) so it fills the viewport —
      // matches the flyToBounds behaviour when a user picks a route from the
      // Route tab. User can then tap the bus themselves if they want the popup.
      map.flyToBounds(polyline.getBounds(), {
        paddingTopLeft: [20, 60],
        paddingBottomRight: [20, 80],
        duration: 1.1,
        easeLinearity: 0.3,
      });

      // Restore polyline visibility after the zoom animation lands. Match the
      // flyToBounds duration (1.1s) plus a small buffer so the stroke swap
      // happens off-screen of the animation.
      setTimeout(() => {
        if (cancelled) return;
        if (!map.hasLayer(polyline)) return;
        polyline.setStyle({ opacity: 0.85 });
      }, 1150);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusContext, mode]);
}
