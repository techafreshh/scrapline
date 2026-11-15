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
  themeBackdropLayers,
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
 * Declared backdrop layer ids for a theme name (tolerant, kilima fallback).
 * Returns a fresh copy so callers cannot mutate the registry. No theme
 * ever contains `city` (city silhouettes were removed from every set).
 */
export function backdropLayersFor(name: unknown): string[] {
  return themeBackdropLayers(backdropThemeFor(name));
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

/** Dusk-sun disc fill (kilima ornament, distinct from the palette haze). */
export const KILIMA_SUN_HEX = 0xd9a441;
/** Antenna beacon fill (frostbite ornament, doorway-light red read). */
export const FROST_BEACON_HEX = 0xef4444;
/** Snow speck fill (frostbite ornament). */
export const FROST_SNOW_HEX = 0xdff2ff;
/** CSS twin of the kilima sun-disc fill (2D backend). */
export const KILIMA_SUN_CSS = "#d9a441";
/** CSS twin of the frostbite beacon fill (2D backend). */
export const FROST_BEACON_CSS = "#ef4444";
/** CSS twin of the frostbite snow fill (2D backend). */
export const FROST_SNOW_CSS = "#dff2ff";

/** Pack one hex + alpha into an rgba() CSS string (2D alpha-band twin). */
function rgbaCss(hex: number, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Wrap a phase-positioned ornament x into [0, canvasWidth) under the layer
 * parallax offset, so discrete silhouettes scroll seamlessly and
 * deterministically with the camera (no wall-clock, no randomness).
 */
function ornamentX(
  phase: number,
  offset: number,
  canvasWidth: number,
): number {
  if (!(canvasWidth > 0)) {
    return 0;
  }
  const raw = phase * canvasWidth - offset;
  return ((raw % canvasWidth) + canvasWidth) % canvasWidth;
}

/**
 * Dusk-savanna sun disc in Pixi: stacked rect rows forming a stepped disc
 * around a fixed viewport fraction (sky-anchored, no parallax). Uses
 * rect/fill ops only so the graphics stub contract holds.
 */
function paintSunDiscPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const cx = canvasWidth * 0.68;
  const cy = canvasHeight * 0.36;
  const r = Math.max(8, canvasHeight * 0.07);
  const rows = 5;
  const rowH = (2 * r) / rows;
  for (let i = 0; i < rows; i += 1) {
    const dy = (i - (rows - 1) / 2) * rowH;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (!(half > 0)) {
      continue;
    }
    graphics.rect(cx - half, cy + dy - rowH / 2, half * 2, rowH + 1);
    graphics.fill(KILIMA_SUN_HEX);
  }
}

/**
 * Acacia silhouettes in Pixi: trunk rect plus flat-canopy rects keyed by
 * the ridge hash, scrolling with the mid layer. All peaks stay far below
 * the top-strip reserve.
 */
function paintAcaciasPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midHex: number,
  midBaseY: number,
): void {
  for (let i = 0; i < 3; i += 1) {
    const phase = ridgeHash(seed + 7, i * 3 + 1);
    const x = ornamentX(phase, midOffset, canvasWidth);
    const groundY =
      midBaseY - ridgeHash(seed + 7, i * 5 + 2) * canvasHeight * 0.06;
    const trunkW = Math.max(3, canvasWidth * 0.006);
    const trunkH = canvasHeight * 0.07;
    graphics.rect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH + 1);
    graphics.fill(midHex);
    const canopyW =
      canvasWidth * 0.05 +
      ridgeHash(seed + 7, i * 7 + 3) * canvasWidth * 0.03;
    const canopyH = Math.max(3, canvasHeight * 0.022);
    graphics.rect(
      x - canopyW / 2,
      groundY - trunkH - canopyH,
      canopyW,
      canopyH + 1,
    );
    graphics.fill(midHex);
    graphics.rect(
      x - canopyW / 4,
      groundY - trunkH - canopyH * 2,
      canopyW / 2,
      canopyH,
    );
    graphics.fill(midHex);
  }
}

/** Crossing-bird ticks in Pixi: paired 2px rects at hash sky positions. */
function paintBirdsPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midHex: number,
): void {
  for (let i = 0; i < 5; i += 1) {
    const x = ornamentX(ridgeHash(seed + 13, i * 2 + 1), midOffset, canvasWidth);
    const y = canvasHeight * (0.28 + ridgeHash(seed + 13, i * 2 + 2) * 0.1);
    graphics.rect(x, y, 5, 2);
    graphics.fill(midHex);
    graphics.rect(x + 5, y - 2, 5, 2);
    graphics.fill(midHex);
  }
}

