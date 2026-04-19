import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Train, BusVehicle, BusOperator } from "./types";
import { isInServiceHours, SERVICE_RESUME_LABEL, type Filter } from "./utils";
import { useTrainMap, type Mode } from "./hooks/useTrainMap";
import { useReminderPoller } from "./hooks/useReminderPoller";
import { loadReminder, clearReminder, onReminderChange, type Reminder } from "./reminder";
import { loadSession, saveSession } from "./session";
import InfoPanel from "./components/InfoPanel";
import SearchPanel from "./components/SearchPanel";
import BusSearchPanel from "./components/BusSearchPanel";
import "./style.css";

const savedSession = loadSession();

function App() {
  const [mode, setMode] = useState<Mode>(savedSession.mode ?? "train");
  const [trains, setTrains] = useState<Train[]>([]);
  const [buses, setBuses] = useState<BusVehicle[]>([]);
  const [busOperator, setBusOperator] = useState<BusOperator>(savedSession.busOperator ?? "dublinbus");
  const [busRoute, setBusRoute] = useState<string | null>(savedSession.busRoute ?? null);
  const [busDirection, setBusDirection] = useState<string | null>(savedSession.busDirection ?? null);
  const [busShape, setBusShape] = useState<{ [dir: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[] } } | null>(null);
  const [filter, setFilter] = useState<Filter>(savedSession.filter ?? "all");
  const [lastUpdated, setLastUpdated] = useState<string>("Updated: —");
  const [searchCodes, setSearchCodes] = useState<string[] | null>(null);
  const [inService, setInService] = useState<boolean>(() => isInServiceHours(mode));
  const mapRef = useRef<HTMLDivElement>(null);

  const { focusTrain, locateUser } = useTrainMap(mapRef, trains, filter, searchCodes, mode, buses, busShape, busDirection, busOperator, {
    currentBusRoute: busRoute,
    onSelectBusRoute: (route, direction) => {
      setBusRoute(route);
      setBusDirection(direction);
    },
  });
  const [locating, setLocating] = useState(false);
  const [reminder, setReminder] = useState<Reminder | null>(() => loadReminder());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    return onReminderChange(setReminder);
  }, []);

  useEffect(() => {
    const save = () => saveSession({ mode, filter, busOperator, busRoute, busDirection });
    const onVisibility = () => { if (document.hidden) save(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, [mode, filter, busOperator, busRoute, busDirection]);

  // iOS Safari overlays the keyboard on top of the viewport instead of
  // shrinking it (unlike Android), so bottom-fixed elements get covered and
  // can get stranded off-screen after dismissal. Toggle a body class while a
  // text field is focused so CSS can hide them.
  useEffect(() => {
    function isTextInput(t: EventTarget | null) {
      if (!(t instanceof HTMLElement)) return false;
      return t.matches("input, textarea, [contenteditable='true']");
    }
    function onFocusIn(e: FocusEvent) {
      if (isTextInput(e.target)) document.body.classList.add("kb-open");
    }
    function onFocusOut(e: FocusEvent) {
      if (isTextInput(e.target)) document.body.classList.remove("kb-open");
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useReminderPoller({ onTrigger: (msg) => setToast(msg) });

  async function handleLocate() {
    if (locating) return;
    setLocating(true);
    try {
      await locateUser();
    } catch (err) {
      alert(`Could not get your location: ${(err as Error).message}`);
    } finally {
      setLocating(false);
    }
  }

  async function fetchTrains() {
    try {
      const res = await fetch("/api/trains");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Train[] = await res.json();
      setTrains(data);
      setLastUpdated(`Updated: ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error("Failed to fetch trains:", err);
    }
  }

  async function fetchBuses(operator: BusOperator, route: string, direction: string) {
    try {
      const res = await fetch(
        `/api/bus/vehicles?operator=${encodeURIComponent(operator)}&route=${encodeURIComponent(route)}&direction=${encodeURIComponent(direction)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BusVehicle[] = await res.json();
      setBuses(data);
      setLastUpdated(`Updated: ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error("Failed to fetch buses:", err);
    }
  }

  async function fetchAllBuses(operator: BusOperator) {
    try {
      const res = await fetch(`/api/bus/vehicles?operator=${encodeURIComponent(operator)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BusVehicle[] = await res.json();
      setBuses(data);
      setLastUpdated(`Updated: ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error("Failed to fetch all buses:", err);
    }
  }

  useEffect(() => {
    const update = () => setInService(isInServiceHours(mode));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (!inService) {
      setTrains([]);
      setBuses([]);
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

    if (!document.hidden) start();
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [mode, busOperator, busRoute, busDirection, inService]);

  useEffect(() => {
    if (!busRoute) {
      setBusShape(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/bus/shape/${encodeURIComponent(busRoute)}?operator=${encodeURIComponent(busOperator)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setBusShape(data);
      })
      .catch(() => {
        if (!cancelled) setBusShape(null);
      });
    return () => {
      cancelled = true;
    };
  }, [busRoute, busOperator]);

  function handleBusOperatorChange(op: BusOperator) {
    setBusOperator(op);
    setBusRoute(null);
    setBusDirection(null);
    setBuses([]);
  }

  const vehicleCount = mode === "train" ? trains.filter((t) => t.status === "R").length : buses.length;

  return (
    <>
      <div id="map" ref={mapRef} />
      {reminder && (
        <div className="reminder-chip" role="status">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M12 2a2 2 0 0 0-2 2v.6A6 6 0 0 0 6 10v4l-2 2v1h16v-1l-2-2v-4a6 6 0 0 0-4-5.4V4a2 2 0 0 0-2-2zm-2 17a2 2 0 0 0 4 0h-4z" />
          </svg>
          <span className="reminder-chip__text">
            {reminder.trainCode} → {reminder.destStationName}
          </span>
          <button
            type="button"
            className="reminder-chip__close"
            onClick={clearReminder}
            aria-label="Cancel reminder"
            title="Cancel reminder"
          >
            ×
          </button>
        </div>
      )}
      {toast && (
        <div className="reminder-toast" role="alert">
          <span>{toast}</span>
          <button
            type="button"
            className="reminder-toast__close"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <button
        type="button"
        className={`locate-btn${locating ? " loading" : ""}`}
        onClick={handleLocate}
        disabled={locating}
        aria-label="Locate me"
        title="Locate me"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>
      {mode === "train" ? (
        <SearchPanel
          onSearch={(codes) => setSearchCodes(codes.length > 0 ? codes : [])}
          onClear={() => setSearchCodes(null)}
          onTrainSelect={focusTrain}
        />
      ) : (
        <BusSearchPanel
          onSelectRoute={(r, op) => {
            if (op && op !== busOperator) {
              setBusOperator(op);
              setBuses([]);
            }
            setBusRoute(r);
            setBusDirection(null);
          }}
          selectedRoute={busRoute}
          onSelectDirection={setBusDirection}
          selectedDirection={busDirection}
          busShape={busShape}
        />
      )}
      {mode === "bus" && busRoute !== null && (
        <button
          className="back-to-all-btn"
          onClick={() => { setBusRoute(null); setBusDirection(null); }}
        >
          &larr; All buses
        </button>
      )}
      <InfoPanel
        vehicleCount={vehicleCount}
        lastUpdated={lastUpdated}
        mode={mode}
        filter={filter}
        inService={inService}
        resumeLabel={SERVICE_RESUME_LABEL}
        busOperator={busOperator}
        onModeChange={(m) => {
          setMode(m);
          setSearchCodes(null);
          setBusRoute(null);
          setBusDirection(null);
        }}
        onFilterChange={setFilter}
        onBusOperatorChange={handleBusOperatorChange}
      />
    </>
  );
}

// PWA manifest & icon (injected via JS to avoid Bun bundler resolving them)
const manifest = document.createElement("link");
manifest.rel = "manifest";
manifest.href = "/manifest.json";
document.head.appendChild(manifest);

const appleIcon = document.createElement("link");
appleIcon.rel = "apple-touch-icon";
appleIcon.href = "/icon-192.png";
document.head.appendChild(appleIcon);

const faviconSvg = document.createElement("link");
faviconSvg.rel = "icon";
faviconSvg.type = "image/svg+xml";
faviconSvg.href = "/icon.svg";
document.head.appendChild(faviconSvg);

const faviconPng = document.createElement("link");
faviconPng.rel = "icon";
faviconPng.type = "image/png";
faviconPng.setAttribute("sizes", "192x192");
faviconPng.href = "/icon-192.png";
document.head.appendChild(faviconPng);

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
