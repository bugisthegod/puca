import type { BusOperator, BusVehicle } from "../../types";
import { escapeHtml } from "../../utils";

export const PUCA_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><g transform="translate(56 52) scale(0.78)"><path d="M 112 152 C 112 88, 168 72, 220 72 L 292 72 C 344 72, 400 88, 400 152 L 400 392 Q 376 444, 340 416 Q 304 390, 272 416 Q 240 442, 210 416 Q 180 390, 148 416 Q 118 442, 112 396 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 110 260 C 70 256, 54 292, 64 324 C 74 348, 104 346, 116 330 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 402 260 C 442 256, 458 292, 448 324 C 438 348, 408 346, 396 330 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 168 208 L 228 232 L 214 272 L 168 276 Z" fill="#16161c"/><path d="M 344 208 L 284 232 L 298 272 L 344 276 Z" fill="#16161c"/><path d="M 214 310 L 228 296 L 242 312 L 256 298 L 270 312 L 284 298 L 298 310 L 298 338 L 284 352 L 270 336 L 256 350 L 242 336 L 228 352 L 214 338 Z" fill="#16161c"/></g></svg>`;

export type BusIconSpec = {
	className: string;
	html: string;
	iconSize: [number, number];
	iconAnchor: [number, number];
};

export function busOperatorMarkerClass(op: BusOperator): string {
	if (op === "buseireann") return "bus-marker--buseireann";
	if (op === "goahead") return "bus-marker--goahead";
	return "";
}

const HALLOWEEN_COSTUMES = ["pumpkin", "bat", "witch"] as const;

// Stable pseudo-random distribution: GPS updates never change a vehicle's art.
export function busHalloweenCostume(bus: BusVehicle, operator: BusOperator) {
	const identity = `${operator}:${bus.label || bus.tripId}`;
	let hash = 2166136261;
	for (let i = 0; i < identity.length; i++) {
		hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
	}
	return HALLOWEEN_COSTUMES[(hash >>> 0) % HALLOWEEN_COSTUMES.length];
}

export function buildBusIconSpec(
	bus: BusVehicle,
	operator: BusOperator,
): BusIconSpec {
	const classes = [
		"bus-marker",
		busOperatorMarkerClass(operator),
		bus.stale ? "bus-marker--stale" : "",
	]
		.filter(Boolean)
		.join(" ");
	const label = `<div class="bus-label">${escapeHtml(bus.routeShortName)}</div>`;
	const costume = busHalloweenCostume(bus, operator);
	const html = bus.stale
		? `<div class="bus-puca">${PUCA_MARKER_SVG}</div>${label}`
		: `<div class="bus-icon bus-icon--halloween"><img src="/${costume}-marker.png?v=paper-mix-2" width="36" height="36" alt="" aria-hidden="true" draggable="false" /></div>${label}`;
	return {
		className: classes,
		html,
		iconSize: [44, 52],
		iconAnchor: bus.stale ? [22, 26] : [22, 18],
	};
}

export function makeBusIcon(bus: BusVehicle, operator: BusOperator): L.DivIcon {
	return L.divIcon(buildBusIconSpec(bus, operator));
}
