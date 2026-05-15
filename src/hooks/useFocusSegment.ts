import lineSliceAlong from "@turf/line-slice-along";
import {
	type MutableRefObject,
	type RefObject,
	useEffect,
	useRef,
} from "react";
import type { BusOperator, FocusContext } from "../types";
import {
	buildRouteLine,
	projectOntoRoute,
	segmentLengthM,
} from "./routeProjection";
import type { BusMarkerEntry } from "./useBusMarkers";
import type { Mode } from "./useVehicleMap";

function operatorColor(op: BusOperator): string {
	return op === "buseireann"
		? "#d52b1e"
		: op === "goahead"
			? "#1e6bb8"
			: "#f9a825";
}

type ShapeResponse = {
	[direction: string]: {
		headsign: string;
		coords: [number, number][];
		stops: { id: string; name: string; lat: number; lng: number }[];
	};
};

type OrderedProjection = {
	distanceMeters: number;
	segmentIndex: number;
	distanceFromPathMeters: number;
};

function buildCumulativeDistances(coords: [number, number][]): number[] {
	const cumulative = [0];
	for (let i = 1; i < coords.length; i++) {
		const prev = coords[i - 1];
		const cur = coords[i];
		const prevDistance = cumulative[i - 1];
		if (!prev || !cur || prevDistance === undefined) continue;
		cumulative.push(
			prevDistance + segmentLengthM(prev[0], prev[1], cur[0], cur[1]),
		);
	}
	return cumulative;
}

function projectOntoOrderedCoords(
	coords: [number, number][],
	cumulative: number[],
	lat: number,
	lng: number,
	startSegment = 0,
	endSegment = coords.length - 2,
): OrderedProjection | null {
	if (coords.length < 2) return null;
	const start = Math.max(0, Math.min(startSegment, coords.length - 2));
	const end = Math.max(start, Math.min(endSegment, coords.length - 2));
	const R = 6_371_000;
	const latRad = lat * (Math.PI / 180);
	let best: OrderedProjection | null = null;

	for (let i = start; i <= end; i++) {
		const a = coords[i];
		const b = coords[i + 1];
		const segStart = cumulative[i];
		const segEnd = cumulative[i + 1];
		if (!a || !b || segStart === undefined || segEnd === undefined) continue;
		const ax = (a[1] - lng) * (Math.PI / 180) * Math.cos(latRad) * R;
		const ay = (a[0] - lat) * (Math.PI / 180) * R;
		const bx = (b[1] - lng) * (Math.PI / 180) * Math.cos(latRad) * R;
		const by = (b[0] - lat) * (Math.PI / 180) * R;
		const vx = bx - ax;
		const vy = by - ay;
		const lenSq = vx * vx + vy * vy;
		const t =
			lenSq > 0 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / lenSq)) : 0;
		const px = ax + vx * t;
		const py = ay + vy * t;
		const dist = Math.sqrt(px * px + py * py);
		if (!best || dist < best.distanceFromPathMeters) {
			const segLen = segEnd - segStart;
			best = {
				distanceMeters: segStart + segLen * t,
				segmentIndex: i,
				distanceFromPathMeters: dist,
			};
		}
	}

	return best;
}

interface UseFocusSegmentOptions {
	focusContext: FocusContext | null;
	leafletMap: RefObject<L.Map | null>;
	busMarkers: MutableRefObject<Map<string, BusMarkerEntry>>;
	mode: Mode;
	onSegmentStatus?: (status: "ok" | "unavailable") => void;
	onStopsAwayChange?: (stopsAway: number | null) => void;
}

