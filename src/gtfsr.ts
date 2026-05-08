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
import { isInServiceHours } from "./utils";
import type { BusOperator as Operator, BusRoute, BusVehicle } from "./types";

const NTA_VEHICLES_URL = "https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json";
const NTA_TRIP_UPDATES_URL = "https://api.nationaltransport.ie/gtfsr/v2/TripUpdates?format=json";

export type { BusOperator as Operator, BusRoute, BusVehicle } from "./types";

export type GtfsVehiclePosition = Omit<BusVehicle, "routeShortName" | "shapeId" | "stale">;

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

type StopsDict = Record<string, { name: string; lat: number; lng: number; code?: string }>;
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
  // Open read-write first so we can create the stop_id index on cold start
  // (needed for the stop-arrivals endpoint). Falls back to read-only if the
  // filesystem is read-only (e.g. Fly volume), in which case arrivals-by-stop
  // queries degrade to slow table scans — we accept that rather than fail boot.
  try {
    const db = new Database(DB_PATHS[operator], { readwrite: true, create: false });
    try {
      db.exec("CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id)");
    } catch (err) {
      log.warn("schedule_db.index_create_failed", { operator, ...errToMeta(err) });
    }
    scheduleDbMap.set(operator, db);
    return db;
  } catch {
    try {
      const db = new Database(DB_PATHS[operator], { readonly: true });
      scheduleDbMap.set(operator, db);
      return db;
    } catch {
      scheduleDbMap.set(operator, null);
      return null;
    }
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

// Vehicles at strict 30s started getting NTA 429s ~25% of the time (quota
// appears to be ~3 calls/60s sliding window across V + TU). 35s drops the
// V rate to 1.7/min while staying close to the "every 30s" target.
const NTA_MIN_INTERVAL_MS = 35_000;
// Trip updates (schedule + delays per stop) change much slower than GPS positions.
// 75s lands in the 60-90s ideal range while staying out of phase with the 35s
// vehicles cycle.
const NTA_TRIP_UPDATES_INTERVAL_MS = 75_000;

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
let vehicleCacheUpdatedAt = 0;
let tripUpdateCacheUpdatedAt = 0;

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
    vehicleCacheUpdatedAt = Date.now();
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
  lastVehicleCall = Date.now();
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
    tripUpdateCacheUpdatedAt = Date.now();
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
  lastTripUpdateCall = Date.now();
  await fetchTripUpdates();
  return tripUpdateCache ?? new Map();
}

// ---------------------------------------------------------------------------
// Background polling
// ---------------------------------------------------------------------------
// Without this, every NTA call is request-driven: a cold-cache visitor pays
// the latency AND can fire Vehicles + TripUpdates back-to-back, bursting
// against the shared NTA quota. With background polling, requests always read
// fresh cache and NTA calls happen on a steady cadence.
// Skips outside service hours so we don't burn quota when no buses run.

let backgroundPollingStarted = false;

