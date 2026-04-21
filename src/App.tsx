import L from "leaflet";
import "leaflet.markercluster";
(window as unknown as { L: typeof L }).L = L;

import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Train, BusVehicle, BusOperator } from "./types";
import { isInServiceHours, SERVICE_RESUME_LABEL, type Filter } from "./utils";
import { useTrainMap, type Mode } from "./hooks/useTrainMap";
import { loadSession, saveSession } from "./session";
import InfoPanel from "./components/InfoPanel";
import SearchPanel from "./components/SearchPanel";
import BusSearchPanel from "./components/BusSearchPanel";
import AboutModal from "./components/AboutModal";
import FavoritesModal from "./components/FavoritesModal";
import OnboardingTour, { type TourStep } from "./components/OnboardingTour";
import PucaMark from "./components/PucaMark";
import OfflineBanner from "./components/OfflineBanner";
import { registerServiceWorker } from "./sw-register";
import { useFavorites } from "./hooks/useFavorites";
import { hasBus, hasTrain, MAX_BUS_FAVORITES, MAX_TRAIN_FAVORITES, type TrainFavorite } from "./favorites";
import "./style.css";

const savedSession = loadSession();
const ABOUT_SEEN_KEY = "puca:about-seen";
const TOUR_SEEN_KEY = "puca:tour-seen-v1";
const THEME_KEY = "puca:theme";
type ThemePref = "light" | "dark" | "system";

function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

