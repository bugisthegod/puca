import React, { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import {
	type BusSearchTab,
	loadBusSearchSession,
	saveBusSearchSession,
} from "../session";
import type { BusOperator, BusRoute, BusShape } from "../types";
import { collapseSelection } from "../utils";
import FavStar from "./FavStar";

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
	emptyText: string | null;
	nextArrival: {
		routeShortName: string;
		headsign: string;
		etaText: string;
		stopsAwayText: string | null;
	} | null;
};

export const BUS_SEARCH_OPERATORS: BusOperator[] = [
	"dublinbus",
	"buseireann",
	"goahead",
];
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

type UnifiedResult =
	| { kind: "route"; route: RouteWithOperator }
	| { kind: "stop"; stop: StopSearchResult };

export function displayEtaSeconds(
	etaSeconds: number,
	fetchedAt: number | null,
	clockNow: number,
): number {
	if (fetchedAt === null) return etaSeconds;
	const elapsedSec = Math.floor((clockNow - fetchedAt) / 1000);
	return Math.max(0, etaSeconds - elapsedSec);
}

type BusSearchPanelProps = {
	onSelectRoute: (shortName: string | null, operator?: BusOperator) => void;
	selectedRoute: string | null;
	onSelectDirection: (direction: string | null) => void;
	selectedDirection: string | null;
	busShape: BusShape;
	isFavorite: boolean;
	onToggleFavorite: () => void;
	busOperator: BusOperator;
	busSearchTab: BusSearchTab;
	onTabChange: (tab: BusSearchTab) => void;
	busStopId: string | null;
	busStopOperator: BusOperator | null;
	onStopIdChange: (stopId: string | null, operator: BusOperator | null) => void;
	onPickArrival: (
		arrival: StopArrival,
		operator: BusOperator,
		stop: StopSearchResult,
	) => void;
	isStopFavorite: (stop: StopSearchResult) => boolean;
	onToggleStopFavorite: (stop: StopSearchResult) => void;
	onStopSummaryChange: (summary: BusStopSummary | null) => void;
	focusedStopsAwayOverride: {
		tripId: string;
		stopsAway: number | null;
	} | null;
	arrivalFocusResetSignal: number;
	arrivalFocusStatus: "idle" | "pending" | "ok" | "unavailable";
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	onShowToast: (title: string, body?: string) => void;
};

