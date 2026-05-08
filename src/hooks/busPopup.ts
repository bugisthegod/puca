import type { BusVehicle } from "../types";
import { t as i18n } from "../i18n";
import { escapeHtml } from "../utils";

// Inline Púca jack-o'-lantern face used by the stale-trip marker and popup
// banner. Mirrors public/puca-jack-o.svg — duplicated as a raw SVG string
// because Leaflet divIcons and popup HTML can't render React components or
// follow build-time CSS url() imports for files served at runtime.
export const PUCA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><g transform="translate(56 52) scale(0.78)"><path d="M 112 152 C 112 88, 168 72, 220 72 L 292 72 C 344 72, 400 88, 400 152 L 400 392 Q 376 444, 340 416 Q 304 390, 272 416 Q 240 442, 210 416 Q 180 390, 148 416 Q 118 442, 112 396 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 110 260 C 70 256, 54 292, 64 324 C 74 348, 104 346, 116 330 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 402 260 C 442 256, 458 292, 448 324 C 438 348, 408 346, 396 330 Z" fill="#fff" stroke="#16161c" stroke-width="16" stroke-linejoin="round"/><path d="M 168 208 L 228 232 L 214 272 L 168 276 Z" fill="#16161c"/><path d="M 344 208 L 284 232 L 298 272 L 344 276 Z" fill="#16161c"/><path d="M 214 310 L 228 296 L 242 312 L 256 298 L 270 312 L 284 298 L 298 310 L 298 338 L 284 352 L 270 336 L 256 350 L 242 336 L 228 352 L 214 338 Z" fill="#16161c"/></g></svg>`;

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

export function busPopupStatusFromDelay(sec: number | null): { text: string; cls: string } {
  if (sec === null) return { text: "", cls: "" };
  const min = Math.round(sec / 60);
  if (min <= 0) {
    const early = Math.abs(min);
    if (early < 1) return { text: i18n("popup.status.ontime"), cls: "" };
    return {
      text: early === 1 ? i18n("popup.status.early.one") : i18n("popup.status.early.many", { n: early }),
      cls: "",
    };
  }
  return {
    text: min === 1 ? i18n("popup.status.late.one") : i18n("popup.status.late.many", { n: min }),
    cls: min >= 10 ? "popup-status--red" : "popup-status--yellow",
  };
}

export function formatBusPopupSec(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function findCurrentStopIndex(bus: BusVehicle, trip: BusTripPopupData | null): number {
  if (!trip) return -1;
  let currentIdx = -1;
  let minDistSq = Infinity;
  for (let i = 0; i < trip.stops.length; i++) {
    const s = trip.stops[i];
    if (!s || (s.lat === 0 && s.lng === 0)) continue;
    const dLat = s.lat - bus.lat;
    const dLng = s.lng - bus.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < minDistSq) { minDistSq = d; currentIdx = i; }
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
    ? `<button class="popup-route-jump" type="button" data-route="${encodeURIComponent(bus.routeShortName)}" data-dir="${bus.directionId}">${i18n("popup.bus.showall", { route: escapeHtml(bus.routeShortName) })}</button>`
    : "";
  const stops = trip?.stops ?? [];
  const originDest = stops.length >= 2
    ? `<div class="popup-route">${escapeHtml(stops[0]!.name)} → ${escapeHtml(stops[stops.length - 1]!.name)}</div>`
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
         <div class="popup-stale-icon">${PUCA_SVG}</div>
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
