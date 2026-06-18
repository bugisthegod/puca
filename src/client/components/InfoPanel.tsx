import React from "react";
import type { BusOperator, TrainFocusSummary } from "../../types";
import type { Mode } from "../hooks/useVehicleMap";
import type { t as translate } from "../i18n";
import { useLocale } from "../i18n";
import type { BusStopSummary } from "./BusSearchPanel";
import type { LuasStopSummary } from "./LuasSearchPanel";

type BusRouteSummary = {
	routeShortName: string;
	headsign: string;
	operator: BusOperator;
	vehicleCount: number;
};

type InfoPanelProps = {
	lastUpdated: string;
	mode: Mode;
	inService: boolean;
	onModeChange: (m: Mode) => void;
	busSearchTab: "route" | "stop";
	busRouteSummary: BusRouteSummary | null;
	busStopSummary: BusStopSummary | null;
	trainFocusSummary: TrainFocusSummary | null;
	luasStopSummary: LuasStopSummary | null;
};

type Translate = typeof translate;

export function trainFocusSummaryMeta(
	trainSummary: TrainFocusSummary | null,
	t: Translate,
): string | null {
	if (!trainSummary) return null;
	if (trainSummary.isOriginStop) {
		if (trainSummary.etaMinutes === null) return null;
		return trainSummary.etaMinutes <= 0
			? t("train.focus.departing")
			: t("train.focus.departsIn", { n: trainSummary.etaMinutes });
	}

	return [
		trainSummary.stopsAway === null
			? null
			: t("bus.search.stops.away", {
					n: trainSummary.stopsAway,
				}),
		trainSummary.etaMinutes === null
			? null
			: trainSummary.etaMinutes <= 0
				? t("bus.search.eta.due")
				: t("bus.search.eta.min", {
						n: trainSummary.etaMinutes,
					}),
	]
		.filter(Boolean)
		.join(" · ");
}

