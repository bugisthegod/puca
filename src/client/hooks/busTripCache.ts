// Match the server's 75-second TripUpdates polling cadence.
export const BUS_TRIP_CACHE_TTL_MS = 75_000;

export function isBusTripCacheFresh(
	updatedAtMs: number | undefined,
	nowMs = Date.now(),
): boolean {
	if (updatedAtMs === undefined) return false;
	const age = nowMs - updatedAtMs;
	return age >= 0 && age < BUS_TRIP_CACHE_TTL_MS;
}
