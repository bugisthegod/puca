import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import luasArrivalsData from "../src/data/luas-arrivals.json" with {
	type: "json",
};
import {
	type RawTripUpdateMap,
	resetTripUpdateCacheForTest,
	seedTripUpdateCacheForTest,
} from "../src/gtfsr/tripUpdates";
import {
	getLuasStopArrivals,
	getLuasStopArrivalsOfficialFirst,
	getLuasStopArrivalsRealtimeFirst,
	type LuasArrivalsData,
	replaceLuasArrivalsDataForTest,
	resetLuasArrivalsDataForTest,
	resetLuasOfficialForecastCacheForTest,
} from "../src/luas";

const testLuasArrivalsData: LuasArrivalsData = {
	format: 2,
	services: {
		red_sat: ["0000010", "20260627", "20261205"],
		red_hidden: ["0000010", "20260627", "20261205"],
		green_sat: ["0000010", "20260627", "20261205"],
	},
	exceptions: [],
	arrivals: {
		"8220GA00431": [
			["Red", "The Point", 48840, "red_sat", "red_point_2", 24],
			["Red", "Saggart", 48840, "red_sat", "red_saggart_ignored", 24],
		],
		"8220GA00434": [
			["Red", "The Point", 48904, "red_sat", "red_point_1", 27],
			["Red", "The Point", 48944, "red_sat", "red_point_2", 25],
			["Red", "Saggart", 48944, "red_sat", "red_saggart_ignored", 25],
			["Red", "The Point", 49620, "red_sat", "red_point_later", 27],
		],
		"8220GA00436": [
			["Red", "The Point", 64740, "red_hidden", "red_hidden_point", 1],
			["Red", "Tallaght", 64800, "red_sat", "red_tallaght_1", 1],
		],
		"8220GA00437": [
			["Red", "Tallaght", 64800, "red_sat", "red_tallaght_duplicate", 1],
		],
		"8220GA00031": [
			["Green", "Broombridge", 64800, "green_sat", "green_broombridge_1", 14],
		],
	},
};
const realLuasArrivalsData = luasArrivalsData as unknown as LuasArrivalsData;

const sampleArrivalsDay = "2026-06-27";
const sampleArrivalsDate = new Date(`${sampleArrivalsDay}T16:58:00Z`);
const sampleMiddayArrivalsDate = new Date(`${sampleArrivalsDay}T12:33:30Z`);
const sampleOfficialDate = new Date(`${sampleArrivalsDay}T12:45:00Z`);
const sampleOfficialDatePlus15Sec = new Date(`${sampleArrivalsDay}T12:45:15Z`);
const sampleOfficialDatePlus1Sec = new Date(`${sampleArrivalsDay}T12:45:01Z`);
const sampleArrivalsYmd = sampleArrivalsDay.replaceAll("-", "");
const sampleArrivalsWeekday = new Intl.DateTimeFormat("en-IE", {
	timeZone: "Europe/Dublin",
	weekday: "long",
})
	.format(sampleArrivalsDate)
	.toLowerCase();
const originalFetch = globalThis.fetch;
const originalDate = globalThis.Date;

type StaticLuasArrival = LuasArrivalsData["arrivals"][string][number];
const SERVICE_DAY_INDEX: Record<string, number> = {
	monday: 0,
	tuesday: 1,
	wednesday: 2,
	thursday: 3,
	friday: 4,
	saturday: 5,
	sunday: 6,
};

type StaticLuasFixture = {
	platformId: string;
	routeShortName: string;
	headsign: string;
	departureSec: number;
	serviceId: string;
	tripId: string;
	stopSequence: number;
	routeId: string;
};

beforeEach(() => {
	replaceLuasArrivalsDataForTest(testLuasArrivalsData);
});

afterEach(() => {
	resetTripUpdateCacheForTest();
	resetLuasOfficialForecastCacheForTest();
	resetLuasArrivalsDataForTest();
	globalThis.fetch = originalFetch;
	globalThis.Date = originalDate;
});

afterAll(() => {
	resetLuasArrivalsDataForTest();
});

function mockWallClock(iso: string): void {
	const fixedMs = originalDate.parse(iso);
	globalThis.Date = class extends originalDate {
		constructor(...args: unknown[]) {
			if (args.length === 0) super(fixedMs);
			else if (args.length === 1) super(args[0] as string | number | Date);
			else {
				super(
					...(args as [
						year: number,
						monthIndex: number,
						date?: number,
						hours?: number,
						minutes?: number,
						seconds?: number,
						ms?: number,
					]),
				);
			}
		}

		static override now() {
			return fixedMs;
		}
	} as DateConstructor;
}

