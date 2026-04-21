// Declare L as a runtime global (loaded via CDN) with proper Leaflet types.
// `declare const` makes L usable as a value; `typeof import(...)` gives the full type.
// The global namespace L (from leaflet-global.d.ts) handles L.Foo type references.
declare const L: typeof import("leaflet");
import { useRef, useEffect, useState, useCallback, type RefObject } from "react";
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
  compassPref: boolean;
  startCompass: () => Promise<boolean>;
  stopCompass: () => void;
}

const COMPASS_PREF_KEY = "puca:compass";

function readCompassPref(): boolean {
  try {
    const v = localStorage.getItem(COMPASS_PREF_KEY);
    // Default to on — users opt out rather than in. "off" is the only value
    // that disables; anything else (including null/unset) means on.
    return v !== "off";
  } catch {
    return true;
  }
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
  const [compassPref, setCompassPref] = useState<boolean>(readCompassPref);
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

  async function startCompass(): Promise<boolean> {
    if (orientationHandlerRef.current) return true;
    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DOE?.requestPermission === "function") {
      try {
        const perm = await DOE.requestPermission();
        if (perm !== "granted") {
          // Explicit denial — flip pref off so the toggle shows Off instead
          // of getting stuck on On (iOS caches the deny; repeat taps won't
          // re-prompt until the user clears it in Safari settings).
          setCompassPref(false);
          try { localStorage.setItem(COMPASS_PREF_KEY, "off"); } catch { /* quota */ }
          return false;
        }
      } catch {
        // Not a user gesture (or other exception) — leave pref alone so a
        // later tap inside a gesture can retry.
        return false;
      }
    }
    const eventName =
      "ondeviceorientationabsolute" in window
        ? "deviceorientationabsolute"
        : "deviceorientation";
    window.addEventListener(eventName, onDeviceOrientation as EventListener);
    orientationHandlerRef.current = onDeviceOrientation;
    orientationEventNameRef.current = eventName;
    setCompassPref(true);
    try { localStorage.setItem(COMPASS_PREF_KEY, "on"); } catch { /* quota */ }
    return true;
  }

  // Tear down the listener without touching the persisted pref. Used both
  // by the user-facing stopCompass() (which also writes pref=off) and by the
  // unmount cleanup (which must NOT clobber user intent on HMR/StrictMode
  // remounts).
  function teardownCompass(): void {
    const handler = orientationHandlerRef.current;
    const eventName = orientationEventNameRef.current;
    if (handler && eventName) {
      window.removeEventListener(eventName, handler as EventListener);
    }
    orientationHandlerRef.current = null;
    orientationEventNameRef.current = null;
    const inner = userIconInnerRef.current;
    if (inner) inner.classList.remove("has-heading");
  }

  function stopCompass(): void {
    teardownCompass();
    setCompassPref(false);
    try { localStorage.setItem(COMPASS_PREF_KEY, "off"); } catch { /* quota */ }
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
      teardownCompass();
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

  // Auto-restore compass on mount when the pref says on. On iOS this will
  // silently fail (requestPermission() needs a fresh user gesture per page
  // load) — the pref stays on, the toggle still shows On, and tapping On in
  // About re-fires the request inside a gesture to reactivate it.
  useEffect(() => {
    if (!readCompassPref()) return;
    void startCompass();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getMapView = useCallback((): MapView | null => {
    const map = leafletMap.current;
    if (!map) return null;
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
  }, []);

  return {
    leafletMap,
    stationsRef,
    zoomingRef,
    railwayLayerRef,
    locateUser,
    getMapView,
    compassPref,
    startCompass,
    stopCompass,
  };
}
