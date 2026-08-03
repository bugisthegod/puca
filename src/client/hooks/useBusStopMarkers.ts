import { useEffect, useRef } from "react";
import type { BusOperator } from "../../types";
import type { StopSearchResult } from "../components/busSearchModel";
import type { BusMapView } from "../session";
import {
	busStopClusterRadius,
	dominantBusOperatorFromClassNames,
} from "./busClusterOperator";

type UseBusStopMarkersOptions = {
	leafletMap: React.MutableRefObject<L.Map | null>;
	mode: "train" | "bus" | "luas";
	busMapView: BusMapView;
	hidden: boolean;
	stops: StopSearchResult[];
	selectedStopId: string | null;
	selectedStopOperator: BusOperator | null;
	onSelectStop?: (stop: StopSearchResult) => void;
};

function markerKey(operator: BusOperator, stopId: string): string {
	return `${operator}:${stopId}`;
}

function stopMarkerIcon(stop: StopSearchResult, selected: boolean): L.DivIcon {
	const label = selected ? stop.code || stop.id : "";
	const element = document.createElement("span");
	element.className = "bus-map-stop-marker__dot";
	if (label) element.textContent = label;
	return L.divIcon({
		className: [
			"bus-map-stop-marker",
			`bus-map-stop-marker--${stop.operator}`,
			selected ? "bus-map-stop-marker--selected" : "",
		]
			.filter(Boolean)
			.join(" "),
		html: element,
		iconSize: L.point(selected ? 34 : 14, selected ? 34 : 14),
		iconAnchor: L.point(selected ? 17 : 7, selected ? 17 : 7),
	});
}

export function useBusStopMarkers({
	leafletMap,
	mode,
	busMapView,
	hidden,
	stops,
	selectedStopId,
	selectedStopOperator,
	onSelectStop,
}: UseBusStopMarkersOptions): void {
	const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
	const selectedMarkerRef = useRef<L.Marker | null>(null);
	const onSelectStopRef = useRef(onSelectStop);
	onSelectStopRef.current = onSelectStop;
	const selectedKey =
		selectedStopId && selectedStopOperator
			? markerKey(selectedStopOperator, selectedStopId)
			: null;
	const previousSelectedKeyRef = useRef<string | null>(null);

	useEffect(() => {
		const map = leafletMap.current;
		if (!map) return;
		const cluster = L.markerClusterGroup({
			showCoverageOnHover: false,
			// At street level only markers at the exact same point remain grouped.
			// Shared physical stops can then spiderfy into their operator records,
			// while separate poles a few metres apart stay individually clickable.
			maxClusterRadius: busStopClusterRadius,
			spiderfyOnMaxZoom: true,
			chunkedLoading: false,
			animate: false,
			animateAddingMarkers: false,
			iconCreateFunction: (group) => {
				const count = group.getChildCount();
				const size = count >= 100 ? "large" : count >= 20 ? "medium" : "small";
				const dimension = size === "large" ? 48 : size === "medium" ? 40 : 32;
				const operator = dominantBusOperatorFromClassNames(
					group
						.getAllChildMarkers()
						.map(
							(marker: L.Marker) => marker.getIcon().options.className ?? "",
						),
					"bus-map-stop-marker--",
				);
				return L.divIcon({
					html: `<span>${count}</span>`,
					className: `bus-stop-cluster bus-stop-cluster--${size} bus-stop-cluster--${operator}`,
					iconSize: L.point(dimension, dimension),
				});
			},
		});
		clusterRef.current = cluster;
		return () => {
			if (
				selectedMarkerRef.current &&
				map.hasLayer(selectedMarkerRef.current)
			) {
				map.removeLayer(selectedMarkerRef.current);
			}
			selectedMarkerRef.current = null;
			cluster.clearLayers();
			if (map.hasLayer(cluster)) map.removeLayer(cluster);
			clusterRef.current = null;
		};
	}, [leafletMap]);

	useEffect(() => {
		const map = leafletMap.current;
		const cluster = clusterRef.current;
		if (!map || !cluster) return;

		cluster.clearLayers();
		if (mode !== "bus" || busMapView !== "stops" || hidden) {
			if (map.hasLayer(cluster)) map.removeLayer(cluster);
			return;
		}

		if (!map.hasLayer(cluster)) cluster.addTo(map);
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let offset = 0;
		const addNextBatch = () => {
			if (cancelled || !map.hasLayer(cluster)) return;
			const nextOffset = Math.min(offset + 500, stops.length);
			const markers = stops.slice(offset, nextOffset).map((stop) => {
				const marker = L.marker([stop.lat, stop.lng], {
					icon: stopMarkerIcon(stop, false),
					title: `${stop.code || stop.id} — ${stop.name}`,
				});
				marker.on("click", () => onSelectStopRef.current?.(stop));
				return marker;
			});
			cluster.addLayers(markers);
			offset = nextOffset;
			if (offset < stops.length) timer = setTimeout(addNextBatch, 0);
		};
		addNextBatch();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
			cluster.clearLayers();
			if (map.hasLayer(cluster)) map.removeLayer(cluster);
		};
	}, [busMapView, hidden, leafletMap, mode, stops]);

	useEffect(() => {
		const map = leafletMap.current;
		if (!map) return;
		if (selectedMarkerRef.current && map.hasLayer(selectedMarkerRef.current)) {
			map.removeLayer(selectedMarkerRef.current);
		}
		selectedMarkerRef.current = null;

		if (mode === "bus" && busMapView === "stops" && !hidden && selectedKey) {
			const stop = stops.find(
				(candidate) =>
					markerKey(candidate.operator, candidate.id) === selectedKey,
			);
			if (stop) {
				const marker = L.marker([stop.lat, stop.lng], {
					icon: stopMarkerIcon(stop, true),
					title: `${stop.code || stop.id} — ${stop.name}`,
					zIndexOffset: 700,
				});
				marker.on("click", () => onSelectStopRef.current?.(stop));
				marker.addTo(map);
				selectedMarkerRef.current = marker;

				if (
					previousSelectedKeyRef.current !== selectedKey &&
					(map.getZoom() < 14 ||
						!map.getBounds().pad(-0.15).contains([stop.lat, stop.lng]))
				) {
					map.flyTo([stop.lat, stop.lng], Math.max(map.getZoom(), 15), {
						duration: 0.65,
					});
				}
				previousSelectedKeyRef.current = selectedKey;
			}
		} else {
			previousSelectedKeyRef.current = null;
		}
	}, [busMapView, hidden, leafletMap, mode, selectedKey, stops]);
}
