import React, { useEffect, useRef, useState } from "react";
import { type Favorites, hasTrain, type TrainFavorite } from "../favorites";
import type { FocusTrainResult } from "../hooks/useTrainMarkers";
import { useLocale } from "../i18n";
import { getStationsOnce } from "../stationsClient";
import type { SearchResult, Station } from "../types";
import { collapseSelection, fmtTime } from "../utils";
import FavStar from "./FavStar";

interface SearchPanelProps {
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
	const [results, setResults] = useState<SearchResult[] | null>(null);
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
			setResults(data);
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
										const canFocus =
											r.status === "running" || r.status === "ready";
										return (
											<li
												key={r.code}
												className={`train-item train-item--${r.status}`}
												role="button"
												tabIndex={0}
												onClick={async () => {
													if (!canFocus) {
														onShowToast(t("train.toast.notonmap.title"));
														return;
													}
													const result = await onTrainSelect(r.code, from);
													if (result === "unavailable") {
														onShowToast(t("train.toast.notonmap.title"));
														return;
													}
													if (result === "cancelled") return;
													if (window.innerWidth <= 600) onCollapsedChange(true);
												}}
												onKeyDown={async (e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														if (!canFocus) {
															onShowToast(t("train.toast.notonmap.title"));
															return;
														}
														const result = await onTrainSelect(r.code, from);
														if (result === "unavailable") {
															onShowToast(t("train.toast.notonmap.title"));
															return;
														}
														if (result === "cancelled") return;
														if (window.innerWidth <= 600)
															onCollapsedChange(true);
													}
												}}
											>
												<div className="train-item-header">
													<span className="train-item-code">{r.code}</span>
													<span
														className={`train-item-status train-item-status--${r.status}`}
													>
														{r.status === "running"
															? t("train.status.running")
															: r.status === "ready"
																? t("train.status.ready")
																: r.status === "unmapped"
																	? t("train.status.unmapped")
																	: t("train.status.scheduled")}
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
