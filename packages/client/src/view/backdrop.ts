// Per-theme parallax backdrops: sky-preserving top strip, far mountain
// ridgeline, mid treeline ridge, and a bright haze band scrolling at
// fractional camera rates. Pure (no DOM, no Pixi): factors, wrapped
// offsets, per-theme palettes/seeds, and dual Pixi/canvas2d painters share
// one model so headless tests drive the same contract the renderer paints.
// Decorative vector shapes only (stepped rect silhouettes), no assets.
import {
  hexToRgb,
  luminanceOfHex,
  skyGradeFor,
  type ThemeName,
} from "./theme";
import { skyCoversViewport, skyColorAt } from "./background";

/** Far-layer parallax factor (0.2x: 200px cam -> 40px screen shift). */
export const FAR_PARALLAX = 0.2;
/** Mid-layer parallax factor (0.5x: 200px cam -> 100px screen shift). */
export const MID_PARALLAX = 0.5;
/** Haze luminance lift over the mid band (>=10% brighter). */
export const HAZE_LIFT = 1.1;
/** Far-layer tile period in backing-store px (wraps the screen offset). */
export const FAR_PERIOD = 80;
/** Mid-layer tile period in backing-store px (wraps the screen offset). */
export const MID_PERIOD = 208;
/** Top strip kept as pure sky (peaks stay below this fraction). */
export const TOP_RESERVE_FRACTION = 0.15;
/** Haze band top as a fraction of canvas height. */
export const HAZE_TOP_FRACTION = 0.62;
/** Haze band height as a fraction of canvas height (62-72%). */
export const HAZE_HEIGHT_FRACTION = 0.1;
/** Backdrop slice width in backing-store px (stepped ridge columns). */
export const BACKDROP_SLICE_W = 16;

/** Minimal Pixi Graphics surface (structural, no pixi.js import). */
export interface BackdropPixiGraphics {
  rect(x: number, y: number, w: number, h: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
}

/** Per-theme backdrop layer palette (hex + CSS twins). */
export interface BackdropPalette {
  /** Theme key (matches the arena file name). */
  name: ThemeName;
  /** Far mountain silhouette fill. */
  farHex: number;
  /** Far mountain silhouette fill as CSS. */
  farCss: string;
  /** Mid treeline silhouette fill. */
  midHex: number;
  /** Mid treeline silhouette fill as CSS. */
  midCss: string;
  /** Bright haze band fill (full-width). */
  hazeHex: number;
  /** Bright haze band fill as CSS. */
  hazeCss: string;
  /** Per-theme ridge seed (decorative shape variation). */
  seed: number;
}

/** kilima: slate far/mid under a pale haze. */
const KILIMA_BACKDROP: BackdropPalette = {
  name: "kilima",
  farHex: 0x2e3842,
  farCss: "#2e3842",
  midHex: 0x1e262e,
  midCss: "#1e262e",
  hazeHex: 0x8a9aa8,
  hazeCss: "#8a9aa8",
  seed: 11,
};

/** dune: warm umber far/mid under an amber haze. */
const DUNE_BACKDROP: BackdropPalette = {
  name: "dune",
  farHex: 0x5a3a22,
  farCss: "#5a3a22",
  midHex: 0x3a2415,
  midCss: "#3a2415",
  hazeHex: 0xe8b06a,
  hazeCss: "#e8b06a",
  seed: 47,
};

/** frostbite: cold steel far/mid under an ice haze. */
const FROSTBITE_BACKDROP: BackdropPalette = {
  name: "frostbite",
  farHex: 0x2a3f5a,
  farCss: "#2a3f5a",
  midHex: 0x16283c,
  midCss: "#16283c",
  hazeHex: 0x9fd4f0,
  hazeCss: "#9fd4f0",
  seed: 83,
};

/** Pure backdrop palette registry (never mutated by callers). */
export const BACKDROP_PALETTES: Record<ThemeName, BackdropPalette> = {
  kilima: KILIMA_BACKDROP,
  dune: DUNE_BACKDROP,
  frostbite: FROSTBITE_BACKDROP,
};

/**
 * Backdrop palette for a theme name (tolerant, falls back to kilima).
 * Returns a copy so callers cannot mutate the registry.
 */
export function backdropPaletteFor(name: unknown): BackdropPalette {
  const grade = skyGradeFor(name);
  const entry = BACKDROP_PALETTES[grade.name];
  return { ...entry };
}

/**
 * Resolve the backdrop theme key tolerantly (kilima fallback, never
 * throws). Mirrors resolveThemeName precedence via skyGradeFor so the
 * painters and the palette stay on the same theme without importing
 * the tile layer.
 */
export function backdropThemeFor(name: unknown): ThemeName {
  return skyGradeFor(name).name;
}

/**
 * Screen-space parallax offset for a camera x: (-camX * factor) wrapped
 * into [0, period) by positive modulo. A +200 world-px cam move shifts
 * the far layer -40px and the mid layer -100px (ratios 0.2/0.5) up to
 * the wrap seam, where the tiled pattern repeats seamlessly. Pure: no
 * DOM, no clock. Non-finite inputs and non-positive periods read 0.
 */
export function backdropOffsetX(
  camX: number,
  factor: number,
  period: number,
): number {
  if (
    !Number.isFinite(camX) ||
    !Number.isFinite(factor) ||
    !Number.isFinite(period) ||
    period <= 0
  ) {
    return 0;
  }
  const raw = -camX * factor;
  return ((raw % period) + period) % period;
}

/**
 * Absolute screen shift between two camera positions, accounting for
 * the wrap seam: the minimal circular distance in [0, period/2].
 * A 200px cam delta reads 40 (far) and 100 (mid) for any period > 200.
 */
export function backdropShiftX(
  fromCamX: number,
  toCamX: number,
  factor: number,
  period: number,
): number {
  const a = backdropOffsetX(fromCamX, factor, period);
  const b = backdropOffsetX(toCamX, factor, period);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 0;
  }
  const direct = Math.abs(b - a);
  if (!Number.isFinite(period) || period <= 0) {
    return direct;
  }
  return Math.min(direct, period - direct);
}

