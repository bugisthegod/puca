import React, { useState, useEffect, useMemo, useRef } from "react";
import type { BusRoute, BusOperator } from "../types";
import type { BusSearchTab } from "../session";
import FavStar from "./FavStar";
import { useLocale } from "../i18n";

// Collapse any text selection in the input to its end. Stops Android's
// Smart Text Selection from scanning highlighted text and surfacing the
// "Tap to see search results" Google popup over the UI.
function collapseSelection(e: { currentTarget: HTMLInputElement }): void {
  const input = e.currentTarget;
  if (input.selectionStart !== input.selectionEnd) {
    input.setSelectionRange(input.selectionEnd, input.selectionEnd);
  }
}

type RouteWithOperator = BusRoute & { operator: BusOperator };

type BusShape = { [dir: string]: { headsign: string } } | null;

type StopSearchResult = { id: string; name: string; code: string; lat: number; lng: number; operator: BusOperator };

type StopArrival = {
  tripId: string;
  routeShortName: string;
  headsign: string;
  etaSeconds: number;
  delaySec: number;
  stopSequence: number;
  direction: string;
  status: "running" | "scheduled";
};

const ALL_OPERATORS: BusOperator[] = ["dublinbus", "buseireann", "goahead"];
const OPERATOR_INITIALS: Record<BusOperator, string> = {
  dublinbus: "DB",
  buseireann: "BÉ",
  goahead: "GA",
};
const OPERATOR_LABEL: Record<BusOperator, string> = {
  dublinbus: "Dublin Bus",
  buseireann: "Bus Éireann",
  goahead: "Go-Ahead",
};

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
  onPickArrival: (arrival: StopArrival, operator: BusOperator, stop: StopSearchResult) => void;
  stopIsFavorite: boolean;
  onToggleStopFavorite: (stop: StopSearchResult) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onShowToast: (title: string, body?: string) => void;
};

