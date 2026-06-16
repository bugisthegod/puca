import { expect, test } from "bun:test";
import { getLuasStopArrivals, getLuasStopsArrivals } from "../src/luas";

test("Luas arrivals hide trips whose destination is the selected stop", () => {
	const arrivals = getLuasStopArrivals(
		"8220GA00436",
		new Date("2026-06-15T16:58:00Z"),
	);

	expect(arrivals.length).toBeGreaterThan(0);
	expect(arrivals.some((arrival) => arrival.headsign === "The Point")).toBe(
		false,
	);
	expect(
		arrivals.some((arrival) =>
			["Tallaght", "Saggart"].includes(arrival.headsign),
		),
	).toBe(true);
});

test("Luas arrivals do not return duplicate display rows", () => {
	const arrivals = getLuasStopArrivals(
		"8220GA00436",
		new Date("2026-06-15T16:58:00Z"),
	);
	const keys = arrivals.map((arrival) =>
		[arrival.routeShortName, arrival.headsign, arrival.departureSec].join("|"),
	);

	expect(new Set(keys).size).toBe(keys.length);
});

test("getLuasStopsArrivals returns entries for all requested stops", () => {
	const now = new Date("2026-06-15T16:58:00Z");
	const result = getLuasStopsArrivals(["8220GA00436", "LUAS_BROOMBRIDGE"], now);

	expect(result).toHaveProperty("8220GA00436");
	expect(result).toHaveProperty("LUAS_BROOMBRIDGE");
	expect(Array.isArray(result["8220GA00436"])).toBe(true);
	expect(Array.isArray(result.LUAS_BROOMBRIDGE)).toBe(true);
});

test("getLuasStopsArrivals returns empty array for unknown stop IDs", () => {
	const result = getLuasStopsArrivals(
		["NOT_A_REAL_STOP"],
		new Date("2026-06-15T16:58:00Z"),
	);

	expect(result.NOT_A_REAL_STOP).toEqual([]);
});

test("getLuasStopsArrivals uses the same timestamp for all stops", () => {
	const now = new Date("2026-06-15T16:58:00Z");
	const result = getLuasStopsArrivals(["8220GA00436", "LUAS_BROOMBRIDGE"], now);

	// With the same timestamp, both stops should have arrivals for the same time window.
	for (const arrivals of Object.values(result)) {
		for (const a of arrivals) {
			expect(a.etaSeconds).toBeGreaterThanOrEqual(0);
			expect(a.etaSeconds).toBeLessThanOrEqual(90 * 60);
		}
	}
});
