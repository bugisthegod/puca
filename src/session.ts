// Persists the user's long-lived app state (mode, filter, bus operator, map
// view) to localStorage so closing and reopening the app resumes where they
// left off. Search state that should die with the tab lives in sessionStorage.

import type { BusOperator } from "./types";
import type { Filter } from "./utils";
import type { Mode } from "./hooks/useTrainMap";

const KEY = "puca-session-v1";
const BUS_SEARCH_KEY = "puca-bus-search-v1";

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export interface Session {
  mode: Mode;
  filter: Filter;
  busOperator: BusOperator;
  mapView: MapView | null;
}

export type BusSearchTab = "route" | "stop";
const BUS_SEARCH_TABS: readonly BusSearchTab[] = ["route", "stop"];

export interface BusSearchSession {
  busRoute: string | null;
  busDirection: string | null;
  busSearchTab: BusSearchTab;
  busStopId: string | null;
  // Stop search is cross-operator, so a stopId alone no longer identifies a
  // stop — the same code can exist in multiple fleets. Persist the picked
  // stop's operator alongside the id so rehydrate can hit the right API.
  busStopOperator: BusOperator | null;
  routeQuery: string;
  stopQuery: string;
}

const MODES: readonly Mode[] = ["train", "bus"];
const FILTERS: readonly Filter[] = ["all", "dart", "commuter", "intercity"];
const OPERATORS: readonly BusOperator[] = ["dublinbus", "buseireann", "goahead"];

function validMapView(v: unknown): MapView | null {
  if (!v || typeof v !== "object") return null;
  const { lat, lng, zoom } = v as Partial<MapView>;
  if (
    typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < 0 || zoom > 22
  ) return null;
  return { lat, lng, zoom };
}

export function loadSession(): Partial<Session> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const s = JSON.parse(raw) as Partial<Session>;
    const out: Partial<Session> = {};
    if (s.mode && MODES.includes(s.mode)) out.mode = s.mode;
    if (s.filter && FILTERS.includes(s.filter)) out.filter = s.filter;
    if (s.busOperator && OPERATORS.includes(s.busOperator)) out.busOperator = s.busOperator;
    const mv = validMapView(s.mapView);
    if (mv) out.mapView = mv;
    return out;
  } catch {
    return {};
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // quota or disabled — non-critical
  }
}

export function loadBusSearchSession(): Partial<BusSearchSession> {
  try {
    const raw = sessionStorage.getItem(BUS_SEARCH_KEY);
    if (!raw) return {};
    const s = JSON.parse(raw) as Partial<BusSearchSession>;
    const out: Partial<BusSearchSession> = {};
    if (typeof s.busRoute === "string") out.busRoute = s.busRoute;
    if (typeof s.busDirection === "string") out.busDirection = s.busDirection;
    if (s.busSearchTab && BUS_SEARCH_TABS.includes(s.busSearchTab)) out.busSearchTab = s.busSearchTab;
    // Legacy sessionStorage (or malformed values) can still contain a stop id
    // without a valid operator. Drop the pair rather than risk rehydrating the
    // wrong fleet's arrivals view.
    if (typeof s.busStopId === "string" && s.busStopOperator && OPERATORS.includes(s.busStopOperator)) {
      out.busStopId = s.busStopId;
      out.busStopOperator = s.busStopOperator;
    }
    if (typeof s.routeQuery === "string") out.routeQuery = s.routeQuery;
    if (typeof s.stopQuery === "string") out.stopQuery = s.stopQuery;
    return out;
  } catch {
    return {};
  }
}

export function saveBusSearchSession(s: BusSearchSession): void {
  try {
    sessionStorage.setItem(BUS_SEARCH_KEY, JSON.stringify(s));
  } catch {
    // quota or disabled — non-critical
  }
}

export function clearBusSearchSession(): void {
  try {
    sessionStorage.removeItem(BUS_SEARCH_KEY);
  } catch {
    // disabled — non-critical
  }
}
