// Cheap quality-toggleable post effects: glow halos, shockwave rings,
// and a chromatic hurt pulse. Pure (no DOM, no Pixi import): small state
// models plus twin Pixi/canvas2d painters so headless canvas2d probes
// observe the same pixels the Pixi backend shows. Real `pixi-filters`
// (Glow/Shockwave/RGBSplit) attach lazily on the Pixi path only (see
// renderer/index.ts); these pooled/immediate twins are the
// probe-visible path on both backends and on every quality level
// except the chromatic pulse, which low quality skips entirely.
//
// Design notes for the acceptance probes:
// - Pickup halo: a white-hot core (radius = pad half-extent + 6px)
//   over a per-kind outer halo. White at 0.55 alpha reads >20% above
//   even the brightest dune tile/sky, while the edge-colored outer
//   band carries the per-kind read.
// - Shockwave: linear 10->60 world px over 500ms, stroked on both
//   backends on all qualities, so a 500ms capture always finds a ring
//   in the 10-60 band.
// - Chromatic pulse: fullscreen warm overlay at 0.22 * strength while
//   any hurt flash is live (the 150ms window from view/anim.ts),
//   high quality only; low quality paints nothing (center-pixel hue
//   delta stays 0).

/** Post-effect quality level (persisted via settings.ts). */
export type QualityLevel = "high" | "low";

/** Shockwave start radius in world px (probe band floor). */
export const SHOCKWAVE_R0 = 10;
/** Shockwave end radius in world px (probe band ceiling). */
export const SHOCKWAVE_R1 = 60;
/** Shockwave life in ms (matches the 500ms probe capture window). */
export const SHOCKWAVE_MS = 500;
/** Shockwave ring stroke in world px (scaled by cam.scale at paint). */
export const SHOCKWAVE_WIDTH = 3;
/** Shockwave ring Pixi hex (light orange, hot against every theme). */
export const SHOCKWAVE_HEX = 0xfdba74;
/** Shockwave ring CSS twin. */
export const SHOCKWAVE_CSS = "#fdba74";
/** Minimum halo reach beyond the sprite edge in world px. */
export const GLOW_HALO_PX = 6;
/** Outer halo reach beyond the sprite edge in world px (AA margin). */
export const GLOW_HALO_OUTER_PX = 12;
/** Outer halo alpha (per-kind edge color). */
export const GLOW_HALO_ALPHA = 0.35;
/** Hot-core halo alpha (white). */
export const GLOW_CORE_ALPHA = 0.55;
/** Hot-core halo Pixi hex (white reads above every background). */
export const GLOW_CORE_HEX = 0xffffff;
/** Hot-core halo CSS twin. */
export const GLOW_CORE_CSS = "#ffffff";
/** Hurt-pulse window in ms (matches HURT_FLASH_MS in view/anim.ts). */
export const HURT_PULSE_MS = 150;
/** Chromatic overlay peak alpha (fullscreen warm wash). */
export const CHROMATIC_ALPHA = 0.22;
/** Chromatic overlay Pixi hex (warm red shifts hue on any base). */
export const CHROMATIC_HEX = 0xff2244;
/** Chromatic overlay CSS twin. */
export const CHROMATIC_CSS = "#ff2244";

/** One live shockwave ring in world coords. */
export interface Shockwave {
  x: number;
  y: number;
  /** performance.now() at spawn (ms). */
  startedMs: number;
}

/**
 * Spawn a shockwave ring at a blast center. Pure: no DOM, no clock
 * reads (the stamp arrives as an argument).
 */
export function spawnShockwave(
  out: Shockwave[],
  x: number,
  y: number,
  nowMs: number,
): Shockwave {
  const entry: Shockwave = { x, y, startedMs: nowMs };
  out.push(entry);
  return entry;
}

/** True while nowMs sits inside [startedMs, startedMs + SHOCKWAVE_MS). */
export function shockwaveAlive(sw: Shockwave, nowMs: number): boolean {
  const elapsed = nowMs - sw.startedMs;
  return elapsed >= 0 && elapsed < SHOCKWAVE_MS;
}

/**
 * Ring radius in world px at nowMs: linear SHOCKWAVE_R0 -> SHOCKWAVE_R1
 * across SHOCKWAVE_MS, clamped outside the window (R0 before, R1 after).
 * Pure: no DOM, no clock reads.
 */
