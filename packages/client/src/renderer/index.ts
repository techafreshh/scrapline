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
   * feed capped fx flashes).
   */
  draw(
    state: StateLike,
    map?: MapLike | TileMapLike | null,
    camera?: Camera | null,
    events?: string[],
  ): void;
  /** Which backend survived init. */
  mode: "pixi" | "canvas2d";
}

/** One capped transient fx flash in world coords. */
interface Flash {
  x: number;
  y: number;
  kind: "explode" | "bounce" | "shot";
  ttl: number;
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
  return index === 0 ? 0x7df9ff : 0xfb923c;
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
    fill(color: number): unknown;
    circle(x: number, y: number, r: number): unknown;
    moveTo(x: number, y: number): unknown;
    lineTo(x: number, y: number): unknown;
    stroke(style?: { width?: number; color?: number; cap?: "butt" | "round" | "square" }): unknown;
  },
  frame: Frame,
  cam: Camera,
  layers: LayerCounts,
  flashes: Flash[],
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
    graphics.rect(px(p.x), py(p.y), p.w * cam.scale, p.h * cam.scale);
    graphics.fill(playerColor(p.index, p.alive));
    if (p.alive) {
      const cx = px(p.x + p.w / 2);
      const cy = py(p.y + p.h / 2);
      const tip = { x: px(p.barrel.x), y: py(p.barrel.y) };
      graphics.moveTo(cx, cy);
      graphics.lineTo(tip.x, tip.y);
      graphics.stroke({ width: 3, color: barrelColor(p.index), cap: "round" });
      graphics.circle(tip.x, tip.y, 2);
      graphics.fill(barrelColor(p.index));
      if (!p.onGround) {
        graphics.rect(cx - 3, py(p.y + p.h) + 2, 6, 8);
        graphics.fill(0xfb923c);
      }
    }
  }
  for (const flash of flashes) {
    graphics.circle(px(flash.x), py(flash.y), flashRadius(flash.kind, flash.ttl));
    graphics.fill(flashColor(flash.kind));
  }
}

function paintFrame2D(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  cam: Camera,
  layers: LayerCounts,
  flashes: Flash[],
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
    ctx.fillStyle =
      !p.alive ? "#475569" : p.index === 0 ? "#7df9ff" : "#fb923c";
    ctx.fillRect(px(p.x), py(p.y), p.w * cam.scale, p.h * cam.scale);
    if (p.alive) {
      const cx = px(p.x + p.w / 2);
      const cy = py(p.y + p.h / 2);
      const tipX = px(p.barrel.x);
      const tipY = py(p.barrel.y);
      ctx.strokeStyle = barrelCss(p.index);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = barrelCss(p.index);
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
      ctx.fill();
      if (!p.onGround) {
        ctx.fillStyle = "#fb923c";
        ctx.fillRect(cx - 3, py(p.y + p.h) + 2, 6, 8);
      }
    }
  }
  for (const flash of flashes) {
    const radius = flashRadius(flash.kind, flash.ttl);
    ctx.fillStyle = flashCss(flash.kind);
    ctx.beginPath();
    ctx.arc(px(flash.x), py(flash.y), radius, 0, Math.PI * 2);
    ctx.fill();
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

/**
 * Build a renderer for the canvas. PixiJS v8 (`await app.init({canvas})`)
 * is tried first; any failure (notably missing WebGL in headless
 * browsers) falls back to the 2D canvas backend drawing the same ops.
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  let lastNow = 0;
  let fpsEma = 60;
  let activeMode: "pixi" | "canvas2d" = "canvas2d";
  const flashes: Flash[] = [];

  function trackDraw(
    state: StateLike,
    map: MapLike | TileMapLike | null | undefined,
    camera: Camera | null | undefined,
    events: string[] | undefined,
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
    for (let i = flashes.length - 1; i >= 0; i -= 1) {
      const flash = flashes[i] as Flash;
      flash.ttl -= 1;
      if (flash.ttl <= 0) {
        flashes.splice(i, 1);
      }
    }
    const layers = collectLayers(frame, map ?? null, cam, canvas.width, canvas.height);
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
      };
    }
    return { frame, cam, layers };
  }

  try {
    const mod = await import("pixi.js");
    const app = new mod.Application();
    await app.init({
      canvas,
      width: canvas.width,
      height: canvas.height,
      background: "#05070f",
    });
    const graphics = new mod.Graphics();
    app.stage.addChild(graphics);
    activeMode = "pixi";
    return {
      mode: "pixi",
      draw(
        state: StateLike,
        map?: MapLike | TileMapLike | null,
        camera?: Camera | null,
        events?: string[],
      ): void {
        const { frame, cam, layers } = trackDraw(state, map, camera, events);
        paintFramePixi(
          graphics,
          frame,
          cam,
          layers,
          flashes.slice(),
          canvas.width,
          canvas.height,
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
      draw(
        state: StateLike,
        map?: MapLike | TileMapLike | null,
        camera?: Camera | null,
        events?: string[],
      ): void {
        const { frame, cam, layers } = trackDraw(state, map, camera, events);
        paintFrame2D(ctx, frame, cam, layers, flashes.slice(), canvas.width, canvas.height);
      },
    };
  }
}