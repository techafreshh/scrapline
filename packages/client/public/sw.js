// Scrapline offline-first service worker (issue #159): versioned cache with
// install-time warming of the stable entry URLs plus runtime cache-first for
// same-origin GETs and a navigate fallback to the cached page. No build-time
// URL injection: hashed chunk names (pixi-[hash].js) are learned at runtime,
// so the precache list only names stable entry points. Storage failures
// (private mode) never reject the install: every cache touch is guarded and
// the page boots online-only instead.

/** Versioned cache name; bump to invalidate older offline bundles. */
const CACHE = "scrapline-v1";

/** Stable entry points warmed at install; one miss never fails install. */
const WARM_URLS = [
  "./",
  "index.html",
  "main.js",
  "manifest.webmanifest",
  "assets/atlas.json",
];

/**
 * Best-effort cache.put: clone-before-store (the response body is a
 * one-shot stream) and swallow quota/private-mode rejections so a full
 * or blocked store degrades to online-only instead of crashing fetches.
 */
async function safePut(cache, request, response) {
  try {
    await cache.put(request, response.clone());
  } catch {
    // Storage blocked or full: the live network response still renders.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        // allSettled, not addAll: a single missing entry (e.g. a cold
        // dev server without a built atlas) must not reject install.
        await Promise.allSettled(
          WARM_URLS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })),
          ),
        );
      } catch {
        // CacheStorage unavailable (private mode): install anyway so the
        // page keeps working online; fetches fall through to network.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.all(
          names.map((name) => {
            if (name !== CACHE) {
              return caches.delete(name);
            }
            return Promise.resolve(false);
          }),
        );
      } catch {
        // CacheStorage unavailable: nothing to clean, claim anyway.
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Same-origin only: cross-origin (fonts/CDN) traffic is never cached.
  if (url.origin !== self.location.origin) {
    return;
  }
  // Navigations go network-first so a fresh deploy lands when online,
  // falling back to the cached page (or index.html) when offline.
  // The network attempt is independent of CacheStorage: a blocked
  // cache must never discard a good live response.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          try {
            const cache = await caches.open(CACHE);
            await safePut(cache, new Request("./"), fresh);
          } catch {
            // CacheStorage unavailable: still serve the live response.
          }
          return fresh;
        } catch {
          try {
            const cache = await caches.open(CACHE);
            const cached =
              (await cache.match(new Request("./"))) ??
              (await cache.match("index.html"));
            if (cached) {
              return cached;
            }
          } catch {
            // CacheStorage unavailable while offline: fall through.
          }
          return Response.error();
        }
      })(),
    );
    return;
  }
  // Static same-origin GETs are cache-first: the hashed bundle chunks
  // are content-addressed, so a cache hit is always the right bytes;
  // misses populate the cache for the next offline load. CacheStorage
  // access is best-effort: when `caches.open()` rejects (private mode)
  // the request still falls through to the network.
  event.respondWith(
    (async () => {
      let cache = null;
      try {
        cache = await caches.open(CACHE);
      } catch {
        // CacheStorage unavailable: keep null and fall through to network.
      }
      if (cache) {
        try {
          const hit = await cache.match(request);
          if (hit) {
            return hit;
          }
        } catch {
          // Cache lookup failed: fall through to network.
        }
      }
      let fresh;
      try {
        fresh = await fetch(request);
      } catch {
        // Network failed and nothing cached: surface the failure rather
        // than synthesizing a body the game cannot use.
        return Response.error();
      }
      // Only cache successful basic responses; opaque/error bodies
      // would poison the offline bundle.
      if (cache && fresh && fresh.ok && fresh.type === "basic") {
        await safePut(cache, request, fresh);
      }
      return fresh;
    })(),
  );
});
