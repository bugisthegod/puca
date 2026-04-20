// User-saved favorites: bus route+direction pairs, and train station→station
// searches. Separate from session (which remembers the last-viewed state) —
// favorites are explicit bookmarks the user curates. Persisted to localStorage
// under its own versioned key.

import type { BusOperator } from "./types";

const KEY = "puca-favorites-v1";
const OPERATORS: readonly BusOperator[] = ["dublinbus", "buseireann", "goahead"];

export const MAX_BUS_FAVORITES = 3;
export const MAX_TRAIN_FAVORITES = 2;

export interface BusFavorite {
  shortName: string;   // "39A"
  operator: BusOperator;
  direction: string;   // GTFS direction id ("0" / "1")
  headsign: string;    // "Hansfield Road" — cached so list renders without re-fetching the shape
}

export interface TrainFavorite {
  from: string;        // station code
  to: string;
  fromName: string;    // display name
  toName: string;
}

export interface Favorites {
  buses: BusFavorite[];
  trains: TrainFavorite[];
}

export function emptyFavorites(): Favorites {
  return { buses: [], trains: [] };
}

export function busKey(f: Pick<BusFavorite, "shortName" | "operator" | "direction">): string {
  return `${f.operator}:${f.shortName}:${f.direction}`;
}

export function trainKey(f: Pick<TrainFavorite, "from" | "to">): string {
  return `${f.from}→${f.to}`;
}

export function hasBus(favs: Favorites, f: Pick<BusFavorite, "shortName" | "operator" | "direction">): boolean {
  const k = busKey(f);
  return favs.buses.some((b) => busKey(b) === k);
}

export function hasTrain(favs: Favorites, f: Pick<TrainFavorite, "from" | "to">): boolean {
  const k = trainKey(f);
  return favs.trains.some((t) => trainKey(t) === k);
}

export function toggleBus(favs: Favorites, f: BusFavorite): Favorites {
  return hasBus(favs, f)
    ? { ...favs, buses: favs.buses.filter((b) => busKey(b) !== busKey(f)) }
    : { ...favs, buses: [...favs.buses, f] };
}

export function toggleTrain(favs: Favorites, f: TrainFavorite): Favorites {
  return hasTrain(favs, f)
    ? { ...favs, trains: favs.trains.filter((t) => trainKey(t) !== trainKey(f)) }
    : { ...favs, trains: [...favs.trains, f] };
}

export function removeBus(favs: Favorites, key: string): Favorites {
  return { ...favs, buses: favs.buses.filter((b) => busKey(b) !== key) };
}

export function removeTrain(favs: Favorites, key: string): Favorites {
  return { ...favs, trains: favs.trains.filter((t) => trainKey(t) !== key) };
}

function isBusFav(v: unknown): v is BusFavorite {
  if (!v || typeof v !== "object") return false;
  const b = v as Partial<BusFavorite>;
  return typeof b.shortName === "string" && b.shortName.length > 0
    && typeof b.operator === "string" && OPERATORS.includes(b.operator as BusOperator)
    && typeof b.direction === "string" && b.direction.length > 0
    && typeof b.headsign === "string";
}

function isTrainFav(v: unknown): v is TrainFavorite {
  if (!v || typeof v !== "object") return false;
  const t = v as Partial<TrainFavorite>;
  return typeof t.from === "string" && t.from.length > 0
    && typeof t.to === "string" && t.to.length > 0
    && typeof t.fromName === "string"
    && typeof t.toName === "string";
}

export function loadFavorites(): Favorites {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyFavorites();
    const s = JSON.parse(raw) as Partial<Favorites>;
    const buses = Array.isArray(s.buses) ? s.buses.filter(isBusFav) : [];
    const trains = Array.isArray(s.trains) ? s.trains.filter(isTrainFav) : [];
    return { buses, trains };
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
