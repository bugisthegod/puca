type CsvRow = Record<string, string>;

type LuasStop = {
	id: string;
	platformIds: string[];
	name: string;
	lat: number;
	lng: number;
	line: "green" | "red" | "both";
};

type LuasArrival = {
	stopId: string;
	routeShortName: string;
	headsign: string;
	departureSec: number;
	serviceId: string;
};

type CompactArrival = [
	routeShortName: string,
	headsign: string,
	departureSec: number,
	serviceId: string,
];

const GTFS_DIR = "gtfs";
const OUT_DIR = "src/data";
const LUAS_AGENCY_ID = "10000";

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += ch;
			}
			continue;
		}

		if (ch === '"') quoted = true;
		else if (ch === ",") {
			row.push(field);
			field = "";
		} else if (ch === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else if (ch !== "\r") {
			field += ch;
		}
	}

	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

async function readCsv(path: string): Promise<CsvRow[]> {
	const rows = parseCsv(await Bun.file(`${GTFS_DIR}/${path}`).text());
	const header = rows.shift();
	if (!header) return [];
	return rows
		.filter((row) => row.some((value) => value !== ""))
		.map((row) =>
			Object.fromEntries(header.map((key, i) => [key, row[i] ?? ""])),
		);
}

function value(row: CsvRow, key: string): string {
	return row[key] ?? "";
}

function routeLine(routeShortName: string): "green" | "red" {
	const lower = routeShortName.toLowerCase();
	if (lower.includes("red")) return "red";
	if (lower.includes("green")) return "green";
	throw new Error(`Unknown Luas route line: ${routeShortName}`);
}

function cleanStopName(name: string): string {
	return name.replace(/\s*\(Luas\)\s*$/i, "").trim();
}

const [routes, trips, stops, stopTimes, calendar, calendarDates] =
	await Promise.all([
		readCsv("routes.txt"),
		readCsv("trips.txt"),
		readCsv("stops.txt"),
		readCsv("stop_times.txt"),
		readCsv("calendar.txt"),
		readCsv("calendar_dates.txt"),
	]);

const luasRoutes = new Map(
	routes
		.filter((route) => value(route, "agency_id") === LUAS_AGENCY_ID)
		.map((route) => [
			value(route, "route_id"),
			{
				shortName:
					value(route, "route_short_name") || value(route, "route_long_name"),
				line: routeLine(
					value(route, "route_short_name") || value(route, "route_long_name"),
				),
			},
		]),
);
const luasTrips = new Map(
	trips
		.filter((trip) => luasRoutes.has(value(trip, "route_id")))
		.map((trip) => [value(trip, "trip_id"), trip]),
);
const stopLine = new Map<string, "green" | "red" | "both">();
const arrivals: LuasArrival[] = [];

for (const stopTime of stopTimes) {
	const trip = luasTrips.get(value(stopTime, "trip_id"));
	if (!trip) continue;
	const route = luasRoutes.get(value(trip, "route_id"));
	if (!route) continue;
	const stopId = value(stopTime, "stop_id");
	const previousLine = stopLine.get(stopId);
	stopLine.set(
		stopId,
		previousLine && previousLine !== route.line ? "both" : route.line,
	);
	const [hh = "0", mm = "0", ss = "0"] = (
		value(stopTime, "departure_time") || value(stopTime, "arrival_time")
	).split(":");
	arrivals.push({
		stopId,
		routeShortName: route.shortName,
		headsign: value(trip, "trip_headsign"),
		departureSec: Number(hh) * 3600 + Number(mm) * 60 + Number(ss),
		serviceId: value(trip, "service_id"),
	});
}

const platformStops = stops
	.filter((stop) => stopLine.has(value(stop, "stop_id")))
	.map((stop) => ({
		id: value(stop, "stop_id"),
		name: cleanStopName(value(stop, "stop_name")),
		lat: Number(value(stop, "stop_lat")),
		lng: Number(value(stop, "stop_lon")),
		line: stopLine.get(value(stop, "stop_id")) ?? "both",
	}));

const groupedStops = new Map<
	string,
	{
		ids: string[];
		name: string;
		latSum: number;
		lngSum: number;
		line: "green" | "red" | "both";
	}
>();
for (const stop of platformStops) {
	const key = stop.name.toLowerCase();
	const group = groupedStops.get(key);
	if (!group) {
		groupedStops.set(key, {
			ids: [stop.id],
			name: stop.name,
			latSum: stop.lat,
			lngSum: stop.lng,
			line: stop.line,
		});
		continue;
	}
	group.ids.push(stop.id);
	group.latSum += stop.lat;
	group.lngSum += stop.lng;
	if (group.line !== stop.line) group.line = "both";
}

const luasStops: LuasStop[] = [...groupedStops.values()]
	.map((group) => ({
		id: group.ids[0] ?? group.name,
		platformIds: group.ids.sort(),
		name: group.name,
		lat: Number((group.latSum / group.ids.length).toFixed(7)),
		lng: Number((group.lngSum / group.ids.length).toFixed(7)),
		line: group.line,
	}))
	.sort((a, b) => a.name.localeCompare(b.name));

const serviceCalendar = Object.fromEntries(
	calendar.map((service) => [
		value(service, "service_id"),
		[
			[
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
				"sunday",
			]
				.map((day) => value(service, day))
				.join(""),
			value(service, "start_date"),
			value(service, "end_date"),
		],
	]),
);
const serviceExceptions = calendarDates
	.filter((row) => serviceCalendar[value(row, "service_id")])
	.map(
		(row) =>
			[
				value(row, "service_id"),
				value(row, "date"),
				Number(value(row, "exception_type")),
			] as const,
	);

const arrivalsByStop = new Map<string, CompactArrival[]>();
for (const arrival of arrivals.sort(
	(a, b) => a.stopId.localeCompare(b.stopId) || a.departureSec - b.departureSec,
)) {
	const compact: CompactArrival = [
		arrival.routeShortName,
		arrival.headsign,
		arrival.departureSec,
		arrival.serviceId,
	];
	const list = arrivalsByStop.get(arrival.stopId);
	if (list) list.push(compact);
	else arrivalsByStop.set(arrival.stopId, [compact]);
}

await Bun.write(`${OUT_DIR}/luas-stops.json`, `${JSON.stringify(luasStops)}\n`);
await Bun.write(
	`${OUT_DIR}/luas-arrivals.json`,
	`${JSON.stringify({
		generatedAt: new Date().toISOString(),
		format: 2,
		services: serviceCalendar,
		exceptions: serviceExceptions,
		arrivals: Object.fromEntries(arrivalsByStop),
	})}\n`,
);

console.log(
	`Generated ${luasStops.length} Luas stops and ${arrivals.length} stop arrivals.`,
);
