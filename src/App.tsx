import L from "leaflet";
import "leaflet.markercluster";
(window as unknown as { L: typeof L }).L = L;

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { Train, BusVehicle, BusOperator, FocusContext } from "./types";
import { isInServiceHours, SERVICE_RESUME_LABEL, type Filter } from "./utils";
import { useTrainMap, type Mode } from "./hooks/useTrainMap";
import { clearBusSearchSession, loadBusSearchSession, loadSession, saveBusSearchSession, saveSession, type BusSearchTab } from "./session";
import InfoPanel from "./components/InfoPanel";
import SearchPanel from "./components/SearchPanel";
import BusSearchPanel, { type BusStopSummary } from "./components/BusSearchPanel";
import AboutModal from "./components/AboutModal";
import FavoritesModal from "./components/FavoritesModal";
import OnboardingTour, { type TourStep } from "./components/OnboardingTour";
import PucaMark from "./components/PucaMark";
import OfflineBanner from "./components/OfflineBanner";
import { registerServiceWorker } from "./sw-register";
import { useFavorites } from "./hooks/useFavorites";
import { hasBus, hasTrain, hasStop, totalFavorites, MAX_FAVORITES, type BusFavorite, type TrainFavorite, type BusStopFavorite } from "./favorites";
import { useLocale } from "./i18n";
import "./style.css";

const savedSession = loadSession();
const savedBusSearch = loadBusSearchSession();
const ABOUT_SEEN_KEY = "puca:about-seen";
const TOUR_SEEN_KEY = "puca:tour-seen-v1";
const THEME_KEY = "puca:theme";
type ThemePref = "light" | "dark" | "system";
const FAB_SIDE_KEY = "puca:fab-side";
type FabSide = "left" | "right";

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

function readFabSide(): FabSide {
  try {
    const v = localStorage.getItem(FAB_SIDE_KEY);
    if (v === "left" || v === "right") return v;
  } catch {}
  return "right";
}

// Apply saved theme + FAB side before React renders to avoid a flash/jump.
document.documentElement.dataset.theme = resolveTheme(readThemePref());
document.documentElement.dataset.fabSide = readFabSide();

// iOS (Safari/WebKit) is the only platform that gates device orientation
// behind a per-page-load permission prompt — Android just works. Use the
// presence of requestPermission() as the signal so we surface the compass
// toggle only where the user needs it to re-grant after each reload.
const needsCompassToggle =
  typeof DeviceOrientationEvent !== "undefined" &&
  typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === "function";

