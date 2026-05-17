import { type RefObject, useEffect, useRef } from "react";
import type { MapView } from "../session";
import type {
	BusOperator,
	BusVehicle,
	FocusContext,
	Train,
	TrainFocusSummary,
} from "../types";
import type { Filter } from "../utils";
import { alongLookup } from "./routeProjection";
import { computeBusCurrentDistance, useBusMarkers } from "./useBusMarkers";
import { useFocusSegment } from "./useFocusSegment";
import { useMapInstance } from "./useMapInstance";
import type { FocusTrainResult } from "./useTrainMarkers";
import { useTrainMarkers } from "./useTrainMarkers";

export type Mode = "train" | "bus";

const BLEND_DURATION = 1500;
const EXTRAP_CAP = 35_000;

// Lookup-table positions replace turf's O(n) along() — binary search is cheap
// enough to run at 30 FPS without CPU pressure. Faster than the old 20 FPS
// but avoids the per-frame setLatLng DOM cost of running at full 60 FPS.
const TICK_INTERVAL_MS = 33;

interface UseVehicleMapOptions {
	currentBusRoute?: string | null;
	onSelectBusRoute?: (route: string, direction: string) => void;
	onRouteJump?: (route: string, direction: string) => void;
	initialView?: MapView | null;
	focusContext?: FocusContext | null;
	onFocusSegmentStatus?: (status: "ok" | "unavailable") => void;
	onBusFocusStopsAway?: (stopsAway: number | null) => void;
	onTrainFocusSummary?: (summary: TrainFocusSummary | null) => void;
}

export function useVehicleMap(
	mapRef: RefObject<HTMLDivElement | null>,
	trains: Train[],
	filter: Filter,
	searchCodes: string[] | null = null,
	mode: Mode = "train",
	buses: BusVehicle[] = [],
	busShape: {
		[direction: string]: {
			headsign: string;
			coords: [number, number][];
			stops: { id: string; name: string; lat: number; lng: number }[];
			variants?: {
				shapeId: string;
				tripCount: number;
				branches: [number, number][][];
			}[];
		};
	} | null = null,
	busDirection: string | null = null,
	busOperator: BusOperator = "dublinbus",
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
	} = options;

	const onSelectBusRouteRef = useRef(onSelectBusRoute);
	onSelectBusRouteRef.current = onSelectBusRoute;
	const onRouteJumpRef = useRef(onRouteJump);
	onRouteJumpRef.current = onRouteJump;

	const rafId = useRef<number>(0);
	const lastTickTime = useRef<number>(0);
	const busClusterLayer = useRef<L.MarkerClusterGroup | L.LayerGroup | null>(
		null,
	);

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
		filter,
		searchCodes,
		mode,
		leafletMap,
		stationsRef,
		onTrainFocusSummary,
	});

	function closePopup(): void {
		leafletMap.current?.closePopup();
	}

	const { busMarkers } = useBusMarkers({
		buses,
		busShape,
		busDirection,
		busOperator,
		mode,
		currentBusRoute,
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

	// Bus container lifecycle — recreated on mode/operator/single-route change.
	// - Default: MarkerClusterGroup (cluster icon closure captures operator color)
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
			const operatorClass =
				busOperator === "buseireann"
					? "bus-cluster--buseireann"
					: busOperator === "goahead"
						? "bus-cluster--goahead"
						: "";

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
					const size =
						count >= 100 ? "large" : count >= 20 ? "medium" : "small";
					const dim = size === "large" ? 46 : size === "medium" ? 38 : 30;
					return L.divIcon({
						html: `<span>${count}</span>`,
						className:
							`bus-cluster bus-cluster--${size} ${operatorClass}`.trim(),
						iconSize: L.point(dim, dim),
					});
				},
			});
		}
		busClusterLayer.current.addTo(map);
	}, [mode, busOperator, singleRouteMode]);

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
					const capped = Math.min(
						advanced,
						entry.targetDistanceAlongRoute + TRAIN_EXTRAP_BUFFER_METERS,
					);
					const clamped = Math.max(
						0,
						Math.min(capped, entry.routeLengthMeters),
					);
					if (entry.routeLookup) {
						const [lat, lng] = alongLookup(entry.routeLookup, clamped);
						entry.marker.setLatLng([lat, lng]);
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
					const lat =
						entry.correctionFromLat +
						(extrapLat - entry.correctionFromLat) * ease;
					const lng =
						entry.correctionFromLng +
						(extrapLng - entry.correctionFromLng) * ease;
					entry.marker.setLatLng([lat, lng]);
				} else {
					entry.marker.setLatLng([extrapLat, extrapLng]);
				}
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

				// On-route: lerp between prevDistance (where the marker was at last
				// ping) and currentDistance (latest GPS projection) over the fixed
				// animation window. After t hits 1 the marker sits at currentDistance
				// — no extrapolation, no snap-back when the next ping arrives.
				if (
					!entry.offRoute &&
					entry.routeLookup &&
					entry.currentDistance !== null
				) {
					const dist = computeBusCurrentDistance(entry, now);
					if (dist === null) continue;
					if (entry.lastRenderedDistance === dist) continue;
					const [lat, lng] = alongLookup(entry.routeLookup, dist);
					entry.marker.setLatLng([lat, lng]);
					entry.lastRenderedDistance = dist;
					continue;
				}

				// Off-route fallback: blend lat/lng over BLEND_DURATION, then settle.
				if (entry.settled) continue;
				const blendElapsed = now - entry.correctionStartTime;
				if (blendElapsed < BLEND_DURATION) {
					const t = blendElapsed / BLEND_DURATION;
					const ease = 1 - (1 - t) * (1 - t);
					const lat =
						entry.correctionFromLat +
						(entry.targetLat - entry.correctionFromLat) * ease;
					const lng =
						entry.correctionFromLng +
						(entry.targetLng - entry.correctionFromLng) * ease;
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
