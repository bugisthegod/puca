import { useCallback, useEffect, useRef, useState } from "react";
import {
	type BusFavorite,
	type BusStopFavorite,
	type Favorites,
	type LuasStopFavorite,
	loadFavorites,
	removeBus,
	removeLuasStop,
	removeStop,
	removeTrain,
	saveFavorites,
	type TrainFavorite,
	toggleBus,
	toggleLuasStop,
	toggleStop,
	toggleTrain,
} from "../favorites";

export function useFavorites() {
	const [favs, setFavs] = useState<Favorites>(() => loadFavorites());
	const didMount = useRef(false);
	const dirtyRef = useRef(false);
	const latestFavsRef = useRef(favs);
	latestFavsRef.current = favs;

	const flushFavorites = useCallback(() => {
		if (!dirtyRef.current) return;
		saveFavorites(latestFavsRef.current);
		dirtyRef.current = false;
	}, []);

	useEffect(() => {
		const onVisibility = () => {
			if (document.hidden) flushFavorites();
		};
		window.addEventListener("pagehide", flushFavorites);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("pagehide", flushFavorites);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [flushFavorites]);

	useEffect(() => {
		if (!didMount.current) {
			didMount.current = true;
			return;
		}
		dirtyRef.current = true;
		const id = window.setTimeout(flushFavorites, 0);
		return () => window.clearTimeout(id);
	}, [favs, flushFavorites]);

	return {
		favs,
		toggleBus: useCallback(
			(f: BusFavorite) => setFavs((s) => toggleBus(s, f)),
			[],
		),
		toggleTrain: useCallback(
			(f: TrainFavorite) => setFavs((s) => toggleTrain(s, f)),
			[],
		),
		toggleStop: useCallback(
			(f: BusStopFavorite) => setFavs((s) => toggleStop(s, f)),
			[],
		),
		toggleLuasStop: useCallback(
			(f: LuasStopFavorite) => setFavs((s) => toggleLuasStop(s, f)),
			[],
		),
		removeBus: useCallback((k: string) => setFavs((s) => removeBus(s, k)), []),
		removeTrain: useCallback(
			(k: string) => setFavs((s) => removeTrain(s, k)),
			[],
		),
		removeStop: useCallback(
			(k: string) => setFavs((s) => removeStop(s, k)),
			[],
		),
		removeLuasStop: useCallback(
			(k: string) => setFavs((s) => removeLuasStop(s, k)),
			[],
		),
	};
}
