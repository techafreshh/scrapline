// Safe service-worker registration (issue #159): the offline-first PWA
// shell registers a same-origin worker that precaches the bundle, but a
// blocked store (private mode), a file:// host, or an unsupported browser
// must never break boot. Every touchpoint resolves to a boolean and routes
// failures to a warn-only logger — mirroring the null-safe browserStorage()
// idiom in main.ts and the never-throws loadAtlas() contract.

/** Minimal warn surface; defaults to the global console at call time. */
export interface PwaLogger {
  warn(...args: unknown[]): void;
}

/** Subset of ServiceWorkerContainer used for registration. */
export interface PwaServiceWorkerContainer {
  register(url: string): Promise<unknown>;
}

/** Minimal navigator surface carrying an optional worker container. */
export interface PwaNavigator {
  serviceWorker?: PwaServiceWorkerContainer | undefined;
}

/**
 * Worker URL resolved against document.baseURI (the atlasUrl() idiom),
 * so file://, served-at-/, and subpath hosts all land on the co-located
 * sw.js. Null when the base cannot be resolved — never throws.
 */
export function serviceWorkerUrl(base?: string): string | null {
  try {
    const root =
      base ??
      (typeof document !== "undefined" &&
      typeof document.baseURI === "string"
        ? document.baseURI
        : null);
    if (typeof root !== "string" || root === "") {
      return null;
    }
    return new URL("sw.js", root).toString();
  } catch {
    return null;
  }
}

/**
 * Best-effort service-worker registration. Resolves true on success and
 * false (after a logger.warn) when the worker surface is absent, the URL
 * cannot be resolved, or register() rejects (blocked storage). The
 * injectable navigator/logger keep this DOM-free for unit tests; the
 * production call passes neither and reads the live globals. Never
 * throws and never rejects: boot code awaits it fire-and-forget.
 */
export async function registerServiceWorker(
  nav?: PwaNavigator | null,
  logger?: PwaLogger | null,
  url?: string | null,
): Promise<boolean> {
  const log: PwaLogger | null =
    logger ??
    (typeof console !== "undefined"
      ? (console as unknown as PwaLogger)
      : null);
  const fail = (message: string, detail?: unknown): false => {
    try {
      log?.warn(message, detail);
    } catch {
      // A broken logger must not break boot either.
    }
    return false;
  };
  try {
    const live =
      nav ??
      ((typeof navigator !== "undefined"
        ? (navigator as unknown as PwaNavigator)
        : null) as PwaNavigator | null);
    const container = live?.serviceWorker;
    if (!container || typeof container.register !== "function") {
      return fail(
        "scrapline: service worker unavailable, continuing online-only",
      );
    }
    const target = url ?? serviceWorkerUrl();
    if (target === null) {
      return fail(
        "scrapline: service worker unavailable, continuing online-only",
      );
    }
    await container.register(target);
    return true;
  } catch (err) {
    return fail(
      "scrapline: service worker unavailable, continuing online-only",
      err,
    );
  }
}
