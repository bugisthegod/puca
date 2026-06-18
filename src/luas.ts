import { XMLParser } from "fast-xml-parser";
import luasArrivalsData from "./data/luas-arrivals.json" with { type: "json" };
import luasStopsData from "./data/luas-stops.json" with { type: "json" };
import { computeArrivalTiming, sortedStopTimeUpdates } from "./gtfsr/timing.ts";
import {
	getCachedTripUpdates,
	type RawTripUpdateMap,
} from "./gtfsr/tripUpdates.ts";
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
	tripId: string;
	routeShortName: string;
	headsign: string;
	stopSequence: number;
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
			tripId: string,
			stopSequence: number,
		][]
	>;
};

const stops = luasStopsData as LuasStop[];
const arrivalData = luasArrivalsData as unknown as LuasArrivalsData;
const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
const arrivalsByPlatformId = new Map<string, StaticArrival[]>();
const LUAS_FORECAST_BASE_URL = "https://luasforecasts.rpa.ie/xml/get.ashx";
const OFFICIAL_STOPS_TTL_MS = 24 * 60 * 60 * 1000;
const OFFICIAL_FORECAST_TTL_MS = 20_000;
const OFFICIAL_FETCH_TIMEOUT_MS = 2500;

type OfficialStop = {
	abbrev: string;
	name: string;
	pronunciation: string;
	lat: number;
	lng: number;
};

type OfficialForecastCacheEntry = {
	arrivals: LuasArrival[];
	expires: number;
};

let officialStopsCache: {
	stops: OfficialStop[];
	stopIdToAbbrev: Map<string, string>;
	expires: number;
} | null = null;
let officialStopsInFlight: Promise<OfficialStop[] | null> | null = null;
const officialForecastCache = new Map<string, OfficialForecastCacheEntry>();
const officialForecastInFlight = new Map<
	string,
	Promise<LuasArrival[] | null>
>();

const officialXmlParser = new XMLParser({
	ignoreAttributes: false,
	parseAttributeValue: true,
	parseTagValue: true,
});

