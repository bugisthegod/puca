import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Train, BusVehicle, BusOperator } from "./types";
import { isInServiceHours, SERVICE_RESUME_LABEL, type Filter } from "./utils";
import { useTrainMap, type Mode } from "./hooks/useTrainMap";
import InfoPanel from "./components/InfoPanel";
import SearchPanel from "./components/SearchPanel";
import BusSearchPanel from "./components/BusSearchPanel";
import "./style.css";

function App() {
  const [mode, setMode] = useState<Mode>("train");
  const [trains, setTrains] = useState<Train[]>([]);
  const [buses, setBuses] = useState<BusVehicle[]>([]);
  const [busOperator, setBusOperator] = useState<BusOperator>("dublinbus");
  const [busRoute, setBusRoute] = useState<string | null>(null);
  const [busDirection, setBusDirection] = useState<string | null>(null);
  const [busShape, setBusShape] = useState<{ [dir: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[] } } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [lastUpdated, setLastUpdated] = useState<string>("Updated: —");
  const [searchCodes, setSearchCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
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
    } finally {
      setLoading(false);
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
      setLoading(false);
      setTrains([]);
      setBuses([]);
      return;
    }
    if (mode === "train") {
      fetchTrains();
      const interval = setInterval(fetchTrains, 30_000);
      return () => clearInterval(interval);
    } else {
      setLoading(false);
      if (busRoute && busDirection) {
        fetchBuses(busOperator, busRoute, busDirection);
        const interval = setInterval(() => fetchBuses(busOperator, busRoute, busDirection), 15_000);
        return () => clearInterval(interval);
      } else if (!busRoute) {
        fetchAllBuses(busOperator);
        const interval = setInterval(() => fetchAllBuses(busOperator), 15_000);
        return () => clearInterval(interval);
      } else {
        setBuses([]);
      }
    }
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
      {loading && (
        <div className="loading-overlay">
          <div className="loading-text">Loading...</div>
        </div>
      )}
      {mode === "train" ? (
        <SearchPanel
          onSearch={(codes) => setSearchCodes(codes.length > 0 ? codes : [])}
          onClear={() => setSearchCodes(null)}
          onTrainSelect={focusTrain}
        />
      ) : (
        <BusSearchPanel
          operator={busOperator}
          onSelectRoute={(r) => { setBusRoute(r); setBusDirection(null); }}
          selectedRoute={busRoute}
          onSelectDirection={setBusDirection}
          selectedDirection={busDirection}
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
