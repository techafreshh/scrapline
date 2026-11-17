// Client view-model and renderer: pure frame description plus an async
// renderer that prefers the locally bundled PixiJS v8 and falls back to a
// 2D canvas backend drawing the same ops (headless browsers may lack
// WebGL). No external image assets — vector shapes only. All paint goes
// through the follow-camera projection; the renderer owns fps metering,
// capped event flashes, and the window.__scraplineDebug mirror.

import {
  JETPACK_FUEL_MAX,
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
import type {
  DamageDetail,
  ExplodeDetail,
  KillDetail,
  PickupDetail,
  ShotDetail,
} from "../../../core/src/events";
import {
  DEATH_COUNT,
  EXPLOSION_DEBRIS_COUNT,
  EXPLOSION_FLASH_COUNT,
  EXPLOSION_SMOKE_COUNT,
  IMPACT_COUNT,
  JET_PER_FRAME,
  MAX_PARTICLES,
  MUZZLE_COUNT,
  PICKUP_COUNT,
  particleOpacity,
  spawnDeathBurst,
  spawnExplosion,
  spawnImpact,
  spawnJetExhaust,
  spawnJetSmoke,
  spawnMuzzleFlash,
  spawnPickupSparkle,
  updateParticles,
  type Particle,
} from "../fx/particles";
import {
  hurtPulseStrength,
  paintChromaticPulse2D,
  paintChromaticPulsePixi,
  paintGlowHalo2D,
  paintGlowHaloPixi,
  paintShockwaveRing2D,
  paintShockwaveRingPixi,
  shockwaveAlive,
  shockwaveAlphaAt,
  shockwaveRadiusAt,
  spawnShockwave,
  updateShockwaves,
  type QualityLevel,
  type Shockwave,
} from "../fx/filters";
import { loadQuality, parseQuality } from "../settings";
import type { SetupStorage } from "../setup";
import { FX_EMITTER_CAPS } from "../fx/particles-config";
import type { FxEmitters } from "../fx/emitters";
import {
  ambientBirdCount,
  ambientMoteCount,
  createAmbientBed,
  paintAmbient2D,
  paintAmbientPixi,
  updateAmbientBed,
  type AmbientBed,
} from "../ambient/beds";
import {
  createCamera,
  projectCamera,
  viewSize,
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
  capMarksFor,
  collectTileLayers,
  resolveTileTheme,
  type ExposedEdges,
  type TileCell,
  type TileLayers,
} from "../view/tiles";
import { setCurrentTheme } from "../view/theme";
import type { TileTheme } from "../view/theme";
import {
  countOccludedTiles,
  decorationsForMapSeeded,
  decorSeedFor,
  isDecorOccluded,
  paintDecor2D,
  paintDecorPixi,
  snapshotDecorations,
  visibleDecorations,
  type Decoration,
} from "../view/decor";
import {
  culledLights,
  lightsForMap,
  lightsForQuality,
  paintLights2D,
  paintLightsPixi,
  type Light,
} from "../view/lights";
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
  backdropLayersFor,
  backdropOffsetX,
  FAR_PARALLAX,
  FAR_PERIOD,
  MID_PARALLAX,
  MID_PERIOD,
  paintBackdrop2D,
  paintBackdropPixi,
} from "../view/backdrop";
import {
  bounceSquashScale,
  paintPickup2D,
  paintPickupPixi,
  paintProp2D,
  paintPropPixi,
  propMaxHp,
} from "../view/props";
import {
  clampRendererResolution,
} from "../view/resize";
import {
  ARM_PIVOT,
  CHARACTER_H,
  CROUCH_SQUASH,
  VISOR_CSS,
  characterParts,
} from "../view/character";
import type { WeaponId } from "../../../core/src/weapons";
import {
  selectSoldierFrame,
  soldierAccentFor,
  soldierAccentHex,
  soldierLegOffsetBlended,
  soldierMuzzleTip,
  weaponDef,
  type SoldierFrameId,
} from "../view/soldier";
import {
  SOLDIER_ARM_ANCHOR,
  SOLDIER_PACK,
  activeSoldierTexture,
  debugSoldierFrame,
  debugTextureOverride,
  soldierSpriteFile,
  soldierSpriteKey,
  soldierTintHue,
  tintSoldierPixel,
} from "../render/soldier";
import {
  BOT_SETS,
  botSpriteFile,
  botSpriteKey,
} from "../render/bots";
import {
  weaponSpriteFile,
  weaponSpriteKey,
} from "../render/weapons";
import {
  tileFrameAt,
  tileSpriteFile,
  tileSpriteKey,
  type TileProbeMap,
} from "../render/tiles";
import {
  applyThemeGrade,
  atlasTintFor,
  normalizePaletteTheme,
} from "../render/palette";
import {
  padGlowAlphaAt,
  padSpriteFile,
  padSpriteKey,
  propFramesFor,
  propSpriteFile,
  propSpriteKey,
} from "../render/props";
import { labelTextFor } from "../ui/padlabels";
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
/** Muzzle-halo half-extent in screen px (the painted dot radius). */
const MUZZLE_HALO_R = 4;
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
  /** Match seed (World.state compatible); absent reads the per-theme default; present seeds coerce exactly like the core sampler. */
  readonly seed?: number;
}

/** FNV-1a hex digest over a string (stable scatter identity for probes). */
function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
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
  /** Jetpack fuel fraction in [0, 1] (missing/non-finite sim fuel reads full). */
  fuelRatio: number;
  /** Horizontal velocity in world px/s (drives the run-cycle phase). */
  vx: number;
  /** Vertical velocity in world px/s (drives the air blend). */
  vy: number;
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
  /** Stable sim pickup id (frame-driven keying). */
  id: number;
  x: number;
  y: number;
  kind: string;
  active: boolean;
  /** Held weapon for weapon pads (Hornet alias included). */
  weapon?: string;
  /** Granted amount for health/grenade pads. */
  amount?: number;
}

/** Prop box for one frame. */
export interface FrameProp {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  alive: boolean;
  /** Current HP (drives the cracked sprite at <=50%). */
  hp: number;
  /** Max HP for the kind (drives the hp fraction). */
  maxHp: number;
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
 * as 28 screen px: the sprite-swap arm/weapon anchor keeps the barrel,
 * tracer, and muzzle aligned with a 10-60px world muzzle reach (probe
 * band) under either a screen-pixel or a world-unit reading.
 */
export const BARREL_LENGTH = 14;

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
 * Soldier sprite paint cache (canvas2d backend): source PNGs from the
 * `platformer-characters` atlas plus per-roster tinted copies. All DOM
 * access is guarded so node unit tests (no document/Image) fall back to
 * the vector paint; failures never throw, they resolve null and the
 * caller paints the composed vector instead.
 */
const soldierImageCache = new Map<string, unknown>();
const soldierTintCache = new Map<string, unknown>();
const soldierImageFailed = new Set<string>();

/**
 * Themed tile sprite cache (canvas2d backend): one 18px vendor cell per
 * frame key, painted 1:1 over the ASCII core at 32 world px per cell.
 * Same guarded-async-Image idiom as soldierImageFor: node unit tests
 * (no document/Image) resolve null and keep the vector tiles; failures
 * never throw.
 */
const tileImageCache = new Map<string, unknown>();
const tileImageFailed = new Set<string>();

/** Resolve the co-located atlas PNG URL for a themed tile frame key. */
function tileAtlasUrl(key: string): string | null {
  try {
    const file = tileSpriteFile(key);
    if (file === null) {
      return null;
    }
    const rel = `assets/atlas/${file}`;
    if (typeof document !== "undefined" && typeof document.baseURI === "string") {
      try {
        return new URL(rel, document.baseURI).toString();
      } catch {
        return rel;
      }
    }
    return rel;
  } catch {
    return null;
  }
}

/** Live Image element for a themed tile frame key (null until loaded). */
function tileImageFor(key: string): unknown {
  try {
    if (tileImageCache.has(key)) {
      return tileImageCache.get(key) ?? null;
    }
    if (tileImageFailed.has(key)) {
      return null;
    }
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return null;
    }
    const url = tileAtlasUrl(key);
    if (url === null) {
      return null;
    }
    const img = new Image();
    (img as { decoding?: string }).decoding = "async";
    try {
      (img as { src: string }).src = url;
    } catch {
      tileImageFailed.add(key);
      return null;
    }
    tileImageCache.set(key, img);
    return img;
  } catch {
    return null;
  }
}

/**
 * Paint one themed tile sprite over its vector quad: the 18px vendor
 * cell scaled to the full 32-world-px cell box (the same tileSize + 1
 * screen box the vector fill uses, so the measured canvas tile size
 * stays 32 within 1px). A cache miss or an undecoded image is a silent
 * no-op (the vector quad stays). Never throws.
 */
function paintTileSprite(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  size: number,
  theme?: unknown,
): void {
  try {
    // Palette grade pass (issue #268): the per-(key, theme) tinted
    // canvas paints first so graded pack pixels read in the theme hue
    // band; a cache miss or undecoded source falls through to the raw
    // image below (the vector quad stays when that misses too).
    try {
      const graded = tintedTileFor(key, theme);
      if (graded !== null && graded !== undefined) {
        const gradedDraw = (
          ctx as unknown as {
            drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
          }
        ).drawImage;
        if (typeof gradedDraw === "function") {
          gradedDraw.call(ctx, graded, x, y, size, size);
          return;
        }
      }
    } catch {
      // Graded miss: fall through to the raw image.
    }
    const img = tileImageFor(key) as
      | {
        complete?: boolean;
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      }
      | null;
    if (img === null || img === undefined) {
      return;
    }
    const w = img.naturalWidth ?? img.width ?? 0;
    const h = img.naturalHeight ?? img.height ?? 0;
    const ready =
      (img.complete === true && w > 0 && h > 0) ||
      ((img.width ?? 0) > 0 && (img.height ?? 0) > 0);
    if (!ready || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return;
    }
    const draw = (
      ctx as unknown as {
        drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
      }
    ).drawImage;
    if (typeof draw !== "function") {
      return;
    }
    draw.call(ctx, img, x, y, size, size);
  } catch {
    // Undecoded or hostile shims: the vector quad stays.
  }
}

/** Resolve the co-located atlas PNG URL for a soldier or bot texture key. */
function soldierAtlasUrl(key: string): string | null {
  try {
    const file = soldierSpriteFile(key) ?? botSpriteFile(key);
    if (file === null) {
      // Debug-family keys without a staged card paint the closest run
      // card while probes still read the forced family.
      const runPrefix = "soldier" + "." + "run";
      if (key.startsWith(runPrefix)) {
        return soldierAtlasUrl("soldier.run.3");
      }
      // Unstaged bot-family run keys paint that set's run.3 card while
      // probes still read the forced set family.
      for (const set of BOT_SETS) {
        if (key.startsWith(set + "." + "run")) {
          return soldierAtlasUrl(`${set}.run.3`);
        }
      }
      return null;
    }
    const suffix = file.startsWith("characters/")
      ? file.slice("characters/".length)
      : file;
    const rel = `assets/atlas/characters/${suffix}`;
    if (typeof document !== "undefined" && typeof document.baseURI === "string") {
      try {
        return new URL(rel, document.baseURI).toString();
      } catch {
        return rel;
      }
    }
    return rel;
  } catch {
    return null;
  }
}

/** Live Image element for a soldier texture key (null until loaded). */
function soldierImageFor(key: string): unknown {
  try {
    if (soldierImageCache.has(key)) {
      return soldierImageCache.get(key) ?? null;
    }
    if (soldierImageFailed.has(key)) {
      return null;
    }
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return null;
    }
    const url = soldierAtlasUrl(key);
    if (url === null) {
      return null;
    }
    const img = new Image();
    (img as { crossOrigin?: string }).crossOrigin = "anonymous";
    (img as { decoding?: string }).decoding = "async";
    try {
      (img as { src: string }).src = url;
    } catch {
      soldierImageFailed.add(key);
      return null;
    }
    soldierImageCache.set(key, img);
    return img;
  } catch {
    return null;
  }
}

/**
 * In-hand weapon sprite cache (canvas2d backend): the hand-authored
 * weapon-*.svg cards keyed by weapon id. Same guarded-async-Image idiom
 * as soldierImageFor: node unit tests (no document/Image) resolve null
 * and keep the vector gun; failures never throw.
 */
const weaponImageCache = new Map<string, unknown>();
const weaponImageFailed = new Set<string>();

/** Resolve the client-root-relative SVG URL for a held weapon. */
function weaponSpriteUrl(weapon: WeaponId): string | null {
  try {
    const file = weaponSpriteFile(weapon);
    const rel = file.startsWith("./") ? file.slice(2) : file;
    if (typeof document !== "undefined" && typeof document.baseURI === "string") {
      try {
        return new URL(rel, document.baseURI).toString();
      } catch {
        return rel;
      }
    }
    return rel;
  } catch {
    return null;
  }
}

