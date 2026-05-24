// CACHE_VERSION is replaced at /sw.js serve time with FLY_MACHINE_VERSION
// (or "dev" locally). Don't edit manually — bump happens per deploy.
const CACHE_VERSION = "__CACHE_VERSION__";
const CACHE_NAME = `puca-${CACHE_VERSION}`;
// Tile cache version is independent of app version — tiles don't change
// between deploys, so app upgrades shouldn't pay a re-download tax.
const TILE_CACHE = "puca-tiles-v1";
const TILE_CACHE_MAX = 1000;
const TILE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TILE_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const TILE_CACHE_AT_HEADER = "x-puca-cache-at";
const TILE_ACCESS_AT_HEADER = "x-puca-access-at";
// How long navigation waits on the network before falling back to cache.
// Hot fly machine responds in <500ms; cold start takes multiple seconds,
// so this bound keeps launches snappy while still letting deploys land
// first-try when the origin is warm.
const NAV_NETWORK_TIMEOUT_MS = 2000;

const PRECACHE_URLS = [
	"/",
	"/manifest.json",
	"/icon-192.png",
	"/icon-512.png",
	"/icon.svg",
	"/puca-jack-o.svg?v=transparent-1",
	"/puca-sleeping.svg?v=transparent-1",
	"/splash/iphone-17-pro-max.png",
	"/splash/iphone-17.png",
	"/splash/iphone-16-pro-max.png",
	"/splash/iphone-16-pro.png",
	"/splash/iphone-plus.png",
	"/splash/iphone-base.png",
	"/splash/iphone-se.png",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(PRECACHE_URLS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter((n) => n !== CACHE_NAME && n !== TILE_CACHE)
						.map((n) => caches.delete(n)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

function isTileRequest(url) {
	const isCarto =
		url.hostname === "basemaps.cartocdn.com" ||
		url.hostname.endsWith(".basemaps.cartocdn.com");
	const isRailway =
		url.hostname === "tiles.openrailwaymap.org" ||
		url.hostname.endsWith(".tiles.openrailwaymap.org");
	if (url.search) return false;

	const cartoMatch = url.pathname.match(
		/^\/rastertiles\/(?:voyager|dark_all)\/(\d{1,2})\/\d+\/\d+(?:@2x)?\.png$/,
	);
	const railwayMatch = url.pathname.match(
		/^\/standard\/(\d{1,2})\/\d+\/\d+\.png$/,
	);
	const match = isCarto ? cartoMatch : isRailway ? railwayMatch : null;
	if (!match) return false;

	const zoom = Number.parseInt(match[1], 10);
	return Number.isFinite(zoom) && zoom >= 0 && zoom <= 20;
}

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET") return;

	const url = new URL(req.url);

	// CartoCDN base + OpenRailwayMap overlay: stale-while-revalidate so common
	// tiles (home stop, favorites) re-render instantly on launch instead of
	// paying a network RTT, and to lighten load on OpenRailwayMap's small
	// community-run server.
	if (isTileRequest(url)) {
		event.respondWith(tileHandler(event, req));
		return;
	}

	// Only handle same-origin from here; analytics and other CDNs pass through.
	if (url.origin !== self.location.origin) return;

	// API polling is the app's job — don't cache stale transit data.
	if (url.pathname.startsWith("/api/")) return;

	// Bun dev-server internals (HMR, unref beacon) must not be intercepted.
	if (url.pathname.startsWith("/_bun/unref")) return;

	// HTML navigation: race network against a timeout. Fast responses win
	// and propagate the deploy immediately; slow/offline ones fall back to
	// cache so the app opens instantly even when the fly machine is cold.
	// The network request keeps running in the background either way, so
	// a cold-start launch still refreshes cache for next time.
	if (req.mode === "navigate" || url.pathname === "/") {
		event.respondWith(navigationHandler(event, req));
		return;
	}

	// Hashed bundles + static public assets: cache-first (content-addressed = safe).
	event.respondWith(cacheFirst(req));
});

async function navigationHandler(event, req) {
	const cache = await caches.open(CACHE_NAME);
	const cached = (await cache.match(req)) ?? (await cache.match("/"));

	const networkPromise = fetch(req).then(async (res) => {
		if (res.ok) {
			await cache.put(req, res.clone()).catch(() => {});
		}
		return res;
	});
	// Swallow unhandled rejection when we fall back to cache without awaiting.
	networkPromise.catch(() => {});

	if (!cached) {
		try {
			return await networkPromise;
		} catch {
			return new Response("Offline", { status: 503, statusText: "Offline" });
		}
	}

	const timeout = new Promise((resolve) =>
		setTimeout(() => resolve(null), NAV_NETWORK_TIMEOUT_MS),
	);
	const winner = await Promise.race([
		networkPromise.catch(() => null),
		timeout,
	]);
	if (winner?.ok) return winner;
	// Keep the background fetch alive past respondWith so cold-start launches
	// still refresh cache for the next open, even if the user closes the PWA
	// before the fetch completes.
	event.waitUntil(networkPromise.catch(() => {}));
	return cached;
}

// Coalesces concurrent requests for the same tile URL. Without this, a
// theme/layer swap fires duplicate <img> requests for the same tile (Leaflet
// itself, plus retries from cancelled+re-added layers), each becoming a
// separate fetch to CartoCDN. Under burst, the CDN returns 502.
const tileInflight = new Map();
const TILE_FETCH_TIMEOUT_MS = 15_000;

async function tileHandler(event, req) {
	const cache = await caches.open(TILE_CACHE);
	const cached = await cache.match(req);
	const now = Date.now();
	if (cached) {
		const cacheAt = readTimeHeader(cached, TILE_CACHE_AT_HEADER);
		const accessAt = readTimeHeader(cached, TILE_ACCESS_AT_HEADER);
		const isStale = now - cacheAt > TILE_CACHE_MAX_AGE_MS;

		if (!isStale && now - accessAt > TILE_TOUCH_INTERVAL_MS) {
			event.waitUntil(
				touchTile(cache, req, cached.clone(), now).catch(() => {}),
			);
		}

		// Serve stale tiles instantly, but refresh them in the background so map
		// data eventually catches up without putting network latency on pan/zoom.
		if (isStale) {
			event.waitUntil(fetchAndCacheTile(event, cache, req).catch(() => {}));
		}
		return cached;
	}

	return fetchAndCacheTile(event, cache, req);
}

async function fetchAndCacheTile(event, cache, req) {
	let p = tileInflight.get(req.url);
	if (!p) {
		// Re-issue as CORS so the response isn't opaque — opaque responses get
		// padded to ~7MB each in CacheStorage and would blow quota in dozens of tiles.
		// Both CartoCDN and OpenRailwayMap serve Access-Control-Allow-Origin: *.
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), TILE_FETCH_TIMEOUT_MS);
		const corsReq = new Request(req.url, {
			mode: "cors",
			credentials: "omit",
			signal: ctrl.signal,
		});
		p = fetch(corsReq)
			.then((res) => {
				clearTimeout(timer);
				if (res.ok) {
					const cacheable = responseWithTileMetadata(
						res,
						Date.now(),
						Date.now(),
					);
					event.waitUntil(
						cache
							.put(req, cacheable)
							.then(() => trimTileCache(cache))
							.catch(() => {}),
					);
				}
				return res;
			})
			.catch((err) => {
				clearTimeout(timer);
				throw err;
			})
			.finally(() => tileInflight.delete(req.url));
		tileInflight.set(req.url, p);
	}

	try {
		// Clone so each caller (e.g. multiple <img> requesting the same tile)
		// gets its own readable body stream.
		return (await p).clone();
	} catch {
		return new Response("", { status: 504, statusText: "Tile fetch failed" });
	}
}

