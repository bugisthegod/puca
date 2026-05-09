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
    lastUpdateTime: 0,
    correctionFromLat: 53.3498,
    correctionFromLng: -6.2603,
    correctionStartTime: 0,
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
type SleepFn = (ms: number) => Promise<void>;

describe("pollForMarker", () => {
  test("returns entry immediately when already present", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    const entry = dummyEntry("E123");
    markers.set("E123", entry);

    const result = await pollForMarker(markers, "E123", 30, 50, alive);

    expect(result).toBe(entry);
  });

  test("returns entry after it appears mid-retry", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    let injected = false;
    const sleep: SleepFn = async () => {
      if (!injected) {
        injected = true;
        markers.set("E123", dummyEntry("E123"));
      }
    };

    const result = await pollForMarker(markers, "E123", 10, 50, alive, sleep);

    expect(result).not.toBeUndefined();
    expect(result!.train.code).toBe("E123");
  });

  test("returns undefined when entry never appears", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    let calls = 0;
    const sleep: SleepFn = async () => { calls++; };

    const result = await pollForMarker(markers, "E123", 5, 20, alive, sleep);

    expect(result).toBeUndefined();
    expect(calls).toBe(5);
  });

  test("returns early when alive() flips to false mid-retry", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    let aliveFlag = true;
    let calls = 0;
    const sleep: SleepFn = async () => {
      calls++;
      if (calls >= 3) aliveFlag = false;
    };

    const result = await pollForMarker(markers, "E123", 10, 20, () => aliveFlag, sleep);

    expect(result).toBeUndefined();
    expect(calls).toBe(3);
  });

  test("distinguishes different codes in the same map", async () => {
    const markers = new Map<string, TrainMarkerEntry>();
    markers.set("P456", dummyEntry("P456"));
    let calls = 0;
    const sleep: SleepFn = async () => { calls++; };

    const result = await pollForMarker(markers, "E123", 3, 10, alive, sleep);

    expect(result).toBeUndefined();
    expect(calls).toBe(3);
  });
});
