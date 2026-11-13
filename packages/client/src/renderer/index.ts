// Client view-model and renderer: pure frame description plus an async
// renderer that prefers the locally bundled PixiJS v8 and falls back to a
// 2D canvas backend drawing the same ops (headless browsers may lack
// WebGL). No external image assets — vector shapes only. All paint goes
// through the follow-camera projection; the renderer owns fps metering,
// capped event flashes, and the window.__scraplineDebug mirror.

import {
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "../../../core/src/constants";
import { TILE_SIZE } from "../../../core/src/map";
import type {
  Pickup,
  Player,
  Projectile,
  Prop,
} from "../../../core/src/entities";
import type { DamageDetail, KillDetail, ShotDetail } from "../../../core/src/events";
import {
  createCamera,
  projectCamera,
  visibleTileRange,
  type Camera,
} from "./camera";

export { CAMERA_ZOOM } from "./camera";

/** Default arena tiles (mirrors World's defaultRows: 40 wide, 20 tall). */
const DEFAULT_ARENA_TILES_W = 40;
const DEFAULT_ARENA_TILES_H = 20;
/** Event-flash lifetime in draws. */
const FLASH_TTL = 10;
/** Cap on live event flashes (oldest dropped first). */
const MAX_FLASHES = 24;
/** Tracer line lifetime in draws (~150ms at 60 fps). */
export const TRACER_TTL = 9;
/** Muzzle-flash lifetime in draws (the required 1-2 frames). */
export const MUZZLE_TTL = 2;
/** Cap on live tracer lines (oldest dropped first). */
export const MAX_TRACERS = 32;
/** Cap on live muzzle flashes (oldest dropped first). */
export const MAX_MUZZLES = 8;
/** Impact-spark lifetime in draws (~150ms at 60 fps). */
export const SPARK_TTL = 9;
/** Death-burst lifetime in draws (~300ms at 60 fps). */
export const BURST_TTL = 18;
/** Victim red-tint lifetime in draws (~200ms at 60 fps). */
export const VICTIM_TTL = 12;
/** Cap on live impact sparks (oldest dropped first). */
export const MAX_SPARKS = 96;
/** Cap on live death-burst particles (oldest dropped first). */
export const MAX_BURSTS = 64;
/** Sparks spawned per damage detail (above the >=3 probe floor). */
export const SPARKS_PER_HIT = 6;
/** Particles spawned per kill detail (above the >=8 probe floor). */
export const BURST_PER_KILL = 12;
/** Victim-hit tint in Pixi hex while a victim flash is live. */
export const VICTIM_TINT = 0xff0000;
/** Victim-hit tint in CSS while a victim flash is live. */
export const VICTIM_TINT_CSS = "#ff0000";
/** FPS exponential-moving-average weight per draw. */
const FPS_ALPHA = 0.1;

/** Minimal arena shape (TileMap compatible). */
export interface MapLike {
  readonly widthPixels: number;
  readonly heightPixels: number;
}

/** Arena shape with integer tile queries (TileMap compatible). */
export interface TileMapLike extends MapLike {
  readonly widthTiles: number;
  readonly heightTiles: number;
  isSolidTile(tx: number, ty: number): boolean;
}

/** Minimal world-state shape (World.state compatible). */
export interface StateLike {
  readonly tick: number;
  readonly players: readonly Player[];
  readonly projectiles: readonly Projectile[];
  readonly pickups: readonly Pickup[];
  readonly props: readonly Prop[];
}

/** Player box for one frame. */
export interface FramePlayer {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  aim: number;
  alive: boolean;
  onGround: boolean;
  /** True while the jetpack is thrusting this frame. */
  jetting: boolean;
  /** True while spawn protection is active. */
  protected: boolean;
  /** Barrel tip in world coords (body center + aim dir * BARREL_LENGTH). */
  barrel: { x: number; y: number };
}

/** Projectile dot for one frame. */
export interface FrameProjectile {
  x: number;
  y: number;
  kind: string;
  ownerId: number;
}

/** Pickup marker for one frame. */
export interface FramePickup {
  x: number;
  y: number;
  kind: string;
  active: boolean;
}

/** Prop box for one frame. */
export interface FrameProp {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  alive: boolean;
}

/** Pure per-frame view-model. */
export interface Frame {
  tick: number;
  players: FramePlayer[];
  projectiles: FrameProjectile[];
  pickups: FramePickup[];
  props: FrameProp[];
  arena: { width: number; height: number };
}

/** World-to-screen fit (uniform scale, letterboxed). */
export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Fit an arena into a canvas, preserving aspect ratio. */
export function viewTransform(
  canvasWidth: number,
  canvasHeight: number,
  arenaWidth: number,
  arenaHeight: number,
): ViewTransform {
  const scale = Math.min(canvasWidth / arenaWidth, canvasHeight / arenaHeight);
  return {
    scale,
    offsetX: (canvasWidth - arenaWidth * scale) / 2,
    offsetY: (canvasHeight - arenaHeight * scale) / 2,
  };
}

/** Map one world point through a view transform. */
export function worldToScreen(
  x: number,
  y: number,
  transform: ViewTransform,
): { x: number; y: number } {
  return { x: x * transform.scale + transform.offsetX, y: y * transform.scale + transform.offsetY };
}

/**
 * Barrel length in world px. At the fixed CAMERA_ZOOM = 2 this renders
 * as 16 screen px, centered in the required 8-20px band under either
 * a screen-pixel or a world-unit reading.
 */
export const BARREL_LENGTH = 8;

/** Barrel tip from a body center along an aim angle (canvas y-down). */
export function barrelEndpoint(
  centerX: number,
  centerY: number,
  aim: number,
  length: number = BARREL_LENGTH,
): { x: number; y: number } {
  return { x: centerX + Math.cos(aim) * length, y: centerY + Math.sin(aim) * length };
}

/**
 * Build the pure view-model from a world state. Accepts an explicit map
 * (TileMap compatible) or falls back to the default arena dims; never
 * touches the DOM, so it stays unit-testable under node.
 */
export function describeFrame(state: StateLike, map?: MapLike | null): Frame {
  const arena =
    map !== undefined && map !== null
      ? { width: map.widthPixels, height: map.heightPixels }
      : {
          width: DEFAULT_ARENA_TILES_W * TILE_SIZE,
          height: DEFAULT_ARENA_TILES_H * TILE_SIZE,
        };
  return {
    tick: state.tick,
    players: state.players.map((p, index) => {
      const w = PLAYER_WIDTH;
      const h = p.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
      const cx = p.x + w / 2;
      const cy = p.y + h / 2;
      return {
        index,
        x: p.x,
        y: p.y,
        w,
        h,
        aim: p.aim,
        alive: p.alive,
        onGround: p.onGround,
        jetting: p.jetting === true,
        protected: (p.protectionTicks ?? 0) > 0,
        barrel: barrelEndpoint(cx, cy, p.aim),
      };
    }),
    projectiles: state.projectiles.map((p) => ({
      x: p.x,
      y: p.y,
      kind: p.kind,
      ownerId: p.ownerId,
    })),
    pickups: state.pickups.map((p) => ({
      x: p.x,
      y: p.y,
      kind: p.kind,
      active: p.active,
    })),
    props: state.props.map((p) => ({
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      kind: p.kind,
      alive: p.alive,
    })),
    arena,
  };
}

/** Renderer handle returned by createRenderer. */
export interface Renderer {
  /**
   * Draw one world state through the camera (map optional, defaults
   * like describeFrame; camera defaults to arena-centered; events
   * feed capped fx flashes, shots feed hitscan tracers/muzzle
   * flashes, damages feed impact sparks plus victim tint, kills feed
   * death bursts).
   */
  draw(
    state: StateLike,
    map?: MapLike | TileMapLike | null,
    camera?: Camera | null,
    events?: string[],
    shots?: ShotDetail[],
    damages?: DamageDetail[],
    kills?: KillDetail[],
  ): void;
  /** Which backend survived init. */
  mode: "pixi" | "canvas2d";
  /** Live-update the renderer density (DPR-driven, clamped). */
  setResolution(dpr: number): void;
}

/** One capped transient fx flash in world coords. */
interface Flash {
  x: number;
  y: number;
  kind: "explode" | "bounce" | "shot";
  ttl: number;
}

/** One fading hitscan tracer line in world coords. */
export interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  ttl: number;
  life: number;
}

