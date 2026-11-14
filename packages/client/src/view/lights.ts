// Static additive lighting pass: warm glow pools for doorways and lamps.
// Pure (no DOM, no Pixi): a small per-theme static anchor registry plus
// twin Pixi/canvas2d additive painters share one model so headless tests
// drive the same contract the renderer paints. Lights are anchored in
// the verified-empty sky band next to existing decoration rects and never
// touch solid tiles; kilima/dune pools are steady while frostbite window
// pools flicker on the wall clock (not the tick) so a 1.5s-apart sample
// always straddles a phase swing. Low quality paints at most the first
// LOW_LIGHT_CAP lights; high paints the full culled set.
import { TILE_SIZE } from "../../../core/src/map";
import { visibleTileRange, type Camera } from "../renderer/camera";
import type { QualityLevel } from "../fx/filters";

/** Static warm light pool in world px (y-down, carried by the client). */
export interface Light {
  /** Center in world px. */
  x: number;
  /** Center in world px. */
  y: number;
  /** Glow reach in world px (scaled by cam.scale at paint). */
  radiusWorld: number;
  /** Warm pool tint (Pixi hex, amber family). */
  warmHex: number;
  /** Warm pool tint (CSS twin). */
  warmCss: string;
  /** True while the pool flickers (frostbite windows only). */
  flicker: boolean;
}

/** World-space glow radius: 80 screen px at CAMERA_ZOOM = 2. */
export const LIGHT_RADIUS_WORLD = 40;
/** Max painted lights on low quality (high paints the full set). */
export const LOW_LIGHT_CAP = 2;
/** Flicker period in ms: t=0 vs t=1500ms sit near opposite phase. */
export const LIGHT_FLICKER_MS = 2000;
/** Flicker floor/ceiling: alpha swings 0.10 <-> 1.00 every period. */
export const LIGHT_FLICKER_BASE = 0.55;
export const LIGHT_FLICKER_AMP = 0.45;
/** Warm pool tint in Pixi hex (amber doorway read at dusk). */
export const LIGHT_WARM_HEX = 0xffb46b;
/** Warm pool tint in CSS. */
export const LIGHT_WARM_CSS = "#ffb46b";
/** Hot-core tint in Pixi hex (pale amber core over the warm pool). */
export const LIGHT_CORE_HEX = 0xffd9a0;
/** Hot-core tint in CSS. */
export const LIGHT_CORE_CSS = "#ffd9a0";
/** Outer-pool Pixi alpha (per-light flicker multiplies it). */
export const LIGHT_OUTER_ALPHA = 0.28;
/** Mid-pool Pixi alpha (per-light flicker multiplies it). */
export const LIGHT_MID_ALPHA = 0.35;
/** Hot-core Pixi alpha (per-light flicker multiplies it). */
export const LIGHT_CORE_ALPHA = 0.55;
/** Mid 2D gradient stop alpha (per-light flicker multiplies it). */
export const LIGHT_MID_ALPHA_2D = 0.28;

/** Kilima doorway/lamp pools: steady warm light near each decor rect. */
const KILIMA_LIGHTS: Light[] = [
  { x: 112, y: 76, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: false },
  { x: 624, y: 64, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: false },
  { x: 968, y: 64, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: false },
  { x: 320, y: 48, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: false },
];

/** Dune lamp pools: steady warm light near the refinery dressing. */
const DUNE_LIGHTS: Light[] = [
  { x: 464, y: 44, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: false },
  { x: 848, y: 72, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: false },
];

/** Frostbite window pools: every pool flickers so any window sample swings. */
const FROSTBITE_LIGHTS: Light[] = [
  { x: 544, y: 44, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: true },
  { x: 704, y: 32, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: true },
  { x: 832, y: 44, radiusWorld: LIGHT_RADIUS_WORLD, warmHex: LIGHT_WARM_HEX, warmCss: LIGHT_WARM_CSS, flicker: true },
];

/**
 * Static light set for an arena name; unknown values fall back to kilima
 * (the menu default) so headless renderers never draw an empty set.
 * Returns a copy so callers cannot mutate the registry.
 */
export function lightsForMap(name: unknown): Light[] {
  if (typeof name === "string") {
    const key = name.trim().toLowerCase();
    if (key === "dune") {
      return DUNE_LIGHTS.map((light) => ({ ...light }));
    }
    if (key === "frostbite") {
      return FROSTBITE_LIGHTS.map((light) => ({ ...light }));
    }
    if (key === "kilima") {
      return KILIMA_LIGHTS.map((light) => ({ ...light }));
    }
  }
  return KILIMA_LIGHTS.map((light) => ({ ...light }));
}

/**
 * Per-light effective alpha at a wall-clock stamp: steady lights read 1
 * while flicker lights swing LIGHT_FLICKER_BASE +/- LIGHT_FLICKER_AMP
 * across LIGHT_FLICKER_MS (t=0 vs t=1500ms sit near opposite phase).
 * Non-finite stamps read 1 so bad clocks never blank a pool.
 */
export function lightAlphaAt(
  light: Light | null | undefined,
  nowMs: number,
): number {
  if (light === null || light === undefined || light.flicker !== true) {
    return 1;
  }
  if (!Number.isFinite(nowMs)) {
    return 1;
  }
  return (
    LIGHT_FLICKER_BASE +
    LIGHT_FLICKER_AMP * Math.sin((2 * Math.PI * nowMs) / LIGHT_FLICKER_MS)
  );
}

