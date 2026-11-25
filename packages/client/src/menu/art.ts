// Menu art readiness gate (issue #348): the sliced ME-* plates behind
// the wordmark, carousel arrows/dots, tip strip, and profile row load as
// CSS backgrounds, so the glyph/text fallbacks must only hide once every
// PNG confirms. This module preloads the kit and stamps `menu-art-ready`
// on #menu; chrome.css swaps fallbacks for art under that class. Pure
// helpers stay DOM-free and unit-testable under node; the binder mirrors
// the tips.ts idiom (null-safe lookups, missing elements are no-ops,
// `stop()` tears down, never throws).

/** #menu readiness class (chrome.css swaps fallbacks under it). */
export const MENU_ART_READY_CLASS = "menu-art-ready";

/**
 * Sliced menu kit URLs, document-relative (the same files chrome.css
 * references, so the preload hits the stylesheet cache, never the net).
 */
export const MENU_ART_URLS: readonly string[] = [
  "./assets/ui/wordmark.png",
  "./assets/ui/menu-card.png",
  "./assets/ui/menu-arrow-left.png",
  "./assets/ui/menu-arrow-right.png",
  "./assets/ui/menu-dot-on.png",
  "./assets/ui/menu-dot-off.png",
  "./assets/ui/menu-tip.png",
  "./assets/ui/menu-avatar.png",
  "./assets/ui/menu-field.png",
];

/** Copy of the kit URLs (callers must not mutate the registry). */
export function menuArtUrls(): string[] {
  return MENU_ART_URLS.slice();
}

/** Minimal settable-attribute surface the ready stamp needs. */
interface ClassTarget {
  classList?: { add?: unknown } | null;
}

/** Narrow an unknown handle to the classList surface (null when shorn). */
function asClassTarget(value: unknown): ClassTarget | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as ClassTarget;
}

/**
 * Stamp `menu-art-ready` on #menu. Idempotent; missing menu or shorn
 * documents read false instead of throwing.
 */
export function markMenuArtReady(doc: Document): boolean {
  try {
    const byId = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof byId !== "function") {
      return false;
    }
    const menu = (byId as (id: string) => unknown).call(doc, "menu");
    const target = asClassTarget(menu);
    if (target === null) {
      return false;
    }
    const add = target.classList?.add;
    if (typeof add !== "function") {
      return false;
    }
    try {
      (add as (name: string) => void).call(target.classList, MENU_ART_READY_CLASS);
    } catch {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Minimal image loader surface (browser `new Image()` or a stub). */
export type MenuArtLoader = (url: string) => {
  onload: ((...args: never[]) => void) | null;
  onerror: ((...args: never[]) => void) | null;
  src: string;
};

/**
 * Preload every kit URL through `load`; resolves true once all settle
 * loaded, false when any errors or the document is shorn. Never throws,
 * never rejects. A null loader (no Image surface, e.g. node tests)
 * resolves false without touching the network.
 */
export function preloadMenuArt(
  load: MenuArtLoader | null | undefined,
  urls: readonly string[] = MENU_ART_URLS,
): Promise<boolean> {
  try {
    if (typeof load !== "function") {
      return Promise.resolve(false);
    }
    const list = urls.slice();
    if (list.length === 0) {
      return Promise.resolve(true);
    }
    const pending = list.map(
      (url) =>
        new Promise<boolean>((resolve) => {
          try {
            const img = load(url);
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
          } catch {
            resolve(false);
          }
        }),
    );
    return Promise.all(pending).then((results) => results.every(Boolean));
  } catch {
    return Promise.resolve(false);
  }
}

/** Default loader on the browser Image surface (null when absent). */
function defaultLoader(): MenuArtLoader | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const ctor = (window as unknown as { Image?: unknown }).Image;
    if (typeof ctor !== "function") {
      return null;
    }
    return (url: string) => {
      const img = new (ctor as new () => {
        onload: ((...args: never[]) => void) | null;
        onerror: ((...args: never[]) => void) | null;
        src: string;
      })();
      void url;
      return img;
    };
  } catch {
    return null;
  }
}

/** Live binder state returned by bindMenuArt. */
export interface MenuArtBinder {
  /** Resolves true once the ready class is stamped. */
  ready: Promise<boolean>;
  /** Cancel a pending stamp (no-op once stamped). */
  stop(): void;
}

/**
 * Preload the menu kit and stamp the ready class on #menu once every
 * PNG confirms. Missing Image surfaces resolve false with no stamp;
 * stop() cancels a pending stamp. Never throws.
 */
export function bindMenuArt(
  doc: Document,
  loader?: MenuArtLoader | null,
): MenuArtBinder {
  let stopped = false;
  const resolved: Promise<boolean> = (async (): Promise<boolean> => {
    try {
      const load = loader !== undefined ? loader : defaultLoader();
      const ok = await preloadMenuArt(load ?? undefined);
      if (stopped || !ok) {
        return false;
      }
      return markMenuArtReady(doc);
    } catch {
      return false;
    }
  })();
  return {
    ready: resolved,
    stop: (): void => {
      stopped = true;
    },
  };
}
