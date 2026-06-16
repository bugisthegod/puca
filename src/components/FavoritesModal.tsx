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
import type { BusOperator, LuasArrival } from "../types";

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
	onReorderBus: (keys: string[]) => void;
	onReorderTrain: (keys: string[]) => void;
	onReorderStop: (keys: string[]) => void;
	onReorderLuasStop: (keys: string[]) => void;
};

const OPERATOR_LABEL: Record<BusOperator, string> = {
	dublinbus: "Dublin Bus",
	buseireann: "Bus Éireann",
	goahead: "Go-Ahead",
};

type RemoveType = "bus" | "stop" | "luas-stop" | "train";
type PendingRemove = { type: RemoveType; key: string } | null;
type FavoriteSectionId = "buses" | "stops" | "trains" | "luasStops";
type DraggedFavoriteItem = { sectionId: FavoriteSectionId; key: string } | null;
type FavoriteRowRectSnapshot = Map<string, DOMRect>;
type DraftFavoriteOrder = Partial<Record<FavoriteSectionId, string[]>>;
type LuasFavoriteArrival =
	| { status: "loading" }
	| { status: "error" }
	| { status: "empty" }
	| { status: "ready"; arrival: LuasArrival; fetchedAt: number };

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

function sameOrder(a: string[], b: string[]) {
	return a.length === b.length && a.every((key, index) => key === b[index]);
}

