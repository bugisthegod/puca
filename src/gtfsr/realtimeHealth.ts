import type { RealtimeStatus } from "../types";

export function ageSec(timestampMs: number, now: number): number | null {
	if (timestampMs <= 0) return null;
	return Math.max(0, Math.round((now - timestampMs) / 1000));
}

export function statusFromAge(
	age: number | null,
	staleAfterSec: number,
): RealtimeStatus {
	if (age === null) return "unavailable";
	if (age > staleAfterSec) return "stale";
	return "ok";
}
