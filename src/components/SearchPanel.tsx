import React, { useState, useEffect, useRef } from "react";
import type { Station, SearchResult } from "../types";
import { getStationsOnce } from "../stationsClient";

interface SearchPanelProps {
  onSearch: (codes: string[]) => void;
  onClear: () => void;
  onTrainSelect: (code: string) => void;
}

export default function SearchPanel({ onSearch, onClear, onTrainSelect }: SearchPanelProps) {
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
  const [collapsed, setCollapsed] = useState(false);
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
    localStorage.removeItem("search");
    onClear();
  }

  function handleSwap() {
    setFrom(to);
    setTo(from);
    setFromQuery(toQuery);
    setToQuery(fromQuery);
  }

  function fmtTime(t: string): string {
    if (!t) return "—";
    return t.length > 5 ? t.slice(0, 5) : t;
  }

  return (
    <div id="search-panel" ref={panelRef} className={collapsed ? "collapsed" : ""}>
      {collapsed ? (
        <button className="search-fab" onClick={() => setCollapsed(false)}>
          🔍
        </button>
      ) : <>
      <div className="search-field">
        <input
          type="text"
          placeholder="From station..."
          value={fromQuery}
          onChange={(e) => {
            setFromQuery(e.currentTarget.value);
            setFrom("");
          }}
          onFocus={() => setFocusedField("from")}
          onKeyDown={(e) => handleKeyDown(e, "from")}
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
          placeholder="To station..."
          value={toQuery}
          onChange={(e) => {
            setToQuery(e.currentTarget.value);
            setTo("");
          }}
          onFocus={() => setFocusedField("to")}
          onKeyDown={(e) => handleKeyDown(e, "to")}
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
        {results !== null && (
          <button className="search-btn clear-btn" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>
      {results !== null && (
        results.length > 0 ? (
          <div className="search-results">
            <div className="search-result-msg has-results">
              Found {results.length} train{results.length !== 1 ? "s" : ""}
            </div>
            <ul className="train-list">
              {results.map((r) => {
                const canFocus = r.status !== "scheduled";
                return (
                  <li
                    key={r.code}
                    className={`train-item train-item--${r.status}`}
                    onClick={() => {
                      if (!canFocus) return;
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
                      <span>{fromQuery}: {fmtTime(r.fromDep)}</span>
                      <span className="train-item-arrow">→</span>
                      <span>{toQuery}: {fmtTime(r.toArr)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="search-result-msg no-results">No active trains on this route</div>
        )
      )}
      </>}
    </div>
  );
}
