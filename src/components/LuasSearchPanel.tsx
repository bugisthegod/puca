import React, { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { loadLuasSearchSession, saveLuasSearchSession } from "../session";
import type { LuasArrival, LuasStop } from "../types";
import { collapseSelection } from "../utils";
import FavStar from "./FavStar";

export type LuasStopSummary = {
	stopName: string;
	line: LuasStop["line"];
	emptyText: string | null;
	nextArrival: {
		routeShortName: string;
		headsign: string;
		etaText: string;
		departureTime: string;
	} | null;
};

type LuasSearchPanelProps = {
	stops: LuasStop[];
	selectedStopId: string | null;
	onStopIdChange: (stopId: string | null) => void;
	onStopSummaryChange: (summary: LuasStopSummary | null) => void;
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	isStopFavorite: (stop: LuasStop) => boolean;
	onToggleStopFavorite: (stop: LuasStop) => void;
};

function etaLabel(etaSeconds: number, t: ReturnType<typeof useLocale>["t"]) {
	if (etaSeconds < 60) return t("luas.search.eta.due");
	return t("luas.search.eta.min", { n: Math.round(etaSeconds / 60) });
}

function luasArrivalKey(arrival: LuasArrival): string {
	return [arrival.routeShortName, arrival.headsign, arrival.departureSec].join(
		"|",
	);
}

function LuasSearchPanel({
	stops,
	selectedStopId,
	onStopIdChange,
	onStopSummaryChange,
	collapsed,
	onCollapsedChange,
	isStopFavorite,
	onToggleStopFavorite,
}: LuasSearchPanelProps) {
	const { t } = useLocale();
	const [saved] = useState(() => loadLuasSearchSession());
	const [query, setQuery] = useState(saved.query ?? "");
	const [focused, setFocused] = useState(false);
	const [highlightIndex, setHighlightIndex] = useState(-1);
	const [arrivals, setArrivals] = useState<LuasArrival[] | null>(null);
	const [arrivalsLoading, setArrivalsLoading] = useState(false);
	const [arrivalsError, setArrivalsError] = useState<string | null>(null);
	const [arrivalsFetchedAt, setArrivalsFetchedAt] = useState<number | null>(
		null,
	);
	const [selectedArrivalKey, setSelectedArrivalKey] = useState<string | null>(
		null,
	);
	const [clockNow, setClockNow] = useState(() => Date.now());
	const panelRef = useRef<HTMLDivElement>(null);
	const arrivalsAbortRef = useRef<AbortController | null>(null);

	const selectedStop = stops.find((stop) => stop.id === selectedStopId) ?? null;
	const normalizedQuery = query.trim().toLowerCase();
	const filteredStops = normalizedQuery
		? stops
				.filter((stop) => stop.name.toLowerCase().includes(normalizedQuery))
				.slice(0, 10)
		: stops.slice(0, 10);

	useEffect(() => {
		saveLuasSearchSession({ stopId: selectedStopId, query });
	}, [query, selectedStopId]);

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
	}, [onCollapsedChange]);

	useEffect(() => {
		if (!arrivals || arrivals.length === 0) return;
		const id = setInterval(() => setClockNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, [arrivals]);

	const fetchArrivals = React.useCallback(
		async (stopId: string) => {
			arrivalsAbortRef.current?.abort();
			const ac = new AbortController();
			arrivalsAbortRef.current = ac;
			setArrivalsLoading(true);
			setArrivalsError(null);
			try {
				const res = await fetch(
					`/api/luas/stop/${encodeURIComponent(stopId)}/arrivals`,
					{ signal: ac.signal },
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data: LuasArrival[] = await res.json();
				if (!ac.signal.aborted) {
					const now = Date.now();
					setArrivals(data);
					setArrivalsFetchedAt(now);
					setClockNow(now);
					setSelectedArrivalKey((key) =>
						key && data.some((arrival) => luasArrivalKey(arrival) === key)
							? key
							: null,
					);
				}
			} catch (err) {
				if ((err as Error).name === "AbortError") return;
				setArrivals(null);
				setArrivalsFetchedAt(null);
				setArrivalsError(t("luas.search.arrivals.error"));
			} finally {
				if (arrivalsAbortRef.current === ac) setArrivalsLoading(false);
			}
		},
		[t],
	);

	useEffect(() => {
		if (!selectedStopId) {
			setArrivals(null);
			setArrivalsFetchedAt(null);
			setArrivalsError(null);
			setSelectedArrivalKey(null);
			onStopSummaryChange(null);
			return;
		}
		setArrivals(null);
		setArrivalsFetchedAt(null);
		setArrivalsError(null);
		setSelectedArrivalKey(null);
		fetchArrivals(selectedStopId);
		const id = setInterval(() => fetchArrivals(selectedStopId), 30_000);
		return () => {
			clearInterval(id);
			arrivalsAbortRef.current?.abort();
		};
	}, [selectedStopId, fetchArrivals, onStopSummaryChange]);

	useEffect(() => {
		if (!selectedStop) {
			onStopSummaryChange(null);
			return;
		}
		const selectedArrival =
			selectedArrivalKey && arrivals
				? (arrivals.find(
						(arrival) => luasArrivalKey(arrival) === selectedArrivalKey,
					) ?? null)
				: null;
		const next = selectedArrival ?? arrivals?.[0] ?? null;
		const elapsed =
			arrivalsFetchedAt === null
				? 0
				: Math.floor((clockNow - arrivalsFetchedAt) / 1000);
		onStopSummaryChange({
			stopName: selectedStop.name,
			line: selectedStop.line,
			emptyText:
				arrivalsError ??
				(arrivalsLoading || arrivals === null
					? t("luas.search.arrivals.loading")
					: t("luas.search.arrivals.empty")),
			nextArrival: next
				? {
						routeShortName: next.routeShortName,
						headsign: next.headsign,
						etaText: etaLabel(Math.max(0, next.etaSeconds - elapsed), t),
						departureTime: next.departureTime,
					}
				: null,
		});
	}, [
		arrivals,
		arrivalsError,
		arrivalsFetchedAt,
		arrivalsLoading,
		clockNow,
		onStopSummaryChange,
		selectedArrivalKey,
		selectedStop,
		t,
	]);

	function selectStop(stop: LuasStop) {
		setQuery("");
		setFocused(false);
		setHighlightIndex(-1);
		setSelectedArrivalKey(null);
		onStopIdChange(stop.id);
	}

	function handleClear() {
		setQuery("");
		setFocused(false);
		setHighlightIndex(-1);
		setSelectedArrivalKey(null);
		onStopIdChange(null);
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (!focused) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlightIndex((i) => Math.min(i + 1, filteredStops.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlightIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const stop = filteredStops[highlightIndex] ?? filteredStops[0];
			if (stop) selectStop(stop);
		} else if (e.key === "Escape") {
			setFocused(false);
		}
	}

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
					aria-label={t("luas.search.fab.aria")}
					title={t("luas.search.fab.aria")}
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
					{!selectedStop && (
						<div className="search-field">
							<input
								type="text"
								autoCorrect="off"
								autoCapitalize="none"
								spellcheck={false}
								inputMode="search"
								placeholder={t("luas.search.placeholder")}
								value={query}
								onChange={(e) => {
									setQuery(e.currentTarget.value);
									setHighlightIndex(-1);
								}}
								onFocus={() => {
									setFocused(true);
									setHighlightIndex(-1);
								}}
								onKeyDown={handleKeyDown}
								onSelect={collapseSelection}
							/>
							{focused && (
								<ul className="station-dropdown luas-stop-results">
									{filteredStops.length === 0 ? (
										<li className="search-empty">{t("luas.search.empty")}</li>
									) : (
										filteredStops.map((stop, i) => (
											<li
												key={stop.id}
												className={`luas-stop-result luas-stop-result--${stop.line}${i === highlightIndex ? " highlighted" : ""}`}
												onMouseDown={() => selectStop(stop)}
												onMouseEnter={() => setHighlightIndex(i)}
											>
												<strong>{stop.name}</strong>
												<span>{t(`luas.line.${stop.line}`)}</span>
											</li>
										))
									)}
								</ul>
							)}
						</div>
					)}
					{selectedStop && (
						<>
							<div
								className={`luas-stop-selected luas-stop-selected--${selectedStop.line}`}
							>
								<div className="luas-stop-selected__text">
									<strong>{selectedStop.name}</strong>
								</div>
								<FavStar
									active={isStopFavorite(selectedStop)}
									onToggle={() => onToggleStopFavorite(selectedStop)}
								/>
								<button
									type="button"
									className="search-btn clear-btn"
									onClick={handleClear}
								>
									{t("luas.search.btn.change")}
								</button>
							</div>
							<div className="stop-arrivals">
								{arrivalsLoading && arrivals === null && (
									<div className="stop-arrivals__empty">
										{t("luas.search.arrivals.loading")}
									</div>
								)}
								{arrivalsError && (
									<div className="stop-arrivals__empty">{arrivalsError}</div>
								)}
								{arrivals && arrivals.length === 0 && (
									<div className="stop-arrivals__empty">
										{t("luas.search.arrivals.empty")}
									</div>
								)}
								{arrivals && arrivals.length > 0 && (
									<ul className="stop-arrivals__list">
										{arrivals.map((arrival) => {
											const elapsed =
												arrivalsFetchedAt === null
													? 0
													: Math.floor((clockNow - arrivalsFetchedAt) / 1000);
											const key = luasArrivalKey(arrival);
											const isSelected =
												selectedArrivalKey === null
													? arrival === arrivals[0]
													: selectedArrivalKey === key;
											return (
												<li key={key}>
													<button
														type="button"
														className={`stop-arrival stop-arrival--luas${isSelected ? " stop-arrival--selected" : ""}`}
														aria-current={isSelected ? "true" : undefined}
														onClick={() => setSelectedArrivalKey(key)}
													>
														<span className="stop-arrival__route">
															{arrival.routeShortName}
														</span>
														<span className="stop-arrival__headsign">
															{arrival.headsign}
														</span>
														<span className="stop-arrival__eta">
															{etaLabel(
																Math.max(0, arrival.etaSeconds - elapsed),
																t,
															)}
														</span>
													</button>
												</li>
											);
										})}
									</ul>
								)}
							</div>
						</>
					)}
				</>
			)}
		</div>
	);
}

export default React.memo(LuasSearchPanel);
