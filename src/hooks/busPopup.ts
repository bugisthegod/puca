import { t as i18n } from "../i18n";
import type { BusVehicle } from "../types";
import { escapeHtml } from "../utils";

export const PUCA_IMG_HTML =
	'<img src="/puca-jack-o.svg?v=transparent-1" alt="" aria-hidden="true" loading="lazy" decoding="async" />';

export type BusTripStop = {
	sequence: number;
	name: string;
	lat: number;
	lng: number;
	scheduledArrivalSec: number | null;
	expectedArrivalSec: number | null;
	arrivalDelaySec: number | null;
	isCurrent?: boolean;
};

export type BusTripPopupData = {
	stops: BusTripStop[];
};

export type BusPopupOptions = {
	showRouteJump: boolean;
};

export function busPopupStatusFromDelay(sec: number | null): {
	text: string;
	cls: string;
} {
	if (sec === null) return { text: "", cls: "" };
	const min = Math.round(sec / 60);
	if (min <= 0) {
		const early = Math.abs(min);
		if (early < 1) return { text: i18n("popup.status.ontime"), cls: "" };
		return {
			text:
				early === 1
					? i18n("popup.status.early.one")
					: i18n("popup.status.early.many", { n: early }),
			cls: "",
		};
	}
	return {
		text:
			min === 1
				? i18n("popup.status.late.one")
				: i18n("popup.status.late.many", { n: min }),
		cls: min >= 10 ? "popup-status--red" : "popup-status--yellow",
	};
}

export function formatBusPopupSec(sec: number | null): string {
	if (sec === null) return "—";
	const h = Math.floor(sec / 3600) % 24;
	const m = Math.floor((sec % 3600) / 60);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function findCurrentStopIndex(
	bus: BusVehicle,
	trip: BusTripPopupData | null,
): number {
	if (!trip) return -1;
	let currentIdx = -1;
	let minDistSq = Infinity;
	for (let i = 0; i < trip.stops.length; i++) {
		const s = trip.stops[i];
		if (!s || (s.lat === 0 && s.lng === 0)) continue;
		const dLat = s.lat - bus.lat;
		const dLng = s.lng - bus.lng;
		const d = dLat * dLat + dLng * dLng;
		if (d < minDistSq) {
			minDistSq = d;
			currentIdx = i;
		}
	}
	return currentIdx;
}

export function buildBusPopupHTML(
	bus: BusVehicle,
	trip: BusTripPopupData | null,
	options: BusPopupOptions,
): string {
	const loading = trip === null;
	const currentIdx = findCurrentStopIndex(bus, trip);
	const rows = trip
		? trip.stops
				.map((s, i) => {
					const isCurrent = i === currentIdx;
					return `
            <tr class="${isCurrent ? "movement-current" : ""}">
              <td>${s.sequence}${isCurrent ? " ▶" : ""}</td>
              <td>${escapeHtml(s.name)}</td>
              <td>${formatBusPopupSec(s.scheduledArrivalSec)}</td>
              <td>${formatBusPopupSec(s.expectedArrivalSec)}</td>
            </tr>
          `;
				})
				.join("")
		: "";
	const body = loading
		? `<div class="popup-loading">${i18n("popup.bus.loading")}</div>`
		: trip && trip.stops.length > 0
			? `<div class="popup-table-wrap">
           <table class="movements-table">
             <thead>
               <tr><th>${i18n("popup.bus.col.num")}</th><th>${i18n("popup.bus.col.stop")}</th><th>${i18n("popup.bus.col.sched")}</th><th>${i18n("popup.bus.col.exp")}</th></tr>
             </thead>
             <tbody>${rows}</tbody>
           </table>
         </div>`
			: `<div class="popup-message">${i18n("popup.bus.empty")}</div>`;
	const jumpBtn = options.showRouteJump
		? `<button class="popup-route-jump" type="button" data-route="${encodeURIComponent(bus.routeShortName)}" data-dir="${bus.directionId}" data-operator="${bus.operator ?? ""}">${i18n("popup.bus.showall", { route: escapeHtml(bus.routeShortName) })}</button>`
		: "";
	const stops = trip?.stops ?? [];
	const originDest =
		stops.length >= 2
			? `<div class="popup-route">${escapeHtml(stops[0]?.name ?? "")} → ${escapeHtml(stops[stops.length - 1]?.name ?? "")}</div>`
			: "";
	const currentStop = trip && currentIdx >= 0 ? trip.stops[currentIdx] : null;
	const status = busPopupStatusFromDelay(currentStop?.arrivalDelaySec ?? null);
	const vehicleLabel = escapeHtml(bus.label || bus.tripId);
	const metaHtml = `
    <div class="popup-meta">
      ${status.text ? `<span class="popup-status ${status.cls}">${status.text}</span>` : ""}
      <span class="popup-dir">${i18n("popup.bus.vehicle", { label: vehicleLabel })}</span>
    </div>
  `;
	const staleBanner = bus.stale
		? `<div class="popup-stale-banner">
         <div class="popup-stale-icon">${PUCA_IMG_HTML}</div>
         <div class="popup-stale-text">
           <strong>${i18n("popup.bus.stale.title")}</strong>
           <span>${i18n("popup.bus.stale.body")}</span>
         </div>
       </div>`
		: "";
	return `
    <div class="popup-content">
      <div class="popup-header-row">
        <div class="popup-title">${escapeHtml(bus.routeShortName)}</div>
        ${jumpBtn}
      </div>
      ${originDest}
      ${metaHtml}
      ${staleBanner}
      ${body}
    </div>
  `;
}
