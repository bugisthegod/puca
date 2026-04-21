// Declare L as a runtime global (loaded via CDN) with proper Leaflet types.
// `declare const` makes L usable as a value; `typeof import(...)` gives the full type.
// The global namespace L (from leaflet-global.d.ts) handles L.Foo type references.
declare const L: typeof import("leaflet");
import { useRef, useEffect, useCallback, type RefObject } from "react";
import type { Station } from "../types";
import type { Mode } from "./useTrainMap";
import type { MapView } from "../session";
import { getStationsOnce } from "../stationsClient";

const TILE_VOYAGER =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_DARK =
  "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png";

const DEFAULT_CENTER: L.LatLngExpression = [53.35, -6.26];
const DEFAULT_ZOOM = 8;

const BASE_TILE_OPTIONS = {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 20,
  subdomains: "abcd",
  keepBuffer: 10,
  updateWhenIdle: false,
  updateWhenZooming: true,
  updateInterval: 100,
} as const;

interface UseMapInstanceResult {
  leafletMap: React.RefObject<L.Map | null>;
  stationsRef: React.MutableRefObject<Map<string, Station>>;
  zoomingRef: React.MutableRefObject<boolean>;
  railwayLayerRef: React.RefObject<L.TileLayer | null>;
  locateUser: () => Promise<void>;
  getMapView: () => MapView | null;
}

