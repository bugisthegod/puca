import React, { useEffect, useRef, useState } from "react";
import type {
	BusFavorite,
	BusStopFavorite,
	Favorites,
	LuasStopFavorite,
	TrainFavorite,
} from "../favorites";
import { busKey, luasStopKey, stopKey, trainKey } from "../favorites";
import { useBackToClose } from "../hooks/useBackToClose";
import { useLocale } from "../i18n";
import type { BusOperator } from "../types";

type Props = {
	onClose: () => void;
	favs: Favorites;
	onPickBus: (f: BusFavorite) => void;
	onPickTrain: (f: TrainFavorite) => void;
	onPickStop: (f: BusStopFavorite) => void;
	onPickLuasStop: (f: LuasStopFavorite) => void;
	onRemoveBus: (key: string) => void;
	onRemoveTrain: (key: string) => void;
	onRemoveStop: (key: string) => void;
	onRemoveLuasStop: (key: string) => void;
};

const OPERATOR_LABEL: Record<BusOperator, string> = {
	dublinbus: "Dublin Bus",
	buseireann: "Bus Éireann",
	goahead: "Go-Ahead",
};

type RemoveType = "bus" | "stop" | "luas-stop" | "train";
type PendingRemove = { type: RemoveType; key: string } | null;
type FavoriteSectionId = "buses" | "stops" | "trains" | "luasStops";

const SECTION_ORDER_KEY = "puca-favorite-section-order-v1";
const DEFAULT_SECTION_ORDER: FavoriteSectionId[] = [
	"buses",
	"stops",
	"trains",
	"luasStops",
];
const SECTION_IDS = new Set<FavoriteSectionId>(DEFAULT_SECTION_ORDER);

function loadSectionOrder(): FavoriteSectionId[] {
	try {
		const raw = localStorage.getItem(SECTION_ORDER_KEY);
		if (!raw) return DEFAULT_SECTION_ORDER;
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return DEFAULT_SECTION_ORDER;
		const saved = parsed.filter((id): id is FavoriteSectionId =>
			SECTION_IDS.has(id),
		);
		return [
			...saved,
			...DEFAULT_SECTION_ORDER.filter((id) => !saved.includes(id)),
		];
	} catch {
		return DEFAULT_SECTION_ORDER;
	}
}

function saveSectionOrder(order: FavoriteSectionId[]) {
	try {
		localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(order));
	} catch {
		// Best-effort UI preference.
	}
}