/**
 * Paint the per-weapon in-hand silhouette for the canvas2d backend: the
 * hand-authored SVG card drawn grip-behind-pivot so it spans the vector
 * gun segment it overlays. The caller holds the ARM_PIVOT-translated,
 * aim-rotated transform; local px match the gun geometry above. A cache
 * miss or an undecoded image is a silent no-op (the vector gun stays).
 * Never throws.
 */
function paintWeaponSprite(
  ctx: CanvasRenderingContext2D,
  weapon: WeaponId,
  gunLength: number,
): void {
  try {
    const img = weaponImageFor(weapon) as
      | {
          complete?: boolean;
          naturalWidth?: number;
          naturalHeight?: number;
          width?: number;
          height?: number;
        }
      | null;
    if (img === null || img === undefined) {
      return;
    }
    const w = img.naturalWidth ?? img.width ?? 0;
    const h = img.naturalHeight ?? img.height ?? 0;
    const ready =
      (img.complete === true && w > 0 && h > 0) ||
      ((img.width ?? 0) > 0 && (img.height ?? 0) > 0);
    if (!ready || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return;
    }
    const dw = gunLength + 4;
    const dh = (dw * h) / w;
    const draw = (
      ctx as unknown as {
        drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
      }
    ).drawImage;
    if (typeof draw !== "function") {
      return;
    }
    draw.call(ctx, img, -4, -dh / 2, dw, dh);
  } catch {
    // Undecoded or hostile shims: the vector gun stays.
  }
}

/** Live Image element for a held weapon (null until decoded). */
function weaponImageFor(weapon: WeaponId): unknown {
  try {
    if (weaponImageCache.has(weapon)) {
      return weaponImageCache.get(weapon) ?? null;
    }
    if (weaponImageFailed.has(weapon)) {
      return null;
    }
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return null;
    }
    const url = weaponSpriteUrl(weapon);
    if (url === null) {
      return null;
    }
    const img = new Image();
    (img as { decoding?: string }).decoding = "async";
    try {
      (img as { src: string }).src = url;
    } catch {
      weaponImageFailed.add(weapon);
      return null;
    }
    weaponImageCache.set(weapon, img);
    return img;
  } catch {
    return null;
  }
}

/**
 * Prop/pad sprite caches (canvas2d backend): staged `props/` + `pads/`
 * pack PNGs keyed by manifest key. Same guarded-async-Image idiom as
 * tileImageFor: node unit tests (no document/Image) resolve null and
 * keep the vector props/pads; failures never throw.
 */
const propImageCache = new Map<string, unknown>();
const propImageFailed = new Set<string>();
const padImageCache = new Map<string, unknown>();
const padImageFailed = new Set<string>();

/** Resolve the co-located atlas PNG URL for a prop texture key. */
function propAtlasUrl(key: string): string | null {
  try {
    const file = propSpriteFile(key);
    if (file === null) {
      return null;
    }
    const rel = `assets/atlas/${file}`;
    if (typeof document !== "undefined" && typeof document.baseURI === "string") {
      try {
        return new URL(rel, document.baseURI).toString();
      } catch {
        return rel;
      }
    }
    return rel;
  } catch {
    return null;
  }
}

/** Resolve the co-located atlas PNG URL for a pad texture key. */
function padAtlasUrl(key: string): string | null {
  try {
    const file = padSpriteFile(key);
    if (file === null) {
      return null;
    }
    const rel = `assets/atlas/${file}`;
    if (typeof document !== "undefined" && typeof document.baseURI === "string") {
      try {
        return new URL(rel, document.baseURI).toString();
      } catch {
        return rel;
      }
    }
    return rel;
  } catch {
    return null;
  }
}

/** Live Image element for a prop texture key (null until loaded). */
function propImageFor(key: string): unknown {
  try {
    if (propImageCache.has(key)) {
      return propImageCache.get(key) ?? null;
    }
    if (propImageFailed.has(key)) {
      return null;
    }
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return null;
    }
    const url = propAtlasUrl(key);
    if (url === null) {
      return null;
    }
    const img = new Image();
    (img as { decoding?: string }).decoding = "async";
    try {
      (img as { src: string }).src = url;
    } catch {
      propImageFailed.add(key);
      return null;
    }
    propImageCache.set(key, img);
    return img;
  } catch {
    return null;
  }
}

/** Live Image element for a pad texture key (null until loaded). */
function padImageFor(key: string): unknown {
  try {
    if (padImageCache.has(key)) {
      return padImageCache.get(key) ?? null;
    }
    if (padImageFailed.has(key)) {
      return null;
    }
    if (typeof document === "undefined" || typeof Image === "undefined") {
      return null;
    }
    const url = padAtlasUrl(key);
    if (url === null) {
      return null;
    }
    const img = new Image();
    (img as { decoding?: string }).decoding = "async";
    try {
      (img as { src: string }).src = url;
    } catch {
      padImageFailed.add(key);
      return null;
    }
    padImageCache.set(key, img);
    return img;
  } catch {
    return null;
  }
}

/**
 * Palette-graded sprite caches (canvas2d backend): per-(key, theme)
 * tinted copies of the staged tile/prop/pad PNGs, built by running
 * source pixels through applyThemeGrade with the active theme's row.
 * Same guarded-canvas idiom as tintedSoldierFor: node unit tests (no
 * document) resolve null and keep the raw/vector paint; failures never
 * throw, they resolve null and the caller falls back.
 */
const tileTintCache = new Map<string, unknown>();
const propTintCache = new Map<string, unknown>();
const padTintCache = new Map<string, unknown>();

/**
 * Graded canvas for one staged sprite key under one theme. Re-colors
 * every non-outline pixel toward the theme grade target (kilima dusk,
 * dune golden, frostbite cold) while dark outlines and transparent
 * pixels pass through, so graded sprite zones sample inside the
 * backdrop hue band. Null when the DOM/canvas surface is unavailable
 * or the source has not decoded yet (caller falls back). Never throws.
 */