for (const [stopId, arrivals] of Object.entries(arrivalData.arrivals)) {
	arrivalsByPlatformId.set(
		stopId,
		arrivals.map(
			([
				routeShortName,
				headsign,
				departureSec,
				serviceId,
				tripId,
				stopSequence,
			]) => ({
				stopId,
				tripId,
				routeShortName,
				headsign,
				stopSequence,
				departureSec,
				serviceId,
			}),
		),
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

function normalizeArray<T>(value: T | T[] | undefined | null): T[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function lineShortName(line: LuasStop["line"]): string {
	if (line === "red") return "Red";
	if (line === "green") return "Green";
	return "Luas";
}

function distanceMeters(
	a: Pick<LuasStop, "lat" | "lng">,
	b: Pick<OfficialStop, "lat" | "lng">,
): number {
	const latMeters = (a.lat - b.lat) * 111_320;
	const lngMeters =
		(a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
	return Math.hypot(latMeters, lngMeters);
}

async function fetchOfficialXml(url: string): Promise<string> {
	const signal = AbortSignal.timeout(OFFICIAL_FETCH_TIMEOUT_MS);
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Luas official HTTP ${res.status}`);
	return res.text();
}

function parseOfficialStops(xml: string): OfficialStop[] {
	const parsed = officialXmlParser.parse(xml);
	const lines = normalizeArray(asRecord(parsed?.stops).line);
	const result: OfficialStop[] = [];
	for (const line of lines) {
		for (const rawStop of normalizeArray(asRecord(line).stop)) {
			const stop = asRecord(rawStop);
			const abbrev = String(stop["@_abrev"] ?? "").trim();
			const name = String(stop["#text"] ?? "").trim();
			const pronunciation = String(stop["@_pronunciation"] ?? "").trim();
			const lat = Number(stop["@_lat"]);
			const lng = Number(stop["@_long"]);
			if (!abbrev || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
			result.push({ abbrev, name, pronunciation, lat, lng });
		}
	}
	return result;
}

function buildOfficialStopCodeMap(
	officialStops: OfficialStop[],
): Map<string, string> {
	const byName = new Map<string, OfficialStop>();
	for (const stop of officialStops) {
		const names = [stop.name, stop.pronunciation]
			.map(normalizeDestinationName)
			.filter(Boolean);
		for (const name of names) byName.set(name, stop);
	}

	const map = new Map<string, string>();
	for (const stop of stops) {
		const exact = byName.get(normalizeDestinationName(stop.name));
		if (exact) {
			map.set(stop.id, exact.abbrev);
			continue;
		}
		const nearest = officialStops
			.map((officialStop) => ({
				officialStop,
				distance: distanceMeters(stop, officialStop),
			}))
			.sort((a, b) => a.distance - b.distance)[0];
		if (nearest && nearest.distance <= 120) {
			map.set(stop.id, nearest.officialStop.abbrev);
		}
	}
	return map;
}

async function getOfficialStops(): Promise<OfficialStop[] | null> {
	const now = Date.now();
	if (officialStopsCache && now < officialStopsCache.expires) {
		return officialStopsCache.stops;
	}
	if (officialStopsInFlight) return officialStopsInFlight;

	const url = `${LUAS_FORECAST_BASE_URL}?action=stops&encrypt=false`;
	officialStopsInFlight = fetchOfficialXml(url)
		.then((xml) => {
			const officialStops = parseOfficialStops(xml);
			if (officialStops.length === 0) return null;
			officialStopsCache = {
				stops: officialStops,
				stopIdToAbbrev: buildOfficialStopCodeMap(officialStops),
				expires: Date.now() + OFFICIAL_STOPS_TTL_MS,
			};
			return officialStops;
		})
		.catch(() => null)
		.finally(() => {
			officialStopsInFlight = null;
		});
	return officialStopsInFlight;
}

async function getOfficialStopAbbrev(stopId: string): Promise<string | null> {
	await getOfficialStops();
	return officialStopsCache?.stopIdToAbbrev.get(stopId) ?? null;
}

function parseOfficialDueMins(value: unknown): number | null {
	const text = String(value ?? "")
		.trim()
		.toLowerCase();
	if (!text || text === "null") return null;
	if (text === "due") return 0;
	const mins = Number(text);
	return Number.isFinite(mins) && mins >= 0 && mins <= 90 ? mins : null;
}

function secondsUntilDeparture(departureSec: number, nowSec: number): number {
	if (departureSec >= 86400 && nowSec < 3600) {
		return departureSec - 86400 - nowSec;
	}
	if (departureSec < 3600 && nowSec > 23 * 3600) {
		return departureSec + 86400 - nowSec;
	}
	return departureSec - nowSec;
}

function refreshOfficialArrivalEtas(
	arrivals: LuasArrival[],
	now: Date,
): LuasArrival[] {
	const nowSec = dublinParts(now).seconds;
	return arrivals
		.map((arrival) => ({
			...arrival,
			etaSeconds: secondsUntilDeparture(arrival.departureSec, nowSec),
		}))
		.filter(
			(arrival) => arrival.etaSeconds >= 0 && arrival.etaSeconds <= 90 * 60,
		);
}

function parseOfficialForecastXml(
	xml: string,
	stop: LuasStop,
	now: Date,
): LuasArrival[] {
	const parsed = officialXmlParser.parse(xml);
	const directions = normalizeArray(asRecord(parsed?.stopInfo).direction);
	const nowSec = dublinParts(now).seconds;
	const arrivals: LuasArrival[] = [];
	const seen = new Set<string>();
	for (const direction of directions) {
		for (const rawTram of normalizeArray(asRecord(direction).tram)) {
			const tram = asRecord(rawTram);
			const dueMins = parseOfficialDueMins(tram["@_dueMins"]);
			const headsign = String(tram["@_destination"] ?? "").trim();
			if (dueMins === null || !headsign) continue;
			if (
				normalizeDestinationName(headsign) ===
				normalizeDestinationName(stop.name)
			) {
				continue;
			}
			const key = `${headsign}|${dueMins}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const etaSeconds = dueMins * 60;
			const departureSec = nowSec + etaSeconds;
			arrivals.push({
				stopId: stop.id,
				routeShortName: lineShortName(stop.line),
				headsign,
				etaSeconds,
				departureSec,
				departureTime: formatDeparture(departureSec),
			});
		}
	}
	return arrivals
		.sort(
			(a, b) =>
				a.etaSeconds - b.etaSeconds ||
				a.headsign.localeCompare(b.headsign) ||
				a.departureTime.localeCompare(b.departureTime),
		)
		.slice(0, 8);
}

function arrivalDisplayKey(
	arrival: Pick<LuasArrival, "routeShortName" | "headsign" | "departureSec">,
): string {
	return [arrival.routeShortName, arrival.headsign, arrival.departureSec].join(
		"|",
	);
}

function realtimeArrivalDisplayKey(
	arrival: Pick<LuasArrival, "routeShortName" | "headsign" | "etaSeconds">,
): string {
	const displayMins =
		arrival.etaSeconds < 60 ? 0 : Math.ceil(arrival.etaSeconds / 60);
	return [arrival.routeShortName, arrival.headsign, displayMins].join("|");
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

function addRealtimeCandidate({
	candidates,
	stop,
	arrival,
	nowSec,
	arrivalSec,
	tripUpdates,
}: {
	candidates: LuasArrival[];
	stop: LuasStop;
	arrival: StaticArrival;
	nowSec: number;
	arrivalSec: number;
	tripUpdates: RawTripUpdateMap;
}): void {
	const live = tripUpdates.get(arrival.tripId);
	if (!live) return;
	const sortedUpdates = sortedStopTimeUpdates(live.stopTimeUpdates);
	if (
		!sortedUpdates.some(
			(update) =>
				update.sequence === arrival.stopSequence &&
				update.stopId === arrival.stopId,
		)
	) {
		return;
	}
	const firstUpdate = sortedUpdates[0];
	if (firstUpdate && firstUpdate.sequence > arrival.stopSequence) {
		return;
	}

	const timing = computeArrivalTiming({
		arrivalSec,
		sequence: arrival.stopSequence,
		live: {
			...live,
			stopTimeUpdates: sortedUpdates.map((update) => ({
				...update,
				arrivalDelaySec: update.arrivalDelaySec ?? update.departureDelaySec,
			})),
		},
		gpsInferredDelay: null,
		nowSec,
		delayFallbackMode: "forward-if-no-prior",
		stopTimeUpdatesSorted: true,
	});
	const etaSeconds = timing.etaSec ?? arrivalSec - nowSec;
	if (etaSeconds < 0 || etaSeconds > 90 * 60) return;

	candidates.push({
		stopId: stop.id,
		routeShortName: arrival.routeShortName,
		headsign: arrival.headsign,
		etaSeconds,
		departureSec: arrivalSec + (timing.delaySec ?? 0),
		departureTime: formatDeparture(arrivalSec + (timing.delaySec ?? 0)),
	});
}

export function getLuasStopArrivalsRealtimeFirst(
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
	const currentStopName = normalizeDestinationName(stop.name);
	const tripUpdates = getCachedTripUpdates({ refreshIfStale: true });
	const candidates: LuasArrival[] = [];

	for (const platformId of stop.platformIds) {
		for (const arrival of arrivalsByPlatformId.get(platformId) ?? []) {
			if (normalizeDestinationName(arrival.headsign) === currentStopName) {
				continue;
			}
			if (todayServices.has(arrival.serviceId)) {
				addRealtimeCandidate({
					candidates,
					stop,
					arrival,
					nowSec,
					arrivalSec: arrival.departureSec,
					tripUpdates,
				});
			}
			if (
				yesterdayServices.has(arrival.serviceId) &&
				arrival.departureSec >= 86400
			) {
				addRealtimeCandidate({
					candidates,
					stop,
					arrival,
					nowSec,
					arrivalSec: arrival.departureSec - 86400,
					tripUpdates,
				});
			}
		}
	}

	if (candidates.length === 0) return getLuasStopArrivals(stopId, now);

	const seen = new Set<string>();
	return candidates
		.filter((arrival) => {
			const key = realtimeArrivalDisplayKey(arrival);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort(
			(a, b) =>
				a.etaSeconds - b.etaSeconds ||
				a.headsign.localeCompare(b.headsign) ||
				a.departureTime.localeCompare(b.departureTime),
		)
		.slice(0, 8);
}

async function getLuasStopArrivalsOfficial(
	stopId: string,
	now: Date,
): Promise<LuasArrival[] | null> {
	const stop = stopsById.get(stopId);
	if (!stop) return [];

	const abbrev = await getOfficialStopAbbrev(stopId);
	if (!abbrev) return null;

	const cacheKey = abbrev;
	const cached = officialForecastCache.get(cacheKey);
	if (cached && Date.now() < cached.expires) {
		return refreshOfficialArrivalEtas(cached.arrivals, now);
	}

	const pending = officialForecastInFlight.get(cacheKey);
	if (pending) return pending;

	const url = `${LUAS_FORECAST_BASE_URL}?action=forecast&stop=${encodeURIComponent(abbrev)}&encrypt=false`;
	const promise = fetchOfficialXml(url)
		.then((xml) => parseOfficialForecastXml(xml, stop, now))
		.then((arrivals) => {
			officialForecastCache.set(cacheKey, {
				arrivals,
				expires: Date.now() + OFFICIAL_FORECAST_TTL_MS,
			});
			return arrivals;
		})
		.catch(() => null)
		.finally(() => {
			officialForecastInFlight.delete(cacheKey);
		});
	officialForecastInFlight.set(cacheKey, promise);
	return promise;
}

export async function getLuasStopArrivalsOfficialFirst(
	stopId: string,
	now = new Date(),
): Promise<LuasArrival[]> {
	const officialArrivals = await getLuasStopArrivalsOfficial(stopId, now);
	if (officialArrivals !== null && officialArrivals.length > 0) {
		return officialArrivals;
	}
	return getLuasStopArrivalsRealtimeFirst(stopId, now);
}

export function resetLuasOfficialForecastCacheForTest(): void {
	officialStopsCache = null;
	officialStopsInFlight = null;
	officialForecastCache.clear();
	officialForecastInFlight.clear();
}
