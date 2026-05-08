import { describe, expect, test } from "bun:test";
import {
  BUS_OPERATOR_INITIALS,
  BUS_OPERATOR_LABEL,
  BUS_SEARCH_OPERATORS,
  filterBusRoutes,
  getBusDirections,
  type RouteWithOperator,
} from "../src/components/BusSearchPanel";
import { INFO_BUS_OPERATORS, INFO_FILTERS } from "../src/components/InfoPanel";

describe("BusSearchPanel smoke helpers", () => {
  const routes: RouteWithOperator[] = [
    { id: "db-c1", shortName: "C1", longName: "Adamstown Station - Sandymount", operator: "dublinbus" },
    { id: "be-220", shortName: "220", longName: "Carrigaline - Cork City", operator: "buseireann" },
    { id: "ga-175", shortName: "175", longName: "UCD - Citywest", operator: "goahead" },
  ];

  test("keeps all three bus operators visible in a stable order", () => {
    expect(BUS_SEARCH_OPERATORS).toEqual(["dublinbus", "buseireann", "goahead"]);
    expect(BUS_OPERATOR_INITIALS).toEqual({
      dublinbus: "DB",
      buseireann: "BÉ",
      goahead: "GA",
    });
    expect(BUS_OPERATOR_LABEL).toEqual({
      dublinbus: "Dublin Bus",
      buseireann: "Bus Éireann",
      goahead: "Go-Ahead",
    });
  });

  test("filters routes by short name or long name without changing empty-query order", () => {
    expect(filterBusRoutes(routes, "").map((r) => r.shortName)).toEqual(["C1", "220", "175"]);
    expect(filterBusRoutes(routes, " c1 ").map((r) => r.shortName)).toEqual(["C1"]);
    expect(filterBusRoutes(routes, "cork").map((r) => r.shortName)).toEqual(["220"]);
    expect(filterBusRoutes(routes, "CITY").map((r) => r.shortName)).toEqual(["220", "175"]);
  });

  test("derives direction labels from shape data and falls back to the direction id", () => {
    expect(getBusDirections(null)).toEqual({});
    expect(getBusDirections({
      "0": { headsign: "Maynooth" },
      "1": { headsign: "" },
    })).toEqual({
      "0": "Maynooth",
      "1": "1",
    });
  });
});

describe("InfoPanel smoke constants", () => {
  test("keeps train filters and bus operators in the expected UI order", () => {
    expect(INFO_FILTERS.map((f) => f.value)).toEqual(["all", "dart", "commuter", "intercity"]);
    expect(INFO_FILTERS.map((f) => f.label)).toEqual(["All", "DART", "Commuter", "Intercity"]);
    expect(INFO_BUS_OPERATORS.map((op) => op.value)).toEqual(["dublinbus", "buseireann", "goahead"]);
    expect(INFO_BUS_OPERATORS.map((op) => op.label)).toEqual(["Dublin Bus", "Bus Éireann", "Go-Ahead"]);
  });
});
