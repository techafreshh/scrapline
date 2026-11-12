// Pure follow-camera: world-space viewport-center state with fixed zoom
// and aim-direction look-ahead. DOM-free (unit-testable under node);
// the renderer owns one of these and main.ts advances it every frame.
import { TILE_SIZE } from "../../../core/src/map";

/** Fixed zoom: player 26px renders 52 screen px, tiles 32px render 64. */
export const CAMERA_ZOOM = 2;
/** Aim look-ahead offset in world px along the local player's aim. */
export const CAMERA_LOOKAHEAD = 96;
/** Per-frame exponential smoothing toward the clamped target. */
export const CAMERA_LERP = 0.1;
/** Backing-store size the clamp math assumes (matches #game 640x360). */
const CLAMP_CANVAS_W = 640;
const CLAMP_CANVAS_H = 360;
/** FFA-vs-bots match size: the local player plus three scripted bots. */
export const MATCH_SPAWN_COUNT = 4;
/** Gap between adjacent match spawns in world px (clustered in one view). */
export const MATCH_SPAWN_GAP = 20;

/**
 * Clustered FFA spawn x-positions centered on the arena midpoint.
 * The default count covers the local player plus three bots; larger
 * matches keep entry 0 anchored on the local player (leftmost) and
 * still spawn inside one camera half-view (bots + 1 <= 8 keeps the
 * cluster within CLAMP_CANVAS_W / (2 * CAMERA_ZOOM) = 160px minus the
 * CAMERA_LOOKAHEAD margin). Positions clamp inside [0, arenaWidth].
 */
export function matchSpawnXs(
  arenaWidthPx: number,
  count: number = MATCH_SPAWN_COUNT,
): number[] {
  const players = Math.min(
    8,
    Math.max(1, Math.floor(count)),
  );
  const spread = (players - 1) * MATCH_SPAWN_GAP;
  const start = arenaWidthPx / 2 - spread / 2;
  const xs: number[] = [];
  for (let i = 0; i < players; i += 1) {
    xs.push(Math.min(Math.max(start + i * MATCH_SPAWN_GAP, 0), arenaWidthPx));
  }
  return xs;
}

/** Zoom-level multipliers cycled by the zoom key (1x, 0.8x, 0.64x). */
export const ZOOM_LEVELS: readonly number[] = [1, 0.8, 0.64];
/** Max world-px view size the zoom clamp allows (width x height). */
export const MAX_VIEW_W = 2100;
export const MAX_VIEW_H = 1280;
/** Trauma decay per second (linear). */
export const TRAUMA_DECAY = 0.8;
/** Screen-px shake amplitude at trauma 1 (scales with trauma squared). */
export const MAX_SHAKE_PX = 14;
/** Zoom lerp rate per second toward the target multiplier. */
export const ZOOM_LERP_RATE = 8;
/** Shake oscillation frequency in radians per second. */
export const SHAKE_FREQ = 30;
/** Nearby-explosion trauma radius in world px. */
export const EXPLODE_SHAKE_RADIUS = 500;
/** Viewport center in world px plus zoom, trauma, and shake state. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
  /** Active zoom multiplier (lerps toward targetZoom). */
  zoom: number;
  /** Pending zoom multiplier from ZOOM_LEVELS. */
  targetZoom: number;
  /** Screen-shake trauma in [0, 1]; decays linearly per frame. */
  trauma: number;
  /** Current screen-px shake offset (backing-store px). */
  shakeX: number;
  /** Current screen-px shake offset (backing-store px). */
  shakeY: number;
  /** Accumulated camera time in seconds (drives the shake phase). */
  time: number;
}

/** Fresh camera centered on the arena at the default zoom. */
export function createCamera(arenaW: number, arenaH: number): Camera {
  return {
    x: arenaW / 2,
    y: arenaH / 2,
    scale: CAMERA_ZOOM,
    zoom: 1,
    targetZoom: 1,
    trauma: 0,
    shakeX: 0,
    shakeY: 0,
    time: 0,
  };
}

/** Clamp a viewport center so the view stays inside the arena bounds. */
function clampCenter(
  tx: number,
  ty: number,
  arenaW: number,
  arenaH: number,
  scale: number,
): { x: number; y: number } {
  const halfW = CLAMP_CANVAS_W / (2 * scale);
  const halfH = CLAMP_CANVAS_H / (2 * scale);
  const x =
    arenaW <= halfW * 2
      ? arenaW / 2
      : Math.min(Math.max(tx, halfW), arenaW - halfW);
  const y =
    arenaH <= halfH * 2
      ? arenaH / 2
      : Math.min(Math.max(ty, halfH), arenaH - halfH);
  return { x, y };
}

/**
 * Ease the camera 10% toward the clamped target. Converges in well
 * under 30 frames from anywhere in the arena. Also lerps the zoom
 * scale toward the target multiplier (clamped to the max view size),
 * decays trauma linearly, and recomputes the quadrature shake offset.
 */
