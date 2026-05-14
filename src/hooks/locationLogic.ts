export const LAST_FIX_TTL_MS = 2 * 60 * 60 * 1000;
export const GOOD_LOCATION_ACCURACY_M = 50;

export interface CachedFix {
	lat: number;
	lng: number;
	accuracy: number;
	ts: number;
}

export interface LocationRefineState {
	bestAccuracy: number;
	freshFixApplied: boolean;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isValidLatitude(value: unknown): value is number {
	return isFiniteNumber(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
	return isFiniteNumber(value) && value >= -180 && value <= 180;
}

function isValidAccuracy(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0;
}

export function parseCachedFix(
	raw: string | null,
	now: number = Date.now(),
): CachedFix | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const { lat, lng, accuracy, ts } = parsed as Record<string, unknown>;
		if (!isValidLatitude(lat)) return null;
		if (!isValidLongitude(lng)) return null;
		if (!isValidAccuracy(accuracy)) return null;
		if (!isFiniteNumber(ts)) return null;
		if (now - ts > LAST_FIX_TTL_MS) return null;
		return { lat, lng, accuracy, ts };
	} catch {
		return null;
	}
}

export function decideLocationFix(
	state: LocationRefineState,
	accuracy: number,
): {
	accepted: boolean;
	fly: boolean;
	shouldFinish: boolean;
	nextState: LocationRefineState;
} {
	const accepted = accuracy < state.bestAccuracy;
	return {
		accepted,
		fly: accepted && !state.freshFixApplied,
		shouldFinish: accuracy <= GOOD_LOCATION_ACCURACY_M,
		nextState: accepted
			? { bestAccuracy: accuracy, freshFixApplied: true }
			: state,
	};
}
