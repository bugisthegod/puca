import index from "./index.html";
import {
	getCurrentTrains,
	getStationData,
	getTrainMovements,
} from "./src/api.ts";
import {
	getAllBusVehicles,
	getAllOperatorsBusVehicles,
	getAllTrainShapes,
	getBusRouteShape,
	getBusRoutes,
	getBusStopArrivals,
	getBusTripStops,
	getBusTripUpdateRealtimeHeaders,
	getBusVehicleRealtimeHeaders,
	getBusVehiclesByRoute,
	getGtfsrVehiclePositions,
	getOperatorStop,
	getTrainRouteShape,
	searchAllBusStops,
	searchBusStops,
	startBackgroundPolling,
} from "./src/gtfsr.ts";
import { errToMeta, log } from "./src/logger.ts";
import {
	getLuasStop,
	getLuasStopArrivals,
	getLuasStops,
	searchLuasStops,
} from "./src/luas.ts";
import {
	REALTIME_MATCHED_VEHICLE_COUNT_HEADER,
	REALTIME_RAW_VEHICLE_COUNT_HEADER,
	REALTIME_STATUS_HEADER,
} from "./src/realtime.ts";
import {
	clampMins,
	createServerTimer,
	detailedHealth,
	hasUsableTrainPosition,
	isValidTrainDate,
	logSlowRequest,
	parseOperator,
	startEventLoopLagMonitor,
	staticFile,
	todayFormatted,
	withServerTiming,
} from "./src/server/helpers.ts";
import { hasOriginAccess, rateLimit } from "./src/server/rateLimit.ts";
import { OPERATORS } from "./src/types.ts";
import { isInServiceHours } from "./src/utils.ts";

// Service worker cache version: bumped automatically per Fly deploy so PWA
// clients re-precache after each release. Local dev gets a stable "dev" name
// so the cache isn't churned on restart.
const SW_CACHE_VERSION = process.env.FLY_MACHINE_VERSION ?? "dev";
const parsedPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const PORT = Number.isFinite(parsedPort) ? parsedPort : 3000;

function routeParam(req: Request, name: string): string {
	return (
		(req as Request & { params: Record<string, string> }).params[name] ?? ""
	);
}

startBackgroundPolling();
startEventLoopLagMonitor();

