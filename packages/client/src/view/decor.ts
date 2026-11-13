// Per-map decoration dressing: static core-data rects painted behind tiles.
// Pure (no DOM, no Pixi): palette, tolerant map resolution, occlusion
// counting, camera culling, and dual Pixi/canvas2d shape painters share one
// model so headless tests drive the same contract the renderer paints.
// Decorations are static (no animation state) to hold the 60 fps budget;
// DECOR_Z matches BACKWALL_Z (painted before solids, never covering them).
import { TILE_SIZE } from "../../../core/src/map";
import { visibleTileRange, type Camera } from "../renderer/camera";
import { decorationsFor } from "../maps";

/** Static decoration rect in world px (y-down, carried by core map data). */
export interface Decoration {
  /** Decoration kind key (per-kind palette below). */
  kind: string;
  /** Left edge in world px. */
  x: number;
  /** Top edge in world px. */
  y: number;
  /** Width in world px. */
  w: number;
  /** Height in world px. */
  h: number;
}

/** Decoration render order (same plane as BACKWALL_Z, painted first). */
export const DECOR_Z = 0;

/** Minimal solid query (TileMap compatible) for occlusion counting. */
export interface SolidQuery {
  isSolidTile(tx: number, ty: number): boolean;
}

/** Twin hex/CSS paint for one decoration kind. */
export interface DecorPaint {
  fillHex: number;
  fillCss: string;
  accentHex: number;
  accentCss: string;
}

/** Per-kind decor palette (hex + CSS twins). */
const DECOR_PALETTE: Record<string, DecorPaint> = {
  "sandbags": { fillHex: 0xa08c5b, fillCss: "#a08c5b", accentHex: 0x7a6a44, accentCss: "#7a6a44" },
  "antenna-mast": { fillHex: 0x6b7280, fillCss: "#6b7280", accentHex: 0xef4444, accentCss: "#ef4444" },
  "watchtower": { fillHex: 0x8b5a2b, fillCss: "#8b5a2b", accentHex: 0x5c3a1a, accentCss: "#5c3a1a" },
  "pipes": { fillHex: 0x9ca3af, fillCss: "#9ca3af", accentHex: 0x4b5563, accentCss: "#4b5563" },
  "vats": { fillHex: 0xb45309, fillCss: "#b45309", accentHex: 0x78350f, accentCss: "#78350f" },
  "catwalk-rails": { fillHex: 0x4b5563, fillCss: "#4b5563", accentHex: 0x9ca3af, accentCss: "#9ca3af" },
  "ice-sheen": { fillHex: 0xbae6fd, fillCss: "#bae6fd", accentHex: 0x7dd3fc, accentCss: "#7dd3fc" },
  "antenna-dishes": { fillHex: 0xe0f2fe, fillCss: "#e0f2fe", accentHex: 0x0284c7, accentCss: "#0284c7" },
  "window-lights": { fillHex: 0x1f2937, fillCss: "#1f2937", accentHex: 0xfde68a, accentCss: "#fde68a" },
};

/** Fallback paint for unknown kinds (neutral slate). */
const DEFAULT_PAINT: DecorPaint = {
  fillHex: 0x64748b,
  fillCss: "#64748b",
  accentHex: 0x334155,
  accentCss: "#334155",
};

/**
 * Paint for one decoration kind (case-insensitive, trims whitespace);
 * unknown kinds fall back to neutral slate so bad data never crashes paint.
 */
export function decorPaintFor(kind: unknown): DecorPaint {
  if (typeof kind === "string") {
    const paint = DECOR_PALETTE[kind.trim().toLowerCase()];
    if (paint !== undefined) {
      return { ...paint };
    }
  }
  return { ...DEFAULT_PAINT };
}

/**
 * Decoration set for an arena name; unknown values fall back to kilima
 * (the menu default) so headless renderers never draw an empty set.
 * Returns a copy so callers cannot mutate the registry.
 */
export function decorationsForMap(name: unknown): Decoration[] {
  const direct = decorationsFor(name);
  if (direct !== null) {
    return direct as Decoration[];
  }
  return (decorationsFor("kilima") ?? []) as Decoration[];
}

/**
 * True when a decoration rect touches any solid tile. Ranges are
 * exclusive on the bottom/right edge, matching tile collision math.
 * Null maps and empty rects never occlude.
 */
