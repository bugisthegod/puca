import { type RefObject, useCallback, useEffect, useRef } from "react";
import type {
	BusOperator,
	BusShape,
	BusVehicle,
	FocusContext,
	LuasStop,
	RealtimeHealth,
	Train,
	TrainFocusSummary,
	VehicleBounds,
} from "../../types";
import type { MapView } from "../session";
import { tickBusMarker } from "./busAnimation";
import { tickTrainMarker } from "./trainAnimation";
import { useBusMarkers } from "./useBusMarkers";
import { useFocusSegment } from "./useFocusSegment";
import { useMapInstance } from "./useMapInstance";
import type { FocusTrainResult } from "./useTrainMarkers";
import { useTrainMarkers } from "./useTrainMarkers";

export type Mode = "train" | "bus" | "luas";

const ROUTE_MIN_ANIM_DURATION_MS = 5_000;
const ROUTE_MAX_ANIM_DURATION_MS = 60_000;
const FOCUS_MIN_ANIM_DURATION_MS = 1_500;
const FOCUS_MAX_ANIM_DURATION_MS = 4_000;
const MAX_CACHE_CATCHUP_MS = 8_000;

// Lookup-table positions replace turf's O(n) along() — binary search is cheap
// enough to run at 30 FPS without CPU pressure. Faster than the old 20 FPS
// but avoids the per-frame setLatLng DOM cost of running at full 60 FPS.
const TICK_INTERVAL_MS = 33;
const BUS_VIEWPORT_BOUNDS_DEBOUNCE_MS = 150;

export function busAnimationDurationMs(
	prevTimestamp: number,
	nextTimestamp: number,
	realtimeAgeSec: number | null,
	minDurationMs: number,
	maxDurationMs: number,
): number {
	const measuredMs = (nextTimestamp - prevTimestamp) * 1000;
	const catchupMs =
		realtimeAgeSec === null
			? 0
			: Math.min(MAX_CACHE_CATCHUP_MS, Math.max(0, realtimeAgeSec * 1000));
	return Math.max(
		minDurationMs,
		Math.min(measuredMs - catchupMs, maxDurationMs),
	);
}

function getPaddedVehicleBounds(map: L.Map): VehicleBounds {
	const bounds = map.getBounds().pad(0.5);
	return {
		north: bounds.getNorth(),
		south: bounds.getSouth(),
		east: bounds.getEast(),
		west: bounds.getWest(),
	};
}

function busClusterOperatorClass(cluster: L.MarkerCluster): string {
	const counts = {
		dublinbus: 0,
		buseireann: 0,
		goahead: 0,
	};
	for (const marker of cluster.getAllChildMarkers()) {
		const className = marker.getIcon().options.className ?? "";
		if (className.includes("bus-marker--buseireann")) counts.buseireann++;
		else if (className.includes("bus-marker--goahead")) counts.goahead++;
		else counts.dublinbus++;
	}
	const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	const [top, runnerUp] = entries;
	if (!top || !runnerUp || top[1] === runnerUp[1])
		return "bus-cluster--dublinbus";
	return `bus-cluster--${top[0]}`;
}

interface UseVehicleMapOptions {
	currentBusRoute?: string | null;
	onSelectBusRoute?: (
		route: string,
		direction: string,
		operator?: BusOperator,
	) => void;
	onRouteJump?: (
		route: string,
		direction: string,
		operator?: BusOperator,
	) => void;
	initialView?: MapView | null;
	focusContext?: FocusContext | null;
	onFocusSegmentStatus?: (status: "ok" | "unavailable") => void;
	onBusFocusStopsAway?: (stopsAway: number | null) => void;
	onTrainFocusSummary?: (summary: TrainFocusSummary | null) => void;
	onBusViewportBoundsChange?: (bounds: VehicleBounds | null) => void;
	luasStops?: LuasStop[];
	selectedLuasStopId?: string | null;
	onSelectLuasStop?: (stop: LuasStop) => void;
}

