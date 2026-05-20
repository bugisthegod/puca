import { useEffect, useState } from "react";
import { trackEvent } from "../analytics";
import { readRealtimeHealth } from "../realtime";
import type { BusOperator, BusVehicle, RealtimeHealth, Train } from "../types";
import { isInServiceHours } from "../utils";
import type { Mode } from "./useVehicleMap";

export function trainSignature(train: Train): string {
	return [
		train.code,
		train.status,
		train.lat.toFixed(5),
		train.lng.toFixed(5),
		train.message,
		train.date,
	].join("|");
}

export function busVehicleSignature(vehicle: BusVehicle): string {
	return [
		vehicle.tripId || vehicle.label,
		vehicle.routeId,
		vehicle.directionId,
		vehicle.lat.toFixed(5),
		vehicle.lng.toFixed(5),
		Math.round(vehicle.bearing ?? -1),
		Math.round(vehicle.speed ?? -1),
		vehicle.stale ? 1 : 0,
	].join("|");
}

export function snapshotSignature<T>(
	items: T[],
	itemSignature: (item: T) => string,
): string {
	return items.map(itemSignature).sort().join("\n");
}

export function useVehiclePolling(
	mode: Mode,
	busOperator: BusOperator,
	busRoute: string | null,
	busDirection: string | null,
) {
	const [trains, setTrains] = useState<Train[]>([]);
	const [buses, setBuses] = useState<BusVehicle[]>([]);
	const [busRealtimeHealth, setBusRealtimeHealth] =
		useState<RealtimeHealth | null>(null);
	const [dataChangedAt, setDataChangedAt] = useState<number | null>(null);
	const [clockNow, setClockNow] = useState(() => Date.now());
	const [inService, setInService] = useState<boolean>(() =>
		isInServiceHours(mode),
	);
	const [trainsLoaded, setTrainsLoaded] = useState(false);

	useEffect(() => {
		const id = setInterval(() => setClockNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		const update = () => setInService(isInServiceHours(mode));
		update();
		const id = setInterval(update, 60_000);
		return () => clearInterval(id);
	}, [mode]);

	useEffect(() => {
		let cancelled = false;
		let lastSignature: string | null = null;

		function markChangedIfNeeded(nextSignature: string) {
			if (nextSignature === lastSignature) return;
			lastSignature = nextSignature;
			setDataChangedAt(Date.now());
		}

		async function fetchTrains() {
			try {
				const res = await fetch("/api/trains");
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data: Train[] = await res.json();
				if (cancelled) return;
				setTrains(data);
				setTrainsLoaded(true);
				markChangedIfNeeded(snapshotSignature(data, trainSignature));
			} catch (err) {
				if (cancelled) return;
				trackEvent("event/error/api-trains");
				console.error("Failed to fetch trains:", err);
			}
		}

		async function fetchBuses(
			operator: BusOperator,
			route: string,
			direction: string,
		) {
			try {
				const res = await fetch(
					`/api/bus/vehicles?operator=${encodeURIComponent(operator)}&route=${encodeURIComponent(route)}&direction=${encodeURIComponent(direction)}`,
				);
				const realtimeHealth = readRealtimeHealth(res);
				if (!res.ok) {
					if (!cancelled) setBusRealtimeHealth(realtimeHealth);
					throw new Error(`HTTP ${res.status}`);
				}
				const data: BusVehicle[] = await res.json();
				if (cancelled) return;
				setBuses(data);
				setBusRealtimeHealth(realtimeHealth);
				markChangedIfNeeded(snapshotSignature(data, busVehicleSignature));
			} catch (err) {
				if (cancelled) return;
				trackEvent("event/error/api-bus-vehicles");
				console.error("Failed to fetch buses:", err);
			}
		}

		async function fetchAllBuses(operator: BusOperator) {
			try {
				const res = await fetch(
					`/api/bus/vehicles?operator=${encodeURIComponent(operator)}`,
				);
				const realtimeHealth = readRealtimeHealth(res);
				if (!res.ok) {
					if (!cancelled) setBusRealtimeHealth(realtimeHealth);
					throw new Error(`HTTP ${res.status}`);
				}
				const data: BusVehicle[] = await res.json();
				if (cancelled) return;
				setBuses(data);
				setBusRealtimeHealth(realtimeHealth);
				markChangedIfNeeded(snapshotSignature(data, busVehicleSignature));
			} catch (err) {
				if (cancelled) return;
				trackEvent("event/error/api-bus-vehicles");
				console.error("Failed to fetch all buses:", err);
			}
		}

		if (!inService) {
			setTrains([]);
			setBuses([]);
			setBusRealtimeHealth(null);
			setTrainsLoaded(false);
			setDataChangedAt(null);
			return;
		}

		setBuses([]);
		setBusRealtimeHealth(null);
		setDataChangedAt(null);

		let poll: (() => void) | null = null;
		let intervalMs = 0;
		if (mode === "train") {
			poll = fetchTrains;
			intervalMs = 30_000;
		} else if (busRoute && busDirection) {
			const route = busRoute;
			const dir = busDirection;
			poll = () => fetchBuses(busOperator, route, dir);
			intervalMs = 15_000;
		} else if (!busRoute) {
			poll = () => fetchAllBuses(busOperator);
			intervalMs = 15_000;
		} else {
			setBuses([]);
			setBusRealtimeHealth(null);
			setDataChangedAt(null);
			return;
		}

		let interval: ReturnType<typeof setInterval> | null = null;
		const start = () => {
			if (interval || !poll) return;
			poll();
			interval = setInterval(poll, intervalMs);
		};
		const stop = () => {
			if (!interval) return;
			clearInterval(interval);
			interval = null;
		};

		if (mode === "train") setTrainsLoaded(false);
		if (!document.hidden) start();
		const onVisibility = () => (document.hidden ? stop() : start());
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", onVisibility);
			stop();
		};
	}, [mode, busOperator, busRoute, busDirection, inService]);

	const lastUpdatedAgeSec =
		dataChangedAt === null
			? null
			: Math.max(0, Math.floor((clockNow - dataChangedAt) / 1000));

	return {
		trains,
		buses,
		busRealtimeHealth,
		lastUpdatedAgeSec,
		inService,
		trainsLoaded,
	};
}
