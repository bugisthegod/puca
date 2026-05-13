import { beforeEach, describe, expect, test } from "bun:test";

// Minimal localStorage stub — Bun test has no DOM. session.ts only touches
// localStorage inside loadSession/saveSession (not at import time), so installing
// the stub before the import is belt-and-braces, not strictly required.
const lsStore = new Map<string, string>();
const ssStore = new Map<string, string>();
let throwOnSet = false;
let throwOnSessionSet = false;
(globalThis as { localStorage?: Storage }).localStorage = {
	getItem: (k: string) => lsStore.get(k) ?? null,
	setItem: (k: string, v: string) => {
		if (throwOnSet) throw new Error("QuotaExceededError");
		lsStore.set(k, v);
	},
	removeItem: (k: string) => {
		lsStore.delete(k);
	},
	clear: () => {
		lsStore.clear();
	},
	key: () => null,
	get length() {
		return lsStore.size;
	},
} as Storage;
(globalThis as { sessionStorage?: Storage }).sessionStorage = {
	getItem: (k: string) => ssStore.get(k) ?? null,
	setItem: (k: string, v: string) => {
		if (throwOnSessionSet) throw new Error("QuotaExceededError");
		ssStore.set(k, v);
	},
	removeItem: (k: string) => {
		ssStore.delete(k);
	},
	clear: () => {
		ssStore.clear();
	},
	key: () => null,
	get length() {
		return ssStore.size;
	},
} as Storage;

import type { Favorites } from "../src/favorites";
import { saveFavorites } from "../src/favorites";
import {
	type BusSearchSession,
	clearBusSearchSession,
	loadBusSearchSession,
	loadSession,
	type Session,
	saveBusSearchSession,
	saveSession,
} from "../src/session";

const KEY = "puca-session-v1";
const BUS_SEARCH_KEY = "puca-bus-search-v1";

const completeSession: Session = {
	mode: "bus",
	filter: "all",
	busOperator: "dublinbus",
	mapView: { lat: 53.349, lng: -6.26, zoom: 14 },
};

const completeBusSearchSession: BusSearchSession = {
	busRoute: "39A",
	busDirection: "0",
	busSearchTab: "stop",
	busStopId: "8220DB000270",
	busStopOperator: "dublinbus",
	routeQuery: "39A",
	stopQuery: "Parnell",
};

beforeEach(() => {
	lsStore.clear();
	ssStore.clear();
	throwOnSet = false;
	throwOnSessionSet = false;
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

	test("invalid filter / operator are individually dropped", () => {
		lsStore.set(
			KEY,
			JSON.stringify({
				...completeSession,
				filter: "luas",
				busOperator: "notReal",
			}),
		);
		const out = loadSession();
		expect(out.filter).toBeUndefined();
		expect(out.busOperator).toBeUndefined();
		expect(out.mode).toBe("bus"); // unrelated valid fields still rehydrate
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
			lsStore.set(
				KEY,
				JSON.stringify({
					mode: "train",
					filter: "dart",
					mapView: { lat: 999, lng: 0, zoom: 10 },
				}),
			);
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

describe("loadBusSearchSession", () => {
	test("returns empty Partial when nothing is stored", () => {
		expect(loadBusSearchSession()).toEqual({});
	});

	test("returns empty Partial on malformed JSON, no throw", () => {
		ssStore.set(BUS_SEARCH_KEY, "{not json");
		expect(loadBusSearchSession()).toEqual({});
	});

	test("round-trips a complete bus search session", () => {
		saveBusSearchSession(completeBusSearchSession);
		expect(loadBusSearchSession()).toEqual(completeBusSearchSession);
	});

	test("invalid tab is dropped but valid fields survive", () => {
		ssStore.set(
			BUS_SEARCH_KEY,
			JSON.stringify({
				...completeBusSearchSession,
				busSearchTab: "neither",
			}),
		);
		const out = loadBusSearchSession();
		expect(out.busSearchTab).toBeUndefined();
		expect(out.busRoute).toBe("39A");
		expect(out.routeQuery).toBe("39A");
	});

	test("busStopId without busStopOperator is dropped", () => {
		ssStore.set(
			BUS_SEARCH_KEY,
			JSON.stringify({
				...completeBusSearchSession,
				busStopOperator: null,
			}),
		);
		const out = loadBusSearchSession();
		expect(out.busStopId).toBeUndefined();
		expect(out.busStopOperator).toBeUndefined();
	});
});

describe("saveBusSearchSession / clearBusSearchSession", () => {
	test("writes the JSON-serialized bus search session under the v1 key", () => {
		saveBusSearchSession(completeBusSearchSession);
		expect(ssStore.get(BUS_SEARCH_KEY)).toBe(
			JSON.stringify(completeBusSearchSession),
		);
	});

	test("clear removes the bus search session key", () => {
		ssStore.set(BUS_SEARCH_KEY, JSON.stringify(completeBusSearchSession));
		clearBusSearchSession();
		expect(ssStore.has(BUS_SEARCH_KEY)).toBe(false);
	});

	test("swallows storage errors silently — persistence is best-effort", () => {
		throwOnSessionSet = true;
		expect(() => saveBusSearchSession(completeBusSearchSession)).not.toThrow();
	});
});

describe("persistence split: search → sessionStorage, app state & favorites → localStorage", () => {
	test("saveSession writes to localStorage only, never touches sessionStorage", () => {
		saveSession(completeSession);
		const lsRaw = lsStore.get(KEY);
		expect(lsRaw).not.toBeNull();
		expect(ssStore.has(KEY)).toBe(false);
		const parsed = JSON.parse(lsRaw!);
		// Must not leak bus search fields back into localStorage
		expect(parsed.busRoute).toBeUndefined();
		expect(parsed.busDirection).toBeUndefined();
		expect(parsed.busSearchTab).toBeUndefined();
		expect(parsed.busStopId).toBeUndefined();
		expect(parsed.busStopOperator).toBeUndefined();
	});

	test("saveBusSearchSession writes to sessionStorage only, never touches localStorage", () => {
		saveBusSearchSession(completeBusSearchSession);
		const ssRaw = ssStore.get(BUS_SEARCH_KEY);
		expect(ssRaw).not.toBeNull();
		expect(lsStore.has(BUS_SEARCH_KEY)).toBe(false);
		const parsed = JSON.parse(ssRaw!);
		// Bus search fields should all be present
		expect(parsed.busRoute).toBe("39A");
		expect(parsed.busSearchTab).toBe("stop");
		expect(parsed.busStopId).toBe("8220DB000270");
	});

	test("saveFavorites writes to localStorage only, never touches sessionStorage", () => {
		const FAV_KEY = "puca-favorites-v1";
		const favs: Favorites = {
			buses: [
				{
					shortName: "39A",
					operator: "dublinbus" as const,
					direction: "0",
					headsign: "UCD",
				},
			],
			trains: [
				{ from: "DUBLN", to: "CORK", fromName: "Dublin", toName: "Cork" },
			],
			stops: [
				{
					stopId: "X1",
					operator: "buseireann" as const,
					stopCode: "X1",
					stopName: "X Stop",
				},
			],
		};
		saveFavorites(favs);
		const lsRaw = lsStore.get(FAV_KEY);
		expect(lsRaw).not.toBeNull();
		expect(ssStore.has(FAV_KEY)).toBe(false);
	});
});
