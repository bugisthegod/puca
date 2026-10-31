import { describe, expect, test } from "bun:test";
import {
	buildTrainHitIconSpec,
	buildTrainIconSpec,
} from "../src/client/hooks/trainMarkerIcon";

describe("train marker icon spec", () => {
	test("builds a train marker div icon spec with color-driven SVG", () => {
		const spec = buildTrainIconSpec("#4caf50");

		expect(spec.className).toBe("train-marker");
		expect(spec.html).toContain("train-icon");
		expect(spec.html).toContain('style="color:#4caf50"');
		expect(spec.html).toContain("<svg");
		expect(spec.iconSize).toEqual([22, 22]);
		expect(spec.iconAnchor).toEqual([11, 11]);
	});

	test("offsets the train icon anchor without changing its size", () => {
		const spec = buildTrainIconSpec("#f44336", { x: 14, y: -6 });

		expect(spec.iconSize).toEqual([22, 22]);
		expect(spec.iconAnchor).toEqual([-3, 17]);
	});

	test("builds an oversized transparent hit target with matching offset", () => {
		const spec = buildTrainHitIconSpec({ x: -14, y: 0 });

		expect(spec.className).toBe("train-hit-marker");
		expect(spec.html).toContain("train-hit-target");
		expect(spec.iconSize).toEqual([40, 40]);
		expect(spec.iconAnchor).toEqual([34, 20]);
	});
});
