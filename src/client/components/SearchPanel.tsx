import React, { useEffect, useRef, useState } from "react";
import type { SearchResult, Station } from "../../types";
import {
	collapseSelection,
	dublinSecondsSinceMidnight,
	fmtTime,
} from "../../utils";
import { type Favorites, hasTrain, type TrainFavorite } from "../favorites";
import type { FocusTrainResult } from "../hooks/useTrainMarkers";
import { useLocale } from "../i18n";
import { getStationsOnce } from "../stationsClient";
import FavStar from "./FavStar";

const DEPARTURE_GRACE_SECONDS = 10 * 60;
const DAY_SECONDS = 24 * 60 * 60;

export function departureWarningAt(
	result: Pick<SearchResult, "status" | "fromDep">,
	receivedAt: number,
): number | null {
	if (result.status !== "scheduled") return null;
	const time = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(
		result.fromDep.trim(),
	);
	if (!time) return null;
	const departure =
		Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0);
	// Irish Rail also uses midnight as a placeholder for missing departures.
	if (departure === 0) return null;
	const delta = departure - dublinSecondsSinceMidnight(new Date(receivedAt));
	// Results cover a short window around the search. Resolve the clock time
	// to the nearest day once, so a result left open won't wrap to tomorrow.
	const offset = ((delta + DAY_SECONDS * 1.5) % DAY_SECONDS) - DAY_SECONDS / 2;
	return (
		Math.floor(receivedAt / 1000) * 1000 +
		(offset + DEPARTURE_GRACE_SECONDS) * 1000
	);
}

type DisplaySearchResult = SearchResult & { warningAt: number | null };

interface SearchPanelProps {
	clockNow: number;
	onSearch: (codes: string[]) => void;
	onClear: () => void;
	onTrainSelect: (
		code: string,
		boardingStationCode?: string,
	) => Promise<FocusTrainResult>;
	favs: Favorites;
	onToggleTrain: (f: TrainFavorite) => void;
	collapsed: boolean;
	onCollapsedChange: (collapsed: boolean) => void;
	onShowToast: (title: string, body?: string) => void;
	onSearchIntent: () => void;
}

