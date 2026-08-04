import { BusFront, Circle, Layers3, MapPin } from "lucide-preact";
import { useState } from "react";
import { useLocale } from "../i18n";
import type { BusMapView } from "../session";

type BusMapViewToggleProps = {
	view: BusMapView;
	onChange: (view: BusMapView) => void;
	stopsLoading: boolean;
};

export default function BusMapViewToggle({
	view,
	onChange,
	stopsLoading,
}: BusMapViewToggleProps) {
	const { t } = useLocale();
	const [mobileOpen, setMobileOpen] = useState(false);

	function chooseView(nextView: BusMapView) {
		onChange(nextView);
		setMobileOpen(false);
	}

	return (
		<div className="bus-map-focus-control">
			{mobileOpen && (
				<button
					type="button"
					className="bus-map-focus-control__dismiss"
					aria-label={t("bus.map.view.close")}
					onClick={() => setMobileOpen(false)}
				/>
			)}
			{mobileOpen && (
				<fieldset
					className="bus-map-focus-popover"
					aria-busy={stopsLoading || undefined}
				>
					<legend>{t("bus.map.view.focus")}</legend>
					<label
						className={`bus-map-focus-popover__option${view === "live" ? " is-selected" : ""}`}
					>
						<input
							type="radio"
							name="bus-map-focus"
							checked={view === "live"}
							onChange={() => chooseView("live")}
						/>
						<BusFront aria-hidden="true" />
						<span className="bus-map-focus-popover__label">
							{t("bus.map.view.live")}
						</span>
						<span
							className="bus-map-focus-popover__live"
							role="img"
							aria-label={t("bus.map.view.liveStatus")}
							title={t("bus.map.view.liveStatus")}
						>
							<Circle aria-hidden="true" />
						</span>
					</label>
					<label
						className={`bus-map-focus-popover__option${view === "stops" ? " is-selected" : ""}`}
					>
						<input
							type="radio"
							name="bus-map-focus"
							checked={view === "stops"}
							onChange={() => chooseView("stops")}
						/>
						{stopsLoading && view === "stops" ? (
							<span
								className="bus-map-view-toggle__spinner"
								aria-hidden="true"
							/>
						) : (
							<MapPin aria-hidden="true" />
						)}
						<span className="bus-map-focus-popover__label">
							{t("bus.map.view.stops")}
						</span>
					</label>
				</fieldset>
			)}
			<button
				type="button"
				className="fab bus-map-focus-fab"
				aria-label={t("bus.map.view.layers")}
				title={t("bus.map.view.layers")}
				aria-expanded={mobileOpen}
				onClick={() => setMobileOpen((open) => !open)}
			>
				<Layers3 aria-hidden="true" />
			</button>
		</div>
	);
}
