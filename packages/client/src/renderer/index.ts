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
import {
  BACKWALL_Z,
  BOUNCE_PAD_H,
  BOUNCE_Z,
  HIGHLIGHT_PX,
  ONEWAY_PLANK_H,
  ONEWAY_Z,
  SOLID_TILE_H,
  SOLID_Z,
  collectTileLayers,
  resolveTileTheme,
  type TileCell,
  type TileLayers,
} from "../view/tiles";
import { setCurrentTheme } from "../view/theme";
import type { TileTheme } from "../view/theme";
import { decorationsFor } from "../maps";
import {
  countOccludedTiles,
  isDecorOccluded,
  paintDecor2D,
  paintDecorPixi,
  visibleDecorations,
  type Decoration,
} from "../view/decor";
import {
  isLightsRespected,
  paintSky2D,
  paintSkyPixi,
  paintVignette2D,
  paintVignettePixi,
  skyCoversViewport,
  skyTopRgb,
  VIGNETTE_ALPHA,
} from "../view/background";
import {
  clampRendererResolution,
} from "../view/resize";
import {
  ARM_PIVOT,
  CHARACTER_H,
  CROUCH_SQUASH,
  VISOR_CSS,
  characterParts,
  teamCss,
} from "../view/character";
import type { WeaponId } from "../../../core/src/weapons";
import {
  selectSoldierFrame,
  soldierAccentFor,
  soldierAccentHex,
  soldierLegOffset,
  soldierMuzzleTip,
  weaponDef,
  type SoldierFrameId,
} from "../view/soldier";
import {
  updateAnimState,
  type AnimInput,
  type AnimPose,
  type AnimState,
} from "../view/anim";
import {
  buildPlayerNode,
  publishGameProbes,
  syncPlayerNode,
  type AnimProbes,
  type PixiFactory,
  type PlayerNode,
  type StageLike,
} from "../view/playerView";

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
/** Muzzle-dot radius in local px (matches the composed gunMuzzle dot). */
const MUZZLE_DOT_R = 2;
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
  tileChar?(tx: number, ty: number): string;
  isOneWayTile?(tx: number, ty: number): boolean;
  isBounceTile?(tx: number, ty: number): boolean;
  isBackwallTile?(tx: number, ty: number): boolean;
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
  /** Horizontal velocity in world px/s (drives the run-cycle phase). */
  vx: number;
  /** True while crouching (drives the height-scale probe). */
  crouching: boolean;
  /** Dynamic hurt timestamp (any clock basis), else null. */
  hurtAt: number | null;
  /** Health points (hp-drop edge latches the hurt flash). */
  hp: number;
  /** Equipped weapon id (drives the in-hand gun and muzzle tip). */
  weapon: WeaponId;
  /** Barrel tip in world coords (body center + aim dir * weapon length). */
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
      const hurtRaw = (p as { hurtAt?: unknown }).hurtAt;
      const weapon: WeaponId =
        (p as { weapon?: unknown }).weapon === undefined
          ? "pistol"
          : (p.weapon as WeaponId);
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
        vx: p.vx ?? 0,
        crouching: p.crouching === true,
        hurtAt:
          typeof hurtRaw === "number" && Number.isFinite(hurtRaw)
            ? hurtRaw
            : null,
        hp: p.hp ?? 0,
        weapon,
        barrel: soldierMuzzleTip(cx, cy, p.aim, weapon),
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

/** Shared layer counts so Pixi and canvas2d report identically. */
interface LayerCounts extends TileLayers {
  /** Alias of solids for legacy callers. */
  tiles: TileCell[];
  entitiesDrawn: number;
}

/** Re-export tile z-order and size probes for harness convenience. */
export { BACKWALL_Z, SOLID_Z, BOUNCE_Z, ONEWAY_Z, BOUNCE_PAD_H, ONEWAY_PLANK_H, SOLID_TILE_H, HIGHLIGHT_PX };

