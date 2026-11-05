import { expect, test } from "bun:test";
import {
	BUS_TRIP_CACHE_TTL_MS,
	isBusTripCacheFresh,
} from "../src/client/hooks/busTripCache";

test("reopening a bus trip reuses data only before the 75-second boundary", () => {
	const loadedAt = 1_000_000;
	expect(BUS_TRIP_CACHE_TTL_MS).toBe(75_000);
	expect(isBusTripCacheFresh(loadedAt, loadedAt)).toBe(true);
	expect(isBusTripCacheFresh(loadedAt, loadedAt + 74_999)).toBe(true);
	expect(isBusTripCacheFresh(loadedAt, loadedAt + 75_000)).toBe(false);
	expect(isBusTripCacheFresh(loadedAt, loadedAt + 150_000)).toBe(false);
});

test("missing timestamps and clock changes force a refresh", () => {
	expect(isBusTripCacheFresh(undefined, 1_000)).toBe(false);
	expect(isBusTripCacheFresh(2_000, 1_000)).toBe(false);
	expect(isBusTripCacheFresh(0, 1_000)).toBe(true);
});