export function useVehicleMap(
	mapRef: RefObject<HTMLDivElement | null>,
	trains: Train[],
	searchCodes: string[] | null = null,
	mode: Mode = "train",
	buses: BusVehicle[] = [],
	busShape: BusShape = null,
	busDirection: string | null = null,
	busOperator: BusOperator = "dublinbus",
	busRealtimeHealth: RealtimeHealth | null = null,
	options: UseVehicleMapOptions = {},
): {
	focusTrain: (
		code: string,
		boardingStationCode?: string,
	) => Promise<FocusTrainResult>;
	clearTrainFocus: () => void;
	locateUser: (options?: {
		onFinalAccuracy?: (accuracy: number) => void;
	}) => Promise<{ accuracy: number }>;
	getMapView: () => MapView | null;
	closePopup: () => void;
	compassPref: boolean;
	startCompass: () => Promise<boolean>;
	stopCompass: () => void;
} {
	const {
		currentBusRoute = null,
		onSelectBusRoute,
		onRouteJump,
		initialView = null,
		focusContext = null,
		onFocusSegmentStatus,
		onBusFocusStopsAway,
		onTrainFocusSummary,
		onBusViewportBoundsChange,
		luasStops = [],
		selectedLuasStopId = null,
		onSelectLuasStop,
	} = options;

	const onSelectBusRouteRef = useRef(onSelectBusRoute);
	onSelectBusRouteRef.current = onSelectBusRoute;
	const onRouteJumpRef = useRef(onRouteJump);
	onRouteJumpRef.current = onRouteJump;
	const onSelectLuasStopRef = useRef(onSelectLuasStop);
	onSelectLuasStopRef.current = onSelectLuasStop;

	const rafId = useRef<number>(0);
	const lastTickTime = useRef<number>(0);
	const busClusterLayer = useRef<L.MarkerClusterGroup | L.LayerGroup | null>(
		null,
	);
	const luasLayerRef = useRef<L.LayerGroup | null>(null);
	const luasMarkersRef = useRef<Map<string, L.Marker>>(new Map());

	// Single-route view (e.g. user searched 38A and picked a direction) holds
	// <20 buses — clustering adds visual noise and is unnecessary. Swap to a
	// plain LayerGroup so each bus renders individually.
	const singleRouteMode = !!(currentBusRoute && busDirection);

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

	const { markers, clearTrainFocus, focusTrain } = useTrainMarkers({
		trains,
		searchCodes,
		mode,
		leafletMap,
		stationsRef,
		onTrainFocusSummary,
	});

	function closePopup(): void {
		leafletMap.current?.closePopup();
	}

	const getBusAnimationDurationMs = useCallback(
		(
			prevTimestamp: number,
			nextTimestamp: number,
			realtimeAgeSec: number | null,
			tripId: string,
		) => {
			const focused = focusContext?.tripId === tripId;
			return busAnimationDurationMs(
				prevTimestamp,
				nextTimestamp,
				realtimeAgeSec,
				focused ? FOCUS_MIN_ANIM_DURATION_MS : ROUTE_MIN_ANIM_DURATION_MS,
				focused ? FOCUS_MAX_ANIM_DURATION_MS : ROUTE_MAX_ANIM_DURATION_MS,
			);
		},
		[focusContext?.tripId],
	);

	const { busMarkers } = useBusMarkers({
		buses,
		busShape,
		busDirection,
		busOperator,
		mode,
		currentBusRoute,
		realtimeAgeSec: busRealtimeHealth?.ageSec ?? null,
		getAnimationDurationMs: getBusAnimationDurationMs,
		onSelectBusRoute: onSelectBusRouteRef,
		onRouteJump: onRouteJumpRef,
		leafletMap,
		busClusterLayer,
	});

	useFocusSegment({
		focusContext,
		leafletMap,
		busMarkers,
		mode,
		onSegmentStatus: onFocusSegmentStatus,
		onStopsAwayChange: onBusFocusStopsAway,
	});

	useEffect(() => {
		const map = leafletMap.current;
		if (!map) return;
		if (!luasLayerRef.current) luasLayerRef.current = L.layerGroup();
		const layer = luasLayerRef.current;
		if (mode !== "luas") {
			if (map.hasLayer(layer)) map.removeLayer(layer);
			return;
		}
		if (!map.hasLayer(layer)) layer.addTo(map);

		const nextIds = new Set(luasStops.map((stop) => stop.id));
		for (const [id, marker] of luasMarkersRef.current) {
			if (nextIds.has(id)) continue;
			layer.removeLayer(marker);
			luasMarkersRef.current.delete(id);
		}

		for (const stop of luasStops) {
			const selected = stop.id === selectedLuasStopId;
			const className = [
				"luas-stop-marker",
				`luas-stop-marker--${stop.line}`,
				selected ? "luas-stop-marker--selected" : "",
			]
				.filter(Boolean)
				.join(" ");
			const icon = L.divIcon({
				className,
				html: `<span></span>`,
				iconSize: L.point(selected ? 18 : 14, selected ? 18 : 14),
				iconAnchor: L.point(selected ? 9 : 7, selected ? 9 : 7),
			});
			let marker = luasMarkersRef.current.get(stop.id);
			if (!marker) {
				marker = L.marker([stop.lat, stop.lng], {
					icon,
					title: stop.name,
					zIndexOffset: selected ? 500 : 0,
				});
				marker.addTo(layer);
				luasMarkersRef.current.set(stop.id, marker);
			} else {
				marker.setLatLng([stop.lat, stop.lng]);
				marker.setIcon(icon);
				marker.setZIndexOffset(selected ? 500 : 0);
			}
			marker.off("click");
			marker.on("click", () => onSelectLuasStopRef.current?.(stop));
		}
	}, [leafletMap, luasStops, mode, selectedLuasStopId]);

	useEffect(() => {
		const map = leafletMap.current;
		if (!map || !onBusViewportBoundsChange) return;
		if (mode !== "bus" || singleRouteMode) {
			onBusViewportBoundsChange(null);
			return;
		}

		let debounceTimer: ReturnType<typeof setTimeout> | null = null;
		const emitBounds = () => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
			onBusViewportBoundsChange(getPaddedVehicleBounds(map));
		};
		const onViewChange = () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				onBusViewportBoundsChange(getPaddedVehicleBounds(map));
			}, BUS_VIEWPORT_BOUNDS_DEBOUNCE_MS);
		};

		emitBounds();
		map.on("moveend zoomend resize", onViewChange);
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			map.off("moveend zoomend resize", onViewChange);
		};
	}, [mode, singleRouteMode, onBusViewportBoundsChange]);

	// Bus container lifecycle — recreated on mode/single-route change.
	// - Default: MarkerClusterGroup for the mixed-operator all-bus view
	// - Single-route mode: plain LayerGroup, no clustering for the handful of buses
	useEffect(() => {
		const map = leafletMap.current;
		if (!map) return;

		if (busClusterLayer.current) {
			busClusterLayer.current.clearLayers();
			if (map.hasLayer(busClusterLayer.current))
				map.removeLayer(busClusterLayer.current);
			busClusterLayer.current = null;
			busMarkers.current.clear();
		}

		if (mode !== "bus") return;

		if (singleRouteMode) {
			busClusterLayer.current = L.layerGroup();
		} else {
			busClusterLayer.current = L.markerClusterGroup({
				showCoverageOnHover: false,
				maxClusterRadius: (zoom) => (zoom < 12 ? 60 : zoom < 15 ? 45 : 30),
				disableClusteringAtZoom: 17,
				spiderfyOnMaxZoom: false,
				chunkedLoading: true,
				animate: false,
				animateAddingMarkers: false,
				iconCreateFunction: (cluster: L.MarkerCluster) => {
					const count = cluster.getChildCount();
					const size =
						count >= 100 ? "large" : count >= 20 ? "medium" : "small";
					const dim = size === "large" ? 46 : size === "medium" ? 38 : 30;
					return L.divIcon({
						html: `<span>${count}</span>`,
						className: `bus-cluster bus-cluster--${size} ${busClusterOperatorClass(cluster)}`,
						iconSize: L.point(dim, dim),
					});
				},
			});
		}
		busClusterLayer.current.addTo(map);
	}, [mode, singleRouteMode]);

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

			for (const [, entry] of markers.current) {
				if (!map.hasLayer(entry.marker)) continue;
				if (!bounds.contains([entry.targetLat, entry.targetLng])) continue;
				tickTrainMarker(entry, now);
			}

			for (const [, entry] of busMarkers.current) {
				const cluster = busClusterLayer.current;
				if (cluster) {
					if (!cluster.hasLayer(entry.marker)) continue;
					// Plain LayerGroup (single-route mode) lacks getVisibleParent —
					// every marker is its own visible parent, so the check is moot.
					if ("getVisibleParent" in cluster) {
						const visible = (cluster as L.MarkerClusterGroup).getVisibleParent(
							entry.marker,
						);
						if (visible !== entry.marker) continue;
					}
				} else if (!map.hasLayer(entry.marker)) {
					continue;
				}
				if (!bounds.contains([entry.targetLat, entry.targetLng])) continue;
				if (entry.marker.isPopupOpen?.()) continue;
				tickBusMarker(entry, now);
			}

			rafId.current = requestAnimationFrame(tickAllMarkers);
		}

		rafId.current = requestAnimationFrame(tickAllMarkers);
		return () => cancelAnimationFrame(rafId.current);
		// Intentional deps: this RAF loop reads live map and marker state from refs.
		// Restarting it on vehicle updates would add animation churn without new data.
	}, []);

	return {
		focusTrain,
		clearTrainFocus,
		locateUser,
		getMapView,
		closePopup,
		compassPref,
		startCompass,
		stopCompass,
	};
}
