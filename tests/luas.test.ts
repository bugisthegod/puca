import { expect, test } from "bun:test";
import { getLuasStopArrivals } from "../src/luas";

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