function InfoPanel({
	lastUpdated,
	mode,
	inService,
	onModeChange,
	busSearchTab,
	busRouteSummary,
	busStopSummary,
	trainFocusSummary,
	luasStopSummary,
}: InfoPanelProps) {
	const { t } = useLocale();
	const stopSummary =
		mode === "bus" && busSearchTab === "stop" ? busStopSummary : null;
	const routeSummary =
		mode === "bus" && busSearchTab === "route" ? busRouteSummary : null;
	const trainSummary = mode === "train" ? trainFocusSummary : null;
	const luasSummary = mode === "luas" ? luasStopSummary : null;
	const trainSummaryMeta = trainFocusSummaryMeta(trainSummary, t);

	if (!stopSummary && !routeSummary && !trainSummary && !luasSummary) {
		if (!inService) {
			return <OffHoursPanel mode={mode} onModeChange={onModeChange} />;
		}
		return <ModeSwitch mode={mode} onModeChange={onModeChange} />;
	}

	return (
		<div
			id="info-panel"
			className="info-panel--detail info-panel--stop-summary"
		>
			{trainSummary && (
				<div
					key={`train:${trainSummary.trainCode}:${trainSummary.directionName ?? ""}`}
					className="info-stop-summary info-stop-summary--train"
				>
					<div className="info-stop-summary__updated">{lastUpdated}</div>
					<div className="info-stop-summary__stop">
						<strong>
							{trainSummary.directionName
								? t("train.focus.direction", {
										station: trainSummary.directionName,
									})
								: t("info.mode.train")}
						</strong>
					</div>
					<div className="info-stop-summary__arrival">
						<span className="info-stop-summary__route">
							{trainSummary.trainCode}
						</span>
						<span className="info-stop-summary__meta">{trainSummaryMeta}</span>
					</div>
				</div>
			)}
			{stopSummary && (
				<div
					key={[
						"stop",
						stopSummary.operator,
						stopSummary.stopCode,
						stopSummary.focusKey ?? "empty",
					].join(":")}
					className={`info-stop-summary info-stop-summary--${stopSummary.operator}`}
				>
					<div className="info-stop-summary__updated">{lastUpdated}</div>
					<div className="info-stop-summary__stop">
						<strong>{stopSummary.stopCode}</strong>
						<span>{stopSummary.stopName}</span>
					</div>
					{stopSummary.nextArrival ? (
						<div className="info-stop-summary__arrival">
							<span className="info-stop-summary__route">
								{stopSummary.nextArrival.routeShortName}
							</span>
							<span className="info-stop-summary__headsign">
								{stopSummary.nextArrival.headsign}
							</span>
							<span className="info-stop-summary__meta">
								{[
									stopSummary.nextArrival.stopsAwayText,
									stopSummary.nextArrival.etaText,
								]
									.filter(Boolean)
									.join(" · ")}
							</span>
						</div>
					) : (
						<div className="info-stop-summary__empty">
							{stopSummary.emptyText}
						</div>
					)}
				</div>
			)}
			{routeSummary && (
				<div
					key={[
						"route",
						routeSummary.operator,
						routeSummary.routeShortName,
						routeSummary.headsign,
					].join(":")}
					className={`info-stop-summary info-stop-summary--${routeSummary.operator}`}
				>
					<div className="info-stop-summary__updated">{lastUpdated}</div>
					<div className="info-stop-summary__stop">
						<strong>
							{t("bus.search.going", { dest: routeSummary.headsign })}
						</strong>
					</div>
					<div className="info-stop-summary__arrival">
						<span className="info-stop-summary__route">
							{routeSummary.routeShortName}
						</span>
						<span className="info-stop-summary__meta">
							{t("info.running.bus", { n: routeSummary.vehicleCount })}
						</span>
					</div>
				</div>
			)}
			{luasSummary && (
				<div
					key={["luas", luasSummary.line, luasSummary.stopName].join(":")}
					className={`info-stop-summary info-stop-summary--luas info-stop-summary--luas-${luasSummary.line}`}
				>
					<div className="info-stop-summary__updated">
						{t("info.updated.timetable")}
					</div>
					<div className="info-stop-summary__stop">
						<strong>{luasSummary.stopName}</strong>
						<span>{t(`luas.line.${luasSummary.line}`)}</span>
					</div>
					{luasSummary.nextArrival ? (
						<div className="info-stop-summary__arrival">
							<span className="info-stop-summary__route">
								{luasSummary.nextArrival.routeShortName}
							</span>
							<span className="info-stop-summary__headsign">
								{luasSummary.nextArrival.headsign}
							</span>
							<span className="info-stop-summary__meta">
								{[
									luasSummary.nextArrival.etaText,
									luasSummary.nextArrival.departureTime,
								]
									.filter(Boolean)
									.join(" · ")}
							</span>
						</div>
					) : (
						<div className="info-stop-summary__empty">
							{luasSummary.emptyText}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function OffHoursPanel({
	mode,
	onModeChange,
}: {
	mode: Mode;
	onModeChange: (m: Mode) => void;
}) {
	const { t } = useLocale();

	return (
		<div id="info-panel" className={`off-hours-panel off-hours-panel--${mode}`}>
			<img
				className="off-hours-panel__puca"
				src="/puca-sleeping.svg?v=transparent-1"
				alt=""
				aria-hidden="true"
			/>
			<div className="off-hours-panel__copy">
				<div className="off-hours-panel__title">{t("info.kip")}</div>
				<div className="off-hours-panel__status">
					{t("info.offhours.status")}
				</div>
			</div>
			<div className="off-hours-panel__switch">
				<button
					type="button"
					className="off-hours-panel__mode off-hours-panel__mode--train"
					aria-pressed={mode === "train"}
					onClick={() => onModeChange("train")}
				>
					<span>{t("info.mode.train")}</span>
				</button>
				<button
					type="button"
					className="off-hours-panel__mode off-hours-panel__mode--bus"
					aria-pressed={mode === "bus"}
					onClick={() => onModeChange("bus")}
				>
					<span>{t("info.mode.bus")}</span>
				</button>
				<button
					type="button"
					className="off-hours-panel__mode off-hours-panel__mode--luas"
					aria-pressed={mode === "luas"}
					onClick={() => onModeChange("luas")}
				>
					<span>{t("info.mode.luas")}</span>
				</button>
			</div>
		</div>
	);
}

function ModeSwitch({
	mode,
	onModeChange,
}: {
	mode: Mode;
	onModeChange: (m: Mode) => void;
}) {
	const { t } = useLocale();

	return (
		<div id="info-panel" className={`mode-switch mode-switch--${mode}`}>
			<button
				type="button"
				className="mode-switch__option mode-switch__option--train"
				aria-pressed={mode === "train"}
				onClick={() => onModeChange("train")}
			>
				<span>{t("info.mode.train")}</span>
			</button>
			<button
				type="button"
				className="mode-switch__option mode-switch__option--bus"
				aria-pressed={mode === "bus"}
				onClick={() => onModeChange("bus")}
			>
				<span>{t("info.mode.bus")}</span>
			</button>
			<button
				type="button"
				className="mode-switch__option mode-switch__option--luas"
				aria-pressed={mode === "luas"}
				onClick={() => onModeChange("luas")}
			>
				<span>{t("info.mode.luas")}</span>
			</button>
		</div>
	);
}

export default React.memo(InfoPanel);
