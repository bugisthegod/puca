import { BusFront, TramFront } from "lucide-preact";
import React from "react";
import type { Mode } from "../hooks/useVehicleMap";
import type { t as translate } from "../i18n";
import { useLocale } from "../i18n";
import type { TrainFocusSummary } from "../types";

type InfoPanelProps = {
	mode: Mode;
	onModeChange: (m: Mode) => void;
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

function InfoPanel({ mode, onModeChange }: InfoPanelProps) {
	const { t } = useLocale();
	const isBus = mode === "bus";
	const label = isBus ? t("info.mode.bus") : t("info.mode.train");
	const nextMode: Mode = isBus ? "train" : "bus";

	function handleModeClick() {
		onModeChange(nextMode);
	}

	return (
		<button
			id="info-panel"
			type="button"
			className={`mode-switch mode-switch--${mode}`}
			aria-label={`${t("tour.mode.title")}: ${label}`}
			aria-pressed={isBus}
			onClick={handleModeClick}
		>
			<span className="mode-switch__indicator" aria-hidden="true" />
			<span
				className="mode-switch__option mode-switch__option--train"
				aria-hidden="true"
			>
				<TramFront size={18} strokeWidth={2.3} />
				<span>{t("info.mode.train")}</span>
			</span>
			<span
				className="mode-switch__option mode-switch__option--bus"
				aria-hidden="true"
			>
				<BusFront size={18} strokeWidth={2.3} />
				<span>{t("info.mode.bus")}</span>
			</span>
		</button>
	);
}

export default React.memo(InfoPanel);
