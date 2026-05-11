import { useEffect, useState } from "react";
import type { BusOperator, BusVehicle, Train } from "../types";
import { isInServiceHours } from "../utils";
import type { Mode } from "./useTrainMap";

export function useVehiclePolling(
  mode: Mode,
  busOperator: BusOperator,
  busRoute: string | null,
  busDirection: string | null,
  onEmptyTrains?: () => void,
) {
  const [trains, setTrains] = useState<Train[]>([]);
  const [buses, setBuses] = useState<BusVehicle[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [inService, setInService] = useState<boolean>(() => isInServiceHours(mode));
  const [trainsLoaded, setTrainsLoaded] = useState(false);

  useEffect(() => {
    const update = () => setInService(isInServiceHours(mode));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrains() {
      try {
        const res = await fetch("/api/trains");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Train[] = await res.json();
        if (cancelled) return;
        setTrains(data);
        setTrainsLoaded(true);
        if (data.length === 0) onEmptyTrains?.();
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to fetch trains:", err);
      }
    }

    async function fetchBuses(operator: BusOperator, route: string, direction: string) {
      try {
        const res = await fetch(
          `/api/bus/vehicles?operator=${encodeURIComponent(operator)}&route=${encodeURIComponent(route)}&direction=${encodeURIComponent(direction)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: BusVehicle[] = await res.json();
        if (cancelled) return;
        setBuses(data);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to fetch buses:", err);
      }
    }

    async function fetchAllBuses(operator: BusOperator) {
      try {
        const res = await fetch(`/api/bus/vehicles?operator=${encodeURIComponent(operator)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: BusVehicle[] = await res.json();
        if (cancelled) return;
        setBuses(data);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to fetch all buses:", err);
      }
    }

    if (!inService) {
      setTrains([]);
      setBuses([]);
      setTrainsLoaded(false);
      return;
    }

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
  }, [mode, busOperator, busRoute, busDirection, inService, onEmptyTrains]);

  return { trains, buses, setBuses, lastUpdated, inService, trainsLoaded };
}
