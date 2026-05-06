import { beforeEach, describe, expect, test } from "bun:test";

// Minimal localStorage stub — Bun test has no DOM. session.ts only touches
// localStorage inside loadSession/saveSession (not at import time), so installing
// the stub before the import is belt-and-braces, not strictly required.
const lsStore = new Map<string, string>();
let throwOnSet = false;
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (throwOnSet) throw new Error("QuotaExceededError");
    lsStore.set(k, v);
  },
  removeItem: (k: string) => { lsStore.delete(k); },
  clear: () => { lsStore.clear(); },
  key: () => null,
  get length() { return lsStore.size; },
} as Storage;

import { loadSession, saveSession, type Session } from "../src/session";

const KEY = "puca-session-v1";

const completeSession: Session = {
  mode: "bus",
  filter: "all",
  busOperator: "dublinbus",
  busRoute: "39A",
  busDirection: "0",
  busSearchTab: "stop",
  busStopId: "8220DB000270",
  busStopOperator: "dublinbus",
  mapView: { lat: 53.349, lng: -6.260, zoom: 14 },
};

beforeEach(() => {
  lsStore.clear();
  throwOnSet = false;
});

describe("loadSession", () => {
  test("returns empty Partial when nothing is stored", () => {
    expect(loadSession()).toEqual({});
  });

  test("returns empty Partial on malformed JSON, no throw", () => {
    lsStore.set(KEY, "{not json");
    expect(loadSession()).toEqual({});
  });

  test("round-trips a complete session through saveSession → loadSession", () => {
    saveSession(completeSession);
    expect(loadSession()).toEqual(completeSession);
  });

  test("invalid mode is dropped but other valid fields survive", () => {
    lsStore.set(KEY, JSON.stringify({ ...completeSession, mode: "spaceship" }));
    const out = loadSession();
    expect(out.mode).toBeUndefined();
    expect(out.filter).toBe("all");
    expect(out.busOperator).toBe("dublinbus");
  });

  test("invalid filter / operator / busSearchTab are individually dropped", () => {
    lsStore.set(KEY, JSON.stringify({
      ...completeSession,
      filter: "luas",
      busOperator: "notReal",
      busSearchTab: "neither",
    }));
    const out = loadSession();
    expect(out.filter).toBeUndefined();
    expect(out.busOperator).toBeUndefined();
    expect(out.busSearchTab).toBeUndefined();
    expect(out.mode).toBe("bus"); // unrelated valid fields still rehydrate
  });

  describe("legacy busStopId migration", () => {
    // Pre-cross-operator-search clients stored busStopId scoped implicitly to
    // the global busOperator. After cross-operator search a stopId without
    // its own operator could hit the wrong fleet's arrivals API. The expected
    // behavior is to drop the orphan so the user re-picks rather than risk
    // pinging dublinbus for a buseireann stopId.
    test("busStopId without busStopOperator is dropped", () => {
      lsStore.set(KEY, JSON.stringify({
        mode: "bus",
        busOperator: "dublinbus",
        busStopId: "8220DB000270",
      }));
      const out = loadSession();
      expect(out.busStopId).toBeUndefined();
      expect(out.busStopOperator).toBeUndefined();
      expect(out.mode).toBe("bus");
      expect(out.busOperator).toBe("dublinbus");
    });

    test("busStopId with valid busStopOperator is kept as a pair", () => {
      lsStore.set(KEY, JSON.stringify({
        busStopId: "X1",
        busStopOperator: "buseireann",
      }));
      const out = loadSession();
      expect(out.busStopId).toBe("X1");
      expect(out.busStopOperator).toBe("buseireann");
    });

    test("busStopId with an unrecognized busStopOperator is dropped", () => {
      lsStore.set(KEY, JSON.stringify({
        busStopId: "X1",
        busStopOperator: "imaginary",
      }));
      const out = loadSession();
      expect(out.busStopId).toBeUndefined();
      expect(out.busStopOperator).toBeUndefined();
    });
  });

  describe("mapView validation", () => {
    function withMapView(mv: unknown): string {
      return JSON.stringify({ mode: "bus", mapView: mv });
    }

    test("valid mapView is kept verbatim", () => {
      lsStore.set(KEY, withMapView({ lat: 53.3, lng: -6.2, zoom: 14 }));
      expect(loadSession().mapView).toEqual({ lat: 53.3, lng: -6.2, zoom: 14 });
    });

    test("lat outside [-90, 90] → mapView dropped", () => {
      lsStore.set(KEY, withMapView({ lat: 91, lng: 0, zoom: 10 }));
      expect(loadSession().mapView).toBeUndefined();
      lsStore.set(KEY, withMapView({ lat: -90.1, lng: 0, zoom: 10 }));
      expect(loadSession().mapView).toBeUndefined();
    });

    test("lng outside [-180, 180] → mapView dropped", () => {
      lsStore.set(KEY, withMapView({ lat: 0, lng: 181, zoom: 10 }));
      expect(loadSession().mapView).toBeUndefined();
      lsStore.set(KEY, withMapView({ lat: 0, lng: -180.1, zoom: 10 }));
      expect(loadSession().mapView).toBeUndefined();
    });

    test("zoom outside [0, 22] → mapView dropped", () => {
      lsStore.set(KEY, withMapView({ lat: 0, lng: 0, zoom: -1 }));
      expect(loadSession().mapView).toBeUndefined();
      lsStore.set(KEY, withMapView({ lat: 0, lng: 0, zoom: 23 }));
      expect(loadSession().mapView).toBeUndefined();
    });

    test("non-finite numbers (NaN/Infinity stored as null after JSON round-trip) → dropped", () => {
      // JSON.stringify turns NaN/Infinity into null, so we hand-write the JSON
      // to simulate "the parsed value is null where a number was expected".
      lsStore.set(KEY, `{"mapView":{"lat":null,"lng":0,"zoom":10}}`);
      expect(loadSession().mapView).toBeUndefined();
    });

    test("non-object mapView (string / number / null) → dropped", () => {
      lsStore.set(KEY, withMapView(null));
      expect(loadSession().mapView).toBeUndefined();
      lsStore.set(KEY, withMapView("nope"));
      expect(loadSession().mapView).toBeUndefined();
      lsStore.set(KEY, withMapView(42));
      expect(loadSession().mapView).toBeUndefined();
    });

    test("a bad mapView does not poison the rest of the session", () => {
      lsStore.set(KEY, JSON.stringify({
        mode: "train",
        filter: "dart",
        mapView: { lat: 999, lng: 0, zoom: 10 },
      }));
      const out = loadSession();
      expect(out.mode).toBe("train");
      expect(out.filter).toBe("dart");
      expect(out.mapView).toBeUndefined();
    });
  });
});

describe("saveSession", () => {
  test("writes the JSON-serialized session under the v1 key", () => {
    saveSession(completeSession);
    expect(lsStore.get(KEY)).toBe(JSON.stringify(completeSession));
  });

  test("swallows storage errors silently — persistence is best-effort", () => {
    throwOnSet = true;
    expect(() => saveSession(completeSession)).not.toThrow();
  });
});
