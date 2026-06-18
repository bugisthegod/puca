import { describe, expect, test } from "bun:test";
import {
	buildRouteLine,
	projectOntoRoute,
} from "../src/client/hooks/routeProjection";

// ~6.7km line going east along latitude 53° (Dublin-ish).
// Enough length that floating-point noise near endpoints doesn't bite, and
// endpoints are ~6.7km apart so 25 m/s * 1s = 25m is a safely small slice.
const LINE_START: [number, number] = [53.0, -6.0];
const LINE_END: [number, number] = [53.0, -5.9];
const built = buildRouteLine([LINE_START, LINE_END]);
if (!built)
	throw new Error("fixture setup: expected buildRouteLine to succeed");
const { routeLine, routeLengthMeters } = built;

describe("buildRouteLine", () => {
	test("returns null for zero coords", () => {
		expect(buildRouteLine([])).toBeNull();
	});

	test("returns null for a single coord (not enough to form a line)", () => {
		expect(buildRouteLine([[53.0, -6.0]])).toBeNull();
	});

	test("produces a positive length for a valid 2-point line", () => {
		const r = buildRouteLine([LINE_START, LINE_END]);
		expect(r).not.toBeNull();
		expect(r?.routeLengthMeters).toBeGreaterThan(0);
		expect(Number.isFinite(r?.routeLengthMeters)).toBe(true);
	});

	test("length at ~53° for 0.1° longitude is roughly 6.7km (sanity)", () => {
		// Degenerate check that the lat/lng → lng/lat swap happened; if it didn't
		// swap, length would come out dramatically different.
		expect(routeLengthMeters).toBeGreaterThan(6000);
		expect(routeLengthMeters).toBeLessThan(7500);
	});
});

describe("projectOntoRoute", () => {
	test("reports offRoute when the vehicle is far from the line", () => {
		// 1° north of the line is ~111km — well past the 150m default threshold.
		const r = projectOntoRoute(
			54.0,
			-5.95,
			routeLine,
			routeLengthMeters,
			null,
			null,
			1000,
		);
		expect(r.offRoute).toBe(true);
	});

	test("projects an on-route vehicle to a bounded distance and defaults speed to 0", () => {
		// Midpoint of the line.
		const r = projectOntoRoute(
			53.0,
			-5.95,
			routeLine,
			routeLengthMeters,
			null,
			null,
			1000,
		);
		expect(r.offRoute).toBe(false);
		if (r.offRoute) return;
		expect(r.targetDistanceAlongRoute).toBeGreaterThan(0);
		expect(r.targetDistanceAlongRoute).toBeLessThanOrEqual(routeLengthMeters);
		expect(r.pathSpeedMps).toBe(0);
		expect(r.lastPingTime).toBe(1000);
	});

	test("uses defaultSpeedMps when there is no previous ping to delta against", () => {
		const r = projectOntoRoute(
			53.0,
			-5.95,
			routeLine,
			routeLengthMeters,
			null,
			null,
			1000,
			150,
			25,
			15,
		);
		expect(r.offRoute).toBe(false);
		if (r.offRoute) return;
		expect(r.pathSpeedMps).toBe(15);
	});

	test("clamps computed speed to maxSpeedMps", () => {
		// Previous ping: 0m at t=1000. Now at ~midpoint (~3350m) at t=2000 (1s later).
		// Raw speed ≈ 3350 m/s — must clamp to the 25 m/s max.
		const r = projectOntoRoute(
			53.0,
			-5.95,
			routeLine,
			routeLengthMeters,
			0,
			1000,
			2000,
			150,
			25,
			0,
		);
		expect(r.offRoute).toBe(false);
		if (r.offRoute) return;
		expect(r.pathSpeedMps).toBe(25);
	});

	test("falls back to defaultSpeedMps when deltaDist is non-positive (no forward motion)", () => {
		// prevTargetDistance equals what the projection will produce → deltaDist ≤ 0.
		// Run once to learn what the midpoint projects to, then re-feed that as prev.
		const first = projectOntoRoute(
			53.0,
			-5.95,
			routeLine,
			routeLengthMeters,
			null,
			null,
			1000,
			150,
			25,
			0,
		);
		if (first.offRoute)
			throw new Error("fixture: expected midpoint to be on-route");
		const stationary = projectOntoRoute(
			53.0,
			-5.95,
			routeLine,
			routeLengthMeters,
			first.targetDistanceAlongRoute,
			1000,
			2000,
			150,
			25,
			15,
		);
		expect(stationary.offRoute).toBe(false);
		if (stationary.offRoute) return;
		expect(stationary.pathSpeedMps).toBe(15);
	});

	test("honors a custom offRouteMeters threshold", () => {
		// Vehicle ~200m north of the line. Tight 150m threshold rejects it;
		// loose 500m threshold accepts it.
		// 0.0018° lat ≈ 200m.
		const vehicleLat = 53.0 + 0.0018;
		const tight = projectOntoRoute(
			vehicleLat,
			-5.95,
			routeLine,
			routeLengthMeters,
			null,
			null,
			1000,
			150,
		);
		const loose = projectOntoRoute(
			vehicleLat,
			-5.95,
			routeLine,
			routeLengthMeters,
			null,
			null,
			1000,
			500,
		);
		expect(tight.offRoute).toBe(true);
		expect(loose.offRoute).toBe(false);
	});

	test("respects the bounded [0, routeLengthMeters] clamp for returned distance", () => {
		// Project onto an endpoint — Turf can yield tiny numerical excursions but
		// the function's own Math.min/max should keep us in range.
		const r = projectOntoRoute(
			53.0,
			-5.9,
			routeLine,
			routeLengthMeters,
			null,
			null,
			1000,
		);
		expect(r.offRoute).toBe(false);
		if (r.offRoute) return;
		expect(r.targetDistanceAlongRoute).toBeGreaterThanOrEqual(0);
		expect(r.targetDistanceAlongRoute).toBeLessThanOrEqual(routeLengthMeters);
	});
});
