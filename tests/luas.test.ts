import { expect, test } from "bun:test";
import luasArrivalsData from "../src/data/luas-arrivals.json" with {
	type: "json",
};
import { getLuasStopArrivals } from "../src/luas";

const sampleArrivalsDate = new Date(
	`${luasArrivalsData.generatedAt.slice(0, 10)}T16:58:00Z`,
);

test("Luas arrivals hide trips whose destination is the selected stop", () => {
	const arrivals = getLuasStopArrivals("8220GA00436", sampleArrivalsDate);

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
	const arrivals = getLuasStopArrivals("8220GA00436", sampleArrivalsDate);
	const keys = arrivals.map((arrival) =>
		[arrival.routeShortName, arrival.headsign, arrival.departureSec].join("|"),
	);

	expect(new Set(keys).size).toBe(keys.length);
});
