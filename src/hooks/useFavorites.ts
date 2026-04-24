import { useEffect, useState, useCallback } from "react";
import { loadFavorites, saveFavorites, toggleBus, toggleTrain, toggleStop, removeBus, removeTrain, removeStop, type Favorites, type BusFavorite, type TrainFavorite, type BusStopFavorite } from "../favorites";

export function useFavorites() {
  const [favs, setFavs] = useState<Favorites>(() => loadFavorites());
  useEffect(() => { saveFavorites(favs); }, [favs]);
  return {
    favs,
    toggleBus: useCallback((f: BusFavorite) => setFavs((s) => toggleBus(s, f)), []),
    toggleTrain: useCallback((f: TrainFavorite) => setFavs((s) => toggleTrain(s, f)), []),
    toggleStop: useCallback((f: BusStopFavorite) => setFavs((s) => toggleStop(s, f)), []),
    removeBus: useCallback((k: string) => setFavs((s) => removeBus(s, k)), []),
    removeTrain: useCallback((k: string) => setFavs((s) => removeTrain(s, k)), []),
    removeStop: useCallback((k: string) => setFavs((s) => removeStop(s, k)), []),
  };
}