function FavoritesModal({
	onClose,
	favs,
	onPickBus,
	onPickTrain,
	onPickStop,
	onPickLuasStop,
	onRemoveBus,
	onRemoveTrain,
	onRemoveStop,
	onRemoveLuasStop,
}: Props) {
	const { t } = useLocale();
	const [pendingRemove, setPendingRemove] = useState<PendingRemove>(null);
	const [sectionOrder, setSectionOrder] = useState(loadSectionOrder);
	const [isEditingSections, setIsEditingSections] = useState(false);
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	useBackToClose(closeModal);
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key !== "Escape") return;
			if (pendingRemove) {
				setPendingRemove(null);
				focusRemoveButton(pendingRemove.type, pendingRemove.key);
				return;
			}
			closeModal();
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

	function sectionHasItems(sectionId: FavoriteSectionId) {
		if (sectionId === "buses") return favs.buses.length > 0;
		if (sectionId === "stops") return favs.stops.length > 0;
		if (sectionId === "trains") return favs.trains.length > 0;
		return favs.luasStops.length > 0;
	}

	const visibleSectionIds = sectionOrder.filter(sectionHasItems);

	function moveSection(sectionId: FavoriteSectionId, direction: -1 | 1) {
		const visibleIndex = visibleSectionIds.indexOf(sectionId);
		const swapWith = visibleSectionIds[visibleIndex + direction];
		if (!swapWith) return;
		setSectionOrder((order) => {
			const next = [...order];
			const from = next.indexOf(sectionId);
			const to = next.indexOf(swapWith);
			if (from < 0 || to < 0) return order;
			[next[from], next[to]] = [
				next[to] as FavoriteSectionId,
				next[from] as FavoriteSectionId,
			];
			saveSectionOrder(next);
			return next;
		});
	}

	function sectionLabel(sectionId: FavoriteSectionId) {
		if (sectionId === "buses") return t("favs.section.buses");
		if (sectionId === "stops") return t("favs.section.stops");
		if (sectionId === "trains") return t("favs.section.trains");
		return t("favs.section.luasStops");
	}

	function renderSectionHeader(
		sectionId: FavoriteSectionId,
		index: number,
		total: number,
	) {
		const label = sectionLabel(sectionId);
		return (
			<div className="fav-section-header">
				<div className="about-block__label">{label}</div>
				{isEditingSections && total > 1 && (
					<div className="fav-section-header__controls">
						<button
							type="button"
							className="fav-section-header__move"
							disabled={index === 0}
							aria-label={t("favs.section.moveUp.aria", { name: label })}
							title={t("favs.section.moveUp.title")}
							onClick={() => moveSection(sectionId, -1)}
						>
							<svg
								viewBox="0 0 24 24"
								width="15"
								height="15"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.4"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="m18 15-6-6-6 6" />
							</svg>
						</button>
						<button
							type="button"
							className="fav-section-header__move"
							disabled={index === total - 1}
							aria-label={t("favs.section.moveDown.aria", { name: label })}
							title={t("favs.section.moveDown.title")}
							onClick={() => moveSection(sectionId, 1)}
						>
							<svg
								viewBox="0 0 24 24"
								width="15"
								height="15"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.4"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="m6 9 6 6 6-6" />
							</svg>
						</button>
					</div>
				)}
			</div>
		);
	}

	function closeModal() {
		onClose();
	}

	function toggleEditingSections() {
		setPendingRemove(null);
		setIsEditingSections((editing) => !editing);
	}

	const empty =
		favs.buses.length === 0 &&
		favs.trains.length === 0 &&
		favs.stops.length === 0 &&
		favs.luasStops.length === 0;

	return (
		<div
			className="about-overlay"
			onClick={closeModal}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") closeModal();
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
					onClick={closeModal}
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
						<div className="fav-title-row">
							<div className="about-block__label">{t("favs.title")}</div>
							{visibleSectionIds.length > 1 && (
								<button
									type="button"
									className={`fav-title-row__edit${isEditingSections ? " is-active" : ""}`}
									aria-pressed={isEditingSections}
									onClick={toggleEditingSections}
								>
									{isEditingSections
										? t("favs.section.edit.done")
										: t("favs.section.edit")}
								</button>
							)}
						</div>
						{empty && <div className="fav-empty">{t("favs.empty")}</div>}
						{visibleSectionIds.map((sectionId, index) => (
							<section
								key={sectionId}
								className="fav-section"
								style={{ marginTop: index === 0 ? 8 : 16 }}
							>
								{renderSectionHeader(
									sectionId,
									index,
									visibleSectionIds.length,
								)}
								{sectionId === "buses" && (
									<ul className="fav-list">
										{favs.buses.map((b) => {
											const k = busKey(b);
											const confirming = isConfirmingRemove("bus", k);
											return (
												<li
													key={k}
													className={`fav-row fav-row--${b.operator}`}
												>
													<button
														type="button"
														className="fav-row__main"
														onClick={() => {
															onPickBus(b);
															closeModal();
														}}
													>
														<strong>{b.shortName}</strong>
														<span>&rarr; {b.headsign}</span>
														<span className="route-operator-badge">
															{OPERATOR_LABEL[b.operator]}
														</span>
													</button>
													{!isEditingSections && (
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
															{"×"}
														</button>
													)}
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
								)}
								{sectionId === "stops" && (
									<ul className="fav-list">
										{favs.stops.map((s) => {
											const k = stopKey(s);
											const confirming = isConfirmingRemove("stop", k);
											return (
												<li
													key={k}
													className={`fav-row fav-row--${s.operator}`}
												>
													<button
														type="button"
														className="fav-row__main"
														onClick={() => {
															onPickStop(s);
															closeModal();
														}}
													>
														<strong>{s.stopCode || s.stopId}</strong>
														<span>{s.stopName}</span>
														<span className="route-operator-badge">
															{OPERATOR_LABEL[s.operator]}
														</span>
													</button>
													{!isEditingSections && (
														<button
															ref={(node) =>
																setRemoveButtonRef("stop", k, node)
															}
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
															{"×"}
														</button>
													)}
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
								)}
								{sectionId === "trains" && (
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
															closeModal();
														}}
													>
														<span>
															{tr.fromName} &rarr; {tr.toName}
														</span>
													</button>
													{!isEditingSections && (
														<button
															ref={(node) =>
																setRemoveButtonRef("train", k, node)
															}
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
															{"×"}
														</button>
													)}
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
																aria-label={t(
																	"favs.remove.train.confirm.aria",
																	{
																		from: tr.fromName,
																		to: tr.toName,
																	},
																)}
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
								)}
								{sectionId === "luasStops" && (
									<ul className="fav-list">
										{favs.luasStops.map((s) => {
											const k = luasStopKey(s);
											const confirming = isConfirmingRemove("luas-stop", k);
											return (
												<li
													key={k}
													className={`fav-row fav-row--luas-${s.line}`}
												>
													<button
														type="button"
														className="fav-row__main"
														onClick={() => {
															onPickLuasStop(s);
															closeModal();
														}}
													>
														<strong>{s.stopName}</strong>
														<span className="route-operator-badge">
															{t(`luas.line.${s.line}`)}
														</span>
													</button>
													{!isEditingSections && (
														<button
															ref={(node) =>
																setRemoveButtonRef("luas-stop", k, node)
															}
															type="button"
															className="fav-row__remove"
															tabIndex={confirming ? -1 : undefined}
															aria-hidden={confirming ? true : undefined}
															aria-label={t("favs.remove.luasStop.aria", {
																name: s.stopName,
															})}
															title={t("favs.remove.title")}
															onClick={(e) => {
																e.stopPropagation();
																requestRemove("luas-stop", k);
															}}
														>
															{"×"}
														</button>
													)}
													{confirming && (
														<div className="fav-row__confirm">
															<button
																type="button"
																className="fav-row__confirm-cancel"
																onClick={(e) => {
																	e.stopPropagation();
																	cancelRemove("luas-stop", k);
																}}
															>
																{t("favs.remove.cancel")}
															</button>
															<button
																type="button"
																className="fav-row__confirm-action"
																aria-label={t(
																	"favs.remove.luasStop.confirm.aria",
																	{
																		name: s.stopName,
																	},
																)}
																onClick={(e) => {
																	e.stopPropagation();
																	removeThenClear(k, onRemoveLuasStop);
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
								)}
							</section>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export default React.memo(FavoritesModal);
