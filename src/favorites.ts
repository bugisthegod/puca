// User-saved favorites: bus route+direction pairs, stops, and train
// station→station searches. Separate from session (which remembers the
// last-viewed state) — favorites are explicit bookmarks the user curates.
// Persisted to localStorage under its own versioned key.

import type { LuasLine } from "./types";
import { type BusOperator, OPERATORS } from "./types";

const KEY = "puca-favorites-v1";

// Single shared cap across buses + trains + stops. 15 total slots — the user
// curates a small set, not a bookmark dump.
export const MAX_FAVORITES = 15;

export function totalFavorites(favs: Favorites): number {
	return (
		favs.buses.length +
		favs.trains.length +
		favs.stops.length +
		favs.luasStops.length
	);
}

export interface BusFavorite {
	shortName: string; // "39A"
	operator: BusOperator;
	direction: string; // GTFS direction id ("0" / "1")
	headsign: string; // "Hansfield Road" — cached so list renders without re-fetching the shape
}

export interface TrainFavorite {
	from: string; // station code
	to: string;
	fromName: string; // display name
	toName: string;
}

export interface BusStopFavorite {
	stopId: string; // "8220DB000270"
	operator: BusOperator;
	stopCode: string; // "270" — printed on the shelter, used as the display badge
	stopName: string; // "O'Connell Street Upper"
}

export interface LuasStopFavorite {
	stopId: string;
	stopName: string;
	line: LuasLine;
}

export interface Favorites {
	buses: BusFavorite[];
	trains: TrainFavorite[];
	stops: BusStopFavorite[];
	luasStops: LuasStopFavorite[];
}

export function emptyFavorites(): Favorites {
	return { buses: [], trains: [], stops: [], luasStops: [] };
}

export function busKey(
	f: Pick<BusFavorite, "shortName" | "operator" | "direction">,
): string {
	return `${f.operator}:${f.shortName}:${f.direction}`;
}

export function trainKey(f: Pick<TrainFavorite, "from" | "to">): string {
	return `${f.from}→${f.to}`;
}

export function stopKey(
	f: Pick<BusStopFavorite, "stopId" | "operator">,
): string {
	return `${f.operator}:${f.stopId}`;
}

export function luasStopKey(f: Pick<LuasStopFavorite, "stopId">): string {
	return `luas:${f.stopId}`;
}

function cleanKeyPart(v: string | undefined): string {
	return (v ?? "").trim().toLowerCase();
}

function busStableKey(
	f: Pick<BusFavorite, "shortName" | "operator"> & { headsign?: string },
): string | null {
	const headsign = cleanKeyPart(f.headsign);
	if (!headsign) return null;
	return `${f.operator}:${cleanKeyPart(f.shortName)}:${headsign}`;
}

function stopStableKey(
	f: Pick<BusStopFavorite, "operator"> & { stopCode?: string },
): string | null {
	const stopCode = cleanKeyPart(f.stopCode);
	if (!stopCode) return null;
	return `${f.operator}:${stopCode}`;
}

function busMatches(
	saved: BusFavorite,
	current: Pick<BusFavorite, "shortName" | "operator" | "direction"> & {
		headsign?: string;
	},
): boolean {
	if (busKey(saved) === busKey(current)) return true;
	const savedStable = busStableKey(saved);
	return savedStable !== null && savedStable === busStableKey(current);
}

function stopMatches(
	saved: BusStopFavorite,
	current: Pick<BusStopFavorite, "stopId" | "operator"> & {
		stopCode?: string;
	},
): boolean {
	if (stopKey(saved) === stopKey(current)) return true;
	const savedStable = stopStableKey(saved);
	return savedStable !== null && savedStable === stopStableKey(current);
}

export function hasBus(
	favs: Favorites,
	f: Pick<BusFavorite, "shortName" | "operator" | "direction"> & {
		headsign?: string;
	},
): boolean {
	return favs.buses.some((b) => busMatches(b, f));
}

