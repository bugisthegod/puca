// Persists the user's current selections (mode, filter, bus operator/route/
// direction) to localStorage so closing and reopening the app resumes where
// they left off. Written once when the tab becomes hidden or unloads — not on
// every state change.

import type { BusOperator } from "./types";
import type { Filter } from "./utils";
import type { Mode } from "./hooks/useTrainMap";

const KEY = "puca-session-v1";

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export interface Session {
  mode: Mode;
  filter: Filter;
  busOperator: BusOperator;
  busRoute: string | null;
  busDirection: string | null;
  busSearchTab: BusSearchTab;
  busStopId: string | null;
  // Stop search is cross-operator, so a stopId alone no longer identifies a
  // stop — the same code can exist in multiple fleets. Persist the picked
  // stop's operator alongside the id so rehydrate can hit the right API.
  busStopOperator: BusOperator | null;
  mapView: MapView | null;
}

export type BusSearchTab = "route" | "stop";
const BUS_SEARCH_TABS: readonly BusSearchTab[] = ["route", "stop"];

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
    if (typeof s.busRoute === "string") out.busRoute = s.busRoute;
    if (typeof s.busDirection === "string") out.busDirection = s.busDirection;
    if (s.busSearchTab && BUS_SEARCH_TABS.includes(s.busSearchTab)) out.busSearchTab = s.busSearchTab;
    // Legacy sessions (pre-cross-operator-stop-search) only stored busStopId,
    // implicitly scoped to the global busOperator. After the change a stopId
    // without its own operator is ambiguous — drop it so the user picks again
    // rather than risk hitting the wrong fleet's arrivals API.
    if (typeof s.busStopId === "string" && s.busStopOperator && OPERATORS.includes(s.busStopOperator)) {
      out.busStopId = s.busStopId;
      out.busStopOperator = s.busStopOperator;
    }
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
