import { beforeEach, describe, expect, test } from "bun:test";

// Minimal localStorage stub — Bun test has no DOM. favorites.ts only reads
// localStorage inside functions (not at import time), so we can install the
// stub after the import and it'll be in place by the time any test calls
// loadFavorites / saveFavorites.
const lsStore = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
	getItem: (k: string) => lsStore.get(k) ?? null,
	setItem: (k: string, v: string) => {
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

import {
	type BusFavorite,
	type BusStopFavorite,
	busKey,
	emptyFavorites,
	type Favorites,
	hasBus,
	hasLuasStop,
	hasStop,
	hasTrain,
	loadFavorites,
	luasStopKey,
	moveBusFavorite,
	moveLuasStopFavorite,
	moveStopFavorite,
	moveTrainFavorite,
	removeBus,
	removeLuasStop,
	removeStop,
	removeTrain,
	saveFavorites,
	stopKey,
	type TrainFavorite,
	toggleBus,
	toggleLuasStop,
	toggleStop,
	toggleTrain,
	totalFavorites,
	trainKey,
} from "../src/favorites";

const bus39A: BusFavorite = {
	shortName: "39A",
	operator: "dublinbus",
	direction: "0",
	headsign: "Hansfield Road",
};

const bus39AReverse: BusFavorite = {
	shortName: "39A",
	operator: "dublinbus",
	direction: "1",
	headsign: "Burlington Road",
};

const trainMalGrey: TrainFavorite = {
	from: "MHIDE",
	to: "GRYST",
	fromName: "Malahide",
	toName: "Greystones",
};

const stopOConn: BusStopFavorite = {
	stopId: "8220DB000270",
	operator: "dublinbus",
	stopCode: "270",
	stopName: "O'Connell Street Upper",
};

const luasStopPoint = {
	stopId: "8220GA00436",
	stopName: "The Point",
	line: "red" as const,
};

beforeEach(() => {
	lsStore.clear();
});

describe("key functions", () => {
	test("busKey encodes operator:shortName:direction", () => {
		expect(busKey(bus39A)).toBe("dublinbus:39A:0");
	});

	test("busKey distinguishes directions", () => {
		expect(busKey(bus39A)).not.toBe(busKey(bus39AReverse));
	});

	test("trainKey uses an arrow to avoid colliding with station codes", () => {
		expect(trainKey(trainMalGrey)).toBe("MHIDE→GRYST");
	});

	test("stopKey namespaces by operator so two operators can't alias a stopId", () => {
		const a = stopKey({ stopId: "SAME", operator: "dublinbus" });
		const b = stopKey({ stopId: "SAME", operator: "buseireann" });
		expect(a).not.toBe(b);
	});

	test("luasStopKey namespaces Luas stops separately", () => {
		expect(luasStopKey(luasStopPoint)).toBe("luas:8220GA00436");
	});
});

describe("has*", () => {
	test("hasBus matches on the composite key, not reference equality", () => {
		const favs: Favorites = {
			buses: [bus39A],
			trains: [],
			stops: [],
			luasStops: [],
		};
		expect(hasBus(favs, { ...bus39A })).toBe(true);
		expect(hasBus(favs, bus39AReverse)).toBe(false);
	});

	test("hasBus can match a saved route after direction ids change", () => {
		const favs: Favorites = {
			buses: [bus39A],
			trains: [],
			stops: [],
			luasStops: [],
		};
		expect(
			hasBus(favs, {
				shortName: "39A",
				operator: "dublinbus",
				direction: "1",
				headsign: "Hansfield Road",
			}),
		).toBe(true);
	});

	test("hasTrain / hasStop behave the same way", () => {
		const favs: Favorites = {
			buses: [],
			trains: [trainMalGrey],
			stops: [stopOConn],
			luasStops: [luasStopPoint],
		};
		expect(
			hasTrain(favs, { from: "MHIDE", to: "GRYST" } as TrainFavorite),
		).toBe(true);
		expect(
			hasStop(favs, {
				stopId: stopOConn.stopId,
				operator: stopOConn.operator,
			} as BusStopFavorite),
		).toBe(true);
		expect(hasLuasStop(favs, { stopId: luasStopPoint.stopId })).toBe(true);
	});

	test("hasStop can match a saved stop after stop ids change", () => {
		const favs: Favorites = {
			buses: [],
			trains: [],
			stops: [stopOConn],
			luasStops: [],
		};
		expect(
			hasStop(favs, {
				stopId: "8220DB999270",
				operator: "dublinbus",
				stopCode: "270",
			}),
		).toBe(true);
	});
});

describe("toggle*", () => {
	test("toggleBus adds when absent, removes when present", () => {
		const empty = emptyFavorites();
		const added = toggleBus(empty, bus39A);
		expect(added.buses).toHaveLength(1);
		const removed = toggleBus(added, bus39A);
		expect(removed.buses).toHaveLength(0);
	});

	test("toggleBus treats different directions as distinct entries", () => {
		let favs = emptyFavorites();
		favs = toggleBus(favs, bus39A);
		favs = toggleBus(favs, bus39AReverse);
		expect(favs.buses).toHaveLength(2);
	});

	test("toggle functions do not mutate the input favorites object", () => {
		const before: Favorites = {
			buses: [bus39A],
			trains: [],
			stops: [],
			luasStops: [],
		};
		const after = toggleBus(before, bus39A);
		// Original array untouched — frozen snapshot of behavior for React state use.
		expect(before.buses).toHaveLength(1);
		expect(after).not.toBe(before);
		expect(after.buses).not.toBe(before.buses);
	});

	test("toggleTrain / toggleStop / toggleLuasStop round-trip like toggleBus", () => {
		let favs = emptyFavorites();
		favs = toggleTrain(favs, trainMalGrey);
		favs = toggleStop(favs, stopOConn);
		favs = toggleLuasStop(favs, luasStopPoint);
		expect(favs.trains).toHaveLength(1);
		expect(favs.stops).toHaveLength(1);
		expect(favs.luasStops).toHaveLength(1);
		favs = toggleTrain(favs, trainMalGrey);
		favs = toggleStop(favs, stopOConn);
		favs = toggleLuasStop(favs, luasStopPoint);
		expect(favs.trains).toHaveLength(0);
		expect(favs.stops).toHaveLength(0);
		expect(favs.luasStops).toHaveLength(0);
	});

	test("toggleBus removes an existing favorite matched by route headsign", () => {
		const favs: Favorites = {
			buses: [bus39A],
			trains: [],
			stops: [],
			luasStops: [],
		};
		const after = toggleBus(favs, {
			shortName: "39A",
			operator: "dublinbus",
			direction: "1",
			headsign: "Hansfield Road",
		});
		expect(after.buses).toHaveLength(0);
	});

	test("toggleStop removes an existing favorite matched by public stop code", () => {
		const favs: Favorites = {
			buses: [],
			trains: [],
			stops: [stopOConn],
			luasStops: [],
		};
		const after = toggleStop(favs, {
			stopId: "8220DB999270",
			operator: "dublinbus",
			stopCode: "270",
			stopName: "O'Connell Street Upper",
		});
		expect(after.stops).toHaveLength(0);
	});
});

describe("remove*", () => {
	test("removeBus by key is a no-op when the key does not exist", () => {
		const favs: Favorites = {
			buses: [bus39A],
			trains: [],
			stops: [],
			luasStops: [],
		};
		const after = removeBus(favs, "nope:NONE:0");
		expect(after.buses).toHaveLength(1);
	});

	test("removeTrain / removeStop / removeLuasStop remove the right entry", () => {
		const favs: Favorites = {
			buses: [],
			trains: [trainMalGrey],
			stops: [stopOConn],
			luasStops: [luasStopPoint],
		};
		const afterTrain = removeTrain(favs, trainKey(trainMalGrey));
		expect(afterTrain.trains).toHaveLength(0);
		const afterStop = removeStop(favs, stopKey(stopOConn));
		expect(afterStop.stops).toHaveLength(0);
		const afterLuasStop = removeLuasStop(favs, luasStopKey(luasStopPoint));
		expect(afterLuasStop.luasStops).toHaveLength(0);
	});
});

describe("move*", () => {
	test("moveBusFavorite reorders within the bus section only", () => {
		const favs: Favorites = {
			buses: [bus39A, bus39AReverse],
			trains: [trainMalGrey],
			stops: [stopOConn],
			luasStops: [luasStopPoint],
		};
		const after = moveBusFavorite(favs, busKey(bus39AReverse), -1);
		expect(after.buses).toEqual([bus39AReverse, bus39A]);
		expect(after.trains).toBe(favs.trains);
		expect(after.stops).toBe(favs.stops);
		expect(after.luasStops).toBe(favs.luasStops);
	});

	test("move functions are no-ops at section boundaries", () => {
		const favs: Favorites = {
			buses: [bus39A, bus39AReverse],
			trains: [trainMalGrey],
			stops: [stopOConn],
			luasStops: [luasStopPoint],
		};
		expect(moveBusFavorite(favs, busKey(bus39A), -1).buses).toBe(favs.buses);
		expect(moveTrainFavorite(favs, trainKey(trainMalGrey), 1).trains).toBe(
			favs.trains,
		);
		expect(moveStopFavorite(favs, stopKey(stopOConn), -1).stops).toBe(
			favs.stops,
		);
		expect(
			moveLuasStopFavorite(favs, luasStopKey(luasStopPoint), 1).luasStops,
		).toBe(favs.luasStops);
	});
});

describe("totalFavorites", () => {
	test("sums across all favorite categories", () => {
		const favs: Favorites = {
			buses: [bus39A, bus39AReverse],
			trains: [trainMalGrey],
			stops: [stopOConn],
			luasStops: [luasStopPoint],
		};
		expect(totalFavorites(favs)).toBe(5);
	});

	test("empty favorites yields 0", () => {
		expect(totalFavorites(emptyFavorites())).toBe(0);
	});
});

describe("loadFavorites / saveFavorites (localStorage round-trip)", () => {
	test("returns empty when nothing is stored", () => {
		expect(loadFavorites()).toEqual(emptyFavorites());
	});

	test("roundtrips a full favorites object", () => {
		const original: Favorites = {
			buses: [bus39A],
			trains: [trainMalGrey],
			stops: [stopOConn],
			luasStops: [luasStopPoint],
		};
		saveFavorites(original);
		expect(loadFavorites()).toEqual(original);
	});

	test("returns empty on corrupt JSON rather than throwing", () => {
		lsStore.set("puca-favorites-v1", "{not json");
		expect(loadFavorites()).toEqual(emptyFavorites());
	});

	test("filters out bus favorites with unknown operators", () => {
		lsStore.set(
			"puca-favorites-v1",
			JSON.stringify({
				buses: [bus39A, { ...bus39A, operator: "imaginaryoperator" }],
				trains: [],
				stops: [],
			}),
		);
		const out = loadFavorites();
		expect(out.buses).toHaveLength(1);
		expect(out.buses[0]?.operator).toBe("dublinbus");
	});

	test("filters out records missing required fields", () => {
		lsStore.set(
			"puca-favorites-v1",
			JSON.stringify({
				buses: [
					bus39A,
					{
						shortName: "",
						operator: "dublinbus",
						direction: "0",
						headsign: "",
					},
				],
				trains: [
					trainMalGrey,
					{ from: "", to: "GRYST", fromName: "", toName: "G" },
				],
				stops: [
					stopOConn,
					{ stopId: "", operator: "dublinbus", stopCode: "1", stopName: "" },
				],
				luasStops: [
					luasStopPoint,
					{ stopId: "", stopName: "", line: "green" },
					{ stopId: "x", stopName: "Bad line", line: "blue" },
				],
			}),
		);
		const out = loadFavorites();
		expect(out.buses).toHaveLength(1);
		expect(out.trains).toHaveLength(1);
		expect(out.stops).toHaveLength(1);
		expect(out.luasStops).toHaveLength(1);
	});

	test("v1 records without a `stops` field deserialize to empty stops (no migration needed)", () => {
		// This is the exact shape we'd see from a user installed before the stops
		// favorite was added. It must not crash and must not lose buses/trains.
		lsStore.set(
			"puca-favorites-v1",
			JSON.stringify({
				buses: [bus39A],
				trains: [trainMalGrey],
			}),
		);
		const out = loadFavorites();
		expect(out.buses).toHaveLength(1);
		expect(out.trains).toHaveLength(1);
		expect(out.stops).toEqual([]);
		expect(out.luasStops).toEqual([]);
	});

	test("non-array field values are ignored without throwing", () => {
		lsStore.set(
			"puca-favorites-v1",
			JSON.stringify({
				buses: "not an array",
				trains: null,
				stops: 42,
				luasStops: {},
			}),
		);
		expect(loadFavorites()).toEqual(emptyFavorites());
	});
});
