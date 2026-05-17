// User-saved favorites: bus route+direction pairs, and train station→station
// searches. Separate from session (which remembers the last-viewed state) —
// favorites are explicit bookmarks the user curates. Persisted to localStorage
// under its own versioned key.

import { type BusOperator, OPERATORS } from "./types";

const KEY = "puca-favorites-v1";

// Single shared cap across buses + trains + stops. 15 total slots — the user
// curates a small set, not a bookmark dump.
export const MAX_FAVORITES = 15;

export function totalFavorites(favs: Favorites): number {
	return favs.buses.length + favs.trains.length + favs.stops.length;
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

export interface Favorites {
	buses: BusFavorite[];
	trains: TrainFavorite[];
	stops: BusStopFavorite[];
}

export function emptyFavorites(): Favorites {
	return { buses: [], trains: [], stops: [] };
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

export function removeBus(favs: Favorites, key: string): Favorites {
	return { ...favs, buses: favs.buses.filter((b) => busKey(b) !== key) };
}

export function removeTrain(favs: Favorites, key: string): Favorites {
	return { ...favs, trains: favs.trains.filter((t) => trainKey(t) !== key) };
}

export function removeStop(favs: Favorites, key: string): Favorites {
	return { ...favs, stops: favs.stops.filter((s) => stopKey(s) !== key) };
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
		return { buses, trains, stops };
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
