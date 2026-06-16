import luasArrivalsData from "./data/luas-arrivals.json" with { type: "json" };
import luasStopsData from "./data/luas-stops.json" with { type: "json" };
import type { LuasArrival, LuasStop } from "./types.ts";

type ServiceCalendar = Record<
	string,
	[days: string, startDate: string, endDate: string]
>;

type ServiceException = [
	serviceId: string,
	date: string,
	exceptionType: number,
];

type StaticArrival = {
	stopId: string;
	routeShortName: string;
	headsign: string;
	departureSec: number;
	serviceId: string;
};

type LuasArrivalsData = {
	format: 2;
	services: ServiceCalendar;
	exceptions: ServiceException[];
	arrivals: Record<
		string,
		[
			routeShortName: string,
			headsign: string,
			departureSec: number,
			serviceId: string,
		][]
	>;
};

const stops = luasStopsData as LuasStop[];
const arrivalData = luasArrivalsData as unknown as LuasArrivalsData;
const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
const arrivalsByPlatformId = new Map<string, StaticArrival[]>();

for (const [stopId, arrivals] of Object.entries(arrivalData.arrivals)) {
	arrivalsByPlatformId.set(
		stopId,
		arrivals.map(([routeShortName, headsign, departureSec, serviceId]) => ({
			stopId,
			routeShortName,
			headsign,
			departureSec,
			serviceId,
		})),
	);
}

const dublinDateFormatter = new Intl.DateTimeFormat("en-IE", {
	timeZone: "Europe/Dublin",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
	weekday: "long",
});
const SERVICE_DAY_INDEX: Record<string, number> = {
	monday: 0,
	tuesday: 1,
	wednesday: 2,
	thursday: 3,
	friday: 4,
	saturday: 5,
	sunday: 6,
};

function dublinParts(date: Date): {
	ymd: string;
	weekday: string;
	seconds: number;
} {
	const parts = Object.fromEntries(
		dublinDateFormatter
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	return {
		ymd: `${parts.year}${parts.month}${parts.day}`,
		weekday: String(parts.weekday ?? "").toLowerCase(),
		seconds:
			Number(parts.hour) * 3600 +
			Number(parts.minute) * 60 +
			Number(parts.second),
	};
}

function isServiceActive(
	serviceId: string,
	ymd: string,
	weekday: string,
): boolean {
	const exception = arrivalData.exceptions.find(
		([exceptionServiceId, date]) =>
			exceptionServiceId === serviceId && date === ymd,
	);
	if (exception?.[2] === 1) return true;
	if (exception?.[2] === 2) return false;

	const service = arrivalData.services[serviceId];
	if (!service) return false;
	const [days, startDate, endDate] = service;
	if (ymd < startDate || ymd > endDate) return false;
	const dayIndex = SERVICE_DAY_INDEX[weekday];
	return dayIndex !== undefined && days[dayIndex] === "1";
}

function formatDeparture(seconds: number): string {
	const normalized = ((seconds % 86400) + 86400) % 86400;
	const hh = Math.floor(normalized / 3600);
	const mm = Math.floor((normalized % 3600) / 60);
	return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeDestinationName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function arrivalDisplayKey(
	arrival: Pick<LuasArrival, "routeShortName" | "headsign" | "departureSec">,
): string {
	return [arrival.routeShortName, arrival.headsign, arrival.departureSec].join(
		"|",
	);
}

function previousDublinCalendarDay(ymd: string): {
	ymd: string;
	weekday: string;
} {
	const year = Number(ymd.slice(0, 4));
	const month = Number(ymd.slice(4, 6));
	const day = Number(ymd.slice(6, 8));
	const previousNoonUtc = new Date(Date.UTC(year, month - 1, day - 1, 12));
	const parts = dublinParts(previousNoonUtc);
	return { ymd: parts.ymd, weekday: parts.weekday };
}

function activeServiceSetForParts(ymd: string, weekday: string): Set<string> {
	return new Set(
		Object.keys(arrivalData.services).filter((serviceId) =>
			isServiceActive(serviceId, ymd, weekday),
		),
	);
}

export function getLuasStops(): LuasStop[] {
	return stops;
}

export function getLuasStop(stopId: string): LuasStop | null {
	return stopsById.get(stopId) ?? null;
}

export function searchLuasStops(query: string): LuasStop[] {
	const q = query.trim().toLowerCase();
	if (!q) return stops.slice(0, 12);
	return stops
		.filter((stop) => stop.name.toLowerCase().includes(q))
		.slice(0, 12);
}

export function getLuasStopsArrivals(
	stopIds: string[],
	now = new Date(),
): Record<string, LuasArrival[]> {
	const result: Record<string, LuasArrival[]> = {};
	for (const stopId of stopIds) {
		result[stopId] = getLuasStopArrivals(stopId, now);
	}
	return result;
}

export function getLuasStopArrivals(
	stopId: string,
	now = new Date(),
): LuasArrival[] {
	const stop = stopsById.get(stopId);
	if (!stop) return [];

	const nowParts = dublinParts(now);
	const todayServices = activeServiceSetForParts(
		nowParts.ymd,
		nowParts.weekday,
	);
	const yesterdayParts = previousDublinCalendarDay(nowParts.ymd);
	const yesterdayServices = activeServiceSetForParts(
		yesterdayParts.ymd,
		yesterdayParts.weekday,
	);
	const nowSec = nowParts.seconds;
	const candidates: LuasArrival[] = [];
	const currentStopName = normalizeDestinationName(stop.name);

	for (const platformId of stop.platformIds) {
		for (const arrival of arrivalsByPlatformId.get(platformId) ?? []) {
			if (normalizeDestinationName(arrival.headsign) === currentStopName) {
				continue;
			}
			if (todayServices.has(arrival.serviceId)) {
				const etaSeconds = arrival.departureSec - nowSec;
				if (etaSeconds >= 0 && etaSeconds <= 90 * 60) {
					candidates.push({
						stopId: stop.id,
						routeShortName: arrival.routeShortName,
						headsign: arrival.headsign,
						etaSeconds,
						departureSec: arrival.departureSec,
						departureTime: formatDeparture(arrival.departureSec),
					});
				}
			}
			if (
				yesterdayServices.has(arrival.serviceId) &&
				arrival.departureSec >= 86400
			) {
				const etaSeconds = arrival.departureSec - 86400 - nowSec;
				if (etaSeconds >= 0 && etaSeconds <= 90 * 60) {
					candidates.push({
						stopId: stop.id,
						routeShortName: arrival.routeShortName,
						headsign: arrival.headsign,
						etaSeconds,
						departureSec: arrival.departureSec,
						departureTime: formatDeparture(arrival.departureSec),
					});
				}
			}
		}
	}

	const seen = new Set<string>();
	const deduped = candidates.filter((arrival) => {
		const key = arrivalDisplayKey(arrival);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	return deduped
		.sort(
			(a, b) =>
				a.etaSeconds - b.etaSeconds ||
				a.headsign.localeCompare(b.headsign) ||
				a.departureTime.localeCompare(b.departureTime),
		)
		.slice(0, 8);
}
