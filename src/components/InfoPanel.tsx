import React from "react";
import type { Filter } from "../utils";
import type { Mode } from "../hooks/useTrainMap";
import type { BusOperator } from "../types";

type InfoPanelProps = {
  vehicleCount: number;
  lastUpdated: string;
  mode: Mode;
  filter: Filter;
  inService: boolean;
  resumeLabel: string;
  busOperator: BusOperator;
  onModeChange: (m: Mode) => void;
  onFilterChange: (f: Filter) => void;
  onBusOperatorChange: (op: BusOperator) => void;
};

const MODES: { value: Mode; label: string }[] = [
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "dart", label: "DART" },
  { value: "commuter", label: "Commuter" },
  { value: "intercity", label: "Intercity" },
];

const BUS_OPERATORS: { value: BusOperator; label: string }[] = [
  { value: "dublinbus", label: "Dublin Bus" },
  { value: "buseireann", label: "Bus Éireann" },
  { value: "goahead", label: "Go-Ahead" },
];

export default function InfoPanel({
  vehicleCount,
  lastUpdated,
  mode,
  filter,
  inService,
  resumeLabel,
  busOperator,
  onModeChange,
  onFilterChange,
  onBusOperatorChange,
}: InfoPanelProps) {
  const unit = mode === "train" ? "trains" : "buses";
  const showCount = mode === "train" ? `${vehicleCount} ${unit} running` : `${vehicleCount} ${unit}`;

  return (
    <div id="info-panel">
      <div id="panel-header">
        <span id="train-count">
          {inService ? showCount : "Service closed"}
        </span>
      </div>
      <div id="last-updated">
        {inService ? lastUpdated : `Resumes at ${resumeLabel}`}
      </div>
      <div id="filter-bar">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            className={`filter-btn${mode === value ? " active" : ""}`}
            onClick={() => onModeChange(value)}
          >
            {label}
          </button>
        ))}
        {mode === "train" && (
          <>
            <span className="filter-sep" />
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                className={`filter-btn${filter === value ? " active" : ""}`}
                onClick={() => onFilterChange(value)}
              >
                {label}
              </button>
            ))}
          </>
        )}
        {mode === "bus" && (
          <>
            <span className="filter-sep" />
            {BUS_OPERATORS.map(({ value, label }) => (
              <button
                key={value}
                className={`filter-btn${busOperator === value ? " active" : ""}`}
                onClick={() => onBusOperatorChange(value)}
              >
                {label}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