/**
 * Quality cap for a light list: high paints every light, low paints at
 * most the first LOW_LIGHT_CAP (mirrors the parseQuality tolerance:
 * only low variants read low, everything else reads high).
 */
export function lightsForQuality(
  lights: readonly Light[] | null | undefined,
  quality: QualityLevel | unknown,
): Light[] {
  if (!Array.isArray(lights)) {
    return [];
  }
  if (typeof quality === "string" && quality.trim().toLowerCase() === "low") {
    return (lights as readonly Light[]).slice(0, LOW_LIGHT_CAP);
  }
  return (lights as readonly Light[]).slice();
}

/**
 * Cull light pools to the camera view (radius-aware: a pool paints while
 * any of its glow overlaps the visible tile bounds). The visible list
 * drives paint; the registry total stays the probe anchor.
 */
export function culledLights(
  lights: readonly Light[] | null | undefined,
  cam: Camera,
  canvasWidth: number,
  canvasHeight: number,
  arenaWidth: number,
  arenaHeight: number,
): Light[] {
  if (!Array.isArray(lights)) {
    return [];
  }
  const range = visibleTileRange(cam, canvasWidth, canvasHeight, arenaWidth, arenaHeight);
  const x0 = range.x0 * TILE_SIZE;
  const y0 = range.y0 * TILE_SIZE;
  const x1 = (range.x1 + 1) * TILE_SIZE;
  const y1 = (range.y1 + 1) * TILE_SIZE;
  return (lights as readonly Light[]).filter((light) => {
    const r = Number(light.radiusWorld);
    if (!Number.isFinite(r) || r <= 0) {
      return false;
    }
    const x = Number(light.x);
    const y = Number(light.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    return x + r >= x0 && x - r <= x1 && y + r >= y0 && y - r <= y1;
  });
}

/** Minimal Pixi graphics surface (structural, no pixi.js import). */
export interface LightPixiGraphics {
  circle(x: number, y: number, r: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
}

/** True for paintable geometry (finite center, positive screen radius). */
function paintable(
  cx: number,
  cy: number,
  radiusScreen: number,
): boolean {
  return (
    Number.isFinite(cx) &&
    Number.isFinite(cy) &&
    Number.isFinite(radiusScreen) &&
    radiusScreen > 0
  );
}

/**
 * Paint culled lights in Pixi as layered alpha circles (warm outer pool
 * over a pale hot core, mirroring paintGlowHaloPixi). Additive look only:
 * no blend-mode mutation on the shared world graphics. No-op on
 * empty/non-finite input.
 */
export function paintLightsPixi(
  graphics: LightPixiGraphics,
  px: (x: number) => number,
  py: (y: number) => number,
  scale: number,
  lights: readonly Light[] | null | undefined,
  nowMs: number,
): void {
  if (!Array.isArray(lights)) {
    return;
  }
  for (const light of lights) {
    const r = Number(light.radiusWorld) * scale;
    const cx = px(Number(light.x));
    const cy = py(Number(light.y));
    if (!paintable(cx, cy, r)) {
      continue;
    }
    const alpha = lightAlphaAt(light, nowMs);
    graphics.circle(cx, cy, r);
    graphics.fill({ color: Number(light.warmHex), alpha: LIGHT_OUTER_ALPHA * alpha });
    graphics.circle(cx, cy, r * 0.55);
    graphics.fill({ color: Number(light.warmHex), alpha: LIGHT_MID_ALPHA * alpha });
    graphics.circle(cx, cy, Math.max(1, r * 0.25));
    graphics.fill({ color: LIGHT_CORE_HEX, alpha: LIGHT_CORE_ALPHA * alpha });
  }
}

/** Parse a #rrggbb twin into channels (null when malformed). */
function hexChannels(css: unknown): { r: number; g: number; b: number } | null {
  if (typeof css !== "string") {
    return null;
  }
  const match = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (match === null || match[1] === undefined) {
    return null;
  }
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/** CSS rgba() for a twin color at an effective alpha (clamped). */
export function lightRgba(css: unknown, alpha: number): string {
  const channels = hexChannels(css);
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  if (channels === null) {
    return `rgba(255, 180, 107, ${a})`;
  }
  return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${a})`;
}

/**
 * Paint culled lights on a 2D canvas with "lighter" radial gradients
 * (true additive: the pool brightens whatever tiles/sky sit under it).
 * Saves and restores the composite op and alpha. No-op on
 * empty/non-finite input.
 */
export function paintLights2D(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  scale: number,
  lights: readonly Light[] | null | undefined,
  nowMs: number,
): void {
  if (!Array.isArray(lights)) {
    return;
  }
  const prevComposite = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  try {
    ctx.globalCompositeOperation = "lighter";
    for (const light of lights) {
      const r = Number(light.radiusWorld) * scale;
      const cx = px(Number(light.x));
      const cy = py(Number(light.y));
      if (!paintable(cx, cy, r)) {
        continue;
      }
      const alpha = lightAlphaAt(light, nowMs);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.5, r));
      gradient.addColorStop(0, lightRgba(LIGHT_CORE_CSS, LIGHT_CORE_ALPHA * alpha));
      gradient.addColorStop(0.55, lightRgba(light.warmCss, LIGHT_MID_ALPHA_2D * alpha));
      gradient.addColorStop(1, lightRgba(light.warmCss, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.fill();
    }
  } finally {
    ctx.globalCompositeOperation = prevComposite;
    ctx.globalAlpha = prevAlpha;
  }
}
