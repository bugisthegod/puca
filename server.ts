import index from "./index.html";
import { getCurrentTrains, getStationData, getTrainMovements, getAllStations } from "./src/api.ts";
import { getGtfsrVehiclePositions } from "./src/gtfsr.ts";

function todayFormatted(): string {
  const d = new Date();
  const day = d.getDate();
  const month = d.toLocaleString("en-IE", { month: "short" }).toLowerCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

Bun.serve({
  port: 3000,
  routes: {
    "/": index,
    "/api/trains": async (_req) => {
      try {
        const trains = await getCurrentTrains();
        return Response.json(trains);
      } catch {
        return Response.json([], { status: 502 });
      }
    },
    "/api/station/:code": async (req) => {
      try {
        const code = req.params.code;
        const url = new URL(req.url);
        const minsParam = url.searchParams.get("mins");
        const numMins = minsParam ? parseInt(minsParam, 10) : 90;
        const data = await getStationData(code, numMins);
        return Response.json(data);
      } catch {
        return Response.json([], { status: 502 });
      }
    },
    "/api/stations": async (_req) => {
      try {
        const stations = await getAllStations();
        return Response.json(stations);
      } catch {
        return Response.json([], { status: 502 });
      }
    },
    "/api/trains/search": async (req) => {
      try {
        const url = new URL(req.url);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) {
          return Response.json({ error: "from and to required" }, { status: 400 });
        }
        // 1. Get station data for both stations + current trains
        const [fromData, toData, currentTrains] = await Promise.all([
          getStationData(from, 120),
          getStationData(to, 120),
          getCurrentTrains(),
        ]);

        // 2. Find trains passing through both stations (from before to)
        const toMap = new Map(toData.map((t) => [t.trainCode, t]));
        const currentMap = new Map(currentTrains.map((t) => [t.code, t]));

        const candidates = fromData
          .filter((f) => toMap.has(f.trainCode))
          .map((f) => {
            const t = toMap.get(f.trainCode)!;
            const current = currentMap.get(f.trainCode);
            const fromDep = f.expDepart || f.schDepart;
            const toArr = t.expArrival || t.schArrival;

            // Verify direction: train must be due at 'from' before 'to'
            if (f.dueIn >= t.dueIn) return null;

            let status: "running" | "ready" | "scheduled";
            if (current?.status === "R") status = "running";
            else if (current?.status === "N") status = "ready";
            else status = "scheduled";

            return {
              code: f.trainCode,
              origin: f.origin,
              destination: f.destination,
              fromDep,
              toArr,
              status,
            };
          })
          .filter((r) => r !== null);

        // 3. Sort by departure time, take first 3
        candidates.sort((a, b) => a.fromDep.localeCompare(b.fromDep));
        return Response.json(candidates.slice(0, 3));
      } catch {
        return Response.json([], { status: 502 });
      }
    },
    "/api/gtfsr/vehicles": async (_req) => {
      try {
        const vehicles = await getGtfsrVehiclePositions();
        return Response.json(vehicles);
      } catch {
        return Response.json([], { status: 502 });
      }
    },
    "/api/train/:id": async (req) => {
      try {
        const trainId = req.params.id;
        const url = new URL(req.url);
        const trainDate = url.searchParams.get("date") ?? todayFormatted();
        const movements = await getTrainMovements(trainId, trainDate);
        return Response.json(movements);
      } catch {
        return Response.json([], { status: 502 });
      }
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log("Irish Rail Tracker running on http://localhost:3000");
