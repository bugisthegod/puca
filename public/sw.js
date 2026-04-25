// Bump CACHE_VERSION to invalidate all caches after a deploy.
const CACHE_VERSION = "v1.3.8";
const CACHE_NAME = `puca-${CACHE_VERSION}`;
// Tile cache version is independent of app version — tiles don't change
// between deploys, so app upgrades shouldn't pay a re-download tax.
const TILE_CACHE = "puca-tiles-v1";
const TILE_CACHE_MAX = 1000;
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
  return url.hostname.endsWith(".basemaps.cartocdn.com")
      || url.hostname.endsWith(".tiles.openrailwaymap.org");
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
    event.respondWith(tileHandler(req));
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
  if (winner && winner.ok) return winner;
  // Keep the background fetch alive past respondWith so cold-start launches
  // still refresh cache for the next open, even if the user closes the PWA
  // before the fetch completes.
  event.waitUntil(networkPromise.catch(() => {}));
  return cached;
}

async function tileHandler(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req);

  // Re-issue as CORS so the response isn't opaque — opaque responses get
  // padded to ~7MB each in CacheStorage and would blow quota in dozens of tiles.
  // Both CartoCDN and OpenRailwayMap serve Access-Control-Allow-Origin: *.
  const corsReq = new Request(req.url, { mode: "cors", credentials: "omit" });
  const networkPromise = fetch(corsReq).then((res) => {
    if (res.ok) {
      // cache.put deletes-then-inserts per spec, bumping hits to the end of
      // insertion order. Combined with FIFO trim from keys[0], this gives
      // quasi-LRU eviction without tracking access timestamps.
      cache.put(req, res.clone()).then(() => trimTileCache(cache));
    }
    return res;
  });

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  try {
    return await networkPromise;
  } catch {
    return new Response("", { status: 504, statusText: "Tile fetch failed" });
  }
}

async function trimTileCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - TILE_CACHE_MAX;
  if (overflow <= 0) return;
  for (let i = 0; i < overflow; i++) {
    cache.delete(keys[i]);
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
