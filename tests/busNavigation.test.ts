import { describe, expect, test } from "bun:test";
import {
	type BusNavigationAction,
	busNavigationReducer,
	createInitialBusNavigation,
	planBusStopSelection,
	shouldClearBusFocusForRouteSelection,
} from "../src/client/busNavigation";

describe("createInitialBusNavigation", () => {
	test("migrates a saved stop session when legacy localStorage has no map view", () => {
		expect(
			createInitialBusNavigation(undefined, {
				busSearchTab: "stop",
				busStopId: "1847",
				busStopOperator: "dublinbus",
			}),
		).toEqual({
			view: "stops",
			route: null,
			direction: null,
			stopId: "1847",
			stopOperator: "dublinbus",
		});
	});

	test("normalizes an explicit live view so a stale stop cannot block the panel", () => {
		const state = createInitialBusNavigation("live", {
			busSearchTab: "stop",
			busStopId: "1847",
			busStopOperator: "dublinbus",
		});
		expect(state.view).toBe("live");
		expect(state.stopId).toBeNull();
		expect(state.stopOperator).toBeNull();
	});
});

describe("busNavigationReducer", () => {
	const stopState = createInitialBusNavigation("stops", {
		busSearchTab: "stop",
		busStopId: "1847",
		busStopOperator: "dublinbus",
	});

	test("a view can never coexist with its incompatible selection", () => {
		const actions: BusNavigationAction[] = [
			{ type: "set-view", view: "live" },
			{ type: "set-view", view: "stops" },
			{
				type: "set-stop-identity",
				stopId: "1847",
				operator: "dublinbus",
			},
			{ type: "set-stop-identity", stopId: null, operator: null },
			{ type: "select-route", route: "39A" },
			{ type: "select-route", route: null },
			{ type: "show-route", route: "39A", direction: "1" },
			{ type: "set-direction", direction: "1" },
			{ type: "clear-route" },
			{ type: "clear-all" },
		];
		const seeds = [createInitialBusNavigation("live", {}), stopState];

		for (const seed of seeds) {
			for (const action of actions) {
				const next = busNavigationReducer(seed, action);
				if (next.view === "live") {
					expect(next.stopId).toBeNull();
					expect(next.stopOperator).toBeNull();
				}
				if (next.view === "stops") {
					expect(next.route).toBeNull();
				}
			}
		}
	});

	test("plans one atomic stop selection and resets focus only for a new identity", () => {
		const sameStop = planBusStopSelection(stopState, "1847", "dublinbus");
		expect(sameStop).toEqual({
			action: {
				type: "set-stop-identity",
				stopId: "1847",
				operator: "dublinbus",
			},
			resetFocus: false,
		});
		const newStop = planBusStopSelection(stopState, "1848", "dublinbus");
		expect(newStop).toEqual({
			action: {
				type: "set-stop-identity",
				stopId: "1848",
				operator: "dublinbus",
			},
			resetFocus: true,
		});
	});

	test("switching layers clears incompatible search state", () => {
		const live = busNavigationReducer(stopState, {
			type: "set-view",
			view: "live",
		});
		expect(live).toMatchObject({
			view: "live",
			stopId: null,
			stopOperator: null,
		});

		const stops = busNavigationReducer(
			{ ...live, route: "39A", direction: "1" },
			{ type: "set-view", view: "stops" },
		);
		expect(stops).toMatchObject({
			view: "stops",
			route: null,
			direction: null,
		});
	});

	test("clearing a route query does not leave Stops view", () => {
		const cleared = busNavigationReducer(stopState, {
			type: "select-route",
			route: null,
		});
		expect(cleared).toMatchObject({
			view: "stops",
			route: null,
			direction: null,
			stopId: "1847",
			stopOperator: "dublinbus",
		});
	});

	test("clearing an empty route query in Stops view preserves stop focus", () => {
		expect(shouldClearBusFocusForRouteSelection("stops", null)).toBe(false);
		expect(shouldClearBusFocusForRouteSelection("live", null)).toBe(true);
		expect(shouldClearBusFocusForRouteSelection("stops", "39A")).toBe(true);
	});
});
