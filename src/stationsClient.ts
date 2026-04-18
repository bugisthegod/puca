import type { Station } from "./types";

let stationsPromise: Promise<Station[]> | null = null;

export function getStationsOnce(): Promise<Station[]> {
  if (stationsPromise) return stationsPromise;
  stationsPromise = (async () => {
    try {
      const r = await fetch("/api/stations");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as Station[];
    } catch {
      // Reset so the next caller retries instead of receiving a memoized empty list.
      stationsPromise = null;
      return [] as Station[];
    }
  })();
  return stationsPromise;
}
