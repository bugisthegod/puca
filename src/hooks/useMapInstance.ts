// Declare L as a runtime global (loaded via CDN) with proper Leaflet types.
// `declare const` makes L usable as a value; `typeof import(...)` gives the full type.
// The global namespace L (from leaflet-global.d.ts) handles L.Foo type references.
declare const L: typeof import("leaflet");
import { useRef, useEffect, type RefObject } from "react";
import type { Station } from "../types";
import type { Mode } from "./useTrainMap";

interface UseMapInstanceResult {
  leafletMap: React.RefObject<L.Map | null>;
  stationsRef: React.MutableRefObject<Map<string, Station>>;
  zoomingRef: React.MutableRefObject<boolean>;
  railwayLayerRef: React.RefObject<L.TileLayer | null>;
}

export function useMapInstance(
  mapRef: RefObject<HTMLDivElement | null>,
  mode: Mode,
): UseMapInstanceResult {
  const leafletMap = useRef<L.Map | null>(null);
  const stationsRef = useRef<Map<string, Station>>(new Map());
  const zoomingRef = useRef<boolean>(false);
  const railwayLayerRef = useRef<L.TileLayer | null>(null);

  // Mount / unmount — init Leaflet map and attach zoom event handlers.
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
    if (mode === "train") railwayLayerRef.current.addTo(map);

    map.on("zoomstart", () => { zoomingRef.current = true; });
    map.on("zoomend", () => { zoomingRef.current = false; });

    // Load stations for route line drawing in popups
    fetch("/api/stations")
      .then((r) => r.json())
      .then((data: Station[]) => {
        const m = new Map<string, Station>();
        for (const s of data) m.set(s.code, s);
        stationsRef.current = m;
      })
      .catch(() => {});

    leafletMap.current = map;

    return () => {
      map.remove();
      leafletMap.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Railway overlay toggle based on mode
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

  return { leafletMap, stationsRef, zoomingRef, railwayLayerRef };
}