/**
 * Refinery chimney stacks in Pixi: vertical rects with a cap plus a short
 * haze plume (alpha object fill, so the haze-band probe still matches the
 * full-width haze rect first). No city-block rectangles.
 */
function paintChimneysPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midHex: number,
  hazeHex: number,
  midBaseY: number,
): void {
  for (let i = 0; i < 3; i += 1) {
    const x = ornamentX(ridgeHash(seed + 21, i * 3 + 1), midOffset, canvasWidth);
    const w = Math.max(8, canvasWidth * 0.014);
    const h = canvasHeight * 0.13;
    graphics.rect(x, midBaseY - h, w, h + 1);
    graphics.fill(midHex);
    graphics.rect(x - 2, midBaseY - h - 3, w + 4, 3);
    graphics.fill(midHex);
    graphics.rect(x + w * 0.2, midBaseY - h - 8, w * 1.6, 4);
    graphics.fill({ color: hazeHex, alpha: 0.55 });
  }
}

/**
 * Polar-night aurora in Pixi: full-width alpha rect bands above the haze
 * top (alternating haze/sky fills, rect/fill ops only).
 */
function paintAuroraPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  theme: ThemeName,
  hazeHex: number,
): void {
  const topHex = skyGradeFor(theme).topHex;
  const bands = [0.24, 0.34, 0.44];
  for (let i = 0; i < bands.length; i += 1) {
    graphics.rect(0, canvasHeight * bands[i], canvasWidth, canvasHeight * 0.05);
    graphics.fill(
      i % 2 === 0
        ? { color: hazeHex, alpha: 0.35 }
        : { color: topHex, alpha: 0.3 },
    );
  }
}

/**
 * Antenna masts in Pixi: vertical rect plus two crossbars and a beacon
 * rect (rect-only mirror of the antenna-mast decor idiom, no circles).
 */
function paintAntennasPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midHex: number,
  midBaseY: number,
): void {
  for (let i = 0; i < 2; i += 1) {
    const x = ornamentX(ridgeHash(seed + 41, i * 3 + 1), midOffset, canvasWidth);
    const mastW = Math.max(3, canvasWidth * 0.005);
    const mastH = canvasHeight * 0.11;
    const baseY =
      midBaseY - ridgeHash(seed + 41, i * 3 + 2) * canvasHeight * 0.04;
    graphics.rect(x, baseY - mastH, mastW, mastH + 1);
    graphics.fill(midHex);
    graphics.rect(x - mastW * 2, baseY - mastH * 0.7, mastW * 5, 2);
    graphics.fill(midHex);
    graphics.rect(x - mastW * 1.5, baseY - mastH * 0.45, mastW * 4, 2);
    graphics.fill(midHex);
    graphics.rect(x - 1, baseY - mastH - 4, mastW + 2, 3);
    graphics.fill(FROST_BEACON_HEX);
  }
}

/** Deterministic snow speck rects in Pixi (static layout, no clock). */
function paintSnowPixi(
  graphics: BackdropPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
): void {
  for (let i = 0; i < 24; i += 1) {
    const x = ornamentX(ridgeHash(seed + 53, i * 2 + 1), midOffset, canvasWidth);
    const y = canvasHeight * (0.2 + ridgeHash(seed + 53, i * 2 + 2) * 0.45);
    graphics.rect(x, y, 2, 2);
    graphics.fill(FROST_SNOW_HEX);
  }
}

/**
 * Per-theme silhouette ornaments in Pixi, painted after the ridgelines and
 * before the haze band so haze overlaps the ornament bases. Palettes,
 * factors, periods, and haze geometry are untouched.
 */
