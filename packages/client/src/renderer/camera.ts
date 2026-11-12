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
 * Four clustered FFA spawn x-positions centered on the arena midpoint.
 * The whole cluster spans 3 * MATCH_SPAWN_GAP (60px), inside half the
 * camera view (CLAMP_CANVAS_W / (2 * CAMERA_ZOOM) = 160px) minus the
 * CAMERA_LOOKAHEAD margin, so every bot spawns inside the initial camera
 * viewport whatever the local player's aim direction. Entry 0 anchors
 * the local player (leftmost); positions clamp inside [0, arenaWidth].
 */
export function matchSpawnXs(arenaWidthPx: number): number[] {
  const spread = (MATCH_SPAWN_COUNT - 1) * MATCH_SPAWN_GAP;
  const start = arenaWidthPx / 2 - spread / 2;
  const xs: number[] = [];
  for (let i = 0; i < MATCH_SPAWN_COUNT; i += 1) {
    xs.push(Math.min(Math.max(start + i * MATCH_SPAWN_GAP, 0), arenaWidthPx));
  }
  return xs;
}

/** Viewport center in world px plus the fixed zoom scale. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** Fresh camera centered on the arena at the fixed zoom. */
export function createCamera(arenaW: number, arenaH: number): Camera {
  return { x: arenaW / 2, y: arenaH / 2, scale: CAMERA_ZOOM };
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
 * under 30 frames from anywhere in the arena.
 */
export function updateCamera(
  cam: Camera,
  targetX: number,
  targetY: number,
  arenaW: number,
  arenaH: number,
): void {
  const clamped = clampCenter(targetX, targetY, arenaW, arenaH, cam.scale);
  cam.x += (clamped.x - cam.x) * CAMERA_LERP;
  cam.y += (clamped.y - cam.y) * CAMERA_LERP;
  const re = clampCenter(cam.x, cam.y, arenaW, arenaH, cam.scale);
  cam.x = re.x;
  cam.y = re.y;
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
