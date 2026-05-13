import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getCurrentTrains,
	getStationData,
	getTrainMovements,
} from "../src/api";

const EMPTY_STATION_XML = `<?xml version="1.0"?><ArrayOfObjStationData></ArrayOfObjStationData>`;
const EMPTY_CURRENT_XML = `<?xml version="1.0"?><ArrayOfObjTrainPositions></ArrayOfObjTrainPositions>`;

describe("api in-flight dedup", () => {
	let originalFetch: typeof fetch;
	let fetchCalls: string[];

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		fetchCalls = [];
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function mockFetch(delayMs: number, body: string) {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			fetchCalls.push(typeof input === "string" ? input : input.toString());
			await new Promise((r) => setTimeout(r, delayMs));
			return new Response(body);
		}) as typeof fetch;
	}

	function mockFetchStatus(status: number) {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			fetchCalls.push(typeof input === "string" ? input : input.toString());
			return new Response("upstream failed", { status });
		}) as typeof fetch;
	}

	test("Irish Rail HTTP failures reject instead of becoming empty results", async () => {
		mockFetchStatus(503);

		await expect(getCurrentTrains()).rejects.toThrow("HTTP 503");
		await expect(getStationData("FAILA", 90)).rejects.toThrow("HTTP 503");
		await expect(getTrainMovements("FAILTRAIN", "6 may 2026")).rejects.toThrow(
			"HTTP 503",
		);
	});

	test("failed Irish Rail calls are not cached", async () => {
		mockFetchStatus(503);
		await expect(getStationData("FAILB", 90)).rejects.toThrow("HTTP 503");
		expect(fetchCalls.length).toBe(1);

		mockFetch(10, EMPTY_STATION_XML);
		const result = await getStationData("FAILB", 90);
		expect(result).toEqual([]);
		expect(fetchCalls.length).toBe(2);
	});

	test("1000 concurrent misses on the same station hit upstream once", async () => {
		mockFetch(50, EMPTY_STATION_XML);
		const promises = Array.from({ length: 1000 }, () =>
			getStationData("TESTA", 90),
		);
		const results = await Promise.all(promises);
		expect(fetchCalls.length).toBe(1);
		expect(results.every((r) => Array.isArray(r))).toBe(true);
	});

	test("different stations do not share in-flight", async () => {
		mockFetch(50, EMPTY_STATION_XML);
		const a = Array.from({ length: 100 }, () => getStationData("TESTB", 90));
		const b = Array.from({ length: 100 }, () => getStationData("TESTC", 90));
		await Promise.all([...a, ...b]);
		expect(fetchCalls.length).toBe(2);
	});

	test("warm cache short-circuits without fetching", async () => {
		mockFetch(10, EMPTY_STATION_XML);
		await getStationData("TESTD", 90);
		expect(fetchCalls.length).toBe(1);
		const more = await Promise.all(
			Array.from({ length: 50 }, () => getStationData("TESTD", 90)),
		);
		expect(fetchCalls.length).toBe(1);
		expect(more.length).toBe(50);
	});

	test("getCurrentTrains dedupes through the same helper", async () => {
		mockFetch(50, EMPTY_CURRENT_XML);
		await Promise.all(Array.from({ length: 200 }, () => getCurrentTrains()));
		const ctCalls = fetchCalls.filter((u) => u.includes("getCurrentTrainsXML"));
		expect(ctCalls.length).toBe(1);
	});
});
