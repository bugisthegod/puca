// Declare L as a runtime global (loaded via CDN) with proper Leaflet types.
// `declare const` makes L usable as a value; `typeof import(...)` gives the full type.
// The global namespace L (from leaflet-global.d.ts) handles L.Foo type references.
declare const L: typeof import("leaflet");
import { useRef, useEffect, type RefObject } from "react";
import type { Station } from "../types";
import type { Mode } from "./useTrainMap";
import { getStationsOnce } from "../stationsClient";

const TILE_VOYAGER =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_DARK =
  "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png";

const BASE_TILE_OPTIONS = {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 20,
  subdomains: "abcd",
  keepBuffer: 10,
  updateWhenIdle: false,
  updateWhenZooming: false,
  updateInterval: 100,
} as const;

interface UseMapInstanceResult {
  leafletMap: React.RefObject<L.Map | null>;
  stationsRef: React.MutableRefObject<Map<string, Station>>;
  zoomingRef: React.MutableRefObject<boolean>;
  railwayLayerRef: React.RefObject<L.TileLayer | null>;
  locateUser: () => Promise<void>;
}

export function useMapInstance(
  mapRef: RefObject<HTMLDivElement | null>,
  mode: Mode,
): UseMapInstanceResult {
  const leafletMap = useRef<L.Map | null>(null);
  const stationsRef = useRef<Map<string, Station>>(new Map());
  const zoomingRef = useRef<boolean>(false);
  const railwayLayerRef = useRef<L.TileLayer | null>(null);
  // Holds current base tile layer so we can remove it on scheme change
  const baseTileRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);

  const locateUser = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const map = leafletMap.current;
      if (!map) {
        reject(new Error("Map not ready"));
        return;
      }
      if (!navigator.geolocation) {
        reject(new Error("Your browser does not support geolocation"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          const latlng: L.LatLngExpression = [latitude, longitude];
          if (!userMarkerRef.current) {
            userMarkerRef.current = L.circleMarker(latlng, {
              radius: 8,
              color: "#fff",
              weight: 2,
              fillColor: "#1e88e5",
              fillOpacity: 1,
            }).addTo(map);
            accuracyCircleRef.current = L.circle(latlng, {
              radius: accuracy,
              color: "#1e88e5",
              fillColor: "#1e88e5",
              fillOpacity: 0.12,
              weight: 1,
            }).addTo(map);
          } else {
            userMarkerRef.current.setLatLng(latlng);
            accuracyCircleRef.current?.setLatLng(latlng).setRadius(accuracy);
          }
          map.setView(latlng, 14);
          resolve();
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    });

  // Mount / unmount — init Leaflet map and attach zoom event handlers.
  useEffect(() => {
    if (!mapRef.current) return;

    const map = L.map(mapRef.current, {
      preferCanvas: true,
      fadeAnimation: false,
      zoomControl: false,
    }).setView([53.35, -6.26], 8);

    const darkMq = window.matchMedia("(prefers-color-scheme: dark)");

    function addBaseTile(dark: boolean): void {
      if (baseTileRef.current) {
        map.removeLayer(baseTileRef.current);
      }
      const layer = L.tileLayer(dark ? TILE_DARK : TILE_VOYAGER, {
        ...BASE_TILE_OPTIONS,
        className: dark ? "tile-dark" : "tile-voyager",
      });
      layer.addTo(map);
      // Ensure base tile stays behind railway overlay
      layer.bringToBack();
      baseTileRef.current = layer;
    }

    addBaseTile(darkMq.matches);

    const onSchemeChange = (e: MediaQueryListEvent) => addBaseTile(e.matches);
    darkMq.addEventListener("change", onSchemeChange);

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
    getStationsOnce().then((data) => {
      const m = new Map<string, Station>();
      for (const s of data) m.set(s.code, s);
      stationsRef.current = m;
    });

    leafletMap.current = map;

    return () => {
      darkMq.removeEventListener("change", onSchemeChange);
      map.remove();
      leafletMap.current = null;
      baseTileRef.current = null;
      userMarkerRef.current = null;
      accuracyCircleRef.current = null;
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

  return { leafletMap, stationsRef, zoomingRef, railwayLayerRef, locateUser };
}
