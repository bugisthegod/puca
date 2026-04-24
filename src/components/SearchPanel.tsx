import React, { useState, useEffect, useRef } from "react";
import type { Station, SearchResult } from "../types";
import { getStationsOnce } from "../stationsClient";
import FavStar from "./FavStar";
import { hasTrain, type Favorites, type TrainFavorite } from "../favorites";

// Collapse any text selection in the input to its end. Stops Android's
// Smart Text Selection from scanning highlighted text and surfacing the
// "Tap to see search results" Google popup over the UI.
function collapseSelection(e: { currentTarget: HTMLInputElement }): void {
  const input = e.currentTarget;
  if (input.selectionStart !== input.selectionEnd) {
    input.setSelectionRange(input.selectionEnd, input.selectionEnd);
  }
}

interface SearchPanelProps {
  onSearch: (codes: string[]) => void;
  onClear: () => void;
  onTrainSelect: (code: string) => void;
  favs: Favorites;
  onToggleTrain: (f: TrainFavorite) => void;
  defaultCollapsed?: boolean;
  onShowToast: (title: string, body?: string) => void;
}

export default function SearchPanel({ onSearch, onClear, onTrainSelect, favs, onToggleTrain, defaultCollapsed = false, onShowToast }: SearchPanelProps) {
  const saved = localStorage.getItem("search");
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
  const [searchedNames, setSearchedNames] = useState<{ from: string; to: string } | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
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
          setCollapsed(true);
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

  const currentList = focusedField === "from" ? filteredStations(fromQuery) : filteredStations(toQuery);

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, field: "from" | "to") {
    if (!focusedField) return;
    const list = currentList;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, list.length - 1));
      requestAnimationFrame(() => {
        dropdownRef.current?.querySelector(".highlighted")?.scrollIntoView({ block: "nearest" });
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      requestAnimationFrame(() => {
        dropdownRef.current?.querySelector(".highlighted")?.scrollIntoView({ block: "nearest" });
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
      const res = await fetch(`/api/trains/search?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`);
      const data: SearchResult[] = await res.json();
      setResults(data);
      const activeCodes = data.filter((r) => r.status !== "scheduled").map((r) => r.code);
      onSearch(activeCodes);
      localStorage.setItem("search", JSON.stringify({ from: f, to: t, fromQuery, toQuery }));
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
    localStorage.removeItem("search");
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

  function fmtTime(t: string): string {
    if (!t) return "—";
    return t.length > 5 ? t.slice(0, 5) : t;
  }

  return (
    <div id="search-panel" ref={panelRef} className={collapsed ? "collapsed" : ""}>
      {collapsed ? (
        <button className="search-fab" onClick={() => setCollapsed(false)} aria-label="Search" title="Search">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </button>
      ) : <>
      <div className="search-field">
        <input
          type="text"
          autoCorrect="off"
          autoCapitalize="none"
          spellcheck={false}
          placeholder="From station..."
          value={fromQuery}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setFromQuery(v);
            const match = stations.find((s) => s.name.toLowerCase() === v.toLowerCase());
            setFrom(match?.code ?? "");
          }}
          onFocus={() => setFocusedField("from")}
          onKeyDown={(e) => handleKeyDown(e, "from")}
          onSelect={collapseSelection}
        />
        {focusedField === "from" && (
          <ul className="station-dropdown" ref={dropdownRef}>
            {filteredStations(fromQuery).map((s, i) => (
              <li
                key={s.code}
                className={i === highlightIndex ? "highlighted" : ""}
                onMouseDown={() => selectStation("from", s)}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="swap-btn" onClick={handleSwap} title="Swap stations">
        ⇅
      </button>
      <div className="search-field">
        <input
          type="text"
          autoCorrect="off"
          autoCapitalize="none"
          spellcheck={false}
          placeholder="To station..."
          value={toQuery}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setToQuery(v);
            const match = stations.find((s) => s.name.toLowerCase() === v.toLowerCase());
            setTo(match?.code ?? "");
          }}
          onFocus={() => setFocusedField("to")}
          onKeyDown={(e) => handleKeyDown(e, "to")}
          onSelect={collapseSelection}
        />
        {focusedField === "to" && (
          <ul className="station-dropdown" ref={dropdownRef}>
            {filteredStations(toQuery).map((s, i) => (
              <li
                key={s.code}
                className={i === highlightIndex ? "highlighted" : ""}
                onMouseDown={() => selectStation("to", s)}
                onMouseEnter={() => setHighlightIndex(i)}
              >
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="search-actions">
        <button className="search-btn" onClick={() => handleSearchWith(from, to)} disabled={!from || !to || loading}>
          {loading ? "Searching..." : "Search"}
        </button>
        {(from || to || results !== null) && (
          <button className="search-btn clear-btn" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>
      {results !== null && (
        results.length > 0 ? (
          <div className="search-results">
            <div className="search-result-header">
              <span className="search-result-msg has-results">
                Found {results.length} train{results.length !== 1 ? "s" : ""}
              </span>
              {from && to && (
                <FavStar
                  active={hasTrain(favs, { from, to })}
                  onToggle={() => onToggleTrain({
                    from,
                    to,
                    fromName: searchedNames?.from ?? fromQuery.trim(),
                    toName: searchedNames?.to ?? toQuery.trim(),
                  })}
                />
              )}
            </div>
            <ul className="train-list">
              {results.map((r) => {
                const canFocus = r.status !== "scheduled";
                return (
                  <li
                    key={r.code}
                    className={`train-item train-item--${r.status}`}
                    onClick={() => {
                      if (!canFocus) {
                        onShowToast("Not on the map yet");
                        return;
                      }
                      onTrainSelect(r.code);
                      if (window.innerWidth <= 600) setCollapsed(true);
                    }}
                  >
                    <div className="train-item-header">
                      <span className="train-item-code">{r.code}</span>
                      <span className={`train-item-status train-item-status--${r.status}`}>
                        {r.status === "running" ? "Running" : r.status === "ready" ? "Ready" : "Scheduled"}
                      </span>
                    </div>
                    <div className="train-item-route">{r.origin} → {r.destination}</div>
                    <div className="train-item-times">
                      <span>{searchedNames?.from}: {fmtTime(r.fromDep)}</span>
                      <span className="train-item-arrow">→</span>
                      <span>{searchedNames?.to}: {fmtTime(r.toArr)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="search-result-header">
            <span className="search-result-msg no-results">No active trains on this route</span>
            {from && to && (
              <FavStar
                active={hasTrain(favs, { from, to })}
                onToggle={() => onToggleTrain({
                  from,
                  to,
                  fromName: searchedNames?.from ?? fromQuery.trim(),
                  toName: searchedNames?.to ?? toQuery.trim(),
                })}
              />
            )}
          </div>
        )
      )}
      </>}
    </div>
  );
}