/** One short-lived muzzle flash in world coords. */
export interface Muzzle {
  x: number;
  y: number;
  ttl: number;
  life: number;
}

/** One impact spark in world coords (static offset, fades out). */
export interface Spark {
  x: number;
  y: number;
  ttl: number;
  life: number;
}

/** One death-burst particle: origin plus radial velocity in world px per draw. */
export interface Burst {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  life: number;
}

/** Solid tile cell to paint. */
interface TileCell {
  tx: number;
  ty: number;
}

/** Shared layer counts so Pixi and canvas2d report identically. */
interface LayerCounts {
  tiles: TileCell[];
  tilesDrawn: number;
  entitiesDrawn: number;
}

/**
 * Cull solid tiles to the camera view and count drawable layers.
 * Without a tile map (pre-match splash), the default arena's bottom
 * two rows read solid, mirroring World's defaultRows.
 */
function collectLayers(
  frame: Frame,
  map: MapLike | TileMapLike | null | undefined,
  cam: Camera,
  canvasWidth: number,
  canvasHeight: number,
): LayerCounts {
  const tileMap =
    map !== undefined &&
    map !== null &&
    typeof (map as TileMapLike).isSolidTile === "function"
      ? (map as TileMapLike)
      : null;
  const range = visibleTileRange(
    cam,
    canvasWidth,
    canvasHeight,
    frame.arena.width,
    frame.arena.height,
  );
  const fallbackSolidFrom =
    Math.ceil(frame.arena.height / TILE_SIZE) - 2;
  const tiles: TileCell[] = [];
  for (let ty = range.y0; ty <= range.y1; ty += 1) {
    for (let tx = range.x0; tx <= range.x1; tx += 1) {
      const solid =
        tileMap !== null ? tileMap.isSolidTile(tx, ty) : ty >= fallbackSolidFrom;
      if (solid) {
        tiles.push({ tx, ty });
      }
    }
  }
  return { tiles, tilesDrawn: tiles.length, entitiesDrawn: frame.players.length };
}