function readTimeHeader(res, header) {
	const value = Number.parseInt(res.headers.get(header) ?? "0", 10);
	return Number.isFinite(value) ? value : 0;
}

function responseWithTileMetadata(res, cacheAt, accessAt) {
	const headers = new Headers(res.headers);
	headers.set(TILE_CACHE_AT_HEADER, String(cacheAt));
	headers.set(TILE_ACCESS_AT_HEADER, String(accessAt));
	return new Response(res.clone().body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}

async function touchTile(cache, req, cached, accessAt) {
	const cacheAt = readTimeHeader(cached, TILE_CACHE_AT_HEADER) || accessAt;
	await cache.put(req, responseWithTileMetadata(cached, cacheAt, accessAt));
}

async function trimTileCache(cache) {
	const keys = await cache.keys();
	const overflow = keys.length - TILE_CACHE_MAX;
	if (overflow <= 0) return;
	const entries = await Promise.all(
		keys.map(async (req, index) => {
			const res = await cache.match(req);
			return {
				req,
				index,
				accessAt: res ? readTimeHeader(res, TILE_ACCESS_AT_HEADER) : 0,
			};
		}),
	);
	entries.sort((a, b) => a.accessAt - b.accessAt || a.index - b.index);
	for (let i = 0; i < overflow; i++) {
		await cache.delete(entries[i].req);
	}
}

async function cacheFirst(req) {
	const cached = await caches.match(req);
	if (cached) return cached;
	try {
		const res = await fetch(req);
		if (res.ok) {
			const cache = await caches.open(CACHE_NAME);
			cache.put(req, res.clone());
		}
		return res;
	} catch {
		return new Response("Offline", { status: 503, statusText: "Offline" });
	}
}