function paintThemeOrnamentsPixi(
  graphics: BackdropPixiGraphics,
  theme: ThemeName,
  palette: BackdropPalette,
  canvasWidth: number,
  canvasHeight: number,
  farOffset: number,
  midOffset: number,
  farBaseY: number,
  midBaseY: number,
): void {
  if (theme === "kilima") {
    paintSunDiscPixi(graphics, canvasWidth, canvasHeight);
    paintAcaciasPixi(
      graphics,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midHex,
      midBaseY,
    );
    paintBirdsPixi(
      graphics,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midHex,
    );
  } else if (theme === "dune") {
    // Second far ridgeline under a shifted seed: rolling dune swells.
    paintRidgePixi(
      graphics,
      canvasWidth,
      farBaseY - canvasHeight * 0.02,
      canvasHeight,
      farOffset,
      FAR_PERIOD,
      palette.seed + 31,
      true,
      palette.farHex,
    );
    paintChimneysPixi(
      graphics,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midHex,
      palette.hazeHex,
      midBaseY,
    );
  } else {
    paintAuroraPixi(graphics, canvasWidth, canvasHeight, theme, palette.hazeHex);
    paintAntennasPixi(
      graphics,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midHex,
      midBaseY,
    );
    paintSnowPixi(graphics, canvasWidth, canvasHeight, midOffset, palette.seed);
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
  paintThemeOrnamentsPixi(
    graphics,
    theme,
    palette,
    canvasWidth,
    canvasHeight,
    farOffset,
    midOffset,
    farBaseY,
    midBaseY,
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
 * Dusk-savanna sun disc on a 2D canvas (mirrors the Pixi twin).
 * Restores fillStyle afterwards.
 */
function paintSunDisc2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const prev = ctx.fillStyle;
  try {
    ctx.fillStyle = KILIMA_SUN_CSS;
    const cx = canvasWidth * 0.68;
    const cy = canvasHeight * 0.36;
    const r = Math.max(8, canvasHeight * 0.07);
    const rows = 5;
    const rowH = (2 * r) / rows;
    for (let i = 0; i < rows; i += 1) {
      const dy = (i - (rows - 1) / 2) * rowH;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      if (!(half > 0)) {
        continue;
      }
      ctx.fillRect(cx - half, cy + dy - rowH / 2, half * 2, rowH + 1);
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/** Acacia silhouettes on a 2D canvas (mirrors the Pixi twin). */
function paintAcacias2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midCss: string,
  midBaseY: number,
): void {
  const prev = ctx.fillStyle;
  try {
    ctx.fillStyle = midCss;
    for (let i = 0; i < 3; i += 1) {
      const phase = ridgeHash(seed + 7, i * 3 + 1);
      const x = ornamentX(phase, midOffset, canvasWidth);
      const groundY =
        midBaseY - ridgeHash(seed + 7, i * 5 + 2) * canvasHeight * 0.06;
      const trunkW = Math.max(3, canvasWidth * 0.006);
      const trunkH = canvasHeight * 0.07;
      ctx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH + 1);
      const canopyW =
        canvasWidth * 0.05 +
        ridgeHash(seed + 7, i * 7 + 3) * canvasWidth * 0.03;
      const canopyH = Math.max(3, canvasHeight * 0.022);
      ctx.fillRect(
        x - canopyW / 2,
        groundY - trunkH - canopyH,
        canopyW,
        canopyH + 1,
      );
      ctx.fillRect(
        x - canopyW / 4,
        groundY - trunkH - canopyH * 2,
        canopyW / 2,
        canopyH,
      );
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/** Crossing-bird ticks on a 2D canvas (mirrors the Pixi twin). */
function paintBirds2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midCss: string,
): void {
  const prev = ctx.fillStyle;
  try {
    ctx.fillStyle = midCss;
    for (let i = 0; i < 5; i += 1) {
      const x = ornamentX(
        ridgeHash(seed + 13, i * 2 + 1),
        midOffset,
        canvasWidth,
      );
      const y = canvasHeight * (0.28 + ridgeHash(seed + 13, i * 2 + 2) * 0.1);
      ctx.fillRect(x, y, 5, 2);
      ctx.fillRect(x + 5, y - 2, 5, 2);
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/** Refinery chimney stacks on a 2D canvas (mirrors the Pixi twin). */
function paintChimneys2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midCss: string,
  hazeHex: number,
  midBaseY: number,
): void {
  const prev = ctx.fillStyle;
  try {
    for (let i = 0; i < 3; i += 1) {
      const x = ornamentX(
        ridgeHash(seed + 21, i * 3 + 1),
        midOffset,
        canvasWidth,
      );
      const w = Math.max(8, canvasWidth * 0.014);
      const h = canvasHeight * 0.13;
      ctx.fillStyle = midCss;
      ctx.fillRect(x, midBaseY - h, w, h + 1);
      ctx.fillRect(x - 2, midBaseY - h - 3, w + 4, 3);
      ctx.fillStyle = rgbaCss(hazeHex, 0.55);
      ctx.fillRect(x + w * 0.2, midBaseY - h - 8, w * 1.6, 4);
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/** Polar-night aurora bands on a 2D canvas (mirrors the Pixi twin). */
function paintAurora2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  theme: ThemeName,
  hazeHex: number,
): void {
  const prev = ctx.fillStyle;
  try {
    const topHex = skyGradeFor(theme).topHex;
    const bands = [0.24, 0.34, 0.44];
    for (let i = 0; i < bands.length; i += 1) {
      ctx.fillStyle =
        i % 2 === 0 ? rgbaCss(hazeHex, 0.35) : rgbaCss(topHex, 0.3);
      ctx.fillRect(
        0,
        canvasHeight * bands[i],
        canvasWidth,
        canvasHeight * 0.05,
      );
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/** Antenna masts on a 2D canvas (mirrors the Pixi twin). */
function paintAntennas2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
  midCss: string,
  midBaseY: number,
): void {
  const prev = ctx.fillStyle;
  try {
    for (let i = 0; i < 2; i += 1) {
      const x = ornamentX(
        ridgeHash(seed + 41, i * 3 + 1),
        midOffset,
        canvasWidth,
      );
      const mastW = Math.max(3, canvasWidth * 0.005);
      const mastH = canvasHeight * 0.11;
      const baseY =
        midBaseY - ridgeHash(seed + 41, i * 3 + 2) * canvasHeight * 0.04;
      ctx.fillStyle = midCss;
      ctx.fillRect(x, baseY - mastH, mastW, mastH + 1);
      ctx.fillRect(x - mastW * 2, baseY - mastH * 0.7, mastW * 5, 2);
      ctx.fillRect(x - mastW * 1.5, baseY - mastH * 0.45, mastW * 4, 2);
      ctx.fillStyle = FROST_BEACON_CSS;
      ctx.fillRect(x - 1, baseY - mastH - 4, mastW + 2, 3);
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/** Deterministic snow specks on a 2D canvas (mirrors the Pixi twin). */
function paintSnow2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  midOffset: number,
  seed: number,
): void {
  const prev = ctx.fillStyle;
  try {
    ctx.fillStyle = FROST_SNOW_CSS;
    for (let i = 0; i < 24; i += 1) {
      const x = ornamentX(
        ridgeHash(seed + 53, i * 2 + 1),
        midOffset,
        canvasWidth,
      );
      const y = canvasHeight * (0.2 + ridgeHash(seed + 53, i * 2 + 2) * 0.45);
      ctx.fillRect(x, y, 2, 2);
    }
  } finally {
    ctx.fillStyle = prev;
  }
}

/**
 * Per-theme silhouette ornaments on a 2D canvas, painted after the
 * ridgelines and before the haze band (mirrors the Pixi twin).
 */
function paintThemeOrnaments2D(
  ctx: CanvasRenderingContext2D,
  theme: ThemeName,
  palette: BackdropPalette,
  canvasWidth: number,
  canvasHeight: number,
  farOffset: number,
  midOffset: number,
  farBaseY: number,
  midBaseY: number,
): void {
  if (theme === "kilima") {
    paintSunDisc2D(ctx, canvasWidth, canvasHeight);
    paintAcacias2D(
      ctx,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midCss,
      midBaseY,
    );
    paintBirds2D(
      ctx,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midCss,
    );
  } else if (theme === "dune") {
    paintRidge2D(
      ctx,
      canvasWidth,
      farBaseY - canvasHeight * 0.02,
      canvasHeight,
      farOffset,
      FAR_PERIOD,
      palette.seed + 31,
      true,
      palette.farCss,
    );
    paintChimneys2D(
      ctx,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midCss,
      palette.hazeHex,
      midBaseY,
    );
  } else {
    paintAurora2D(ctx, canvasWidth, canvasHeight, theme, palette.hazeHex);
    paintAntennas2D(
      ctx,
      canvasWidth,
      canvasHeight,
      midOffset,
      palette.seed,
      palette.midCss,
      midBaseY,
    );
    paintSnow2D(ctx, canvasWidth, canvasHeight, midOffset, palette.seed);
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
  paintThemeOrnaments2D(
    ctx,
    theme,
    palette,
    canvasWidth,
    canvasHeight,
    farOffset,
    midOffset,
    farBaseY,
    midBaseY,
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
