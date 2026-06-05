import React, { useEffect, useRef, useState } from "react";
import type {
	BusFavorite,
	BusStopFavorite,
	Favorites,
	TrainFavorite,
} from "../favorites";
import { busKey, stopKey, trainKey } from "../favorites";
import { useBackToClose } from "../hooks/useBackToClose";
import { useLocale } from "../i18n";
import type { BusOperator } from "../types";

type Props = {
	onClose: () => void;
	favs: Favorites;
	onPickBus: (f: BusFavorite) => void;
	onPickTrain: (f: TrainFavorite) => void;
	onPickStop: (f: BusStopFavorite) => void;
	onRemoveBus: (key: string) => void;
	onRemoveTrain: (key: string) => void;
	onRemoveStop: (key: string) => void;
};

const OPERATOR_LABEL: Record<BusOperator, string> = {
	dublinbus: "Dublin Bus",
	buseireann: "Bus Éireann",
	goahead: "Go-Ahead",
};

type RemoveType = "bus" | "stop" | "train";
type PendingRemove = { type: RemoveType; key: string } | null;

function FavoritesModal({
	onClose,
	favs,
	onPickBus,
	onPickTrain,
	onPickStop,
	onRemoveBus,
	onRemoveTrain,
	onRemoveStop,
}: Props) {
	const { t } = useLocale();
	const [pendingRemove, setPendingRemove] = useState<PendingRemove>(null);
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	useBackToClose(onClose);
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key !== "Escape") return;
			if (pendingRemove) {
				setPendingRemove(null);
				focusRemoveButton(pendingRemove.type, pendingRemove.key);
				return;
			}
			onClose();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, pendingRemove]);

	useEffect(() => {
		if (!pendingRemove) return;
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLButtonElement>(".fav-row__confirm-cancel")
				?.focus();
		});
	}, [pendingRemove]);

	function refKey(type: RemoveType, key: string) {
		return `${type}:${key}`;
	}

	function setRemoveButtonRef(
		type: RemoveType,
		key: string,
		node: HTMLButtonElement | null,
	) {
		const k = refKey(type, key);
		if (node) removeButtonRefs.current.set(k, node);
		else removeButtonRefs.current.delete(k);
	}

	function focusRemoveButton(type: RemoveType, key: string) {
		requestAnimationFrame(() => {
			removeButtonRefs.current.get(refKey(type, key))?.focus();
		});
	}

	function isConfirmingRemove(type: RemoveType, key: string) {
		return pendingRemove?.type === type && pendingRemove.key === key;
	}

	function requestRemove(type: RemoveType, key: string) {
		setPendingRemove({ type, key });
	}

	function cancelRemove(type: RemoveType, key: string) {
		setPendingRemove(null);
		focusRemoveButton(type, key);
	}

	function removeThenClear(key: string, remove: (key: string) => void) {
		remove(key);
		setPendingRemove(null);
		requestAnimationFrame(() => {
			closeButtonRef.current?.focus();
		});
	}

	const empty =
		favs.buses.length === 0 &&
		favs.trains.length === 0 &&
		favs.stops.length === 0;

	return (
		<div
			className="about-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") onClose();
			}}
			role="dialog"
			aria-modal="true"
			aria-label={t("favs.dialog.aria")}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop stop-propagation pattern */}
			<div
				className="about-modal"
				role="presentation"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<button
					ref={closeButtonRef}
					type="button"
					className="about-modal__close"
					onClick={onClose}
					aria-label={t("about.close")}
				>
					<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
				<div className="about-modal__scroll">
					<div className="about-block">
						<div className="about-block__label">{t("favs.title")}</div>
						{empty && <div className="fav-empty">{t("favs.empty")}</div>}
						{favs.buses.length > 0 && (
							<>
								<div className="about-block__label" style={{ marginTop: 8 }}>
									{t("favs.section.buses")}
								</div>
								<ul className="fav-list">
									{favs.buses.map((b) => {
										const k = busKey(b);
										const confirming = isConfirmingRemove("bus", k);
										return (
											<li key={k} className={`fav-row fav-row--${b.operator}`}>
												<button
													type="button"
													className="fav-row__main"
													onClick={() => {
														onPickBus(b);
														onClose();
													}}
												>
													<strong>{b.shortName}</strong>
													<span>&rarr; {b.headsign}</span>
													<span className="route-operator-badge">
														{OPERATOR_LABEL[b.operator]}
													</span>
												</button>
												<button
													ref={(node) => setRemoveButtonRef("bus", k, node)}
													type="button"
													className="fav-row__remove"
													tabIndex={confirming ? -1 : undefined}
													aria-hidden={confirming ? true : undefined}
													aria-label={t("favs.remove.bus.aria", {
														name: b.shortName,
													})}
													title={t("favs.remove.title")}
													onClick={(e) => {
														e.stopPropagation();
														requestRemove("bus", k);
													}}
												>
													{"\u00d7"}
												</button>
												{confirming && (
													<div className="fav-row__confirm">
														<button
															type="button"
															className="fav-row__confirm-cancel"
															onClick={(e) => {
																e.stopPropagation();
																cancelRemove("bus", k);
															}}
														>
															{t("favs.remove.cancel")}
														</button>
														<button
															type="button"
															className="fav-row__confirm-action"
															aria-label={t("favs.remove.bus.confirm.aria", {
																name: b.shortName,
															})}
															onClick={(e) => {
																e.stopPropagation();
																removeThenClear(k, onRemoveBus);
															}}
														>
															{t("favs.remove.confirm")}
														</button>
													</div>
												)}
											</li>
										);
									})}
								</ul>
							</>
						)}
						{favs.stops.length > 0 && (
							<>
								<div
									className="about-block__label"
									style={{ marginTop: favs.buses.length > 0 ? 16 : 8 }}
								>
									{t("favs.section.stops")}
								</div>
								<ul className="fav-list">
									{favs.stops.map((s) => {
										const k = stopKey(s);
										const confirming = isConfirmingRemove("stop", k);
										return (
											<li key={k} className={`fav-row fav-row--${s.operator}`}>
												<button
													type="button"
													className="fav-row__main"
													onClick={() => {
														onPickStop(s);
														onClose();
													}}
												>
													<strong>{s.stopCode || s.stopId}</strong>
													<span>{s.stopName}</span>
													<span className="route-operator-badge">
														{OPERATOR_LABEL[s.operator]}
													</span>
												</button>
												<button
													ref={(node) => setRemoveButtonRef("stop", k, node)}
													type="button"
													className="fav-row__remove"
													tabIndex={confirming ? -1 : undefined}
													aria-hidden={confirming ? true : undefined}
													aria-label={t("favs.remove.stop.aria", {
														name: s.stopName,
													})}
													title={t("favs.remove.title")}
													onClick={(e) => {
														e.stopPropagation();
														requestRemove("stop", k);
													}}
												>
													{"\u00d7"}
												</button>
												{confirming && (
													<div className="fav-row__confirm">
														<button
															type="button"
															className="fav-row__confirm-cancel"
															onClick={(e) => {
																e.stopPropagation();
																cancelRemove("stop", k);
															}}
														>
															{t("favs.remove.cancel")}
														</button>
														<button
															type="button"
															className="fav-row__confirm-action"
															aria-label={t("favs.remove.stop.confirm.aria", {
																name: s.stopName,
															})}
															onClick={(e) => {
																e.stopPropagation();
																removeThenClear(k, onRemoveStop);
															}}
														>
															{t("favs.remove.confirm")}
														</button>
													</div>
												)}
											</li>
										);
									})}
								</ul>
							</>
						)}
						{favs.trains.length > 0 && (
							<>
								<div
									className="about-block__label"
									style={{
										marginTop:
											favs.buses.length > 0 || favs.stops.length > 0 ? 16 : 8,
									}}
								>
									{t("favs.section.trains")}
								</div>
								<ul className="fav-list">
									{favs.trains.map((tr) => {
										const k = trainKey(tr);
										const confirming = isConfirmingRemove("train", k);
										return (
											<li key={k} className="fav-row fav-row--train">
												<button
													type="button"
													className="fav-row__main"
													onClick={() => {
														onPickTrain(tr);
														onClose();
													}}
												>
													<span>
														{tr.fromName} &rarr; {tr.toName}
													</span>
												</button>
												<button
													ref={(node) => setRemoveButtonRef("train", k, node)}
													type="button"
													className="fav-row__remove"
													tabIndex={confirming ? -1 : undefined}
													aria-hidden={confirming ? true : undefined}
													aria-label={t("favs.remove.train.aria", {
														from: tr.fromName,
														to: tr.toName,
													})}
													title={t("favs.remove.title")}
													onClick={(e) => {
														e.stopPropagation();
														requestRemove("train", k);
													}}
												>
													{"\u00d7"}
												</button>
												{confirming && (
													<div className="fav-row__confirm">
														<button
															type="button"
															className="fav-row__confirm-cancel"
															onClick={(e) => {
																e.stopPropagation();
																cancelRemove("train", k);
															}}
														>
															{t("favs.remove.cancel")}
														</button>
														<button
															type="button"
															className="fav-row__confirm-action"
															aria-label={t("favs.remove.train.confirm.aria", {
																from: tr.fromName,
																to: tr.toName,
															})}
															onClick={(e) => {
																e.stopPropagation();
																removeThenClear(k, onRemoveTrain);
															}}
														>
															{t("favs.remove.confirm")}
														</button>
													</div>
												)}
											</li>
										);
									})}
								</ul>
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export default React.memo(FavoritesModal);
