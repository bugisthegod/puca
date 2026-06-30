import type { BusOperator, BusRoute, BusShape } from "../../types";

export type RouteWithOperator = BusRoute & { operator: BusOperator };

export type StopSearchResult = {
	id: string;
	name: string;
	code: string;
	lat: number;
	lng: number;
	operator: BusOperator;
};

export type StopArrival = {
	tripId: string;
	routeShortName: string;
	headsign: string;
	etaSeconds: number;
	delaySec: number;
	stopSequence: number;
	stopsAway: number | null;
	direction: string;
	status: "running" | "scheduled";
};

export type BusStopSummary = {
	stopCode: string;
	stopName: string;
	operator: BusOperator;
	selected: boolean;
	focusKey: string | null;
	emptyText: string | null;
	nextArrival: {
		routeShortName: string;
		headsign: string;
		etaText: string;
		stopsAwayText: string | null;
	} | null;
};

export type UnifiedResult =
	| { kind: "route"; route: RouteWithOperator }
	| { kind: "stop"; stop: StopSearchResult };

export const BUS_OPERATOR_INITIALS: Record<BusOperator, string> = {
	dublinbus: "DB",
	buseireann: "BÉ",
	goahead: "GA",
};

export const BUS_OPERATOR_LABEL: Record<BusOperator, string> = {
	dublinbus: "Dublin Bus",
	buseireann: "Bus Éireann",
	goahead: "Go-Ahead",
};

export const STOP_SEARCH_DEBOUNCE_MS = 150;
export const STOP_SEARCH_CACHE_MAX = 50;
export const stopSearchCache = new Map<string, StopSearchResult[]>();

export function getBusDirections(busShape: BusShape): {
	[dir: string]: string;
} {
	if (!busShape) return {};
	const heads: { [dir: string]: string } = {};
	for (const dir of Object.keys(busShape)) {
		heads[dir] = busShape[dir]?.headsign || dir;
	}
	return heads;
}

export function filterBusRoutes(
	routes: RouteWithOperator[],
	query: string,
): RouteWithOperator[] {
	const q = query.trim().toLowerCase();
	if (!q) return routes;
	return routes.filter(
		(r) =>
			r.shortName.toLowerCase().includes(q) ||
			r.longName.toLowerCase().includes(q),
	);
}

export function stopSearchCacheKey(query: string): string {
	return query.trim().toLowerCase();
}

export function rememberStopSearchResults(
	key: string,
	results: StopSearchResult[],
): void {
	if (stopSearchCache.has(key)) stopSearchCache.delete(key);
	stopSearchCache.set(key, results);
	if (stopSearchCache.size <= STOP_SEARCH_CACHE_MAX) return;
	const oldest = stopSearchCache.keys().next().value;
	if (oldest) stopSearchCache.delete(oldest);
}

export function displayEtaSeconds(
	etaSeconds: number,
	fetchedAt: number | null,
	clockNow: number,
): number {
	if (fetchedAt === null) return etaSeconds;
	const elapsedSec = Math.floor((clockNow - fetchedAt) / 1000);
	return Math.max(0, etaSeconds - elapsedSec);
}