export function hasTrain(
	favs: Favorites,
	f: Pick<TrainFavorite, "from" | "to">,
): boolean {
	const k = trainKey(f);
	return favs.trains.some((t) => trainKey(t) === k);
}

export function hasStop(
	favs: Favorites,
	f: Pick<BusStopFavorite, "stopId" | "operator"> & { stopCode?: string },
): boolean {
	return favs.stops.some((s) => stopMatches(s, f));
}

export function hasLuasStop(
	favs: Favorites,
	f: Pick<LuasStopFavorite, "stopId">,
): boolean {
	const k = luasStopKey(f);
	return favs.luasStops.some((s) => luasStopKey(s) === k);
}

export function toggleBus(favs: Favorites, f: BusFavorite): Favorites {
	return hasBus(favs, f)
		? { ...favs, buses: favs.buses.filter((b) => !busMatches(b, f)) }
		: { ...favs, buses: [...favs.buses, f] };
}

export function toggleTrain(favs: Favorites, f: TrainFavorite): Favorites {
	return hasTrain(favs, f)
		? {
				...favs,
				trains: favs.trains.filter((t) => trainKey(t) !== trainKey(f)),
			}
		: { ...favs, trains: [...favs.trains, f] };
}

export function toggleStop(favs: Favorites, f: BusStopFavorite): Favorites {
	return hasStop(favs, f)
		? { ...favs, stops: favs.stops.filter((s) => !stopMatches(s, f)) }
		: { ...favs, stops: [...favs.stops, f] };
}

export function toggleLuasStop(
	favs: Favorites,
	f: LuasStopFavorite,
): Favorites {
	return hasLuasStop(favs, f)
		? {
				...favs,
				luasStops: favs.luasStops.filter(
					(s) => luasStopKey(s) !== luasStopKey(f),
				),
			}
		: { ...favs, luasStops: [...favs.luasStops, f] };
}

export function removeBus(favs: Favorites, key: string): Favorites {
	return { ...favs, buses: favs.buses.filter((b) => busKey(b) !== key) };
}

export function removeTrain(favs: Favorites, key: string): Favorites {
	return { ...favs, trains: favs.trains.filter((t) => trainKey(t) !== key) };
}

export function removeStop(favs: Favorites, key: string): Favorites {
	return { ...favs, stops: favs.stops.filter((s) => stopKey(s) !== key) };
}

export function removeLuasStop(favs: Favorites, key: string): Favorites {
	return {
		...favs,
		luasStops: favs.luasStops.filter((s) => luasStopKey(s) !== key),
	};
}

function moveByKey<T>(
	items: T[],
	key: string,
	direction: -1 | 1,
	keyOf: (item: T) => string,
): T[] {
	const from = items.findIndex((item) => keyOf(item) === key);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= items.length) return items;
	const next = [...items];
	[next[from], next[to]] = [next[to] as T, next[from] as T];
	return next;
}

function reorderByKeys<T>(
	items: T[],
	keys: string[],
	keyOf: (item: T) => string,
): T[] {
	const itemByKey = new Map(items.map((item) => [keyOf(item), item]));
	const ordered = keys.flatMap((key) => {
		const item = itemByKey.get(key);
		return item ? [item] : [];
	});
	const orderedKeys = new Set(keys);
	const next = [
		...ordered,
		...items.filter((item) => !orderedKeys.has(keyOf(item))),
	];
	if (next.length !== items.length) return items;
	return next.every((item, index) => item === items[index]) ? items : next;
}

export function moveBusFavorite(
	favs: Favorites,
	key: string,
	direction: -1 | 1,
): Favorites {
	return { ...favs, buses: moveByKey(favs.buses, key, direction, busKey) };
}

export function moveTrainFavorite(
	favs: Favorites,
	key: string,
	direction: -1 | 1,
): Favorites {
	return { ...favs, trains: moveByKey(favs.trains, key, direction, trainKey) };
}

