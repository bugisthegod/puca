import React, { useState } from "react";
import type { Filter } from "../utils";
import type { Mode } from "../hooks/useTrainMap";
import type { BusOperator } from "../types";
import SleepingPuca from "./SleepingPuca";

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
  const [drilledIn, setDrilledIn] = useState(false);
  const unit = mode === "train" ? "trains" : "buses";
  const showCount = `${vehicleCount} ${unit} running`;

  function handleModeClick(next: Mode) {
    onModeChange(next);
    setDrilledIn(true);
  }

  return (
    <div id="info-panel" className={drilledIn ? "" : "info-panel--compact"}>
      {drilledIn && (
        inService ? (
          <>
            <div id="panel-header">
              <span id="train-count">{showCount}</span>
            </div>
            <div id="last-updated">{lastUpdated}</div>
          </>
        ) : (
          <div id="panel-header" className="panel-header--closed">
            <SleepingPuca size={52} />
            <div className="service-text">
              <span id="train-count">Púca's having a kip</span>
              <span className="service-next">Next {mode} at {resumeLabel}</span>
            </div>
          </div>
        )
      )}
      <div id="filter-bar" className={drilledIn ? "" : "filter-bar--root"}>
        {!drilledIn && MODES.map(({ value, label }) => (
          <button
            key={value}
            className="filter-btn"
            onClick={() => handleModeClick(value)}
          >
            {label}
          </button>
        ))}
        {drilledIn && (
          <>
            <button
              type="button"
              className="filter-btn filter-back"
              onClick={() => setDrilledIn(false)}
              aria-label="Back"
            >
              ←
            </button>
            {inService && (
              <>
                <span className="filter-sep" />
                {mode === "train" && FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    className={`filter-btn${filter === value ? " active" : ""}`}
                    onClick={() => onFilterChange(value)}
                  >
                    {label}
                  </button>
                ))}
                {mode === "bus" && BUS_OPERATORS.map(({ value, label }) => (
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
          </>
        )}
      </div>
    </div>
  );
}