export function useMapInstance(
  mapRef: RefObject<HTMLDivElement | null>,
  mode: Mode,
  initialView: MapView | null = null,
): UseMapInstanceResult {
  const leafletMap = useRef<L.Map | null>(null);
  const stationsRef = useRef<Map<string, Station>>(new Map());
  const zoomingRef = useRef<boolean>(false);
  const railwayLayerRef = useRef<L.TileLayer | null>(null);
  // Holds current base tile layer so we can remove it on scheme change
  const baseTileRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userIconInnerRef = useRef<HTMLElement | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const orientationHandlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);
  const orientationEventNameRef = useRef<string | null>(null);
  // Unwrapped rotation so CSS transition always takes the shortest path
  // (instead of spinning 358° the wrong way when heading wraps 359°→0°).
  const unwrappedRotationRef = useRef<number>(0);

  function applyHeading(rawHeading: number): void {
    // rawHeading is in device-space (relative to the hardware top of the
    // device). Subtract screen.orientation.angle so the cone points the right
    // way when the user rotates to landscape.
    const screenAngle = window.screen?.orientation?.angle ?? 0;
    const target = (((rawHeading - screenAngle) % 360) + 360) % 360;
    const currentMod = ((unwrappedRotationRef.current % 360) + 360) % 360;
    let delta = target - currentMod;
    if (delta > 180) delta -= 360;
    else if (delta < -180) delta += 360;
    unwrappedRotationRef.current += delta;
    const inner = userIconInnerRef.current;
    if (!inner) return;
    inner.style.transform = `rotate(${unwrappedRotationRef.current}deg)`;
    if (!inner.classList.contains("has-heading")) {
      inner.classList.add("has-heading");
    }
  }

  function onDeviceOrientation(e: DeviceOrientationEvent): void {
    // iOS: webkitCompassHeading is degrees clockwise from true north.
    const iosHeading = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
      .webkitCompassHeading;
    if (typeof iosHeading === "number" && !Number.isNaN(iosHeading)) {
      applyHeading(iosHeading);
      return;
    }
    // Android absolute: alpha is counter-clockwise from north → invert.
    if (e.absolute && typeof e.alpha === "number") {
      applyHeading(360 - e.alpha);
    }
  }

  async function startOrientationTracking(): Promise<void> {
    if (orientationHandlerRef.current) return; // already tracking
    const eventName =
      "ondeviceorientationabsolute" in window
        ? "deviceorientationabsolute"
        : "deviceorientation";
    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const needsPermission = typeof DOE?.requestPermission === "function";
    const GRANTED_KEY = "puca-orientation-granted";
    const seenBefore = (() => {
      try { return localStorage.getItem(GRANTED_KEY) === "true"; }
      catch { return false; }
    })();

    // Optimistic path: if the user granted before, try subscribing without
    // calling requestPermission() — some iOS versions/contexts remember the
    // grant and fire events directly. If no events arrive in 500ms, fall
    // back to the permission prompt.
    if (needsPermission && seenBefore) {
      const gotEvent = await new Promise<boolean>((resolve) => {
        let settled = false;
        const probe = () => {
          if (settled) return;
          settled = true;
          resolve(true);
        };
        window.addEventListener(eventName, probe as EventListener, { once: true });
        setTimeout(() => {
          if (settled) return;
          settled = true;
          window.removeEventListener(eventName, probe as EventListener);
          resolve(false);
        }, 500);
      });
      if (gotEvent) {
        window.addEventListener(eventName, onDeviceOrientation as EventListener);
        orientationHandlerRef.current = onDeviceOrientation;
        orientationEventNameRef.current = eventName;
        return;
      }
    }

    if (needsPermission) {
      try {
        const perm = await DOE.requestPermission!();
        if (perm !== "granted") {
          try { localStorage.removeItem(GRANTED_KEY); } catch { /* private mode */ }
          return;
        }
      } catch {
        return; // denied or not a user gesture
      }
    }
    window.addEventListener(eventName, onDeviceOrientation as EventListener);
    orientationHandlerRef.current = onDeviceOrientation;
    orientationEventNameRef.current = eventName;
    try { localStorage.setItem(GRANTED_KEY, "true"); } catch { /* quota */ }
  }

  function stopOrientationTracking(): void {
    const handler = orientationHandlerRef.current;
    const eventName = orientationEventNameRef.current;
    if (handler && eventName) {
      window.removeEventListener(eventName, handler as EventListener);
    }
    orientationHandlerRef.current = null;
    orientationEventNameRef.current = null;
  }

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
      // Kick off orientation tracking synchronously so iOS treats this as a
      // user-gesture-originated permission request.
      void startOrientationTracking();

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          const latlng: L.LatLngExpression = [latitude, longitude];
          if (!userMarkerRef.current) {
            const icon = L.divIcon({
              className: "user-loc-marker",
              html:
                '<div class="user-loc-icon">' +
                '<svg class="user-loc-cone" viewBox="0 0 80 80" aria-hidden="true">' +
                '<defs>' +
                '<radialGradient id="user-loc-grad" cx="40" cy="40" r="38" gradientUnits="userSpaceOnUse">' +
                '<stop offset="0.15" stop-color="#1e88e5" stop-opacity="0.9"/>' +
                '<stop offset="1" stop-color="#1e88e5" stop-opacity="0"/>' +
                '</radialGradient>' +
                '</defs>' +
                // ~100° wedge pointing up (12 o'clock), centered on (40,40) with radius 38
                '<path d="M40 40 L10.88 15.58 A38 38 0 0 1 69.12 15.58 Z" fill="url(#user-loc-grad)"/>' +
                '</svg>' +
                '<div class="user-loc-dot"></div>' +
                "</div>",
              iconSize: [80, 80],
              iconAnchor: [40, 40],
            });
            userMarkerRef.current = L.marker(latlng, {
              icon,
              interactive: false,
              keyboard: false,
            }).addTo(map);
            const el = userMarkerRef.current.getElement();
            userIconInnerRef.current =
              el?.querySelector<HTMLElement>(".user-loc-icon") ?? null;
            accuracyCircleRef.current = L.circle(latlng, {
              radius: accuracy,
              color: "#1e88e5",
              fillColor: "#1e88e5",
              fillOpacity: 0.12,
              weight: 1,
              interactive: false,
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

    const center: L.LatLngExpression = initialView
      ? [initialView.lat, initialView.lng]
      : DEFAULT_CENTER;
    const zoom = initialView?.zoom ?? DEFAULT_ZOOM;
    const map = L.map(mapRef.current, {
      preferCanvas: true,
      fadeAnimation: true,
      zoomControl: false,
    }).setView(center, zoom);

    function isDark(): boolean {
      return document.documentElement.dataset.theme === "dark";
    }

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

    addBaseTile(isDark());

    // Swap base tile when the user toggles theme in the About modal.
    const onSchemeChange = () => addBaseTile(isDark());
    window.addEventListener("puca:themechange", onSchemeChange);

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

    // Pause marker tick during any map animation (zoom OR pan), so panTo-on-select
    // doesn't compete with per-frame setLatLng + cluster reindex.
    map.on("movestart", () => { zoomingRef.current = true; });
    map.on("moveend", () => { zoomingRef.current = false; });

    // Load stations for route line drawing in popups
    getStationsOnce().then((data) => {
      const m = new Map<string, Station>();
      for (const s of data) m.set(s.code, s);
      stationsRef.current = m;
    });

    leafletMap.current = map;

    return () => {
      window.removeEventListener("puca:themechange", onSchemeChange);
      stopOrientationTracking();
      map.remove();
      leafletMap.current = null;
      baseTileRef.current = null;
      userMarkerRef.current = null;
      userIconInnerRef.current = null;
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

  const getMapView = useCallback((): MapView | null => {
    const map = leafletMap.current;
    if (!map) return null;
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
  }, []);

  return { leafletMap, stationsRef, zoomingRef, railwayLayerRef, locateUser, getMapView };
}
