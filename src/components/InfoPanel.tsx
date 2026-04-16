import React from "react";
import type { Filter } from "../utils";

interface InfoPanelProps {
  trainCount: number;
  lastUpdated: string;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  onRefresh: () => void;
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "dart", label: "DART" },
  { value: "commuter", label: "Commuter" },
  { value: "intercity", label: "Intercity" },
];

export default function InfoPanel({
  trainCount,
  lastUpdated,
  filter,
  onFilterChange,
  onRefresh,
}: InfoPanelProps) {
  return (
    <div id="info-panel">
      <div id="panel-header">
        <span id="train-count">{trainCount} trains running</span>
        <button id="refresh-btn" title="Refresh" onClick={onRefresh}>
          &#x21bb;
        </button>
      </div>
      <div id="last-updated">{lastUpdated}</div>
      <div id="filter-bar">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            className={`filter-btn${filter === value ? " active" : ""}`}
            onClick={() => onFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
