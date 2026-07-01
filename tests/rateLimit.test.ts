import { afterAll, describe, expect, test } from "bun:test";

// ORIGIN_SECRET is read once at module load, so pin it before importing —
// a static import would hoist above this assignment.
const PREVIOUS_ORIGIN_SECRET = process.env.ORIGIN_SECRET;
process.env.ORIGIN_SECRET = "test-secret";
const { hasOriginAccess, rateLimit } = await import("../src/server/rateLimit");

afterAll(() => {
	if (PREVIOUS_ORIGIN_SECRET === undefined) delete process.env.ORIGIN_SECRET;
	else process.env.ORIGIN_SECRET = PREVIOUS_ORIGIN_SECRET;
});

function makeReq(headers: Record<string, string> = {}): Request {
	return new Request("http://localhost/api/test", { headers });
}

const okHandler = (_req: Request) => new Response("ok");

describe("hasOriginAccess", () => {
	test("local requests always pass", () => {
		expect(hasOriginAccess(makeReq())).toBe(true);
		expect(hasOriginAccess(makeReq({ "fly-client-ip": "127.0.0.1" }))).toBe(
			true,
		);
	});

	test("remote requests need the exact origin secret header", () => {
		expect(hasOriginAccess(makeReq({ "fly-client-ip": "203.0.113.1" }))).toBe(
			false,
		);
		expect(
			hasOriginAccess(
				makeReq({ "fly-client-ip": "203.0.113.1", "x-origin-secret": "wrong" }),
			),
		).toBe(false);
		expect(
			hasOriginAccess(
				makeReq({
					"fly-client-ip": "203.0.113.1",
					"x-origin-secret": "test-secret",
				}),
			),
		).toBe(true);
	});
});

describe("rateLimit", () => {
	test("remote request without origin secret is rejected", async () => {
		const handler = rateLimit(okHandler);
		const res = await handler(makeReq({ "fly-client-ip": "203.0.113.2" }));
		expect(res.status).toBe(403);
	});

	test("local requests bypass origin check and rate limit", async () => {
		const handler = rateLimit(okHandler);
		for (let i = 0; i < 100; i++) {
			const res = await handler(makeReq());
			expect(res.status).toBe(200);
		}
	});

	test("61st request in the window gets 429 with Retry-After", async () => {
		const handler = rateLimit(okHandler);
		const headers = {
			"fly-client-ip": "203.0.113.3",
			"x-origin-secret": "test-secret",
		};
		for (let i = 0; i < 60; i++) {
			const res = await handler(makeReq(headers));
			expect(res.status).toBe(200);
		}
		const blocked = await handler(makeReq(headers));
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("Retry-After")).toBe("60");
	});

	test("rate limit buckets are per IP", async () => {
		const handler = rateLimit(okHandler);
		const ipA = {
			"fly-client-ip": "203.0.113.4",
			"x-origin-secret": "test-secret",
		};
		const ipB = {
			"fly-client-ip": "203.0.113.5",
			"x-origin-secret": "test-secret",
		};
		for (let i = 0; i < 60; i++) await handler(makeReq(ipA));
		expect((await handler(makeReq(ipA))).status).toBe(429);
		expect((await handler(makeReq(ipB))).status).toBe(200);
	});

	test("cf-connecting-ip takes precedence over x-forwarded-for", async () => {
		const handler = rateLimit(okHandler);
		const cfHeaders = {
			"cf-connecting-ip": "203.0.113.6",
			"x-origin-secret": "test-secret",
		};
		for (let i = 0; i < 60; i++) await handler(makeReq(cfHeaders));
		// Same CF IP with a fresh x-forwarded-for must not get a fresh bucket.
		const spoofed = await handler(
			makeReq({ ...cfHeaders, "x-forwarded-for": "198.51.100.9" }),
		);
		expect(spoofed.status).toBe(429);
	});
});