function etaLabel(etaSeconds: number, t: ReturnType<typeof useLocale>["t"]) {
	if (etaSeconds < 60) return t("luas.search.eta.due");
	return t("luas.search.eta.min", { n: Math.round(etaSeconds / 60) });
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
	onReorderBus,
	onReorderTrain,
	onReorderStop,
	onReorderLuasStop,
}: Props) {
	const { t } = useLocale();
	const [pendingRemove, setPendingRemove] = useState<PendingRemove>(null);
	const [luasArrivals, setLuasArrivals] = useState<
		Record<string, LuasFavoriteArrival>
	>({});
	const [luasClockNow, setLuasClockNow] = useState(() => Date.now());
	const [sectionOrder, setSectionOrder] = useState(loadSectionOrder);
	const [isEditingSections, setIsEditingSections] = useState(false);
	const [draftFavoriteOrder, setDraftFavoriteOrder] =
		useState<DraftFavoriteOrder>({});
	const [draggedFavoriteItem, setDraggedFavoriteItem] =
		useState<DraggedFavoriteItem>(null);
	const draggedFavoriteItemRef = useRef<DraggedFavoriteItem>(null);
	const draftFavoriteOrderRef = useRef<DraftFavoriteOrder>({});
	const lastReorderedFavoriteIndexRef = useRef<number | null>(null);
	const dragVisualRef = useRef<{
		initialTop: number;
		pointerOffsetY: number;
		minTop: number;
		maxTop: number;
		height: number;
	} | null>(null);
	const draggedRowRef = useRef<HTMLElement | null>(null);
	const dragCloneRef = useRef<HTMLElement | null>(null);
	const dragFrameRef = useRef<number | null>(null);
	const pendingDragPointRef = useRef<{ y: number } | null>(null);
	const dragAutoScrollFrameRef = useRef<number | null>(null);
	const dragAutoScrollSpeedRef = useRef(0);
	const dragScrollContainerRef = useRef<{
		node: HTMLElement;
		overflowY: string;
	} | null>(null);
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
			closeModal();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, pendingRemove]);

	useEffect(() => {
		document
			.querySelectorAll<HTMLElement>(".fav-row--drag-clone")
			.forEach((node) => {
				node.remove();
			});
		return () => {
			clearDragVisual();
			document
				.querySelectorAll<HTMLElement>(".fav-row--drag-clone")
				.forEach((node) => {
					node.remove();
				});
		};
	}, []);

	useEffect(() => {
		if (!pendingRemove) return;
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLButtonElement>(".fav-row__confirm-cancel")
				?.focus();
		});
	}, [pendingRemove]);

	useEffect(() => {
		if (favs.luasStops.length === 0) {
			setLuasArrivals({});
			return;
		}
		const stopIds = favs.luasStops.map((stop) => stop.stopId);
		const ac = new AbortController();
		let cancelled = false;

		async function fetchArrival(stopId: string) {
			setLuasArrivals((state) => ({
				...state,
				[stopId]: state[stopId] ?? { status: "loading" },
			}));
			try {
				const res = await fetch(
					`/api/luas/stop/${encodeURIComponent(stopId)}/arrivals`,
					{ signal: ac.signal },
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data: LuasArrival[] = await res.json();
				if (cancelled || ac.signal.aborted) return;
				const now = Date.now();
				setLuasClockNow(now);
				setLuasArrivals((state) => ({
					...state,
					[stopId]:
						data.length > 0
							? {
									status: "ready",
									arrival: data[0] as LuasArrival,
									fetchedAt: now,
								}
							: { status: "empty" },
				}));
			} catch (err) {
				if ((err as Error).name === "AbortError" || cancelled) return;
				setLuasArrivals((state) => ({
					...state,
					[stopId]: { status: "error" },
				}));
			}
		}

		setLuasArrivals((state) => {
			const next: Record<string, LuasFavoriteArrival> = {};
			for (const stopId of stopIds) {
				next[stopId] = state[stopId] ?? { status: "loading" };
			}
			return next;
		});
		for (const stopId of stopIds) void fetchArrival(stopId);
		const id = setInterval(() => {
			for (const stopId of stopIds) void fetchArrival(stopId);
		}, 30_000);

		return () => {
			cancelled = true;
			clearInterval(id);
			ac.abort();
		};
	}, [favs.luasStops]);

	useEffect(() => {
		if (favs.luasStops.length === 0) return;
		const id = setInterval(() => setLuasClockNow(Date.now()), 10_000);
		return () => clearInterval(id);
	}, [favs.luasStops.length]);

	useEffect(() => {
		if (!draggedFavoriteItem) return;

		function onPointerMove(e: PointerEvent) {
			const item = draggedFavoriteItemRef.current;
			if (!item) return;
			e.preventDefault();
			handleFavoriteDragMove(item.sectionId, item.key, e.clientY);
		}

		function onPointerEnd() {
			stopFavoriteDrag();
		}

		document.addEventListener("pointermove", onPointerMove, { passive: false });
		document.addEventListener("pointerup", onPointerEnd);
		document.addEventListener("pointercancel", onPointerEnd);
		return () => {
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerEnd);
			document.removeEventListener("pointercancel", onPointerEnd);
		};
	}, [draggedFavoriteItem]);

	useEffect(() => {
		const draft = draftFavoriteOrderRef.current;
		const nextDraft: DraftFavoriteOrder = {};
		let changed = false;
		for (const sectionId of DEFAULT_SECTION_ORDER) {
			const draftKeys = draft[sectionId];
			if (!draftKeys) continue;
			const liveKeys = baseSectionKeys(sectionId);
			const filteredDraft = draftKeys.filter((key) => liveKeys.includes(key));
			const normalizedDraft = [
				...filteredDraft,
				...liveKeys.filter((key) => !filteredDraft.includes(key)),
			];
			if (!sameOrder(normalizedDraft, liveKeys)) {
				nextDraft[sectionId] = normalizedDraft;
			}
			if (
				!sameOrder(draftKeys, normalizedDraft) ||
				sameOrder(normalizedDraft, liveKeys)
			) {
				changed = true;
			}
		}
		if (!changed) return;
		draftFavoriteOrderRef.current = nextDraft;
		setDraftFavoriteOrder(nextDraft);
	}, [favs]);

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

	function luasArrivalContent(stopId: string): React.ReactNode {
		const state = luasArrivals[stopId];
		if (!state || state.status === "loading")
			return (
				<span className="fav-row__luas-next fav-row__luas-next--status">
					{t("favs.luas.next.loading")}
				</span>
			);
		if (state.status === "error")
			return (
				<span className="fav-row__luas-next fav-row__luas-next--status">
					{t("favs.luas.next.error")}
				</span>
			);
		if (state.status === "empty")
			return (
				<span className="fav-row__luas-next fav-row__luas-next--status">
					{t("favs.luas.next.empty")}
				</span>
			);
		const elapsed = Math.floor((luasClockNow - state.fetchedAt) / 1000);
		const etaText = etaLabel(
			Math.max(0, state.arrival.etaSeconds - elapsed),
			t,
		);
		return (
			<>
				<span className="fav-row__luas-destination">
					{state.arrival.headsign}
				</span>
				<span className="fav-row__luas-eta">
					{t("favs.luas.next.timing", {
						eta: etaText,
					})}
				</span>
			</>
		);
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

	function baseSectionKeys(sectionId: FavoriteSectionId): string[] {
		if (sectionId === "buses") return favs.buses.map(busKey);
		if (sectionId === "stops") return favs.stops.map(stopKey);
		if (sectionId === "trains") return favs.trains.map(trainKey);
		return favs.luasStops.map(luasStopKey);
	}

	function sectionKeys(sectionId: FavoriteSectionId): string[] {
		return (
			draftFavoriteOrderRef.current[sectionId] ?? baseSectionKeys(sectionId)
		);
	}

	function orderedSectionItems<T>(
		sectionId: FavoriteSectionId,
		items: T[],
		keyOf: (item: T) => string,
	): T[] {
		const order = draftFavoriteOrder[sectionId];
		if (!order) return items;
		const itemByKey = new Map(items.map((item) => [keyOf(item), item]));
		return [
			...order.flatMap((key) => {
				const item = itemByKey.get(key);
				return item ? [item] : [];
			}),
			...items.filter((item) => !order.includes(keyOf(item))),
		];
	}

	function moveDraftFavoriteToIndex(
		sectionId: FavoriteSectionId,
		key: string,
		targetIndex: number,
	) {
		const keys = sectionKeys(sectionId);
		const from = keys.indexOf(key);
		const to = Math.max(0, Math.min(targetIndex, keys.length - 1));
		if (from < 0 || from === to) return false;
		const nextKeys = [...keys];
		const [moved] = nextKeys.splice(from, 1);
		if (!moved) return false;
		nextKeys.splice(to, 0, moved);
		const nextDraft = {
			...draftFavoriteOrderRef.current,
			[sectionId]: nextKeys,
		};
		draftFavoriteOrderRef.current = nextDraft;
		setDraftFavoriteOrder(nextDraft);
		return true;
	}

	function commitDraftFavoriteOrder() {
		const draft = draftFavoriteOrderRef.current;
		for (const sectionId of DEFAULT_SECTION_ORDER) {
			const targetKeys = draft[sectionId];
			if (!targetKeys) continue;
			const liveKeys = baseSectionKeys(sectionId);
			if (sameOrder(targetKeys, liveKeys)) continue;
			if (sectionId === "buses") onReorderBus(targetKeys);
			else if (sectionId === "stops") onReorderStop(targetKeys);
			else if (sectionId === "trains") onReorderTrain(targetKeys);
			else onReorderLuasStop(targetKeys);
		}
	}

	function setDraggedFavorite(item: DraggedFavoriteItem) {
		draggedFavoriteItemRef.current = item;
		setDraggedFavoriteItem(item);
	}

	function clearDraggedFavoriteItem() {
		setDraggedFavorite(null);
	}

	function resetLiveFavoriteReorder() {
		lastReorderedFavoriteIndexRef.current = null;
	}

	function favoriteRows(sectionId: FavoriteSectionId) {
		return Array.from(
			document.querySelectorAll<HTMLElement>(
				`[data-fav-section="${sectionId}"][data-fav-key]`,
			),
		).filter((row) => !row.classList.contains("fav-row--drag-clone"));
	}

	function captureFavoriteRowRects(
		sectionId: FavoriteSectionId,
	): FavoriteRowRectSnapshot {
		const rects: FavoriteRowRectSnapshot = new Map();
		for (const row of favoriteRows(sectionId)) {
			const key = row.dataset.favKey;
			if (!key) continue;
			rects.set(key, row.getBoundingClientRect());
		}
		return rects;
	}

	function animateFavoriteRowMoves(
		sectionId: FavoriteSectionId,
		before: FavoriteRowRectSnapshot,
		draggedKey: string,
	) {
		requestAnimationFrame(() => {
			const movingRows: HTMLElement[] = [];
			for (const row of favoriteRows(sectionId)) {
				const key = row.dataset.favKey;
				if (!key || key === draggedKey) continue;
				const previous = before.get(key);
				if (!previous) continue;
				const current = row.getBoundingClientRect();
				const dy = previous.top - current.top;
				if (Math.abs(dy) < 1) continue;
				row.style.transition = "none";
				row.style.transform = `translate3d(0, ${dy}px, 0)`;
				movingRows.push(row);
			}
			if (movingRows.length === 0) return;
			requestAnimationFrame(() => {
				for (const row of movingRows) {
					row.style.transition = "";
					row.style.transform = "";
				}
			});
		});
	}

	function prepareDragVisual(row: HTMLElement, y: number) {
		const list = row.closest<HTMLElement>(".fav-list");
		const scrollContainer = row.closest<HTMLElement>(".about-modal__scroll");
		const rowRect = row.getBoundingClientRect();
		const listRect = list?.getBoundingClientRect();
		const scrollRect = scrollContainer?.getBoundingClientRect();
		const clone = row.cloneNode(true) as HTMLElement;
		clone.setAttribute("aria-hidden", "true");
		clone.classList.add("fav-row--drag-clone");
		clone.style.left = `${rowRect.left}px`;
		clone.style.top = `${rowRect.top}px`;
		clone.style.width = `${rowRect.width}px`;
		clone.style.height = `${rowRect.height}px`;
		document.body.appendChild(clone);
		if (scrollContainer) {
			dragScrollContainerRef.current = {
				node: scrollContainer,
				overflowY: scrollContainer.style.overflowY,
			};
			scrollContainer.style.overflowY = "hidden";
		}
		draggedRowRef.current = row;
		dragCloneRef.current = clone;
		pendingDragPointRef.current = { y };
		const minTop = Math.max(
			listRect?.top ?? rowRect.top,
			scrollRect?.top ?? rowRect.top,
		);
		const unclampedMaxTop = Math.min(
			listRect ? listRect.bottom - rowRect.height : rowRect.top,
			scrollRect ? scrollRect.bottom - rowRect.height : rowRect.top,
		);
		dragVisualRef.current =
			listRect || scrollRect
				? {
						initialTop: rowRect.top,
						pointerOffsetY: y - rowRect.top,
						minTop,
						maxTop: Math.max(minTop, unclampedMaxTop),
						height: rowRect.height,
					}
				: {
						initialTop: rowRect.top,
						pointerOffsetY: y - rowRect.top,
						minTop: rowRect.top,
						maxTop: rowRect.top,
						height: rowRect.height,
					};
		clone.style.transform = "translate3d(0, 0, 0) scale(1.035)";
	}

	function refreshDragBounds() {
		const visual = dragVisualRef.current;
		const row = draggedRowRef.current;
		if (!visual || !row) return;
		const listRect = row
			.closest<HTMLElement>(".fav-list")
			?.getBoundingClientRect();
		const scrollRect =
			dragScrollContainerRef.current?.node.getBoundingClientRect();
		if (!listRect && !scrollRect) return;
		const minTop = Math.max(
			listRect?.top ?? Number.NEGATIVE_INFINITY,
			scrollRect?.top ?? Number.NEGATIVE_INFINITY,
		);
		const unclampedMaxTop = Math.min(
			listRect ? listRect.bottom - visual.height : Number.POSITIVE_INFINITY,
			scrollRect ? scrollRect.bottom - visual.height : Number.POSITIVE_INFINITY,
		);
		dragVisualRef.current = {
			...visual,
			minTop,
			maxTop: Math.max(minTop, unclampedMaxTop),
		};
	}

	function applyDragVisual() {
		dragFrameRef.current = null;
		const clone = dragCloneRef.current;
		const point = pendingDragPointRef.current;
		const visual = dragVisualRef.current;
		if (!clone || !point || !visual) return;
		const rawTop = point.y - visual.pointerOffsetY;
		const top = Math.min(Math.max(rawTop, visual.minTop), visual.maxTop);
		clone.style.transform = `translate3d(0, ${
			top - visual.initialTop
		}px, 0) scale(1.035)`;
	}

	function updateDragVisual(y: number) {
		pendingDragPointRef.current = { y };
		if (dragFrameRef.current !== null) return;
		dragFrameRef.current = requestAnimationFrame(applyDragVisual);
	}

	function stopDragAutoScroll() {
		if (dragAutoScrollFrameRef.current !== null) {
			cancelAnimationFrame(dragAutoScrollFrameRef.current);
		}
		dragAutoScrollFrameRef.current = null;
		dragAutoScrollSpeedRef.current = 0;
	}

	function stepDragAutoScroll() {
		dragAutoScrollFrameRef.current = null;
		const scrollContainer = dragScrollContainerRef.current?.node;
		const speed = dragAutoScrollSpeedRef.current;
		if (!scrollContainer || speed === 0) return;
		const before = scrollContainer.scrollTop;
		scrollContainer.scrollTop += speed;
		if (scrollContainer.scrollTop !== before) {
			refreshDragBounds();
			const item = draggedFavoriteItemRef.current;
			const point = pendingDragPointRef.current;
			if (item && point)
				handleFavoriteDragMove(item.sectionId, item.key, point.y);
		} else {
			stopDragAutoScroll();
			return;
		}
		if (
			dragAutoScrollSpeedRef.current !== 0 &&
			dragAutoScrollFrameRef.current === null
		) {
			dragAutoScrollFrameRef.current =
				requestAnimationFrame(stepDragAutoScroll);
		}
	}

	function updateDragAutoScroll(y: number) {
		const scrollContainer = dragScrollContainerRef.current?.node;
		if (!scrollContainer) return;
		const rect = scrollContainer.getBoundingClientRect();
		const edgeSize = Math.min(56, Math.max(32, rect.height * 0.16));
		const maxSpeed = 10;
		const topDistance = y - rect.top;
		const bottomDistance = rect.bottom - y;
		let speed = 0;
		if (topDistance < edgeSize) {
			speed = -Math.min(
				maxSpeed,
				Math.ceil(((edgeSize - topDistance) / edgeSize) * maxSpeed),
			);
		} else if (bottomDistance < edgeSize) {
			speed = Math.min(
				maxSpeed,
				Math.ceil(((edgeSize - bottomDistance) / edgeSize) * maxSpeed),
			);
		}
		if (
			(speed < 0 && scrollContainer.scrollTop <= 0) ||
			(speed > 0 &&
				scrollContainer.scrollTop + scrollContainer.clientHeight >=
					scrollContainer.scrollHeight)
		) {
			speed = 0;
		}
		dragAutoScrollSpeedRef.current = speed;
		if (speed === 0) {
			stopDragAutoScroll();
			return;
		}
		if (dragAutoScrollFrameRef.current === null) {
			dragAutoScrollFrameRef.current =
				requestAnimationFrame(stepDragAutoScroll);
		}
	}

	function clearDragVisual() {
		if (dragFrameRef.current !== null) {
			cancelAnimationFrame(dragFrameRef.current);
		}
		stopDragAutoScroll();
		if (dragScrollContainerRef.current) {
			const { node, overflowY } = dragScrollContainerRef.current;
			node.style.overflowY = overflowY;
		}
		dragCloneRef.current?.remove();
		dragFrameRef.current = null;
		dragCloneRef.current = null;
		draggedRowRef.current = null;
		dragVisualRef.current = null;
		pendingDragPointRef.current = null;
		dragScrollContainerRef.current = null;
	}

	function stopFavoriteDrag() {
		if (draggedFavoriteItemRef.current) {
			commitDraftFavoriteOrder();
		}
		clearDraggedFavoriteItem();
		resetLiveFavoriteReorder();
		clearDragVisual();
	}

	function stopFavoriteDragForPointer(
		key: string,
		target: EventTarget & Element,
		pointerId: number,
	) {
		if (draggedFavoriteItemRef.current?.key !== key) return;
		stopFavoriteDrag();
		try {
			target.releasePointerCapture?.(pointerId);
		} catch {}
	}

	function closeModal() {
		stopFavoriteDrag();
		onClose();
	}

	function toggleEditingSections() {
		setPendingRemove(null);
		if (isEditingSections) stopFavoriteDrag();
		setIsEditingSections((editing) => !editing);
	}

	function dragTargetIndexFromY(
		sectionId: FavoriteSectionId,
		key: string,
		y: number,
	): number | null {
		const visual = dragVisualRef.current;
		if (!visual) return null;
		const centerY = Math.min(
			Math.max(y - visual.pointerOffsetY + visual.height / 2, visual.minTop),
			visual.maxTop + visual.height / 2,
		);
		const rows = Array.from(
			document.querySelectorAll<HTMLElement>(
				`[data-fav-section="${sectionId}"][data-fav-key]`,
			),
		).filter((row) => row.dataset.favKey !== key);
		let targetIndex = 0;
		for (const row of rows) {
			const rect = row.getBoundingClientRect();
			const rowCenter = rect.top + rect.height / 2;
			if (centerY >= rowCenter) targetIndex += 1;
		}
		return targetIndex;
	}

	function handleFavoriteDragMove(
		sectionId: FavoriteSectionId,
		key: string,
		y: number,
	) {
		updateDragVisual(y);
		updateDragAutoScroll(y);
		const targetIndex = dragTargetIndexFromY(sectionId, key, y);
		if (targetIndex === null) return;
		if (targetIndex !== lastReorderedFavoriteIndexRef.current) {
			const before = captureFavoriteRowRects(sectionId);
			lastReorderedFavoriteIndexRef.current = targetIndex;
			if (moveDraftFavoriteToIndex(sectionId, key, targetIndex)) {
				animateFavoriteRowMoves(sectionId, before, key);
			}
		}
	}

	function moveFavoriteByKeyboard(
		sectionId: FavoriteSectionId,
		key: string,
		targetIndex: number,
	) {
		const before = captureFavoriteRowRects(sectionId);
		if (!moveDraftFavoriteToIndex(sectionId, key, targetIndex)) return;
		animateFavoriteRowMoves(sectionId, before, key);
		commitDraftFavoriteOrder();
	}

	function renderDragHandle(
		sectionId: FavoriteSectionId,
		key: string,
		name: string,
		total: number,
	) {
		if (!isEditingSections) return null;
		return (
			<button
				type="button"
				className="fav-row__drag"
				aria-label={t("favs.item.drag.aria", { name })}
				title={t("favs.item.drag.title")}
				onClick={(e) => e.stopPropagation()}
				onPointerDown={(e) => {
					if (total <= 1) return;
					e.stopPropagation();
					e.preventDefault();
					setPendingRemove(null);
					const row = e.currentTarget.closest<HTMLElement>(
						"[data-fav-section][data-fav-key]",
					);
					if (!row) return;
					e.currentTarget.setPointerCapture?.(e.pointerId);
					setDraggedFavorite({ sectionId, key });
					resetLiveFavoriteReorder();
					prepareDragVisual(row, e.clientY);
				}}
				onPointerMove={(e) => {
					if (total <= 1 || draggedFavoriteItemRef.current?.key !== key) return;
					e.stopPropagation();
					handleFavoriteDragMove(sectionId, key, e.clientY);
				}}
				onKeyDown={(e) => {
					if (total <= 1) return;
					const keys = sectionKeys(sectionId);
					const index = keys.indexOf(key);
					if (index < 0) return;
					let targetIndex: number | null = null;
					if (e.key === "ArrowUp") targetIndex = index - 1;
					else if (e.key === "ArrowDown") targetIndex = index + 1;
					else if (e.key === "Home") targetIndex = 0;
					else if (e.key === "End") targetIndex = keys.length - 1;
					if (targetIndex === null) return;
					e.preventDefault();
					e.stopPropagation();
					moveFavoriteByKeyboard(sectionId, key, targetIndex);
				}}
				onPointerUp={(e) => {
					e.stopPropagation();
					stopFavoriteDragForPointer(key, e.currentTarget, e.pointerId);
				}}
				onPointerCancel={(e) => {
					e.stopPropagation();
					stopFavoriteDragForPointer(key, e.currentTarget, e.pointerId);
				}}
			>
				<span aria-hidden="true">⋮⋮</span>
			</button>
		);
	}

	function favoriteRowClass(baseClass: string, key: string) {
		const classes = [baseClass];
		if (draggedFavoriteItem?.key === key) classes.push("fav-row--dragging");
		return classes.join(" ");
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
										{orderedSectionItems("buses", favs.buses, busKey).map(
											(b) => {
												const k = busKey(b);
												const confirming = isConfirmingRemove("bus", k);
												return (
													<li
														key={k}
														data-fav-section="buses"
														data-fav-key={k}
														className={favoriteRowClass(
															`fav-row fav-row--${b.operator}`,
															k,
														)}
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
														{renderDragHandle(
															"buses",
															k,
															b.shortName,
															favs.buses.length,
														)}
														{!isEditingSections && (
															<button
																ref={(node) =>
																	setRemoveButtonRef("bus", k, node)
																}
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
																	aria-label={t(
																		"favs.remove.bus.confirm.aria",
																		{
																			name: b.shortName,
																		},
																	)}
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
											},
										)}
									</ul>
								)}
								{sectionId === "stops" && (
									<ul className="fav-list">
										{orderedSectionItems("stops", favs.stops, stopKey).map(
											(s) => {
												const k = stopKey(s);
												const confirming = isConfirmingRemove("stop", k);
												return (
													<li
														key={k}
														data-fav-section="stops"
														data-fav-key={k}
														className={favoriteRowClass(
															`fav-row fav-row--${s.operator}`,
															k,
														)}
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
														{renderDragHandle(
															"stops",
															k,
															s.stopName,
															favs.stops.length,
														)}
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
																{"\u00d7"}
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
																	aria-label={t(
																		"favs.remove.stop.confirm.aria",
																		{
																			name: s.stopName,
																		},
																	)}
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
											},
										)}
									</ul>
								)}
								{sectionId === "trains" && (
									<ul className="fav-list">
										{orderedSectionItems("trains", favs.trains, trainKey).map(
											(tr) => {
												const k = trainKey(tr);
												const confirming = isConfirmingRemove("train", k);
												return (
													<li
														key={k}
														data-fav-section="trains"
														data-fav-key={k}
														className={favoriteRowClass(
															"fav-row fav-row--train",
															k,
														)}
													>
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
														{renderDragHandle(
															"trains",
															k,
															`${tr.fromName} to ${tr.toName}`,
															favs.trains.length,
														)}
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
																{"\u00d7"}
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
											},
										)}
									</ul>
								)}
								{sectionId === "luasStops" && (
									<ul className="fav-list">
										{orderedSectionItems(
											"luasStops",
											favs.luasStops,
											luasStopKey,
										).map((s) => {
											const k = luasStopKey(s);
											const confirming = isConfirmingRemove("luas-stop", k);
											return (
												<li
													key={k}
													data-fav-section="luasStops"
													data-fav-key={k}
													className={favoriteRowClass(
														`fav-row fav-row--luas-${s.line}`,
														k,
													)}
												>
													<button
														type="button"
														className="fav-row__main fav-row__main--luas"
														onClick={() => {
															onPickLuasStop(s);
															closeModal();
														}}
													>
														<span className="fav-row__luas-title">
															<strong>{s.stopName}</strong>
														</span>
														{luasArrivalContent(s.stopId)}
													</button>
													{renderDragHandle(
														"luasStops",
														k,
														s.stopName,
														favs.luasStops.length,
													)}
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
															{"\u00d7"}
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
