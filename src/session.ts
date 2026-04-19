// Persists the user's current selections (mode, filter, bus operator/route/
// direction) to localStorage so closing and reopening the app resumes where
// they left off. Written once when the tab becomes hidden or unloads — not on
// every state change.

import type { BusOperator } from "./types";
import type { Filter } from "./utils";
import type { Mode } from "./hooks/useTrainMap";

const KEY = "puca-session-v1";

export interface Session {
  mode: Mode;
  filter: Filter;
  busOperator: BusOperator;
  busRoute: string | null;
  busDirection: string | null;
}

const MODES: readonly Mode[] = ["train", "bus"];
const FILTERS: readonly Filter[] = ["all", "dart", "commuter", "intercity"];
const OPERATORS: readonly BusOperator[] = ["dublinbus", "buseireann", "goahead"];

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
