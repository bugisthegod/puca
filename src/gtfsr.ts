import { Database } from "bun:sqlite";
import dublinBusRoutes from "./data/dublinbus-routes.json" with { type: "json" };
import dublinBusShapes from "./data/dublinbus-shapes.json" with { type: "json" };
import dublinBusStops from "./data/dublinbus-stops.json" with { type: "json" };
import busEireannRoutes from "./data/buseireann-routes.json" with { type: "json" };
import busEireannShapes from "./data/buseireann-shapes.json" with { type: "json" };
import busEireannStops from "./data/buseireann-stops.json" with { type: "json" };
import goAheadRoutes from "./data/goahead-routes.json" with { type: "json" };
import goAheadShapes from "./data/goahead-shapes.json" with { type: "json" };
import goAheadStops from "./data/goahead-stops.json" with { type: "json" };
import trainShapes from "./data/train-shapes.json" with { type: "json" };
import trainEndpoints from "./data/train-routes-by-endpoints.json" with { type: "json" };
import { log, errToMeta } from "./logger";

const NTA_VEHICLES_URL = "https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json";
const NTA_TRIP_UPDATES_URL = "https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json";

export type Operator = "dublinbus" | "buseireann" | "goahead";

export type GtfsVehiclePosition = {
  tripId: string;
  routeId: string;
  lat: number;
  lng: number;
  bearing: number | null;
  speed: number | null;
  timestamp: number;
  label: string;
  directionId: number;
};

export type BusVehicle = GtfsVehiclePosition & {
  routeShortName: string;
};

export type BusRoute = {
  id: string;
  shortName: string;
  longName: string;
};

export type StopTimeUpdate = {
  sequence: number;
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  scheduledArrivalSec: number | null;
  expectedArrivalSec: number | null;
  arrivalDelaySec: number | null;
  departureDelaySec: number | null;
  scheduleRelationship: string;
  isCurrent: boolean;
};

export type TripUpdate = {
  tripId: string;
  routeId: string;
  directionId: number;
  stops: StopTimeUpdate[];
};

type GtfsEntity = {
  vehicle?: {
    trip?: { trip_id?: string; route_id?: string; direction_id?: number };
    position?: {
      latitude?: number;
      longitude?: number;
      bearing?: number;
      speed?: number;
    };
    vehicle?: { id?: string; label?: string };
    timestamp?: number | string;
  };
};

type GtfsTripUpdateEntity = {
  trip_update?: {
    trip?: { trip_id?: string; route_id?: string; direction_id?: number };
    stop_time_update?: Array<{
      stop_sequence?: number;
      stop_id?: string;
      arrival?: { delay?: number; time?: number | string };
      departure?: { delay?: number; time?: number | string };
      schedule_relationship?: string;
    }>;
  };
};

// ---------------------------------------------------------------------------
// Operator data sets
// ---------------------------------------------------------------------------

type StopsDict = Record<string, { name: string; lat: number; lng: number }>;
type ShapesDict = Record<string, { [direction: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[] } }>;

const operatorRoutes: Record<Operator, BusRoute[]> = {
  dublinbus: dublinBusRoutes as BusRoute[],
  buseireann: busEireannRoutes as BusRoute[],
  goahead: goAheadRoutes as BusRoute[],
};

const operatorShapes: Record<Operator, ShapesDict> = {
  dublinbus: dublinBusShapes as unknown as ShapesDict,
  buseireann: busEireannShapes as unknown as ShapesDict,
  goahead: goAheadShapes as unknown as ShapesDict,
};

const operatorStops: Record<Operator, StopsDict> = {
  dublinbus: dublinBusStops as StopsDict,
  buseireann: busEireannStops as StopsDict,
  goahead: goAheadStops as StopsDict,
};

// ---------------------------------------------------------------------------
// SQLite schedule DB — per-operator, lazily opened
// ---------------------------------------------------------------------------

const DB_DIR = process.env.BUS_DB_DIR ?? "./src/data";
const DB_PATHS: Record<Operator, string> = {
  dublinbus: `${DB_DIR}/bus-schedule.db`,
  buseireann: `${DB_DIR}/buseireann-schedule.db`,
  goahead: `${DB_DIR}/goahead-schedule.db`,
};

const scheduleDbMap = new Map<Operator, Database | null>();
const scheduledStopsStmtMap = new Map<Operator, ReturnType<Database["prepare"]>>();