/** Integer hash for one ridge column (deterministic, no randomness). */
function ridgeHash(seed: number, index: number): number {
  let h = (Math.imul(seed + 1, 2654435761) + Math.imul(index + 1, 40503)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h % 1000) / 1000;
}

/**
 * Ridge column height as a fraction of canvas height for a pattern
 * index under a theme seed. Far ridges swing 0.08-0.28H; mid ridges
 * swing 0.06-0.24H (smaller teeth on top of the same swing).
 */
function farRidgeHeight(seed: number, index: number): number {
  return 0.08 + ridgeHash(seed, index) * 0.2;
}

/** Mid ridge column height as a fraction of canvas height. */
function midRidgeHeight(seed: number, index: number): number {
  return 0.06 + ridgeHash(seed + 101, index) * 0.18;
}

/** Pack one sky channel triple into a Pixi hex. */
function skyHexOf(color: { r: number; g: number; b: number }): number {
  return ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff);
}

/**
 * Paint the top sky-preserve strip in Pixi: the same gradient stops
 * paintSkyPixi lays down for the top TOP_RESERVE_FRACTION of the canvas,
 * so the top-center pixel stays the sky top stop even where the arena
 * base fill covered it. Uses rect/fill bands only.
 */
function paintTopStripPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  theme: ThemeName,
): void {
  const grade = skyGradeFor(theme);
  const stripH = canvasHeight * TOP_RESERVE_FRACTION;
  // Match the sky painter's 32-band lattice over the strip rows only.
  const steps = 32;
  const stepH = canvasHeight / steps;
  for (let i = 0; i < steps; i += 1) {
    const y = i * stepH;
    if (y >= stripH) {
      break;
    }
    const color = skyColorAt(grade, i / (steps - 1));
    graphics.rect(0, y, canvasWidth, stepH + 1);
    graphics.fill(skyHexOf(color));
  }
}

/**
 * Paint one tiled stepped ridgeline in Pixi: vertical rect columns whose
 * tops follow the per-theme ridge pattern, shifted by the screen-space
 * parallax offset and wrapped by the tile period. Columns run from
 * their ridge top down to baseY (the haze overlap), tiling [0, W].
 */
function paintRidgePixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  baseY: number,
  canvasHeight: number,
  offset: number,
  period: number,
  seed: number,
  far: boolean,
  fillHex: number,
): void {
  const sliceW = BACKDROP_SLICE_W;
  for (let sx = 0; sx < canvasWidth; sx += sliceW) {
    const p = (((sx - offset) % period) + period) % period;
    const idx = Math.floor(p / sliceW);
    const frac = far ? farRidgeHeight(seed, idx) : midRidgeHeight(seed, idx);
    const topY = baseY - frac * canvasHeight;
    const h = baseY - topY;
    if (!(h > 0)) {
      continue;
    }
    graphics.rect(sx, topY, sliceW + 1, h + 1);
    graphics.fill(fillHex);
    // Treeline teeth: a narrow cap on every other mid column.
    if (!far && idx % 2 === 0) {
      const toothW = Math.max(2, sliceW / 2);
      const toothH = Math.max(3, canvasHeight * 0.02);
      graphics.rect(sx + sliceW / 4, topY - toothH, toothW, toothH + 1);
      graphics.fill(fillHex);
    }
  }
}

/**
 * Paint the full-canvas parallax backdrop in Pixi: top sky-preserve
 * strip, far ridgeline (FAR_PARALLAX), mid ridgeline plus treeline teeth
 * (MID_PARALLAX), then the full-width haze band. Vertical layers sit at
 * fixed viewport-height fractions (anchored against cam.y) so the
 * luminance profile stays stable; only the horizontal offsets scroll.
 * No-op on non-finite dims.
 */
export function paintBackdropPixi(
  graphics: BackdropPixiGraphics,
  camX: number,
  camY: number,
  canvasWidth: number,
  canvasHeight: number,
  themeName: unknown,
): void {
  void camY;
  if (!skyCoversViewport(canvasWidth, canvasHeight)) {
    return;
  }
  const theme = backdropThemeFor(themeName);
  const palette = BACKDROP_PALETTES[theme];
  const farOffset = backdropOffsetX(camX, FAR_PARALLAX, FAR_PERIOD);
  const midOffset = backdropOffsetX(camX, MID_PARALLAX, MID_PERIOD);
  paintTopStripPixi(graphics, canvasWidth, canvasHeight, theme);
  const farBaseY = canvasHeight * HAZE_TOP_FRACTION + canvasHeight * 0.03;
  paintRidgePixi(
    graphics,
    canvasWidth,
    farBaseY,
    canvasHeight,
    farOffset,
    FAR_PERIOD,
    palette.seed,
    true,
    palette.farHex,
  );
  const midBaseY = canvasHeight * (HAZE_TOP_FRACTION + HAZE_HEIGHT_FRACTION);
  paintRidgePixi(
    graphics,
    canvasWidth,
    midBaseY,
    canvasHeight,
    midOffset,
    MID_PERIOD,
    palette.seed,
    false,
    palette.midHex,
  );
  graphics.rect(
    0,
    canvasHeight * HAZE_TOP_FRACTION,
    canvasWidth,
    canvasHeight * HAZE_HEIGHT_FRACTION + 1,
  );
  graphics.fill(palette.hazeHex);
}

/**
 * Paint the top sky-preserve strip on a 2D canvas (mirrors the Pixi
 * twin). Restores fillStyle afterwards.
 */
