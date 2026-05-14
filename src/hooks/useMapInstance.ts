// Declare L as a runtime global. The global is set up by Leaflet's UMD wrapper
// (`window.L = exports;`) when App.tsx imports the bundled package — this file
// can then use `L.tileLayer(...)` without its own import statement.
// `declare const` makes L usable as a value; `typeof import(...)` gives the full type.
// The global namespace L (from leaflet-global.d.ts) handles L.Foo type references.
declare const L: typeof import("leaflet");

import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { MapView } from "../session";
import { getStationsOnce } from "../stationsClient";
import type { Station } from "../types";
import {
	type CachedFix,
	decideLocationFix,
	parseCachedFix,
} from "./locationLogic";
import type { Mode } from "./useVehicleMap";

const TILE_VOYAGER =
	"https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

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
	locateUser: (options?: {
		onFinalAccuracy?: (accuracy: number) => void;
	}) => Promise<{ accuracy: number }>;
	getMapView: () => MapView | null;
	compassPref: boolean;
	startCompass: () => Promise<boolean>;
	stopCompass: () => void;
}

const LOCATION_REFINE_MS = 8_000;

const COMPASS_PREF_KEY = "puca:compass";

function readCompassPref(): boolean {
	try {
		const v = localStorage.getItem(COMPASS_PREF_KEY);
		// Default to off. Only a previous explicit user opt-in should enable the
		// compass and trigger motion/orientation permission prompts.
		return v === "on";
	} catch {
		return false;
	}
}

// Last successful geolocation fix, scoped to recent sessions so the next
// locate tap can paint a marker instantly instead of waiting ~1.3s for the
// Android FLP roundtrip. TTL is intentionally short — this is a cold-start
// speedup, not a long-lived "last known location" feature. Past the TTL
// the position is stale enough that a brief blank wait is preferable to
// flashing an outdated marker.
const LAST_FIX_KEY = "puca:lastFix";
function readCachedFix(): CachedFix | null {
	try {
		return parseCachedFix(localStorage.getItem(LAST_FIX_KEY));
	} catch {
		return null;
	}
}

