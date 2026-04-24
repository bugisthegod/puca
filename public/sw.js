// Bump CACHE_VERSION to invalidate all caches after a deploy.
const CACHE_VERSION = "v1.3.7";
const CACHE_NAME = `puca-${CACHE_VERSION}`;
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
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle same-origin; tile servers / analytics pass through untouched.
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
