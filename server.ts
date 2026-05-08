import index from "./index.html";
import { getCurrentTrains, getStationData, getTrainMovements } from "./src/api.ts";
import { getGtfsrVehiclePositions, getBusRoutes, getBusVehiclesByRoute, getAllBusVehicles, getBusRouteShape, getBusTripStops, getTrainRouteShape, getAllTrainShapes, getBusStopArrivals, searchBusStops, searchAllBusStops, getOperatorStop, getGtfsrHealthSnapshot, startBackgroundPolling, type Operator } from "./src/gtfsr.ts";
import { isInServiceHours } from "./src/utils.ts";

const VALID_OPERATORS = new Set<Operator>(["dublinbus", "buseireann", "goahead"]);

function parseOperator(raw: string | null): Operator | null {
  if (!raw) return null;
  return VALID_OPERATORS.has(raw as Operator) ? (raw as Operator) : null;
}

// Clamp ?mins= for Irish Rail station endpoint: NaN/huge values would still
// hit the upstream API and pollute cache keys.
function clampMins(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(120, Math.max(1, n));
}

// Irish Rail TrainDate format: "6 may 2026" / "06 may 2026" (lowercase short month).
// Day 1-31, month must be a real short name, year within ±1 of today — keeps
// cache keys bounded so an attacker can't blow up the cache by varying ?date=.
// Frontend doesn't send ?date= at all (server defaults to today), so failing
// validation simply falls back to today is fine.
const TRAIN_DATE_RE = /^(0?[1-9]|[12]\d|3[01]) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) \d{4}$/;

function isValidTrainDate(raw: string): boolean {
  if (!TRAIN_DATE_RE.test(raw)) return false;
  const year = parseInt(raw.slice(-4), 10);
  const thisYear = new Date().getFullYear();
  return year >= thisYear - 1 && year <= thisYear + 1;
}

// Service worker cache version: bumped automatically per Fly deploy so PWA
// clients re-precache after each release. Local dev gets a stable "dev" name
// so the cache isn't churned on restart.
const SW_CACHE_VERSION = process.env.FLY_MACHINE_VERSION ?? "dev";
const parsedPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const PORT = Number.isFinite(parsedPort) ? parsedPort : 3000;

// Irish Rail's "today" is Dublin's today — not fly's UTC today, which can be
// yesterday during summer-evening / early-morning windows.
const DUBLIN_DATE_FMT = new Intl.DateTimeFormat("en-IE", {
  timeZone: "Europe/Dublin",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function todayFormatted(): string {
  const parts = DUBLIN_DATE_FMT.formatToParts(new Date());
  const day = parts.find((p) => p.type === "day")!.value;
  const month = parts.find((p) => p.type === "month")!.value.toLowerCase();
  const year = parts.find((p) => p.type === "year")!.value;
  return `${day} ${month} ${year}`;
}

// ---------------------------------------------------------------------------
// Rate limit: 10 requests per minute per IP on /api/* endpoints.
// Localhost (dev + Fly-internal health checks) bypass.
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map<string, number[]>();
const ORIGIN_SECRET = process.env.ORIGIN_SECRET;

function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip")
    ?? req.headers.get("fly-client-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "local"
  );
}

function isLocalIp(ip: string): boolean {
  return ip === "local" || ip === "127.0.0.1" || ip === "::1";
}

function hasOriginAccess(req: Request): boolean {
  const ip = getClientIp(req);
  if (isLocalIp(ip)) return true;
  return Boolean(ORIGIN_SECRET && req.headers.get("x-origin-secret") === ORIGIN_SECRET);
}

function rateLimit<T extends (req: any) => Response | Promise<Response>>(handler: T): T {
  return (async (req: any) => {
    const ip = getClientIp(req);
    if (ORIGIN_SECRET && !isLocalIp(ip) && req.headers.get("x-origin-secret") !== ORIGIN_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!isLocalIp(ip)) {
      const now = Date.now();
      const timestamps = (rateLimitMap.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (timestamps.length >= RATE_LIMIT_MAX) {
        return new Response("Rate limit exceeded", {
          status: 429,
          headers: { "Retry-After": "60", "Content-Type": "text/plain" },
        });
      }
      timestamps.push(now);
      rateLimitMap.set(ip, timestamps);
    }
    return handler(req);
  }) as T;
}

// Periodic cleanup: drop entries with no recent activity (prevents Map growth under unique-IP traffic)
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, timestamps] of rateLimitMap) {
    const live = timestamps.filter((t) => t >= cutoff);
    if (live.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, live);
  }
}, 5 * 60_000);

function staticFile(path: string, ttlSec: number) {
  return () => new Response(Bun.file(path), {
    headers: { "Cache-Control": `public, max-age=${ttlSec}` },
  });
}

function memoryMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

async function detailedHealth() {
  return {
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    memoryMb: memoryMb(),
    gtfsr: await getGtfsrHealthSnapshot(),
  };
}

startBackgroundPolling();