export function moveStopFavorite(
	favs: Favorites,
	key: string,
	direction: -1 | 1,
): Favorites {
	return { ...favs, stops: moveByKey(favs.stops, key, direction, stopKey) };
}

export function moveLuasStopFavorite(
	favs: Favorites,
	key: string,
	direction: -1 | 1,
): Favorites {
	return {
		...favs,
		luasStops: moveByKey(favs.luasStops, key, direction, luasStopKey),
	};
}

export function reorderBusFavorites(
	favs: Favorites,
	keys: string[],
): Favorites {
	return { ...favs, buses: reorderByKeys(favs.buses, keys, busKey) };
}

export function reorderTrainFavorites(
	favs: Favorites,
	keys: string[],
): Favorites {
	return { ...favs, trains: reorderByKeys(favs.trains, keys, trainKey) };
}

export function reorderStopFavorites(
	favs: Favorites,
	keys: string[],
): Favorites {
	return { ...favs, stops: reorderByKeys(favs.stops, keys, stopKey) };
}

export function reorderLuasStopFavorites(
	favs: Favorites,
	keys: string[],
): Favorites {
	return {
		...favs,
		luasStops: reorderByKeys(favs.luasStops, keys, luasStopKey),
	};
}

function isBusFav(v: unknown): v is BusFavorite {
	if (!v || typeof v !== "object") return false;
	const b = v as Partial<BusFavorite>;
	return (
		typeof b.shortName === "string" &&
		b.shortName.length > 0 &&
		typeof b.operator === "string" &&
		OPERATORS.includes(b.operator as BusOperator) &&
		typeof b.direction === "string" &&
		b.direction.length > 0 &&
		typeof b.headsign === "string"
	);
}

function isTrainFav(v: unknown): v is TrainFavorite {
	if (!v || typeof v !== "object") return false;
	const t = v as Partial<TrainFavorite>;
	return (
		typeof t.from === "string" &&
		t.from.length > 0 &&
		typeof t.to === "string" &&
		t.to.length > 0 &&
		typeof t.fromName === "string" &&
		typeof t.toName === "string"
	);
}

function isStopFav(v: unknown): v is BusStopFavorite {
	if (!v || typeof v !== "object") return false;
	const s = v as Partial<BusStopFavorite>;
	return (
		typeof s.stopId === "string" &&
		s.stopId.length > 0 &&
		typeof s.operator === "string" &&
		OPERATORS.includes(s.operator as BusOperator) &&
		typeof s.stopCode === "string" &&
		typeof s.stopName === "string" &&
		s.stopName.length > 0
	);
}

function isLuasStopFav(v: unknown): v is LuasStopFavorite {
	if (!v || typeof v !== "object") return false;
	const s = v as Partial<LuasStopFavorite>;
	return (
		typeof s.stopId === "string" &&
		s.stopId.length > 0 &&
		typeof s.stopName === "string" &&
		s.stopName.length > 0 &&
		(s.line === "green" || s.line === "red" || s.line === "both")
	);
}

export function loadFavorites(): Favorites {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return emptyFavorites();
		const s = JSON.parse(raw) as Partial<Favorites>;
		const buses = Array.isArray(s.buses) ? s.buses.filter(isBusFav) : [];
		const trains = Array.isArray(s.trains) ? s.trains.filter(isTrainFav) : [];
		// Pre-existing v1 records won't have `stops` — default to empty and keep
		// sharing the same localStorage key, so no migration dance.
		const stops = Array.isArray(s.stops) ? s.stops.filter(isStopFav) : [];
		const luasStops = Array.isArray(s.luasStops)
			? s.luasStops.filter(isLuasStopFav)
			: [];
		return { buses, trains, stops, luasStops };
	} catch {
		return emptyFavorites();
	}
}

export function saveFavorites(favs: Favorites): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(favs));
	} catch {
		// quota or disabled — non-critical
	}
}