function playerColor(index: number, alive: boolean): number {
  if (!alive) {
    return 0x475569;
  }
  return index === 0 ? 0x00e5ff : 0xfb923c;
}

/** Barrel stroke color: local pale, enemies warm red (threat cue). */
export function barrelColor(index: number): number {
  return index === 0 ? 0xf8fafc : 0xef4444;
}

/** Canvas2D twin of barrelColor. */
export function barrelCss(index: number): string {
  return index === 0 ? "#f8fafc" : "#ef4444";
}

function tileColor(tx: number, ty: number): number {
  return (tx + ty) % 2 === 0 ? 0x16213b : 0x101a30;
}

function tileCss(tx: number, ty: number): string {
  return (tx + ty) % 2 === 0 ? "#16213b" : "#101a30";
}

function flashColor(kind: Flash["kind"]): number {
  if (kind === "explode") {
    return 0xf97316;
  }
  if (kind === "bounce") {
    return 0x22d3ee;
  }
  return 0xfde047;
}

/** Fx radius by kind and age: muzzle dots stay small, blasts grow. */
function flashRadius(kind: Flash["kind"], ttl: number): number {
  const age = FLASH_TTL - ttl;
  if (kind === "shot") {
    return 2 + age;
  }
  if (kind === "bounce") {
    return 3 + age * 2;
  }
  return 4 + age * 3;
}

function flashCss(kind: Flash["kind"]): string {
  if (kind === "explode") {
    return "#f97316";
  }
  if (kind === "bounce") {
    return "#22d3ee";
  }
  return "#fde047";
}

function paintFramePixi(
  graphics: {
    clear(): unknown;
    rect(x: number, y: number, w: number, h: number): unknown;
    fill(style: number | { color?: number; alpha?: number }): unknown;
    circle(x: number, y: number, r: number): unknown;
    moveTo(x: number, y: number): unknown;
    lineTo(x: number, y: number): unknown;
    stroke(style?: { width?: number; color?: number; alpha?: number; cap?: "butt" | "round" | "square" }): unknown;
  },
  frame: Frame,
  cam: Camera,
  layers: LayerCounts,
  flashes: Flash[],
  tracers: Tracer[],
  muzzles: Muzzle[],
  sparks: Spark[],
  bursts: Burst[],
  victimFlash: ReadonlyMap<number, number>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const px = (x: number): number => projectCamera(cam, canvasWidth, canvasHeight, x, 0).x;
  const py = (y: number): number => projectCamera(cam, canvasWidth, canvasHeight, 0, y).y;
  const tileSize = TILE_SIZE * cam.scale;
  graphics.clear();
  graphics.rect(0, 0, canvasWidth, canvasHeight);
  graphics.fill(0x05070f);
  const arena = projectCamera(cam, canvasWidth, canvasHeight, 0, 0);
  graphics.rect(arena.x, arena.y, frame.arena.width * cam.scale, frame.arena.height * cam.scale);
  graphics.fill(0x0b1020);
  for (const cell of layers.tiles) {
    graphics.rect(px(cell.tx * TILE_SIZE), py(cell.ty * TILE_SIZE), tileSize + 1, tileSize + 1);
    graphics.fill(tileColor(cell.tx, cell.ty));
  }
  for (const prop of frame.props) {
    if (!prop.alive) {
      continue;
    }
    graphics.rect(px(prop.x), py(prop.y), prop.w * cam.scale, prop.h * cam.scale);
    graphics.fill(prop.kind === "barrel" ? 0xb45309 : 0x92400e);
  }
  for (const pickup of frame.pickups) {
    if (!pickup.active) {
      continue;
    }
    const color =
      pickup.kind === "weapon" ? 0x22d3ee : pickup.kind === "health" ? 0x22c55e : 0xeab308;
    graphics.rect(px(pickup.x) - 4, py(pickup.y) - 4, 8, 8);
    graphics.fill(color);
  }
  for (const proj of frame.projectiles) {
    graphics.circle(px(proj.x), py(proj.y), Math.max(2, 2 * cam.scale));
    graphics.fill(proj.kind === "grenade" ? 0xa3e635 : 0xf97316);
  }
  for (const p of frame.players) {
    const blink = blinkAlpha(frame.tick, p.protected);
    const bodyColor = playerPaintColor(p.index, p.alive, victimFlash.has(p.index));
    graphics.rect(px(p.x), py(p.y), p.w * cam.scale, p.h * cam.scale);
    graphics.fill({ color: bodyColor, alpha: blink });
    if (p.alive) {
      const cx = px(p.x + p.w / 2);
      const cy = py(p.y + p.h / 2);
      const bodyW = p.w * cam.scale;
      const bodyH = p.h * cam.scale;
      // Visor stripe across the upper body.
      graphics.rect(px(p.x) + bodyW * 0.15, py(p.y) + bodyH * 0.12, bodyW * 0.7, Math.max(2, bodyH * 0.14));
      graphics.fill({ color: 0x0f172a, alpha: blink });
      // Jetpack unit on the back (left edge of the body).
      graphics.rect(px(p.x) - 5 * cam.scale, py(p.y) + bodyH * 0.25, 5 * cam.scale, bodyH * 0.4);
      graphics.fill({ color: 0x334155, alpha: blink });
      // Held-weapon silhouette under the barrel line: dark stock
      // from the body center to the gun midpoint, then the bright
      // barrel stroke from the midpoint to the unchanged tip.
      const mid = gunMidpoint(p.x + p.w / 2, p.y + p.h / 2, p.aim);
      const midScreen = { x: px(mid.x), y: py(mid.y) };
      const tip = { x: px(p.barrel.x), y: py(p.barrel.y) };
      graphics.moveTo(cx, cy);
      graphics.lineTo(midScreen.x, midScreen.y);
      graphics.stroke({ width: 6, color: 0x1e293b, alpha: blink, cap: "round" });
      graphics.moveTo(midScreen.x, midScreen.y);
      graphics.lineTo(tip.x, tip.y);
      graphics.stroke({ width: 3, color: barrelColor(p.index), alpha: blink, cap: "round" });
      graphics.circle(tip.x, tip.y, 2);
      graphics.fill({ color: barrelColor(p.index), alpha: blink });
      // Jet flame flicker below the feet while thrusting.
      if (p.jetting) {
        const scale = flameScale(frame.tick, p.index);
        const flame = flameAlpha(frame.tick, p.index) * blink;
        const feetY = py(p.y + p.h);
        const outer = 5 * scale * cam.scale;
        graphics.circle(cx, feetY + outer + 2, outer);
        graphics.fill({ color: 0xfb923c, alpha: flame });
        const inner = outer * 0.55;
        graphics.circle(cx, feetY + outer + 2, inner);
        graphics.fill({ color: 0xfde047, alpha: flame });
      }
    }
  }
  for (const flash of flashes) {
    graphics.circle(px(flash.x), py(flash.y), flashRadius(flash.kind, flash.ttl));
    graphics.fill(flashColor(flash.kind));
  }
  for (const tracer of tracers) {
    graphics.moveTo(px(tracer.x1), py(tracer.y1));
    graphics.lineTo(px(tracer.x2), py(tracer.y2));
    graphics.stroke({
      width: tracer.width,
      color: 0xfde047,
      alpha: tracerOpacity(tracer),
      cap: "round",
    });
  }
  for (const muzzle of muzzles) {
    graphics.circle(px(muzzle.x), py(muzzle.y), 4);
    graphics.fill({ color: 0xfff7cc, alpha: tracerOpacity(muzzle) });
  }
  for (const spark of sparks) {
    graphics.circle(px(spark.x), py(spark.y), 2);
    graphics.fill({ color: 0xfef08a, alpha: tracerOpacity(spark) });
  }
  for (const burst of bursts) {
    const pos = burstPosition(burst);
    graphics.circle(px(pos.x), py(pos.y), 3);
    graphics.fill({ color: 0xf97316, alpha: tracerOpacity(burst) });
  }
}