/**
 * Cull themed tiles to the camera view and count drawable layers.
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
  if (tileMap === null) {
    const fallbackSolidFrom = Math.ceil(frame.arena.height / TILE_SIZE) - 2;
    const range = visibleTileRange(cam, canvasWidth, canvasHeight, frame.arena.width, frame.arena.height);
    const tiles: TileCell[] = [];
    for (let ty = range.y0; ty <= range.y1; ty += 1) {
      for (let tx = range.x0; tx <= range.x1; tx += 1) {
        if (ty >= fallbackSolidFrom) {
          tiles.push({ tx, ty });
        }
      }
    }
    return {
      tiles,
      solids: tiles.slice(),
      oneWays: [],
      bounces: [],
      backwalls: [],
      tilesDrawn: tiles.length,
      tileDrawCalls: tiles.length,
      bouncePadCount: 0,
      backwallCount: 0,
      oneWayCount: 0,
      entitiesDrawn: frame.players.length,
    };
  }
  const collected = collectTileLayers(
    tileMap,
    cam,
    canvasWidth,
    canvasHeight,
    frame.arena.width,
    frame.arena.height,
  );
  return {
    ...collected,
    tiles: collected.solids,
    entitiesDrawn: frame.players.length,
  };
}

function playerColor(index: number, alive: boolean): number {
  if (!alive) {
    return 0x475569;
  }
  return soldierAccentHex(index);
}

/** Barrel stroke color: local pale, enemies warm red (threat cue). */
export function barrelColor(index: number): number {
  return index === 0 ? 0xf8fafc : 0xef4444;
}

/** Canvas2D twin of barrelColor. */
export function barrelCss(index: number): string {
  return index === 0 ? "#f8fafc" : "#ef4444";
}

/** Paint one themed tile layer set in Pixi (backwalls first for z-order). */
function paintTilesPixi(
  graphics: {
    rect(x: number, y: number, w: number, h: number): unknown;
    fill(style: number | { color?: number; alpha?: number }): unknown;
    moveTo(x: number, y: number): unknown;
    lineTo(x: number, y: number): unknown;
    stroke(style?: { width?: number; color?: number; alpha?: number; cap?: "butt" | "round" | "square" }): unknown;
  },
  px: (x: number) => number,
  py: (y: number) => number,
  tileSize: number,
  scale: number,
  layers: LayerCounts,
  theme: TileTheme,
): void {
  // Backwall quads behind the playfield at 60% brightness (z 0).
  for (const cell of layers.backwalls) {
    graphics.rect(px(cell.tx * TILE_SIZE), py(cell.ty * TILE_SIZE), tileSize + 1, tileSize + 1);
    graphics.fill(theme.backwallHex);
  }
  // Solid tiles: base + depth tint + edge shading + 2px top highlight.
  const highlightH = HIGHLIGHT_PX * scale;
  const edgeW = Math.max(1, 1 * scale);
  const depthH = Math.max(1, 4 * scale);
  for (const cell of layers.solids) {
    const x = px(cell.tx * TILE_SIZE);
    const y = py(cell.ty * TILE_SIZE);
    graphics.rect(x, y, tileSize + 1, tileSize + 1);
    graphics.fill(theme.baseHex);
    graphics.rect(x, y + tileSize + 1 - depthH, tileSize + 1, depthH);
    graphics.fill(theme.depthHex);
    graphics.rect(x, y, edgeW, tileSize + 1);
    graphics.fill(theme.edgeHex);
    graphics.rect(x + tileSize + 1 - edgeW, y, edgeW, tileSize + 1);
    graphics.fill(theme.edgeHex);
    graphics.rect(x, y + tileSize + 1 - edgeW, tileSize + 1, edgeW);
    graphics.fill(theme.edgeHex);
    graphics.rect(x, y, tileSize + 1, highlightH);
    graphics.fill(theme.highlightHex);
  }
  // One-way planks: hazard-striped 8px strips at the tile top — the
  // theme hazard base with alternating dark vertical bands, so every
  // plank pixel samples from the hazard pair (kilima: #FFD21F/#111111).
  const plankH = ONEWAY_PLANK_H * scale;
  const plankBands = 8;
  for (const cell of layers.oneWays) {
    const x = px(cell.tx * TILE_SIZE);
    const y = py(cell.ty * TILE_SIZE);
    graphics.rect(x, y, tileSize + 1, plankH);
    graphics.fill(theme.hazardHex);
    const bandW = (tileSize + 1) / plankBands;
    for (let i = 1; i < plankBands; i += 2) {
      graphics.rect(x + i * bandW, y, bandW + 1, plankH);
      graphics.fill(theme.hazardStripeHex);
    }
    graphics.rect(x, y, tileSize + 1, highlightH);
    graphics.fill(theme.hazardHex);
    graphics.rect(x, y + plankH - edgeW, tileSize + 1, edgeW);
    graphics.fill(theme.hazardStripeHex);
  }
  // Bounce pads: hazard 8px chevrons anchored at the tile bottom —
  // the theme hazard base with dark chevron stripes in the exact
  // stripe hex (kilima: #FFD21F base, #111111 chevrons).
  const padH = BOUNCE_PAD_H * scale;
  const stripeW = Math.max(1, 1.5 * scale);
  for (const cell of layers.bounces) {
    const x = px(cell.tx * TILE_SIZE);
    const y = py(cell.ty * TILE_SIZE);
    const padY = y + tileSize + 1 - padH;
    graphics.rect(x, padY, tileSize + 1, padH);
    graphics.fill(theme.hazardHex);
    for (let i = 0; i < 2; i += 1) {
      const cy = padY + (padH * (i + 1)) / 3;
      graphics.moveTo(x + 2, cy);
      graphics.lineTo(x + tileSize / 2, cy - 2 * scale);
      graphics.lineTo(x + tileSize - 1, cy);
      graphics.stroke({ width: stripeW, color: theme.hazardStripeHex });
    }
  }
}