function App() {
  const { locale, t } = useLocale();
  const tourSteps: TourStep[] = useMemo(() => [
    {
      title: t("tour.welcome.title"),
      body: t("tour.welcome.body"),
    },
    {
      target: "#info-panel",
      title: t("tour.mode.title"),
      body: t("tour.mode.body"),
    },
    {
      target: "#search-panel",
      title: t("tour.search.title"),
      body: t("tour.search.body"),
    },
    {
      title: t("tour.tap.title"),
      body: t("tour.tap.body"),
    },
    {
      target: ".about-fab",
      title: t("tour.settings.title"),
      body: t("tour.settings.body"),
    },
    {
      target: ".fav-fab",
      title: t("tour.favs.title"),
      body: t("tour.favs.body"),
    },
    {
      target: ".locate-btn",
      title: t("tour.locate.title"),
      body: t("tour.locate.body"),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale]);
  const [mode, setMode] = useState<Mode>(savedSession.mode ?? "train");
  const [trains, setTrains] = useState<Train[]>([]);
  const [buses, setBuses] = useState<BusVehicle[]>([]);
  const [busOperator, setBusOperator] = useState<BusOperator>(savedSession.busOperator ?? "dublinbus");
  const [busRoute, setBusRoute] = useState<string | null>(savedBusSearch.busRoute ?? null);
  const [busDirection, setBusDirection] = useState<string | null>(savedBusSearch.busDirection ?? null);
  const [busSearchTab, setBusSearchTab] = useState<BusSearchTab>(savedBusSearch.busSearchTab ?? "route");
  const [busStopId, setBusStopId] = useState<string | null>(savedBusSearch.busStopId ?? null);
  const [busStopOperator, setBusStopOperator] = useState<BusOperator | null>(savedBusSearch.busStopOperator ?? null);
  const [busStopSummary, setBusStopSummary] = useState<BusStopSummary | null>(null);
  const [infoPanelDrilledIn, setInfoPanelDrilledIn] = useState(false);
  const [arrivalFocusResetSignal, setArrivalFocusResetSignal] = useState(0);
  const [arrivalFocusUnavailable, setArrivalFocusUnavailable] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [focusContext, setFocusContext] = useState<FocusContext | null>(null);
  const [busShape, setBusShape] = useState<{ [dir: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[]; variants?: { shapeId: string; tripCount: number; branches: [number, number][][] }[] } } | null>(null);
  const [filter, setFilter] = useState<Filter>(savedSession.filter ?? "all");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [searchCodes, setSearchCodes] = useState<string[] | null>(null);
  const [inService, setInService] = useState<boolean>(() => isInServiceHours(mode));
  const mapRef = useRef<HTMLDivElement>(null);

  // When a stop-arrival is focused, hide every other bus from the map so the
  // user sees only their bus + the partial route to their stop. Flipping back
  // to full fleet is one click on the "All buses" button.
  const visibleBuses = focusContext
    ? buses.filter((b) => b.tripId === focusContext.tripId)
    : buses;

  const { focusTrain, locateUser, getMapView, compassPref, startCompass, stopCompass } = useTrainMap(mapRef, trains, filter, searchCodes, mode, visibleBuses, busShape, busDirection, busOperator, {
    currentBusRoute: busRoute,
    onSelectBusRoute: (route, direction) => {
      setBusRoute(route);
      setBusDirection(direction);
      setFocusContext(null);
      setArrivalFocusUnavailable(false);
    },
    initialView: savedSession.mapView ?? null,
    focusContext,
    onFocusSegmentStatus: (status) => {
      setArrivalFocusUnavailable(status === "unavailable");
    },
  });
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<{ title: string; body?: string } | null>(null);
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
  const [fabSide, setFabSide] = useState<FabSide>(readFabSide);
  useEffect(() => {
    document.documentElement.dataset.fabSide = fabSide;
    try { localStorage.setItem(FAB_SIDE_KEY, fabSide); } catch {}
  }, [fabSide]);
  function closeTour() {
    setShowTour(false);
    try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch {}
  }
  function openTour() {
    setShowTour(true);
  }
  const { favs, toggleBus, toggleTrain, toggleStop, removeBus, removeTrain, removeStop } = useFavorites();
  const [showFavs, setShowFavs] = useState(false);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const favsRef = useRef(favs);
  favsRef.current = favs;
  const busOperatorRef = useRef(busOperator);
  busOperatorRef.current = busOperator;

  const busFavKey = useMemo(
    () => busRoute && busDirection ? { shortName: busRoute, operator: busOperator, direction: busDirection } : null,
    [busDirection, busOperator, busRoute],
  );
  const busIsFav = busFavKey ? hasBus(favs, busFavKey) : false;
  const stopIsFav = busStopId && busStopOperator ? hasStop(favs, { stopId: busStopId, operator: busStopOperator }) : false;
  const showToast = useCallback((title: string, body?: string, ms = 3000) => {
    const next = { title, body };
    setToast(next);
    setTimeout(() => setToast((t) => (t?.title === title ? null : t)), ms);
  }, []);
  const showFavLimitToast = useCallback(() => {
    showToast(t("toast.fav.full", { max: MAX_FAVORITES }));
  }, [showToast, t]);
  const onToggleBusFav = useCallback(() => {
    if (!busFavKey) return;
    const latestFavs = favsRef.current;
    if (!busIsFav && totalFavorites(latestFavs) >= MAX_FAVORITES) {
      showFavLimitToast();
      return;
    }
    const headsign = busShape?.[busDirection!]?.headsign ?? busDirection!;
    toggleBus({ ...busFavKey, headsign });
  }, [busDirection, busFavKey, busIsFav, busShape, showFavLimitToast, toggleBus]);
  const tryToggleTrain = useCallback((f: TrainFavorite) => {
    const latestFavs = favsRef.current;
    if (!hasTrain(latestFavs, f) && totalFavorites(latestFavs) >= MAX_FAVORITES) {
      showFavLimitToast();
      return;
    }
    toggleTrain(f);
  }, [showFavLimitToast, toggleTrain]);
  const onToggleStopFav = useCallback((stop: { id: string; name: string; code: string; operator: BusOperator }) => {
    const fav: BusStopFavorite = {
      stopId: stop.id,
      operator: stop.operator,
      stopCode: stop.code,
      stopName: stop.name,
    };
    const latestFavs = favsRef.current;
    if (!hasStop(latestFavs, fav) && totalFavorites(latestFavs) >= MAX_FAVORITES) {
      showFavLimitToast();
      return;
    }
    toggleStop(fav);
  }, [showFavLimitToast, toggleStop]);

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
      saveSession({ mode, filter, busOperator, mapView: lastMapViewRef.current });
    };
    const onVisibility = () => { if (document.hidden) save(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
    };
  }, [mode, filter, busOperator, getMapView]);

  useEffect(() => {
    const current = loadBusSearchSession();
    saveBusSearchSession({
      busRoute,
      busDirection,
      busSearchTab,
      busStopId,
      busStopOperator,
      routeQuery: current.routeQuery ?? "",
      stopQuery: current.stopQuery ?? "",
    });
  }, [busRoute, busDirection, busSearchTab, busStopId, busStopOperator]);

  async function handleLocate() {
    if (locating) return;
    setLocating(true);
    try {
      await locateUser();
    } catch (err) {
      // GeolocationPositionError codes: 1=denied, 2=unavailable, 3=timeout.
      // Surface each as a scannable toast with a hint the user can act on —
      // "User denied Geolocation" is the browser's spec text, not something
      // a non-technical user can translate into a fix.
      const code = (err as GeolocationPositionError)?.code;
      const next =
        code === 1 ? { title: t("toast.location.off.title"), body: t("toast.location.off.body") }
        : code === 2 ? { title: t("toast.location.unavailable.title"), body: t("toast.location.unavailable.body") }
        : code === 3 ? { title: t("toast.location.timeout.title"), body: t("toast.location.timeout.body") }
        : { title: t("toast.location.unknown.title") };
      setToast(next);
      setTimeout(() => setToast((t) => (t?.title === next.title ? null : t)), 5000);
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
      setLastUpdated(new Date().toLocaleTimeString());
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
      setLastUpdated(new Date().toLocaleTimeString());
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
      setLastUpdated(new Date().toLocaleTimeString());
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

  const handleBusOperatorChange = useCallback((op: BusOperator) => {
    if (op === busOperatorRef.current) return;
    setBusOperator(op);
    setBusRoute(null);
    setBusDirection(null);
    setBusStopId(null);
    setBusStopOperator(null);
    setBuses([]);
    setFocusContext(null);
    setArrivalFocusUnavailable(false);
    setPanelCollapsed(true);
  }, []);

  const handlePickBusFavorite = useCallback((f: BusFavorite) => {
    setMode("bus");
    setBusOperator(f.operator);
    setBusRoute(f.shortName);
    setBusDirection(f.direction);
    setBuses([]);
    // Symmetric to onPickStop: clear any stop selection + focus so the
    // panel doesn't stay stuck on the stop tab while the map shows the
    // route.
    setBusSearchTab("route");
    setBusStopId(null);
    setFocusContext(null);
    setArrivalFocusUnavailable(false);
    setPanelCollapsed(false);
  }, []);

  const handlePickTrainFavorite = useCallback((f: TrainFavorite) => {
    sessionStorage.setItem("search", JSON.stringify({ from: f.from, to: f.to, fromQuery: f.fromName, toQuery: f.toName }));
    setMode((current) => (current === "train" ? current : "train"));
    setSearchResetKey((k) => k + 1);
    setPanelCollapsed(false);
  }, []);

  const handleCloseFavorites = useCallback(() => setShowFavs(false), []);

  const handleTrainSearch = useCallback((codes: string[]) => {
    setSearchCodes(codes.length > 0 ? codes : []);
  }, []);

  const handleClearTrainSearch = useCallback(() => {
    setSearchCodes(null);
  }, []);

  const handlePickStopFavorite = useCallback((s: BusStopFavorite) => {
    setMode((current) => (current === "bus" ? current : "bus"));
    if (s.operator !== busOperatorRef.current) {
      setBusOperator(s.operator);
      setBuses([]);
    }
    setBusRoute(null);
    setBusDirection(null);
    setFocusContext(null);
    setArrivalFocusUnavailable(false);
    setBusSearchTab("stop");
    setBusStopId(s.stopId);
    setBusStopOperator(s.operator);
    setPanelCollapsed(false);
  }, []);

  const handleSelectBusRoute = useCallback((r: string | null, op?: BusOperator) => {
    if (op && op !== busOperatorRef.current) {
      setBusOperator(op);
      setBuses([]);
    }
    setBusRoute(r);
    setBusDirection(null);
  }, []);

  const handleBusTabChange = useCallback((tab: BusSearchTab) => {
    setBusSearchTab(tab);
    if (tab === "route") {
      setFocusContext(null);
      setArrivalFocusResetSignal((n) => n + 1);
      setInfoPanelDrilledIn(false);
      setArrivalFocusUnavailable(false);
    }
  }, []);

  const handleStopIdChange = useCallback((id: string | null, op: BusOperator | null) => {
    setBusStopId(id);
    setBusStopOperator(op);
    setArrivalFocusUnavailable(false);
    // Picking a stop in an operator different from the current route-mode
    // default would otherwise leave the all-fleet browse pinned to the old
    // operator — sync it so a tab back to route mode shows buses near the
    // chosen stop.
    if (op && op !== busOperatorRef.current) {
      setBusOperator(op);
      setBuses([]);
    }
  }, []);

  const handlePickArrival = useCallback((arrival: Parameters<React.ComponentProps<typeof BusSearchPanel>["onPickArrival"]>[0], op: BusOperator, stop: Parameters<React.ComponentProps<typeof BusSearchPanel>["onPickArrival"]>[2]) => {
    // Clear any selected route so the user lands in all-buses mode — the
    // target tripId is included in fetchAllBuses, so the focus effect can
    // find the marker without drawing the whole polyline.
    setBusRoute(null);
    setBusDirection(null);
    setInfoPanelDrilledIn(true);
    setArrivalFocusUnavailable(false);
    setFocusContext({
      tripId: arrival.tripId,
      operator: op,
      routeShortName: arrival.routeShortName,
      direction: arrival.direction,
      targetStopId: stop.id,
      targetStopCode: stop.code,
      targetStopName: stop.name,
      targetStopLat: stop.lat,
      targetStopLng: stop.lng,
    });
  }, []);

  const handleModeChange = useCallback((m: Mode) => {
    setMode(m);
    setSearchCodes(null);
    setBusRoute(null);
    setBusDirection(null);
    setBusStopId(null);
    setBusStopOperator(null);
    setBusStopSummary(null);
    setBusSearchTab(m === "bus" ? "stop" : "route");
    setFocusContext(null);
    setArrivalFocusUnavailable(false);
    setPanelCollapsed(true);
    clearBusSearchSession();
    // SearchPanel rehydrates from/to queries from this sessionStorage key
    // on mount, so App-state clearing alone isn't enough — clear the
    // persisted copy too or remounting restores the train search.
    sessionStorage.removeItem("search");
  }, []);

  const vehicleCount = mode === "train" ? trains.filter((t) => t.status === "R").length : buses.length;

  return (
    <>
      <div id="map" ref={mapRef} />
      <OfflineBanner />
      {toast && (
        <div className="app-toast" role="alert">
          <div className="app-toast__text">
            <div className="app-toast__title">{toast.title}</div>
            {toast.body && <div className="app-toast__body">{toast.body}</div>}
          </div>
        </div>
      )}
      <button
        type="button"
        className={`fab locate-btn${locating ? " loading" : ""}`}
        onClick={handleLocate}
        disabled={locating}
        aria-label={t("fab.locate.aria")}
        title={t("fab.locate.aria")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>
      <button
        type="button"
        className="fab fav-fab"
        onClick={() => setShowFavs(true)}
        aria-label={t("fab.favs.aria")}
        title={t("fab.favs.aria")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.9z" />
        </svg>
      </button>
      <button
        type="button"
        className="fab about-fab"
        onClick={openAbout}
        aria-label={t("fab.about.aria")}
        title={t("fab.about.aria")}
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
          onToggleCompass={needsCompassToggle ? (next) => {
            if (next) void startCompass();
            else stopCompass();
          } : undefined}
          fabSide={fabSide}
          onSetFabSide={setFabSide}
        />
      )}
      {showTour && <OnboardingTour steps={tourSteps} onClose={closeTour} />}
      {showFavs && (
        <FavoritesModal
          onClose={handleCloseFavorites}
          favs={favs}
          onPickBus={handlePickBusFavorite}
          onPickTrain={handlePickTrainFavorite}
          onPickStop={handlePickStopFavorite}
          onRemoveBus={removeBus}
          onRemoveTrain={removeTrain}
          onRemoveStop={removeStop}
        />
      )}
      {mode === "train" ? (
        <SearchPanel
          key={searchResetKey}
          onSearch={handleTrainSearch}
          onClear={handleClearTrainSearch}
          onTrainSelect={focusTrain}
          favs={favs}
          onToggleTrain={tryToggleTrain}
          collapsed={panelCollapsed}
          onCollapsedChange={setPanelCollapsed}
          onShowToast={showToast}
        />
      ) : (
        <BusSearchPanel
          onSelectRoute={handleSelectBusRoute}
          selectedRoute={busRoute}
          onSelectDirection={setBusDirection}
          selectedDirection={busDirection}
          busShape={busShape}
          isFavorite={busIsFav}
          onToggleFavorite={onToggleBusFav}
          busOperator={busOperator}
          busSearchTab={busSearchTab}
          onTabChange={handleBusTabChange}
          busStopId={busStopId}
          busStopOperator={busStopOperator}
          onStopIdChange={handleStopIdChange}
          collapsed={panelCollapsed}
          onCollapsedChange={setPanelCollapsed}
          onShowToast={showToast}
          stopIsFavorite={stopIsFav}
          onToggleStopFavorite={onToggleStopFav}
          onStopSummaryChange={setBusStopSummary}
          arrivalFocusResetSignal={arrivalFocusResetSignal}
          arrivalFocusUnavailable={arrivalFocusUnavailable}
          onPickArrival={handlePickArrival}
        />
      )}
      {mode === "bus" && (busRoute !== null || focusContext !== null) && (
        <button
          className="back-to-all-btn"
          onClick={() => {
            setBusRoute(null);
            setBusDirection(null);
            setFocusContext(null);
            setArrivalFocusResetSignal((n) => n + 1);
            setInfoPanelDrilledIn(false);
            setArrivalFocusUnavailable(false);
          }}
        >
          &larr; {t("bus.back.all")}
        </button>
      )}
      <InfoPanel
        vehicleCount={vehicleCount}
        lastUpdated={lastUpdated ? t("info.updated", { time: lastUpdated }) : t("info.updated.empty")}
        mode={mode}
        busSearchTab={busSearchTab}
        filter={filter}
        inService={inService}
        resumeLabel={SERVICE_RESUME_LABEL}
        busOperator={busOperator}
        busStopSummary={busStopSummary}
        drilledIn={infoPanelDrilledIn}
        onDrilledInChange={setInfoPanelDrilledIn}
        onModeChange={handleModeChange}
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
