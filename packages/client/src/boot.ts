// Noscript fallback visibility (issue #160): the static "JavaScript is
// disabled" paragraph in index.html must hide the moment the client boots
// with a working WebGL backend, and stay visible whenever no WebGL context
// exists (plus the natural no-JS case, where no client code runs at all).
// Probing a real canvas context is the only truthful check — a
// forced-no-WebGL harness (disabled GPU / stubbed getContext) still
// exposes the WebGLRenderingContext constructor. All helpers are DOM-free
// (injectable canvas factory / document surface) and never throw, so boot
// code can call them synchronously without gating on failure.

/** Element id of the static fallback paragraph in index.html. */
export const NOSCRIPT_ID = "noscript";

/** Minimal canvas surface carrying getContext (the real HTMLCanvasElement satisfies it). */
export interface ProbeCanvas {
  getContext(kind: string): unknown;
}

/** Factory producing a probe canvas; null when the surface is unavailable. */
export type ProbeCanvasFactory = () => ProbeCanvas | null | undefined;

/** Minimal document surface carrying getElementById. */
export interface NoscriptDocument {
  getElementById(id: string): unknown;
}

/**
 * True when a real WebGL context can be created (webgl2, then webgl).
 * The injectable factory keeps this unit-testable under node without
 * jsdom; without a factory it falls back to a live document canvas, and
 * without any DOM it resolves false. Never throws: null contexts,
 * throwing getContext stubs, and shorn surfaces all read as no-WebGL.
 */
export function hasWebGLSupport(factory?: ProbeCanvasFactory | null): boolean {
  try {
    let canvas: ProbeCanvas | null | undefined;
    if (typeof factory === "function") {
      try {
        canvas = factory();
      } catch {
        return false;
      }
    } else {
      try {
        const doc =
          typeof document !== "undefined"
            ? (document as unknown as {
                createElement?: unknown;
              })
            : null;
        const create =
          doc !== null && typeof doc.createElement === "function"
            ? (doc.createElement as (tag: string) => unknown)
            : null;
        if (create === null) {
          return false;
        }
        canvas = create.call(doc, "canvas") as ProbeCanvas | null | undefined;
      } catch {
        return false;
      }
    }
    if (canvas === null || canvas === undefined) {
      return false;
    }
    const get = (canvas as { getContext?: unknown }).getContext;
    if (typeof get !== "function") {
      return false;
    }
    try {
      const gl2 = (get as (kind: string) => unknown).call(canvas, "webgl2");
      if (gl2 !== null && gl2 !== undefined && gl2 !== false) {
        return true;
      }
    } catch {
      // webgl2 probe failed: fall through to the webgl probe.
    }
    try {
      const gl = (get as (kind: string) => unknown).call(canvas, "webgl");
      return gl !== null && gl !== undefined && gl !== false;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** Assign display on an unknown handle when it carries a style bag. */
function setNoscriptDisplay(el: unknown, display: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const style = (el as { style?: unknown }).style;
  if (typeof style !== "object" || style === null) {
    return;
  }
  (style as Record<string, unknown>)["display"] = display;
}

/** Resolve the fallback element; null on missing/shorn DOM. Never throws. */
function noscriptElement(
  doc: NoscriptDocument | null | undefined,
): unknown {
  try {
    if (doc === null || doc === undefined) {
      return null;
    }
    const get = (doc as { getElementById?: unknown }).getElementById;
    if (typeof get !== "function") {
      return null;
    }
    return (get as (id: string) => unknown).call(doc, NOSCRIPT_ID);
  } catch {
    return null;
  }
}

/**
 * Hide the fallback paragraph (display:none). No-op on missing/shorn
 * DOM. Never throws.
 */
export function hideNoscript(doc: NoscriptDocument | null | undefined): void {
  try {
    const el = noscriptElement(doc);
    if (el === null || el === undefined) {
      return;
    }
    setNoscriptDisplay(el, "none");
  } catch {
    // A shorn style bag must not break boot.
  }
}

/**
 * Restore the fallback paragraph (display:""). No-op on missing/shorn
 * DOM. Never throws.
 */
export function showNoscript(doc: NoscriptDocument | null | undefined): void {
  try {
    const el = noscriptElement(doc);
    if (el === null || el === undefined) {
      return;
    }
    setNoscriptDisplay(el, "");
  } catch {
    // A shorn style bag must not break boot.
  }
}

/**
 * Sync the fallback to a visibility flag: true shows the paragraph
 * (display:""), false hides it (display:none). No-op on missing/shorn
 * DOM. Never throws.
 */
export function syncNoscriptFallback(
  doc: NoscriptDocument | null | undefined,
  visible: boolean,
): void {
  try {
    if (visible) {
      showNoscript(doc);
    } else {
      hideNoscript(doc);
    }
  } catch {
    // Visibility sync must never gate boot.
  }
}
