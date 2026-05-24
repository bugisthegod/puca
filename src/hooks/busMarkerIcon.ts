import type { BusOperator, BusVehicle } from "../types";
import { escapeHtml } from "../utils";

// Side-view bus silhouette for vehicle markers. Body fill uses currentColor so
// per-operator CSS can drive the color via .bus-marker--*.bus-icon { color: ... }.
export const BUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 3 Q2 1 4 1 H20 Q22 1 22 3 V12 H2 Z" fill="currentColor"/><rect x="3.5" y="3" width="17" height="3.6" fill="rgba(255,255,255,0.92)" rx="0.5"/><line x1="8" y1="3" x2="8" y2="6.6" stroke="currentColor" stroke-width="0.6"/><line x1="13" y1="3" x2="13" y2="6.6" stroke="currentColor" stroke-width="0.6"/><line x1="18" y1="3" x2="18" y2="6.6" stroke="currentColor" stroke-width="0.6"/><circle cx="6.5" cy="13" r="2" fill="#1a1a1a"/><circle cx="17.5" cy="13" r="2" fill="#1a1a1a"/></svg>`;
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
	const html = bus.stale
		? `<div class="bus-puca">${PUCA_MARKER_SVG}</div>${label}`
		: `<div class="bus-icon">${BUS_SVG}</div>${label}`;
	return {
		className: classes,
		html,
		iconSize: bus.stale ? [44, 52] : [44, 30],
		iconAnchor: bus.stale ? [22, 26] : [22, 15],
	};
}

export function makeBusIcon(bus: BusVehicle, operator: BusOperator): L.DivIcon {
	return L.divIcon(buildBusIconSpec(bus, operator));
}