function dublinLocalDate(ymd: string, time: string): Date {
	const [year = 0, month = 1, day = 1] = ymd.split("-").map(Number);
	const [hour = 0, minute = 0, second = 0] = time.split(":").map(Number);
	const utcGuess = new Date(
		Date.UTC(year, month - 1, day, hour, minute, second),
	);
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-IE", {
			timeZone: "Europe/Dublin",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		})
			.formatToParts(utcGuess)
			.map((part) => [part.type, part.value]),
	);
	const displayedAsUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second),
	);
	return new Date(utcGuess.getTime() - (displayedAsUtc - utcGuess.getTime()));
}

function dublinSeconds(date: Date): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-IE", {
			timeZone: "Europe/Dublin",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	return (
		Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)
	);
}

function formatDeparture(seconds: number): string {
	const normalized = ((seconds % 86400) + 86400) % 86400;
	const hh = Math.floor(normalized / 3600);
	const mm = Math.floor((normalized % 3600) / 60);
	return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function isServiceActiveOnSampleDay(serviceId: string): boolean {
	const exception = testLuasArrivalsData.exceptions.find(
		([exceptionServiceId, date]) =>
			exceptionServiceId === serviceId && date === sampleArrivalsYmd,
	);
	if (exception?.[2] === 1) return true;
	if (exception?.[2] === 2) return false;

	const service = testLuasArrivalsData.services[serviceId];
	if (!service) return false;
	const [days, startDate, endDate] = service;
	if (sampleArrivalsYmd < startDate || sampleArrivalsYmd > endDate) {
		return false;
	}
	const dayIndex = SERVICE_DAY_INDEX[sampleArrivalsWeekday];
	return dayIndex !== undefined && days[dayIndex] === "1";
}

function toFixture(
	platformId: string,
	[
		routeShortName,
		headsign,
		departureSec,
		serviceId,
		tripId,
		stopSequence,
	]: StaticLuasArrival,
): StaticLuasFixture {
	return {
		platformId,
		routeShortName,
		headsign,
		departureSec,
		serviceId,
		tripId,
		stopSequence,
		routeId: `10000 ${routeShortName.toUpperCase()} g a`,
	};
}

function findLuasFixture({
	name,
	platformId,
	routeShortName,
	headsign,
	stopSequence,
	minDepartureSec = 0,
	maxDepartureSec = Number.POSITIVE_INFINITY,
}: {
	name: string;
	platformId: string;
	routeShortName: string;
	headsign: string;
	stopSequence?: number;
	minDepartureSec?: number;
	maxDepartureSec?: number;
}): StaticLuasFixture {
	const row = testLuasArrivalsData.arrivals[platformId]?.find(
		(arrival) =>
			arrival[0] === routeShortName &&
			arrival[1] === headsign &&
			(stopSequence === undefined || arrival[5] === stopSequence) &&
			arrival[2] >= minDepartureSec &&
			arrival[2] <= maxDepartureSec &&
			isServiceActiveOnSampleDay(arrival[3]),
	);
	if (!row) throw new Error(`Missing Luas test fixture: ${name}`);
	return toFixture(platformId, row);
}

function findTripFixtureAtPlatform(
	tripId: string,
	platformId: string,
): StaticLuasFixture {
	const row = testLuasArrivalsData.arrivals[platformId]?.find(
		(arrival) => arrival[4] === tripId,
	);
	if (!row) {
		throw new Error(
			`Missing Luas test fixture for trip ${tripId} at ${platformId}`,
		);
	}
	return toFixture(platformId, row);
}

test("real Luas arrivals data keeps the expected compact schema", () => {
	const serviceErrors = Object.entries(realLuasArrivalsData.services).filter(
		([serviceId, service]) =>
			!serviceId ||
			!Array.isArray(service) ||
			service.length !== 3 ||
			service.some((value) => typeof value !== "string"),
	);
	const exceptionErrors = realLuasArrivalsData.exceptions.filter(
		(exception) =>
			!Array.isArray(exception) ||
			exception.length !== 3 ||
			typeof exception[0] !== "string" ||
			typeof exception[1] !== "string" ||
			typeof exception[2] !== "number",
	);
	const arrivalErrors = Object.entries(realLuasArrivalsData.arrivals).flatMap(
		([platformId, arrivals]) =>
			arrivals
				.map((arrival, index) => ({ arrival, index, platformId }))
				.filter(
					({ arrival, platformId }) =>
						!platformId ||
						!Array.isArray(arrival) ||
						arrival.length !== 6 ||
						typeof arrival[0] !== "string" ||
						typeof arrival[1] !== "string" ||
						typeof arrival[2] !== "number" ||
						typeof arrival[3] !== "string" ||
						typeof arrival[4] !== "string" ||
						typeof arrival[5] !== "number",
				),
	);

	expect(realLuasArrivalsData.format).toBe(2);
	expect(serviceErrors).toEqual([]);
	expect(exceptionErrors).toEqual([]);
	expect(arrivalErrors).toEqual([]);
});

const sampleArrivalsNowSec = dublinSeconds(sampleArrivalsDate);
const sampleMiddayArrivalsNowSec = dublinSeconds(sampleMiddayArrivalsDate);
const redTallaghtAtThePoint = findLuasFixture({
	name: "Red Tallaght from The Point",
	platformId: "8220GA00436",
	routeShortName: "Red",
	headsign: "Tallaght",
	stopSequence: 1,
	minDepartureSec: sampleArrivalsNowSec,
	maxDepartureSec: sampleArrivalsNowSec + 90 * 60,
});
const redThePointAtSpencerDock = findLuasFixture({
	name: "Red The Point at Spencer Dock",
	platformId: "8220GA00434",
	routeShortName: "Red",
	headsign: "The Point",
	stopSequence: 27,
	minDepartureSec: sampleMiddayArrivalsNowSec,
	maxDepartureSec: sampleMiddayArrivalsNowSec + 90 * 60,
});
const redThePointAtSpencerDockDedupe = findLuasFixture({
	name: "second Red The Point at Spencer Dock",
	platformId: "8220GA00434",
	routeShortName: "Red",
	headsign: "The Point",
	stopSequence: 25,
	minDepartureSec: sampleMiddayArrivalsNowSec,
	maxDepartureSec: sampleMiddayArrivalsNowSec + 90 * 60,
});
const redSaggartAtSpencerDockIgnored = findLuasFixture({
	name: "Red Saggart at Spencer Dock",
	platformId: "8220GA00434",
	routeShortName: "Red",
	headsign: "Saggart",
	stopSequence: 25,
	minDepartureSec: sampleMiddayArrivalsNowSec,
	maxDepartureSec: sampleMiddayArrivalsNowSec + 90 * 60,
});
const redSaggartIgnoredPreviousStop = findTripFixtureAtPlatform(
	redSaggartAtSpencerDockIgnored.tripId,
	"8220GA00431",
);
const greenBroombridgeAtMarlborough = findLuasFixture({
	name: "Green Broombridge at Marlborough",
	platformId: "8220GA00031",
	routeShortName: "Green",
	headsign: "Broombridge",
	stopSequence: 14,
});

test("Luas arrivals hide trips whose destination is the selected stop", () => {
	const arrivals = getLuasStopArrivals("8220GA00436", sampleArrivalsDate);

	expect(arrivals.length).toBeGreaterThan(0);
	expect(arrivals.some((arrival) => arrival.headsign === "The Point")).toBe(
		false,
	);
	expect(
		arrivals.some((arrival) =>
			["Tallaght", "Saggart"].includes(arrival.headsign),
		),
	).toBe(true);
});

test("Luas arrivals do not return duplicate display rows", () => {
	const arrivals = getLuasStopArrivals("8220GA00436", sampleArrivalsDate);
	const keys = arrivals.map((arrival) =>
		[arrival.routeShortName, arrival.headsign, arrival.departureSec].join("|"),
	);

	expect(new Set(keys).size).toBe(keys.length);
});

test("Luas arrivals prefer NTA GTFS-R TripUpdates when available", () => {
	const departureDelaySec = 180;
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			redTallaghtAtThePoint.tripId,
			{
				tripId: redTallaghtAtThePoint.tripId,
				routeId: redTallaghtAtThePoint.routeId,
				directionId: 0,
				stopTimeUpdates: [
					{
						sequence: redTallaghtAtThePoint.stopSequence,
						stopId: redTallaghtAtThePoint.platformId,
						arrivalDelaySec: null,
						departureDelaySec,
						scheduleRelationship: "SCHEDULED",
					},
					{
						sequence: redTallaghtAtThePoint.stopSequence + 1,
						stopId: "8220GA00439",
						arrivalDelaySec: 60,
						departureDelaySec: 60,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst(
		"8220GA00436",
		sampleArrivalsDate,
	);

	expect(arrivals).toHaveLength(1);
	expect(arrivals[0]).toMatchObject({
		headsign: redTallaghtAtThePoint.headsign,
		etaSeconds:
			redTallaghtAtThePoint.departureSec -
			sampleArrivalsNowSec +
			departureDelaySec,
		departureTime: formatDeparture(
			redTallaghtAtThePoint.departureSec + departureDelaySec,
		),
	});
});

test("Luas realtime arrivals use lookup time when the wall clock is off-hours", () => {
	mockWallClock("2026-06-18T00:00:00Z");
	const departureDelaySec = 180;
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			redTallaghtAtThePoint.tripId,
			{
				tripId: redTallaghtAtThePoint.tripId,
				routeId: redTallaghtAtThePoint.routeId,
				directionId: 0,
				stopTimeUpdates: [
					{
						sequence: redTallaghtAtThePoint.stopSequence,
						stopId: redTallaghtAtThePoint.platformId,
						arrivalDelaySec: null,
						departureDelaySec,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst(
		"8220GA00436",
		sampleArrivalsDate,
	);

	expect(arrivals).toHaveLength(1);
	expect(arrivals[0]).toMatchObject({
		headsign: redTallaghtAtThePoint.headsign,
		etaSeconds:
			redTallaghtAtThePoint.departureSec -
			sampleArrivalsNowSec +
			departureDelaySec,
	});
});

test("Luas arrivals prefer the official Luas forecast when available", async () => {
	const requestedUrls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		requestedUrls.push(url);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="TPT" lat="53.34835" long="-6.22925833333333" pronunciation="The Point">The Point</stop><stop abrev="SDK" lat="53.3488222222222" long="-6.23714722222222" pronunciation="Spencer Dock">Spencer Dock</stop></line></stops>',
			);
		}
		if (url.includes("action=forecast") && url.includes("stop=SDK")) {
			return new Response(
				'<stopInfo created="2026-06-18T13:45:01" stop="Spencer Dock" stopAbv="SDK"><direction name="Inbound"><tram dueMins="2" destination="The Point" /><tram dueMins="13" destination="The Point" /></direction><direction name="Outbound"><tram dueMins="DUE" destination="Tallaght" /></direction></stopInfo>',
			);
		}
		return new Response("not found", { status: 404 });
	}) as unknown as typeof globalThis.fetch;

	const tripUpdates: RawTripUpdateMap = new Map([
		[
			redThePointAtSpencerDock.tripId,
			{
				tripId: redThePointAtSpencerDock.tripId,
				routeId: redThePointAtSpencerDock.routeId,
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: redThePointAtSpencerDock.stopSequence,
						stopId: redThePointAtSpencerDock.platformId,
						arrivalDelaySec: null,
						departureDelaySec: 600,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		sampleOfficialDate,
	);

	expect(requestedUrls.some((url) => url.includes("action=forecast"))).toBe(
		true,
	);
	expect(
		arrivals.map((arrival) => [arrival.headsign, arrival.etaSeconds]),
	).toEqual([
		["Tallaght", 0],
		["The Point", 120],
		["The Point", 780],
	]);
	expect(arrivals[0]?.routeShortName).toBe("Red");
});

test("Luas official forecast cache recomputes ETA on later reads", async () => {
	const requestedUrls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		requestedUrls.push(url);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="SDK" lat="53.3488222222222" long="-6.23714722222222" pronunciation="Spencer Dock">Spencer Dock</stop></line></stops>',
			);
		}
		return new Response(
			'<stopInfo created="2026-06-18T13:45:01" stop="Spencer Dock" stopAbv="SDK"><direction name="Inbound"><tram dueMins="2" destination="The Point" /></direction></stopInfo>',
		);
	}) as unknown as typeof globalThis.fetch;

	const first = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		sampleOfficialDate,
	);
	const second = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		sampleOfficialDatePlus15Sec,
	);

	expect(first[0]?.etaSeconds).toBe(120);
	expect(second[0]?.etaSeconds).toBe(105);
	expect(
		requestedUrls.filter((url) => url.includes("action=forecast")),
	).toHaveLength(1);
});