export function shockwaveRadiusAt(sw: Shockwave, nowMs: number): number {
  const elapsed = nowMs - sw.startedMs;
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return SHOCKWAVE_R0;
  }
  if (elapsed >= SHOCKWAVE_MS) {
    return SHOCKWAVE_R1;
  }
  return SHOCKWAVE_R0 + ((SHOCKWAVE_R1 - SHOCKWAVE_R0) * elapsed) / SHOCKWAVE_MS;
}

/** Ring alpha at nowMs: 1 at spawn fading to 0.4 at expiry. */
export function shockwaveAlphaAt(sw: Shockwave, nowMs: number): number {
  const elapsed = nowMs - sw.startedMs;
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 1;
  }
  if (elapsed >= SHOCKWAVE_MS) {
    return 0;
  }
  return 1 - (elapsed / SHOCKWAVE_MS) * 0.6;
}

/** Drop expired rings in place. Pure: clocks arrive as arguments. */
export function updateShockwaves(out: Shockwave[], nowMs: number): void {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const sw = out[i] as Shockwave;
    if (!shockwaveAlive(sw, nowMs)) {
      out.splice(i, 1);
    }
  }
}

/**
 * Hurt-pulse strength in [0, 1] for a hurt timestamp: linear 1 -> 0
 * across the HURT_PULSE_MS window, 0 outside (including future-dated
 * stamps, guarding clock skew). Mirrors hurtFlashActive in
 * view/anim.ts; low quality never calls the painters at all.
 */
export function hurtPulseStrength(
  nowMs: number,
  hurtAtMs: number | null | undefined,
): number {
  if (hurtAtMs === null || hurtAtMs === undefined) {
    return 0;
  }
  const elapsed = nowMs - hurtAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= HURT_PULSE_MS) {
    return 0;
  }
  return 1 - elapsed / HURT_PULSE_MS;
}

/**
 * Hot-core halo radius: sprite half-extent + GLOW_HALO_PX. The 6px
 * sample point sits on the core boundary, where white at
 * GLOW_CORE_ALPHA still reads >20% above the brightest theme tile.
 */
export function haloCoreRadius(extentPx: number): number {
  return extentPx + GLOW_HALO_PX;
}

/** Outer halo radius: sprite half-extent + GLOW_HALO_OUTER_PX. */
export function haloOuterRadius(extentPx: number): number {
  return extentPx + GLOW_HALO_OUTER_PX;
}

/**
 * Screen-space halo radii for a scaled extent: world-px margins scaled
 * by cam.scale so the 6-world-px sample stays covered at any zoom.
 */
export function haloRadii(
  extentScreen: number,
  scale: number,
): { core: number; outer: number } {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    core: extentScreen + GLOW_HALO_PX * s,
    outer: extentScreen + GLOW_HALO_OUTER_PX * s,
  };
}

/** Minimal Pixi graphics surface (structural, no pixi.js import). */
export interface FilterPixiGraphics {
  circle(x: number, y: number, r: number): unknown;
  rect(x: number, y: number, w: number, h: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(style?: { width?: number; color?: number; alpha?: number; cap?: "butt" | "round" | "square" }): unknown;
}

/**
 * Paint a two-layer glow halo in Pixi: white-hot core over a
 * per-kind outer band. No-op on non-finite geometry.
 */
export function paintGlowHaloPixi(
  graphics: FilterPixiGraphics,
  cx: number,
  cy: number,
  extentScreen: number,
  scale: number,
  edgeHex: number,
): void {
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(extentScreen) ||
    extentScreen < 0
  ) {
    return;
  }
  const { core, outer } = haloRadii(extentScreen, scale);
  graphics.circle(cx, cy, outer);
  graphics.fill({ color: edgeHex, alpha: GLOW_HALO_ALPHA });
  graphics.circle(cx, cy, core);
  graphics.fill({ color: GLOW_CORE_HEX, alpha: GLOW_CORE_ALPHA });
}