function SearchPanel({
	clockNow,
	onSearch,
	onClear,
	onTrainSelect,
	favs,
	onToggleTrain,
	collapsed,
	onCollapsedChange,
	onShowToast,
	onSearchIntent,
}: SearchPanelProps) {
	const { t } = useLocale();
	const saved = sessionStorage.getItem("search");
	const init = saved ? JSON.parse(saved) : null;

	const [stations, setStations] = useState<Station[]>([]);
	const [from, setFrom] = useState(init?.from ?? "");
	const [to, setTo] = useState(init?.to ?? "");
	const [fromQuery, setFromQuery] = useState(init?.fromQuery ?? "");
	const [toQuery, setToQuery] = useState(init?.toQuery ?? "");
	const [focusedField, setFocusedField] = useState<"from" | "to" | null>(null);
	const [highlightIndex, setHighlightIndex] = useState(-1);
	const [loading, setLoading] = useState(false);
	const [results, setResults] = useState<DisplaySearchResult[] | null>(null);
	// Snapshot of station names at search time — so the rendered result rows
	// don't shift when the user edits the input after searching.
	const [searchedNames, setSearchedNames] = useState<{
		from: string;
		to: string;
	} | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const dropdownRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		getStationsOnce().then(setStations);
		// Re-run search if we had saved state
		if (init?.from && init?.to) {
			handleSearchWith(init.from, init.to);
		}
	}, []);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				setFocusedField(null);
				// Auto-collapse on mobile only when tapping the map
				const target = e.target as HTMLElement;
				if (window.innerWidth <= 600 && target.closest("#map")) {
					onCollapsedChange(true);
				}
			}
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	useEffect(() => {
		setHighlightIndex(-1);
	}, [fromQuery, toQuery, focusedField]);

	const filteredStations = (query: string) => {
		if (!query.trim()) return stations;
		const q = query.toLowerCase();
		return stations.filter((s) => s.name.toLowerCase().includes(q));
	};

	const currentList =
		focusedField === "from"
			? filteredStations(fromQuery)
			: filteredStations(toQuery);

	function selectStation(field: "from" | "to", station: Station) {
		if (field === "from") {
			setFrom(station.code);
			setFromQuery(station.name);
		} else {
			setTo(station.code);
			setToQuery(station.name);
		}
		setFocusedField(null);
		setHighlightIndex(-1);
	}

	function handleKeyDown(
		e: React.KeyboardEvent<HTMLInputElement>,
		field: "from" | "to",
	) {
		if (!focusedField) return;
		const list = currentList;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlightIndex((i) => Math.min(i + 1, list.length - 1));
			requestAnimationFrame(() => {
				dropdownRef.current
					?.querySelector(".highlighted")
					?.scrollIntoView({ block: "nearest" });
			});
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlightIndex((i) => Math.max(i - 1, 0));
			requestAnimationFrame(() => {
				dropdownRef.current
					?.querySelector(".highlighted")
					?.scrollIntoView({ block: "nearest" });
			});
		} else if (e.key === "Enter") {
			e.preventDefault();
			const selected = list[highlightIndex];
			if (selected) {
				selectStation(field, selected);
			}
		} else if (e.key === "Escape") {
			setFocusedField(null);
		} else if (e.key === "Tab") {
			const tabSelected = list[highlightIndex];
			if (tabSelected) {
				e.preventDefault();
				selectStation(field, tabSelected);
			} else {
				setFocusedField(null);
			}
		}
	}

	async function handleSearchWith(f: string, t: string) {
		setLoading(true);
		setSearchedNames({ from: fromQuery.trim(), to: toQuery.trim() });
		try {
			const res = await fetch(
				`/api/trains/search?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`,
			);
			const data: SearchResult[] = await res.json();
			const receivedAt = Date.now();
			setResults(
				data.map((result) => ({
					...result,
					warningAt: departureWarningAt(result, receivedAt),
				})),
			);
			const activeCodes = data
				.filter((r) => r.status === "running" || r.status === "ready")
				.map((r) => r.code);
			onSearch(activeCodes);
			sessionStorage.setItem(
				"search",
				JSON.stringify({ from: f, to: t, fromQuery, toQuery }),
			);
		} catch {
			setResults([]);
			onSearch([]);
		} finally {
			setLoading(false);
		}
	}

	function handleClear() {
		setFrom("");
		setTo("");
		setFromQuery("");
		setToQuery("");
		setResults(null);
		setSearchedNames(null);
		sessionStorage.removeItem("search");
		onClear();
	}

	function handleSwap() {
		setFrom(to);
		setTo(from);
		setFromQuery(toQuery);
		setToQuery(fromQuery);
		setResults(null);
		setSearchedNames(null);
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
					onClick={() => {
						onSearchIntent();
						onCollapsedChange(false);
					}}
					aria-label={t("train.search.fab.aria")}
					title={t("train.search.fab.aria")}
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
					<div className="search-field">
						<input
							type="text"
							autoCorrect="off"
							autoCapitalize="none"
							spellcheck={false}
							placeholder={t("train.search.placeholder.from")}
							value={fromQuery}
							onChange={(e) => {
								const v = e.currentTarget.value;
								setFromQuery(v);
								const match = stations.find(
									(s) => s.name.toLowerCase() === v.toLowerCase(),
								);
								setFrom(match?.code ?? "");
							}}
							onFocus={() => setFocusedField("from")}
							onKeyDown={(e) => handleKeyDown(e, "from")}
							onSelect={collapseSelection}
						/>
						{focusedField === "from" &&
							(currentList.length > 0 || fromQuery.trim()) && (
								<ul className="station-dropdown" ref={dropdownRef}>
									{currentList.length > 0 ? (
										currentList.map((s, i) => (
											<li
												key={s.code}
												className={i === highlightIndex ? "highlighted" : ""}
												onMouseDown={() => selectStation("from", s)}
												onMouseEnter={() => setHighlightIndex(i)}
											>
												{s.name}
											</li>
										))
									) : (
										<li className="search-empty">
											{t("train.search.station.empty")}
										</li>
									)}
								</ul>
							)}
					</div>
					<button
						type="button"
						className="swap-btn"
						onClick={handleSwap}
						title={t("train.search.swap.title")}
					>
						⇅
					</button>
					<div className="search-field">
						<input
							type="text"
							autoCorrect="off"
							autoCapitalize="none"
							spellcheck={false}
							placeholder={t("train.search.placeholder.to")}
							value={toQuery}
							onChange={(e) => {
								const v = e.currentTarget.value;
								setToQuery(v);
								const match = stations.find(
									(s) => s.name.toLowerCase() === v.toLowerCase(),
								);
								setTo(match?.code ?? "");
							}}
							onFocus={() => setFocusedField("to")}
							onKeyDown={(e) => handleKeyDown(e, "to")}
							onSelect={collapseSelection}
						/>
						{focusedField === "to" &&
							(currentList.length > 0 || toQuery.trim()) && (
								<ul className="station-dropdown" ref={dropdownRef}>
									{currentList.length > 0 ? (
										currentList.map((s, i) => (
											<li
												key={s.code}
												className={i === highlightIndex ? "highlighted" : ""}
												onMouseDown={() => selectStation("to", s)}
												onMouseEnter={() => setHighlightIndex(i)}
											>
												{s.name}
											</li>
										))
									) : (
										<li className="search-empty">
											{t("train.search.station.empty")}
										</li>
									)}
								</ul>
							)}
					</div>
					<div className="search-actions">
						<button
							type="button"
							className="search-btn"
							onClick={() => {
								onSearchIntent();
								handleSearchWith(from, to);
							}}
							disabled={!from || !to || loading}
						>
							{loading
								? t("train.search.btn.searching")
								: t("train.search.btn.search")}
						</button>
						{(from || to || results !== null) && (
							<button
								type="button"
								className="search-btn clear-btn"
								onClick={handleClear}
							>
								{t("train.search.btn.clear")}
							</button>
						)}
					</div>
					{results !== null &&
						(results.length > 0 ? (
							<div className="search-results">
								<div className="search-result-header">
									<span className="search-result-msg has-results">
										{results.length === 1
											? t("train.search.results.found.one")
											: t("train.search.results.found.many", {
													n: results.length,
												})}
									</span>
									{from && to && (
										<FavStar
											active={hasTrain(favs, { from, to })}
											onToggle={() =>
												onToggleTrain({
													from,
													to,
													fromName: searchedNames?.from ?? fromQuery.trim(),
													toName: searchedNames?.to ?? toQuery.trim(),
												})
											}
										/>
									)}
								</div>
								<ul className="train-list">
									{results.map((r) => {
										const status =
											r.warningAt !== null && clockNow >= r.warningAt
												? "unconfirmed"
												: r.status;
										async function selectTrain() {
											if (status === "scheduled") {
												onShowToast(
													t("train.toast.noLocation.title"),
													t("train.toast.scheduled.body"),
												);
												return;
											}
											if (status === "unconfirmed") {
												onShowToast(
													t("train.status.unconfirmed"),
													t("train.search.departure.unconfirmed"),
												);
												return;
											}
											if (status === "unmapped") {
												onShowToast(
													t("train.toast.noLocation.title"),
													t("train.toast.unmapped.body"),
												);
												return;
											}

											const result = await onTrainSelect(r.code, from);
											if (result === "unavailable") {
												onShowToast(t("train.toast.noLocation.title"));
											} else if (
												result === "focused" &&
												window.innerWidth <= 600
											) {
												onCollapsedChange(true);
											}
										}
										return (
											<li
												key={r.code}
												className={`train-item train-item--${status}`}
												role="button"
												tabIndex={0}
												onClick={selectTrain}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														void selectTrain();
													}
												}}
											>
												<div className="train-item-header">
													<span className="train-item-code">{r.code}</span>
													<span
														className={`train-item-status train-item-status--${status}`}
													>
														{t(`train.status.${status}`)}
													</span>
												</div>
												<div className="train-item-route">
													{r.origin} → {r.destination}
												</div>
												<div className="train-item-times">
													<span>
														{searchedNames?.from}: {fmtTime(r.fromDep)}
													</span>
													<span className="train-item-arrow">→</span>
													<span>
														{searchedNames?.to}: {fmtTime(r.toArr)}
													</span>
												</div>
												{status === "unconfirmed" && (
													<div className="train-item-warning">
														{t("train.search.departure.unconfirmed")}
													</div>
												)}
											</li>
										);
									})}
								</ul>
							</div>
						) : (
							<div className="search-result-header">
								<span className="search-result-msg no-results">
									{t("train.search.results.empty")}
								</span>
								{from && to && (
									<FavStar
										active={hasTrain(favs, { from, to })}
										onToggle={() =>
											onToggleTrain({
												from,
												to,
												fromName: searchedNames?.from ?? fromQuery.trim(),
												toName: searchedNames?.to ?? toQuery.trim(),
											})
										}
									/>
								)}
							</div>
						))}
				</>
			)}
		</div>
	);
}

export default React.memo(SearchPanel);