function getScheduleDb(operator: Operator): Database | null {
  if (scheduleDbMap.has(operator)) return scheduleDbMap.get(operator)!;
  try {
    const db = new Database(DB_PATHS[operator], { readonly: true });
    scheduleDbMap.set(operator, db);
    return db;
  } catch {
    scheduleDbMap.set(operator, null);
    return null;
  }
}

function getTripScheduledStops(operator: Operator, tripId: string): { sequence: number; stopId: string; arrivalSec: number }[] {
  const db = getScheduleDb(operator);
  if (!db) return [];
  try {
    if (!scheduledStopsStmtMap.has(operator)) {
      scheduledStopsStmtMap.set(
        operator,
        db.prepare("SELECT stop_sequence, stop_id, arrival_sec FROM stop_times WHERE trip_id = ? ORDER BY stop_sequence"),
      );
    }
    const stmt = scheduledStopsStmtMap.get(operator)!;
    const rows = stmt.all(tripId) as { stop_sequence: number; stop_id: string; arrival_sec: number }[];
    return rows.map((r) => ({ sequence: r.stop_sequence, stopId: r.stop_id, arrivalSec: r.arrival_sec }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cache + NTA rate gate
// ---------------------------------------------------------------------------
// NTA Fair Usage Policy: "each token will be restricted to calling the GTFS Real
// Time API once every 60 seconds." We enforce this per-endpoint: any pollX call
// within 60s of the last NTA request for that endpoint returns the cached data
// instead of hitting NTA. Frontend can poll at whatever cadence it wants — only
// pollVehicles / pollTripUpdates are allowed to call NTA, and only past the gate.

const NTA_MIN_INTERVAL_MS = 30_000;
// Trip updates (schedule + delays per stop) change much slower than GPS positions.
// Longer TTL reduces upstream pressure AND collision risk with the 20s shared gate.
const NTA_TRIP_UPDATES_INTERVAL_MS = 90_000;
// NTA rate-limits per API key globally (vehicles + trip-updates share the bucket).
// Space ANY two NTA calls at least this far apart to avoid 429s when both endpoints
// fire close together. Measured empirically: ~20s is the safe floor.
const NTA_MIN_SPACING_MS = 20_000;

type RawTripUpdateMap = Map<string, {
  tripId: string;
  routeId: string;
  directionId: number;
  stopTimeUpdates: Array<{
    sequence: number;
    stopId: string;
    arrivalDelaySec: number | null;
    departureDelaySec: number | null;
    scheduleRelationship: string;
  }>;
}>;

let vehicleCache: GtfsVehiclePosition[] | null = null;
let tripUpdateCache: RawTripUpdateMap | null = null;
let lastVehicleCall = 0;
let lastTripUpdateCall = 0;
let lastAnyNtaCall = 0;

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

async function fetchVehicles(): Promise<void> {
  const apiKey = process.env.NTA_API_KEY;
  if (!apiKey) {
    log.error("nta.vehicles.no_api_key");
    return;
  }

  const start = Date.now();
  try {
    const res = await fetch(NTA_VEHICLES_URL, {
      headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
    });
    const duration_ms = Date.now() - start;

    if (!res.ok) {
      log.warn("nta.vehicles.http_error", {
        http_status: res.status,
        duration_ms,
        stale_cache_size: vehicleCache?.length ?? 0,
      });
      return;
    }

    const data = await res.json();
    const entities: GtfsEntity[] = data.entity ?? [];
    const vehicles: GtfsVehiclePosition[] = [];

    for (const entity of entities) {
      const vp = entity.vehicle;
      if (!vp?.position?.latitude || !vp?.position?.longitude) continue;

      vehicles.push({
        tripId: vp.trip?.trip_id ?? "",
        routeId: vp.trip?.route_id ?? "",
        lat: vp.position.latitude,
        lng: vp.position.longitude,
        bearing: vp.position.bearing ?? null,
        speed: vp.position.speed ?? null,
        timestamp: Number(vp.timestamp ?? 0),
        label: vp.vehicle?.label ?? vp.vehicle?.id ?? "",
        directionId: vp.trip?.direction_id ?? 0,
      });
    }

    vehicleCache = vehicles;
    log.info("nta.vehicles.ok", { vehicle_count: vehicles.length, duration_ms });
  } catch (err) {
    log.error("nta.vehicles.exception", {
      ...errToMeta(err),
      duration_ms: Date.now() - start,
      stale_cache_size: vehicleCache?.length ?? 0,
    });
  }
}

async function pollVehicles(): Promise<GtfsVehiclePosition[]> {
  if (Date.now() - lastVehicleCall < NTA_MIN_INTERVAL_MS) {
    return vehicleCache ?? [];
  }
  if (Date.now() - lastAnyNtaCall < NTA_MIN_SPACING_MS) {
    return vehicleCache ?? [];
  }
  lastVehicleCall = Date.now();
  lastAnyNtaCall = Date.now();
  await fetchVehicles();
  return vehicleCache ?? [];
}

function getCachedVehicles(): GtfsVehiclePosition[] {
  return vehicleCache ?? [];
}

// ---------------------------------------------------------------------------
// Trip updates
// ---------------------------------------------------------------------------

async function fetchTripUpdates(): Promise<void> {
  const apiKey = process.env.NTA_API_KEY;
  if (!apiKey) {
    log.error("nta.trip_updates.no_api_key");
    return;
  }

  const start = Date.now();
  try {
    const res = await fetch(NTA_TRIP_UPDATES_URL, {
      headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
    });
    const duration_ms = Date.now() - start;

    if (!res.ok) {
      log.warn("nta.trip_updates.http_error", {
        http_status: res.status,
        duration_ms,
        stale_cache_size: tripUpdateCache?.size ?? 0,
      });
      return;
    }

    const data = await res.json();
    const entities: GtfsTripUpdateEntity[] = data.entity ?? [];
    const map: RawTripUpdateMap = new Map();

    for (const entity of entities) {
      const tu = entity.trip_update;
      const tripId = tu?.trip?.trip_id;
      if (!tripId) continue;

      // Store raw stop IDs only — name resolution is operator-aware and done at read time
      const stopTimeUpdates = (tu.stop_time_update ?? []).map((s) => ({
        sequence: s.stop_sequence ?? 0,
        stopId: s.stop_id ?? "",
        arrivalDelaySec: s.arrival?.delay ?? null,
        departureDelaySec: s.departure?.delay ?? null,
        scheduleRelationship: s.schedule_relationship ?? "SCHEDULED",
      }));

      map.set(tripId, {
        tripId,
        routeId: tu.trip?.route_id ?? "",
        directionId: tu.trip?.direction_id ?? 0,
        stopTimeUpdates,
      });
    }

    tripUpdateCache = map;
    log.info("nta.trip_updates.ok", { trip_count: map.size, duration_ms });
  } catch (err) {
    log.error("nta.trip_updates.exception", {
      ...errToMeta(err),
      duration_ms: Date.now() - start,
      stale_cache_size: tripUpdateCache?.size ?? 0,
    });
  }
}

async function pollTripUpdates(): Promise<RawTripUpdateMap> {
  if (Date.now() - lastTripUpdateCall < NTA_TRIP_UPDATES_INTERVAL_MS) {
    return tripUpdateCache ?? new Map();
  }
  if (Date.now() - lastAnyNtaCall < NTA_MIN_SPACING_MS) {
    return tripUpdateCache ?? new Map();
  }
  lastTripUpdateCall = Date.now();
  lastAnyNtaCall = Date.now();
  await fetchTripUpdates();
  return tripUpdateCache ?? new Map();
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export function getGtfsrVehiclePositions(): GtfsVehiclePosition[] {
  return getCachedVehicles();
}

export function getBusRoutes(operator: Operator): BusRoute[] {
  return operatorRoutes[operator];
}

export function getBusRouteShape(
  operator: Operator,
  shortName: string,
): { [direction: string]: { headsign: string; coords: [number, number][]; stops: { id: string; name: string; lat: number; lng: number }[] } } | null {
  const routes = operatorRoutes[operator];
  const shapes = operatorShapes[operator];
  const route = routes.find((r) => r.shortName.toLowerCase() === shortName.toLowerCase());
  if (!route) return null;
  return shapes[route.id] ?? null;
}

export async function getBusTripStops(operator: Operator, tripId: string): Promise<TripUpdate | null> {
  const stops = operatorStops[operator];
  const updates = await pollTripUpdates();
  const trip = updates.get(tripId);

  const scheduledRows = getTripScheduledStops(operator, tripId);

  if (scheduledRows.length === 0 && !trip) return null;

  type LiveStopUpdate = {
    sequence: number;
    stopId: string;
    arrivalDelaySec: number | null;
    departureDelaySec: number | null;
    scheduleRelationship: string;
  };
  const liveBySeq = new Map<number, LiveStopUpdate>();
  if (trip) {
    for (const u of trip.stopTimeUpdates) {
      liveBySeq.set(u.sequence, u);
    }
  }

  if (scheduledRows.length > 0) {
    // GTFS-R delay propagation: stops without a specific update inherit
    // the delay from the most recent prior stop that had one.
    // isCurrent marks the first stop with an explicit live update (bus is at or approaching).
    let propagatedDelay: number | null = null;
    let currentAssigned = false;
    const mergedStops: StopTimeUpdate[] = scheduledRows.map((row) => {
      const live = liveBySeq.get(row.sequence);
      const stopName = stops[row.stopId]?.name ?? (live?.stopId ?? row.stopId);
      const hasExplicitDelay = live?.arrivalDelaySec !== undefined && live.arrivalDelaySec !== null;
      if (hasExplicitDelay) propagatedDelay = live!.arrivalDelaySec;
      const arrivalDelaySec = live?.arrivalDelaySec ?? propagatedDelay;
      const expectedArrivalSec = arrivalDelaySec !== null ? row.arrivalSec + arrivalDelaySec : null;
      const isCurrent = hasExplicitDelay && !currentAssigned;
      if (isCurrent) currentAssigned = true;
      return {
        sequence: row.sequence,
        stopId: row.stopId,
        name: stopName,
        lat: stops[row.stopId]?.lat ?? 0,
        lng: stops[row.stopId]?.lng ?? 0,
        scheduledArrivalSec: row.arrivalSec,
        expectedArrivalSec,
        arrivalDelaySec,
        departureDelaySec: live?.departureDelaySec ?? null,
        scheduleRelationship: live?.scheduleRelationship ?? "SCHEDULED",
        isCurrent,
      };
    });

    return {
      tripId,
      routeId: trip?.routeId ?? "",
      directionId: trip?.directionId ?? 0,
      stops: mergedStops,
    };
  }

  // DB not available or trip not in DB — return live data with nulls for scheduled
  const fallbackStops: StopTimeUpdate[] = (trip!.stopTimeUpdates).map((u, i) => ({
    sequence: u.sequence,
    stopId: u.stopId,
    name: stops[u.stopId]?.name ?? u.stopId,
    lat: stops[u.stopId]?.lat ?? 0,
    lng: stops[u.stopId]?.lng ?? 0,
    scheduledArrivalSec: null,
    expectedArrivalSec: null,
    arrivalDelaySec: u.arrivalDelaySec,
    departureDelaySec: u.departureDelaySec,
    scheduleRelationship: u.scheduleRelationship,
    isCurrent: i === 0,
  }));

  return {
    tripId,
    routeId: trip!.routeId,
    directionId: trip!.directionId,
    stops: fallbackStops.sort((a, b) => a.sequence - b.sequence),
  };
}

export async function getBusVehiclesByRoute(operator: Operator, shortName: string, direction?: number): Promise<BusVehicle[]> {
  const routes = operatorRoutes[operator];
  const route = routes.find((r) => r.shortName.toLowerCase() === shortName.toLowerCase());
  if (!route) return [];

  const all = await pollVehicles();
  return all
    .filter((v) => v.routeId === route.id && (direction === undefined || v.directionId === direction))
    .map((v) => ({ ...v, routeShortName: route.shortName }));
}

export async function getAllBusVehicles(operator: Operator): Promise<BusVehicle[]> {
  const routes = operatorRoutes[operator];
  const routeIdToShortName = new Map<string, string>();
  for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

  const all = await pollVehicles();
  const result: BusVehicle[] = [];
  for (const v of all) {
    const shortName = routeIdToShortName.get(v.routeId);
    if (shortName) result.push({ ...v, routeShortName: shortName });
  }
  return result;
}

export function getTrainRouteShape(origin: string, destination: string): {
  headsign: string;
  coords: [number, number][];
  stops: { id: string; name: string; lat: number; lng: number }[];
} | null {
  const key = `${origin.trim().toLowerCase()}|${destination.trim().toLowerCase()}`;
  const endpoints = trainEndpoints as unknown as Record<string, { routeId: string; directionId: number }>;
  const match = endpoints[key];
  if (!match) return null;

  const shapes = trainShapes as unknown as Record<string, Record<string, {
    headsign: string;
    shapeId: string;
    coords: [number, number][];
    stops: { id: string; name: string; lat: number; lng: number }[];
  }>>;

  const routeShapes = shapes[match.routeId];
  if (!routeShapes) return null;
  const shape = routeShapes[String(match.directionId)];
  if (!shape) return null;

  return { headsign: shape.headsign, coords: shape.coords, stops: shape.stops };
}
