import React, { useState, useEffect, useMemo, useRef } from "react";
import type { BusRoute, BusOperator } from "../types";

type RouteWithOperator = BusRoute & { operator: BusOperator };

type BusShape = { [dir: string]: { headsign: string } } | null;

const ALL_OPERATORS: BusOperator[] = ["dublinbus", "buseireann", "goahead"];
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
};

export default function BusSearchPanel({
  onSelectRoute,
  selectedRoute,
  onSelectDirection,
  selectedDirection,
  busShape,
}: BusSearchPanelProps) {
  const [routes, setRoutes] = useState<RouteWithOperator[]>([]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch routes from all operators once so search spans every agency.
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

  // Clear the query input when the selected route is cleared externally.
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

  function selectRoute(r: RouteWithOperator) {
    setQuery(r.shortName);
    onSelectRoute(r.shortName, r.operator);
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
        <button className="search-fab" onClick={() => setCollapsed(false)} aria-label="Search" title="Search">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
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
                    key={`${r.operator}:${r.id}`}
                    className={i === highlightIndex ? "highlighted" : ""}
                    onMouseDown={() => selectRoute(r)}
                    onMouseEnter={() => setHighlightIndex(i)}
                  >
                    <strong>{r.shortName}</strong> — {r.longName}
                    <span className="route-operator-badge">{OPERATOR_LABEL[r.operator]}</span>
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