function writeCachedFix(fix: CachedFix): void {
	try {
		localStorage.setItem(LAST_FIX_KEY, JSON.stringify(fix));
	} catch {
		/* quota / disabled */
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
	const userMarkerRef = useRef<L.Marker | null>(null);
	const userIconInnerRef = useRef<HTMLElement | null>(null);
	const accuracyCircleRef = useRef<L.Circle | null>(null);
	const locationWatchIdRef = useRef<number | null>(null);
	const locationRefineTimerRef = useRef<number | null>(null);
	const orientationHandlerRef = useRef<
		((e: DeviceOrientationEvent) => void) | null
	>(null);
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
		const iosHeading = (
			e as DeviceOrientationEvent & { webkitCompassHeading?: number }
		).webkitCompassHeading;
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
					try {
						localStorage.setItem(COMPASS_PREF_KEY, "off");
					} catch {
						/* quota */
					}
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
		try {
			localStorage.setItem(COMPASS_PREF_KEY, "on");
		} catch {
			/* quota */
		}
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
		try {
			localStorage.setItem(COMPASS_PREF_KEY, "off");
		} catch {
			/* quota */
		}
	}

	const locateUser = (
		options: { onFinalAccuracy?: (accuracy: number) => void } = {},
	): Promise<{ accuracy: number }> =>
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

			// When compass pref is on, every locate click also kicks off compass
			// (iOS piggybacks on this click's gesture to re-grant motion permission
			// after a reload). startCompass is idempotent — early-returns when
			// already tracking, so this doesn't re-prompt.
			if (readCompassPref()) {
				void startCompass();
			}

			if (locationWatchIdRef.current !== null) {
				navigator.geolocation.clearWatch(locationWatchIdRef.current);
				locationWatchIdRef.current = null;
			}
			if (locationRefineTimerRef.current !== null) {
				window.clearTimeout(locationRefineTimerRef.current);
				locationRefineTimerRef.current = null;
			}

			let bestAccuracy = Number.POSITIVE_INFINITY;
			let bestFix: { lat: number; lng: number; accuracy: number } | null = null;
			let freshFixApplied = false;
			let promiseSettled = false;
			let finalAccuracyReported = false;

			const cleanupLocationWatch = () => {
				if (locationWatchIdRef.current !== null) {
					navigator.geolocation.clearWatch(locationWatchIdRef.current);
					locationWatchIdRef.current = null;
				}
				if (locationRefineTimerRef.current !== null) {
					window.clearTimeout(locationRefineTimerRef.current);
					locationRefineTimerRef.current = null;
				}
			};
			const resolveLocate = () => {
				if (promiseSettled || !bestFix) return;
				promiseSettled = true;
				if (bestFix) resolve({ accuracy: bestFix.accuracy });
			};
			const reportFinalAccuracy = () => {
				if (finalAccuracyReported || !bestFix) return;
				finalAccuracyReported = true;
				options.onFinalAccuracy?.(bestFix.accuracy);
			};
			const finish = () => {
				cleanupLocationWatch();
				if (bestFix) {
					resolveLocate();
					reportFinalAccuracy();
				} else if (!promiseSettled) {
					promiseSettled = true;
					reject(new Error("Your location is unavailable"));
				}
			};
			const fail = (err: GeolocationPositionError) => {
				cleanupLocationWatch();
				if (!promiseSettled) {
					promiseSettled = true;
					reject(err);
				}
			};

			const applyFix = (
				lat: number,
				lng: number,
				accuracy: number,
				options: { fly?: boolean } = {},
			): void => {
				const { fly = true } = options;
				const latlng: L.LatLngExpression = [lat, lng];
				if (!userMarkerRef.current) {
					const icon = L.divIcon({
						className: "user-loc-marker",
						html:
							'<div class="user-loc-icon">' +
							'<svg class="user-loc-cone" viewBox="0 0 80 80" aria-hidden="true">' +
							"<defs>" +
							'<radialGradient id="user-loc-grad" cx="40" cy="40" r="38" gradientUnits="userSpaceOnUse">' +
							'<stop offset="0.15" stop-color="#1e88e5" stop-opacity="0.9"/>' +
							'<stop offset="1" stop-color="#1e88e5" stop-opacity="0"/>' +
							"</radialGradient>" +
							"</defs>" +
							// ~100° wedge pointing up (12 o'clock), centered on (40,40) with radius 38
							'<path d="M40 40 L10.88 15.58 A38 38 0 0 1 69.12 15.58 Z" fill="url(#user-loc-grad)"/>' +
							"</svg>" +
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
				if (fly) {
					map.flyTo(latlng, 14, {
						duration: 1.0,
						easeLinearity: 0.3,
					});
				}
			};

			// First-tap-of-session optimization for Android: paint the last-known
			// fix immediately so the map moves without waiting on FLP. Skip when a
			// marker already exists — subsequent taps in the same session ride the
			// OS maximumAge cache and don't need this.
			if (!userMarkerRef.current) {
				const cached = readCachedFix();
				if (cached) {
					applyFix(cached.lat, cached.lng, cached.accuracy);
				}
			}

			locationRefineTimerRef.current = window.setTimeout(
				finish,
				LOCATION_REFINE_MS,
			);

			locationWatchIdRef.current = navigator.geolocation.watchPosition(
				(pos) => {
					const { latitude, longitude, accuracy } = pos.coords;
					const decision = decideLocationFix(
						{ bestAccuracy, freshFixApplied },
						accuracy,
					);
					if (decision.accepted) {
						bestAccuracy = decision.nextState.bestAccuracy;
						bestFix = { lat: latitude, lng: longitude, accuracy };
						applyFix(latitude, longitude, accuracy, {
							fly: decision.fly,
						});
						freshFixApplied = decision.nextState.freshFixApplied;
						resolveLocate();
					}
					writeCachedFix({
						lat: latitude,
						lng: longitude,
						accuracy,
						ts: Date.now(),
					});
					if (decision.shouldFinish) finish();
				},
				(err) => {
					if (bestFix) finish();
					else fail(err);
				},
				{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
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
		const popupPane = map.getPane("popupPane");
		const mapPane = map.getPanes().mapPane;
		const originalPopupParent = popupPane?.parentElement ?? null;
		const originalPopupNextSibling = popupPane?.nextSibling ?? null;
		let syncPopupPane: (() => void) | null = null;
		if (popupPane) {
			// Leaflet nests popupPane inside the transformed mapPane, so app chrome with
			// fixed z-index can still cover popups. Move only popupPane up to the map
			// container and mirror mapPane's transform so coordinates stay aligned.
			map.getContainer().append(popupPane);
			syncPopupPane = () => {
				popupPane.style.transform = mapPane.style.transform;
				popupPane.style.transformOrigin =
					getComputedStyle(mapPane).transformOrigin;
			};
			syncPopupPane();
			map.on(
				"move zoom zoomanim zoomstart zoomend viewreset resize",
				syncPopupPane,
			);
		}

		const baseLayer = L.tileLayer(TILE_VOYAGER, {
			...BASE_TILE_OPTIONS,
			className: "tile-voyager",
		});
		baseLayer.addTo(map);
		// Ensure base tile stays behind railway overlay
		baseLayer.bringToBack();

		// Railway lines overlay (only in train mode)
		railwayLayerRef.current = L.tileLayer(
			"https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
			{
				attribution:
					'&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
				maxZoom: 19,
				opacity: 0.75,
				keepBuffer: 10,
				updateWhenIdle: false,
				updateWhenZooming: false,
				updateInterval: 100,
			},
		);
		if (mode === "train") railwayLayerRef.current.addTo(map);

		// Pause marker tick during any map animation (zoom OR pan), so panTo-on-select
		// doesn't compete with per-frame setLatLng + cluster reindex.
		map.on("movestart", () => {
			zoomingRef.current = true;
		});
		map.on("moveend", () => {
			zoomingRef.current = false;
		});
		// Load stations for route line drawing in popups
		getStationsOnce().then((data) => {
			const m = new Map<string, Station>();
			for (const s of data) m.set(s.code, s);
			stationsRef.current = m;
		});

		leafletMap.current = map;

		return () => {
			if (popupPane && syncPopupPane) {
				map.off(
					"move zoom zoomanim zoomstart zoomend viewreset resize",
					syncPopupPane,
				);
				popupPane.style.transform = "";
				popupPane.style.transformOrigin = "";
				if (originalPopupParent) {
					originalPopupParent.insertBefore(popupPane, originalPopupNextSibling);
				}
			}
			teardownCompass();
			if (locationWatchIdRef.current !== null) {
				navigator.geolocation.clearWatch(locationWatchIdRef.current);
				locationWatchIdRef.current = null;
			}
			if (locationRefineTimerRef.current !== null) {
				window.clearTimeout(locationRefineTimerRef.current);
				locationRefineTimerRef.current = null;
			}
			map.remove();
			leafletMap.current = null;
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

	// Auto-restore compass only after an explicit user opt-in. On iOS this will
	// silently fail after a reload because requestPermission() needs a fresh user
	// gesture; the saved pref keeps the toggle On so tapping it can retry.
	useEffect(() => {
		if (readCompassPref()) {
			void startCompass();
		}
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
