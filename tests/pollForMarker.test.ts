import { describe, expect, test } from "bun:test";
import { pollForMarker, type TrainMarkerEntry } from "../src/hooks/useTrainMarkers";

function dummyEntry(code: string): TrainMarkerEntry {
  return {
    marker: {} as L.Marker,
    lastColor: "green",
    train: { code, lat: 53.3498, lng: -6.2603, status: "R", message: "", direction: "Northbound", date: "09 May 2026" },
    targetLat: 53.3498,
    targetLng: -6.2603,
    velocityLat: 0,
    velocityLng: 0,
    lastUpdateTime: performance.now(),
    correctionFromLat: 53.3498,
    correctionFromLng: -6.2603,
    correctionStartTime: performance.now(),
    routeLine: null,
    routeLookup: null,
    routeLengthMeters: null,
    distanceAtPing: null,
    targetDistanceAlongRoute: null,
    pathSpeedMps: 0,
    lastPingTime: null,
    offRoute: true,
    originDestKey: null,
  };
}

const alive = () => true;

describe("pollForMarker", () => {
  test("returns entry immediately when already present", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    const entry = dummyEntry("E123");
    markers.set("E123", entry);

    const started = performance.now();
    const result = await pollForMarker(markers, "E123", 30, 50, alive);
    const elapsed = performance.now() - started;

    expect(result).toBe(entry);
    expect(elapsed).toBeLessThan(50); // should return on first check, no delay
  });

  test("returns entry after it appears mid-retry", async () => {
    const markers = new Map<string, TrainMarkerEntry>();

    // Inject the entry after 100ms (which is after two 50ms retries)
    setTimeout(() => {
      const entry = dummyEntry("E123");
      markers.set("E123", entry);
    }, 100);

    const started = performance.now();
    const result = await pollForMarker(markers, "E123", 10, 50, alive);
    const elapsed = performance.now() - started;

    expect(result).not.toBeUndefined();
    expect(result!.train.code).toBe("E123");
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);
  });

  test("returns undefined when entry never appears", async () => {
    const markers = new Map<string, TrainMarkerEntry>();

    const started = performance.now();
    const result = await pollForMarker(markers, "E123", 5, 20, alive);
    const elapsed = performance.now() - started;

    expect(result).toBeUndefined();
    expect(elapsed).toBeGreaterThanOrEqual(100); // 5 * 20ms
  });

  test("returns early when alive() flips to false mid-retry", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    let aliveFlag = true;

    // Flip alive after 60ms (roughly 3 retries at 20ms)
    setTimeout(() => { aliveFlag = false; }, 60);

    const started = performance.now();
    const result = await pollForMarker(markers, "E123", 10, 20, () => aliveFlag);
    const elapsed = performance.now() - started;

    expect(result).toBeUndefined();
    expect(elapsed).toBeLessThan(120); // should bail early, not wait full 10 * 20 = 200ms
  });

  test("distinguishes different codes in the same map", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    const entryB = dummyEntry("P456");
    markers.set("P456", entryB);

    // E123 is not in the map, so it should return undefined after retries
    const result = await pollForMarker(markers, "E123", 3, 10, alive);

    expect(result).toBeUndefined();
  });
});
