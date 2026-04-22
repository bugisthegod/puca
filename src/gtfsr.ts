import { Database } from "bun:sqlite";
import dublinBusRoutes from "./data/dublinbus-routes.json" with { type: "json" };
import dublinBusShapes from "./data/dublinbus-shapes.json" with { type: "json" };
import dublinBusStops from "./data/dublinbus-stops.json" with { type: "json" };
import dublinBusVariants from "./data/dublinbus-variants.json" with { type: "json" };
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
  shapeId: string | null;
  stale: boolean;
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
  shapeId: string | null;
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

export type BusVariant = {
  shapeId: string;
  tripCount: number;
  branches: [number, number][][];
};
type VariantsDict = Record<string, { [direction: string]: BusVariant[] }>;

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

// Variants are only generated for Dublin Bus today; other operators return [].
const operatorVariants: Record<Operator, VariantsDict> = {
  dublinbus: dublinBusVariants as unknown as VariantsDict,
  buseireann: {} as VariantsDict,
  goahead: {} as VariantsDict,
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

const tripShapeStmtMap = new Map<Operator, ReturnType<Database["prepare"]>>();

function getTripShapeId(operator: Operator, tripId: string): string | null {
  const db = getScheduleDb(operator);
  if (!db) return null;
  try {
    if (!tripShapeStmtMap.has(operator)) {
      tripShapeStmtMap.set(operator, db.prepare("SELECT shape_id FROM trips WHERE trip_id = ?"));
    }
    const row = tripShapeStmtMap.get(operator)!.get(tripId) as { shape_id?: string } | undefined;
    return row?.shape_id ?? null;
  } catch {
    return null;
  }
}

const lastStopSecStmtMap = new Map<Operator, ReturnType<Database["prepare"]>>();

// Lightweight lookup for the stale-trip flag — we only need the last stop's
// arrival time, not the full stop list (which getTripScheduledStops returns).
function getTripLastStopSec(operator: Operator, tripId: string): number | null {
  const db = getScheduleDb(operator);
  if (!db) return null;
  try {
    if (!lastStopSecStmtMap.has(operator)) {
      lastStopSecStmtMap.set(
        operator,
        db.prepare("SELECT arrival_sec FROM stop_times WHERE trip_id = ? ORDER BY stop_sequence DESC LIMIT 1"),
      );
    }
    const row = lastStopSecStmtMap.get(operator)!.get(tripId) as { arrival_sec?: number } | undefined;
    return row?.arrival_sec ?? null;
  } catch {
    return null;
  }
}

// Preloaded trip_id → shape_id map, built once per operator. /api/bus/vehicles
// enriches every vehicle with shapeId on each poll, so we want this O(1) in
// memory rather than N SQLite calls per request. ~56k entries (~1.7 MB) for
// Dublin Bus. Empty map for operators without a trips table — degrades
// gracefully (vehicles get shapeId: null, variant filter ignores them).
const tripShapeMapCache = new Map<Operator, Map<string, string>>();

function getTripShapeMap(operator: Operator): Map<string, string> {
  const cached = tripShapeMapCache.get(operator);
  if (cached) return cached;
  const map = new Map<string, string>();
  const db = getScheduleDb(operator);
  if (db) {
    try {
      const rows = db.prepare("SELECT trip_id, shape_id FROM trips").all() as { trip_id: string; shape_id: string }[];
      for (const r of rows) map.set(r.trip_id, r.shape_id);
    } catch {
      // trips table may not exist on operators where it hasn't been generated yet
    }
  }
  tripShapeMapCache.set(operator, map);
  return map;
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

export type BusRouteDirectionShape = {
  headsign: string;
  coords: [number, number][];
  stops: { id: string; name: string; lat: number; lng: number }[];
  variants: BusVariant[];
};

export function getBusRouteShape(
  operator: Operator,
  shortName: string,
): { [direction: string]: BusRouteDirectionShape } | null {
  const routes = operatorRoutes[operator];
  const shapes = operatorShapes[operator];
  const variants = operatorVariants[operator];
  const route = routes.find((r) => r.shortName.toLowerCase() === shortName.toLowerCase());
  if (!route) return null;
  const shape = shapes[route.id];
  if (!shape) return null;
  const routeVariants = variants[route.id] ?? {};
  const out: { [direction: string]: BusRouteDirectionShape } = {};
  for (const [dir, data] of Object.entries(shape)) {
    out[dir] = {
      headsign: data.headsign,
      coords: data.coords,
      stops: data.stops,
      variants: routeVariants[dir] ?? [],
    };
  }
  return out;
}

export type ScheduledRow = { sequence: number; stopId: string; arrivalSec: number };

export type LiveTripData = {
  routeId: string;
  directionId: number;
  stopTimeUpdates: Array<{
    sequence: number;
    stopId: string;
    arrivalDelaySec: number | null;
    departureDelaySec: number | null;
    scheduleRelationship: string;
  }>;
};

export function mergeTripStops(
  tripId: string,
  scheduledRows: ScheduledRow[],
  liveTrip: LiveTripData | undefined,
  stops: StopsDict,
  shapeId: string | null = null,
): TripUpdate | null {
  if (scheduledRows.length === 0 && !liveTrip) return null;

  const liveBySeq = new Map<number, LiveTripData["stopTimeUpdates"][number]>();
  if (liveTrip) {
    for (const u of liveTrip.stopTimeUpdates) {
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
      routeId: liveTrip?.routeId ?? "",
      directionId: liveTrip?.directionId ?? 0,
      shapeId,
      stops: mergedStops,
    };
  }

  // DB not available or trip not in DB — return live data with nulls for scheduled
  const fallbackStops: StopTimeUpdate[] = liveTrip!.stopTimeUpdates.map((u, i) => ({
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
    routeId: liveTrip!.routeId,
    directionId: liveTrip!.directionId,
    shapeId,
    stops: fallbackStops.sort((a, b) => a.sequence - b.sequence),
  };
}

export async function getBusTripStops(operator: Operator, tripId: string): Promise<TripUpdate | null> {
  const stops = operatorStops[operator];
  const updates = await pollTripUpdates();
  const liveTrip = updates.get(tripId);
  const scheduledRows = getTripScheduledStops(operator, tripId);
  const shapeId = getTripShapeId(operator, tripId);
  return mergeTripStops(tripId, scheduledRows, liveTrip, stops, shapeId);
}

// "Stale" flag attached to each returned vehicle: true when the trip NTA has
// tagged this bus with is clearly over (scheduled last stop + latest reported
// delay + 15 min buffer is in the past). We DON'T hide these — the app's core
// purpose is showing what's on the road. The client uses the flag to swap in
// a Puca marker ("Puca took this bus") so users can recognise at a glance
// that the popup's schedule may be for a completed trip, not the one the bus
// is actually running. Genuinely late buses keep reporting growing delays
// that push the effective end forward, so they stay non-stale until truly done.
const ENDED_TRIP_BUFFER_SEC = 15 * 60;

// Dublin-local seconds-since-midnight. The bus service-hours gate (05:00–23:30)
// already prevents this check from running in the cross-midnight window, so
// arrival_sec and nowSec stay comparable without wrap-around handling.
function secondsIntoDublinDay(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  const s = Number(parts.find((p) => p.type === "second")!.value);
  return h * 3600 + m * 60 + s;
}

function isTripEnded(
  operator: Operator,
  tripId: string,
  nowSec: number,
  tripUpdates: RawTripUpdateMap,
): boolean {
  const lastStopSec = getTripLastStopSec(operator, tripId);
  if (lastStopSec === null) return false;   // unknown trip → keep (conservative)

  // Shift the effective end time forward by the latest reported delay so
  // genuinely late buses are protected — their TripUpdate keeps reporting
  // larger delays as they run behind, pushing the end past `now`. Stale
  // predictions (trip actually ended but NTA didn't clear TripUpdates) leave
  // small/old delays that don't save them once `now` rolls past.
  const live = tripUpdates.get(tripId);
  let endDelay = 0;
  if (live) {
    let maxSeq = -1;
    for (const stu of live.stopTimeUpdates) {
      if (stu.arrivalDelaySec !== null && stu.sequence > maxSeq) {
        maxSeq = stu.sequence;
        endDelay = stu.arrivalDelaySec;
      }
    }
  }

  return nowSec > lastStopSec + endDelay + ENDED_TRIP_BUFFER_SEC;
}

export async function getBusVehiclesByRoute(operator: Operator, shortName: string, direction?: number): Promise<BusVehicle[]> {
  const routes = operatorRoutes[operator];
  const route = routes.find((r) => r.shortName.toLowerCase() === shortName.toLowerCase());
  if (!route) return [];

  const all = await pollVehicles();
  const shapeMap = getTripShapeMap(operator);
  const tripUpdates = await pollTripUpdates();
  const nowSec = secondsIntoDublinDay();

  const result: BusVehicle[] = [];
  for (const v of all) {
    if (v.routeId !== route.id) continue;
    if (direction !== undefined && v.directionId !== direction) continue;
    const stale = isTripEnded(operator, v.tripId, nowSec, tripUpdates);
    result.push({ ...v, routeShortName: route.shortName, shapeId: shapeMap.get(v.tripId) ?? null, stale });
  }
  return result;
}

export async function getAllBusVehicles(operator: Operator): Promise<BusVehicle[]> {
  const routes = operatorRoutes[operator];
  const routeIdToShortName = new Map<string, string>();
  for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

  const all = await pollVehicles();
  const shapeMap = getTripShapeMap(operator);
  const tripUpdates = await pollTripUpdates();
  const nowSec = secondsIntoDublinDay();

  const result: BusVehicle[] = [];
  for (const v of all) {
    const shortName = routeIdToShortName.get(v.routeId);
    if (!shortName) continue;
    const stale = isTripEnded(operator, v.tripId, nowSec, tripUpdates);
    result.push({ ...v, routeShortName: shortName, shapeId: shapeMap.get(v.tripId) ?? null, stale });
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