export function useFocusSegment({
	focusContext,
	leafletMap,
	busMarkers,
	mode,
	onSegmentStatus,
	onStopsAwayChange,
}: UseFocusSegmentOptions): void {
	const layersRef = useRef<{
		polylines: L.Polyline[];
		intermediates: L.Marker[];
		target: L.Marker | null;
	}>({ polylines: [], intermediates: [], target: null });

	// Cache shape responses by operator+route so rapid arrival switches don't refetch.
	const shapeCacheRef = useRef<Map<string, ShapeResponse>>(new Map());

	useEffect(() => {
		function removeLayers() {
			const map = leafletMap.current;
			const prev = layersRef.current;
			if (map) {
				for (const polyline of prev.polylines) map.removeLayer(polyline);
				for (const c of prev.intermediates) map.removeLayer(c);
				if (prev.target) map.removeLayer(prev.target);
			}
			layersRef.current = { polylines: [], intermediates: [], target: null };
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

		function focusBusOnly(activeMap: L.Map, busLatLng: L.LatLng): void {
			const zoom = Math.max(activeMap.getZoom(), 15);
			activeMap.flyTo(busLatLng, zoom, {
				duration: 1.0,
				easeLinearity: 0.3,
			});
		}

		let cancelled = false;
		let stopsAwayTimer: ReturnType<typeof setInterval> | null = null;

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
			if (!dirData || dirData.coords.length < 2) {
				onSegmentStatus?.("unavailable");
				return;
			}

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
			if (cancelled) return;
			if (!busEntry) {
				onSegmentStatus?.("unavailable");
				return;
			}

			const busLatLng = busEntry.marker.getLatLng();
			const lineInfo = buildRouteLine(dirData.coords);
			if (!lineInfo) {
				onSegmentStatus?.("unavailable");
				focusBusOnly(map, busLatLng);
				return;
			}

			const cumulative = buildCumulativeDistances(dirData.coords);
			const stopProjections: Array<OrderedProjection | null> = [];
			let minStopSegment = 0;
			for (const stop of dirData.stops) {
				const projected = projectOntoOrderedCoords(
					dirData.coords,
					cumulative,
					stop.lat,
					stop.lng,
					minStopSegment,
				);
				stopProjections.push(projected);
				if (projected) minStopSegment = projected.segmentIndex;
			}

			const busProj = projectOntoRoute(
				busLatLng.lat,
				busLatLng.lng,
				lineInfo.routeLine,
				lineInfo.routeLengthMeters,
				null,
				null,
				0,
			);
			const targetProj = projectOntoRoute(
				focusContext.targetStopLat,
				focusContext.targetStopLng,
				lineInfo.routeLine,
				lineInfo.routeLengthMeters,
				null,
				null,
				0,
			);
			// Buses parked at a terminus / depot commonly sit > 150m from the route
			// polyline (layby, holding bay), so projectOntoRoute returns offRoute even
			// though the trip hasn't started yet. Treating that as "no segment to draw"
			// makes clicks feel like the app is broken. Fudge the bus to the route
			// start (busD = 0); the bus icon stays at its real GPS, but the line still
			// appears from route-start → target stop. Target offRoute is fatal — means
			// the user's stop genuinely isn't on this route.
			if (targetProj.offRoute) {
				onSegmentStatus?.("unavailable");
				focusBusOnly(map, busLatLng);
				return;
			}
			const busD = busProj.offRoute ? 0 : busProj.targetDistanceAlongRoute;
			const targetD = targetProj.targetDistanceAlongRoute;
			if (busD >= targetD) {
				onSegmentStatus?.("unavailable");
				onStopsAwayChange?.(null);
				focusBusOnly(map, busLatLng);
				return;
			}

			let lastStopsAway: number | null = null;
			const reportStopsAway = () => {
				const latestEntry = busMarkers.current.get(focusContext.tripId);
				if (!latestEntry) {
					if (lastStopsAway !== null) {
						lastStopsAway = null;
						onStopsAwayChange?.(null);
					}
					return;
				}
				const latest = latestEntry.marker.getLatLng();
				const latestProj = projectOntoRoute(
					latest.lat,
					latest.lng,
					lineInfo.routeLine,
					lineInfo.routeLengthMeters,
					null,
					null,
					0,
				);
				const latestD = latestProj.offRoute
					? null
					: latestProj.targetDistanceAlongRoute;
				if (latestD === null) return;
				const remaining =
					latestD >= targetD
						? 0
						: stopProjections.filter(
								(sp) =>
									sp &&
									sp.distanceMeters > latestD &&
									sp.distanceMeters <= targetD,
							).length;
				if (remaining !== lastStopsAway) {
					lastStopsAway = remaining;
					onStopsAwayChange?.(remaining);
				}
			};

			let slicedCoords: [number, number][];
			try {
				const sliced = lineSliceAlong(
					lineInfo.routeLine,
					busD / 1000,
					targetD / 1000,
					{ units: "kilometers" },
				);
				slicedCoords = sliced.geometry.coordinates.map(
					([lng, lat]) => [lat, lng] as [number, number],
				);
			} catch {
				onSegmentStatus?.("unavailable");
				focusBusOnly(map, busLatLng);
				return;
			}
			if (cancelled) return;
			if (slicedCoords.length < 2) {
				onSegmentStatus?.("unavailable");
				focusBusOnly(map, busLatLng);
				return;
			}

			const color = operatorColor(focusContext.operator);

			// Polyline starts invisible; flyToBounds' zoom animation applies
			// transform:scale on the overlayPane SVG, which inflates stroke width
			// until the animation lands. vector-effect: non-scaling-stroke would be
			// the elegant fix but fails on WebKit when the transform is on an SVG
			// ancestor. Hiding the line during the 1.1s animation and restoring
			// opacity on zoom-end avoids the "stroke bleeds into a blob" look.
			const polyline = L.polyline(slicedCoords, {
				color,
				weight: 5,
				opacity: 0,
				lineCap: "round",
				lineJoin: "round",
				interactive: false,
			}).addTo(map);

			const intermediates: L.Marker[] = [];
			for (const [idx, stop] of dirData.stops.entries()) {
				if (stop.id === focusContext.targetStopId) continue;
				const sp = stopProjections[idx];
				if (!sp) continue;
				if (sp.distanceMeters <= busD || sp.distanceMeters >= targetD) continue;
				const m = L.marker([stop.lat, stop.lng], {
					icon: L.divIcon({
						className: `focus-stop focus-stop--${focusContext.operator}`,
						html: "",
						iconSize: [12, 12],
						iconAnchor: [6, 6],
					}),
					pane: "focusPane",
				});
				m.bindTooltip(stop.name, {
					direction: "top",
					offset: [0, -8],
					className: "stop-tooltip",
					opacity: 1,
				});
				m.addTo(map);
				intermediates.push(m);
			}

			// Target stop uses a bus-stop sign on a pole — a panel with the stop
			// code at top, thin pole below, anchored where the pole meets the
			// ground. Same "number-in-shape" language as the bus marker, but reads
			// unambiguously as a stop sign rather than a generic destination pin.
			const pinSvg = `<svg viewBox="0 0 32 42" class="focus-pin__svg" xmlns="http://www.w3.org/2000/svg"><rect class="sign" x="2" y="1" width="28" height="22" rx="3"/><rect class="pole" x="14.5" y="23" width="3" height="17"/></svg>`;
			const pinCode = focusContext.targetStopCode || "";
			const target = L.marker(
				[focusContext.targetStopLat, focusContext.targetStopLng],
				{
					icon: L.divIcon({
						className: `focus-pin focus-pin--${focusContext.operator}`,
						html: `${pinSvg}<span class="focus-pin__code" data-len="${pinCode.length}">${pinCode}</span>`,
						iconSize: [32, 42],
						iconAnchor: [16, 42],
					}),
					pane: "focusPane",
					zIndexOffset: 1000,
				},
			);
			target.bindTooltip(focusContext.targetStopName, {
				direction: "top",
				offset: [0, -34],
				className: "stop-tooltip",
				opacity: 1,
			});
			target.addTo(map);

			layersRef.current = {
				polylines: [polyline],
				intermediates,
				target,
			};
			onSegmentStatus?.("ok");
			reportStopsAway();
			stopsAwayTimer = setInterval(reportStopsAway, 1000);

			// Frame the whole segment (bus → target) so it fills the viewport —
			// matches the flyToBounds behaviour when a user picks a route from the
			// Route tab. User can then tap the bus themselves if they want the popup.
			map.flyToBounds(polyline.getBounds(), {
				paddingTopLeft: [20, 60],
				paddingBottomRight: [20, 80],
				maxZoom: 16,
				duration: 1.35,
				easeLinearity: 0.3,
			});

			// Restore polyline visibility after the zoom animation lands. Match the
			// flyToBounds duration (1.35s) plus a small buffer so the stroke swap
			// happens off-screen of the animation.
			setTimeout(() => {
				if (cancelled) return;
				if (!map.hasLayer(polyline)) return;
				polyline.setStyle({ opacity: 0.85 });
			}, 1400);
		})();

		return () => {
			cancelled = true;
			if (stopsAwayTimer) clearInterval(stopsAwayTimer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focusContext, mode]);
}
