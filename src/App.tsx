import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Train } from "./types";
import type { Filter } from "./utils";
import { useTrainMap } from "./hooks/useTrainMap";
import InfoPanel from "./components/InfoPanel";
import SearchPanel from "./components/SearchPanel";
import "./style.css";

function App() {
  const [trains, setTrains] = useState<Train[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [lastUpdated, setLastUpdated] = useState<string>("Updated: —");
  const [searchCodes, setSearchCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);

  const { focusTrain } = useTrainMap(mapRef, trains, filter, searchCodes);

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

  useEffect(() => {
    fetchTrains();
    const interval = setInterval(fetchTrains, 30_000);
    return () => clearInterval(interval);
  }, []);

  const runningCount = trains.filter((t) => t.status === "R").length;

  return (
    <>
      <div id="map" ref={mapRef} />
      {loading && (
        <div className="loading-overlay">
          <div className="loading-text">Loading trains...</div>
        </div>
      )}
      <SearchPanel
        onSearch={(codes) => setSearchCodes(codes.length > 0 ? codes : [])}
        onClear={() => setSearchCodes(null)}
        onTrainSelect={focusTrain}
      />
      <InfoPanel
        trainCount={runningCount}
        lastUpdated={lastUpdated}
        filter={filter}
        onFilterChange={setFilter}
        onRefresh={fetchTrains}
      />
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
