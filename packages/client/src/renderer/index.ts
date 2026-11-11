// Client view-model and renderer: pure frame description plus an async
// renderer that prefers the locally bundled PixiJS v8 and falls back to a
// 2D canvas backend drawing the same ops (headless browsers may lack
// WebGL). No external image assets — vector shapes only.

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

/** Default arena tiles (mirrors World's defaultRows: 40 wide, 20 tall). */
const DEFAULT_ARENA_TILES_W = 40;
const DEFAULT_ARENA_TILES_H = 20;

/** Minimal arena shape (TileMap compatible). */
export interface MapLike {
  readonly widthPixels: number;
  readonly heightPixels: number;
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
    players: state.players.map((p, index) => ({
      index,
      x: p.x,
      y: p.y,
      w: PLAYER_WIDTH,
      h: p.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT,
      aim: p.aim,
      alive: p.alive,
    })),
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
  /** Draw one world state (map optional, defaults like describeFrame). */
  draw(state: StateLike, map?: MapLike | null): void;
  /** Which backend survived init. */
  mode: "pixi" | "canvas2d";
}

function playerColor(index: number, alive: boolean): number {
  if (!alive) {
    return 0x475569;
  }
  return index === 0 ? 0x7df9ff : 0xfb923c;
}

function paintFramePixi(
  graphics: { clear(): unknown; rect(x: number, y: number, w: number, h: number): unknown; fill(color: number): unknown; circle(x: number, y: number, r: number): unknown },
  frame: Frame,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const t = viewTransform(canvasWidth, canvasHeight, frame.arena.width, frame.arena.height);
  const px = (x: number): number => x * t.scale + t.offsetX;
  const py = (y: number): number => y * t.scale + t.offsetY;
  graphics.clear();
  graphics.rect(0, 0, canvasWidth, canvasHeight);
  graphics.fill(0x05070f);
  graphics.rect(px(0), py(0), frame.arena.width * t.scale, frame.arena.height * t.scale);
  graphics.fill(0x0b1020);
  for (const prop of frame.props) {
    if (!prop.alive) {
      continue;
    }
    graphics.rect(px(prop.x), py(prop.y), prop.w * t.scale, prop.h * t.scale);
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
    graphics.circle(px(proj.x), py(proj.y), Math.max(2, 3 * t.scale));
    graphics.fill(proj.kind === "grenade" ? 0xa3e635 : 0xf97316);
  }
  for (const p of frame.players) {
    graphics.rect(px(p.x), py(p.y), p.w * t.scale, p.h * t.scale);
    graphics.fill(playerColor(p.index, p.alive));
    if (p.alive) {
      const cx = px(p.x + p.w / 2);
      const cy = py(p.y + p.h / 2);
      graphics.circle(cx + Math.cos(p.aim) * 14, cy + Math.sin(p.aim) * 14, 2);
      graphics.fill(0xf8fafc);
    }
  }
}

function paintFrame2D(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const t = viewTransform(canvasWidth, canvasHeight, frame.arena.width, frame.arena.height);
  const px = (x: number): number => x * t.scale + t.offsetX;
  const py = (y: number): number => y * t.scale + t.offsetY;
  ctx.fillStyle = "#05070f";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(px(0), py(0), frame.arena.width * t.scale, frame.arena.height * t.scale);
  for (const prop of frame.props) {
    if (!prop.alive) {
      continue;
    }
    ctx.fillStyle = prop.kind === "barrel" ? "#b45309" : "#92400e";
    ctx.fillRect(px(prop.x), py(prop.y), prop.w * t.scale, prop.h * t.scale);
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
    ctx.arc(px(proj.x), py(proj.y), Math.max(2, 3 * t.scale), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of frame.players) {
    ctx.fillStyle =
      !p.alive ? "#475569" : p.index === 0 ? "#7df9ff" : "#fb923c";
    ctx.fillRect(px(p.x), py(p.y), p.w * t.scale, p.h * t.scale);
    if (p.alive) {
      const cx = px(p.x + p.w / 2);
      const cy = py(p.y + p.h / 2);
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(p.aim) * 14, cy + Math.sin(p.aim) * 14, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Build a renderer for the canvas. PixiJS v8 (`await app.init({canvas})`)
 * is tried first; any failure (notably missing WebGL in headless
 * browsers) falls back to the 2D canvas backend drawing the same ops.
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
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
    return {
      mode: "pixi",
      draw(state: StateLike, map?: MapLike | null): void {
        paintFramePixi(graphics, describeFrame(state, map), canvas.width, canvas.height);
      },
    };
  } catch {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("scrapline: no 2d canvas context available");
    }
    return {
      mode: "canvas2d",
      draw(state: StateLike, map?: MapLike | null): void {
        paintFrame2D(ctx, describeFrame(state, map), canvas.width, canvas.height);
      },
    };
  }
}
