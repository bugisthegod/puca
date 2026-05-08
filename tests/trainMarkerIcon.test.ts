import { describe, expect, test } from "bun:test";
import { buildTrainIconSpec } from "../src/hooks/trainMarkerIcon";

describe("train marker icon spec", () => {
  test("builds a train marker div icon spec with color-driven SVG", () => {
    const spec = buildTrainIconSpec("#4caf50");

    expect(spec.className).toBe("train-marker");
    expect(spec.html).toContain("train-icon");
    expect(spec.html).toContain("style=\"color:#4caf50\"");
    expect(spec.html).toContain("<svg");
    expect(spec.iconSize).toEqual([22, 22]);
    expect(spec.iconAnchor).toEqual([11, 11]);
  });
});
