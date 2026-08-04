import { describe, expect, test } from "bun:test";
import {
	busStopClusterRadius,
	dominantBusOperatorFromClassNames,
} from "../src/client/hooks/busClusterOperator";

test("street-level clustering keeps only exactly overlapping shared stops together", () => {
	expect(busStopClusterRadius(17)).toBeGreaterThan(0);
	expect(busStopClusterRadius(18)).toBe(0);
	expect(busStopClusterRadius(20)).toBe(0);
});

describe("dominantBusOperatorFromClassNames", () => {
	test("returns the operator represented by the most markers", () => {
		expect(
			dominantBusOperatorFromClassNames(
				[
					"bus-map-stop-marker bus-map-stop-marker--goahead",
					"bus-map-stop-marker bus-map-stop-marker--buseireann",
					"bus-map-stop-marker bus-map-stop-marker--goahead",
				],
				"bus-map-stop-marker--",
			),
		).toBe("goahead");
	});

	test("uses Dublin Bus when the leading counts are tied", () => {
		expect(
			dominantBusOperatorFromClassNames(
				["bus-marker--buseireann", "bus-marker--goahead"],
				"bus-marker--",
			),
		).toBe("dublinbus");
	});

	test("treats an unclassified marker as Dublin Bus", () => {
		expect(
			dominantBusOperatorFromClassNames(
				["bus-marker", "bus-marker--dublinbus", "bus-marker--goahead"],
				"bus-marker--",
			),
		).toBe("dublinbus");
	});
});