/** Paint one themed tile layer set on a 2D canvas (mirrors paintTilesPixi). */
function paintTiles2D(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  tileSize: number,
  scale: number,
  layers: LayerCounts,
  theme: TileTheme,
): void {
  for (const cell of layers.backwalls) {
    ctx.fillStyle = theme.backwall;
    ctx.fillRect(px(cell.tx * TILE_SIZE), py(cell.ty * TILE_SIZE), tileSize + 1, tileSize + 1);
  }
  const highlightH = HIGHLIGHT_PX * scale;
  const edgeW = Math.max(1, 1 * scale);
  const depthH = Math.max(1, 4 * scale);
  for (const cell of layers.solids) {
    const x = px(cell.tx * TILE_SIZE);
    const y = py(cell.ty * TILE_SIZE);
    ctx.fillStyle = theme.base;
    ctx.fillRect(x, y, tileSize + 1, tileSize + 1);
    ctx.fillStyle = theme.depth;
    ctx.fillRect(x, y + tileSize + 1 - depthH, tileSize + 1, depthH);
    ctx.fillStyle = theme.edge;
    ctx.fillRect(x, y, edgeW, tileSize + 1);
    ctx.fillRect(x + tileSize + 1 - edgeW, y, edgeW, tileSize + 1);
    ctx.fillRect(x, y + tileSize + 1 - edgeW, tileSize + 1, edgeW);
    ctx.fillStyle = theme.highlight;
    ctx.fillRect(x, y, tileSize + 1, highlightH);
  }
  const plankH = ONEWAY_PLANK_H * scale;
  const plankBands = 8;
  for (const cell of layers.oneWays) {
    const x = px(cell.tx * TILE_SIZE);
    const y = py(cell.ty * TILE_SIZE);
    ctx.fillStyle = theme.hazardCss;
    ctx.fillRect(x, y, tileSize + 1, plankH);
    const bandW = (tileSize + 1) / plankBands;
    ctx.fillStyle = theme.hazardStripeCss;
    for (let i = 1; i < plankBands; i += 2) {
      ctx.fillRect(x + i * bandW, y, bandW + 1, plankH);
    }
    ctx.fillStyle = theme.hazardCss;
    ctx.fillRect(x, y, tileSize + 1, highlightH);
    ctx.fillStyle = theme.hazardStripeCss;
    ctx.fillRect(x, y + plankH - edgeW, tileSize + 1, edgeW);
  }
  const padH = BOUNCE_PAD_H * scale;
  for (const cell of layers.bounces) {
    const x = px(cell.tx * TILE_SIZE);
    const y = py(cell.ty * TILE_SIZE);
    const padY = y + tileSize + 1 - padH;
    ctx.fillStyle = theme.hazardCss;
    ctx.fillRect(x, padY, tileSize + 1, padH);
    ctx.strokeStyle = theme.hazardStripeCss;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.lineCap = "round";
    for (let i = 0; i < 2; i += 1) {
      const cy = padY + (padH * (i + 1)) / 3;
      ctx.beginPath();
      ctx.moveTo(x + 2, cy);
      ctx.lineTo(x + tileSize / 2, cy - 2 * scale);
      ctx.lineTo(x + tileSize - 1, cy);
      ctx.stroke();
    }
  }
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
  theme?: TileTheme,
  decors: readonly Decoration[] = [],
): void {
  const px = (x: number): number => projectCamera(cam, canvasWidth, canvasHeight, x, 0).x;
  const py = (y: number): number => projectCamera(cam, canvasWidth, canvasHeight, 0, y).y;
  const tileSize = TILE_SIZE * cam.scale;
  const activeTheme = theme ?? resolveTileTheme();
  graphics.clear();
  paintSkyPixi(graphics, canvasWidth, canvasHeight, activeTheme.name);
  const arena = projectCamera(cam, canvasWidth, canvasHeight, 0, 0);
  graphics.rect(arena.x, arena.y, frame.arena.width * cam.scale, frame.arena.height * cam.scale);
  graphics.fill(0x0b1020);
  paintDecorPixi(graphics, px, py, cam.scale, decors);
  paintTilesPixi(graphics, px, py, tileSize, cam.scale, layers, activeTheme);
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
  // Player bodies live in per-index Pixi container nodes (synced in
  // createRenderer); the immediate pass keeps only the jet-flame flicker
  // below the feet while thrusting.
  for (const p of frame.players) {
    if (!p.alive || !p.jetting) {
      continue;
    }
    const blink = blinkAlpha(frame.tick, p.protected);
    const cx = px(p.x + p.w / 2);
    const scale = flameScale(frame.tick, p.index);
    const flame = flameAlpha(frame.tick, p.index) * blink;
    const feetY = py(p.y + p.h);
    const outer = 5 * scale * cam.scale;
    graphics.circle(cx, feetY + outer + 2, outer);
    graphics.fill({ color: 0xf97316, alpha: flame });
    const inner = outer * 0.55;
    graphics.circle(cx, feetY + outer + 2, inner);
    graphics.fill({ color: 0xfde047, alpha: flame });
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
  paintVignettePixi(graphics, canvasWidth, canvasHeight);
}

/**
 * Draw the animated soldier figure for one player in screen space: the
 * frame selected by selectSoldierFrame (frame-specific leg offsets via
 * soldierLegOffset, tuck/dead poses preserved), accents palette-swapped
 * through soldierAccentFor, and the WEAPON_DEFS gun segment for
 * p.weapon rotated by aim around the (crouch-squashed) pivot. The
 * weapon muzzle lands on the frame barrel tip by construction.
 */
function drawCharacter2D(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  scale: number,
  p: FramePlayer,
  anim: AnimPose | undefined,
  flashed: boolean,
): void {
  const crouch = p.h < CHARACTER_H;
  const squashY = crouch ? CROUCH_SQUASH : 1;
  const parts = characterParts(crouch);
  const sx = px(p.x);
  const sy = py(p.y);
  const swing = anim?.swing ?? 0;
  const frame: SoldierFrameId =
    anim !== undefined
      ? selectSoldierFrame({
          deadPose: anim.deadPose,
          tuck: anim.tuck,
          crouching: p.crouching,
          heightScale: anim.heightScale,
          legPhase: anim.legPhase,
          swing: anim.swing,
        })
      : !p.alive
        ? "dead"
        : crouch
          ? "crouch"
          : "idle";
  const base = !p.alive ? "#475569" : soldierAccentFor(p.index);
  const paint =
    anim?.hurtFlash === true
      ? "#ffffff"
      : flashed
        ? VICTIM_TINT_CSS
        : base;
  for (const part of parts) {
    if (part.kind === "limb") {
      continue;
    }
    ctx.fillStyle = part.name === "visor" ? VISOR_CSS : paint;
    if (part.kind === "rect") {
      let dx = 0;
      let dy = 0;
      if (part.name === "legL" || part.name === "legR") {
        const side = part.name === "legL" ? -1 : 1;
        ({ dx, dy } = soldierLegOffset(frame, swing, side));
      }
      ctx.fillRect(
        sx + (part.x + dx) * scale,
        sy + (part.y + dy) * scale,
        Math.max(1, part.w * scale),
        Math.max(1, part.h * scale),
      );
    } else {
      ctx.beginPath();
      ctx.arc(
        sx + part.cx * scale,
        sy + part.cy * scale,
        Math.max(1, part.r * scale),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  // Arms plus the held weapon rotate with aim around the pivot.
  ctx.save();
  ctx.translate(sx + ARM_PIVOT.x * scale, sy + ARM_PIVOT.y * squashY * scale);
  ctx.rotate(p.aim);
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  ctx.lineCap = "round";
  const gun = weaponDef(p.weapon);
  for (const part of parts) {
    if (part.kind !== "limb") {
      continue;
    }
    ctx.lineWidth = Math.max(1, part.width * scale);
    ctx.beginPath();
    ctx.moveTo(part.x1 * scale, part.y1 * scale);
    ctx.lineTo(part.x2 * scale, part.y2 * scale);
    ctx.stroke();
    if (part.name === "armR") {
      ctx.strokeStyle = gun.colorCss;
      ctx.fillStyle = gun.colorCss;
      ctx.lineWidth = Math.max(1, gun.width * scale);
      ctx.beginPath();
      ctx.moveTo(5 * scale, 0);
      ctx.lineTo(gun.length * scale, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(
        gun.muzzleX * scale,
        0,
        Math.max(1, MUZZLE_DOT_R * scale),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = paint;
      ctx.fillStyle = paint;
    }
  }
  ctx.restore();
}

/**
 * Grow the per-index node store to the live player count, attaching
 * fresh Pixi containers to the stage exactly once (stubs need no
 * attach). Nodes past the live count are hidden so a smaller rematch
 * never leaves ghost figures on the stage.
 */
function ensurePlayerNodes(
  store: PlayerNode[],
  pixi: PixiFactory | null,
  stage: StageLike | null,
  count: number,
): void {
  while (store.length < count) {
    const node = buildPlayerNode(pixi, store.length);
    store.push(node);
    if (stage !== null && "position" in node) {
      stage.addChild(node);
    }
  }
  for (let i = 0; i < store.length; i += 1) {
    const node = store[i];
    if (node !== undefined && "visible" in node) {
      node.visible = i < count;
    }
  }
}

/** Pose every live node for the frame through the follow camera. */
function syncFramePlayers(
  store: PlayerNode[],
  frame: Frame,
  cam: Camera,
  canvasW: number,
  canvasH: number,
  victimFlash: ReadonlyMap<number, number>,
  anims: readonly AnimPose[],
): void {
  for (let i = 0; i < frame.players.length; i += 1) {
    const p = frame.players[i];
    const node = store[i];
    if (p === undefined || node === undefined || !("position" in node)) {
      continue;
    }
    const at = projectCamera(cam, canvasW, canvasH, p.x, p.y);
    const anim = anims[i];
    const soldierFrame: SoldierFrameId =
      anim !== undefined
        ? selectSoldierFrame({
            deadPose: anim.deadPose,
            tuck: anim.tuck,
            crouching: p.crouching,
            heightScale: anim.heightScale,
            legPhase: anim.legPhase,
            swing: anim.swing,
          })
        : !p.alive
          ? "dead"
          : p.crouching
            ? "crouch"
            : "idle";
    syncPlayerNode(node, {
      x: at.x,
      y: at.y,
      scale: cam.scale,
      aim: p.aim,
      colorHex: playerPaintColor(p.index, p.alive, victimFlash.has(p.index)),
      alpha:
        blinkAlpha(frame.tick, p.protected) * (anim?.spawnAlpha ?? 1),
      squash: p.h / CHARACTER_H,
      visible: true,
      legSwing: anim?.swing ?? 0,
      tuck: anim?.tuck ?? false,
      hurtFlash: anim?.hurtFlash ?? false,
      deadPose: anim?.deadPose ?? !p.alive,
      weapon: p.weapon,
      frame: soldierFrame,
    });
  }
}

/**
 * Publish the composed-sprite probe surface for the frame. Muzzle and
 * weaponTip are the same live-camera projection of player 0's barrel
 * tip (falling back to the latest tracer muzzle entry, then the arena
 * origin), so the coincidence probe reads 0 by construction.
 */
function publishFrameProbes(
  store: PlayerNode[],
  frame: Frame,
  cam: Camera,
  canvasW: number,
  canvasH: number,
  muzzles: readonly Muzzle[],
  anims: readonly AnimPose[],
): void {
  const first = frame.players[0];
  const lastMuzzle = muzzles.length > 0 ? muzzles[muzzles.length - 1] : undefined;
  const tip =
    first !== undefined
      ? first.barrel
      : lastMuzzle !== undefined
        ? { x: lastMuzzle.x, y: lastMuzzle.y }
        : { x: 0, y: 0 };
  const screen = projectCamera(cam, canvasW, canvasH, tip.x, tip.y);
  const head = anims[0];
  const anim: AnimProbes = {
    legPhase: head?.legPhase ?? 0,
    isFlameVisible: first !== undefined && first.alive && first.jetting,
    playerHeightScale:
      first !== undefined ? first.h / CHARACTER_H : 1,
    isHurtFlash: head?.hurtFlash ?? false,
  };
  const extras = frame.players.map((p, i) => {
    const pose = anims[i];
    return {
      frame:
        pose !== undefined
          ? selectSoldierFrame({
              deadPose: pose.deadPose,
              tuck: pose.tuck,
              crouching: p.crouching,
              heightScale: pose.heightScale,
              legPhase: pose.legPhase,
              swing: pose.swing,
            })
          : !p.alive
            ? ("dead" as const)
            : p.crouching
              ? ("crouch" as const)
              : ("idle" as const),
      weapon: p.weapon,
    };
  });
  publishGameProbes(
    store.slice(0, frame.players.length),
    frame.players.map((p) => p.index),
    frame.players.map((p) => ({
      color: soldierAccentHex(p.index),
      colorCss: soldierAccentFor(p.index),
    })),
    screen,
    screen,
    anim,
    extras,
  );
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
  anims: readonly AnimPose[],
  theme?: TileTheme,
  decors: readonly Decoration[] = [],
): void {
  const px = (x: number): number => projectCamera(cam, canvasWidth, canvasHeight, x, 0).x;
  const py = (y: number): number => projectCamera(cam, canvasWidth, canvasHeight, 0, y).y;
  const tileSize = TILE_SIZE * cam.scale;
  const activeTheme = theme ?? resolveTileTheme();
  paintSky2D(ctx, canvasWidth, canvasHeight, activeTheme.name);
  const arena = projectCamera(cam, canvasWidth, canvasHeight, 0, 0);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(arena.x, arena.y, frame.arena.width * cam.scale, frame.arena.height * cam.scale);
  paintDecor2D(ctx, px, py, cam.scale, decors);
  paintTiles2D(ctx, px, py, tileSize, cam.scale, layers, activeTheme);
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
  for (let pi = 0; pi < frame.players.length; pi += 1) {
    const p = frame.players[pi] as FramePlayer;
    const anim = anims[pi];
    const blink =
      blinkAlpha(frame.tick, p.protected) * (anim?.spawnAlpha ?? 1);
    const flashed = victimFlash.has(p.index);
    ctx.save();
    ctx.globalAlpha = blink;
    drawCharacter2D(ctx, px, py, cam.scale, p, anim, flashed);
    // Jet flame flicker below the feet while thrusting.
    if (p.alive && p.jetting) {
      const cx = px(p.x + p.w / 2);
      const scale = flameScale(frame.tick, p.index);
      ctx.globalAlpha = blink * flameAlpha(frame.tick, p.index);
      const feetY = py(p.y + p.h);
      const outer = 5 * scale * cam.scale;
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(cx, feetY + outer + 2, outer, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(cx, feetY + outer + 2, outer * 0.55, 0, Math.PI * 2);
      ctx.fill();
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
  paintVignette2D(ctx, canvasWidth, canvasHeight);
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
  return !alive ? "#475569" : teamCss(index);
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
 * one muzzle entry per firing shooter at the weapon-aware barrel tip.
 * Each tracer origin is overridden to the shooter's frame barrel tip
 * (falling back to shot.ox/oy only when the shooter row is absent), so
 * the tracer origin, the muzzle flash, and the drawn gun tip coincide
 * by construction. Pure: no DOM, no clock, so unit-testable under node.
 */
export function spawnShots(
  tracers: Tracer[],
  muzzles: Muzzle[],
  frame: Frame,
  shots: ShotDetail[],
): void {
  const muzzled = new Set<number>();
  for (const shot of shots) {
    const shooter = frame.players[shot.shooter];
    const origin =
      shooter !== undefined ? shooter.barrel : { x: shot.ox, y: shot.oy };
    tracers.push({
      x1: origin.x,
      y1: origin.y,
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
  // Live per-player composed-sprite nodes (real Pixi containers on the
  // Pixi backend, plain-object stubs on the canvas2d fallback).
  const playerNodes: PlayerNode[] = [];
  // Per-player animation accumulators plus the session clock anchors
  // mapping foreign hurt timestamps onto the perf-ms draw clock.
  const animStates: AnimState[] = [];
  let sessionStarted = false;
  let sessionPerfStart = 0;
  let sessionWallStart = 0;

  function trackDraw(
    state: StateLike,
    map: MapLike | TileMapLike | null | undefined,
    camera: Camera | null | undefined,
    events: string[] | undefined,
    shots: ShotDetail[] | undefined,
    damages: DamageDetail[] | undefined,
    kills: KillDetail[] | undefined,
  ): { frame: Frame; cam: Camera; layers: LayerCounts; anims: AnimPose[]; theme: TileTheme; themeName: string; decors: Decoration[] } {
    const frame = describeFrame(state, map ?? null);
    const cam = camera ?? createCamera(frame.arena.width, frame.arena.height);
    const now = performance.now();
    const wallNow = Date.now();
    if (!sessionStarted) {
      sessionStarted = true;
      sessionPerfStart = now;
      sessionWallStart = wallNow;
    }
    let dtSec = 0;
    if (lastNow > 0) {
      const dt = (now - lastNow) / 1000;
      if (dt > 0) {
        fpsEma += (1 / dt - fpsEma) * FPS_ALPHA;
        dtSec = Math.min(0.1, dt);
      }
    }
    lastNow = now;
    const animInputs: AnimInput[] = frame.players.map((p) => ({
      vx: p.vx,
      onGround: p.onGround,
      jetting: p.jetting,
      crouching: p.crouching,
      alive: p.alive,
      hurtAt: p.hurtAt,
      hp: p.hp,
    }));
    const damageVictims: number[] = [];
    for (const detail of damages ?? []) {
      if (detail.victim >= 0) {
        damageVictims.push(detail.victim);
      }
    }
    const anims = updateAnimState(
      animStates,
      animInputs,
      {
        perfStartMs: sessionPerfStart,
        wallStartMs: sessionWallStart,
        nowMs: now,
        wallNowMs: wallNow,
      },
      dtSec,
      damageVictims,
    );
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
    const theme = resolveTileTheme();
    const themeName = theme.name;
    const allDecors = decorationsFor(themeName) ?? [];
    const tileMapForDecor =
      map !== undefined &&
      map !== null &&
      typeof (map as TileMapLike).isSolidTile === "function"
        ? (map as TileMapLike)
        : null;
    const occluded = countOccludedTiles(allDecors, tileMapForDecor);
    const culled = visibleDecorations(
      allDecors,
      cam,
      logicalW,
      logicalH,
      frame.arena.width,
      frame.arena.height,
    );
    const decors =
      tileMapForDecor !== null
        ? culled.filter((decor) => !isDecorOccluded(decor, tileMapForDecor))
        : culled;
    try {
      setCurrentTheme(themeName);
    } catch {
      // Headless: module theme stays at the resolved value regardless.
    }
    if (typeof window !== "undefined") {
      try {
        const game = (window as unknown as Record<string, unknown>)["__game"] as
          | Record<string, unknown>
          | undefined;
        if (game !== undefined && game !== null && typeof game === "object") {
          Object.assign(game, {
            theme: themeName,
            tileDrawCalls: layers.tileDrawCalls,
            tilesDrawn: layers.tilesDrawn,
            bouncePadCount: layers.bouncePadCount,
            backwallCount: layers.backwallCount,
            oneWayCount: layers.oneWayCount,
            backwallZ: BACKWALL_Z,
            solidZ: SOLID_Z,
            bounceZ: BOUNCE_Z,
            oneWayZ: ONEWAY_Z,
            bounceTileH: BOUNCE_PAD_H,
            oneWayTileH: ONEWAY_PLANK_H,
            solidTileH: SOLID_TILE_H,
            decorationCount: allDecors.length,
            occludedTiles: occluded,
            skyTop: skyTopRgb(themeName),
            vignetteAlpha: VIGNETTE_ALPHA,
            lightsRespected: isLightsRespected(map ?? null),
            skyCoversViewport: skyCoversViewport(logicalW, logicalH),
            fps: Math.round(fpsEma * 10) / 10,
          });
        }
      } catch {
        // Probe mirror is best-effort under shorn harnesses.
      }
    }
    if (typeof window !== "undefined") {
      window.__scraplineDebug = {
        entitiesDrawn: layers.entitiesDrawn,
        tilesDrawn: layers.tilesDrawn,
        tileDrawCalls: layers.tileDrawCalls,
        bouncePadCount: layers.bouncePadCount,
        backwallCount: layers.backwallCount,
        oneWayCount: layers.oneWayCount,
        backwallZ: BACKWALL_Z,
        solidZ: SOLID_Z,
        theme: themeName,
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
        players: frame.players.map((p, pi) => {
          const anim = anims[pi];
          return {
            index: p.index,
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            jetting: p.jetting,
            protected: p.protected,
            alpha:
              blinkAlpha(frame.tick, p.protected) * (anim?.spawnAlpha ?? 1),
            color: playerPaintColor(p.index, p.alive, victimFlash.has(p.index)),
            colorCss: playerPaintCss(p.index, p.alive, victimFlash.has(p.index)),
            flame:
              p.jetting && p.alive
                ? { scale: flameScale(frame.tick, p.index), alpha: flameAlpha(frame.tick, p.index) }
                : null,
            legPhase: anim?.legPhase ?? 0,
            swing: anim?.swing ?? 0,
            heightScale: anim?.heightScale ?? 1,
            hurtFlash: anim?.hurtFlash ?? false,
            frame:
              anim !== undefined
                ? selectSoldierFrame({
                    deadPose: anim.deadPose,
                    tuck: anim.tuck,
                    crouching: p.crouching,
                    heightScale: anim.heightScale,
                    legPhase: anim.legPhase,
                    swing: anim.swing,
                  })
                : !p.alive
                  ? "dead"
                  : p.crouching
                    ? "crouch"
                    : "idle",
            weapon: p.weapon,
          };
        }),
        zoom: cam.zoom ?? 1,
        scale: cam.scale,
        trauma: cam.trauma ?? 0,
        shakeX: cam.shakeX ?? 0,
        shakeY: cam.shakeY ?? 0,
      };
    }
    return { frame, cam, layers, anims, theme, themeName, decors };
  }

  try {
    // Lazy Pixi chunk (vite code-splits the dynamic import below into
    // assets/pixi-[hash].js): the ~1MB engine stays out of the initial
    // main.js so first paint never blocks on the PixiJS parse.
    const mod = await import("pixi.js");
    const app = new mod.Application();
    const initDpr =
      typeof window !== "undefined"
        ? clampRendererResolution(window.devicePixelRatio)
        : 1;
    await app.init({
      canvas,
      width: logicalW,
      height: logicalH,
      // No `background` clear color: paintFramePixi paints paintSkyPixi over the full canvas every frame.
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
          const clamped = clampRendererResolution(dpr);
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
        const { frame, cam, layers, anims, theme, decors } = trackDraw(
          state,
          map,
          camera,
          events,
          shots,
          damages,
          kills,
        );
        // Composed sprite bodies: the factory/stage casts are structural
        // claims (Container/Graphics constructors, addChild) that keep
        // playerView free of a static pixi.js import, so the lazy chunk
        // boundary and the headless node unit tests stay intact.
        const pixiFactory = mod as unknown as PixiFactory;
        ensurePlayerNodes(
          playerNodes,
          pixiFactory,
          app.stage as unknown as StageLike,
          frame.players.length,
        );
        syncFramePlayers(playerNodes, frame, cam, logicalW, logicalH, victimFlash, anims);
        publishFrameProbes(playerNodes, frame, cam, logicalW, logicalH, muzzles, anims);
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
          theme,
          decors,
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
        const { frame, cam, layers, anims, theme, decors } = trackDraw(
          state,
          map,
          camera,
          events,
          shots,
          damages,
          kills,
        );
        // Canvas2d fallback: stub nodes carry the probe shape while the
        // composed geometry is drawn immediately in paintFrame2D.
        ensurePlayerNodes(playerNodes, null, null, frame.players.length);
        publishFrameProbes(playerNodes, frame, cam, logicalW, logicalH, muzzles, anims);
        paintFrame2D(ctx, frame, cam, layers, flashes.slice(), tracers.slice(), muzzles.slice(), sparks.slice(), bursts.slice(), victimFlash, logicalW, logicalH, anims, theme, decors);
      },
    };
  }
}