Bun.serve({
	port: PORT,
	routes: {
		"/": index,
		"/health": rateLimit((req) => {
			if (!hasOriginAccess(req))
				return Response.json({ error: "not found" }, { status: 404 });
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
			const body = text.replace(
				'"__CACHE_VERSION__"',
				JSON.stringify(SW_CACHE_VERSION),
			);
			return new Response(body, {
				headers: {
					"Content-Type": "application/javascript",
					"Cache-Control": "no-cache, no-store, must-revalidate",
				},
			});
		},
		"/llms.txt": staticFile("./public/llms.txt", 3600),
		"/llms-full.txt": staticFile("./public/llms-full.txt", 3600),
		"/about.md": staticFile("./public/about.md", 3600),
		"/sitemap.xml": staticFile("./public/sitemap.xml", 3600),
		"/manifest.json": staticFile("./public/manifest.json", 86400),
		"/public/manifest.json": staticFile("./public/manifest.json", 86400),
		"/og-image.png": staticFile("./public/og-image.png", 604800),
		"/public/og-image.png": staticFile("./public/og-image.png", 604800),
		"/icon-192.png": staticFile("./public/icon-192.png", 604800),
		"/public/icon-192.png": staticFile("./public/icon-192.png", 604800),
		"/icon-512.png": staticFile("./public/icon-512.png", 604800),
		"/public/icon-512.png": staticFile("./public/icon-512.png", 604800),
		"/icon.svg": staticFile("./public/icon.svg", 604800),
		"/public/icon.svg": staticFile("./public/icon.svg", 604800),
		"/puca-jack-o.svg": staticFile("./public/puca-jack-o.svg", 604800),
		"/public/puca-jack-o.svg": staticFile("./public/puca-jack-o.svg", 604800),
		"/puca-sleeping.svg": staticFile("./public/puca-sleeping.svg", 604800),
		"/public/puca-sleeping.svg": staticFile(
			"./public/puca-sleeping.svg",
			604800,
		),
		"/splash/iphone-17-pro-max.png": staticFile(
			"./public/splash/iphone-17-pro-max.png",
			604800,
		),
		"/public/splash/iphone-17-pro-max.png": staticFile(
			"./public/splash/iphone-17-pro-max.png",
			604800,
		),
		"/splash/iphone-17.png": staticFile(
			"./public/splash/iphone-17.png",
			604800,
		),
		"/public/splash/iphone-17.png": staticFile(
			"./public/splash/iphone-17.png",
			604800,
		),
		"/splash/iphone-16-pro-max.png": staticFile(
			"./public/splash/iphone-16-pro-max.png",
			604800,
		),
		"/public/splash/iphone-16-pro-max.png": staticFile(
			"./public/splash/iphone-16-pro-max.png",
			604800,
		),
		"/splash/iphone-plus.png": staticFile(
			"./public/splash/iphone-plus.png",
			604800,
		),
		"/public/splash/iphone-plus.png": staticFile(
			"./public/splash/iphone-plus.png",
			604800,
		),
		"/splash/iphone-16-pro.png": staticFile(
			"./public/splash/iphone-16-pro.png",
			604800,
		),
		"/public/splash/iphone-16-pro.png": staticFile(
			"./public/splash/iphone-16-pro.png",
			604800,
		),
		"/splash/iphone-base.png": staticFile(
			"./public/splash/iphone-base.png",
			604800,
		),
		"/public/splash/iphone-base.png": staticFile(
			"./public/splash/iphone-base.png",
			604800,
		),
		"/splash/iphone-se.png": staticFile(
			"./public/splash/iphone-se.png",
			604800,
		),
		"/public/splash/iphone-se.png": staticFile(
			"./public/splash/iphone-se.png",
			604800,
		),
		"/api/trains": rateLimit(async (_req) => {
			// Matches api.ts cache TTL; SWR lets browser use stale data while a refresh is in flight.
			const headers = {
				"Cache-Control": "public, max-age=15, stale-while-revalidate=15",
			};
			// Off-hours short-circuit: skip the Irish Rail round-trip when no trains run.
			if (!isInServiceHours("train")) return Response.json([], { headers });
			try {
				const trains = await getCurrentTrains();
				return Response.json(trains, { headers });
			} catch (err) {
				log.error("http.trains.failed", errToMeta(err));
				return Response.json([], { status: 502 });
			}
		}),
		"/api/station/:code": rateLimit(async (req) => {
			const headers = {
				"Cache-Control": "public, max-age=30, stale-while-revalidate=30",
			};
			if (!isInServiceHours("train")) return Response.json([], { headers });
			try {
				const code = routeParam(req, "code");
				const url = new URL(req.url);
				const numMins = clampMins(url.searchParams.get("mins"), 90);
				const data = await getStationData(code, numMins);
				return Response.json(data, { headers });
			} catch {
				return Response.json([], { status: 502 });
			}
		}),
		"/api/trains/search": rateLimit(async (req) => {
			const headers = {
				"Cache-Control": "public, max-age=30, stale-while-revalidate=30",
			};
			try {
				const url = new URL(req.url);
				const from = url.searchParams.get("from");
				const to = url.searchParams.get("to");
				if (!from || !to) {
					return Response.json(
						{ error: "from and to required" },
						{ status: 400 },
					);
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

						let status: "running" | "ready" | "unmapped" | "scheduled";
						if (current?.status === "R")
							status = hasUsableTrainPosition(current) ? "running" : "unmapped";
						else if (current?.status === "N")
							status = hasUsableTrainPosition(current) ? "ready" : "scheduled";
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
					headers: {
						"Cache-Control": "public, max-age=15, stale-while-revalidate=15",
					},
				});
			} catch {
				return Response.json([], { status: 502 });
			}
		}),
		"/api/train/:id": rateLimit(async (req) => {
			const headers = {
				"Cache-Control": "public, max-age=30, stale-while-revalidate=30",
			};
			if (!isInServiceHours("train")) return Response.json([], { headers });
			try {
				const trainId = routeParam(req, "id");
				const url = new URL(req.url);
				const dateRaw = url.searchParams.get("date");
				const trainDate =
					dateRaw && isValidTrainDate(dateRaw) ? dateRaw : todayFormatted();
				const movements = await getTrainMovements(trainId, trainDate);
				return Response.json(movements, { headers });
			} catch {
				return Response.json([], { status: 502 });
			}
		}),
		"/api/bus/routes/all": rateLimit(() => {
			return Response.json(
				OPERATORS.flatMap((operator) =>
					getBusRoutes(operator).map((route) => ({ ...route, operator })),
				),
				{
					headers: { "Cache-Control": "public, max-age=3600" },
				},
			);
		}),
		"/api/bus/routes": rateLimit(async (req) => {
			const url = new URL(req.url);
			const operator = parseOperator(
				url.searchParams.get("operator") ?? "dublinbus",
			);
			if (!operator)
				return Response.json({ error: "unknown operator" }, { status: 400 });
			return Response.json(getBusRoutes(operator), {
				headers: { "Cache-Control": "public, max-age=3600" }, // 1 hour; route list is static
			});
		}),
		"/api/bus/vehicles/all": rateLimit(async () => {
			const timer = createServerTimer();
			const cacheControl =
				"public, max-age=0, s-maxage=5, stale-while-revalidate=15";
			const vehicleHeaders: Record<string, string> = {
				"Cache-Control": cacheControl,
				...getBusVehicleRealtimeHeaders(),
			};
			if (!isInServiceHours("bus")) {
				timer.mark("service_hours");
				return Response.json([], {
					headers: withServerTiming(
						{
							"Cache-Control": cacheControl,
						},
						timer,
					),
				});
			}
			try {
				const vehicles = await getAllOperatorsBusVehicles();
				const rawVehicleCount = getGtfsrVehiclePositions().length;
				vehicleHeaders[REALTIME_RAW_VEHICLE_COUNT_HEADER] =
					String(rawVehicleCount);
				vehicleHeaders[REALTIME_MATCHED_VEHICLE_COUNT_HEADER] = String(
					vehicles.length,
				);
				if (rawVehicleCount > 0 && vehicles.length === 0) {
					vehicleHeaders[REALTIME_STATUS_HEADER] = "route-mismatch";
				}
				timer.mark("data");
				logSlowRequest(timer, "http.bus_vehicles_all.slow", {
					vehicle_count: vehicles.length,
					raw_vehicle_count: rawVehicleCount,
				});
				return Response.json(vehicles, {
					headers: withServerTiming(vehicleHeaders, timer),
				});
			} catch (err) {
				timer.mark("error");
				log.error("http.bus_vehicles_all.failed", {
					...errToMeta(err),
					duration_ms: Math.round(timer.totalMs()),
				});
				return Response.json([], {
					status: 502,
					headers: withServerTiming(getBusVehicleRealtimeHeaders(), timer),
				});
			}
		}),
		"/api/bus/vehicles": rateLimit(async (req) => {
			const timer = createServerTimer();
			// Server background poll runs every 35s — shortening CDN max-age below
			// that improves perceived freshness without burning more NTA quota.
			// 5s + 15s SWR keeps Fly origin hits low (~12/min/edge) while letting
			// the CDN return data within ~5s of the latest server snapshot.
			const vehicleHeaders = {
				"Cache-Control":
					"public, max-age=0, s-maxage=5, stale-while-revalidate=15",
				...getBusVehicleRealtimeHeaders(),
			};
			// Off-hours short-circuit: don't pay an NTA round-trip when no buses run.
			// Frontend stops polling too, but stale tabs / other clients can still hit us.
			// Short TTL so CF flushes the empty payload quickly once service resumes.
			if (!isInServiceHours("bus")) {
				timer.mark("service_hours");
				return Response.json([], {
					headers: withServerTiming(
						{
							"Cache-Control": vehicleHeaders["Cache-Control"],
						},
						timer,
					),
				});
			}
			const url = new URL(req.url);
			try {
				const operator = parseOperator(
					url.searchParams.get("operator") ?? "dublinbus",
				);
				timer.mark("parse");
				if (!operator)
					return Response.json(
						{ error: "unknown operator" },
						{ status: 400, headers: withServerTiming(undefined, timer) },
					);
				const route = url.searchParams.get("route");
				if (!route) {
					const vehicles = await getAllBusVehicles(operator);
					timer.mark("data");
					logSlowRequest(timer, "http.bus_vehicles.slow", {
						operator,
						route: null,
						vehicle_count: vehicles.length,
					});
					return Response.json(vehicles, {
						headers: withServerTiming(vehicleHeaders, timer),
					});
				}
				const dirParam = url.searchParams.get("direction");
				let direction: 0 | 1 | undefined;
				if (dirParam !== null) {
					const n = Number(dirParam);
					if (n !== 0 && n !== 1) {
						return Response.json(
							{ error: "direction must be 0 or 1" },
							{ status: 400, headers: withServerTiming(undefined, timer) },
						);
					}
					direction = n;
				}
				const vehicles = await getBusVehiclesByRoute(
					operator,
					route,
					direction,
				);
				timer.mark("data");
				logSlowRequest(timer, "http.bus_vehicles.slow", {
					operator,
					route,
					direction: direction ?? null,
					vehicle_count: vehicles.length,
				});
				return Response.json(vehicles, {
					headers: withServerTiming(vehicleHeaders, timer),
				});
			} catch (err) {
				timer.mark("error");
				log.error("http.bus_vehicles.failed", {
					...errToMeta(err),
					operator: url.searchParams.get("operator") ?? "dublinbus",
					route: url.searchParams.get("route"),
					direction: url.searchParams.get("direction"),
					duration_ms: Math.round(timer.totalMs()),
				});
				return Response.json([], {
					status: 502,
					headers: withServerTiming(getBusVehicleRealtimeHeaders(), timer),
				});
			}
		}),
		"/api/bus/shape/:route": rateLimit(async (req) => {
			const url = new URL(req.url);
			const operator = parseOperator(
				url.searchParams.get("operator") ?? "dublinbus",
			);
			if (!operator)
				return Response.json({ error: "unknown operator" }, { status: 400 });
			const shape = getBusRouteShape(operator, routeParam(req, "route"));
			return Response.json(shape ?? {}, {
				headers: { "Cache-Control": "public, max-age=86400" }, // 1 day; shapes are static
			});
		}),
		"/api/bus/trip/:tripId": rateLimit(async (req) => {
			const timer = createServerTimer();
			const tripHeaders = {
				"Cache-Control": "public, max-age=30, stale-while-revalidate=60",
			};
			if (!isInServiceHours("bus")) {
				timer.mark("service_hours");
				return Response.json(
					{},
					{ headers: withServerTiming(tripHeaders, timer) },
				);
			}
			const url = new URL(req.url);
			const tripId = routeParam(req, "tripId");
			try {
				const operator = parseOperator(
					url.searchParams.get("operator") ?? "dublinbus",
				);
				timer.mark("parse");
				if (!operator)
					return Response.json(
						{ error: "unknown operator" },
						{ status: 400, headers: withServerTiming(undefined, timer) },
					);
				const trip = await getBusTripStops(operator, tripId);
				timer.mark("data");
				logSlowRequest(timer, "http.bus_trip.slow", {
					operator,
					trip_id: tripId,
					stop_count: trip?.stops.length ?? 0,
					found: Boolean(trip),
				});
				return Response.json(trip ?? {}, {
					headers: withServerTiming(tripHeaders, timer),
				});
			} catch (err) {
				timer.mark("error");
				log.error("http.bus_trip.failed", {
					...errToMeta(err),
					operator: url.searchParams.get("operator") ?? "dublinbus",
					trip_id: tripId,
					duration_ms: Math.round(timer.totalMs()),
				});
				return Response.json(
					{},
					{ status: 502, headers: withServerTiming(undefined, timer) },
				);
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
			if (!operator)
				return Response.json({ error: "unknown operator" }, { status: 400 });
			return Response.json(searchBusStops(operator, q), { headers });
		}),
		"/api/bus/stop/:stopId/arrivals": rateLimit(async (req) => {
			const timer = createServerTimer();
			const url = new URL(req.url);
			const operator = parseOperator(
				url.searchParams.get("operator") ?? "dublinbus",
			);
			const stopId = routeParam(req, "stopId");
			timer.mark("parse");
			if (!operator)
				return Response.json(
					{ error: "unknown operator" },
					{ status: 400, headers: withServerTiming(undefined, timer) },
				);
			if (!getOperatorStop(operator, stopId)) {
				timer.mark("validate");
				return Response.json(
					{ error: "unknown stopId" },
					{ status: 404, headers: withServerTiming(undefined, timer) },
				);
			}
			timer.mark("validate");
			const arrivalsHeaders = {
				"Cache-Control": "public, max-age=30, stale-while-revalidate=60",
				...getBusTripUpdateRealtimeHeaders(),
			};
			if (!isInServiceHours("bus")) {
				timer.mark("service_hours");
				return Response.json([], {
					headers: withServerTiming(
						{
							"Cache-Control": arrivalsHeaders["Cache-Control"],
						},
						timer,
					),
				});
			}
			try {
				const arrivals = await getBusStopArrivals(operator, stopId);
				timer.mark("data");
				logSlowRequest(timer, "http.bus_arrivals.slow", {
					operator,
					stop_id: stopId,
					arrival_count: arrivals.length,
				});
				return Response.json(arrivals, {
					headers: withServerTiming(arrivalsHeaders, timer),
				});
			} catch (err) {
				timer.mark("error");
				log.error("http.bus_arrivals.failed", {
					...errToMeta(err),
					operator: url.searchParams.get("operator") ?? "dublinbus",
					stop_id: stopId,
					duration_ms: Math.round(timer.totalMs()),
				});
				return Response.json([], {
					status: 502,
					headers: withServerTiming(getBusTripUpdateRealtimeHeaders(), timer),
				});
			}
		}),
		"/api/luas/stops": rateLimit(() => {
			try {
				return Response.json(getLuasStops(), {
					headers: { "Cache-Control": "public, max-age=86400" },
				});
			} catch (err) {
				log.error("http.luas_stops.failed", errToMeta(err));
				return Response.json([], { status: 502 });
			}
		}),
		"/api/luas/stops/search": rateLimit((req) => {
			try {
				const url = new URL(req.url);
				return Response.json(searchLuasStops(url.searchParams.get("q") ?? ""), {
					headers: { "Cache-Control": "public, max-age=3600" },
				});
			} catch (err) {
				log.error("http.luas_stops_search.failed", errToMeta(err));
				return Response.json([], { status: 502 });
			}
		}),
		"/api/luas/stop/:stopId/arrivals": rateLimit((req) => {
			try {
				const stopId = routeParam(req, "stopId");
				if (!getLuasStop(stopId)) {
					return Response.json({ error: "unknown stopId" }, { status: 404 });
				}
				return Response.json(getLuasStopArrivals(stopId), {
					headers: {
						"Cache-Control": "public, max-age=30, stale-while-revalidate=60",
					},
				});
			} catch (err) {
				log.error("http.luas_arrivals.failed", errToMeta(err));
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
				return Response.json(
					{ error: "from and to required" },
					{ status: 400 },
				);
			}
			const shape = getTrainRouteShape(from, to);
			return Response.json(shape ?? {}, {
				headers: { "Cache-Control": "public, max-age=86400" }, // 1 day; shapes are static
			});
		}),
	},
	development:
		process.env.NODE_ENV !== "production"
			? {
					hmr: true,
					console: true,
				}
			: false,
});

console.log(`Púca running on http://localhost:${PORT}`);
