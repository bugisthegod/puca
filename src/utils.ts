import type { Train } from "./types";

export type Filter = "all" | "dart" | "commuter" | "intercity";

/** Parse late minutes from a PublicMessage string.
 *  Returns a number (negative = early, 0 = on time, positive = late).
 *  Returns null when the message gives no useful timing info.
 */
export function parseLateMinutes(message: string): number | null {
  if (/on time/i.test(message)) return 0;

  // Match patterns like: "(-1 mins late)", "(3 mins late)", "1 late", "Departed X 2 late"
  const match = message.match(/\(?\s*(-?\d+)\s*mins?\s*late\s*\)?/i);
  if (match?.[1] != null) return parseInt(match[1], 10);

  // Fallback: "Departed X N late"
  const deptMatch = message.match(/\d+\s*late/i);
  if (deptMatch?.[0] != null) {
    const numMatch = deptMatch[0].match(/(-?\d+)/);
    if (numMatch?.[1] != null) return parseInt(numMatch[1], 10);
  }

  return null;
}

/** Parse route info (origin -> destination) from PublicMessage. */
export function parseRoute(message: string): { origin: string; destination: string } | null {
  // Format: "TRAINCODE\nHH:MM - Origin to Destination (...)..."
  const routeMatch = message.match(/\d{2}:\d{2}\s*-\s*(.+?)\s+to\s+(.+?)\s*\(/i);
  if (routeMatch?.[1] != null && routeMatch[2] != null) {
    return { origin: routeMatch[1].trim(), destination: routeMatch[2].trim() };
  }
  return null;
}

/** Determine the color for a train marker based on status and lateness. */
export function markerColor(train: Train): string {
  if (train.status === "N" || train.status === "T") return "#9e9e9e"; // gray

  const late = parseLateMinutes(train.message);
  if (late === null) return "#9e9e9e";
  if (late <= 0) return "#4caf50";    // green — on time or early
  if (late <= 5) return "#ff9800";    // orange — 1-5 mins late
  return "#f44336";                   // red — >5 mins late
}

/** Return the train category for filtering. */
export function trainCategory(code: string): "dart" | "commuter" | "intercity" {
  if (code.startsWith("E")) return "dart";
  if (code.startsWith("P")) return "commuter";
  return "intercity";
}

/** Format a time string for display in the popup. */
export function fmtTime(t: string): string {
  if (!t) return "—";
  // already HH:MM or HH:MM:SS
  return t.length > 5 ? t.slice(0, 5) : t;
}

// Always anchored to Dublin — fly VMs run in UTC, client devices may be in
// any timezone, and Ireland observes DST (UTC in winter, UTC+1 in summer).
// Reading getHours() on a naive Date would drift by 1 hour for half the year
// and arbitrarily for a client who has changed their system clock.
const DUBLIN_TIME_FMT = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

function dublinMinutes(now: Date): number {
  const parts = DUBLIN_TIME_FMT.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  return hour * 60 + minute;
}

/** Whether the given transit mode is currently within its daily service window.
 *  Train: 05:00 – 00:00 (off-hours 00:00–05:00)
 *  Bus:   05:00 – 23:30 (off-hours 23:30–05:00)
 *  Both resume at 05:00 Europe/Dublin time.
 */
export function isInServiceHours(mode: "train" | "bus", now: Date = new Date()): boolean {
  const mins = dublinMinutes(now);
  if (mode === "train") return mins >= 300;
  return mins >= 300 && mins < 23 * 60 + 30;
}

/** Label shown when off-hours — always next 05:00 service resume. */
export const SERVICE_RESUME_LABEL = "05:00";

/** Escape a string for safe interpolation into innerHTML. Popups are built
 *  by concatenating raw HTML strings, so any upstream-derived field (Irish Rail
 *  PublicMessage, station names, GTFS-R route labels, etc.) must go through
 *  this before being interpolated into a popup template. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
