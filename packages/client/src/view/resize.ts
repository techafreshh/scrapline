// Responsive letterbox-fit sizing for the client canvas. Pure math
// (unit-testable under node like camera.ts) plus a thin DOM applier
// (null-safe handles like the setDisplay idiom in settings.ts). The
// sim/camera coordinate space stays fixed at logical 640x360; only DOM
// CSS sizes and the renderer density change, so camera zoom is never
// touched here by construction (this module imports nothing outside
// DOM types).

/** Logical sim/camera coordinate width in px (fixed backing store). */
export const BASE_W = 640;
/** Logical sim/camera coordinate height in px (fixed backing store). */
export const BASE_H = 360;
/** Max renderer pixel ratio (perf guardrail for fill-rate budget). */
export const MAX_DPR = 2;

/** Integer CSS letterbox size in px. */
export interface LetterboxSize {
  width: number;
  height: number;
}

/**
 * Compute the largest integer 16:9 (BASE_W x BASE_H) CSS box that fits
 * inside the viewport, preserving aspect. Non-finite or sub-1 inputs
 * clamp to >= 1 so the result is always a finite usable box.
 */
export function computeLetterboxFit(
  viewportW: number,
  viewportH: number,
): LetterboxSize {
  const vw =
    Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1;
  const vh =
    Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 1;
  const scale = Math.min(vw / BASE_W, vh / BASE_H);
  const width = Math.max(1, Math.floor(vw <= 0 ? 1 : BASE_W * scale));
  const height = Math.max(1, Math.floor(vh <= 0 ? 1 : BASE_H * scale));
  return { width, height };
}

/**
 * Clamp a device pixel ratio into the renderer density: 1 for
 * non-finite or sub-1 values, capped at MAX_DPR so high-DPI phones
 * never blow the integrated-graphics fill-rate budget.
 */
export function clampRendererResolution(dpr: unknown): number {
  if (typeof dpr !== "number" || !Number.isFinite(dpr) || dpr < 1) {
    return 1;
  }
  return Math.min(dpr, MAX_DPR);
}

/**
 * Read the current renderer density through the clamp. Defaults to 1
 * outside a DOM harness (mirrors the browserStorage guard in main.ts).
 */
export function currentRendererResolution(): number {
  if (typeof window === "undefined") {
    return 1;
  }
  return clampRendererResolution(window.devicePixelRatio);
}

/** Minimal style surface; real HTMLElements satisfy it. */
interface StyleLike {
  style: { width?: unknown; height?: unknown } | unknown;
}

/** Write the letterbox size onto one element's style; null-safe no-op. */
function sizeElement(el: unknown, size: LetterboxSize): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const style = (el as StyleLike).style;
  if (typeof style !== "object" || style === null) {
    return;
  }
  (style as Record<string, unknown>)["width"] = `${size.width}px`;
  (style as Record<string, unknown>)["height"] = `${size.height}px`;
}

/**
 * Apply a letterbox size to the canvas and the stage (both get exact
 * px sizes; overlays are absolute inset-0 children of the stage so
 * they align for free). Missing elements are no-ops.
 */
export function applyLetterbox(
  canvas: unknown,
  stage: unknown,
  size: LetterboxSize,
): void {
  sizeElement(canvas, size);
  sizeElement(stage, size);
}
