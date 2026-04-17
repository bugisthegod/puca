import React, { useState, useEffect, useRef } from "react";
import type { BusRoute, BusOperator } from "../types";

type BusSearchPanelProps = {
  operator: BusOperator;
  onSelectRoute: (shortName: string | null) => void;
  selectedRoute: string | null;
  onSelectDirection: (direction: string | null) => void;
  selectedDirection: string | null;
};

export default function BusSearchPanel({
  operator,
  onSelectRoute,
  selectedRoute,
  onSelectDirection,
  selectedDirection,
}: BusSearchPanelProps) {
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [collapsed, setCollapsed] = useState(false);
  const [directions, setDirections] = useState<{ [dir: string]: string }>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Refetch routes when operator changes
  useEffect(() => {
    fetch(`/api/bus/routes?operator=${encodeURIComponent(operator)}`)
      .then((r) => r.json())
      .then((data: BusRoute[]) => setRoutes(data))
      .catch(() => {});
  }, [operator]);

  useEffect(() => {
    if (!selectedRoute) {
      setQuery("");
      setDirections({});
      return;
    }
    let cancelled = false;
    fetch(`/api/bus/shape/${encodeURIComponent(selectedRoute)}?operator=${encodeURIComponent(operator)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { [dir: string]: { headsign: string; coords: [number, number][] } } | null) => {
        if (cancelled || !data) return;
        const heads: { [dir: string]: string } = {};
        for (const dir of Object.keys(data)) {
          heads[dir] = data[dir]?.headsign ?? dir;
        }
        setDirections(heads);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedRoute, operator]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setFocused(false);
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
  }, [query, focused]);

  const filtered = query.trim()
    ? routes.filter(
        (r) =>
          r.shortName.toLowerCase().includes(query.toLowerCase()) ||
          r.longName.toLowerCase().includes(query.toLowerCase()),
      )
    : routes;

  function selectRoute(r: BusRoute) {
    setQuery(r.shortName);
    onSelectRoute(r.shortName);
    setFocused(false);
    // Don't collapse yet — user still needs to pick direction (handled below)
  }

  function handleDirectionPick(dir: string) {
    onSelectDirection(dir);
    if (window.innerWidth <= 600) setCollapsed(true);
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

  return (
    <div id="search-panel" ref={panelRef} className={collapsed ? "collapsed" : ""}>
      {collapsed ? (
        <button className="search-fab" onClick={() => setCollapsed(false)}>
          🔍
        </button>
      ) : (
        <>
          <div className="search-field">
            <input
              type="text"
              placeholder="Bus route (e.g. 39A, 7)..."
              value={query}
              onChange={(e) => {
                setQuery(e.currentTarget.value);
                if (!e.currentTarget.value) onSelectRoute(null);
              }}
              onFocus={() => setFocused(true)}
              onKeyDown={handleKeyDown}
            />
            {focused && filtered.length > 0 && (
              <ul className="station-dropdown">
                {filtered.slice(0, 30).map((r, i) => (
                  <li
                    key={r.id}
                    className={i === highlightIndex ? "highlighted" : ""}
                    onMouseDown={() => selectRoute(r)}
                    onMouseEnter={() => setHighlightIndex(i)}
                  >
                    <strong>{r.shortName}</strong> — {r.longName}
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
              <span>Going to {directions[selectedDirection] ?? selectedDirection}</span>
              <button className="search-btn clear-btn" onClick={() => onSelectDirection(null)}>
                Change
              </button>
            </div>
          )}
          {selectedRoute && (
            <div className="search-actions">
              <button className="search-btn clear-btn" onClick={handleClear}>
                Clear
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