function paintTopStrip2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  theme: ThemeName,
): void {
  const grade = skyGradeFor(theme);
  const stripH = canvasHeight * TOP_RESERVE_FRACTION;
  const steps = 32;
  const stepH = canvasHeight / steps;
  const prev = ctx.fillStyle;
  try {
    for (let i = 0; i < steps; i += 1) {
      const y = i * stepH;
      if (y >= stripH) {
        break;
      }
      const color = skyColorAt(grade, i / (steps - 1));
      ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
      ctx.fillRect(0, y, canvasWidth, stepH + 1);
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/**
 * Paint one tiled stepped ridgeline on a 2D canvas (mirrors the Pixi
 * twin). Restores fillStyle afterwards.
 */
function paintRidge2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  baseY: number,
  canvasHeight: number,
  offset: number,
  period: number,
  seed: number,
  far: boolean,
  fillCss: string,
): void {
  const sliceW = BACKDROP_SLICE_W;
  const prev = ctx.fillStyle;
  try {
    ctx.fillStyle = fillCss;
    for (let sx = 0; sx < canvasWidth; sx += sliceW) {
      const p = (((sx - offset) % period) + period) % period;
      const idx = Math.floor(p / sliceW);
      const frac = far ? farRidgeHeight(seed, idx) : midRidgeHeight(seed, idx);
      const topY = baseY - frac * canvasHeight;
      const h = baseY - topY;
      if (!(h > 0)) {
        continue;
      }
      ctx.fillRect(sx, topY, sliceW + 1, h + 1);
      if (!far && idx % 2 === 0) {
        const toothW = Math.max(2, sliceW / 2);
        const toothH = Math.max(3, canvasHeight * 0.02);
        ctx.fillRect(sx + sliceW / 4, topY - toothH, toothW, toothH + 1);
      }
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/**
 * Paint the full-canvas parallax backdrop on a 2D canvas (mirrors
 * paintBackdropPixi). No-op on non-finite dims; restores fillStyle.
 */
export function paintBackdrop2D(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  canvasWidth: number,
  canvasHeight: number,
  themeName: unknown,
): void {
  void camY;
  if (!skyCoversViewport(canvasWidth, canvasHeight)) {
    return;
  }
  const theme = backdropThemeFor(themeName);
  const palette = BACKDROP_PALETTES[theme];
  const farOffset = backdropOffsetX(camX, FAR_PARALLAX, FAR_PERIOD);
  const midOffset = backdropOffsetX(camX, MID_PARALLAX, MID_PERIOD);
  paintTopStrip2D(ctx, canvasWidth, canvasHeight, theme);
  const farBaseY = canvasHeight * HAZE_TOP_FRACTION + canvasHeight * 0.03;
  paintRidge2D(
    ctx,
    canvasWidth,
    farBaseY,
    canvasHeight,
    farOffset,
    FAR_PERIOD,
    palette.seed,
    true,
    palette.farCss,
  );
  const midBaseY = canvasHeight * (HAZE_TOP_FRACTION + HAZE_HEIGHT_FRACTION);
  paintRidge2D(
    ctx,
    canvasWidth,
    midBaseY,
    canvasHeight,
    midOffset,
    MID_PERIOD,
    palette.seed,
    false,
    palette.midCss,
  );
  const prev = ctx.fillStyle;
  try {
    ctx.fillStyle = palette.hazeCss;
    ctx.fillRect(
      0,
      canvasHeight * HAZE_TOP_FRACTION,
      canvasWidth,
      canvasHeight * HAZE_HEIGHT_FRACTION + 1,
    );
  } finally {
    ctx.fillStyle = prev;
  }
}

/**
 * True when the haze fill is at least HAZE_LIFT brighter than the mid
 * fill (Rec.601 luma, the capture probe definition). All shipped themes
 * clear the 1.10 floor with wide margin.
 */
export function hazeLiftPasses(name: unknown): boolean {
  const palette = backdropPaletteFor(name);
  const mid = luminanceOfHex(palette.midHex);
  const haze = luminanceOfHex(palette.hazeHex);
  if (!(mid > 0)) {
    return false;
  }
  return haze / mid >= HAZE_LIFT;
}

/**
 * Top-to-bottom Rec.601 luminance profile for a theme: sky top, far,
 * mid, then haze. The first three entries strictly decrease; the haze
 * entry clears HAZE_LIFT over mid. Headless tests assert this shape so
 * the 1920x1080 capture probe holds by construction.
 */
export function backdropLuminanceProfile(name: unknown): {
  theme: ThemeName;
  top: number;
  far: number;
  mid: number;
  haze: number;
} {
  const theme = backdropThemeFor(name);
  const grade = skyGradeFor(theme);
  const topRgb = hexToRgb(grade.topHex);
  const palette = BACKDROP_PALETTES[theme];
  const top = 0.299 * topRgb.r + 0.587 * topRgb.g + 0.114 * topRgb.b;
  return {
    theme,
    top,
    far: luminanceOfHex(palette.farHex),
    mid: luminanceOfHex(palette.midHex),
    haze: luminanceOfHex(palette.hazeHex),
  };
}
