// Per-theme sky grade plus vignette: vertical gradient sky band and a
// subtle edge vignette painted behind/above existing world paint. Pure
// (no DOM, no Pixi): stops, helpers, and dual Pixi/canvas2d painters
// share one model so headless tests drive the same contract the
// renderer paints. The light stop sits at the top (zenith) and the dark
// stop at the bottom (horizon); probes read computed stops, never pixels.
import { hexToRgb, skyGradeFor, type SkyGrade, type ThemeName } from "./theme";

/** Vignette rim alpha (inside the [0.15, 0.35] probe window). */
export const VIGNETTE_ALPHA = 0.25;
/** Full-width horizontal bands in the Pixi sky gradient. */
export const SKY_STEPS = 32;
/** Vignette edge width as a fraction of the smaller canvas dimension. */
export const VIGNETTE_EDGE_FRACTION = 0.12;
/** Stepped bands per vignette edge (alpha ramps outward). */
export const VIGNETTE_BANDS = 4;
/** Vignette overlay color in Pixi hex (near-black). */
export const VIGNETTE_HEX = 0x000000;
/** Vignette overlay color in CSS. */
export const VIGNETTE_CSS = "#000000";

/** Minimal Pixi Graphics surface (structural, no pixi.js import). */
export interface BackgroundPixiGraphics {
  rect(x: number, y: number, w: number, h: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
}

/** 8-bit sky color (t = 0 top, t = 1 bottom). */
export interface SkyRgb {
  r: number;
  g: number;
  b: number;
}

/** Lerp one 8-bit channel between two stops. */
export function lerpChannel(a: number, b: number, t: number): number {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return Math.round(a + (b - a) * clamped);
}

/** Interpolated sky color at t (0 = top stop, 1 = bottom stop). */
export function skyColorAt(grade: SkyGrade, t: number): SkyRgb {
  const top = hexToRgb(grade.topHex);
  const bottom = hexToRgb(grade.bottomHex);
  return {
    r: lerpChannel(top.r, bottom.r, t),
    g: lerpChannel(top.g, bottom.g, t),
    b: lerpChannel(top.b, bottom.b, t),
  };
}

/**
 * Integer top-stop channels for a theme name (tolerant, falls back to
 * kilima). The renderer's skyTop probe reads this, so the sampled
 * top-center pixel is pixel-pure by construction.
 */
export function skyTopRgb(name: unknown): SkyRgb {
  const grade = skyGradeFor(name);
  const top = hexToRgb(grade.topHex);
  return { r: top.r, g: top.g, b: top.b };
}

/**
 * True when a map surface carries no lights behavior to honor. Reads
 * any lights/decoration(s) fields null-safely (defensive only: no such
 * fields exist on the shipped maps) and never alters paint, so sky and
 * vignette always draw in the same order regardless of map shape.
 */
export function isLightsRespected(mapish: unknown): boolean {
  try {
    if (mapish !== null && mapish !== undefined) {
      const rec = mapish as Record<string, unknown>;
      void rec["lights"];
      void rec["decoration"];
      void rec["decorations"];
      if (typeof window !== "undefined") {
        try {
          const game = (window as unknown as Record<string, unknown>)["__game"] as
            | Record<string, unknown>
            | undefined;
          void game?.["lights"];
          void game?.["decoration"];
          void game?.["decorations"];
        } catch {
          // Window mirrors are best-effort only.
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the sky rect covers the viewport. The painters always fill
 * exactly (0, 0, canvasWidth, canvasHeight), so any live draw with
 * finite positive dims (including the 1280x720 letterbox) covers it.
 */
export function skyCoversViewport(
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  return (
    Number.isFinite(canvasWidth) &&
    Number.isFinite(canvasHeight) &&
    canvasWidth > 0 &&
    canvasHeight > 0
  );
}

/** Pack one sky channel triple into a Pixi hex. */
function skyHexOf(color: SkyRgb): number {
  return ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff);
}

/** Resolve a tolerant theme key for the painters (falls back to kilima). */
function skyThemeKey(name: unknown): ThemeName {
  return skyGradeFor(name).name;
}

/**
 * Paint the full-canvas vertical sky gradient in Pixi. Pixi Graphics
 * has no gradient fill, so SKY_STEPS full-width bands interpolate
 * top (light) to bottom (dark), mirroring the HIGHLIGHT_PX-strip idiom
 * in paintTilesPixi. No-op on non-finite dims.
 */
export function paintSkyPixi(
  graphics: BackgroundPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  themeName: unknown,
): void {
  if (!skyCoversViewport(canvasWidth, canvasHeight)) {
    return;
  }
  const grade = skyGradeFor(skyThemeKey(themeName));
  const stepH = canvasHeight / SKY_STEPS;
  for (let i = 0; i < SKY_STEPS; i += 1) {
    const color = skyColorAt(grade, i / (SKY_STEPS - 1));
    graphics.rect(0, i * stepH, canvasWidth, stepH + 1);
    graphics.fill(skyHexOf(color));
  }
}

/**
 * Paint the full-canvas vertical sky gradient on a 2D canvas via a
 * linear gradient over the same two stops. Mirrors paintSkyPixi.
 * No-op on non-finite dims; restores fillStyle afterwards.
 */
export function paintSky2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  themeName: unknown,
): void {
  if (!skyCoversViewport(canvasWidth, canvasHeight)) {
    return;
  }
  const grade = skyGradeFor(skyThemeKey(themeName));
  const prev = ctx.fillStyle;
  try {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, grade.top);
    gradient.addColorStop(1, grade.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  } finally {
    ctx.fillStyle = prev;
  }
}

/** Vignette edge width in px for a canvas (12% of the smaller side). */
export function vignetteEdge(canvasWidth: number, canvasHeight: number): number {
  return VIGNETTE_EDGE_FRACTION * Math.min(canvasWidth, canvasHeight);
}

/**
 * Paint the edge vignette in Pixi: VIGNETTE_BANDS inset bands per side
 * with alpha ramping outward to VIGNETTE_ALPHA at the rim. The central
 * region stays unpainted, so world paint beneath keeps full contrast.
 * No-op on non-finite dims.
 */
export function paintVignettePixi(
  graphics: BackgroundPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!skyCoversViewport(canvasWidth, canvasHeight)) {
    return;
  }
  const edge = vignetteEdge(canvasWidth, canvasHeight);
  const band = edge / VIGNETTE_BANDS;
  for (let i = 0; i < VIGNETTE_BANDS; i += 1) {
    const inset = i * band;
    const alpha =
      (VIGNETTE_ALPHA * (VIGNETTE_BANDS - i)) / VIGNETTE_BANDS;
    // Top and bottom bands span the full width.
    graphics.rect(0, inset, canvasWidth, band + 1);
    graphics.fill({ color: VIGNETTE_HEX, alpha });
    graphics.rect(0, canvasHeight - inset - band - 1, canvasWidth, band + 1);
    graphics.fill({ color: VIGNETTE_HEX, alpha });
    // Left and right bands span the full height.
    graphics.rect(inset, 0, band + 1, canvasHeight);
    graphics.fill({ color: VIGNETTE_HEX, alpha });
    graphics.rect(canvasWidth - inset - band - 1, 0, band + 1, canvasHeight);
    graphics.fill({ color: VIGNETTE_HEX, alpha });
  }
}

/**
 * Paint the edge vignette on a 2D canvas (mirrors paintVignettePixi).
 * No-op on non-finite dims; restores globalAlpha and fillStyle.
 */
export function paintVignette2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!skyCoversViewport(canvasWidth, canvasHeight)) {
    return;
  }
  const edge = vignetteEdge(canvasWidth, canvasHeight);
  const band = edge / VIGNETTE_BANDS;
  const prevAlpha = ctx.globalAlpha;
  const prevStyle = ctx.fillStyle;
  try {
    ctx.fillStyle = VIGNETTE_CSS;
    for (let i = 0; i < VIGNETTE_BANDS; i += 1) {
      const inset = i * band;
      ctx.globalAlpha =
        (VIGNETTE_ALPHA * (VIGNETTE_BANDS - i)) / VIGNETTE_BANDS;
      ctx.fillRect(0, inset, canvasWidth, band + 1);
      ctx.fillRect(0, canvasHeight - inset - band - 1, canvasWidth, band + 1);
      ctx.fillRect(inset, 0, band + 1, canvasHeight);
      ctx.fillRect(canvasWidth - inset - band - 1, 0, band + 1, canvasHeight);
    }
  } finally {
    ctx.globalAlpha = prevAlpha;
    ctx.fillStyle = prevStyle;
  }
}
