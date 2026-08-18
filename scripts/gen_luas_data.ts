import { rename, unlink } from "node:fs/promises";

type CsvColumns = Map<string, number>;

type LuasStop = {
	id: string;
	platformIds: string[];
	name: string;
	lat: number;
	lng: number;
	line: "green" | "red" | "both";
};

type CompactArrival = [
	routeShortName: string,
	headsign: string,
	departureSec: number,
	serviceId: string,
	tripId: string,
	stopSequence: number,
];

const GTFS_DIR = "gtfs";
const OUT_DIR = "src/data";
const LUAS_AGENCY_ID = "10000";

async function parseCsvRows(
	path: string,
	onRow: (row: string[]) => void,
): Promise<void> {
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let pendingQuote = false;

	const emitRow = () => {
		row.push(field);
		onRow(row);
		row = [];
		field = "";
	};

	const consume = (ch: string) => {
		if (pendingQuote) {
			if (ch === '"') {
				field += '"';
				pendingQuote = false;
				return;
			}
			pendingQuote = false;
			quoted = false;
		}

		if (quoted) {
			if (ch === '"') {
				pendingQuote = true;
			} else {
				field += ch;
			}
			return;
		}

		if (ch === '"') quoted = true;
		else if (ch === ",") {
			row.push(field);
			field = "";
		} else if (ch === "\n") {
			emitRow();
		} else if (ch !== "\r") {
			field += ch;
		}
	};

	const decoder = new TextDecoder();
	const reader = Bun.file(`${GTFS_DIR}/${path}`).stream().getReader();
	try {
		while (true) {
			const { done, value: chunk } = await reader.read();
			if (done) break;
			const text = decoder.decode(chunk, { stream: true });
			for (const ch of text) consume(ch);
		}
	} finally {
		reader.releaseLock();
	}
	for (const ch of decoder.decode()) consume(ch);

	if (pendingQuote) {
		pendingQuote = false;
		quoted = false;
	}
	if (quoted) throw new Error(`${path}: unterminated quoted CSV field`);
	if (field || row.length) {
		emitRow();
	}
}

async function forEachCsvRow(
	path: string,
	onRow: (row: string[], columns: CsvColumns) => void,
): Promise<void> {
	let columns: CsvColumns | undefined;
	await parseCsvRows(path, (row) => {
		if (!columns) {
			columns = new Map(row.map((name, index) => [name, index]));
			return;
		}
		if (row.length === 1 && row[0] === "") return;
		onRow(row, columns);
	});
	if (!columns) throw new Error(`${path}: missing CSV header`);
}

function value(row: string[], columns: CsvColumns, key: string): string {
	const index = columns.get(key);
	return index === undefined ? "" : (row[index] ?? "");
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

const luasRoutes = new Map<
	string,
	{ shortName: string; line: "green" | "red" }
>();
await forEachCsvRow("routes.txt", (row, columns) => {
	if (value(row, columns, "agency_id") !== LUAS_AGENCY_ID) return;
	const shortName =
		value(row, columns, "route_short_name") ||
		value(row, columns, "route_long_name");
	luasRoutes.set(value(row, columns, "route_id"), {
		shortName,
		line: routeLine(shortName),
	});
});

const luasTrips = new Map<
	string,
	{ routeId: string; headsign: string; serviceId: string }
>();
await forEachCsvRow("trips.txt", (row, columns) => {
	const routeId = value(row, columns, "route_id");
	if (!luasRoutes.has(routeId)) return;
	luasTrips.set(value(row, columns, "trip_id"), {
		routeId,
		headsign: value(row, columns, "trip_headsign"),
		serviceId: value(row, columns, "service_id"),
	});
});

const stopLine = new Map<string, "green" | "red" | "both">();
const arrivalsByStop = new Map<string, CompactArrival[]>();
let arrivalCount = 0;

await forEachCsvRow("stop_times.txt", (row, columns) => {
	const tripId = value(row, columns, "trip_id");
	const trip = luasTrips.get(tripId);
	if (!trip) return;
	const route = luasRoutes.get(trip.routeId);
	if (!route) return;
	const stopId = value(row, columns, "stop_id");
	const previousLine = stopLine.get(stopId);
	stopLine.set(
		stopId,
		previousLine && previousLine !== route.line ? "both" : route.line,
	);
	const [hh = "0", mm = "0", ss = "0"] = (
		value(row, columns, "departure_time") || value(row, columns, "arrival_time")
	).split(":");
	const compact: CompactArrival = [
		route.shortName,
		trip.headsign,
		Number(hh) * 3600 + Number(mm) * 60 + Number(ss),
		trip.serviceId,
		tripId,
		Number(value(row, columns, "stop_sequence")),
	];
	const list = arrivalsByStop.get(stopId);
	if (list) list.push(compact);
	else arrivalsByStop.set(stopId, [compact]);
	arrivalCount++;
});

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
await forEachCsvRow("stops.txt", (row, columns) => {
	const id = value(row, columns, "stop_id");
	const line = stopLine.get(id);
	if (!line) return;
	const name = cleanStopName(value(row, columns, "stop_name"));
	const lat = Number(value(row, columns, "stop_lat"));
	const lng = Number(value(row, columns, "stop_lon"));
	const key = name.toLowerCase();
	const group = groupedStops.get(key);
	if (!group) {
		groupedStops.set(key, {
			ids: [id],
			name,
			latSum: lat,
			lngSum: lng,
			line,
		});
		return;
	}
	group.ids.push(id);
	group.latSum += lat;
	group.lngSum += lng;
	if (group.line !== line) group.line = "both";
});

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

const serviceCalendar: Record<string, [string, string, string]> = {};
await forEachCsvRow("calendar.txt", (row, columns) => {
	const days = [
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
		"sunday",
	]
		.map((day) => value(row, columns, day))
		.join("");
	serviceCalendar[value(row, columns, "service_id")] = [
		days,
		value(row, columns, "start_date"),
		value(row, columns, "end_date"),
	];
});

const serviceExceptions: [string, string, number][] = [];
await forEachCsvRow("calendar_dates.txt", (row, columns) => {
	const serviceId = value(row, columns, "service_id");
	if (!serviceCalendar[serviceId]) return;
	serviceExceptions.push([
		serviceId,
		value(row, columns, "date"),
		Number(value(row, columns, "exception_type")),
	]);
});

const sortedArrivalsByStop = Object.fromEntries(
	[...arrivalsByStop.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([stopId, list]) => [stopId, list.sort((a, b) => a[2] - b[2])]),
);

async function writeAtomically(path: string, contents: string): Promise<void> {
	const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await Bun.write(temporaryPath, contents);
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => {});
		throw error;
	}
}

await writeAtomically(
	`${OUT_DIR}/luas-stops.json`,
	`${JSON.stringify(luasStops)}\n`,
);
await writeAtomically(
	`${OUT_DIR}/luas-arrivals.json`,
	`${JSON.stringify({
		generatedAt: new Date().toISOString(),
		format: 2,
		services: serviceCalendar,
		exceptions: serviceExceptions,
		arrivals: sortedArrivalsByStop,
	})}\n`,
);

console.log(
	`Generated ${luasStops.length} Luas stops and ${arrivalCount} stop arrivals.`,
);
