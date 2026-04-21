import index from "./index.html";
import { getCurrentTrains, getStationData, getTrainMovements } from "./src/api.ts";
import { getGtfsrVehiclePositions, getBusRoutes, getBusVehiclesByRoute, getAllBusVehicles, getBusRouteShape, getBusTripStops, getTrainRouteShape, type Operator } from "./src/gtfsr.ts";
import { isInServiceHours } from "./src/utils.ts";

function todayFormatted(): string {
  const d = new Date();
  const day = d.getDate();
  const month = d.toLocaleString("en-IE", { month: "short" }).toLowerCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// ---------------------------------------------------------------------------
// Rate limit: 10 requests per minute per IP on /api/* endpoints.
// Localhost (dev + Fly-internal health checks) bypass.
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map<string, number[]>();

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

function rateLimit<T extends (req: any) => Response | Promise<Response>>(handler: T): T {
  return (async (req: any) => {
    const ip = getClientIp(req);
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

Bun.serve({
  port: 3000,
  routes: {
    "/": index,
    "/sw.js": () => new Response(Bun.file("./public/sw.js"), {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
      },
    }),
    "/manifest.json": () => new Response(Bun.file("./public/manifest.json")),
    "/icon-192.png": () => new Response(Bun.file("./public/icon-192.png")),
    "/icon-512.png": () => new Response(Bun.file("./public/icon-512.png")),
    "/icon.svg": () => new Response(Bun.file("./public/icon.svg")),
    "/splash/iphone-17-pro-max.png": () => new Response(Bun.file("./public/splash/iphone-17-pro-max.png")),
    "/splash/iphone-17.png": () => new Response(Bun.file("./public/splash/iphone-17.png")),
    "/splash/iphone-16-pro-max.png": () => new Response(Bun.file("./public/splash/iphone-16-pro-max.png")),
    "/splash/iphone-plus.png": () => new Response(Bun.file("./public/splash/iphone-plus.png")),
    "/splash/iphone-16-pro.png": () => new Response(Bun.file("./public/splash/iphone-16-pro.png")),
    "/splash/iphone-base.png": () => new Response(Bun.file("./public/splash/iphone-base.png")),
    "/splash/iphone-se.png": () => new Response(Bun.file("./public/splash/iphone-se.png")),
    "/api/trains": rateLimit(async (_req) => {
      try {
        const trains = await getCurrentTrains();
        return Response.json(trains, {
          // Matches api.ts cache TTL; SWR lets browser use stale data while a refresh is in flight.
          headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=15" },
        });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/station/:code": rateLimit(async (req) => {
      try {
        const code = req.params.code;
        const url = new URL(req.url);
        const minsParam = url.searchParams.get("mins");
        const numMins = minsParam ? parseInt(minsParam, 10) : 90;
        const data = await getStationData(code, numMins);
        return Response.json(data, {
          headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
        });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/trains/search": rateLimit(async (req) => {
      try {
        const url = new URL(req.url);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) {
          return Response.json({ error: "from and to required" }, { status: 400 });
        }
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
        return Response.json(candidates.slice(0, 3), {
          headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
        });
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
      try {
        const trainId = req.params.id;
        const url = new URL(req.url);
        const trainDate = url.searchParams.get("date") ?? todayFormatted();
        const movements = await getTrainMovements(trainId, trainDate);
        return Response.json(movements, {
          headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30" },
        });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/bus/routes": rateLimit(async (req) => {
      const operator = (new URL(req.url).searchParams.get("operator") ?? "dublinbus") as Operator;
      return Response.json(getBusRoutes(operator), {
        headers: { "Cache-Control": "public, max-age=3600" }, // 1 hour; route list is static
      });
    }),
    "/api/bus/vehicles": rateLimit(async (req) => {
      // Off-hours short-circuit: don't pay an NTA round-trip when no buses run.
      // Frontend stops polling too, but stale tabs / other clients can still hit us.
      if (!isInServiceHours("bus")) return Response.json([]);
      // NTA cache gate is 30s; allow browsers to reuse for up to 15s and revalidate in the background.
      const vehicleHeaders = { "Cache-Control": "public, max-age=15, stale-while-revalidate=15" };
      try {
        const url = new URL(req.url);
        const operator = (url.searchParams.get("operator") ?? "dublinbus") as Operator;
        const route = url.searchParams.get("route");
        if (!route) {
          const vehicles = await getAllBusVehicles(operator);
          return Response.json(vehicles, { headers: vehicleHeaders });
        }
        const dirParam = url.searchParams.get("direction");
        const direction = dirParam !== null ? Number(dirParam) : undefined;
        const vehicles = await getBusVehiclesByRoute(operator, route, direction);
        return Response.json(vehicles, { headers: vehicleHeaders });
      } catch {
        return Response.json([], { status: 502 });
      }
    }),
    "/api/bus/shape/:route": rateLimit(async (req) => {
      const url = new URL(req.url);
      const operator = (url.searchParams.get("operator") ?? "dublinbus") as Operator;
      const shape = getBusRouteShape(operator, req.params.route);
      return Response.json(shape ?? {}, {
        headers: { "Cache-Control": "public, max-age=86400" }, // 1 day; shapes are static
      });
    }),
    "/api/bus/trip/:tripId": rateLimit(async (req) => {
      if (!isInServiceHours("bus")) return Response.json({});
      try {
        const url = new URL(req.url);
        const operator = (url.searchParams.get("operator") ?? "dublinbus") as Operator;
        const trip = await getBusTripStops(operator, req.params.tripId);
        return Response.json(trip ?? {}, {
          headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
        });
      } catch {
        return Response.json({}, { status: 502 });
      }
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
  development: {
    hmr: true,
    console: true,
  },
});

console.log("Púca running on http://localhost:3000");
