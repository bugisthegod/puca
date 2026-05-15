const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map<string, number[]>();
const ORIGIN_SECRET = process.env.ORIGIN_SECRET;

function getClientIp(req: Request): string {
	return (
		req.headers.get("cf-connecting-ip") ??
		req.headers.get("fly-client-ip") ??
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"local"
	);
}

function isLocalIp(ip: string): boolean {
	return ip === "local" || ip === "127.0.0.1" || ip === "::1";
}

export function hasOriginAccess(req: Request): boolean {
	const ip = getClientIp(req);
	if (isLocalIp(ip)) return true;
	return Boolean(
		ORIGIN_SECRET && req.headers.get("x-origin-secret") === ORIGIN_SECRET,
	);
}

export function rateLimit<
	T extends (req: Request) => Response | Promise<Response>,
>(handler: T): T {
	return (async (req: Request) => {
		const ip = getClientIp(req);
		if (ORIGIN_SECRET && !hasOriginAccess(req)) {
			return new Response("Forbidden", { status: 403 });
		}
		if (!isLocalIp(ip)) {
			const now = Date.now();
			const timestamps = (rateLimitMap.get(ip) ?? []).filter(
				(t) => now - t < RATE_LIMIT_WINDOW_MS,
			);
			if (timestamps.length >= RATE_LIMIT_MAX) {
				return new Response("Rate limit exceeded", {
					status: 429,
					headers: { "Retry-After": "60", "Content-Type": "text/plain" },
				});
			}
			timestamps.push(now);
			rateLimitMap.set(ip, timestamps);
		}
		return handler(req);
	}) as T;
}

// Periodic cleanup: drop entries with no recent activity (prevents Map growth under unique-IP traffic)
setInterval(() => {
	const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
	for (const [ip, timestamps] of rateLimitMap) {
		const live = timestamps.filter((t) => t >= cutoff);
		if (live.length === 0) rateLimitMap.delete(ip);
		else rateLimitMap.set(ip, live);
	}
}, 5 * 60_000);