test("Luas official empty forecast falls back to NTA TripUpdates", async () => {
	const departureDelaySec = 180;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="TPT" lat="53.34835" long="-6.22925833333333" pronunciation="The Point">The Point</stop></line></stops>',
			);
		}
		return new Response(
			'<stopInfo created="2026-06-18T13:45:01" stop="The Point" stopAbv="TPT"><direction name="Outbound"></direction></stopInfo>',
		);
	}) as unknown as typeof globalThis.fetch;
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			redTallaghtAtThePoint.tripId,
			{
				tripId: redTallaghtAtThePoint.tripId,
				routeId: redTallaghtAtThePoint.routeId,
				directionId: 0,
				stopTimeUpdates: [
					{
						sequence: redTallaghtAtThePoint.stopSequence,
						stopId: redTallaghtAtThePoint.platformId,
						arrivalDelaySec: null,
						departureDelaySec,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst(
		"8220GA00436",
		sampleArrivalsDate,
	);

	expect(arrivals).toHaveLength(1);
	expect(arrivals[0]).toMatchObject({
		headsign: redTallaghtAtThePoint.headsign,
		etaSeconds:
			redTallaghtAtThePoint.departureSec -
			sampleArrivalsNowSec +
			departureDelaySec,
	});
});

test("Luas arrivals fall back from official forecast to NTA TripUpdates", async () => {
	const departureDelaySec = 180;
	globalThis.fetch = (async () => {
		return new Response("upstream failed", { status: 500 });
	}) as unknown as typeof globalThis.fetch;
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			redTallaghtAtThePoint.tripId,
			{
				tripId: redTallaghtAtThePoint.tripId,
				routeId: redTallaghtAtThePoint.routeId,
				directionId: 0,
				stopTimeUpdates: [
					{
						sequence: redTallaghtAtThePoint.stopSequence,
						stopId: redTallaghtAtThePoint.platformId,
						arrivalDelaySec: null,
						departureDelaySec,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst(
		"8220GA00436",
		sampleArrivalsDate,
	);

	expect(arrivals).toHaveLength(1);
	expect(arrivals[0]).toMatchObject({
		headsign: redTallaghtAtThePoint.headsign,
		etaSeconds:
			redTallaghtAtThePoint.departureSec -
			sampleArrivalsNowSec +
			departureDelaySec,
		departureTime: formatDeparture(
			redTallaghtAtThePoint.departureSec + departureDelaySec,
		),
	});
});

test("Luas official forecast failures are not cached", async () => {
	let forecastCalls = 0;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("action=stops")) {
			return new Response(
				'<stops><line name="Luas Red Line"><stop abrev="SDK" lat="53.3488222222222" long="-6.23714722222222" pronunciation="Spencer Dock">Spencer Dock</stop></line></stops>',
			);
		}
		forecastCalls += 1;
		if (forecastCalls === 1) {
			return new Response("temporary failure", { status: 503 });
		}
		return new Response(
			'<stopInfo created="2026-06-18T13:45:01" stop="Spencer Dock" stopAbv="SDK"><direction name="Inbound"><tram dueMins="2" destination="The Point" /></direction></stopInfo>',
		);
	}) as unknown as typeof globalThis.fetch;
	seedTripUpdateCacheForTest({
		tripUpdates: new Map(),
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const fallback = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		sampleOfficialDate,
	);
	const official = await getLuasStopArrivalsOfficialFirst(
		"8220GA00433",
		sampleOfficialDatePlus1Sec,
	);

	expect(fallback).toEqual(
		getLuasStopArrivals("8220GA00433", sampleOfficialDate),
	);
	expect(official[0]).toMatchObject({
		headsign: "The Point",
		etaSeconds: 120,
	});
	expect(forecastCalls).toBe(2);
});

test("Luas arrivals fall back from official forecast and TripUpdates to static GTFS", async () => {
	const now = sampleArrivalsDate;
	globalThis.fetch = (async () => {
		return new Response("upstream failed", { status: 500 });
	}) as unknown as typeof globalThis.fetch;
	seedTripUpdateCacheForTest({
		tripUpdates: new Map(),
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = await getLuasStopArrivalsOfficialFirst("8220GA00436", now);

	expect(arrivals).toEqual(getLuasStopArrivals("8220GA00436", now));
});

test("Luas realtime arrivals ignore TripUpdates for inactive service days", () => {
	const now = dublinLocalDate("2026-06-28", "17:58:00");
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			greenBroombridgeAtMarlborough.tripId,
			{
				tripId: greenBroombridgeAtMarlborough.tripId,
				routeId: greenBroombridgeAtMarlborough.routeId,
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: greenBroombridgeAtMarlborough.stopSequence,
						stopId: greenBroombridgeAtMarlborough.platformId,
						arrivalDelaySec: null,
						departureDelaySec: 180,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	expect(getLuasStopArrivalsRealtimeFirst("8220GA00031", now)).toEqual(
		getLuasStopArrivals("8220GA00031", now),
	);
});

test("Luas arrivals fall back to static GTFS when TripUpdates are unavailable", () => {
	const now = sampleArrivalsDate;
	seedTripUpdateCacheForTest({
		tripUpdates: new Map(),
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst("8220GA00436", now);

	expect(arrivals).toEqual(getLuasStopArrivals("8220GA00436", now));
});

test("Luas realtime arrivals dedupe rows with the same displayed minutes", () => {
	const displayedFiveMinuteEtaSec = 270;
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			redThePointAtSpencerDock.tripId,
			{
				tripId: redThePointAtSpencerDock.tripId,
				routeId: redThePointAtSpencerDock.routeId,
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: redThePointAtSpencerDock.stopSequence,
						stopId: redThePointAtSpencerDock.platformId,
						arrivalDelaySec: null,
						departureDelaySec:
							displayedFiveMinuteEtaSec -
							(redThePointAtSpencerDock.departureSec -
								sampleMiddayArrivalsNowSec),
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
		[
			redThePointAtSpencerDockDedupe.tripId,
			{
				tripId: redThePointAtSpencerDockDedupe.tripId,
				routeId: redThePointAtSpencerDockDedupe.routeId,
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: redThePointAtSpencerDockDedupe.stopSequence,
						stopId: redThePointAtSpencerDockDedupe.platformId,
						arrivalDelaySec: null,
						departureDelaySec:
							displayedFiveMinuteEtaSec -
							(redThePointAtSpencerDockDedupe.departureSec -
								sampleMiddayArrivalsNowSec),
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst(
		"8220GA00433",
		sampleMiddayArrivalsDate,
	);
	const pointFiveMinuteRows = arrivals.filter(
		(arrival) =>
			arrival.headsign === redThePointAtSpencerDock.headsign &&
			Math.ceil(arrival.etaSeconds / 60) === 5,
	);

	expect(pointFiveMinuteRows).toHaveLength(1);
});

test("Luas realtime arrivals ignore trips without an update for the selected stop", () => {
	const displayedFiveMinuteEtaSec = 270;
	const ignoredTripDelaySec =
		displayedFiveMinuteEtaSec -
		(redSaggartAtSpencerDockIgnored.departureSec - sampleMiddayArrivalsNowSec);
	const tripUpdates: RawTripUpdateMap = new Map([
		[
			redThePointAtSpencerDock.tripId,
			{
				tripId: redThePointAtSpencerDock.tripId,
				routeId: redThePointAtSpencerDock.routeId,
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: redThePointAtSpencerDock.stopSequence,
						stopId: redThePointAtSpencerDock.platformId,
						arrivalDelaySec: null,
						departureDelaySec:
							displayedFiveMinuteEtaSec -
							(redThePointAtSpencerDock.departureSec -
								sampleMiddayArrivalsNowSec),
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
		[
			redSaggartAtSpencerDockIgnored.tripId,
			{
				tripId: redSaggartAtSpencerDockIgnored.tripId,
				routeId: redSaggartAtSpencerDockIgnored.routeId,
				directionId: 1,
				stopTimeUpdates: [
					{
						sequence: redSaggartIgnoredPreviousStop.stopSequence,
						stopId: redSaggartIgnoredPreviousStop.platformId,
						arrivalDelaySec: ignoredTripDelaySec,
						departureDelaySec: ignoredTripDelaySec,
						scheduleRelationship: "SCHEDULED",
					},
				],
			},
		],
	]);
	seedTripUpdateCacheForTest({
		tripUpdates,
		tripUpdateUpdatedAtMs: Date.now(),
		lastTripUpdateCallMs: Date.now(),
	});

	const arrivals = getLuasStopArrivalsRealtimeFirst(
		"8220GA00433",
		sampleMiddayArrivalsDate,
	);

	expect(
		arrivals.filter(
			(arrival) => arrival.headsign === redThePointAtSpencerDock.headsign,
		),
	).toHaveLength(1);
	expect(
		arrivals.filter(
			(arrival) => arrival.headsign === redSaggartAtSpencerDockIgnored.headsign,
		),
	).toHaveLength(0);
});