function BusSearchPanel({
	onSelectRoute,
	selectedRoute,
	onSelectDirection,
	selectedDirection,
	busShape,
	isFavorite,
	onToggleFavorite,
	busSearchTab,
	onTabChange,
	busStopId,
	busStopOperator,
	onStopIdChange,
	onPickArrival,
	isStopFavorite,
	onToggleStopFavorite,
	onStopSummaryChange,
	focusedStopsAwayOverride,
	arrivalFocusResetSignal,
	arrivalFocusStatus,
	collapsed,
	onCollapsedChange,
	onShowToast,
}: BusSearchPanelProps) {
	const { locale, t } = useLocale();
	const [saved] = useState(() => loadBusSearchSession());
	const [routes, setRoutes] = useState<RouteWithOperator[]>([]);
	const [query, setQuery] = useState(
		saved.busSearchTab === "stop"
			? (saved.stopQuery ?? "")
			: (saved.routeQuery ?? ""),
	);
	const [focused, setFocused] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState(-1);
	const panelRef = useRef<HTMLDivElement>(null);
	const prevSelectedRouteRef = useRef(selectedRoute);

	// --- Stop-mode state ---
	const [stopQuery, setStopQuery] = useState(
		saved.busSearchTab === "stop"
			? (saved.stopQuery ?? "")
			: (saved.routeQuery ?? ""),
	);
	const [stopResults, setStopResults] = useState<StopSearchResult[]>([]);
	const [selectedStop, setSelectedStop] = useState<StopSearchResult | null>(
		null,
	);
	const [arrivals, setArrivals] = useState<StopArrival[] | null>(null);
	const [arrivalsLoading, setArrivalsLoading] = useState(false);
	const [arrivalsError, setArrivalsError] = useState<string | null>(null);
	const [arrivalsFetchedAt, setArrivalsFetchedAt] = useState<number | null>(
		null,
	);
	const [arrivalClockNow, setArrivalClockNow] = useState(() => Date.now());
	const [selectedArrivalTripId, setSelectedArrivalTripId] = useState<
		string | null
	>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all(
			BUS_SEARCH_OPERATORS.map((op) =>
				fetch(`/api/bus/routes?operator=${encodeURIComponent(op)}`)
					.then((r) => (r.ok ? r.json() : []))
					.then((data: BusRoute[]) => data.map((r) => ({ ...r, operator: op })))
					.catch(() => [] as RouteWithOperator[]),
			),
		).then((lists) => {
			if (!cancelled) setRoutes(lists.flat());
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (selectedRoute === null && prevSelectedRouteRef.current !== null) {
			setQuery("");
			setStopQuery("");
		}
		prevSelectedRouteRef.current = selectedRoute;
	}, [selectedRoute]);

	useEffect(() => {
		saveBusSearchSession({
			busRoute: selectedRoute,
			busDirection: selectedDirection,
			busSearchTab,
			busStopId,
			busStopOperator,
			routeQuery: query,
			stopQuery,
		});
	}, [
		selectedRoute,
		selectedDirection,
		busSearchTab,
		busStopId,
		busStopOperator,
		query,
		stopQuery,
	]);

	const directions = getBusDirections(busShape);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				setFocused(false);
				const target = e.target as HTMLElement;
				if (window.innerWidth <= 600 && target.closest("#map")) {
					onCollapsedChange(true);
				}
			}
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	// Debounced cross-operator stop search. Omits `operator=` so the backend
	// returns matches from all three fleets in one round-trip.
	useEffect(() => {
		if (selectedRoute || selectedStop || busStopId) return;
		const q = stopQuery.trim();
		if (!q) {
			setStopResults([]);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			fetch(`/api/bus/stops/search?q=${encodeURIComponent(q)}`)
				.then((r) => (r.ok ? r.json() : []))
				.then((data: StopSearchResult[]) => {
					if (!cancelled) setStopResults(data);
				})
				.catch(() => {
					if (!cancelled) setStopResults([]);
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [stopQuery, selectedRoute, selectedStop, busStopId]);

	// Abort controller for the in-flight arrivals fetch. Stop-switch + network
	// jitter can race: stop A's response arriving after stop B's would stamp A's
	// data into state while the panel shows B. Aborting the previous fetch on
	// every new call (and on effect cleanup) closes that window.
	const arrivalsAbortRef = useRef<AbortController | null>(null);

	const fetchArrivals = React.useCallback(
		async (stopId: string, operator: BusOperator) => {
			arrivalsAbortRef.current?.abort();
			const ac = new AbortController();
			arrivalsAbortRef.current = ac;
			setArrivalsLoading(true);
			setArrivalsError(null);
			try {
				const res = await fetch(
					`/api/bus/stop/${encodeURIComponent(stopId)}/arrivals?operator=${encodeURIComponent(operator)}`,
					{ signal: ac.signal },
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data: StopArrival[] = await res.json();
				if (!ac.signal.aborted) {
					const now = Date.now();
					setArrivals(data);
					setArrivalsFetchedAt(now);
					setArrivalClockNow(now);
				}
			} catch (err) {
				if ((err as Error).name === "AbortError") return;
				setArrivals(null);
				setArrivalsFetchedAt(null);
				setArrivalsError(t("bus.search.arrivals.error"));
			} finally {
				if (!ac.signal.aborted) setArrivalsLoading(false);
			}
		},
		[],
	);

	// Keep stop ETAs feeling alive between 30s fetches. The upstream TripUpdates
	// cadence stays unchanged; this only subtracts local elapsed time from the
	// last server-calculated ETA until the next fetch recalibrates it.
	useEffect(() => {
		if (!arrivals || arrivals.length === 0) return;
		const id = setInterval(() => setArrivalClockNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, [arrivals]);

	// Auto-refresh arrivals for the selected stop every 30s.
	// busStopId/busStopOperator guard: after a stop change, selectedStop is
	// briefly stale (still the previous pick) until rehydrate catches up.
	// Fetching with a stop_id that doesn't belong to that operator's fleet
	// would 404 — match both id and operator before firing.
	useEffect(() => {
		if (busSearchTab !== "stop" || !selectedStop) return;
		if (!busStopId || selectedStop.id !== busStopId) return;
		if (!busStopOperator || selectedStop.operator !== busStopOperator) return;
		const op = selectedStop.operator;
		fetchArrivals(selectedStop.id, op);
		const id = setInterval(() => fetchArrivals(selectedStop.id, op), 30_000);
		return () => {
			clearInterval(id);
			arrivalsAbortRef.current?.abort();
		};
	}, [busSearchTab, selectedStop, fetchArrivals, busStopId, busStopOperator]);

	// Rehydrate selected stop on mount / id change from session-provided stopId.
	// The stop carries its own operator now (cross-operator search), so we read
	// busStopOperator instead of falling back to the global busOperator.
	useEffect(() => {
		if (busSearchTab !== "stop") return;
		if (!busStopId || !busStopOperator) {
			setSelectedStop(null);
			setArrivals(null);
			return;
		}
		if (
			selectedStop &&
			selectedStop.id === busStopId &&
			selectedStop.operator === busStopOperator
		)
			return;
		// Rehydrate from a saved stopId — searchBusStops does an exact id match
		// as its first branch, so one tiny fetch round-trips the full metadata.
		// Clear if the stop no longer exists (e.g. operator removed it from GTFS).
		fetch(
			`/api/bus/stops/search?operator=${encodeURIComponent(busStopOperator)}&q=${encodeURIComponent(busStopId)}`,
		)
			.then((r) => (r.ok ? r.json() : []))
			.then((data: StopSearchResult[]) => {
				const match = data.find((s) => s.id === busStopId);
				if (match) setSelectedStop(match);
				else onStopIdChange(null, null);
			})
			.catch(() => onStopIdChange(null, null));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [busSearchTab, busStopId, busStopOperator]);

	const filtered = filterBusRoutes(routes, query);
	const routeResults = filtered.slice(0, 8);
	const unifiedResults: UnifiedResult[] = [
		...routeResults.map((route) => ({ kind: "route" as const, route })),
		...stopResults.map((stop) => ({ kind: "stop" as const, stop })),
	];

	function handleUnifiedQueryChange(value: string) {
		setQuery(value);
		setStopQuery(value);
		setHighlightIndex(-1);
		if (!value) {
			onSelectRoute(null);
			onSelectDirection(null);
			onStopIdChange(null, null);
		}
	}

	function selectRoute(r: RouteWithOperator) {
		setQuery(r.shortName);
		setStopQuery(r.shortName);
		setSelectedStop(null);
		setArrivals(null);
		setArrivalsFetchedAt(null);
		setSelectedArrivalTripId(null);
		onStopIdChange(null, null);
		onTabChange("route");
		onSelectRoute(r.shortName, r.operator);
		setFocused(false);
	}

	function handleDirectionPick(dir: string) {
		onSelectDirection(dir);
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (!focused) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlightIndex((i) => Math.min(i + 1, unifiedResults.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlightIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const result = unifiedResults[highlightIndex] ?? unifiedResults[0];
			if (result?.kind === "route") selectRoute(result.route);
			else if (result?.kind === "stop") selectStop(result.stop);
		} else if (e.key === "Escape") {
			setFocused(false);
		}
	}

	function handleClear() {
		setQuery("");
		setStopQuery("");
		setSelectedStop(null);
		setArrivals(null);
		setArrivalsFetchedAt(null);
		setSelectedArrivalTripId(null);
		onStopIdChange(null, null);
		onSelectRoute(null);
		onSelectDirection(null);
		setFocused(false);
	}

	function handleBackToDirections() {
		onSelectDirection(null);
	}

	function selectStop(s: StopSearchResult) {
		setSelectedStop(s);
		setArrivals(null);
		setArrivalsFetchedAt(null);
		setArrivalsError(null);
		setSelectedArrivalTripId(null);
		setStopQuery("");
		setQuery("");
		setStopResults([]);
		onTabChange("stop");
		onStopIdChange(s.id, s.operator);
	}

	function clearStopSelection() {
		setSelectedStop(null);
		setArrivals(null);
		setArrivalsFetchedAt(null);
		setSelectedArrivalTripId(null);
		setStopQuery("");
		setQuery("");
		onStopIdChange(null, null);
	}

	function etaLabel(etaSeconds: number): string {
		if (etaSeconds < 60) return t("bus.search.eta.due");
		const min = Math.round(etaSeconds / 60);
		return t("bus.search.eta.min", { n: min });
	}

	function stopsAwayLabel(stopsAway: number | null | undefined): string | null {
		if (stopsAway === null || stopsAway === undefined) return null;
		if (stopsAway === 0) return null;
		return t("bus.search.stops.away", { n: stopsAway });
	}

	useEffect(() => {
		setSelectedArrivalTripId(null);
	}, [arrivalFocusResetSignal]);

	useEffect(() => {
		if (busSearchTab !== "stop" || !selectedStop) {
			onStopSummaryChange(null);
			return;
		}
		const selectedArrival = selectedArrivalTripId
			? (arrivals?.find((a) => a.tripId === selectedArrivalTripId) ?? null)
			: null;
		const selectedArrivalMissing =
			selectedArrivalTripId !== null && arrivals !== null && !selectedArrival;
		const selectedArrivalUnavailable =
			selectedArrivalTripId !== null && arrivalFocusStatus === "unavailable";
		const selectedArrivalPending =
			selectedArrivalTripId !== null && arrivalFocusStatus === "pending";
		const next = selectedArrivalUnavailable
			? null
			: selectedArrivalPending
				? null
				: selectedArrivalTripId
					? selectedArrival
					: (arrivals?.[0] ?? null);
		const stopsAway =
			next &&
			selectedArrivalTripId &&
			focusedStopsAwayOverride?.tripId === next.tripId
				? focusedStopsAwayOverride.stopsAway
				: next?.stopsAway;
		const etaSeconds = next
			? displayEtaSeconds(next.etaSeconds, arrivalsFetchedAt, arrivalClockNow)
			: null;
		const etaText =
			stopsAway === 0
				? t("bus.search.eta.due")
				: stopsAway !== null && stopsAway !== undefined
					? etaSeconds !== null && etaSeconds >= 60
						? etaLabel(etaSeconds)
						: ""
					: etaSeconds !== null
						? etaLabel(etaSeconds)
						: "";
		onStopSummaryChange({
			stopCode: selectedStop.code || selectedStop.id,
			stopName: selectedStop.name,
			operator: selectedStop.operator,
			selected:
				selectedArrivalTripId !== null &&
				next?.tripId === selectedArrivalTripId,
			emptyText:
				selectedArrivalUnavailable || selectedArrivalMissing
					? t("bus.search.arrivals.maybePassed")
					: selectedArrivalPending
						? t("bus.search.arrivals.checking")
						: (arrivalsError ??
							(arrivalsLoading || arrivals === null
								? t("bus.search.arrivals.loading")
								: t("info.stop.noarrivals"))),
			nextArrival: next
				? {
						routeShortName: next.routeShortName,
						headsign: next.headsign,
						etaText,
						stopsAwayText: stopsAwayLabel(stopsAway),
					}
				: null,
		});
	}, [
		busSearchTab,
		selectedStop,
		arrivals,
		arrivalsError,
		arrivalsFetchedAt,
		arrivalsLoading,
		arrivalClockNow,
		arrivalFocusStatus,
		focusedStopsAwayOverride,
		selectedArrivalTripId,
		locale,
		onStopSummaryChange,
	]);

	return (
		<div
			id="search-panel"
			ref={panelRef}
			className={collapsed ? "collapsed" : ""}
		>
			{collapsed ? (
				<button
					type="button"
					className="fab search-fab"
					onClick={() => onCollapsedChange(false)}
					aria-label={t("bus.search.fab.aria")}
					title={t("bus.search.fab.aria")}
				>
					<svg
						viewBox="0 0 24 24"
						width="20"
						height="20"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<circle cx="11" cy="11" r="7" />
						<path d="M21 21l-4.3-4.3" />
					</svg>
				</button>
			) : (
				<>
					{!selectedRoute && !selectedStop && !busStopId && (
						<div className="search-field">
							<input
								type="text"
								autoCorrect="off"
								autoCapitalize="none"
								spellcheck={false}
								inputMode="search"
								placeholder={t("bus.search.placeholder.any")}
								value={query}
								onChange={(e) =>
									handleUnifiedQueryChange(e.currentTarget.value)
								}
								onFocus={() => {
									setFocused(true);
									setHighlightIndex(-1);
								}}
								onKeyDown={handleKeyDown}
								onSelect={collapseSelection}
							/>
							{focused && (unifiedResults.length > 0 || query.trim()) && (
								<div className="station-dropdown bus-unified-results">
									{routeResults.length > 0 && (
										<div className="bus-result-group">
											<div className="bus-result-heading">
												{t("bus.search.group.routes")}
											</div>
											<ul>
												{routeResults.map((r, i) => (
													<li
														key={`route:${r.operator}:${r.id}`}
														className={`route-result route-result--${r.operator}${i === highlightIndex ? " highlighted" : ""}`}
														onMouseDown={() => selectRoute(r)}
														onMouseEnter={() => setHighlightIndex(i)}
													>
														<strong>{r.shortName}</strong> — {r.longName}
														<span
															className={`operator-badge operator-badge--${r.operator}`}
															title={BUS_OPERATOR_LABEL[r.operator]}
														>
															{BUS_OPERATOR_INITIALS[r.operator]}
														</span>
													</li>
												))}
											</ul>
										</div>
									)}
									{stopResults.length > 0 && (
										<div className="bus-result-group">
											<div className="bus-result-heading">
												{t("bus.search.group.stops")}
											</div>
											<ul>
												{stopResults.map((s, i) => {
													const index = routeResults.length + i;
													return (
														<li
															key={`stop:${s.operator}:${s.id}`}
															className={`stop-result stop-result--${s.operator}${index === highlightIndex ? " highlighted" : ""}`}
															onMouseDown={() => selectStop(s)}
															onMouseEnter={() => setHighlightIndex(index)}
														>
															<strong>{s.code || s.id}</strong> — {s.name}
															<span
																className={`operator-badge operator-badge--${s.operator}`}
																title={BUS_OPERATOR_LABEL[s.operator]}
															>
																{BUS_OPERATOR_INITIALS[s.operator]}
															</span>
														</li>
													);
												})}
											</ul>
										</div>
									)}
									{unifiedResults.length === 0 && (
										<div className="search-empty">
											{t("bus.search.empty.any")}
										</div>
									)}
								</div>
							)}
						</div>
					)}
					{selectedRoute && (
						<>
							{selectedRoute && !selectedDirection && (
								<>
									{Object.keys(directions).length > 0 && (
										<div className="direction-buttons">
											{Object.entries(directions).map(([dir, headsign]) => (
												<button
													key={dir}
													type="button"
													className="direction-btn"
													onClick={() => handleDirectionPick(dir)}
												>
													&rarr; {headsign}
												</button>
											))}
										</div>
									)}
									<div className="search-actions">
										<button
											type="button"
											className="search-btn clear-btn"
											onClick={handleClear}
										>
											{t("bus.search.btn.change")}
										</button>
									</div>
								</>
							)}
							{selectedRoute && selectedDirection && (
								<div className="direction-status">
									<span>
										{t("bus.search.going", {
											dest: directions[selectedDirection] ?? selectedDirection,
										})}
									</span>
									<FavStar active={isFavorite} onToggle={onToggleFavorite} />
									<button
										type="button"
										className="search-btn clear-btn"
										onClick={handleBackToDirections}
									>
										{t("bus.search.btn.change")}
									</button>
								</div>
							)}
						</>
					)}
					{!selectedRoute && (
						<>
							{!selectedStop && busStopId ? (
								// Rehydrating from session/favorite — keep the bar occupied
								// with a dim placeholder so the panel doesn't flash "empty
								// search field" during the 100-300ms round-trip.
								<div className="stop-selected stop-selected--loading">
									<div className="stop-selected__text">
										<strong>…</strong>
										<span>{t("bus.search.loading.stop")}</span>
									</div>
								</div>
							) : selectedStop ? (
								<>
									<div
										className={`stop-selected stop-selected--${selectedStop.operator}`}
									>
										<div className="stop-selected__text">
											<strong>{selectedStop.code || selectedStop.id}</strong>
											<span>{selectedStop.name}</span>
										</div>
										<span
											className={`operator-badge operator-badge--${selectedStop.operator}`}
											title={BUS_OPERATOR_LABEL[selectedStop.operator]}
										>
											{BUS_OPERATOR_INITIALS[selectedStop.operator]}
										</span>
										<FavStar
											active={isStopFavorite(selectedStop)}
											onToggle={() => onToggleStopFavorite(selectedStop)}
										/>
										<button
											type="button"
											className="search-btn clear-btn"
											onClick={clearStopSelection}
										>
											{t("bus.search.btn.change")}
										</button>
									</div>
									<div className="stop-arrivals">
										{arrivalsLoading && arrivals === null && (
											<div className="stop-arrivals__empty">
												{t("bus.search.arrivals.loading")}
											</div>
										)}
										{arrivalsError && (
											<div className="stop-arrivals__empty">
												{arrivalsError}
											</div>
										)}
										{arrivals && arrivals.length === 0 && (
											<div className="stop-arrivals__empty">
												{t("bus.search.arrivals.empty")}
											</div>
										)}
										{arrivals && arrivals.length > 0 && (
											<ul className="stop-arrivals__list">
												{arrivals.map((a) => (
													<li key={a.tripId}>
														<button
															type="button"
															className={`stop-arrival${a.status === "scheduled" ? " stop-arrival--scheduled" : ""}`}
															onClick={() => {
																if (a.status === "scheduled") {
																	onShowToast(
																		t("bus.search.toast.notonmap.title"),
																	);
																	return;
																}
																setSelectedArrivalTripId(a.tripId);
																if (!selectedStop) return;
																onStopIdChange(
																	selectedStop.id,
																	selectedStop.operator,
																);
																onTabChange("stop");
																if (window.innerWidth <= 600)
																	onCollapsedChange(true);
																onPickArrival(
																	a,
																	selectedStop.operator,
																	selectedStop,
																);
															}}
														>
															<span className="stop-arrival__route">
																{a.routeShortName}
															</span>
															<span className="stop-arrival__headsign">
																{a.headsign}
															</span>
															<span
																className={`stop-arrival__eta${a.delaySec >= 300 ? " late" : ""}`}
															>
																{etaLabel(
																	displayEtaSeconds(
																		a.etaSeconds,
																		arrivalsFetchedAt,
																		arrivalClockNow,
																	),
																)}
															</span>
														</button>
													</li>
												))}
											</ul>
										)}
									</div>
								</>
							) : null}
						</>
					)}
				</>
			)}
		</div>
	);
}

export default React.memo(BusSearchPanel);
