import { beforeEach, describe, expect, test } from "bun:test";

// Minimal localStorage stub — Bun test has no DOM. favorites.ts only reads
// localStorage inside functions (not at import time), so we can install the
// stub after the import and it'll be in place by the time any test calls
// loadFavorites / saveFavorites.
const lsStore = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => lsStore.get(k) ?? null,
  setItem: (k: string, v: string) => { lsStore.set(k, v); },
  removeItem: (k: string) => { lsStore.delete(k); },
  clear: () => { lsStore.clear(); },
  key: () => null,
  get length() { return lsStore.size; },
} as Storage;

import {
  busKey,
  emptyFavorites,
  hasBus,
  hasStop,
  hasTrain,
  loadFavorites,
  removeBus,
  removeStop,
  removeTrain,
  saveFavorites,
  stopKey,
  toggleBus,
  toggleStop,
  toggleTrain,
  totalFavorites,
  trainKey,
  type BusFavorite,
  type BusStopFavorite,
  type Favorites,
  type TrainFavorite,
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
});

describe("has*", () => {
  test("hasBus matches on the composite key, not reference equality", () => {
    const favs: Favorites = { buses: [bus39A], trains: [], stops: [] };
    expect(hasBus(favs, { ...bus39A })).toBe(true);
    expect(hasBus(favs, bus39AReverse)).toBe(false);
  });

  test("hasTrain / hasStop behave the same way", () => {
    const favs: Favorites = { buses: [], trains: [trainMalGrey], stops: [stopOConn] };
    expect(hasTrain(favs, { from: "MHIDE", to: "GRYST" } as TrainFavorite)).toBe(true);
    expect(hasStop(favs, { stopId: stopOConn.stopId, operator: stopOConn.operator } as BusStopFavorite)).toBe(true);
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
    const before: Favorites = { buses: [bus39A], trains: [], stops: [] };
    const after = toggleBus(before, bus39A);
    // Original array untouched — frozen snapshot of behavior for React state use.
    expect(before.buses).toHaveLength(1);
    expect(after).not.toBe(before);
    expect(after.buses).not.toBe(before.buses);
  });

  test("toggleTrain / toggleStop round-trip the same way as toggleBus", () => {
    let favs = emptyFavorites();
    favs = toggleTrain(favs, trainMalGrey);
    favs = toggleStop(favs, stopOConn);
    expect(favs.trains).toHaveLength(1);
    expect(favs.stops).toHaveLength(1);
    favs = toggleTrain(favs, trainMalGrey);
    favs = toggleStop(favs, stopOConn);
    expect(favs.trains).toHaveLength(0);
    expect(favs.stops).toHaveLength(0);
  });
});

describe("remove*", () => {
  test("removeBus by key is a no-op when the key does not exist", () => {
    const favs: Favorites = { buses: [bus39A], trains: [], stops: [] };
    const after = removeBus(favs, "nope:NONE:0");
    expect(after.buses).toHaveLength(1);
  });

  test("removeTrain / removeStop remove the right entry by key", () => {
    const favs: Favorites = { buses: [], trains: [trainMalGrey], stops: [stopOConn] };
    const afterTrain = removeTrain(favs, trainKey(trainMalGrey));
    expect(afterTrain.trains).toHaveLength(0);
    const afterStop = removeStop(favs, stopKey(stopOConn));
    expect(afterStop.stops).toHaveLength(0);
  });
});

describe("totalFavorites", () => {
  test("sums across all three categories", () => {
    const favs: Favorites = { buses: [bus39A, bus39AReverse], trains: [trainMalGrey], stops: [stopOConn] };
    expect(totalFavorites(favs)).toBe(4);
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
    const original: Favorites = { buses: [bus39A], trains: [trainMalGrey], stops: [stopOConn] };
    saveFavorites(original);
    expect(loadFavorites()).toEqual(original);
  });

  test("returns empty on corrupt JSON rather than throwing", () => {
    lsStore.set("puca-favorites-v1", "{not json");
    expect(loadFavorites()).toEqual(emptyFavorites());
  });

  test("filters out bus favorites with unknown operators", () => {
    lsStore.set("puca-favorites-v1", JSON.stringify({
      buses: [
        bus39A,
        { ...bus39A, operator: "imaginaryoperator" },
      ],
      trains: [],
      stops: [],
    }));
    const out = loadFavorites();
    expect(out.buses).toHaveLength(1);
    expect(out.buses[0]!.operator).toBe("dublinbus");
  });

  test("filters out records missing required fields", () => {
    lsStore.set("puca-favorites-v1", JSON.stringify({
      buses: [bus39A, { shortName: "", operator: "dublinbus", direction: "0", headsign: "" }],
      trains: [trainMalGrey, { from: "", to: "GRYST", fromName: "", toName: "G" }],
      stops: [stopOConn, { stopId: "", operator: "dublinbus", stopCode: "1", stopName: "" }],
    }));
    const out = loadFavorites();
    expect(out.buses).toHaveLength(1);
    expect(out.trains).toHaveLength(1);
    expect(out.stops).toHaveLength(1);
  });

  test("v1 records without a `stops` field deserialize to empty stops (no migration needed)", () => {
    // This is the exact shape we'd see from a user installed before the stops
    // favorite was added. It must not crash and must not lose buses/trains.
    lsStore.set("puca-favorites-v1", JSON.stringify({
      buses: [bus39A],
      trains: [trainMalGrey],
    }));
    const out = loadFavorites();
    expect(out.buses).toHaveLength(1);
    expect(out.trains).toHaveLength(1);
    expect(out.stops).toEqual([]);
  });

  test("non-array field values are ignored without throwing", () => {
    lsStore.set("puca-favorites-v1", JSON.stringify({
      buses: "not an array",
      trains: null,
      stops: 42,
    }));
    expect(loadFavorites()).toEqual(emptyFavorites());
  });
});