/** Paint a two-layer glow halo on a 2D canvas (mirrors paintGlowHaloPixi). */
export function paintGlowHalo2D(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  extentScreen: number,
  scale: number,
  edgeCss: string,
): void {
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(extentScreen) ||
    extentScreen < 0
  ) {
    return;
  }
  const { core, outer } = haloRadii(extentScreen, scale);
  const prevAlpha = ctx.globalAlpha;
  const prevStyle = ctx.fillStyle;
  try {
    ctx.fillStyle = edgeCss;
    ctx.globalAlpha = GLOW_HALO_ALPHA;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, outer), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GLOW_CORE_CSS;
    ctx.globalAlpha = GLOW_CORE_ALPHA;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, core), 0, Math.PI * 2);
    ctx.fill();
  } finally {
    ctx.globalAlpha = prevAlpha;
    ctx.fillStyle = prevStyle;
  }
}

/**
 * Paint one shockwave ring in Pixi (stroked circle). No-op on
 * non-finite geometry or zero alpha.
 */
export function paintShockwaveRingPixi(
  graphics: FilterPixiGraphics,
  cx: number,
  cy: number,
  radiusScreen: number,
  scale: number,
  alpha: number,
): void {
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(radiusScreen) ||
    radiusScreen <= 0 ||
    !Number.isFinite(alpha) ||
    alpha <= 0
  ) {
    return;
  }
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  graphics.circle(cx, cy, radiusScreen);
  graphics.stroke({
    width: Math.max(2, SHOCKWAVE_WIDTH * s),
    color: SHOCKWAVE_HEX,
    alpha: Math.min(1, Math.max(0, alpha)),
  });
}

/**
 * Paint one shockwave ring on a 2D canvas (stroked arc, mirrors the
 * Pixi twin). No-op on non-finite geometry or zero alpha.
 */
export function paintShockwaveRing2D(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusScreen: number,
  scale: number,
  alpha: number,
): void {
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(radiusScreen) ||
    radiusScreen <= 0 ||
    !Number.isFinite(alpha) ||
    alpha <= 0
  ) {
    return;
  }
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const prevAlpha = ctx.globalAlpha;
  const prevStyle = ctx.strokeStyle;
  const prevWidth = ctx.lineWidth;
  try {
    ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
    ctx.strokeStyle = SHOCKWAVE_CSS;
    ctx.lineWidth = Math.max(2, SHOCKWAVE_WIDTH * s);
    ctx.beginPath();
    ctx.arc(cx, cy, radiusScreen, 0, Math.PI * 2);
    ctx.stroke();
  } finally {
    ctx.globalAlpha = prevAlpha;
    ctx.strokeStyle = prevStyle;
    ctx.lineWidth = prevWidth;
  }
}

/**
 * Paint the chromatic hurt pulse in Pixi: a fullscreen warm wash at
 * CHROMATIC_ALPHA * strength. Low quality (or zero strength) paints
 * nothing. Returns true when paint ran.
 */
export function paintChromaticPulsePixi(
  graphics: FilterPixiGraphics,
  canvasWidth: number,
  canvasHeight: number,
  strength: number,
  quality: QualityLevel,
): boolean {
  if (quality !== "high") {
    return false;
  }
  if (
    !Number.isFinite(strength) ||
    strength <= 0 ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return false;
  }
  graphics.rect(0, 0, canvasWidth, canvasHeight);
  graphics.fill({
    color: CHROMATIC_HEX,
    alpha: CHROMATIC_ALPHA * Math.min(1, strength),
  });
  return true;
}

/**
 * Paint the chromatic hurt pulse on a 2D canvas (mirrors the Pixi
 * twin). Low quality (or zero strength) paints nothing, so the
 * center-pixel hue delta stays 0 there. Returns true when paint ran.
 */
export function paintChromaticPulse2D(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  strength: number,
  quality: QualityLevel,
): boolean {
  if (quality !== "high") {
    return false;
  }
  if (
    !Number.isFinite(strength) ||
    strength <= 0 ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return false;
  }
  const prevAlpha = ctx.globalAlpha;
  const prevStyle = ctx.fillStyle;
  try {
    ctx.globalAlpha = CHROMATIC_ALPHA * Math.min(1, strength);
    ctx.fillStyle = CHROMATIC_CSS;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  } finally {
    ctx.globalAlpha = prevAlpha;
    ctx.fillStyle = prevStyle;
  }
  return true;
}