export function startBackgroundPolling(): void {
  if (backgroundPollingStarted) return;
  backgroundPollingStarted = true;

  const tickVehicles = () => {
    if (!isInServiceHours("bus")) return;
    void pollVehicles().catch((err) => log.error("nta.background_vehicles_failed", errToMeta(err)));
  };
  const tickTripUpdates = () => {
    if (!isInServiceHours("bus")) return;
    void pollTripUpdates().catch((err) => log.error("nta.background_trip_updates_failed", errToMeta(err)));
  };

  // Pre-warm both caches immediately on boot so the first user request after a
  // restart doesn't wait 35s for vehicles. Stagger TripUpdates by 5s so the
  // initial pair doesn't hit NTA in the same tick.
  tickVehicles();
  setTimeout(tickTripUpdates, 5_000);

  // Vehicles is the higher-priority stream (live GPS positions) → 35s cadence.
  setInterval(tickVehicles, NTA_MIN_INTERVAL_MS);
  // TripUpdates offset by 7s. With V=35s and TU=75s, gcd=5 so TU drifts through
  // 7 positions relative to V over ~4min. Phase doesn't really matter for NTA
  // rate limits (it's per-minute count, not spacing) — this offset just keeps
  // the very first interval-driven TU call ~12s away from the first V tick.
  setTimeout(() => setInterval(tickTripUpdates, NTA_TRIP_UPDATES_INTERVAL_MS), 7_000);

  log.info("nta.background_polling.started", {
    vehicles_interval_ms: NTA_MIN_INTERVAL_MS,
    trip_updates_interval_ms: NTA_TRIP_UPDATES_INTERVAL_MS,
  });
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export function getGtfsrVehiclePositions(): GtfsVehiclePosition[] {
  return getCachedVehicles();
}

export type GtfsrHealthSnapshot = {
  backgroundPollingStarted: boolean;
  nta: {
    vehicles: {
      count: number;
      ageSec: number | null;
      lastAttemptAgeSec: number | null;
      intervalMs: number;
    };
    tripUpdates: {
      count: number;
      ageSec: number | null;
      lastAttemptAgeSec: number | null;
      intervalMs: number;
    };
  };
  db: Record<Operator, {
    status: "connected" | "available" | "missing" | "error";
  }>;
};

function ageSec(timestampMs: number, now: number): number | null {
  if (timestampMs <= 0) return null;
  return Math.max(0, Math.round((now - timestampMs) / 1000));
}

async function getDbHealth(operator: Operator): Promise<GtfsrHealthSnapshot["db"][Operator]> {
  const cached = scheduleDbMap.get(operator);
  if (cached) {
    try {
      cached.query("SELECT 1").get();
      return { status: "connected" };
    } catch {
      return { status: "error" };
    }
  }

  try {
    const exists = await Bun.file(DB_PATHS[operator]).exists();
    if (cached === null) return { status: exists ? "error" : "missing" };
    return { status: exists ? "available" : "missing" };
  } catch {
    return { status: "error" };
  }
}

export async function getGtfsrHealthSnapshot(now = Date.now()): Promise<GtfsrHealthSnapshot> {
  const dbEntries = await Promise.all(
    ALL_OPERATORS.map(async (operator) => [operator, await getDbHealth(operator)] as const),
  );

  return {
    backgroundPollingStarted,
    nta: {
      vehicles: {
        count: vehicleCache?.length ?? 0,
        ageSec: ageSec(vehicleCacheUpdatedAt, now),
        lastAttemptAgeSec: ageSec(lastVehicleCall, now),
        intervalMs: NTA_MIN_INTERVAL_MS,
      },
      tripUpdates: {
        count: tripUpdateCache?.size ?? 0,
        ageSec: ageSec(tripUpdateCacheUpdatedAt, now),
        lastAttemptAgeSec: ageSec(lastTripUpdateCall, now),
        intervalMs: NTA_TRIP_UPDATES_INTERVAL_MS,
      },
    },
    db: Object.fromEntries(dbEntries) as GtfsrHealthSnapshot["db"],
  };
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

// Dublin-local seconds-since-midnight. The bus service-hours gate (05:00–00:00)
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

// ---------------------------------------------------------------------------
// Stop lookups — used by the "search by bus stop" UI
// ---------------------------------------------------------------------------

export type StopSearchResult = { id: string; name: string; code: string; lat: number; lng: number; operator: Operator };

export function getOperatorStop(operator: Operator, stopId: string): { name: string; lat: number; lng: number; code?: string } | null {
  return operatorStops[operator][stopId] ?? null;
}

export function searchBusStops(operator: Operator, query: string, limit = 10): StopSearchResult[] {
  const stops = operatorStops[operator];
  const q = query.trim();
  if (!q) return [];
  const out: StopSearchResult[] = [];
  // Exact ID match first — lets session/favorite rehydration round-trip a
  // stopId back to a full StopSearchResult without a separate endpoint.
  const direct = stops[q];
  if (direct) {
    out.push({ id: q, name: direct.name, code: direct.code ?? "", lat: direct.lat, lng: direct.lng, operator });
  }
  const isDigits = /^\d+$/.test(q);
  if (isDigits) {
    for (const [id, s] of Object.entries(stops)) {
      if (s.code && s.code === q) out.push({ id, name: s.name, code: s.code, lat: s.lat, lng: s.lng, operator });
      if (out.length >= limit) break;
    }
    if (out.length < limit) {
      for (const [id, s] of Object.entries(stops)) {
        if (out.find((r) => r.id === id)) continue;
        if (s.code && s.code.startsWith(q)) out.push({ id, name: s.name, code: s.code, lat: s.lat, lng: s.lng, operator });
        if (out.length >= limit) break;
      }
    }
    return out;
  }
  const qLower = q.toLowerCase();
  for (const [id, s] of Object.entries(stops)) {
    if (s.name.toLowerCase().startsWith(qLower)) {
      out.push({ id, name: s.name, code: s.code ?? "", lat: s.lat, lng: s.lng, operator });
      if (out.length >= limit) break;
    }
  }
  return out;
}

const ALL_OPERATORS: readonly Operator[] = ["dublinbus", "buseireann", "goahead"];

// Cross-operator stop search. Each operator gets its own per-call limit so a
// dense match in one operator's stops can't starve the others — the user
// typing "1234" should see Dublin Bus 1234, Bus Éireann 1234, Go-Ahead 1234
// in the same dropdown rather than the first one that fills the cap.
export function searchAllBusStops(query: string, perOperatorLimit = 5): StopSearchResult[] {
  const out: StopSearchResult[] = [];
  for (const op of ALL_OPERATORS) {
    out.push(...searchBusStops(op, query, perOperatorLimit));
  }
  return out;
}

const stopArrivalsStmtMap = new Map<Operator, ReturnType<Database["prepare"]>>();

export type StopArrivalDecision =
  | { keep: false }
  | { keep: true; etaSec: number; delaySec: number; vehicleSeq: number | null };

// Pure per-row decision used by getBusStopArrivals. Extracted so the filter
// rules can be unit-tested without mocking SQLite, NTA, or the date clock.
// GPS-first: when we have a vehicle ping, its closest-stop sequence is the
// authoritative "where is the bus" signal. NTA's stopTimeUpdates is fallback.
export function decideStopArrival(
  row: { stop_sequence: number; arrival_sec: number },
  live: LiveTripData,
  vehicle: { lat: number; lng: number } | null,
  tripStopCoords: Array<{ sequence: number; lat: number; lng: number }>,
  nowSec: number,
): StopArrivalDecision {
  let vehicleSeq: number | null = null;
  if (vehicle) {
    // Raw degree² rather than meters² — fine for picking the closest stop
    // along a single trip (relative order is preserved as long as stops are
    // roughly collinear). Would need cos(lat) scaling for cross-route nearest-
    // vehicle matching.
    let minDistSq = Infinity;
    for (const ts of tripStopCoords) {
      const dLat = ts.lat - vehicle.lat;
      const dLng = ts.lng - vehicle.lng;
      const d = dLat * dLat + dLng * dLng;
      if (d < minDistSq) { minDistSq = d; vehicleSeq = ts.sequence; }
    }
  }

  if (vehicleSeq !== null) {
    if (vehicleSeq > row.stop_sequence) return { keep: false };
  } else if (live.stopTimeUpdates.length > 0 && live.stopTimeUpdates[0]!.sequence > row.stop_sequence) {
    return { keep: false };
  }

  let propagated: number | null = null;
  for (const stu of live.stopTimeUpdates) {
    if (stu.arrivalDelaySec === null) continue;
    if (stu.sequence <= row.stop_sequence) propagated = stu.arrivalDelaySec;
    else if (propagated === null) { propagated = stu.arrivalDelaySec; break; }
    else break;
  }
  const delaySec = propagated ?? 0;

  let etaSec = row.arrival_sec + delaySec - nowSec;
  if (etaSec < 0) {
    if (vehicleSeq !== null && vehicleSeq <= row.stop_sequence) {
      etaSec = 0;
    } else {
      return { keep: false };
    }
  }

  return { keep: true, etaSec, delaySec, vehicleSeq };
}

export type BusStopArrival = {
  tripId: string;
  routeShortName: string;
  headsign: string;
  etaSeconds: number;
  delaySec: number;
  stopSequence: number;
  direction: string;
  // "running" — trip has a live vehicle_position, can be focused on the map.
  // "scheduled" — NTA has a trip_update prediction but the bus hasn't reported
  // its GPS yet (usually pre-departure). Frontend greys these out.
  status: "running" | "scheduled";
};

export async function getBusStopArrivals(operator: Operator, stopId: string, limit = 15): Promise<BusStopArrival[]> {
  if (!operatorStops[operator][stopId]) return [];
  const db = getScheduleDb(operator);
  if (!db) return [];

  if (!stopArrivalsStmtMap.has(operator)) {
    try {
      stopArrivalsStmtMap.set(
        operator,
        db.prepare(
          "SELECT trip_id, stop_sequence, arrival_sec FROM stop_times WHERE stop_id = ?",
        ),
      );
    } catch {
      return [];
    }
  }
  const stmt = stopArrivalsStmtMap.get(operator)!;
  let rows: { trip_id: string; stop_sequence: number; arrival_sec: number }[];
  try {
    rows = stmt.all(stopId) as typeof rows;
  } catch {
    return [];
  }

  const tripUpdates = await pollTripUpdates();
  const nowSec = secondsIntoDublinDay();

  // Map tripId → live GPS. Used as ground truth for "is the bus past my stop"
  // because NTA's stopTimeUpdates can drop earlier stops based on schedule
  // alone — when a bus runs late, NTA may strip stops that the bus hasn't
  // actually reached yet, causing the trip to disappear from arrivals.
  const vehicleByTripId = new Map<string, GtfsVehiclePosition>();
  for (const v of getCachedVehicles()) {
    if (v.tripId) vehicleByTripId.set(v.tripId, v);
  }

  const routes = operatorRoutes[operator];
  const shapes = operatorShapes[operator];
  const stopsDict = operatorStops[operator];
  const routeIdToShortName = new Map<string, string>();
  for (const r of routes) routeIdToShortName.set(r.id, r.shortName);

  const candidates: BusStopArrival[] = [];
  for (const r of rows) {
    // Hot-path: hottest stops hit ~6k rows from the static schedule but only
    // ~hundreds have a live TripUpdate at any moment. Cheap Map lookup first
    // so the bulk of non-live rows don't pay the SQLite cost of isTripEnded.
    const live = tripUpdates.get(r.trip_id);
    if (!live) continue;

    if (isTripEnded(operator, r.trip_id, nowSec, tripUpdates)) continue;

    // Build trip stop coords on demand only when we have a vehicle to match —
    // saves one SQLite query per non-running trip. Loop routes that revisit
    // a stop can mismatch sequence, but those are rare for the operators we cover.
    const vehicle = vehicleByTripId.get(r.trip_id);
    let tripStopCoords: Array<{ sequence: number; lat: number; lng: number }> = [];
    if (vehicle) {
      const tripStops = getTripScheduledStops(operator, r.trip_id);
      tripStopCoords = tripStops.flatMap((ts) => {
        const s = stopsDict[ts.stopId];
        return s ? [{ sequence: ts.sequence, lat: s.lat, lng: s.lng }] : [];
      });
    }

    const decision = decideStopArrival(r, live, vehicle ?? null, tripStopCoords, nowSec);
    if (!decision.keep) continue;
    const { etaSec, delaySec } = decision;

    const routeId = live.routeId;
    const directionId = live.directionId;
    if (!routeId) continue;

    const shortName = routeIdToShortName.get(routeId);
    if (!shortName) continue;

    const dirKey = String(directionId);
    const routeShape = shapes[routeId];
    const headsign = routeShape?.[dirKey]?.headsign ?? routeShape?.["0"]?.headsign ?? shortName;

    candidates.push({
      tripId: r.trip_id,
      routeShortName: shortName,
      headsign,
      etaSeconds: etaSec,
      delaySec,
      stopSequence: r.stop_sequence,
      direction: dirKey,
      status: vehicleByTripId.has(r.trip_id) ? "running" : "scheduled",
    });
  }

  candidates.sort((a, b) => a.etaSeconds - b.etaSeconds);
  return candidates.slice(0, limit);
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

// Two-level shape map for the bulk client endpoint:
//   endpoints: 156 endpoint pair keys -> routeKey (deduped reference)
//   shapes:    36 unique shapes by routeKey, only `coords` (the only field the client uses)
// Avoids the 4× duplication that would happen if every endpoint pair carried its own coords.
// Pre-computed at module load — zero cost per request.
const allTrainShapesPayload: {
  endpoints: Record<string, string>;
  shapes: Record<string, { coords: [number, number][] }>;
} = (() => {
  const endpointsOut: Record<string, string> = {};
  const shapesOut: Record<string, { coords: [number, number][] }> = {};
  const endpoints = trainEndpoints as unknown as Record<string, { routeId: string; directionId: number }>;
  const shapes = trainShapes as unknown as Record<string, Record<string, { coords: [number, number][] }>>;
  for (const [pairKey, { routeId, directionId }] of Object.entries(endpoints)) {
    const shape = shapes[routeId]?.[String(directionId)];
    if (!shape) continue;
    const routeKey = `${routeId}|${directionId}`;
    endpointsOut[pairKey] = routeKey;
    if (!shapesOut[routeKey]) {
      shapesOut[routeKey] = { coords: shape.coords };
    }
  }
  return { endpoints: endpointsOut, shapes: shapesOut };
})();

export function getAllTrainShapes() {
  return allTrainShapesPayload;
}
