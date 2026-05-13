import type { BusOperator, BusVehicle } from "../types";
import { escapeHtml } from "../utils";
import { PUCA_SVG } from "./busPopup";

// Side-view bus silhouette for vehicle markers. Body fill uses currentColor so
// per-operator CSS can drive the color via .bus-marker--*.bus-icon { color: ... }.
export const BUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 3 Q2 1 4 1 H20 Q22 1 22 3 V12 H2 Z" fill="currentColor"/><rect x="3.5" y="3" width="17" height="3.6" fill="rgba(255,255,255,0.92)" rx="0.5"/><line x1="8" y1="3" x2="8" y2="6.6" stroke="currentColor" stroke-width="0.6"/><line x1="13" y1="3" x2="13" y2="6.6" stroke="currentColor" stroke-width="0.6"/><line x1="18" y1="3" x2="18" y2="6.6" stroke="currentColor" stroke-width="0.6"/><circle cx="6.5" cy="13" r="2" fill="#1a1a1a"/><circle cx="17.5" cy="13" r="2" fill="#1a1a1a"/></svg>`;

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
		? `<div class="bus-puca">${PUCA_SVG}</div>${label}`
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