// Apply saved theme before React renders to avoid a flash of the wrong theme.
document.documentElement.dataset.theme = resolveTheme(readThemePref());

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to Púca",
    body: "A live map of Ireland's trains and buses. Quick tour — takes 20 seconds.",
  },
  {
    target: "#info-panel",
    title: "Switch mode",
    body: "Toggle between Train and Bus, or filter what's shown.",
  },
  {
    target: "#search-panel",
    title: "Search",
    body: "Find trains between two stations, or a bus route by number.",
  },
  {
    title: "Tap a vehicle",
    body: "Tap any bus or train on the map for live arrivals, delays, and stops.",
  },
  {
    target: ".about-fab",
    title: "Settings & help",
    body: "Toggle dark mode, enable the compass, revisit this tour, or find install tips here.",
  },
  {
    target: ".fav-fab",
    title: "Save favourites",
    body: "Star a route or train search, then come back to it from here.",
  },
  {
    target: ".locate-btn",
    title: "Locate me",
    body: "Centre the map on your position to see what's nearby. You're all set!",
  },
];

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

  const { focusTrain, locateUser, getMapView, compassPref, startCompass, stopCompass } = useTrainMap(mapRef, trains, filter, searchCodes, mode, buses, busShape, busDirection, busOperator, {
    currentBusRoute: busRoute,
    onSelectBusRoute: (route, direction) => {
      setBusRoute(route);
      setBusDirection(direction);
    },
    initialView: savedSession.mapView ?? null,
  });
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [seenAbout, setSeenAbout] = useState<boolean>(() => {
    try { return localStorage.getItem(ABOUT_SEEN_KEY) === "1"; } catch { return true; }
  });
  const [showTour, setShowTour] = useState<boolean>(() => {
    try { return localStorage.getItem(TOUR_SEEN_KEY) !== "1"; } catch { return false; }
  });
  const [theme, setTheme] = useState<ThemePref>(readThemePref);
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
      // Notify useMapInstance to swap the base tile layer.
      window.dispatchEvent(new Event("puca:themechange"));
    };
    apply();
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    // Only track OS preference changes while the user is on "system" —
    // explicit light/dark choices should win regardless of OS.
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);
  function closeTour() {
    setShowTour(false);
    try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch {}
  }
  function openTour() {
    setShowTour(true);
  }
  const { favs, toggleBus, toggleTrain, removeBus, removeTrain } = useFavorites();
  const [showFavs, setShowFavs] = useState(false);
  const [searchResetKey, setSearchResetKey] = useState(0);

  const busFavKey = busRoute && busDirection ? { shortName: busRoute, operator: busOperator, direction: busDirection } : null;
  const busIsFav = busFavKey ? hasBus(favs, busFavKey) : false;
  function showFavLimitToast(kind: "bus" | "train", max: number) {
    const msg = `${kind === "bus" ? "Bus" : "Train"} favorites full (${max} max). Remove one first.`;
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000);
  }
  const onToggleBusFav = () => {
    if (!busFavKey) return;
    if (!busIsFav && favs.buses.length >= MAX_BUS_FAVORITES) {
      showFavLimitToast("bus", MAX_BUS_FAVORITES);
      return;
    }
    const headsign = busShape?.[busDirection!]?.headsign ?? busDirection!;
    toggleBus({ ...busFavKey, headsign });
  };
  const tryToggleTrain = (f: TrainFavorite) => {
    if (!hasTrain(favs, f) && favs.trains.length >= MAX_TRAIN_FAVORITES) {
      showFavLimitToast("train", MAX_TRAIN_FAVORITES);
      return;
    }
    toggleTrain(f);
  };

  function openAbout() {
    setShowAbout(true);
    if (!seenAbout) {
      setSeenAbout(true);
      try { localStorage.setItem(ABOUT_SEEN_KEY, "1"); } catch {}
    }
  }

  const lastMapViewRef = useRef(savedSession.mapView ?? null);
  useEffect(() => {
    const save = () => {
      const mv = getMapView();
      if (mv) lastMapViewRef.current = mv;
      saveSession({ mode, filter, busOperator, busRoute, busDirection, mapView: lastMapViewRef.current });
    };
    const onVisibility = () => { if (document.hidden) save(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, [mode, filter, busOperator, busRoute, busDirection, getMapView]);

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
    if (op === busOperator) return;
    setBusOperator(op);
    setBusRoute(null);
    setBusDirection(null);
    setBuses([]);
  }

  const vehicleCount = mode === "train" ? trains.filter((t) => t.status === "R").length : buses.length;

  return (
    <>
      <div id="map" ref={mapRef} />
      <OfflineBanner />
      {toast && (
        <div className="app-toast" role="alert">
          <span>{toast}</span>
          <button
            type="button"
            className="app-toast__close"
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
      <button
        type="button"
        className="fav-fab"
        onClick={() => setShowFavs(true)}
        aria-label="Favorites"
        title="Favorites"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.9z" />
        </svg>
      </button>
      <button
        type="button"
        className="about-fab"
        onClick={openAbout}
        aria-label="About Púca"
        title="About Púca"
      >
        <PucaMark size={28} />
        {!seenAbout && <span className="about-fab__badge" aria-hidden="true" />}
      </button>
      {showAbout && (
        <AboutModal
          onClose={() => setShowAbout(false)}
          onShowTour={() => { setShowAbout(false); openTour(); }}
          theme={theme}
          onSetTheme={setTheme}
          compassPref={compassPref}
          onToggleCompass={(next) => {
            if (next) void startCompass();
            else stopCompass();
          }}
        />
      )}
      {showTour && <OnboardingTour steps={TOUR_STEPS} onClose={closeTour} />}
      {showFavs && (
        <FavoritesModal
          onClose={() => setShowFavs(false)}
          favs={favs}
          onPickBus={(f) => {
            setMode("bus");
            setBusOperator(f.operator);
            setBusRoute(f.shortName);
            setBusDirection(f.direction);
            setBuses([]);
          }}
          onPickTrain={(f) => {
            localStorage.setItem("search", JSON.stringify({ from: f.from, to: f.to, fromQuery: f.fromName, toQuery: f.toName }));
            if (mode !== "train") setMode("train");
            setSearchResetKey((k) => k + 1);
          }}
          onRemoveBus={removeBus}
          onRemoveTrain={removeTrain}
        />
      )}
      {mode === "train" ? (
        <SearchPanel
          key={searchResetKey}
          onSearch={(codes) => setSearchCodes(codes.length > 0 ? codes : [])}
          onClear={() => setSearchCodes(null)}
          onTrainSelect={focusTrain}
          favs={favs}
          onToggleTrain={tryToggleTrain}
          defaultCollapsed={!inService}
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
          isFavorite={busIsFav}
          onToggleFavorite={onToggleBusFav}
          defaultCollapsed={!inService}
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

registerServiceWorker();