export function isDecorOccluded(
  decor: Decoration | null | undefined,
  map: SolidQuery | null | undefined,
): boolean {
  if (decor === null || decor === undefined || map === null || map === undefined) {
    return false;
  }
  const w = Number(decor.w);
  const h = Number(decor.h);
  if (!(w > 0 && h > 0)) {
    return false;
  }
  try {
    const tx0 = Math.floor(Number(decor.x) / TILE_SIZE);
    const tx1 = Math.floor((Number(decor.x) + w - 1) / TILE_SIZE);
    const ty0 = Math.floor(Number(decor.y) / TILE_SIZE);
    const ty1 = Math.floor((Number(decor.y) + h - 1) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        if (map.isSolidTile(tx, ty) === true) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Count of decoration rects intersecting any solid tile (one per
 * occluding rect, not per tile). Placement plus the renderer's defensive
 * skip keeps this 0 on the shipped arenas.
 */
export function countOccludedTiles(
  decors: readonly Decoration[] | null | undefined,
  map: SolidQuery | null | undefined,
): number {
  if (!Array.isArray(decors)) {
    return 0;
  }
  let occluded = 0;
  for (const decor of decors) {
    if (isDecorOccluded(decor, map)) {
      occluded += 1;
    }
  }
  return occluded;
}

/**
 * Cull decoration rects to the camera view (visible-tile pixel bounds).
 * The visible list drives paint; the registry total drives the
 * `decorationCount` probe so an off-screen set still counts.
 */
export function visibleDecorations(
  decors: readonly Decoration[] | null | undefined,
  cam: Camera,
  canvasWidth: number,
  canvasHeight: number,
  arenaWidth: number,
  arenaHeight: number,
): Decoration[] {
  if (!Array.isArray(decors)) {
    return [];
  }
  const range = visibleTileRange(cam, canvasWidth, canvasHeight, arenaWidth, arenaHeight);
  const x0 = range.x0 * TILE_SIZE;
  const y0 = range.y0 * TILE_SIZE;
  const x1 = (range.x1 + 1) * TILE_SIZE;
  const y1 = (range.y1 + 1) * TILE_SIZE;
  return (decors as readonly Decoration[]).filter(
    (decor) => decor.x < x1 && decor.x + decor.w > x0 && decor.y < y1 && decor.y + decor.h > y0,
  );
}

/** Minimal Pixi Graphics surface (structural, no pixi.js import). */
export interface DecorPixiGraphics {
  rect(x: number, y: number, w: number, h: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
  circle(x: number, y: number, r: number): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(style?: { width?: number; color?: number; alpha?: number; cap?: "butt" | "round" | "square" }): unknown;
}

/** Paint one decoration in Pixi (rects/circles/lines only, behind solids). */
function paintOnePixi(
  graphics: DecorPixiGraphics,
  sx: number,
  sy: number,
  w: number,
  h: number,
  scale: number,
  kind: string,
  paint: DecorPaint,
): void {
  const bar = Math.max(1, scale);
  if (kind === "sandbags") {
    graphics.rect(sx, sy, w, h);
    graphics.fill(paint.fillHex);
    for (let i = 0; i < 3; i += 1) {
      graphics.circle(sx + (w * (i + 0.5)) / 3, sy, Math.max(1.5, h * 0.35));
      graphics.fill(paint.accentHex);
    }
    graphics.rect(sx, sy + h - bar, w, bar);
    graphics.fill(paint.accentHex);
  } else if (kind === "antenna-mast") {
    const cx = sx + w / 2;
    graphics.moveTo(cx, sy);
    graphics.lineTo(cx, sy + h);
    graphics.stroke({ width: Math.max(1, 2 * scale), color: paint.fillHex });
    for (const f of [0.3, 0.6]) {
      const cy = sy + h * f;
      graphics.moveTo(cx - w, cy);
      graphics.lineTo(cx + w, cy);
      graphics.stroke({ width: bar, color: paint.accentHex });
    }
  } else if (kind === "watchtower") {
    const legW = Math.max(1.5, 4 * scale);
    graphics.rect(sx, sy + h * 0.25, w, h * 0.2);
    graphics.fill(paint.accentHex);
    graphics.rect(sx, sy + h * 0.45, legW, h * 0.55);
    graphics.fill(paint.fillHex);
    graphics.rect(sx + w - legW, sy + h * 0.45, legW, h * 0.55);
    graphics.fill(paint.fillHex);
    graphics.rect(sx, sy, w, Math.max(2, 5 * scale));
    graphics.fill(paint.fillHex);
  } else if (kind === "pipes") {
    graphics.rect(sx, sy, w, h * 0.42);
    graphics.fill(paint.fillHex);
    graphics.rect(sx, sy + h * 0.58, w, h * 0.42);
    graphics.fill(paint.fillHex);
    graphics.rect(sx, sy + h * 0.42, w, h * 0.16);
    graphics.fill(paint.accentHex);
  } else if (kind === "vats") {
    const vw = w / 2;
    for (let i = 0; i < 2; i += 1) {
      const vx = sx + i * vw;
      graphics.rect(vx + 1, sy + h * 0.15, vw - 2, h * 0.85);
      graphics.fill(paint.fillHex);
      graphics.circle(vx + vw / 2, sy + h * 0.15, Math.max(1.5, (vw - 2) / 2));
      graphics.fill(paint.accentHex);
    }
  } else if (kind === "catwalk-rails") {
    for (const f of [0.2, 0.8]) {
      graphics.moveTo(sx, sy + h * f);
      graphics.lineTo(sx + w, sy + h * f);
      graphics.stroke({ width: bar, color: paint.fillHex });
    }
    const postW = Math.max(1, 2 * scale);
    for (let i = 0; i <= 4; i += 1) {
      graphics.rect(sx + (w * i) / 4 - postW / 2, sy, postW, h);
      graphics.fill(paint.accentHex);
    }
  } else if (kind === "ice-sheen") {
    graphics.rect(sx, sy, w, h);
    graphics.fill(paint.fillHex);
    graphics.rect(sx, sy + h * 0.6, w, h * 0.4);
    graphics.fill(paint.accentHex);
  } else if (kind === "antenna-dishes") {
    graphics.moveTo(sx + w / 2, sy + h);
    graphics.lineTo(sx + w / 2, sy + h * 0.3);
    graphics.stroke({ width: Math.max(1, 2 * scale), color: paint.fillHex });
    graphics.circle(sx + w * 0.3, sy + h * 0.3, Math.max(1.5, 6 * scale));
    graphics.fill(paint.accentHex);
    graphics.circle(sx + w * 0.7, sy + h * 0.45, Math.max(1.5, 4 * scale));
    graphics.fill(paint.accentHex);
  } else if (kind === "window-lights") {
    graphics.rect(sx, sy, w, h);
    graphics.fill(paint.fillHex);
    for (let i = 0; i < 4; i += 1) {
      graphics.circle(sx + (w * (i + 0.5)) / 4, sy + h / 2, Math.max(1.5, 3 * scale));
      graphics.fill(paint.accentHex);
    }
  } else {
    graphics.rect(sx, sy, w, h);
    graphics.fill(paint.fillHex);
  }
}

/**
 * Paint culled decorations in Pixi behind the tile layers. Static shapes
 * only (no per-frame state) so the fps budget holds with decorations on.
 */
export function paintDecorPixi(
  graphics: DecorPixiGraphics,
  px: (x: number) => number,
  py: (y: number) => number,
  scale: number,
  decors: readonly Decoration[] | null | undefined,
): void {
  if (!Array.isArray(decors)) {
    return;
  }
  for (const decor of decors) {
    if (!(decor.w > 0 && decor.h > 0)) {
      continue;
    }
    paintOnePixi(
      graphics,
      px(decor.x),
      py(decor.y),
      decor.w * scale,
      decor.h * scale,
      scale,
      typeof decor.kind === "string" ? decor.kind.trim().toLowerCase() : "",
      decorPaintFor(decor.kind),
    );
  }
}

/** Paint one decoration on a 2D canvas (mirrors paintOnePixi). */
function paintOne2D(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  w: number,
  h: number,
  scale: number,
  kind: string,
  paint: DecorPaint,
): void {
  const bar = Math.max(1, scale);
  if (kind === "sandbags") {
    ctx.fillStyle = paint.fillCss;
    ctx.fillRect(sx, sy, w, h);
    ctx.fillStyle = paint.accentCss;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(sx + (w * (i + 0.5)) / 3, sy, Math.max(1.5, h * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(sx, sy + h - bar, w, bar);
  } else if (kind === "antenna-mast") {
    const cx = sx + w / 2;
    ctx.strokeStyle = paint.fillCss;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.beginPath();
    ctx.moveTo(cx, sy);
    ctx.lineTo(cx, sy + h);
    ctx.stroke();
    ctx.strokeStyle = paint.accentCss;
    ctx.lineWidth = bar;
    for (const f of [0.3, 0.6]) {
      const cy = sy + h * f;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy);
      ctx.lineTo(cx + w, cy);
      ctx.stroke();
    }
  } else if (kind === "watchtower") {
    const legW = Math.max(1.5, 4 * scale);
    ctx.fillStyle = paint.accentCss;
    ctx.fillRect(sx, sy + h * 0.25, w, h * 0.2);
    ctx.fillStyle = paint.fillCss;
    ctx.fillRect(sx, sy + h * 0.45, legW, h * 0.55);
    ctx.fillRect(sx + w - legW, sy + h * 0.45, legW, h * 0.55);
    ctx.fillRect(sx, sy, w, Math.max(2, 5 * scale));
  } else if (kind === "pipes") {
    ctx.fillStyle = paint.fillCss;
    ctx.fillRect(sx, sy, w, h * 0.42);
    ctx.fillRect(sx, sy + h * 0.58, w, h * 0.42);
    ctx.fillStyle = paint.accentCss;
    ctx.fillRect(sx, sy + h * 0.42, w, h * 0.16);
  } else if (kind === "vats") {
    const vw = w / 2;
    for (let i = 0; i < 2; i += 1) {
      const vx = sx + i * vw;
      ctx.fillStyle = paint.fillCss;
      ctx.fillRect(vx + 1, sy + h * 0.15, vw - 2, h * 0.85);
      ctx.fillStyle = paint.accentCss;
      ctx.beginPath();
      ctx.arc(vx + vw / 2, sy + h * 0.15, Math.max(1.5, (vw - 2) / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "catwalk-rails") {
    ctx.strokeStyle = paint.fillCss;
    ctx.lineWidth = bar;
    for (const f of [0.2, 0.8]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy + h * f);
      ctx.lineTo(sx + w, sy + h * f);
      ctx.stroke();
    }
    const postW = Math.max(1, 2 * scale);
    ctx.fillStyle = paint.accentCss;
    for (let i = 0; i <= 4; i += 1) {
      ctx.fillRect(sx + (w * i) / 4 - postW / 2, sy, postW, h);
    }
  } else if (kind === "ice-sheen") {
    ctx.fillStyle = paint.fillCss;
    ctx.fillRect(sx, sy, w, h);
    ctx.fillStyle = paint.accentCss;
    ctx.fillRect(sx, sy + h * 0.6, w, h * 0.4);
  } else if (kind === "antenna-dishes") {
    ctx.strokeStyle = paint.fillCss;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.beginPath();
    ctx.moveTo(sx + w / 2, sy + h);
    ctx.lineTo(sx + w / 2, sy + h * 0.3);
    ctx.stroke();
    ctx.fillStyle = paint.accentCss;
    ctx.beginPath();
    ctx.arc(sx + w * 0.3, sy + h * 0.3, Math.max(1.5, 6 * scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx + w * 0.7, sy + h * 0.45, Math.max(1.5, 4 * scale), 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "window-lights") {
    ctx.fillStyle = paint.fillCss;
    ctx.fillRect(sx, sy, w, h);
    ctx.fillStyle = paint.accentCss;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.arc(sx + (w * (i + 0.5)) / 4, sy + h / 2, Math.max(1.5, 3 * scale), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = paint.fillCss;
    ctx.fillRect(sx, sy, w, h);
  }
}

/** Paint culled decorations on a 2D canvas (mirrors paintDecorPixi). */
export function paintDecor2D(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  scale: number,
  decors: readonly Decoration[] | null | undefined,
): void {
  if (!Array.isArray(decors)) {
    return;
  }
  for (const decor of decors) {
    if (!(decor.w > 0 && decor.h > 0)) {
      continue;
    }
    paintOne2D(
      ctx,
      px(decor.x),
      py(decor.y),
      decor.w * scale,
      decor.h * scale,
      scale,
      typeof decor.kind === "string" ? decor.kind.trim().toLowerCase() : "",
      decorPaintFor(decor.kind),
    );
  }
}
