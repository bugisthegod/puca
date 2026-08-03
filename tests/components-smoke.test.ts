import { describe, expect, test } from "bun:test";
import {
	activeBusSearchQuery,
	BUS_OPERATOR_INITIALS,
	BUS_OPERATOR_LABEL,
	displayEtaSeconds,
	filterBusRoutes,
	getBusDirections,
	initialBusSearchQueries,
	isCurrentSelectedStop,
	type RouteWithOperator,
} from "../src/client/components/BusSearchPanel";
import { trainFocusSummaryMeta } from "../src/client/components/InfoPanel";
import { t } from "../src/client/i18n";

describe("BusSearchPanel smoke helpers", () => {
	const routes: RouteWithOperator[] = [
		{
			id: "db-c1",
			shortName: "C1",
			longName: "Adamstown Station - Sandymount",
			operator: "dublinbus",
		},
		{
			id: "be-220",
			shortName: "220",
			longName: "Carrigaline - Cork City",
			operator: "buseireann",
		},
		{
			id: "ga-175",
			shortName: "175",
			longName: "UCD - Citywest",
			operator: "goahead",
		},
	];

	test("keeps all three bus operator badges labelled", () => {
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
		expect(filterBusRoutes(routes, "").map((r) => r.shortName)).toEqual([
			"C1",
			"220",
			"175",
		]);
		expect(filterBusRoutes(routes, " c1 ").map((r) => r.shortName)).toEqual([
			"C1",
		]);
		expect(filterBusRoutes(routes, "cork").map((r) => r.shortName)).toEqual([
			"220",
		]);
		expect(filterBusRoutes(routes, "CITY").map((r) => r.shortName)).toEqual([
			"220",
			"175",
		]);
	});

	test("derives direction labels from shape data and falls back to the direction id", () => {
		expect(getBusDirections(null)).toEqual({});
		expect(
			getBusDirections({
				"0": { headsign: "Maynooth", coords: [], stops: [] },
				"1": { headsign: "", coords: [], stops: [] },
			}),
		).toEqual({
			"0": "Maynooth",
			"1": "1",
		});
	});

	test("keeps displayed stop ETAs moving between arrivals fetches", () => {
		expect(displayEtaSeconds(600, null, 31_000)).toBe(600);
		expect(displayEtaSeconds(600, 1_000, 31_000)).toBe(570);
		expect(displayEtaSeconds(20, 1_000, 31_000)).toBe(0);
	});

	test("only allows arrival focus for the navigation-selected stop", () => {
		const stop = { id: "1847", operator: "dublinbus" as const };
		expect(isCurrentSelectedStop(stop, "1847", "dublinbus")).toBe(true);
		expect(isCurrentSelectedStop(stop, null, null)).toBe(false);
		expect(isCurrentSelectedStop(stop, "1848", "dublinbus")).toBe(false);
		expect(isCurrentSelectedStop(stop, "1847", "goahead")).toBe(false);
	});

	test("keeps route and stop queries isolated when restoring a session", () => {
		const queries = initialBusSearchQueries({
			busSearchTab: "stop",
			routeQuery: "39A",
			stopQuery: "1847",
		});
		expect(queries).toEqual({ routeQuery: "39A", stopQuery: "1847" });
		expect(
			activeBusSearchQuery("route", queries.routeQuery, queries.stopQuery),
		).toBe("39A");
		expect(
			activeBusSearchQuery("stop", queries.routeQuery, queries.stopQuery),
		).toBe("1847");
	});
});

describe("InfoPanel smoke helpers", () => {
	test("uses departure copy for train summaries at the origin stop", () => {
		expect(
			trainFocusSummaryMeta(
				{
					trainCode: "P660",
					directionName: "Grand Canal Dock",
					stopsAway: 0,
					etaMinutes: 5,
					isOriginStop: true,
				},
				t,
			),
		).toBe("Departs in 5 min");
	});

	test("keeps stops-away copy for train summaries after the origin", () => {
		expect(
			trainFocusSummaryMeta(
				{
					trainCode: "P660",
					directionName: "Grand Canal Dock",
					stopsAway: 2,
					etaMinutes: 10,
					isOriginStop: false,
				},
				t,
			),
		).toBe("2 stops away · 10 min");
	});
});
