import { test, expect, describe } from "bun:test";
import {
  mergeTripStops,
  getBusRouteShape,
  getTrainRouteShape,
  type ScheduledRow,
  type LiveTripData,
} from "../src/gtfsr";

const stops = {
  S1: { name: "Stop One", lat: 53.1, lng: -6.1 },
  S2: { name: "Stop Two", lat: 53.2, lng: -6.2 },
  S3: { name: "Stop Three", lat: 53.3, lng: -6.3 },
  S4: { name: "Stop Four", lat: 53.4, lng: -6.4 },
};

const scheduledFour: ScheduledRow[] = [
  { sequence: 1, stopId: "S1", arrivalSec: 1000 },
  { sequence: 2, stopId: "S2", arrivalSec: 1100 },
  { sequence: 3, stopId: "S3", arrivalSec: 1200 },
  { sequence: 4, stopId: "S4", arrivalSec: 1300 },
];

describe("mergeTripStops", () => {
  test("returns null when no scheduled rows and no live trip", () => {
    expect(mergeTripStops("T1", [], undefined, stops)).toBeNull();
  });

  test("propagates delay from prior stop with explicit update", () => {
    const live: LiveTripData = {
      routeId: "R1",
      directionId: 0,
      stopTimeUpdates: [
        { sequence: 2, stopId: "S2", arrivalDelaySec: 60, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
      ],
    };
    const result = mergeTripStops("T1", scheduledFour, live, stops);
    expect(result).not.toBeNull();
    // Stop 1 has no prior delay → null
    expect(result!.stops[0]!.arrivalDelaySec).toBeNull();
    expect(result!.stops[0]!.expectedArrivalSec).toBeNull();
    // Stop 2 has explicit delay
    expect(result!.stops[1]!.arrivalDelaySec).toBe(60);
    expect(result!.stops[1]!.expectedArrivalSec).toBe(1160);
    // Stops 3 and 4 inherit the propagated delay
    expect(result!.stops[2]!.arrivalDelaySec).toBe(60);
    expect(result!.stops[2]!.expectedArrivalSec).toBe(1260);
    expect(result!.stops[3]!.arrivalDelaySec).toBe(60);
    expect(result!.stops[3]!.expectedArrivalSec).toBe(1360);
  });

  test("treats arrivalDelaySec === 0 as an explicit update (not propagation)", () => {
    const live: LiveTripData = {
      routeId: "R1",
      directionId: 0,
      stopTimeUpdates: [
        { sequence: 1, stopId: "S1", arrivalDelaySec: 120, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
        { sequence: 3, stopId: "S3", arrivalDelaySec: 0, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
      ],
    };
    const result = mergeTripStops("T1", scheduledFour, live, stops)!;
    expect(result.stops[0]!.arrivalDelaySec).toBe(120);
    // Stop 2 has no explicit, inherits 120 from stop 1
    expect(result.stops[1]!.arrivalDelaySec).toBe(120);
    // Stop 3 explicit 0 — should override, NOT inherit 120
    expect(result.stops[2]!.arrivalDelaySec).toBe(0);
    expect(result.stops[2]!.expectedArrivalSec).toBe(1200);
    // Stop 3 was explicit, so stop 4 inherits 0 (not 120)
    expect(result.stops[3]!.arrivalDelaySec).toBe(0);
    expect(result.stops[3]!.expectedArrivalSec).toBe(1300);
    // Both explicit-delay stops get isCurrent? No — only the FIRST.
    expect(result.stops[0]!.isCurrent).toBe(true);
    expect(result.stops[2]!.isCurrent).toBe(false);
  });

  test("isCurrent is set on the first stop with an explicit delay only", () => {
    const live: LiveTripData = {
      routeId: "R1",
      directionId: 0,
      stopTimeUpdates: [
        { sequence: 2, stopId: "S2", arrivalDelaySec: 30, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
        { sequence: 3, stopId: "S3", arrivalDelaySec: 45, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
      ],
    };
    const result = mergeTripStops("T1", scheduledFour, live, stops)!;
    expect(result.stops[0]!.isCurrent).toBe(false);
    expect(result.stops[1]!.isCurrent).toBe(true);
    expect(result.stops[2]!.isCurrent).toBe(false);
    expect(result.stops[3]!.isCurrent).toBe(false);
  });

  test("no isCurrent when there are no live updates (all delays null)", () => {
    const result = mergeTripStops("T1", scheduledFour, undefined, stops)!;
    for (const s of result.stops) {
      expect(s.isCurrent).toBe(false);
      expect(s.arrivalDelaySec).toBeNull();
      expect(s.expectedArrivalSec).toBeNull();
    }
    expect(result.routeId).toBe("");
    expect(result.directionId).toBe(0);
  });

  test("scheduled stopId wins over live stopId when sequences match", () => {
    const live: LiveTripData = {
      routeId: "R1",
      directionId: 0,
      stopTimeUpdates: [
        // Live reports a different stopId at sequence 2
        { sequence: 2, stopId: "X_LIVE", arrivalDelaySec: 60, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
      ],
    };
    const result = mergeTripStops("T1", scheduledFour, live, stops)!;
    expect(result.stops[1]!.stopId).toBe("S2");
    expect(result.stops[1]!.name).toBe("Stop Two");
    expect(result.stops[1]!.lat).toBe(53.2);
  });

  test("falls back to live-only path when scheduledRows is empty", () => {
    const live: LiveTripData = {
      routeId: "R7",
      directionId: 1,
      stopTimeUpdates: [
        { sequence: 2, stopId: "S2", arrivalDelaySec: 30, departureDelaySec: 30, scheduleRelationship: "SCHEDULED" },
        { sequence: 1, stopId: "S1", arrivalDelaySec: 0, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
      ],
    };
    const result = mergeTripStops("T1", [], live, stops)!;
    // Sorted by sequence in the fallback branch
    expect(result.stops.map((s) => s.sequence)).toEqual([1, 2]);
    // All scheduled fields are null in the fallback shape
    for (const s of result.stops) {
      expect(s.scheduledArrivalSec).toBeNull();
      expect(s.expectedArrivalSec).toBeNull();
    }
    // First stop in the original (unsorted) live order is marked current
    // The current implementation marks i === 0 BEFORE sorting,
    // so the stop that was first in the live array is current.
    const current = result.stops.find((s) => s.isCurrent);
    expect(current?.stopId).toBe("S2");
    expect(result.routeId).toBe("R7");
    expect(result.directionId).toBe(1);
  });

  test("uses live stopId as name when stops dict has no entry (fallback path)", () => {
    const live: LiveTripData = {
      routeId: "R1",
      directionId: 0,
      stopTimeUpdates: [
        { sequence: 1, stopId: "UNKNOWN", arrivalDelaySec: null, departureDelaySec: null, scheduleRelationship: "SCHEDULED" },
      ],
    };
    const result = mergeTripStops("T1", [], live, stops)!;
    expect(result.stops[0]!.name).toBe("UNKNOWN");
    expect(result.stops[0]!.lat).toBe(0);
    expect(result.stops[0]!.lng).toBe(0);
  });
});

describe("getBusRouteShape", () => {
  test("matches shortName case-insensitively", () => {
    const upper = getBusRouteShape("dublinbus", "C1");
    const lower = getBusRouteShape("dublinbus", "c1");
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(lower).toEqual(upper);
  });

  test("returns null for an unknown shortName", () => {
    expect(getBusRouteShape("dublinbus", "NOPE_999")).toBeNull();
  });
});

describe("getTrainRouteShape", () => {
  test("normalizes origin/destination via trim + lowercase", () => {
    const a = getTrainRouteShape("Malahide", "Greystones");
    const b = getTrainRouteShape("  malahide  ", "  GREYSTONES  ");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b).toEqual(a);
  });

  test("returns null for an unknown endpoint pair", () => {
    expect(getTrainRouteShape("Atlantis", "Narnia")).toBeNull();
  });
});
