import React from "react";
import type { Filter } from "../utils";
import type { Mode } from "../hooks/useVehicleMap";
import type { BusOperator, TrainFocusSummary } from "../types";
import type { BusStopSummary } from "./BusSearchPanel";
import SleepingPuca from "./SleepingPuca";
import { useLocale } from "../i18n";

type InfoPanelProps = {
  vehicleCount: number;
  lastUpdated: string;
  mode: Mode;
  busSearchTab: "route" | "stop";
  filter: Filter;
  inService: boolean;
  resumeLabel: string;
  busOperator: BusOperator;
  busStopSummary: BusStopSummary | null;
  trainFocusSummary: TrainFocusSummary | null;
  drilledIn: boolean;
  onDrilledInChange: (drilledIn: boolean) => void;
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

function InfoPanel({
  vehicleCount,
  lastUpdated,
  mode,
  busSearchTab,
  filter,
  inService,
  resumeLabel,
  busOperator,
  busStopSummary,
  trainFocusSummary,
  drilledIn,
  onDrilledInChange,
  onModeChange,
  onFilterChange,
  onBusOperatorChange,
}: InfoPanelProps) {
  const { t } = useLocale();
  const showCount = mode === "train"
    ? t("info.running.train", { n: vehicleCount })
    : t("info.running.bus", { n: vehicleCount });
  const stopSummary = drilledIn && mode === "bus" && busSearchTab === "stop" ? busStopSummary : null;
  const showBusStopSummary = stopSummary !== null;
  const trainSummary = drilledIn && mode === "train" ? trainFocusSummary : null;
  const showTrainSummary = trainSummary !== null;

  const modes: { value: Mode; label: string }[] = [
    { value: "train", label: t("info.mode.train") },
    { value: "bus", label: t("info.mode.bus") },
  ];
  // Only the "All" filter label is translated; DART/Commuter/Intercity stay original.
  const filters = INFO_FILTERS.map((f) => f.value === "all" ? { ...f, label: t("info.filter.all") } : f);

  function handleModeClick(next: Mode) {
    if (next !== mode) onModeChange(next);
    onDrilledInChange(true);
  }

  const panelClassName = [
    drilledIn ? "" : "info-panel--compact",
    (showBusStopSummary || showTrainSummary) ? "info-panel--stop-summary" : "",
  ].filter(Boolean).join(" ");

  return (
    <div id="info-panel" className={panelClassName}>
      {drilledIn && (
        inService ? (
          <>
            {!showBusStopSummary && !showTrainSummary && (
              <div id="panel-header">
                <span id="train-count">{showCount}</span>
              </div>
            )}
            {showTrainSummary && (
              <div className="info-stop-summary info-stop-summary--train">
                <div className="info-stop-summary__stop">
                  <strong>
                    {trainSummary.directionName
                      ? t("train.focus.direction", { station: trainSummary.directionName })
                      : t("info.mode.train")}
                  </strong>
                </div>
                <div className="info-stop-summary__arrival">
                  <span className="info-stop-summary__route">{trainSummary.trainCode}</span>
                  <span className="info-stop-summary__meta">
                    {[
                      trainSummary.stopsAway === null ? null : t("bus.search.stops.away", { n: trainSummary.stopsAway }),
                      trainSummary.etaMinutes === null
                        ? null
                        : trainSummary.etaMinutes <= 0
                          ? t("bus.search.eta.due")
                          : t("bus.search.eta.min", { n: trainSummary.etaMinutes }),
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
            )}
            {showBusStopSummary && (
              <div className={`info-stop-summary info-stop-summary--${stopSummary.operator}`}>
                <div className="info-stop-summary__stop">
                  <strong>{stopSummary.stopCode}</strong>
                  <span>{stopSummary.stopName}</span>
                </div>
                {stopSummary.nextArrival ? (
                  <div className="info-stop-summary__arrival">
                    <span className="info-stop-summary__route">{stopSummary.nextArrival.routeShortName}</span>
                    <span className="info-stop-summary__headsign">{stopSummary.nextArrival.headsign}</span>
                    <span className="info-stop-summary__meta">
                      {[stopSummary.nextArrival.stopsAwayText, stopSummary.nextArrival.etaText].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                ) : (
                  <div className="info-stop-summary__empty">{stopSummary.emptyText}</div>
                )}
              </div>
            )}
            <div id="last-updated">{lastUpdated}</div>
          </>
        ) : (
          <div id="panel-header" className="panel-header--closed">
            <button
              type="button"
              className="filter-btn filter-back"
              onClick={() => onDrilledInChange(false)}
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
        {drilledIn && inService && !showBusStopSummary && !showTrainSummary && (
          <>
            <button
              type="button"
              className="filter-btn filter-back"
              onClick={() => onDrilledInChange(false)}
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

export default React.memo(InfoPanel);