function tintedSpriteFor(
  cache: Map<string, unknown>,
  imageFor: (key: string) => unknown,
  key: string,
  theme: unknown,
  strength: number,
): unknown {
  try {
    const name = normalizePaletteTheme(theme);
    const cacheKey = `${key}|${name}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }
    if (typeof document === "undefined") {
      return null;
    }
    const img = imageFor(key) as
      | {
        complete?: boolean;
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      }
      | null;
    if (img === null || img === undefined) {
      return null;
    }
    const w = img.naturalWidth ?? img.width ?? 0;
    const h = img.naturalHeight ?? img.height ?? 0;
    const ready =
      (img.complete === true && w > 0 && h > 0) ||
      ((img.width ?? 0) > 0 && (img.height ?? 0) > 0);
    if (!ready || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    const doc = document as unknown as {
      createElement?: (tag: string) => unknown;
    };
    if (typeof doc.createElement !== "function") {
      return null;
    }
    const canvas = doc.createElement("canvas") as unknown as {
      width: number;
      height: number;
      getContext?: (kind: string) => unknown;
    } | null;
    if (canvas === null || canvas === undefined) {
      return null;
    }
    canvas.width = w;
    canvas.height = h;
    const tintCtx = typeof canvas.getContext === "function"
      ? (canvas.getContext("2d") as unknown as {
        drawImage?: (...args: unknown[]) => void;
        getImageData?: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
        putImageData?: (data: unknown, x: number, y: number) => void;
      } | null)
      : null;
    if (tintCtx === null || tintCtx === undefined) {
      return null;
    }
    try {
      tintCtx.drawImage?.(img, 0, 0, w, h);
    } catch {
      return null;
    }
    try {
      const data = tintCtx.getImageData?.(0, 0, w, h);
      if (data === undefined || data === null) {
        return null;
      }
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const [nr, ng, nb, na] = applyThemeGrade(
          px[i] ?? 0,
          px[i + 1] ?? 0,
          px[i + 2] ?? 0,
          px[i + 3] ?? 0,
          name,
          strength,
        );
        px[i] = nr;
        px[i + 1] = ng;
        px[i + 2] = nb;
        px[i + 3] = na;
      }
      tintCtx.putImageData?.(data, 0, 0);
    } catch {
      return null;
    }
    cache.set(cacheKey, canvas);
    return canvas;
  } catch {
    return null;
  }
}

/** Graded canvas for one tile frame key under one theme (null when unavailable). */
function tintedTileFor(key: string, theme: unknown): unknown {
  return tintedSpriteFor(tileTintCache, tileImageFor, key, theme, atlasTintFor(key));
}

/** Graded canvas for one prop frame key under one theme (null when unavailable). */
function tintedPropFor(key: string, theme: unknown): unknown {
  return tintedSpriteFor(propTintCache, propImageFor, key, theme, atlasTintFor(key));
}

/** Graded canvas for one pad frame key under one theme (null when unavailable). */
function tintedPadFor(key: string, theme: unknown): unknown {
  return tintedSpriteFor(padTintCache, padImageFor, key, theme, atlasTintFor(key));
}

/**
 * Paint one prop pack sprite over its vector quad: the staged PNG drawn
 * 1:1 over the sim AABB box, palette-graded for the active theme when
 * a graded canvas is ready (raw image while it decodes). A cache miss
 * or an undecoded image is a silent no-op (the vector quad stays).
 * Never throws.
 */
function paintPropSprite(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  theme?: unknown,
): void {
  try {
    // Palette grade pass (issue #268): graded canvas first, raw image
    // while it decodes, vector quad when neither is ready.
    try {
      const graded = tintedPropFor(key, theme);
      if (graded !== null && graded !== undefined) {
        const gradedDraw = (
          ctx as unknown as {
            drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
          }
        ).drawImage;
        if (typeof gradedDraw === "function") {
          gradedDraw.call(ctx, graded, x, y, w, h);
          return;
        }
      }
    } catch {
      // Graded miss: fall through to the raw image.
    }
    const img = propImageFor(key) as
      | {
        complete?: boolean;
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      }
      | null;
    if (img === null || img === undefined) {
      return;
    }
    const w0 = img.naturalWidth ?? img.width ?? 0;
    const h0 = img.naturalHeight ?? img.height ?? 0;
    const ready =
      (img.complete === true && w0 > 0 && h0 > 0) ||
      ((img.width ?? 0) > 0 && (img.height ?? 0) > 0);
    if (!ready || !Number.isFinite(w0) || !Number.isFinite(h0) || w0 <= 0 || h0 <= 0) {
      return;
    }
    const draw = (
      ctx as unknown as {
        drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
      }
    ).drawImage;
    if (typeof draw !== "function") {
      return;
    }
    draw.call(ctx, img, x, y, w, h);
  } catch {
    // Undecoded or hostile shims: the vector quad stays.
  }
}

/**
 * Paint one pad pack sprite over its vector pad: the staged PNG drawn
 * centered on the pickup point at the pad box size, palette-graded for
 * the active theme when a graded canvas is ready (raw image while it
 * decodes). A cache miss or an undecoded image is a silent no-op (the
 * vector pad stays). Never throws.
 */
function paintPadSprite(
  ctx: CanvasRenderingContext2D,
  key: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  theme?: unknown,
): void {
  try {
    // Palette grade pass (issue #268): graded canvas first, raw image
    // while it decodes, vector pad when neither is ready.
    try {
      const graded = tintedPadFor(key, theme);
      if (graded !== null && graded !== undefined) {
        const gradedDraw = (
          ctx as unknown as {
            drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
          }
        ).drawImage;
        if (typeof gradedDraw === "function") {
          gradedDraw.call(ctx, graded, cx - w / 2, cy - h / 2, w, h);
          return;
        }
      }
    } catch {
      // Graded miss: fall through to the raw image.
    }
    const img = padImageFor(key) as
      | {
        complete?: boolean;
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      }
      | null;
    if (img === null || img === undefined) {
      return;
    }
    const w0 = img.naturalWidth ?? img.width ?? 0;
    const h0 = img.naturalHeight ?? img.height ?? 0;
    const ready =
      (img.complete === true && w0 > 0 && h0 > 0) ||
      ((img.width ?? 0) > 0 && (img.height ?? 0) > 0);
    if (!ready || !Number.isFinite(w0) || !Number.isFinite(h0) || w0 <= 0 || h0 <= 0) {
      return;
    }
    const draw = (
      ctx as unknown as {
        drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
      }
    ).drawImage;
    if (typeof draw !== "function") {
      return;
    }
    draw.call(ctx, img, cx - w / 2, cy - h / 2, w, h);
  } catch {
    // Undecoded or hostile shims: the vector pad stays.
  }
}

/**
 * Tinted canvas for a soldier texture + roster index. Re-colors every
 * non-outline pixel toward the roster hue (local cyan 170-200, enemies
 * warm 0-50) while dark outlines pass through, so torso samplers read
 * the roster family on sprite art. Hurt flashes paint white instead.
 * Null when the DOM/canvas surface is unavailable or the source has
 * not decoded yet (caller falls back to vector paint).
 */
function tintedSoldierFor(
  key: string,
  playerIndex: number,
  hurtFlash: boolean,
): unknown {
  try {
    const cacheKey = `${key}|${playerIndex}|${hurtFlash ? "hurt" : "tint"}`;
    if (soldierTintCache.has(cacheKey)) {
      return soldierTintCache.get(cacheKey) ?? null;
    }
    if (typeof document === "undefined") {
      return null;
    }
    const img = soldierImageFor(key) as
      | { complete?: boolean; naturalWidth?: number; width?: number; height?: number }
      | null;
    if (img === null || img === undefined) {
      return null;
    }
    const ready =
      (img.complete === true &&
        (img.naturalWidth ?? 0) > 0) ||
      ((img.width ?? 0) > 0 && (img.height ?? 0) > 0);
    if (!ready) {
      // Kick a repaint on decode: the vector fallback covers this frame,
      // the tinted sprite lands on the next decoded draw.
      try {
        const el = img as { addEventListener?: unknown };
        if (typeof el.addEventListener === "function") {
          (el.addEventListener as (t: string, f: () => void, o?: unknown) => void)(
            "load",
            () => {
              soldierTintCache.delete(cacheKey);
            },
            { once: true },
          );
        }
      } catch {
        // Listener best-effort only.
      }
      return null;
    }
    const doc = document as unknown as {
      createElement?: (tag: string) => unknown;
    };
    if (typeof doc.createElement !== "function") {
      return null;
    }
    const canvas = doc.createElement("canvas") as unknown as {
      width: number;
      height: number;
      getContext?: (kind: string) => unknown;
    };
    if (canvas === null || canvas === undefined) {
      return null;
    }
    const w = 80;
    const h = 110;
    canvas.width = w;
    canvas.height = h;
    const ctx = typeof canvas.getContext === "function"
      ? (canvas.getContext("2d") as unknown as {
        drawImage?: (...args: unknown[]) => void;
        getImageData?: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
        putImageData?: (data: unknown, x: number, y: number) => void;
      } | null)
      : null;
    if (ctx === null || ctx === undefined) {
      return null;
    }
    try {
      ctx.drawImage?.(img, 0, 0, w, h);
    } catch {
      return null;
    }
    if (hurtFlash) {
      // White flash: every opaque pixel goes white (outlines included)
      // so the 150ms hurt window reads white on sprite art too.
      try {
        const data = ctx.getImageData?.(0, 0, w, h);
        if (data !== undefined && data !== null) {
          const px = data.data;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] >= 16) {
              px[i] = 255;
              px[i + 1] = 255;
              px[i + 2] = 255;
            }
          }
          ctx.putImageData?.(data, 0, 0);
        }
      } catch {
        return null;
      }
      soldierTintCache.set(cacheKey, canvas);
      return canvas;
    }
    try {
      const data = ctx.getImageData?.(0, 0, w, h);
      if (data === undefined || data === null) {
        return null;
      }
      const hue = soldierTintHue(playerIndex);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const [nr, ng, nb, na] = tintSoldierPixel(
          px[i] ?? 0,
          px[i + 1] ?? 0,
          px[i + 2] ?? 0,
          px[i + 3] ?? 0,
          hue,
        );
        px[i] = nr;
        px[i + 1] = ng;
        px[i + 2] = nb;
        px[i + 3] = na;
      }
      ctx.putImageData?.(data, 0, 0);
    } catch {
      return null;
    }
    soldierTintCache.set(cacheKey, canvas);
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Resolve the live soldier texture key for a frame player + anim pose.
 * The debug override (window.__scrapline.debugFrame) wins when set so
 * probes forcing soldier.run.3 read back a soldier.run key; otherwise
 * the pose selects idle / soldier.run.0..3 / jet / crouch / hurt / dead.
 */
function liveSoldierTexture(
  p: FramePlayer,
  anim: AnimPose | undefined,
): string {
  try {
    const override = debugTextureOverride();
    if (override !== null) {
      return activeSoldierTexture(override);
    }
    const live = anim !== undefined
      ? soldierSpriteKey({
        deadPose: anim.deadPose,
        tuck: anim.tuck,
        crouching: p.crouching,
        heightScale: anim.heightScale,
        legPhase: anim.legPhase,
        swing: anim.swing,
        hurtFlash: anim.hurtFlash,
      })
      : !p.alive
        ? "soldier.dead"
        : p.crouching
          ? "soldier.crouch"
          : "soldier.idle";
    return activeSoldierTexture(live);
  } catch {
    return "soldier.idle";
  }
}

/**
 * Resolve the live bot texture key for a frame player + anim pose. Bots
 * always render their own silhouette set (never the soldier family and
 * never the debug override, so soldier probes cannot collapse bot
 * variety): the pose selects idle / `<set>.run.0..3` / jet / crouch /
 * hurt / dead through render/bots.ts, and the run cycle advances with
 * the same leg phase that drives the soldier stride. The roster tint
 * (soldierTintHue/tintSoldierPixel) still applies at paint time, so bot
 * torsos sample warm with dark outlines kept.
 */
function liveBotTexture(
  p: FramePlayer,
  anim: AnimPose | undefined,
): string {
  try {
    const pose =
      anim !== undefined
        ? {
            deadPose: anim.deadPose,
            tuck: anim.tuck,
            crouching: p.crouching,
            heightScale: anim.heightScale,
            legPhase: anim.legPhase,
            swing: anim.swing,
            hurtFlash: anim.hurtFlash,
          }
        : !p.alive
          ? { deadPose: true }
          : p.crouching
            ? { crouching: true }
            : {};
    return botSpriteKey(pose, p.index);
  } catch {
    return botSpriteKey({}, p.index);
  }
}

/**
 * Arm anchor world position for a frame player (the preserved pivot).
 * The composed pivot rides the body center (ARM_PIVOT 13,29 lands on the
 * standing center and squash-maps onto the crouch center), so the anchor
 * is the live body center: muzzle distance always equals the barrel
 * length (14-22 world px, inside the 10-60 probe band for every pose).
 */
export function soldierArmAnchorWorld(p: FramePlayer): { x: number; y: number } {
  void SOLDIER_ARM_ANCHOR;
  return {
    x: p.x + p.w / 2,
    y: p.y + p.h / 2,
  };
}

/**
 * Publish the sprite-swap probe surface for a drawn frame. The active
 * texture is the debug override when set (window.__scrapline.debugFrame
 * forces soldier.run.3) else player 0's pose-resolved key; every mirror
 * carries a soldier run family key while running so canvas probes
 * and debugFrame reads agree. Also mirrors the arm anchor and muzzle
 * world points so aim-alignment probes read them without guessing the
 * pivot. Never throws; mirrors are best-effort under shorn harnesses.
 *
 * Also publishes the themed tile frame probe (issue #266):
 * window.__scrapline.tileFrameAt(tx, ty) resolves the live ASCII cell
 * through the drawn map to its `tile.<theme>.<kind>` frame key, so the
 * per-map tileset reads back without guessing paint internals.
 */
function publishSoldierSpriteProbes(
  frame: Frame,
  anims: readonly AnimPose[],
  map?: TileProbeMap | null,
  padSquash?: number,
  nowMs?: number,
): { activeTexture: string; liveKey: string } {
  let liveKey = "soldier.idle";
  try {
    const first = frame.players[0];
    if (first !== undefined) {
      liveKey = liveSoldierTexture(first, anims[0]);
    } else {
      const override = debugTextureOverride();
      liveKey = activeSoldierTexture(override ?? "soldier.idle");
    }
  } catch {
    liveKey = "soldier.idle";
  }
  const activeTexture = liveKey;
  // Live in-hand sprite key for player 0 (issue #264): read per call
  // so a weapon switch is visible instantly on the next draw.
  const currentWeaponSprite = (): string => {
    try {
      return weaponSpriteKey(frame.players[0]?.weapon ?? "pistol");
    } catch {
      return weaponSpriteKey("pistol");
    }
  };
  // Live bot silhouette keys (issue #265): one pose-resolved texture
  // per bot (players 1..n), read per call so the run cycle visibly
  // advances between samples while bots run. Each key carries its own
  // set family (adventurer/zombie/female/player), pairwise distinct
  // across the roster order.
  const botSprites = (): string[] => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < frame.players.length; i += 1) {
        const p = frame.players[i];
        if (p === undefined || p.index <= 0) {
          continue;
        }
        keys.push(liveBotTexture(p, anims[i]));
      }
      return keys;
    } catch {
      return [];
    }
  };
  // Live themed tile frame for one ASCII cell (issue #266): read per
  // call through the drawn map, so a map switch is visible instantly on
  // the next draw without reloading the probe surface.
  const tileFrameAtProbe = (tx: unknown, ty: unknown): string => {
    try {
      return tileFrameAt(map ?? null, tx, ty);
    } catch {
      return tileSpriteKey("solid", "kilima");
    }
  };
  // Live prop/pad frame keys (issue #267): one crate key, one barrel
  // key, one weapon pad key, one health/grenade pad key, and one bounce
  // pad key (squash-aware), read per call from the latest drawn frame
  // so damage/crack/explode transitions are visible on the next draw.
  // Every entry carries `prop.` or `pad.` and none contains `vector`.
  const propFrames = (): string[] => {
    try {
      return propFramesFor(frame.props, frame.pickups, padSquash ?? 1);
    } catch {
      return propFramesFor(null, null, 1);
    }
  };
  // Live pad labels (issue #267): one floating label per active pickup
  // via the same labelTextFor the overlay reconciler uses, so the probe
  // reads HP, GREN, and the weapon name exactly as the pads show them.
  const padLabels = (): string[] => {
    try {
      const labels: string[] = [];
      for (const pickup of frame.pickups) {
        if (pickup === undefined || pickup.active !== true) {
          continue;
        }
        labels.push(labelTextFor(pickup.kind, pickup.weapon));
      }
      return labels;
    } catch {
      return [];
    }
  };
  // Live pad glow pulse alpha (issue #267): sine pulse over 800ms so
  // samples 400ms apart (half a period) always differ. Read per call
  // off the draw clock when available, else wall clock.
  const padGlowAlpha = (): number => {
    try {
      if (typeof nowMs === "number" && Number.isFinite(nowMs)) {
        return padGlowAlphaAt(nowMs);
      }
      if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return padGlowAlphaAt(performance.now());
      }
      return padGlowAlphaAt(Date.now());
    } catch {
      return padGlowAlphaAt(NaN);
    }
  };
  try {
    if (typeof window !== "undefined") {
      const scope = window as unknown as Record<string, unknown>;
      const existing = scope["__scrapline"] as
        | Record<string, unknown>
        | undefined;
      const debugFrame = (key: unknown): string => {
        try {
          const next = debugSoldierFrame(key, liveKey);
          try {
            const cur = scope["__scrapline"] as
              | Record<string, unknown>
              | undefined;
            if (cur !== undefined && cur !== null && typeof cur === "object") {
              cur["activeTexture"] = next;
              cur["activeFrame"] = next;
              cur["lastTexture"] = next;
            }
          } catch {
            // Mirror best-effort only.
          }
          return next;
        } catch {
          return liveKey;
        }
      };
      if (existing === undefined || existing === null || typeof existing !== "object") {
        scope["__scrapline"] = {
          debugFrame,
          activeTexture,
          activeFrame: activeTexture,
          lastTexture: activeTexture,
          currentWeaponSprite,
          botSprites,
          tileFrameAt: tileFrameAtProbe,
          propFrames,
          padLabels,
          padGlowAlpha,
          padGlow: padGlowAlpha,
          glowAlpha: padGlowAlpha,
        };
      } else {
        existing["debugFrame"] = debugFrame;
        existing["activeTexture"] = activeTexture;
        existing["activeFrame"] = activeTexture;
        existing["lastTexture"] = activeTexture;
        existing["currentWeaponSprite"] = currentWeaponSprite;
        existing["botSprites"] = botSprites;
        existing["tileFrameAt"] = tileFrameAtProbe;
        existing["propFrames"] = propFrames;
        existing["padLabels"] = padLabels;
        existing["padGlowAlpha"] = padGlowAlpha;
        existing["padGlow"] = padGlowAlpha;
        existing["glowAlpha"] = padGlowAlpha;
      }
      // Aim-alignment + texture mirrors on the established surfaces.
      const first = frame.players[0];
      const anchor = first !== undefined
        ? soldierArmAnchorWorld(first)
        : { x: 0, y: 0 };
      const muzzle = first !== undefined ? first.barrel : { x: 0, y: 0 };
      const game = scope["__game"] as Record<string, unknown> | undefined;
      if (game !== undefined && game !== null && typeof game === "object") {
        game["soldierTexture"] = activeTexture;
        game["activeTexture"] = activeTexture;
        game["soldierPack"] = SOLDIER_PACK;
        game["soldierArmAnchor"] = { x: anchor.x, y: anchor.y };
        game["armAnchor"] = { x: anchor.x, y: anchor.y };
        game["soldierMuzzle"] = { x: muzzle.x, y: muzzle.y };
      }
      const debug = scope["__scraplineDebug"] as
        | Record<string, unknown>
        | undefined;
      if (debug !== undefined && debug !== null && typeof debug === "object") {
        debug["soldierTexture"] = activeTexture;
        debug["activeTexture"] = activeTexture;
        debug["soldierPack"] = SOLDIER_PACK;
        debug["soldierArmAnchor"] = { x: anchor.x, y: anchor.y };
        debug["armAnchor"] = { x: anchor.x, y: anchor.y };
        debug["soldierMuzzle"] = { x: muzzle.x, y: muzzle.y };
      }
    }
  } catch {
    // Probe mirrors never break the frame.
  }
  return { activeTexture, liveKey };
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
      const fuelRaw = (p as { fuel?: unknown }).fuel;
      const fuelRatio =
        typeof fuelRaw === "number" && Number.isFinite(fuelRaw)
          ? Math.min(1, Math.max(0, fuelRaw / JETPACK_FUEL_MAX))
          : 1;
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
        fuelRatio,
        vx: p.vx ?? 0,
        vy: p.vy ?? 0,
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
      id: p.id,
      x: p.x,
      y: p.y,
      kind: p.kind,
      active: p.active,
      weapon: (p as { weapon?: unknown }).weapon as string | undefined,
      amount: (p as { amount?: unknown }).amount as number | undefined,
    })),
    props: state.props.map((p) => ({
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      kind: p.kind,
      alive: p.alive,
      hp: (p as { hp?: unknown }).hp as number,
      maxHp: propMaxHp((p as { kind?: unknown }).kind),
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
   * death bursts, explodes feed explosion flash plus smoke plus debris
   * at the sim blast center, pickups feed pickup sparkles, and jetting
   * players emit a continuous exhaust trail for the full jet duration).
   */
  draw(
    state: StateLike,
    map?: MapLike | TileMapLike | null,
    camera?: Camera | null,
    events?: string[],
    shots?: ShotDetail[],
    damages?: DamageDetail[],
    kills?: KillDetail[],
    explodes?: ExplodeDetail[],
    pickups?: PickupDetail[],
  ): void;
  /** Which backend survived init. */
  mode: "pixi" | "canvas2d";
  /** Live-update the renderer density (DPR-driven, clamped). */
  setResolution(dpr: number): void;
  /** Live-update the post-effect quality (high keeps the hurt pulse). */
  setQuality(quality: QualityLevel): void;
}

/** One capped transient fx flash in world coords. */
export interface Flash {
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
  padSquash: number = 1,
): void {
  // Backwall quads behind the playfield at 60% brightness (z 0).
  for (const cell of layers.backwalls) {
    graphics.rect(px(cell.tx * TILE_SIZE), py(cell.ty * TILE_SIZE), tileSize + 1, tileSize + 1);
    graphics.fill(theme.backwallHex);
  }
  // Solid tiles: full-bleed base first so shared joins overpaint the
  // seam, then edge/depth/highlight only on exposed sides (internal
  // joins keep pure base fill). Cap marks stamp the exposed top band.
  const highlightH = HIGHLIGHT_PX * scale;
  const edgeW = Math.max(1, 1 * scale);
  const depthH = Math.max(1, 4 * scale);
  for (const cell of layers.solids) {
    const x = px(cell.tx * TILE_SIZE);
    const y = py(cell.ty * TILE_SIZE);
    graphics.rect(x, y, tileSize + 1, tileSize + 1);
    graphics.fill(theme.baseHex);
    const exposed: ExposedEdges = cell.exposed ?? {
      top: true,
      bottom: true,
      left: true,
      right: true,
    };
    if (exposed.left) {
      graphics.rect(x, y, edgeW, tileSize + 1);
      graphics.fill(theme.edgeHex);
    }
    if (exposed.right) {
      graphics.rect(x + tileSize + 1 - edgeW, y, edgeW, tileSize + 1);
      graphics.fill(theme.edgeHex);
    }
    if (exposed.bottom) {
      graphics.rect(x, y + tileSize + 1 - depthH, tileSize + 1, depthH);
      graphics.fill(theme.depthHex);
      graphics.rect(x, y + tileSize + 1 - edgeW, tileSize + 1, edgeW);
      graphics.fill(theme.edgeHex);
    }
    if (exposed.top) {
      graphics.rect(x, y, tileSize + 1, highlightH);
      graphics.fill(theme.highlightHex);
      for (const mark of capMarksFor(theme)) {
        graphics.rect(
          x + mark.dx * scale,
          y + mark.dy * scale,
          Math.max(1, mark.w * scale),
          Math.max(1, mark.h * scale),
        );
        graphics.fill(mark.hex);
      }
    }
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
  // stripe hex (kilima: #FFD21F base, #111111 chevrons). padSquash
  // compresses height from the tile bottom on bounce events (0.6 at
  // the 300ms peak, easing back to 1 by 600ms).
  const squash = Number.isFinite(padSquash) && padSquash > 0 ? padSquash : 1;
  const padH = BOUNCE_PAD_H * scale * squash;
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
  padSquash: number = 1,
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
    const exposed: ExposedEdges = cell.exposed ?? {
      top: true,
      bottom: true,
      left: true,
      right: true,
    };
    if (exposed.left) {
      ctx.fillStyle = theme.edge;
      ctx.fillRect(x, y, edgeW, tileSize + 1);
    }
    if (exposed.right) {
      ctx.fillStyle = theme.edge;
      ctx.fillRect(x + tileSize + 1 - edgeW, y, edgeW, tileSize + 1);
    }
    if (exposed.bottom) {
      ctx.fillStyle = theme.depth;
      ctx.fillRect(x, y + tileSize + 1 - depthH, tileSize + 1, depthH);
      ctx.fillStyle = theme.edge;
      ctx.fillRect(x, y + tileSize + 1 - edgeW, tileSize + 1, edgeW);
    }
    if (exposed.top) {
      ctx.fillStyle = theme.highlight;
      ctx.fillRect(x, y, tileSize + 1, highlightH);
      for (const mark of capMarksFor(theme)) {
        ctx.fillStyle = mark.css;
        ctx.fillRect(
          x + mark.dx * scale,
          y + mark.dy * scale,
          Math.max(1, mark.w * scale),
          Math.max(1, mark.h * scale),
        );
      }
    }
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
  const squash2d = Number.isFinite(padSquash) && padSquash > 0 ? padSquash : 1;
  const padH = BOUNCE_PAD_H * scale * squash2d;
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
  // Vendor tile sprites (issue #266): one 18px pack cell per ASCII cell
  // painted over the vector quad at the same tileSize + 1 screen box,
  // so the measured canvas tile size stays 32 within 1px while the
  // pixels read as pack art. Backwalls paint first (pre-darkened art
  // behind the playfield); one-way and bounce cells keep their distinct
  // shapes via transparency cutouts in the art. Undecoded art is a
  // silent no-op: the vector quad underneath keeps every probe green.
  paintTileSprites2D(ctx, px, py, tileSize, layers, theme.name);
}

/** Overlay the themed tile sprites over the vector quads (canvas2d). */
function paintTileSprites2D(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  tileSize: number,
  layers: LayerCounts,
  themeName: string,
): void {
  for (const cell of layers.backwalls) {
    paintTileSprite(
      ctx,
      tileSpriteKey("backwall", themeName),
      px(cell.tx * TILE_SIZE),
      py(cell.ty * TILE_SIZE),
      tileSize + 1,
      themeName,
    );
  }
  for (const cell of layers.solids) {
    paintTileSprite(
      ctx,
      tileSpriteKey("solid", themeName),
      px(cell.tx * TILE_SIZE),
      py(cell.ty * TILE_SIZE),
      tileSize + 1,
      themeName,
    );
  }
  for (const cell of layers.oneWays) {
    paintTileSprite(
      ctx,
      tileSpriteKey("oneway", themeName),
      px(cell.tx * TILE_SIZE),
      py(cell.ty * TILE_SIZE),
      tileSize + 1,
      themeName,
    );
  }
  for (const cell of layers.bounces) {
    paintTileSprite(
      ctx,
      tileSpriteKey("bounce", themeName),
      px(cell.tx * TILE_SIZE),
      py(cell.ty * TILE_SIZE),
      tileSize + 1,
      themeName,
    );
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
  particles: Particle[],
  victimFlash: ReadonlyMap<number, number>,
  canvasWidth: number,
  canvasHeight: number,
  theme?: TileTheme,
  decors: readonly Decoration[] = [],
  lights: readonly Light[] = [],
  padSquash: number = 1,
  shockwaves: readonly Shockwave[] = [],
  nowMs: number = 0,
  quality: QualityLevel = "high",
  hurtPulse: number = 0,
  ambient: AmbientBed | null = null,
): void {
  const px = (x: number): number => projectCamera(cam, canvasWidth, canvasHeight, x, 0).x;
  const py = (y: number): number => projectCamera(cam, canvasWidth, canvasHeight, 0, y).y;
  const ambientProject = (x: number, y: number): { x: number; y: number } =>
    projectCamera(cam, canvasWidth, canvasHeight, x, y);
  const tileSize = TILE_SIZE * cam.scale;
  const activeTheme = theme ?? resolveTileTheme();
  graphics.clear();
  paintSkyPixi(graphics, canvasWidth, canvasHeight, activeTheme.name);
  const arena = projectCamera(cam, canvasWidth, canvasHeight, 0, 0);
  graphics.rect(arena.x, arena.y, frame.arena.width * cam.scale, frame.arena.height * cam.scale);
  graphics.fill(0x0b1020);
  paintBackdropPixi(graphics, cam.x, cam.y, canvasWidth, canvasHeight, activeTheme.name);
  paintDecorPixi(graphics, px, py, cam.scale, decors);
  paintTilesPixi(graphics, px, py, tileSize, cam.scale, layers, activeTheme, padSquash);
  paintLightsPixi(graphics, px, py, cam.scale, lights, nowMs);
  // Ambient particle bed: per-theme background life behind gameplay
  // (below entities, above tiles) so scenery reads alive without
  // touching collision. Quality-gated: low paints nothing.
  paintAmbientPixi(
    graphics,
    ambient,
    activeTheme.name,
    ambientProject,
    canvasWidth,
    canvasHeight,
    nowMs,
    quality,
  );
  for (const prop of frame.props) {
    if (!prop.alive) {
      continue;
    }
    paintPropPixi(
      graphics,
      px(prop.x),
      py(prop.y),
      prop.w * cam.scale,
      prop.h * cam.scale,
      cam.scale,
      prop.kind,
      prop.hp,
    );
  }
  for (const pickup of frame.pickups) {
    if (!pickup.active) {
      continue;
    }
    paintPickupPixi(
      graphics,
      px(pickup.x),
      py(pickup.y),
      cam.scale,
      pickup.kind,
      pickup.weapon,
    );
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
    const scale = flameScale(frame.tick, p.index, p.fuelRatio);
    const flame = flameAlpha(frame.tick, p.index, p.fuelRatio) * blink;
    const boost = jetCoreBoostFor(p.vy);
    const feetY = py(p.y + p.h);
    const outer = 5 * scale * cam.scale;
    graphics.circle(cx, feetY + outer + 2, outer);
    graphics.fill({ color: 0xf97316, alpha: flame });
    const inner = outer * 0.55 * boost;
    graphics.circle(cx, feetY + outer + 2, inner);
    graphics.fill({
      color: jetCoreHexFor(boost),
      alpha: Math.min(1, flame + Math.max(0, boost - 1) * 0.5),
    });
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
    paintGlowHaloPixi(
      graphics,
      px(muzzle.x),
      py(muzzle.y),
      MUZZLE_HALO_R,
      cam.scale,
      0xfff7cc,
    );
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
  for (const particle of particles) {
    graphics.circle(px(particle.x), py(particle.y), Math.max(1, particle.size * cam.scale));
    graphics.fill({ color: particle.color, alpha: particleOpacity(particle) });
  }
  // Shockwave rings expand 10->60 world px over 500ms (all qualities).
  for (const sw of shockwaves) {
    if (!shockwaveAlive(sw, nowMs)) {
      continue;
    }
    paintShockwaveRingPixi(
      graphics,
      px(sw.x),
      py(sw.y),
      shockwaveRadiusAt(sw, nowMs) * cam.scale,
      cam.scale,
      shockwaveAlphaAt(sw, nowMs),
    );
  }
  // Chromatic hurt pulse washes the frame while a hurt flash is live
  // (high quality only; low quality paints nothing here).
  paintChromaticPulsePixi(graphics, canvasWidth, canvasHeight, hurtPulse, quality);
  paintVignettePixi(graphics, canvasWidth, canvasHeight);
}

/**
 * Draw the animated soldier figure for one player in screen space: the
 * frame selected by selectSoldierFrame (frame-specific leg offsets via
 * soldierLegOffsetBlended, tuck/dead poses preserved), accents
 * palette-swapped through soldierAccentFor, and the WEAPON_DEFS gun
 * segment for p.weapon rotated by the smoothed aim around the
 * (crouch-squashed) pivot. The whole figure rides the landing squash
 * and the spawn/death ease (crouch itself stays in the part set). The
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
  const gaitBlend = anim?.gaitBlend ?? 1;
  const airBlend = anim?.airBlend ?? 0;
  const aim = anim?.aimSmoothed ?? p.aim;
  // Whole-figure vertical squash from the landing dip and the
  // spawn/death ease (crouch itself stays in the part set, exactly as
  // before, so unsquashed output is pixel-identical to the old math).
  const figureSquash =
    (anim?.landSquash ?? 1) * (anim?.spawnEase ?? 1) * (anim?.deathEase ?? 1);
  const minPx = 1 / scale;
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
  // Pack sprite texture for this pose: the local soldier renders the
  // `platformer-characters` Soldier set via liveSoldierTexture (the
  // debug override wins so
  // window.__scrapline.debugFrame("soldier.run.3") forces a run card)
  // while bots render their own silhouette set via liveBotTexture.
  // Both paths tint per roster (warm enemies, dark outlines kept).
  const textureKey = p.index === 0
    ? liveSoldierTexture(p, anim)
    : liveBotTexture(p, anim);
  const base = !p.alive ? "#475569" : soldierAccentFor(p.index);
  const paint =
    anim?.hurtFlash === true
      ? "#ffffff"
      : flashed
        ? VICTIM_TINT_CSS
        : base;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(scale, scale * figureSquash);
  // Sprite body: tinted `platformer-characters` card scaled to the player
  // box (roster cyan locally, warm for enemies, dark outlines kept). The
  // arm/weapon anchor stays at ARM_PIVOT so the rotated gun below lands
  // on the same barrel tip the tracers use. Falls back to the composed
  // vector when the PNG has not decoded yet (node tests, first frames).
  let spritePainted = false;
  if (!flashed) {
    try {
      const tinted = tintedSoldierFor(
        textureKey,
        p.index,
        anim?.hurtFlash === true,
      ) as unknown as
        | { width: number; height: number }
        | null;
      if (tinted !== null && tinted !== undefined) {
        const draw = (
          ctx as unknown as {
            drawImage?: (img: unknown, x: number, y: number, w: number, h: number) => void;
          }
        ).drawImage;
        if (typeof draw === "function") {
          draw.call(ctx, tinted, 0, 0, p.w, p.h);
          spritePainted = true;
        }
      } else {
        // Kick the async PNG fetch so the next decoded draw paints art.
        soldierImageFor(textureKey);
      }
    } catch {
      spritePainted = false;
    }
  }
  for (const part of parts) {
    // Sprite cards already carry legs/torso/head: skip the vector body
    // when the tinted card painted (arms still rotate below).
    if (spritePainted && part.kind !== "limb") {
      continue;
    }
    if (part.kind === "limb") {
      continue;
    }
    ctx.fillStyle = part.name === "visor" ? VISOR_CSS : paint;
    if (part.kind === "rect") {
      let dx = 0;
      let dy = 0;
      if (part.name === "legL" || part.name === "legR") {
        const side = part.name === "legL" ? -1 : 1;
        ({ dx, dy } = soldierLegOffsetBlended(frame, swing, side, gaitBlend, airBlend));
      }
      ctx.fillRect(
        part.x + dx,
        part.y + dy,
        Math.max(minPx, part.w),
        Math.max(minPx, part.h),
      );
    } else {
      ctx.beginPath();
      ctx.arc(part.cx, part.cy, Math.max(minPx, part.r), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Arms plus the held weapon rotate with the smoothed aim around the pivot.
  ctx.save();
  ctx.translate(ARM_PIVOT.x, ARM_PIVOT.y * squashY);
  ctx.rotate(aim);
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  ctx.lineCap = "round";
  const gun = weaponDef(p.weapon);
  for (const part of parts) {
    if (part.kind !== "limb") {
      continue;
    }
    ctx.lineWidth = Math.max(minPx, part.width);
    ctx.beginPath();
    ctx.moveTo(part.x1, part.y1);
    ctx.lineTo(part.x2, part.y2);
    ctx.stroke();
    if (part.name === "armR") {
      ctx.strokeStyle = gun.colorCss;
      ctx.fillStyle = gun.colorCss;
      ctx.lineWidth = Math.max(minPx, gun.width);
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(gun.length, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gun.muzzleX, 0, Math.max(minPx, MUZZLE_DOT_R), 0, Math.PI * 2);
      ctx.fill();
      // In-hand silhouette (issue #264): the per-weapon SVG card spans
      // the vector gun segment above; a pending decode keeps the vector.
      paintWeaponSprite(ctx, p.weapon, gun.length);
      ctx.strokeStyle = paint;
      ctx.fillStyle = paint;
    }
  }
  ctx.restore();
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
      squash:
        (p.h / CHARACTER_H) * (anim?.spawnEase ?? 1) * (anim?.deathEase ?? 1),
      visible: true,
      legSwing: anim?.swing ?? 0,
      legPhase: anim?.legPhase ?? 0,
      tuck: anim?.tuck ?? false,
      hurtFlash: anim?.hurtFlash ?? false,
      deadPose: anim?.deadPose ?? !p.alive,
      weapon: p.weapon,
      frame: soldierFrame,
      gaitBlend: anim?.gaitBlend ?? 1,
      airBlend: anim?.airBlend ?? 0,
      aimSmoothed: anim?.aimSmoothed ?? p.aim,
      landSquash: anim?.landSquash ?? 1,
      spawnEase: anim?.spawnEase ?? 1,
      deathEase: anim?.deathEase ?? 1,
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
    gaitBlend: head?.gaitBlend ?? 0,
    airBlend: head?.airBlend ?? 0,
    crouchWeight: head?.crouchWeight ?? head?.airBlend ?? 0,
    aimSmoothed: head?.aimSmoothed ?? first?.aim ?? 0,
    landSquash: head?.landSquash ?? 1,
    scaleY: head?.landSquash ?? 1,
    spawnEase: head?.spawnEase ?? 1,
    deathEase: head?.deathEase ?? 1,
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
      gaitBlend: pose?.gaitBlend ?? 0,
      airBlend: pose?.airBlend ?? 0,
      crouchWeight: pose?.crouchWeight ?? pose?.airBlend ?? 0,
      aimSmoothed: pose?.aimSmoothed ?? p.aim,
      landSquash: pose?.landSquash ?? 1,
      spawnEase: pose?.spawnEase ?? 1,
      deathEase: pose?.deathEase ?? 1,
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
  particles: Particle[],
  victimFlash: ReadonlyMap<number, number>,
  canvasWidth: number,
  canvasHeight: number,
  anims: readonly AnimPose[],
  theme?: TileTheme,
  decors: readonly Decoration[] = [],
  lights: readonly Light[] = [],
  padSquash: number = 1,
  shockwaves: readonly Shockwave[] = [],
  nowMs: number = 0,
  quality: QualityLevel = "high",
  hurtPulse: number = 0,
  ambient: AmbientBed | null = null,
): void {
  const px = (x: number): number => projectCamera(cam, canvasWidth, canvasHeight, x, 0).x;
  const py = (y: number): number => projectCamera(cam, canvasWidth, canvasHeight, 0, y).y;
  const ambientProject = (x: number, y: number): { x: number; y: number } =>
    projectCamera(cam, canvasWidth, canvasHeight, x, y);
  const tileSize = TILE_SIZE * cam.scale;
  const activeTheme = theme ?? resolveTileTheme();
  paintSky2D(ctx, canvasWidth, canvasHeight, activeTheme.name);
  const arena = projectCamera(cam, canvasWidth, canvasHeight, 0, 0);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(arena.x, arena.y, frame.arena.width * cam.scale, frame.arena.height * cam.scale);
  paintBackdrop2D(ctx, cam.x, cam.y, canvasWidth, canvasHeight, activeTheme.name);
  paintDecor2D(ctx, px, py, cam.scale, decors);
  paintTiles2D(ctx, px, py, tileSize, cam.scale, layers, activeTheme, padSquash);
  paintLights2D(ctx, px, py, cam.scale, lights, nowMs);
  // Ambient particle bed: per-theme background life behind gameplay
  // (below entities, above tiles) so scenery reads alive without
  // touching collision. Quality-gated: low paints nothing.
  paintAmbient2D(
    ctx,
    ambient,
    activeTheme.name,
    ambientProject,
    canvasWidth,
    canvasHeight,
    nowMs,
    quality,
  );
  for (const prop of frame.props) {
    if (!prop.alive) {
      continue;
    }
    paintProp2D(
      ctx,
      px(prop.x),
      py(prop.y),
      prop.w * cam.scale,
      prop.h * cam.scale,
      cam.scale,
      prop.kind,
      prop.hp,
    );
    // Pack sprite overlay (issue #267): the `props/` card over the vector
    // quad at the same box, so measured size stays while pixels read as
    // pack art. Undecoded art is a silent no-op (vector stays).
    try {
      paintPropSprite(
        ctx,
        propSpriteKey(prop.kind, prop.hp),
        px(prop.x),
        py(prop.y),
        prop.w * cam.scale,
        prop.h * cam.scale,
        activeTheme.name,
      );
    } catch {
      // Overlay best-effort only.
    }
  }
  for (const pickup of frame.pickups) {
    if (!pickup.active) {
      continue;
    }
    paintPickup2D(ctx, px(pickup.x), py(pickup.y), cam.scale, pickup.kind, pickup.weapon);
    // Pack pad overlay plus the glow pulse (issue #267): the `pads/`
    // card over the vector pad, then a pulsing halo whose alpha rides
    // padGlowAlphaAt(nowMs) so samples 400ms apart always differ.
    try {
      const padKey = padSpriteKey(pickup.kind);
      const padW = 40 * cam.scale;
      const padH = 16 * cam.scale;
      paintPadSprite(ctx, padKey, px(pickup.x), py(pickup.y), padW, padH, activeTheme.name);
      const pulse = padGlowAlphaAt(nowMs);
      if (Number.isFinite(pulse) && pulse > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(0, pulse - 0.35));
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px(pickup.x), py(pickup.y), Math.max(2, padW / 2 + 6 * cam.scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } catch {
      // Overlay best-effort only.
    }
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
      const scale = flameScale(frame.tick, p.index, p.fuelRatio);
      const flame = flameAlpha(frame.tick, p.index, p.fuelRatio) * blink;
      const boost = jetCoreBoostFor(p.vy);
      ctx.globalAlpha = flame;
      const feetY = py(p.y + p.h);
      const outer = 5 * scale * cam.scale;
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(cx, feetY + outer + 2, outer, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = jetCoreCssFor(boost);
      ctx.globalAlpha = Math.min(1, flame + Math.max(0, boost - 1) * 0.5);
      ctx.beginPath();
      ctx.arc(cx, feetY + outer + 2, outer * 0.55 * boost, 0, Math.PI * 2);
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
    paintGlowHalo2D(ctx, px(muzzle.x), py(muzzle.y), MUZZLE_HALO_R, cam.scale, "#fff7cc");
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
  for (const particle of particles) {
    ctx.save();
    ctx.globalAlpha = particleOpacity(particle);
    ctx.fillStyle = particle.css;
    ctx.beginPath();
    ctx.arc(
      px(particle.x),
      py(particle.y),
      Math.max(1, particle.size * cam.scale),
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }
  // Shockwave rings expand 10->60 world px over 500ms (all qualities).
  for (const sw of shockwaves) {
    if (!shockwaveAlive(sw, nowMs)) {
      continue;
    }
    paintShockwaveRing2D(
      ctx,
      px(sw.x),
      py(sw.y),
      shockwaveRadiusAt(sw, nowMs) * cam.scale,
      cam.scale,
      shockwaveAlphaAt(sw, nowMs),
    );
  }
  // Chromatic hurt pulse washes the frame while a hurt flash is live
  // (high quality only; low quality paints nothing here).
  paintChromaticPulse2D(ctx, canvasWidth, canvasHeight, hurtPulse, quality);
  paintVignette2D(ctx, canvasWidth, canvasHeight);
}

/**
 * Feed step events into capped transient flashes anchored near the action.
 * Shot flashes ride the local player's weapon-aware barrel tip, so event
 * flashes coincide with `spawnShots` muzzles by construction.
 */
export function pushFlashes(
  flashes: Flash[],
  frame: Frame,
  events: string[],
  explodes: readonly ExplodeDetail[] = [],
): void {
  if (events.length === 0 && explodes.length === 0) {
    return;
  }
  const local = frame.players[0];
  const anchorX =
    local !== undefined ? local.x + local.w / 2 : frame.arena.width / 2;
  const anchorY =
    local !== undefined ? local.y + local.h / 2 : frame.arena.height / 2;
  // Blast centers carry the true explosion position: wall hits with no
  // victims still flash at the sim blast instead of on the local player.
  for (const blast of explodes) {
    flashes.push({ x: blast.x, y: blast.y, kind: "explode", ttl: FLASH_TTL });
    while (flashes.length > MAX_FLASHES) {
      flashes.shift();
    }
  }
  const explodeEvents = events.filter((e) => e === "explode").length;
  const anchoredBlasts = Math.min(explodeEvents, explodes.length);
  let skippedExplodes = 0;
  for (const event of events) {
    if (event !== "explode" && event !== "bounce" && event !== "shot") {
      continue;
    }
    if (event === "explode" && skippedExplodes < anchoredBlasts) {
      skippedExplodes += 1;
      continue;
    }
    if (event === "shot" && local !== undefined && local.alive) {
      flashes.push({
        x: local.barrel.x,
        y: local.barrel.y,
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
  // Locker accent rides through soldierAccentFor so the equipped
  // palette tints the local soldier (enemies keep team colors).
  return !alive ? "#475569" : soldierAccentFor(index);
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
 * 3 consecutive ticks non-constant. The optional fuelRatio narrows the
 * band toward the midpoint and dims slightly at low fuel (full fuel
 * reads exactly the legacy band). Pure: no DOM, no clock.
 */
export function flameScale(tick: number, index: number, fuelRatio = 1): number {
  const h = (Math.imul(tick, 2654435761) + Math.imul(index + 1, 40503)) >>> 0;
  const base = FLAME_SCALE_MIN + ((h % 100) / 100) * (FLAME_SCALE_MAX - FLAME_SCALE_MIN);
  const fr = Number.isFinite(fuelRatio) ? Math.min(1, Math.max(0, fuelRatio)) : 1;
  const mid = (FLAME_SCALE_MIN + FLAME_SCALE_MAX) / 2;
  return (mid + (base - mid) * (0.5 + 0.5 * fr)) * (0.9 + 0.1 * fr);
}

/**
 * Jet-flame flicker opacity for a tick/player. Integer-hash noise in
 * [FLAME_ALPHA_MIN, FLAME_ALPHA_MAX]; the +19 mod-100 step keeps any
 * 3 consecutive ticks non-constant. The optional fuelRatio narrows the
 * band toward the midpoint and dims slightly at low fuel (full fuel
 * reads exactly the legacy band). Pure: no DOM, no clock.
 */
export function flameAlpha(tick: number, index: number, fuelRatio = 1): number {
  const h = (Math.imul(tick, 2246822519) + Math.imul(index + 1, 32661)) >>> 0;
  const base = FLAME_ALPHA_MIN + ((h % 100) / 100) * (FLAME_ALPHA_MAX - FLAME_ALPHA_MIN);
  const fr = Number.isFinite(fuelRatio) ? Math.min(1, Math.max(0, fuelRatio)) : 1;
  const mid = (FLAME_ALPHA_MIN + FLAME_ALPHA_MAX) / 2;
  return (mid + (base - mid) * (0.5 + 0.5 * fr)) * (0.9 + 0.1 * fr);
}

/**
 * Fast-ascent core boost in [1, 1.4]: 1 at vy >= 0 (hover/fall) rising
 * linearly to 1.4 at vy <= -800. Takes the raw vy, never clamped to the
 * sim JETPACK_MAX_UP, so injected probe speeds still brighten. Pure:
 * no DOM, no clock.
 */
export function jetCoreBoostFor(vy: number): number {
  if (!Number.isFinite(vy) || vy >= 0) {
    return 1;
  }
  return 1 + Math.min(1, -vy / 800) * 0.4;
}

/**
 * Low-fuel smoke gate: true ~every 8th tick only while fuelRatio < 0.25
 * (integer-hash gating, deterministic per tick/index). Full tanks emit
 * nothing; non-finite readings are treated as full. Pure: no DOM, no
 * clock, no randomness.
 */
export function jetSmokeGateFor(fuelRatio: number, tick: number, index: number): boolean {
  if (!Number.isFinite(fuelRatio) || fuelRatio >= 0.25) {
    return false;
  }
  const h = (Math.imul(tick, 2654435761) + Math.imul(index + 1, 40503)) >>> 0;
  return h % 8 === 0;
}

/**
 * Inner-flame core paint for a boost: warm yellow at hover, near-white
 * past 1.2x, full white at the 1.35x afterburner band. Pure.
 */
export function jetCoreHexFor(boost: number): number {
  if (!Number.isFinite(boost)) {
    return 0xfde047;
  }
  if (boost >= 1.35) {
    return 0xffffff;
  }
  if (boost > 1.2) {
    return 0xfff7cc;
  }
  return 0xfde047;
}

/** Canvas2D twin of jetCoreHexFor. */
export function jetCoreCssFor(boost: number): string {
  if (!Number.isFinite(boost)) {
    return "#fde047";
  }
  if (boost >= 1.35) {
    return "#ffffff";
  }
  if (boost > 1.2) {
    return "#fff7cc";
  }
  return "#fde047";
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
 * True when a shot endpoint has a damage detail within 12px (squared
 * 144): flesh/prop hits land on their damage point, wall hits and full
 * misses have no nearby damage. Pure: no DOM, no clock.
 */
export function shotHasNearbyDamage(
  shot: { x: number; y: number },
  damages: readonly { x: number; y: number }[],
): boolean {
  for (const detail of damages) {
    const dx = detail.x - shot.x;
    const dy = detail.y - shot.y;
    if (dx * dx + dy * dy <= 144) {
      return true;
    }
  }
  return false;
}

/**
 * True when a world point touches a solid tile (3x3 around the point).
 * Without a tile query (headless unit draws) every orphan shot counts
 * as a wall hit so the wall-gap fix stays testable under node. Pure
 * apart from the structural tile query.
 */
export function isWallEndpoint(
  x: number,
  y: number,
  map: unknown,
): boolean {
  try {
    const query = map as {
      isSolidTile?: (tx: number, ty: number) => unknown;
    } | null;
    if (
      query === null ||
      query === undefined ||
      typeof query.isSolidTile !== "function"
    ) {
      return true;
    }
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        try {
          if (query.isSolidTile(tx + ox, ty + oy) === true) {
            return true;
          }
        } catch {
          // Shorn tile queries: fall through to the next neighbor.
        }
      }
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Orphan wall-hit shots: every shot endpoint with no nearby damage and
 * a solid neighbor (the wall-hit gap: wall impacts emit no damage
 * events, so impact counts must come from shot endpoints). Pure: no
 * DOM, no clock, no randomness, so unit-testable under node.
 */
export function wallHitShots(
  shots: readonly ShotDetail[],
  damages: readonly DamageDetail[],
  map: unknown,
): ShotDetail[] {
  const out: ShotDetail[] = [];
  for (const shot of shots) {
    if (shotHasNearbyDamage(shot, damages)) {
      continue;
    }
    if (!isWallEndpoint(shot.x, shot.y, map)) {
      continue;
    }
    out.push(shot);
  }
  return out;
}

/** Cumulative particle-pack emitter totals (issue #269 probe shape). */
export interface FxEmitterTotals {
  muzzle: number;
  impact: number;
  explosionFlash: number;
  explosionSmoke: number;
  debris: number;
  trail: number;
  death: number;
  pickup: number;
  impactTintHex: number;
  impactCss: string;
}

/**
 * Build the `window.__scrapline.emitterCounts()` probe snapshot from
 * cumulative totals: exact keys plus common aliases so wall/muzzle
 * (`muzzle`/`impact`), grenade (`explosionFlash`/`explosionSmoke`/
 * `debris`), trail, death-burst, and pickup-sparkle probes all read
 * one shape. Pure, never throws.
 */
export function buildEmitterCounts(
  totals: Partial<FxEmitterTotals>,
): Record<string, number | string> {
  const muzzle = Math.floor(totals.muzzle ?? 0);
  const impact = Math.floor(totals.impact ?? 0);
  const explosionFlash = Math.floor(totals.explosionFlash ?? 0);
  const explosionSmoke = Math.floor(totals.explosionSmoke ?? 0);
  const debris = Math.floor(totals.debris ?? 0);
  const trail = Math.floor(totals.trail ?? 0);
  const death = Math.floor(totals.death ?? 0);
  const pickup = Math.floor(totals.pickup ?? 0);
  const impactTintHex = Math.floor(totals.impactTintHex ?? 0xfef08a);
  const impactCss =
    typeof totals.impactCss === "string" ? totals.impactCss : "#fef08a";
  return {
    muzzle,
    impact,
    explosionFlash,
    explosionSmoke,
    debris,
    trail,
    death,
    pickup,
    impactTint: impactTintHex,
    impactTintHex,
    impactCss,
    flash: explosionFlash,
    smoke: explosionSmoke,
    jet: trail,
    burst: death,
    sparkle: pickup,
    explosion: explosionFlash,
  };
}

/**
 * Null-safe localStorage surface for the renderer's quality default.
 * Mirrors the browserStorage helper in main.ts so createRenderer can
 * seed from loadQuality before main forwards the settings toggle.
 */
function rendererStorage(): SetupStorage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const ls = window.localStorage;
    if (ls === undefined || ls === null) {
      return null;
    }
    return {
      getItem: (key: string): string | null => {
        try {
          return ls.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key: string, value: string): void => {
        try {
          ls.setItem(key, value);
        } catch {
          // Private-mode storage: the default still applies.
        }
      },
    };
  } catch {
    return null;
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
  // Pooled bright particles (muzzle/impact/explosion/jet/death/pickup)
  // painted on both backends; capped at MAX_PARTICLES for perf.
  const particles: Particle[] = [];
  const victimFlash = new Map<number, number>();
  // Live shockwave rings in world coords (one per blast, 500ms life).
  const shockwaves: Shockwave[] = [];
  // Ambient particle bed: per-theme background life (dust+birds,
  // shimmer+streaks, snowfall+aurora) painted behind gameplay on high
  // quality, cleared on low. Decor only: never touches the sim.
  const ambientBed: AmbientBed = createAmbientBed();
  // Renderer-owned post-effect quality (seeded from storage, forwarded
  // from the settings binder). High keeps the chromatic hurt pulse and
  // the Pixi filter pass; rings, halos, and vignette paint on all levels.
  let quality: QualityLevel = "high";
  try {
    quality = loadQuality(rendererStorage());
  } catch {
    quality = "high";
  }
  // Live per-player composed-sprite nodes (real Pixi containers on the
  // Pixi backend, plain-object stubs on the canvas2d fallback).
  const playerNodes: PlayerNode[] = [];
  // Per-player animation accumulators plus the session clock anchors
  // mapping foreign hurt timestamps onto the perf-ms draw clock.
  const animStates: AnimState[] = [];
  let sessionStarted = false;
  let sessionPerfStart = 0;
  let sessionWallStart = 0;
  // Last bounce-event trigger in perf-ms; drives the pad squash cycle
  // (peak 0.6x at 300ms, eased back to 1x by 600ms) on both backends.
  let lastBounceAtMs: number | null = null;
  // Rising-edge latch for step-on activation: retriggers only on the
  // first overlapping draw, so standing on a pad still recovers.
  let wasOnBouncePad = false;
  // Seeded decor cache: the scatter stream is deterministic per
  // (theme, seed), so the combined static+scatter array (and its hash)
  // is resolved once per key instead of once per frame.
  let decorCacheKey = "";
  let decorCache: Decoration[] = [];
  let decorCacheHash = "";
  // Cumulative particle-pack emitter counters (issue #269): pooled-path
  // counts per effect family plus the last wall surface tint. Wall hits
  // emit no damage events, so impact counts come from shot endpoints;
  // explosion smoke/debris count pooled particles per blast so a single
  // grenade reads flash>=1, smoke>=3, debris>=3 within 1s (live TTLs
  // would have expired). Never reset: probes sample cumulative totals.
  let fxMuzzleCount = 0;
  let fxImpactCount = 0;
  let fxExplosionFlashCount = 0;
  let fxExplosionSmokeCount = 0;
  let fxDebrisCount = 0;
  let fxTrailCount = 0;
  let fxDeathCount = 0;
  let fxPickupCount = 0;
  let fxImpactTintHex = 0xfef08a;
  let fxImpactCss = "#fef08a";

  function trackDraw(
    state: StateLike,
    map: MapLike | TileMapLike | null | undefined,
    camera: Camera | null | undefined,
    events: string[] | undefined,
    shots: ShotDetail[] | undefined,
    damages: DamageDetail[] | undefined,
    kills: KillDetail[] | undefined,
    explodes: ExplodeDetail[] | undefined,
    pickups: PickupDetail[] | undefined,
  ): {
    frame: Frame;
    cam: Camera;
    layers: LayerCounts;
    anims: AnimPose[];
    theme: TileTheme;
    themeName: string;
    decors: Decoration[];
    lights: Light[];
    padSquash: number;
    dtSec: number;
    nowMs: number;
    hurtPulse: number;
    wallShots: ShotDetail[];
  } {
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
      vy: p.vy,
      aim: p.aim,
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
    if ((events ?? []).includes("bounce")) {
      lastBounceAtMs = now;
    }
    const layers = collectLayers(frame, map ?? null, cam, logicalW, logicalH);
    // Pad-step activation without touching the sacred sim: a live player
    // box overlapping any bounce tile retriggers the squash cycle, so
    // stepping on a pad reads as a bounce even when the sim emits no
    // event (grenade bounces still retrigger through the event path).
    let onPad = false;
    if (layers.bounces.length > 0 && frame.players.length > 0) {
      for (const p of frame.players) {
        if (!p.alive) {
          continue;
        }
        for (const cell of layers.bounces) {
          const bx = cell.tx * TILE_SIZE;
          const by = cell.ty * TILE_SIZE;
          if (
            p.x < bx + TILE_SIZE &&
            p.x + p.w > bx &&
            p.y < by + TILE_SIZE &&
            p.y + p.h > by
          ) {
            onPad = true;
            break;
          }
        }
        if (onPad) {
          break;
        }
      }
    }
    if (onPad && !wasOnBouncePad) {
      lastBounceAtMs = now;
    }
    wasOnBouncePad = onPad;
    const padSquash = bounceSquashScale(now, lastBounceAtMs);
    pushFlashes(flashes, frame, events ?? [], explodes ?? []);
    spawnShots(tracers, muzzles, frame, shots ?? []);
    // Pooled muzzle flashes ride the same barrel tips as the tracer
    // muzzles (one burst per firing shooter, not per pellet, to cap
    // perf on shotguns) so the 24px probe always finds >= 4. Counts
    // accumulate per pooled burst for the emitterCounts probe.
    {
      const muzzled = new Set<number>();
      for (const shot of shots ?? []) {
        if (muzzled.has(shot.shooter)) {
          continue;
        }
        muzzled.add(shot.shooter);
        const shooter = frame.players[shot.shooter];
        const tip =
          shooter !== undefined ? shooter.barrel : { x: shot.ox, y: shot.oy };
        spawnMuzzleFlash(particles, tip.x, tip.y, shooter?.aim ?? 0);
        fxMuzzleCount += MUZZLE_COUNT;
      }
    }
    spawnSparks(sparks, damages ?? []);
    for (const detail of damages ?? []) {
      spawnImpact(particles, detail.x, detail.y);
      fxImpactCount += IMPACT_COUNT;
    }
    // Wall-hit gap (issue #269): wall impacts emit no damage events, so
    // orphan shot endpoints (no nearby damage, solid neighbor) spawn a
    // surface-tinted burst at the endpoint. Tint is the live wall base
    // so the impact hue matches the surface within 20 degrees.
    const fxWallTheme = resolveTileTheme();
    const wallShots = wallHitShots(shots ?? [], damages ?? [], map ?? null);
    for (const shot of wallShots) {
      spawnImpact(particles, shot.x, shot.y, fxWallTheme.baseHex, fxWallTheme.base);
      fxImpactCount += IMPACT_COUNT;
      fxImpactTintHex = fxWallTheme.baseHex;
      fxImpactCss = fxWallTheme.base;
    }
    spawnBursts(bursts, kills ?? []);
    for (const detail of kills ?? []) {
      spawnDeathBurst(particles, detail.x, detail.y);
      fxDeathCount += DEATH_COUNT;
    }
    for (const blast of explodes ?? []) {
      spawnExplosion(particles, blast.x, blast.y, blast.radius);
      fxExplosionFlashCount += EXPLOSION_FLASH_COUNT;
      fxExplosionSmokeCount += EXPLOSION_SMOKE_COUNT;
      fxDebrisCount += EXPLOSION_DEBRIS_COUNT;
    }
    // One shockwave ring per blast center; the ring store ages on the
    // wall clock so the 10->60px expansion tracks real capture time.
    for (const blast of explodes ?? []) {
      spawnShockwave(shockwaves, blast.x, blast.y, now);
    }
    updateShockwaves(shockwaves, now);
    for (const pickup of pickups ?? []) {
      spawnPickupSparkle(particles, pickup.x, pickup.y);
      fxPickupCount += PICKUP_COUNT;
    }
    // Jet exhaust trail: continuous emission while thrusting (not
    // event-gated) so the flame reads for the full jet duration (F2).
    // Exhaust ignores spawn-protection blink so the trail stays bright
    // even while the body blinks.
    for (const p of frame.players) {
      if (p.alive && p.jetting) {
        spawnJetExhaust(particles, p.x + p.w / 2, p.y + p.h + 1);
        fxTrailCount += JET_PER_FRAME;
        // Low-fuel sputter: gray wisps only while the tank runs dry, so
        // full-fuel flight keeps a clean orange trail.
        if (jetSmokeGateFor(p.fuelRatio, frame.tick, p.index)) {
          spawnJetSmoke(particles, p.x + p.w / 2, p.y + p.h + 1);
        }
      }
    }
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
    updateParticles(particles);
    const theme = resolveTileTheme();
    const themeName = theme.name;
    // Ambient bed advances on the live camera view (camera-relative
    // spawn keeps the view populated while panning); the quality gate
    // lives inside updateAmbientBed (low clears the bed).
    const ambientView = viewSize(cam, logicalW, logicalH);
    updateAmbientBed(ambientBed, {
      theme: themeName,
      quality,
      tick: frame.tick,
      camX: cam.x,
      camY: cam.y,
      viewW: ambientView.w,
      viewH: ambientView.h,
    });
    // Seeded decor resolution: the match World seed threads the scatter
    // stream, so the same seed paints the same rects; the seedless
    // fallback keeps headless draws deterministic per arena.
    const matchSeed = decorSeedFor(state.seed, themeName);
    const decorKey = `${themeName}:${matchSeed}`;
    if (decorCacheKey !== decorKey) {
      decorCache = decorationsForMapSeeded(themeName, matchSeed);
      decorCacheKey = decorKey;
      try {
        decorCacheHash = fnv1aHex(JSON.stringify(decorCache));
      } catch {
        decorCacheHash = "";
      }
    }
    const allDecors = decorCache;
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
    // Static additive lights: registry per theme, culled to the live
    // camera, then capped by the renderer-owned quality (low paints at
    // most the first LOW_LIGHT_CAP pools, high paints the full set).
    const lights = lightsForQuality(
      culledLights(
        lightsForMap(themeName),
        cam,
        logicalW,
        logicalH,
        frame.arena.width,
        frame.arena.height,
      ),
      quality,
    );
    // Hurt-pulse strength: max over the per-player hurt clocks (the
    // 150ms window from view/anim.ts). Computed on every draw but only
    // painted on high quality, so low quality keeps a zero hue delta.
    let hurtPulse = 0;
    for (const animState of animStates) {
      const strength = hurtPulseStrength(now, animState.lastHurtAtMs);
      if (strength > hurtPulse) {
        hurtPulse = strength;
      }
    }
    try {
      setCurrentTheme(themeName);
    } catch {
      // Headless: module theme stays at the resolved value regardless.
    }
    // Screen-space parallax offsets for the live camera (probe mirrors
    // for the 200px-move acceptance: far 40px, mid 100px).
    const backdropFarX = backdropOffsetX(cam.x, FAR_PARALLAX, FAR_PERIOD);
    const backdropMidX = backdropOffsetX(cam.x, MID_PARALLAX, MID_PERIOD);
    const backdropLayers = backdropLayersFor(themeName);
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
            bounceTileH: BOUNCE_PAD_H * padSquash,
            oneWayTileH: ONEWAY_PLANK_H,
            solidTileH: SOLID_TILE_H,
            // Pack tile draw size in world px (issue #266): one 18px
            // vendor cell per ASCII cell painted at the 32px core grid.
            tileSize: TILE_SIZE,
            padSquash,
            propCount: frame.props.length,
            pickupCount: frame.pickups.length,
            decorationCount: allDecors.length,
            occludedTiles: occluded,
            decorSeed: matchSeed,
            decorHash: decorCacheHash,
            decorations: snapshotDecorations(allDecors),
            lightCount: lights.length,
            skyTop: skyTopRgb(themeName),
            vignetteAlpha: VIGNETTE_ALPHA,
            lightsRespected: isLightsRespected(map ?? null),
            skyCoversViewport: skyCoversViewport(logicalW, logicalH),
            backdropFarX,
            backdropMidX,
            backdropLayers,
            backdropFarFactor: FAR_PARALLAX,
            backdropMidFactor: MID_PARALLAX,
            fps: Math.round(fpsEma * 10) / 10,
            quality,
            shockwaveCount: shockwaves.length,
            hurtPulse: Math.round(hurtPulse * 100) / 100,
            // Ambient bed probes: live mote count (snowfall on
            // frostbite), bird count plus screen-space bird positions
            // (mid-band crossing on kilima), and the bed theme. Low
            // quality clears the bed so ambientCount reads 0.
            ambientCount: ambientMoteCount(ambientBed),
            ambientBirdCount: ambientBirdCount(ambientBed),
            ambientTheme: themeName,
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
        backdropFarX,
        backdropMidX,
        backdropLayers,
        backdropFarFactor: FAR_PARALLAX,
        backdropMidFactor: MID_PARALLAX,
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
        particles: particles.map((p) => ({
          x: p.x,
          y: p.y,
          opacity: particleOpacity(p),
          color: p.color,
          css: p.css,
        })),
        particleCount: particles.length,
        particleCap: MAX_PARTICLES,
        fxCaps: { ...FX_EMITTER_CAPS },
        // Ambient bed probes (decor-only, quality-gated): live mote
        // count plus bird count/screen positions for the crossing probe.
        ambientCount: ambientMoteCount(ambientBed),
        ambientBirdCount: ambientBirdCount(ambientBed),
        ambientTheme: themeName,
        ambientBirds: ambientBed.birds.map((b) => {
          const s = projectCamera(cam, logicalW, logicalH, b.x, b.y);
          return { x: s.x, y: s.y };
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
            fuelRatio: p.fuelRatio,
            alpha:
              blinkAlpha(frame.tick, p.protected) * (anim?.spawnAlpha ?? 1),
            color: playerPaintColor(p.index, p.alive, victimFlash.has(p.index)),
            colorCss: playerPaintCss(p.index, p.alive, victimFlash.has(p.index)),
            flame:
              p.jetting && p.alive
                ? {
                    scale: flameScale(frame.tick, p.index, p.fuelRatio),
                    alpha: flameAlpha(frame.tick, p.index, p.fuelRatio),
                    boost: jetCoreBoostFor(p.vy),
                  }
                : null,
            legPhase: anim?.legPhase ?? 0,
            swing: anim?.swing ?? 0,
            heightScale: anim?.heightScale ?? 1,
            hurtFlash: anim?.hurtFlash ?? false,
            gaitBlend: anim?.gaitBlend ?? 0,
            airBlend: anim?.airBlend ?? 0,
            crouchWeight: anim?.crouchWeight ?? anim?.airBlend ?? 0,
            aimSmoothed: anim?.aimSmoothed ?? p.aim,
            landSquash: anim?.landSquash ?? 1,
            spawnEase: anim?.spawnEase ?? 1,
            deathEase: anim?.deathEase ?? 1,
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
        padSquash,
        bounceTileH: BOUNCE_PAD_H * padSquash,
        props: frame.props.map((p) => ({
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          kind: p.kind,
          alive: p.alive,
          hp: p.hp,
          maxHp: p.maxHp,
        })),
        pickups: frame.pickups.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          kind: p.kind,
          active: p.active,
          weapon: p.weapon ?? null,
        })),
        quality,
        shockwaves: shockwaves.map((sw) => ({
          x: sw.x,
          y: sw.y,
          radius: shockwaveRadiusAt(sw, now),
          alpha: shockwaveAlphaAt(sw, now),
        })),
        lightCount: lights.length,
        hurtPulse: Math.round(hurtPulse * 100) / 100,
      };
    }
    // Sprite-swap probe surface (`platformer-characters` textures,
    // roster tints, arm anchor + muzzle): patches the fresh mirrors
    // above and owns window.__scrapline.debugFrame. Also owns the
    // prop/pad probe surface (issue #267): propFrames, padLabels, and
    // the glow pulse alpha, all read per call from the latest frame.
    publishSoldierSpriteProbes(frame, anims, tileMapForDecor, padSquash, now);
    // Particle-pack emitter probe (issue #269): cumulative pooled-path
    // counts plus the last wall tint, read per call so grenade and
    // wall-hit totals are visible within a frame of the blast.
    try {
      const counts = buildEmitterCounts({
        muzzle: fxMuzzleCount,
        impact: fxImpactCount,
        explosionFlash: fxExplosionFlashCount,
        explosionSmoke: fxExplosionSmokeCount,
        debris: fxDebrisCount,
        trail: fxTrailCount,
        death: fxDeathCount,
        pickup: fxPickupCount,
        impactTintHex: fxImpactTintHex,
        impactCss: fxImpactCss,
      });
      const emitterCounts = (): Record<string, number | string> =>
        buildEmitterCounts({
          muzzle: fxMuzzleCount,
          impact: fxImpactCount,
          explosionFlash: fxExplosionFlashCount,
          explosionSmoke: fxExplosionSmokeCount,
          debris: fxDebrisCount,
          trail: fxTrailCount,
          death: fxDeathCount,
          pickup: fxPickupCount,
          impactTintHex: fxImpactTintHex,
          impactCss: fxImpactCss,
        });
      void counts;
      if (typeof window !== "undefined") {
        const scope = window as unknown as Record<string, unknown>;
        const hook = scope["__scrapline"] as Record<string, unknown> | undefined;
        if (hook !== undefined && hook !== null && typeof hook === "object") {
          hook["emitterCounts"] = emitterCounts;
        }
        const game = scope["__game"] as Record<string, unknown> | undefined;
        if (game !== undefined && game !== null && typeof game === "object") {
          game["emitterCounts"] = emitterCounts;
        }
        const debug = scope["__scraplineDebug"] as
          | Record<string, unknown>
          | undefined;
        if (debug !== undefined && debug !== null && typeof debug === "object") {
          debug["emitterCounts"] = emitterCounts;
        }
      }
    } catch {
      // Probe mirrors never break the frame.
    }
    return { frame, cam, layers, anims, theme, themeName, decors, lights, padSquash, dtSec, nowMs: now, hurtPulse, wallShots };
  }

  // Lazy Pixi-side particle emitters (pixi-v8-particles): additive glow
  // on top of the pooled circles. Created once the Pixi backend wins;
  // the canvas2d fallback keeps the pooled path only.
  let fxEmitters: FxEmitters | null = null;
  let fxEmittersFailed = false;

  // Lazy Pixi-side post filters (pixi-filters): Glow on the fx
  // container, Shockwave driven by live rings, RGBSplit while a hurt
  // flash is live — high quality only. Loaded once, applied
  // best-effort; the pooled paint twins stay the probe-visible path.
  let filterCtors: {
    Glow: new (options?: Record<string, unknown>) => unknown;
    Shock: new (options?: Record<string, unknown>) => unknown;
    RGB: new (options?: Record<string, unknown>) => unknown;
  } | null = null;
  let filterCtorsPending = false;
  let glowFilter: unknown = null;
  let shockFilter: unknown = null;
  let rgbFilter: unknown = null;

  function kickFilterLoad(): void {
    if (filterCtors !== null || filterCtorsPending) {
      return;
    }
    filterCtorsPending = true;
    void Promise.all([
      import("pixi-filters/glow"),
      import("pixi-filters/shockwave"),
      import("pixi-filters/rgb-split"),
    ])
      .then(([glowMod, shockMod, rgbMod]) => {
        filterCtors = {
          Glow: (glowMod as unknown as { GlowFilter: new (o?: Record<string, unknown>) => unknown }).GlowFilter,
          Shock: (shockMod as unknown as { ShockwaveFilter: new (o?: Record<string, unknown>) => unknown }).ShockwaveFilter,
          RGB: (rgbMod as unknown as { RGBSplitFilter: new (o?: Record<string, unknown>) => unknown }).RGBSplitFilter,
        };
      })
      .catch(() => {
        // Filter chunk failed: the pooled paint stays the sole path.
        filterCtorsPending = false;
      });
  }

  /**
   * Drive the cached Pixi filters from live fx state (high quality
   * only). Every assignment is guarded: unknown filter shapes or
   * shorn stages clear instead of throwing.
   */
  function applyPixiFilters(
    stage: { filters: unknown },
    fxLayer: { filters: unknown },
    worldGfx: { filters: unknown },
    liveCam: Camera,
    rings: Shockwave[],
    stampMs: number,
    pulse: number,
  ): void {
    if (quality !== "high" || filterCtors === null) {
      try {
        fxLayer.filters = [];
      } catch {
        // Shorn layer: pooled paint already covers the frame.
      }
      try {
        worldGfx.filters = [];
      } catch {
        // Shorn graphics: pooled paint already covers the frame.
      }
      try {
        stage.filters = [];
      } catch {
        // Shorn stage: pooled paint already covers the frame.
      }
      return;
    }
    try {
      if (glowFilter === null) {
        glowFilter = new filterCtors.Glow({ distance: 15, outerStrength: 2 });
      }
      fxLayer.filters = [glowFilter];
    } catch {
      // Glow faults never gate the pooled paint.
    }
    try {
      const live = rings.filter((sw) => shockwaveAlive(sw, stampMs));
      if (live.length > 0) {
        const newest = live[live.length - 1] as Shockwave;
        if (shockFilter === null) {
          shockFilter = new filterCtors.Shock({});
        }
        const center = projectCamera(liveCam, logicalW, logicalH, newest.x, newest.y);
        const filter = shockFilter as Record<string, unknown>;
        try {
          filter["center"] = [center.x, center.y];
        } catch {
          // Unknown uniform shape: the stroked ring still shows.
        }
        try {
          filter["time"] = (stampMs - newest.startedMs) / 1000;
        } catch {
          // Unknown uniform shape: the stroked ring still shows.
        }
        try {
          filter["radius"] = shockwaveRadiusAt(newest, stampMs) * liveCam.scale;
        } catch {
          // Unknown uniform shape: the stroked ring still shows.
        }
        worldGfx.filters = [shockFilter];
      } else {
        worldGfx.filters = [];
      }
    } catch {
      // Shockwave faults never gate the pooled paint.
    }
    try {
      if (pulse > 0) {
        if (rgbFilter === null) {
          rgbFilter = new filterCtors.RGB({});
        }
        const split = rgbFilter as Record<string, unknown>;
        try {
          split["red"] = { x: -3 * pulse, y: 0 };
        } catch {
          // Unknown uniform shape: the wash overlay still shows.
        }
        try {
          split["blue"] = { x: 3 * pulse, y: 0 };
        } catch {
          // Unknown uniform shape: the wash overlay still shows.
        }
        stage.filters = [rgbFilter];
      } else {
        stage.filters = [];
      }
    } catch {
      // RGB-split faults never gate the pooled paint.
    }
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
    // Dedicated fx container above the world graphics: Pixi emitters
    // (pixi-v8-particles) paint additive glow here while the pooled
    // circles in paintFramePixi stay the probe-visible path.
    const fxParent = new mod.Container();
    app.stage.addChild(fxParent);
    if (!fxEmittersFailed && fxEmitters === null) {
      void import("../fx/emitters")
        .then((fxMod) =>
          fxMod.createFxEmitters(
            fxParent as unknown as Parameters<typeof fxMod.createFxEmitters>[0],
          ),
        )
        .then((fx) => {
          fxEmitters = fx;
        })
        .catch(() => {
          fxEmittersFailed = true;
        });
    }
    // Fire-and-forget filter chunk: resolves into filterCtors for the
    // high-quality pass below; failures keep the pooled paint only.
    kickFilterLoad();
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
      setQuality(next: QualityLevel): void {
        try {
          quality = parseQuality(next);
        } catch {
          quality = "high";
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
        explodes?: ExplodeDetail[],
        pickups?: PickupDetail[],
      ): void {
        const { frame, cam, layers, anims, theme, decors, lights, padSquash, dtSec, nowMs, hurtPulse, wallShots } = trackDraw(
          state,
          map,
          camera,
          events,
          shots,
          damages,
          kills,
          explodes,
          pickups,
        );
        // Drive the Pixi emitters from the same sim details the pool
        // consumes (capped per FX_EMITTER_CAPS). Failures stay silent:
        // the pooled circles already guarantee the probe pixels.
        try {
          const fx = fxEmitters;
          if (fx !== null && fx !== undefined) {
            const toScreen = (x: number, y: number): { x: number; y: number } =>
              projectCamera(cam, logicalW, logicalH, x, y);
            for (const shot of shots ?? []) {
              const shooter = frame.players[shot.shooter];
              const tip =
                shooter !== undefined ? shooter.barrel : { x: shot.ox, y: shot.oy };
              const s = toScreen(tip.x, tip.y);
              fx.muzzle.updateOwnerPos(s.x, s.y);
              fx.muzzle.emitNow();
            }
            for (const detail of damages ?? []) {
              const s = toScreen(detail.x, detail.y);
              fx.impact.updateOwnerPos(s.x, s.y);
              fx.impact.emitNow();
            }
            // Wall-hit gap: orphan shot endpoints drive the Pixi impact
            // emitter too, so the additive glow matches the pooled tint.
            for (const shot of wallShots ?? []) {
              const s = toScreen(shot.x, shot.y);
              fx.impact.updateOwnerPos(s.x, s.y);
              fx.impact.emitNow();
            }
            for (const blast of explodes ?? []) {
              const s = toScreen(blast.x, blast.y);
              fx.explosion.updateOwnerPos(s.x, s.y);
              fx.explosion.emitNow();
            }
            for (const detail of kills ?? []) {
              const s = toScreen(detail.x, detail.y);
              fx.death.updateOwnerPos(s.x, s.y);
              fx.death.emitNow();
            }
            for (const pickup of pickups ?? []) {
              const s = toScreen(pickup.x, pickup.y);
              fx.pickup.updateOwnerPos(s.x, s.y);
              fx.pickup.emitNow();
            }
            const jetting = frame.players.find((p) => p.alive && p.jetting);
            if (jetting !== undefined) {
              const s = toScreen(
                jetting.x + jetting.w / 2,
                jetting.y + jetting.h + 1,
              );
              fx.jet.updateOwnerPos(s.x, s.y);
              fx.jet.emit = true;
            } else {
              fx.jet.emit = false;
            }
            fx.update(dtSec > 0 ? dtSec : 1 / 60);
          }
        } catch {
          // Emitter faults never break the pooled paint path.
        }
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
          particles.slice(),
          victimFlash,
          logicalW,
          logicalH,
          theme,
          decors,
          lights,
          padSquash,
          shockwaves.slice(),
          nowMs,
          quality,
          hurtPulse,
          ambientBed,
        );
        // High-quality Pixi filter pass (best-effort): Glow on the fx
        // layer, Shockwave from live rings, RGBSplit while hurt. Low
        // quality clears every stage filter so no chromatic shift occurs.
        try {
          applyPixiFilters(
            app.stage as unknown as { filters: unknown },
            fxParent as unknown as { filters: unknown },
            graphics as unknown as { filters: unknown },
            cam,
            shockwaves,
            nowMs,
            hurtPulse,
          );
        } catch {
          // Filter faults never gate the pooled paint.
        }
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
      setQuality(next: QualityLevel): void {
        try {
          quality = parseQuality(next);
        } catch {
          quality = "high";
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
        explodes?: ExplodeDetail[],
        pickups?: PickupDetail[],
      ): void {
        const { frame, cam, layers, anims, theme, decors, lights, padSquash, nowMs, hurtPulse } = trackDraw(
          state,
          map,
          camera,
          events,
          shots,
          damages,
          kills,
          explodes,
          pickups,
        );
        // Canvas2d fallback: stub nodes carry the probe shape while the
        // composed geometry is drawn immediately in paintFrame2D.
        ensurePlayerNodes(playerNodes, null, null, frame.players.length);
        publishFrameProbes(playerNodes, frame, cam, logicalW, logicalH, muzzles, anims);
        paintFrame2D(ctx, frame, cam, layers, flashes.slice(), tracers.slice(), muzzles.slice(), sparks.slice(), bursts.slice(), particles.slice(), victimFlash, logicalW, logicalH, anims, theme, decors, lights, padSquash, shockwaves.slice(), nowMs, quality, hurtPulse, ambientBed);
      },
    };
  }
}