export default function BusSearchPanel({
  onSelectRoute,
  selectedRoute,
  onSelectDirection,
  selectedDirection,
  busShape,
  isFavorite,
  onToggleFavorite,
  busOperator,
  busSearchTab,
  onTabChange,
  busStopId,
  busStopOperator,
  onStopIdChange,
  onPickArrival,
  stopIsFavorite,
  onToggleStopFavorite,
  collapsed,
  onCollapsedChange,
  onShowToast,
}: BusSearchPanelProps) {
  const { t } = useLocale();
  const [routes, setRoutes] = useState<RouteWithOperator[]>([]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const panelRef = useRef<HTMLDivElement>(null);

  // --- Stop-mode state ---
  const [stopQuery, setStopQuery] = useState("");
  const [stopFocused, setStopFocused] = useState(false);
  const [stopResults, setStopResults] = useState<StopSearchResult[]>([]);
  const [stopHighlightIndex, setStopHighlightIndex] = useState(-1);
  const [selectedStop, setSelectedStop] = useState<StopSearchResult | null>(null);
  const [arrivals, setArrivals] = useState<StopArrival[] | null>(null);
  const [arrivalsLoading, setArrivalsLoading] = useState(false);
  const [arrivalsError, setArrivalsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ALL_OPERATORS.map((op) =>
        fetch(`/api/bus/routes?operator=${encodeURIComponent(op)}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((data: BusRoute[]) => data.map((r) => ({ ...r, operator: op })))
          .catch(() => [] as RouteWithOperator[]),
      ),
    ).then((lists) => {
      if (!cancelled) setRoutes(lists.flat());
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedRoute) setQuery("");
  }, [selectedRoute]);

  const directions = useMemo<{ [dir: string]: string }>(() => {
    if (!busShape) return {};
    const heads: { [dir: string]: string } = {};
    for (const dir of Object.keys(busShape)) {
      heads[dir] = busShape[dir]?.headsign ?? dir;
    }
    return heads;
  }, [busShape]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setFocused(false);
        setStopFocused(false);
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
  }, [query, focused]);

  useEffect(() => {
    setStopHighlightIndex(-1);
  }, [stopQuery, stopFocused]);

  // Debounced cross-operator stop search. Omits `operator=` so the backend
  // returns matches from all three fleets in one round-trip.
  useEffect(() => {
    if (busSearchTab !== "stop") return;
    const q = stopQuery.trim();
    if (!q) { setStopResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/bus/stops/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data: StopSearchResult[]) => {
          if (!cancelled) setStopResults(data);
        })
        .catch(() => { if (!cancelled) setStopResults([]); });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [stopQuery, busSearchTab]);

  // Abort controller for the in-flight arrivals fetch. Stop-switch + network
  // jitter can race: stop A's response arriving after stop B's would stamp A's
  // data into state while the panel shows B. Aborting the previous fetch on
  // every new call (and on effect cleanup) closes that window.
  const arrivalsAbortRef = useRef<AbortController | null>(null);

  const fetchArrivals = React.useCallback(async (stopId: string, operator: BusOperator) => {
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
      if (!ac.signal.aborted) setArrivals(data);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setArrivals(null);
      setArrivalsError(t("bus.search.arrivals.error"));
    } finally {
      if (!ac.signal.aborted) setArrivalsLoading(false);
    }
  }, []);

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
    if (!busStopId || !busStopOperator) { setSelectedStop(null); setArrivals(null); return; }
    if (selectedStop && selectedStop.id === busStopId && selectedStop.operator === busStopOperator) return;
    // Rehydrate from a saved stopId — searchBusStops does an exact id match
    // as its first branch, so one tiny fetch round-trips the full metadata.
    // Clear if the stop no longer exists (e.g. operator removed it from GTFS).
    fetch(`/api/bus/stops/search?operator=${encodeURIComponent(busStopOperator)}&q=${encodeURIComponent(busStopId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: StopSearchResult[]) => {
        const match = data.find((s) => s.id === busStopId);
        if (match) setSelectedStop(match);
        else onStopIdChange(null, null);
      })
      .catch(() => onStopIdChange(null, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busSearchTab, busStopId, busStopOperator]);

  const filtered = query.trim()
    ? routes.filter(
        (r) =>
          r.shortName.toLowerCase().includes(query.toLowerCase()) ||
          r.longName.toLowerCase().includes(query.toLowerCase()),
      )
    : routes;

  function selectRoute(r: RouteWithOperator) {
    setQuery(r.shortName);
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
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = filtered[highlightIndex] ?? filtered[0];
      if (r) selectRoute(r);
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  }

  function handleClear() {
    setQuery("");
    onSelectRoute(null);
    onSelectDirection(null);
    setFocused(false);
  }

  function selectStop(s: StopSearchResult) {
    setSelectedStop(s);
    setStopQuery("");
    setStopFocused(false);
    setStopResults([]);
    onStopIdChange(s.id, s.operator);
  }

  function handleStopKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!stopFocused) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setStopHighlightIndex((i) => Math.min(i + 1, stopResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setStopHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = stopResults[stopHighlightIndex] ?? stopResults[0];
      if (s) selectStop(s);
    } else if (e.key === "Escape") {
      setStopFocused(false);
    }
  }

  function clearStopSelection() {
    setSelectedStop(null);
    setArrivals(null);
    setStopQuery("");
    onStopIdChange(null, null);
  }

  function etaLabel(etaSeconds: number): string {
    if (etaSeconds < 60) return t("bus.search.eta.due");
    const min = Math.round(etaSeconds / 60);
    return t("bus.search.eta.min", { n: min });
  }

  return (
    <div id="search-panel" ref={panelRef} className={collapsed ? "collapsed" : ""}>
      {collapsed ? (
        <button className="fab search-fab" onClick={() => onCollapsedChange(false)} aria-label={t("bus.search.fab.aria")} title={t("bus.search.fab.aria")}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </button>
      ) : (
        <>
          <div className="bus-search-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={busSearchTab === "route"}
              className={`bus-search-tab${busSearchTab === "route" ? " active" : ""}`}
              onClick={() => onTabChange("route")}
            >
              {t("bus.search.tab.route")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={busSearchTab === "stop"}
              className={`bus-search-tab${busSearchTab === "stop" ? " active" : ""}`}
              onClick={() => onTabChange("stop")}
            >
              {t("bus.search.tab.stop")}
            </button>
          </div>
          {busSearchTab === "route" ? (
            <>
              <div className="search-field">
                <input
                  type="text"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellcheck={false}
                  placeholder={t("bus.search.placeholder.route")}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.currentTarget.value);
                    if (!e.currentTarget.value) onSelectRoute(null);
                  }}
                  onFocus={() => setFocused(true)}
                  onKeyDown={handleKeyDown}
                  onSelect={collapseSelection}
                />
                {focused && filtered.length > 0 && (
                  <ul className="station-dropdown route-results">
                    {filtered.slice(0, 30).map((r, i) => (
                      <li
                        key={`${r.operator}:${r.id}`}
                        className={`route-result route-result--${r.operator}${i === highlightIndex ? " highlighted" : ""}`}
                        onMouseDown={() => selectRoute(r)}
                        onMouseEnter={() => setHighlightIndex(i)}
                      >
                        <strong>{r.shortName}</strong> — {r.longName}
                        <span
                          className={`operator-badge operator-badge--${r.operator}`}
                          title={OPERATOR_LABEL[r.operator]}
                          aria-label={OPERATOR_LABEL[r.operator]}
                        >
                          {OPERATOR_INITIALS[r.operator]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selectedRoute && !selectedDirection && Object.keys(directions).length > 0 && (
                <div className="direction-buttons">
                  {Object.entries(directions).map(([dir, headsign]) => (
                    <button
                      key={dir}
                      className="direction-btn"
                      onClick={() => handleDirectionPick(dir)}
                    >
                      &rarr; {headsign}
                    </button>
                  ))}
                </div>
              )}
              {selectedRoute && selectedDirection && (
                <div className="direction-status">
                  <span>{t("bus.search.going", { dest: directions[selectedDirection] ?? selectedDirection })}</span>
                  <FavStar active={isFavorite} onToggle={onToggleFavorite} />
                  <button className="search-btn clear-btn" onClick={() => onSelectDirection(null)}>
                    {t("bus.search.btn.change")}
                  </button>
                </div>
              )}
              {selectedRoute && (
                <div className="search-actions">
                  <button className="search-btn clear-btn" onClick={handleClear}>
                    {t("bus.search.btn.clear")}
                  </button>
                </div>
              )}
            </>
          ) : (
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
              ) : !selectedStop ? (
                <div className="search-field">
                  <input
                    type="text"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellcheck={false}
                    inputMode="search"
                    placeholder={t("bus.search.placeholder.stop")}
                    value={stopQuery}
                    onChange={(e) => setStopQuery(e.currentTarget.value)}
                    onFocus={() => setStopFocused(true)}
                    onKeyDown={handleStopKeyDown}
                    onSelect={collapseSelection}
                  />
                  {stopFocused && stopResults.length > 0 && (
                    <ul className="station-dropdown stop-results">
                      {stopResults.map((s, i) => (
                        <li
                          key={`${s.operator}:${s.id}`}
                          className={`stop-result stop-result--${s.operator}${i === stopHighlightIndex ? " highlighted" : ""}`}
                          onMouseDown={() => selectStop(s)}
                          onMouseEnter={() => setStopHighlightIndex(i)}
                        >
                          <strong>{s.code || s.id}</strong> — {s.name}
                          <span
                            className={`operator-badge operator-badge--${s.operator}`}
                            title={OPERATOR_LABEL[s.operator]}
                            aria-label={OPERATOR_LABEL[s.operator]}
                          >
                            {OPERATOR_INITIALS[s.operator]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <>
                  <div className={`stop-selected stop-selected--${selectedStop.operator}`}>
                    <div className="stop-selected__text">
                      <strong>{selectedStop.code || selectedStop.id}</strong>
                      <span>{selectedStop.name}</span>
                    </div>
                    <span
                      className={`operator-badge operator-badge--${selectedStop.operator}`}
                      title={OPERATOR_LABEL[selectedStop.operator]}
                      aria-label={OPERATOR_LABEL[selectedStop.operator]}
                    >
                      {OPERATOR_INITIALS[selectedStop.operator]}
                    </span>
                    <FavStar
                      active={stopIsFavorite}
                      onToggle={() => onToggleStopFavorite(selectedStop)}
                    />
                    <button className="search-btn clear-btn" onClick={clearStopSelection}>
                      {t("bus.search.btn.change")}
                    </button>
                  </div>
                  <div className="stop-arrivals">
                    {arrivalsLoading && arrivals === null && (
                      <div className="stop-arrivals__empty">{t("bus.search.arrivals.loading")}</div>
                    )}
                    {arrivalsError && (
                      <div className="stop-arrivals__empty">{arrivalsError}</div>
                    )}
                    {arrivals && arrivals.length === 0 && (
                      <div className="stop-arrivals__empty">{t("bus.search.arrivals.empty")}</div>
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
                                  onShowToast(t("bus.search.toast.notonmap.title"));
                                  return;
                                }
                                if (!selectedStop) return;
                                if (window.innerWidth <= 600) onCollapsedChange(true);
                                onPickArrival(a, busOperator, selectedStop);
                              }}
                            >
                              <span className="stop-arrival__route">{a.routeShortName}</span>
                              <span className="stop-arrival__headsign">{a.headsign}</span>
                              <span className={`stop-arrival__eta${a.delaySec >= 300 ? " late" : ""}`}>
                                {etaLabel(a.etaSeconds)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
