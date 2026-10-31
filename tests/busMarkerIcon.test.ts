import { describe, expect, test } from "bun:test";
import {
	buildBusIconSpec,
	busOperatorMarkerClass,
} from "../src/client/hooks/busMarkerIcon";
import type { BusVehicle } from "../src/types";

function bus(overrides: Partial<BusVehicle> = {}): BusVehicle {
	return {
		tripId: "trip-1",
		routeId: "route-1",
		routeShortName: "C1",
		lat: 53.35,
		lng: -6.26,
		bearing: null,
		speed: null,
		timestamp: 1_000,
		label: "bus-42",
		directionId: 0,
		shapeId: "shape-1",
		stale: false,
		...overrides,
	};
}

describe("bus marker icon spec", () => {
	test("maps operators to marker CSS classes", () => {
		expect(busOperatorMarkerClass("dublinbus")).toBe("");
		expect(busOperatorMarkerClass("buseireann")).toBe("bus-marker--buseireann");
		expect(busOperatorMarkerClass("goahead")).toBe("bus-marker--goahead");
	});

	test("builds a normal bus icon with bus silhouette and compact dimensions", () => {
		const spec = buildBusIconSpec(bus(), "dublinbus");

		expect(spec.className).toBe("bus-marker");
		expect(spec.html).toContain("bus-icon");
		expect(spec.html).toContain("bus-label");
		expect(spec.html).toContain(">C1<");
		expect(spec.html).not.toContain("bus-puca");
		expect(spec.iconSize).toEqual([44, 30]);
		expect(spec.iconAnchor).toEqual([22, 15]);
	});

	test("adds operator and stale classes, swaps to Púca art, and uses taller dimensions", () => {
		const spec = buildBusIconSpec(bus({ stale: true }), "buseireann");

		expect(spec.className).toBe(
			"bus-marker bus-marker--buseireann bus-marker--stale",
		);
		expect(spec.html).toContain("bus-puca");
		expect(spec.html).toContain("<svg");
		expect(spec.html).not.toContain("<img");
		expect(spec.html).not.toContain("puca-jack-o.svg");
		expect(spec.html).not.toContain("bus-icon");
		expect(spec.iconSize).toEqual([44, 52]);
		expect(spec.iconAnchor).toEqual([22, 26]);
	});

	test("escapes route labels before embedding marker HTML", () => {
		const spec = buildBusIconSpec(bus({ routeShortName: "<C&1>" }), "goahead");

		expect(spec.className).toBe("bus-marker bus-marker--goahead");
		expect(spec.html).toContain("&lt;C&amp;1&gt;");
		expect(spec.html).not.toContain("<C&1>");
	});
});