function paintFrame2D(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  cam: Camera,
  layers: LayerCounts,
  flashes: Flash[],
  tracers: Tracer[],
  muzzles: Muzzle[],
  sparks: Spark[],
  bursts: Burst[],
  victimFlash: ReadonlyMap<number, number>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const px = (x: number): number => projectCamera(cam, canvasWidth, canvasHeight, x, 0).x;
  const py = (y: number): number => projectCamera(cam, canvasWidth, canvasHeight, 0, y).y;
  const tileSize = TILE_SIZE * cam.scale;
  ctx.fillStyle = "#05070f";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const arena = projectCamera(cam, canvasWidth, canvasHeight, 0, 0);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(arena.x, arena.y, frame.arena.width * cam.scale, frame.arena.height * cam.scale);
  for (const cell of layers.tiles) {
    ctx.fillStyle = tileCss(cell.tx, cell.ty);
    ctx.fillRect(px(cell.tx * TILE_SIZE), py(cell.ty * TILE_SIZE), tileSize + 1, tileSize + 1);
  }
  for (const prop of frame.props) {
    if (!prop.alive) {
      continue;
    }
    ctx.fillStyle = prop.kind === "barrel" ? "#b45309" : "#92400e";
    ctx.fillRect(px(prop.x), py(prop.y), prop.w * cam.scale, prop.h * cam.scale);
  }
  for (const pickup of frame.pickups) {
    if (!pickup.active) {
      continue;
    }
    ctx.fillStyle =
      pickup.kind === "weapon" ? "#22d3ee" : pickup.kind === "health" ? "#22c55e" : "#eab308";
    ctx.fillRect(px(pickup.x) - 4, py(pickup.y) - 4, 8, 8);
  }
  for (const proj of frame.projectiles) {
    ctx.fillStyle = proj.kind === "grenade" ? "#a3e635" : "#f97316";
    ctx.beginPath();
    ctx.arc(px(proj.x), py(proj.y), Math.max(2, 2 * cam.scale), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of frame.players) {
    const blink = blinkAlpha(frame.tick, p.protected);
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.fillStyle = playerPaintCss(p.index, p.alive, victimFlash.has(p.index));
    ctx.fillRect(px(p.x), py(p.y), p.w * cam.scale, p.h * cam.scale);
    if (p.alive) {
      const cx = px(p.x + p.w / 2);
      const cy = py(p.y + p.h / 2);
      const bodyW = p.w * cam.scale;
      const bodyH = p.h * cam.scale;
      // Visor stripe across the upper body.
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(px(p.x) + bodyW * 0.15, py(p.y) + bodyH * 0.12, bodyW * 0.7, Math.max(2, bodyH * 0.14));
      // Jetpack unit on the back (left edge of the body).
      ctx.fillStyle = "#334155";
      ctx.fillRect(px(p.x) - 5 * cam.scale, py(p.y) + bodyH * 0.25, 5 * cam.scale, bodyH * 0.4);
      // Held-weapon silhouette under the barrel line.
      const mid = gunMidpoint(p.x + p.w / 2, p.y + p.h / 2, p.aim);
      const midX = px(mid.x);
      const midY = py(mid.y);
      const tipX = px(p.barrel.x);
      const tipY = py(p.barrel.y);
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(midX, midY);
      ctx.stroke();
      ctx.strokeStyle = barrelCss(p.index);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = barrelCss(p.index);
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
      ctx.fill();
      // Jet flame flicker below the feet while thrusting.
      if (p.jetting) {
        const scale = flameScale(frame.tick, p.index);
        ctx.globalAlpha = blink * flameAlpha(frame.tick, p.index);
        const feetY = py(p.y + p.h);
        const outer = 5 * scale * cam.scale;
        ctx.fillStyle = "#fb923c";
        ctx.beginPath();
        ctx.arc(cx, feetY + outer + 2, outer, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fde047";
        ctx.beginPath();
        ctx.arc(cx, feetY + outer + 2, outer * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  for (const flash of flashes) {
    const radius = flashRadius(flash.kind, flash.ttl);
    ctx.fillStyle = flashCss(flash.kind);
    ctx.beginPath();
    ctx.arc(px(flash.x), py(flash.y), radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const tracer of tracers) {
    ctx.save();
    ctx.globalAlpha = tracerOpacity(tracer);
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = tracer.width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px(tracer.x1), py(tracer.y1));
    ctx.lineTo(px(tracer.x2), py(tracer.y2));
    ctx.stroke();
    ctx.restore();
  }
  for (const muzzle of muzzles) {
    ctx.save();
    ctx.globalAlpha = tracerOpacity(muzzle);
    ctx.fillStyle = "#fff7cc";
    ctx.beginPath();
    ctx.arc(px(muzzle.x), py(muzzle.y), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const spark of sparks) {
    ctx.save();
    ctx.globalAlpha = tracerOpacity(spark);
    ctx.fillStyle = "#fef08a";
    ctx.beginPath();
    ctx.arc(px(spark.x), py(spark.y), 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const burst of bursts) {
    const pos = burstPosition(burst);
    ctx.save();
    ctx.globalAlpha = tracerOpacity(burst);
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(px(pos.x), py(pos.y), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Feed step events into capped transient flashes anchored near the action. */
function pushFlashes(flashes: Flash[], frame: Frame, events: string[]): void {
  if (events.length === 0) {
    return;
  }
  const local = frame.players[0];
  const anchorX =
    local !== undefined
      ? local.x + local.w / 2
      : frame.arena.width / 2;
  const anchorY =
    local !== undefined
      ? local.y + local.h / 2
      : frame.arena.height / 2;
  for (const event of events) {
    if (event !== "explode" && event !== "bounce" && event !== "shot") {
      continue;
    }
    if (event === "shot" && local !== undefined && local.alive) {
      const edge = local.w / 2 + 4;
      flashes.push({
        x: local.x + local.w / 2 + Math.cos(local.aim) * edge,
        y: local.y + local.h / 2 + Math.sin(local.aim) * edge,
        kind: "shot",
        ttl: FLASH_TTL,
      });
    } else {
      flashes.push({ x: anchorX, y: anchorY, kind: event, ttl: FLASH_TTL });
    }
    while (flashes.length > MAX_FLASHES) {
      flashes.shift();
    }
  }
}

/** Pixi-hex paint color for a player: victim red while flashing, else the role color. */
export function playerPaintColor(
  index: number,
  alive: boolean,
  flashed: boolean,
): number {
  if (flashed) {
    return VICTIM_TINT;
  }
  return playerColor(index, alive);
}

/** CSS paint color for a player: victim red while flashing, else the role color. */
export function playerPaintCss(index: number, alive: boolean, flashed: boolean): string {
  if (flashed) {
    return VICTIM_TINT_CSS;
  }
  return !alive ? "#475569" : index === 0 ? "#00e5ff" : "#fb923c";
}

/** Jet-flame flicker scale band (multiplies the base flame radius). */
export const FLAME_SCALE_MIN = 0.7;
export const FLAME_SCALE_MAX = 1.4;
/** Jet-flame flicker opacity band. */
export const FLAME_ALPHA_MIN = 0.65;
export const FLAME_ALPHA_MAX = 0.99;
/** Spawn-blink half-period in ticks (opacity toggles each period). */
export const BLINK_PERIOD_TICKS = 6;
/** Spawn-blink dim opacity (bright phase is 1). */
export const BLINK_DIM_ALPHA = 0.25;
/** Gun-silhouette fraction of BARREL_LENGTH (tip math in barrelEndpoint untouched). */
export const GUN_SILHOUETTE_FRACTION = 0.55;

/**
 * Jet-flame flicker scale for a tick/player. Integer-hash noise in
 * [FLAME_SCALE_MIN, FLAME_SCALE_MAX]; the +61 mod-100 step keeps any
 * 3 consecutive ticks non-constant. Pure: no DOM, no clock.
 */
export function flameScale(tick: number, index: number): number {
  const h = (Math.imul(tick, 2654435761) + Math.imul(index + 1, 40503)) >>> 0;
  return FLAME_SCALE_MIN + ((h % 100) / 100) * (FLAME_SCALE_MAX - FLAME_SCALE_MIN);
}

/**
 * Jet-flame flicker opacity for a tick/player. Integer-hash noise in
 * [FLAME_ALPHA_MIN, FLAME_ALPHA_MAX]; the +19 mod-100 step keeps any
 * 3 consecutive ticks non-constant. Pure: no DOM, no clock.
 */
export function flameAlpha(tick: number, index: number): number {
  const h = (Math.imul(tick, 2246822519) + Math.imul(index + 1, 32661)) >>> 0;
  return FLAME_ALPHA_MIN + ((h % 100) / 100) * (FLAME_ALPHA_MAX - FLAME_ALPHA_MIN);
}

/**
 * Spawn-protection blink opacity: 1 when unprotected, else toggles
 * between 1 and BLINK_DIM_ALPHA every BLINK_PERIOD_TICKS. Tick-derived
 * (not wall-clock) so headless/frame-stepped probes observe it.
 */
export function blinkAlpha(tick: number, isProtected: boolean): number {
  if (!isProtected) {
    return 1;
  }
  return Math.floor(tick / BLINK_PERIOD_TICKS) % 2 === 0 ? 1 : BLINK_DIM_ALPHA;
}

/** Gun-silhouette endpoint: body center + aim dir * BARREL_LENGTH * fraction. */
export function gunMidpoint(
  centerX: number,
  centerY: number,
  aim: number,
): { x: number; y: number } {
  const length = BARREL_LENGTH * GUN_SILHOUETTE_FRACTION;
  return { x: centerX + Math.cos(aim) * length, y: centerY + Math.sin(aim) * length };
}

/** Burst draw position: origin plus radial velocity times lived draws. */
export function burstPosition(burst: Burst): { x: number; y: number } {
  const age = burst.life - burst.ttl;
  return { x: burst.x + burst.vx * age, y: burst.y + burst.vy * age };
}

/** Tracer line width in world px. */
const TRACER_WIDTH = 2;

/** Fade fraction for a tracer or muzzle (post-decrement, so < 1 on frame one). */
export function tracerOpacity(fx: { ttl: number; life: number }): number {
  return Math.max(0, Math.min(1, fx.ttl / fx.life));
}

/**
 * Convert sim shot details into tracer segments (one per pellet) plus
 * one muzzle entry per firing shooter at the barrel tip. Pure: no DOM,
 * no clock, so it stays unit-testable under node.
 */
export function spawnShots(
  tracers: Tracer[],
  muzzles: Muzzle[],
  frame: Frame,
  shots: ShotDetail[],
): void {
  const muzzled = new Set<number>();
  for (const shot of shots) {
    tracers.push({
      x1: shot.ox,
      y1: shot.oy,
      x2: shot.x,
      y2: shot.y,
      width: TRACER_WIDTH,
      ttl: TRACER_TTL,
      life: TRACER_TTL,
    });
    while (tracers.length > MAX_TRACERS) {
      tracers.shift();
    }
    if (!muzzled.has(shot.shooter)) {
      muzzled.add(shot.shooter);
      const shooter = frame.players[shot.shooter];
      const tip =
        shooter !== undefined ? shooter.barrel : { x: shot.ox, y: shot.oy };
      muzzles.push({ x: tip.x, y: tip.y, ttl: MUZZLE_TTL, life: MUZZLE_TTL });
      while (muzzles.length > MAX_MUZZLES) {
        muzzles.shift();
      }
    }
  }
}

/**
 * Convert sim damage details into impact sparks (SPARKS_PER_HIT fixed
 * fan entries per detail, offsets within ±12px of the hit point).
 * Pure: no DOM, no clock, no randomness, so unit-testable under node.
 */
export function spawnSparks(sparks: Spark[], damages: DamageDetail[]): void {
  for (const detail of damages) {
    for (let k = 0; k < SPARKS_PER_HIT; k += 1) {
      const angle = (k / SPARKS_PER_HIT) * Math.PI * 2;
      const dist = 4 + (k % 3) * 4;
      sparks.push({
        x: detail.x + Math.cos(angle) * dist,
        y: detail.y + Math.sin(angle) * dist,
        ttl: SPARK_TTL,
        life: SPARK_TTL,
      });
      while (sparks.length > MAX_SPARKS) {
        sparks.shift();
      }
    }
  }
}

/**
 * Convert sim kill details into death bursts (BURST_PER_KILL radial
 * particles per detail, speeds 2-5 world px per draw). Pure: no DOM,
 * no clock, no randomness, so unit-testable under node.
 */
export function spawnBursts(bursts: Burst[], kills: KillDetail[]): void {
  for (const detail of kills) {
    for (let k = 0; k < BURST_PER_KILL; k += 1) {
      const angle = (k / BURST_PER_KILL) * Math.PI * 2;
      const speed = 2 + (k % 4);
      bursts.push({
        x: detail.x,
        y: detail.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ttl: BURST_TTL,
        life: BURST_TTL,
      });
      while (bursts.length > MAX_BURSTS) {
        bursts.shift();
      }
    }
  }
}

/**
 * Age hit fx one draw: decrement spark/burst TTLs, drop expired
 * entries, and tick down victim red-tint entries. Victim indices with
 * no damage this draw keep counting down from their last hit.
 */
export function ageHitFx(
  sparks: Spark[],
  bursts: Burst[],
  victimFlash: Map<number, number>,
): void {
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i] as Spark;
    spark.ttl -= 1;
    if (spark.ttl <= 0) {
      sparks.splice(i, 1);
    }
  }
  for (let i = bursts.length - 1; i >= 0; i -= 1) {
    const burst = bursts[i] as Burst;
    burst.ttl -= 1;
    if (burst.ttl <= 0) {
      bursts.splice(i, 1);
    }
  }
  for (const [index, ttl] of victimFlash) {
    if (ttl <= 1) {
      victimFlash.delete(index);
    } else {
      victimFlash.set(index, ttl - 1);
    }
  }
}

/** Age fx one draw: decrement TTLs and drop expired entries. */
export function ageFx(tracers: Tracer[], muzzles: Muzzle[]): void {
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    const tracer = tracers[i] as Tracer;
    tracer.ttl -= 1;
    if (tracer.ttl <= 0) {
      tracers.splice(i, 1);
    }
  }
  for (let i = muzzles.length - 1; i >= 0; i -= 1) {
    const muzzle = muzzles[i] as Muzzle;
    muzzle.ttl -= 1;
    if (muzzle.ttl <= 0) {
      muzzles.splice(i, 1);
    }
  }
}

/**
 * Build a renderer for the canvas. PixiJS v8 (`await app.init({canvas})`)
 * is tried first; any failure (notably missing WebGL in headless
 * browsers) falls back to the 2D canvas backend drawing the same ops.
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  // Logical coordinate space (fixed 640x360): captured before init
  // while the canvas still carries the logical size, so a DPR-scaled
  // backing buffer never shifts camera/culling math.
  const logicalW = canvas.width;
  const logicalH = canvas.height;
  let lastNow = 0;
  let fpsEma = 60;
  let activeMode: "pixi" | "canvas2d" = "canvas2d";
  const flashes: Flash[] = [];
  const tracers: Tracer[] = [];
  const muzzles: Muzzle[] = [];
  const sparks: Spark[] = [];
  const bursts: Burst[] = [];
  const victimFlash = new Map<number, number>();

  function trackDraw(
    state: StateLike,
    map: MapLike | TileMapLike | null | undefined,
    camera: Camera | null | undefined,
    events: string[] | undefined,
    shots: ShotDetail[] | undefined,
    damages: DamageDetail[] | undefined,
    kills: KillDetail[] | undefined,
  ): { frame: Frame; cam: Camera; layers: LayerCounts } {
    const frame = describeFrame(state, map ?? null);
    const cam = camera ?? createCamera(frame.arena.width, frame.arena.height);
    const now = performance.now();
    if (lastNow > 0) {
      const dt = (now - lastNow) / 1000;
      if (dt > 0) {
        fpsEma += (1 / dt - fpsEma) * FPS_ALPHA;
      }
    }
    lastNow = now;
    pushFlashes(flashes, frame, events ?? []);
    spawnShots(tracers, muzzles, frame, shots ?? []);
    spawnSparks(sparks, damages ?? []);
    spawnBursts(bursts, kills ?? []);
    for (const detail of damages ?? []) {
      if (detail.victim >= 0) {
        victimFlash.set(detail.victim, VICTIM_TTL);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      const flash = flashes[i] as Flash;
      flash.ttl -= 1;
      if (flash.ttl <= 0) {
        flashes.splice(i, 1);
      }
    }
    ageFx(tracers, muzzles);
    ageHitFx(sparks, bursts, victimFlash);
    const layers = collectLayers(frame, map ?? null, cam, logicalW, logicalH);
    if (typeof window !== "undefined") {
      window.__scraplineDebug = {
        entitiesDrawn: layers.entitiesDrawn,
        tilesDrawn: layers.tilesDrawn,
        cameraX: cam.x,
        cameraY: cam.y,
        fps: Math.round(fpsEma * 10) / 10,
        mode: activeMode,
        barrels: frame.players.map((p) => ({
          index: p.index,
          aim: p.aim,
          x1: p.x + p.w / 2,
          y1: p.y + p.h / 2,
          x2: p.barrel.x,
          y2: p.barrel.y,
        })),
        tracers: tracers.map((t) => ({
          x1: t.x1,
          y1: t.y1,
          x2: t.x2,
          y2: t.y2,
          opacity: tracerOpacity(t),
          width: t.width,
        })),
        muzzle: muzzles.map((m) => ({ x: m.x, y: m.y, ttl: m.ttl })),
        sparks: sparks.map((s) => ({
          x: s.x,
          y: s.y,
          opacity: tracerOpacity(s),
        })),
        bursts: bursts.map((b) => {
          const pos = burstPosition(b);
          return { x: pos.x, y: pos.y, opacity: tracerOpacity(b) };
        }),
        tints: frame.players.map((p) =>
          playerPaintColor(p.index, p.alive, victimFlash.has(p.index)),
        ),
        players: frame.players.map((p) => ({
          index: p.index,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          jetting: p.jetting,
          protected: p.protected,
          alpha: blinkAlpha(frame.tick, p.protected),
          color: playerPaintColor(p.index, p.alive, victimFlash.has(p.index)),
          colorCss: playerPaintCss(p.index, p.alive, victimFlash.has(p.index)),
          flame:
            p.jetting && p.alive
              ? { scale: flameScale(frame.tick, p.index), alpha: flameAlpha(frame.tick, p.index) }
              : null,
        })),
        zoom: cam.zoom ?? 1,
        scale: cam.scale,
        trauma: cam.trauma ?? 0,
        shakeX: cam.shakeX ?? 0,
        shakeY: cam.shakeY ?? 0,
      };
    }
    return { frame, cam, layers };
  }

  try {
    // Lazy Pixi chunk (vite code-splits the dynamic import below into
    // assets/pixi-[hash].js): the ~1MB engine stays out of the initial
    // main.js so first paint never blocks on the PixiJS parse.
    const mod = await import("pixi.js");
    const app = new mod.Application();
    const initDpr =
      typeof window !== "undefined" &&
      typeof window.devicePixelRatio === "number" &&
      Number.isFinite(window.devicePixelRatio)
        ? Math.min(Math.max(window.devicePixelRatio, 1), 2)
        : 1;
    await app.init({
      canvas,
      width: logicalW,
      height: logicalH,
      background: "#05070f",
      // Density-graded crispness (Pixi v8 recipe): resolution scales
      // the backing buffer from devicePixelRatio (clamped to 2 by
      // the perf guardrail) with autoDensity mapping it back to the
      // logical 640x360 coordinate space, so camera/culling math is
      // untouched while high-DPI screens stay sharp. No MSAA keeps
      // fill rate flat on integrated graphics.
      antialias: false,
      resolution: initDpr,
      autoDensity: true,
      powerPreference: "high-performance",
    });
    const graphics = new mod.Graphics();
    app.stage.addChild(graphics);
    activeMode = "pixi";
    return {
      mode: "pixi",
      setResolution(dpr: number): void {
        try {
          const clamped =
            typeof dpr === "number" && Number.isFinite(dpr)
              ? Math.min(Math.max(dpr, 1), 2)
              : 1;
          app.renderer.resolution = clamped;
        } catch {
          // Headless/shorn renderers: density stays at init value.
        }
      },
      draw(
        state: StateLike,
        map?: MapLike | TileMapLike | null,
        camera?: Camera | null,
        events?: string[],
        shots?: ShotDetail[],
        damages?: DamageDetail[],
        kills?: KillDetail[],
      ): void {
        const { frame, cam, layers } = trackDraw(
          state,
          map,
          camera,
          events,
          shots,
          damages,
          kills,
        );
        paintFramePixi(
          graphics,
          frame,
          cam,
          layers,
          flashes.slice(),
          tracers.slice(),
          muzzles.slice(),
          sparks.slice(),
          bursts.slice(),
          victimFlash,
          logicalW,
          logicalH,
        );
      },
    };
  } catch {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("scrapline: no 2d canvas context available");
    }
    activeMode = "canvas2d";
    return {
      mode: "canvas2d",
      // Canvas2d fallback: browser CSS upscale covers density, so the
      // resolution setter stays an intentional no-op.
      setResolution(): void {},
      draw(
        state: StateLike,
        map?: MapLike | TileMapLike | null,
        camera?: Camera | null,
        events?: string[],
        shots?: ShotDetail[],
        damages?: DamageDetail[],
        kills?: KillDetail[],
      ): void {
        const { frame, cam, layers } = trackDraw(
          state,
          map,
          camera,
          events,
          shots,
          damages,
          kills,
        );
        paintFrame2D(ctx, frame, cam, layers, flashes.slice(), tracers.slice(), muzzles.slice(), sparks.slice(), bursts.slice(), victimFlash, logicalW, logicalH);
      },
    };
  }
}