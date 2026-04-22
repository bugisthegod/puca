// Bump CACHE_VERSION to invalidate all caches after a deploy.
const CACHE_VERSION = "v1.3.2";
const CACHE_NAME = `puca-${CACHE_VERSION}`;

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

  // HTML navigation: network-first so deploys propagate; cache is the offline fallback.
  if (req.mode === "navigate" || url.pathname === "/") {
    event.respondWith(networkFirst(req));
    return;
  }

  // Hashed bundles + static public assets: cache-first (content-addressed = safe).
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    const root = await caches.match("/");
    if (root) return root;
    return new Response("Offline", { status: 503, statusText: "Offline" });
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