Bun.serve({
  port: PORT,
  routes: {
    "/": index,
    "/health": rateLimit((req) => {
      if (!hasOriginAccess(req)) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }),
    "/api/health/details": rateLimit(async (req) => {
      if (!hasOriginAccess(req)) {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      return Response.json(await detailedHealth(), {
        headers: { "Cache-Control": "no-store" },
      });
    }),
    "/sw.js": async () => {
      const text = await Bun.file("./public/sw.js").text();
      const body = text.replace('"__CACHE_VERSION__"', JSON.stringify(SW_CACHE_VERSION));
      return new Response(body, {
        headers: {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    },
    "/manifest.json": staticFile("./public/manifest.json", 86400),
    "/og-image.png": staticFile("./public/og-image.png", 604800),
    "/icon-192.png": staticFile("./public/icon-192.png", 604800),
    "/icon-512.png": staticFile("./public/icon-512.png", 604800),
    "/icon.svg": staticFile("./public/icon.svg", 604800),
    "/splash/iphone-17-pro-max.png": staticFile("./public/splash/iphone-17-pro-max.png", 604800),
    "/splash/iphone-17.png": staticFile("./public/splash/iphone-17.png", 604800),
    "/splash/iphone-16-pro-max.png": staticFile("./public/splash/iphone-16-pro-max.png", 604800),
    "/splash/iphone-plus.png": staticFile("./public/splash/iphone-plus.png", 604800),
    "/splash/iphone-16-pro.png": staticFile("./public/splash/iphone-16-pro.png", 604800),
    "/splash/iphone-base.png": staticFile("./public/splash/iphone-base.png", 604800),
    "/splash/iphone-se.png": staticFile("./public/splash/iphone-se.png", 604800),
    "/api/trains": rateLimit(async (_req) => {
      // Matches api.ts cache TTL; SWR lets browser use stale data while a refresh is in flight.
      const headers = { "Cache-Control": "public, max-age=15, stale-while-revalidate=15" };
      // Off-hours short-circuit: skip the Irish Rail round-trip when no trains run.
      if (!isInServiceHours("train")) return Response.json([], { headers });
      try {
        const trains = await getCurrentTrains();
        return Response.json(trains, { headers });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/station/:code": rateLimit(async (req) => {
      const headers = { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" };
      if (!isInServiceHours("train")) return Response.json([], { headers });
      try {
        const code = req.params.code;
        const url = new URL(req.url);
        const numMins = clampMins(url.searchParams.get("mins"), 90);
        const data = await getStationData(code, numMins);
        return Response.json(data, { headers });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/trains/search": rateLimit(async (req) => {
      const headers = { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" };
      try {
        const url = new URL(req.url);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) {
          return Response.json({ error: "from and to required" }, { status: 400 });
        }
        if (!isInServiceHours("train")) return Response.json([], { headers });
        const [fromData, toData, currentTrains] = await Promise.all([
          getStationData(from, 120),
          getStationData(to, 120),
          getCurrentTrains(),
        ]);

        const fromMap = new Map(fromData.map((f) => [f.trainCode, f]));
        const currentMap = new Map(currentTrains.map((t) => [t.code, t]));

        // Only show trains that still stop at `from` in the upcoming window.
        // If a train no longer appears in fromData, it has already departed
        // from `from` — the user can't board it, so hide it even if its
        // origin matches `from`.
        const candidates = toData
          .map((t) => {
            const f = fromMap.get(t.trainCode);
            if (!f) return null;

            const current = currentMap.get(t.trainCode);
            const fromDep = f.expDepart || f.schDepart;
            const toArr = t.expArrival || t.schArrival;

            // Direction check: `from` must come before `to` on this train.
            if (f.dueIn >= t.dueIn) return null;

            let status: "running" | "ready" | "scheduled";
            if (current?.status === "R") status = "running";
            else if (current?.status === "N") status = "ready";
            else status = "scheduled";

            return {
              code: t.trainCode,
              origin: t.origin,
              destination: t.destination,
              fromDep,
              toArr,
              status,
            };
          })
          .filter((r) => r !== null);

        candidates.sort((a, b) => a.fromDep.localeCompare(b.fromDep));
        return Response.json(candidates.slice(0, 3), { headers });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/gtfsr/vehicles": rateLimit(async (_req) => {
      try {
        const vehicles = getGtfsrVehiclePositions();
        return Response.json(vehicles, {
          headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=15" },
        });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/train/:id": rateLimit(async (req) => {
      const headers = { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" };
      if (!isInServiceHours("train")) return Response.json([], { headers });
      try {
        const trainId = req.params.id;
        const url = new URL(req.url);
        const dateRaw = url.searchParams.get("date");
        const trainDate = dateRaw && isValidTrainDate(dateRaw) ? dateRaw : todayFormatted();
        const movements = await getTrainMovements(trainId, trainDate);
        return Response.json(movements, { headers });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/bus/routes": rateLimit(async (req) => {
      const operator = parseOperator(new URL(req.url).searchParams.get("operator") ?? "dublinbus");
      if (!operator) return Response.json({ error: "unknown operator" }, { status: 400 });
      return Response.json(getBusRoutes(operator), {
        headers: { "Cache-Control": "public, max-age=3600" }, // 1 hour; route list is static
      });
    }),
    "/api/bus/vehicles": rateLimit(async (req) => {
      // Server background poll runs every 35s — shortening CDN max-age below
      // that improves perceived freshness without burning more NTA quota.
      // 5s + 15s SWR keeps Fly origin hits low (~12/min/edge) while letting
      // the CDN return data within ~5s of the latest server snapshot.
      const vehicleHeaders = { "Cache-Control": "public, max-age=5, stale-while-revalidate=15" };
      // Off-hours short-circuit: don't pay an NTA round-trip when no buses run.
      // Frontend stops polling too, but stale tabs / other clients can still hit us.
      // Short TTL so CF flushes the empty payload quickly once service resumes.
      if (!isInServiceHours("bus")) return Response.json([], { headers: vehicleHeaders });
      try {
        const url = new URL(req.url);
        const operator = parseOperator(url.searchParams.get("operator") ?? "dublinbus");
        if (!operator) return Response.json({ error: "unknown operator" }, { status: 400 });
        const route = url.searchParams.get("route");
        if (!route) {
          const vehicles = await getAllBusVehicles(operator);
          return Response.json(vehicles, { headers: vehicleHeaders });
        }
        const dirParam = url.searchParams.get("direction");
        let direction: 0 | 1 | undefined = undefined;
        if (dirParam !== null) {
          const n = Number(dirParam);
          if (n !== 0 && n !== 1) {
            return Response.json({ error: "direction must be 0 or 1" }, { status: 400 });
          }
          direction = n;
        }
        const vehicles = await getBusVehiclesByRoute(operator, route, direction);
        return Response.json(vehicles, { headers: vehicleHeaders });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/bus/shape/:route": rateLimit(async (req) => {
      const url = new URL(req.url);
      const operator = parseOperator(url.searchParams.get("operator") ?? "dublinbus");
      if (!operator) return Response.json({ error: "unknown operator" }, { status: 400 });
      const shape = getBusRouteShape(operator, req.params.route);
      return Response.json(shape ?? {}, {
        headers: { "Cache-Control": "public, max-age=86400" }, // 1 day; shapes are static
      });
    }),
    "/api/bus/trip/:tripId": rateLimit(async (req) => {
      const tripHeaders = { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" };
      if (!isInServiceHours("bus")) return Response.json({}, { headers: tripHeaders });
      try {
        const url = new URL(req.url);
        const operator = parseOperator(url.searchParams.get("operator") ?? "dublinbus");
        if (!operator) return Response.json({ error: "unknown operator" }, { status: 400 });
        const trip = await getBusTripStops(operator, req.params.tripId);
        return Response.json(trip ?? {}, { headers: tripHeaders });
      } catch {
        return Response.json({}, { status: 502 });
      }
    }),
    "/api/bus/stops/search": rateLimit((req) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      const headers = { "Cache-Control": "public, max-age=3600" }; // stops list is static
      // operator omitted → cross-operator search. Lets the UI search "1234"
      // and pull matches from all three fleets in one round-trip.
      const opParam = url.searchParams.get("operator");
      if (opParam === null) {
        return Response.json(searchAllBusStops(q), { headers });
      }
      const operator = parseOperator(opParam);
      if (!operator) return Response.json({ error: "unknown operator" }, { status: 400 });
      return Response.json(searchBusStops(operator, q), { headers });
    }),
    "/api/bus/stop/:stopId/arrivals": rateLimit(async (req) => {
      const url = new URL(req.url);
      const operator = parseOperator(url.searchParams.get("operator") ?? "dublinbus");
      if (!operator) return Response.json({ error: "unknown operator" }, { status: 400 });
      const stopId = req.params.stopId;
      if (!getOperatorStop(operator, stopId)) {
        return Response.json({ error: "unknown stopId" }, { status: 404 });
      }
      const arrivalsHeaders = { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" };
      if (!isInServiceHours("bus")) return Response.json([], { headers: arrivalsHeaders });
      try {
        const arrivals = await getBusStopArrivals(operator, stopId);
        return Response.json(arrivals, { headers: arrivalsHeaders });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/train/shapes": rateLimit(() => {
      // Bulk endpoint: returns ALL train route shapes keyed by "origin|destination".
      // Frontend fetches this once on app start; subsequent shape lookups are
      // in-memory client-side. Avoids N parallel /api/train/shape requests
      // (which can trigger CF rate limit when many trains are active).
      return Response.json(getAllTrainShapes(), {
        headers: { "Cache-Control": "public, max-age=86400" }, // 1 day; static GTFS data
      });
    }),
    "/api/train/shape": rateLimit((req) => {
      const url = new URL(req.url);
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!from || !to) {
        return Response.json({ error: "from and to required" }, { status: 400 });
      }
      const shape = getTrainRouteShape(from, to);
      return Response.json(shape ?? {}, {
        headers: { "Cache-Control": "public, max-age=86400" }, // 1 day; shapes are static
      });
    }),
  },
  development: process.env.NODE_ENV !== "production" ? {
    hmr: true,
    console: true,
  } : false,
});

console.log(`Púca running on http://localhost:${PORT}`);
