import type { BusOperator } from "../types";
import type { BusMapView, BusSearchSession } from "./session";

export interface BusNavigationState {
	view: BusMapView;
	route: string | null;
	direction: string | null;
	stopId: string | null;
	stopOperator: BusOperator | null;
}

export type BusNavigationAction =
	| { type: "set-view"; view: BusMapView }
	| {
			type: "set-stop-identity";
			stopId: string | null;
			operator: BusOperator | null;
	  }
	| { type: "select-route"; route: string | null }
	| { type: "show-route"; route: string; direction: string }
	| { type: "set-direction"; direction: string | null }
	| { type: "clear-route" }
	| { type: "clear-all" };

export function planBusStopSelection(
	state: Pick<BusNavigationState, "stopId" | "stopOperator">,
	stopId: string | null,
	stopOperator: BusOperator | null,
): {
	action: Extract<BusNavigationAction, { type: "set-stop-identity" }>;
	resetFocus: boolean;
} {
	return {
		action: {
			type: "set-stop-identity",
			stopId,
			operator: stopOperator,
		},
		resetFocus: state.stopId !== stopId || state.stopOperator !== stopOperator,
	};
}

export function shouldClearBusFocusForRouteSelection(
	view: BusMapView,
	route: string | null,
): boolean {
	return route !== null || view === "live";
}

export function createInitialBusNavigation(
	savedMapView: BusMapView | undefined,
	savedSearch: Partial<BusSearchSession>,
): BusNavigationState {
	const hasSavedStop = !!(savedSearch.busStopId && savedSearch.busStopOperator);
	const view =
		savedMapView ??
		(savedSearch.busSearchTab === "stop" ||
		(savedSearch.busSearchTab === undefined && hasSavedStop)
			? "stops"
			: "live");

	if (view === "stops") {
		return {
			view,
			route: null,
			direction: null,
			stopId: hasSavedStop ? (savedSearch.busStopId ?? null) : null,
			stopOperator: hasSavedStop ? (savedSearch.busStopOperator ?? null) : null,
		};
	}

	return {
		view,
		route: savedSearch.busRoute ?? null,
		direction: savedSearch.busDirection ?? null,
		stopId: null,
		stopOperator: null,
	};
}

export function busNavigationReducer(
	state: BusNavigationState,
	action: BusNavigationAction,
): BusNavigationState {
	switch (action.type) {
		case "set-view":
			if (action.view === state.view) return state;
			return action.view === "stops"
				? {
						...state,
						view: "stops",
						route: null,
						direction: null,
					}
				: {
						...state,
						view: "live",
						stopId: null,
						stopOperator: null,
					};
		case "set-stop-identity":
			if (!action.stopId || !action.operator) {
				return { ...state, stopId: null, stopOperator: null };
			}
			return {
				...state,
				view: "stops",
				route: null,
				direction: null,
				stopId: action.stopId,
				stopOperator: action.operator,
			};
		case "select-route":
			if (action.route === null) {
				return { ...state, route: null, direction: null };
			}
			return {
				...state,
				view: "live",
				route: action.route,
				direction: null,
				stopId: null,
				stopOperator: null,
			};
		case "show-route":
			return {
				view: "live",
				route: action.route,
				direction: action.direction,
				stopId: null,
				stopOperator: null,
			};
		case "set-direction":
			return { ...state, direction: action.direction };
		case "clear-route":
			return { ...state, route: null, direction: null };
		case "clear-all":
			return {
				...state,
				route: null,
				direction: null,
				stopId: null,
				stopOperator: null,
			};
	}
}
