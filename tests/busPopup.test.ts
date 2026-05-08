import { beforeAll, describe, expect, test } from "bun:test";
import type { BusVehicle } from "../src/types";
import { setLocale } from "../src/i18n";
import {
  buildBusPopupHTML,
  busPopupStatusFromDelay,
  formatBusPopupSec,
  type BusTripPopupData,
} from "../src/hooks/busPopup";

beforeAll(() => {
  setLocale("en");
});

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
    directionId: 1,
    shapeId: "shape-1",
    stale: false,
    ...overrides,
  };
}

const trip: BusTripPopupData = {
  stops: [
    {
      sequence: 1,
      name: "Origin & Start",
      lat: 53.34,
      lng: -6.27,
      scheduledArrivalSec: 8 * 3600,
      expectedArrivalSec: 8 * 3600,
      arrivalDelaySec: 0,
    },
    {
      sequence: 2,
      name: "Current <Stop>",
      lat: 53.35,
      lng: -6.26,
      scheduledArrivalSec: 8 * 3600 + 300,
      expectedArrivalSec: 8 * 3600 + 900,
      arrivalDelaySec: 600,
    },
  ],
};

describe("bus popup formatting", () => {
  test("formats seconds as HH:MM and preserves null as an empty placeholder", () => {
    expect(formatBusPopupSec(null)).toBe("—");
    expect(formatBusPopupSec(0)).toBe("00:00");
    expect(formatBusPopupSec(8 * 3600 + 5 * 60)).toBe("08:05");
    expect(formatBusPopupSec(25 * 3600 + 15 * 60)).toBe("01:15");
  });

  test("maps delay thresholds to the popup status labels and classes", () => {
    expect(busPopupStatusFromDelay(null)).toEqual({ text: "", cls: "" });
    expect(busPopupStatusFromDelay(0)).toEqual({ text: "On time", cls: "" });
    expect(busPopupStatusFromDelay(-60)).toEqual({ text: "On time (1 min early)", cls: "" });
    expect(busPopupStatusFromDelay(5 * 60)).toEqual({ text: "5 mins late", cls: "popup-status--yellow" });
    expect(busPopupStatusFromDelay(10 * 60)).toEqual({ text: "10 mins late", cls: "popup-status--red" });
  });
});

describe("buildBusPopupHTML", () => {
  test("renders a loading popup without a route jump button by default", () => {
    const html = buildBusPopupHTML(bus(), null, { showRouteJump: false });

    expect(html).toContain("popup-loading");
    expect(html).toContain("Loading stops");
    expect(html).toContain("Vehicle bus-42");
    expect(html).not.toContain("popup-route-jump");
  });

  test("renders an empty trip response as a popup message", () => {
    const html = buildBusPopupHTML(bus(), { stops: [] }, { showRouteJump: false });

    expect(html).toContain("popup-message");
    expect(html).toContain("No upcoming stop data available.");
    expect(html).not.toContain("movements-table");
  });

  test("renders stop rows, highlights the nearest stop, and escapes stop names", () => {
    const html = buildBusPopupHTML(bus(), trip, { showRouteJump: true });

    expect(html).toContain("popup-route-jump");
    expect(html).toContain('data-route="C1"');
    expect(html).toContain('data-dir="1"');
    expect(html).toContain("Origin &amp; Start");
    expect(html).toContain("Current &lt;Stop&gt;");
    expect(html).toContain("08:05");
    expect(html).toContain("08:15");
    expect(html).toContain("movement-current");
    expect(html).toContain("10 mins late");
    expect(html).toContain("popup-status--red");
  });

  test("renders stale banner and falls back to trip id when vehicle label is empty", () => {
    const html = buildBusPopupHTML(bus({ label: "", stale: true }), trip, { showRouteJump: false });

    expect(html).toContain("popup-stale-banner");
    expect(html).toContain("Púca ran off with this bus");
    expect(html).toContain("Vehicle trip-1");
  });
});
