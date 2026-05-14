import { describe, expect, test } from "bun:test";
import {
	decideLocationFix,
	LAST_FIX_TTL_MS,
	parseCachedFix,
} from "../src/hooks/locationLogic";

describe("location cache parsing", () => {
	const now = 1_800_000_000_000;

	test("accepts a recent valid cached fix", () => {
		const fix = { lat: 53.3498, lng: -6.2603, accuracy: 24, ts: now - 1_000 };

		expect(parseCachedFix(JSON.stringify(fix), now)).toEqual(fix);
	});

	test("rejects stale cached fixes so old locations do not flash later", () => {
		const fix = {
			lat: 53.3498,
			lng: -6.2603,
			accuracy: 24,
			ts: now - LAST_FIX_TTL_MS - 1,
		};

		expect(parseCachedFix(JSON.stringify(fix), now)).toBeNull();
	});

	test("rejects malformed or impossible cached fixes", () => {
		expect(parseCachedFix(null, now)).toBeNull();
		expect(parseCachedFix("not json", now)).toBeNull();
		expect(
			parseCachedFix(
				JSON.stringify({ lat: 91, lng: -6.2603, accuracy: 24, ts: now }),
				now,
			),
		).toBeNull();
		expect(
			parseCachedFix(
				JSON.stringify({ lat: 53.3498, lng: -181, accuracy: 24, ts: now }),
				now,
			),
		).toBeNull();
		expect(
			parseCachedFix(
				JSON.stringify({ lat: 53.3498, lng: -6.2603, accuracy: -1, ts: now }),
				now,
			),
		).toBeNull();
	});
});

describe("location refinement decisions", () => {
	test("flies on the first fresh accepted fix so locate resolves quickly", () => {
		const decision = decideLocationFix(
			{ bestAccuracy: Number.POSITIVE_INFINITY, freshFixApplied: false },
			120,
		);

		expect(decision.accepted).toBe(true);
		expect(decision.fly).toBe(true);
		expect(decision.shouldFinish).toBe(false);
		expect(decision.nextState).toEqual({
			bestAccuracy: 120,
			freshFixApplied: true,
		});
	});

	test("keeps refining accuracy without repeated fly animations", () => {
		const decision = decideLocationFix(
			{ bestAccuracy: 120, freshFixApplied: true },
			45,
		);

		expect(decision.accepted).toBe(true);
		expect(decision.fly).toBe(false);
		expect(decision.shouldFinish).toBe(true);
		expect(decision.nextState).toEqual({
			bestAccuracy: 45,
			freshFixApplied: true,
		});
	});

	test("ignores worse fixes while preserving the current best fix", () => {
		const state = { bestAccuracy: 60, freshFixApplied: true };

		const decision = decideLocationFix(state, 90);

		expect(decision.accepted).toBe(false);
		expect(decision.fly).toBe(false);
		expect(decision.shouldFinish).toBe(false);
		expect(decision.nextState).toBe(state);
	});
});
