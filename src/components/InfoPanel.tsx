import React, { useState } from "react";
import type { Filter } from "../utils";
import type { Mode } from "../hooks/useTrainMap";
import type { BusOperator } from "../types";
import SleepingPuca from "./SleepingPuca";
import { useLocale } from "../i18n";

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

// Filter and operator labels stay in their original spelling — DART, Commuter,
// Intercity are Irish Rail product names; Dublin Bus / Bus Éireann / Go-Ahead
// are operator brand names. They aren't translated even when locale is zh.
export const INFO_FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "dart", label: "DART" },
  { value: "commuter", label: "Commuter" },
  { value: "intercity", label: "Intercity" },
];

export const INFO_BUS_OPERATORS: { value: BusOperator; label: string }[] = [
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
  const { t } = useLocale();
  const [drilledIn, setDrilledIn] = useState(false);
  const showCount = mode === "train"
    ? t("info.running.train", { n: vehicleCount })
    : t("info.running.bus", { n: vehicleCount });

  const modes: { value: Mode; label: string }[] = [
    { value: "train", label: t("info.mode.train") },
    { value: "bus", label: t("info.mode.bus") },
  ];
  // Only the "All" filter label is translated; DART/Commuter/Intercity stay original.
  const filters = INFO_FILTERS.map((f) => f.value === "all" ? { ...f, label: t("info.filter.all") } : f);

  function handleModeClick(next: Mode) {
    if (next !== mode) onModeChange(next);
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
            <button
              type="button"
              className="filter-btn filter-back"
              onClick={() => setDrilledIn(false)}
              aria-label={t("info.back.aria")}
            >
              ←
            </button>
            <SleepingPuca size={52} />
            <div className="service-text">
              <span id="train-count">{t("info.kip")}</span>
              <span className="service-next">
                {mode === "train"
                  ? t("info.next.train", { time: resumeLabel })
                  : t("info.next.bus", { time: resumeLabel })}
              </span>
            </div>
          </div>
        )
      )}
      <div id="filter-bar" className={drilledIn ? "" : "filter-bar--root"}>
        {!drilledIn && modes.map(({ value, label }) => (
          <button
            key={value}
            className="filter-btn"
            onClick={() => handleModeClick(value)}
          >
            {label}
          </button>
        ))}
        {drilledIn && inService && (
          <>
            <button
              type="button"
              className="filter-btn filter-back"
              onClick={() => setDrilledIn(false)}
              aria-label={t("info.back.aria")}
            >
              ←
            </button>
            <span className="filter-sep" />
            {mode === "train" && filters.map(({ value, label }) => (
              <button
                key={value}
                className={`filter-btn${filter === value ? " active" : ""}`}
                onClick={() => onFilterChange(value)}
              >
                {label}
              </button>
            ))}
            {mode === "bus" && INFO_BUS_OPERATORS.map(({ value, label }) => (
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
