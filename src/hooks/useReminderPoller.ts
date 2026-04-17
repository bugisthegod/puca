import { useEffect, useRef } from "react";
import type { TrainMovement } from "../types";
import {
  loadReminder,
  saveReminder,
  clearReminder,
  onReminderChange,
  fireNativeNotification,
  type Reminder,
} from "../reminder";

// Upstream /getTrainMovementsXML has a 30s server-side cache, so polling any
// faster just burns network — 30s is the sweet spot.
const POLL_INTERVAL_MS = 30_000;

interface UseReminderPollerOptions {
  onTrigger: (message: string) => void;
}

export function useReminderPoller({ onTrigger }: UseReminderPollerOptions): void {
  const reminderRef = useRef<Reminder | null>(loadReminder());
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastTickAt = 0;

    async function tick(): Promise<void> {
      const r = reminderRef.current;
      if (!r || cancelled) return;
      lastTickAt = Date.now();
      try {
        const res = await fetch(`/api/train/${encodeURIComponent(r.trainCode)}`);
        if (!res.ok || cancelled) return;
        const movements: TrainMovement[] = await res.json();
        if (cancelled || !reminderRef.current) return;

        if (movements.length === 0) return;

        const destIdx = movements.findIndex((m) => m.stationCode === r.destStationCode);
        if (destIdx < 0) {
          clearReminder();
          return;
        }

        const currentIdx = movements.findIndex((m) => m.stopType === "C");

        // Passed destination — nothing to alert about
        if (currentIdx >= 0 && currentIdx > destIdx) {
          clearReminder();
          return;
        }

        // Fire after the train has departed the station immediately before
        // the user's destination. Two signals indicate "departed":
        //   1. Upstream populated the actual departure time on that station
        //   2. The current-stop tag has moved past it
        // First detection wins; notified flag prevents re-fire on later polls.
        const prevStation = movements[destIdx - 1];
        if (!prevStation) return;
        const prevDeparted = (prevStation.departure ?? "").trim() !== "";
        const pastPrev = currentIdx >= 0 && currentIdx >= destIdx;

        if ((prevDeparted || pastPrev) && !r.notified) {
          const title = `Your stop is next`;
          const body = `Train ${r.trainCode} just left ${prevStation.stationName}. Prepare to get off at ${r.destStationName}.`;
          fireNativeNotification(title, body);
          onTriggerRef.current(`${r.trainCode}: left ${prevStation.stationName} — ${r.destStationName} is next.`);
          const updated: Reminder = { ...r, notified: true };
          reminderRef.current = updated;
          saveReminder(updated);
        }
      } catch {
        // network / transient — retry next interval
      }
    }

    function start(): void {
      if (timer || !reminderRef.current) return;
      void tick();
      timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    }

    function stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }

    // Catch-up tick when the tab returns to focus (browsers throttle setInterval
    // heavily on hidden tabs — a reminder could be arbitrarily stale).
    function onVisibility(): void {
      if (document.visibilityState !== "visible") return;
      if (!reminderRef.current) return;
      if (Date.now() - lastTickAt > 10_000) void tick();
    }

    const unsub = onReminderChange((r) => {
      reminderRef.current = r;
      if (r) start(); else stop();
    });
    document.addEventListener("visibilitychange", onVisibility);

    // Expire yesterday's leftover reminder on mount
    const initial = reminderRef.current;
    if (initial && initial.date !== todayISO()) {
      clearReminder();
    } else if (initial) {
      start();
    }

    return () => {
      cancelled = true;
      stop();
      unsub();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
