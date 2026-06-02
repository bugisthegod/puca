import { describe, expect, test } from "bun:test";
import {
	REALTIME_AGE_HEADER,
	REALTIME_STATUS_HEADER,
	readRealtimeHealth,
} from "../src/realtime";

describe("readRealtimeHealth", () => {
	test("parses unavailable status and cache age from response headers", () => {
		const res = new Response("[]", {
			status: 502,
			headers: {
				[REALTIME_STATUS_HEADER]: "unavailable",
				[REALTIME_AGE_HEADER]: "123",
			},
		});

		expect(readRealtimeHealth(res)).toEqual({
			status: "unavailable",
			ageSec: 123,
		});
	});

	test("defaults to ok when headers are absent or unknown", () => {
		const res = new Response("[]", {
			headers: {
				[REALTIME_STATUS_HEADER]: "weird",
				[REALTIME_AGE_HEADER]: "nope",
			},
		});

		expect(readRealtimeHealth(res)).toEqual({
			status: "ok",
			ageSec: null,
		});
	});

	test("parses route mismatch status", () => {
		const res = new Response("[]", {
			headers: {
				[REALTIME_STATUS_HEADER]: "route-mismatch",
			},
		});

		expect(readRealtimeHealth(res)).toEqual({
			status: "route-mismatch",
			ageSec: null,
		});
	});
});