export function updateCamera(
  cam: Camera,
  targetX: number,
  targetY: number,
  arenaW: number,
  arenaH: number,
  dtSeconds: number = 1 / 60,
): void {
  const clamped = clampCenter(targetX, targetY, arenaW, arenaH, cam.scale);
  cam.x += (clamped.x - cam.x) * CAMERA_LERP;
  cam.y += (clamped.y - cam.y) * CAMERA_LERP;
  const dt = Math.max(0, dtSeconds);
  cam.zoom += (cam.targetZoom - cam.zoom) * Math.min(1, dt * ZOOM_LERP_RATE);
  const minScale = Math.max(CLAMP_CANVAS_W / MAX_VIEW_W, CLAMP_CANVAS_H / MAX_VIEW_H);
  cam.scale = Math.max(minScale, CAMERA_ZOOM * cam.zoom);
  const re = clampCenter(cam.x, cam.y, arenaW, arenaH, cam.scale);
  cam.x = re.x;
  cam.y = re.y;
  cam.time += dt;
  cam.trauma = Math.max(0, cam.trauma - TRAUMA_DECAY * dt);
  // Quadrature sinusoids: magnitude stays exactly the amplitude, so the
  // offset never samples near zero on the frame a probe happens to poll.
  const amp = MAX_SHAKE_PX * cam.trauma * cam.trauma;
  const phase = cam.time * SHAKE_FREQ;
  cam.shakeX = amp * Math.sin(phase);
  cam.shakeY = amp * Math.cos(phase);
}

/** Add trauma, clamped to [0, 1]. */
export function addTrauma(cam: Camera, amount: number): void {
  cam.trauma = Math.min(1, Math.max(0, cam.trauma + amount));
}

/** Minimal projectile identity for launch detection (World Projectile compatible). */
export interface LaunchedProjectile {
  id: number;
  kind: string;
  ownerId: number;
}

/**
 * True when a rocket owned by `ownerId` launched between two
 * projectile snapshots (ids seen before the sim step vs. after).
 * Projectile weapons never emit ShotDetails, so the client detects
 * local rocket fire this way instead of draining shot details. Pure:
 * no DOM, no clock, so unit-testable under node.
 */
export function rocketLaunchedSince(
  prevIds: ReadonlySet<number>,
  projectiles: readonly LaunchedProjectile[],
  ownerId: number,
): boolean {
  for (const proj of projectiles) {
    if (
      proj.kind === "rocket" &&
      proj.ownerId === ownerId &&
      !prevIds.has(proj.id)
    ) {
      return true;
    }
  }
  return false;
}

/** Advance the target zoom through ZOOM_LEVELS with wraparound. */
export function cycleZoom(cam: Camera): void {
  const current = ZOOM_LEVELS.indexOf(cam.targetZoom);
  const next =
    current < 0
      ? ZOOM_LEVELS[0]
      : ZOOM_LEVELS[(current + 1) % ZOOM_LEVELS.length];
  cam.targetZoom = next ?? 1;
}

/** World-px view size for the given backing-store canvas dimensions. */
export function viewSize(
  cam: Camera,
  canvasW: number,
  canvasH: number,
): { w: number; h: number } {
  return { w: canvasW / cam.scale, h: canvasH / cam.scale };
}

/** Follow target: player center pushed 96px along the aim direction. */
export function cameraTarget(
  playerCenterX: number,
  playerCenterY: number,
  aim: number,
): { x: number; y: number } {
  return {
    x: playerCenterX + Math.cos(aim) * CAMERA_LOOKAHEAD,
    y: playerCenterY + Math.sin(aim) * CAMERA_LOOKAHEAD,
  };
}

/** Map one world point through the camera to canvas backing-store px. */
export function projectCamera(
  cam: Camera,
  canvasW: number,
  canvasH: number,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: (worldX - cam.x) * cam.scale + canvasW / 2,
    y: (worldY - cam.y) * cam.scale + canvasH / 2,
  };
}

/** Integer tile bounds of the camera view, inclusive and map-clamped. */
export function visibleTileRange(
  cam: Camera,
  canvasW: number,
  canvasH: number,
  mapW: number,
  mapH: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const halfW = canvasW / (2 * cam.scale);
  const halfH = canvasH / (2 * cam.scale);
  const tilesX = Math.max(1, Math.ceil(mapW / TILE_SIZE));
  const tilesY = Math.max(1, Math.ceil(mapH / TILE_SIZE));
  return {
    x0: Math.max(0, Math.floor((cam.x - halfW) / TILE_SIZE)),
    y0: Math.max(0, Math.floor((cam.y - halfH) / TILE_SIZE)),
    x1: Math.min(tilesX - 1, Math.floor((cam.x + halfW) / TILE_SIZE)),
    y1: Math.min(tilesY - 1, Math.floor((cam.y + halfH) / TILE_SIZE)),
  };
}
