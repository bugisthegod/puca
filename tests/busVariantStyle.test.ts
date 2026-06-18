import { describe, expect, test } from "bun:test";
import {
	busRouteColor,
	reconcileSelectedVariant,
	variantStyleForShape,
} from "../src/client/hooks/busVariantStyle";

describe("bus variant styling", () => {
	test("maps bus operators to route colors", () => {
		expect(busRouteColor("dublinbus")).toBe("#f9a825");
		expect(busRouteColor("buseireann")).toBe("#d52b1e");
		expect(busRouteColor("goahead")).toBe("#1e6bb8");
	});

	test("clears selected variants once they are no longer active", () => {
		const active = new Set(["shape-a", "shape-b"]);

		expect(reconcileSelectedVariant(null, active)).toBeNull();
		expect(reconcileSelectedVariant("shape-a", active)).toBe("shape-a");
		expect(reconcileSelectedVariant("shape-c", active)).toBeNull();
	});

	test("selected variant style wins over active/inactive opacity", () => {
		expect(
			variantStyleForShape("shape-a", "shape-a", new Set(), "#abc"),
		).toEqual({
			color: "#abc",
			weight: 5,
			opacity: 0.95,
			bringToFront: true,
		});
	});

	test("active unselected variants are faint and inactive variants are hidden", () => {
		expect(
			variantStyleForShape("shape-a", null, new Set(["shape-a"]), "#abc"),
		).toEqual({
			color: "#abc",
			weight: 3,
			opacity: 0.35,
			bringToFront: false,
		});
		expect(
			variantStyleForShape("shape-b", null, new Set(["shape-a"]), "#abc"),
		).toEqual({
			color: "#abc",
			weight: 3,
			opacity: 0,
			bringToFront: false,
		});
	});
});
