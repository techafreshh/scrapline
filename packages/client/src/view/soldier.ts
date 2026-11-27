// Animated CC0 soldier sprite layer: pose-frame selection, per-weapon gun
// geometry, and muzzle-tip math — the single source of truth both
// renderer backends (Pixi containers in playerView.ts and the canvas2d
// fallback in renderer/index.ts) consume. DOM/Pixi-free: every helper
// takes plain numbers and strings and every clock value arrives as an
// argument, so the whole module stays unit-testable under node like
// anim.ts/character.ts. Tinting stays a client-side palette swap of the
// authored #00E5FF accent onto the existing teamCss families, so
// mid-match screenshots keep >= 2 distinct hues across players.
// Sprite source: Kenney `platformer-characters` Soldier set (CC0) via the
// atlas pipeline manifest (soldier.run.0..soldier.run.3, soldier.jet,
// soldier.crouch, soldier.fall, soldier.dead); the run cycle resolves
// through ../render/soldier.ts so both modules name the same pack art.
import { BARREL_LENGTH, barrelEndpoint } from "../renderer/index";
import { teamColor, teamCss } from "./character";
import type { WeaponId } from "../../../core/src/weapons";
import { DEAD_LIFT_PX, DEAD_SPLAY_PX, TUCK_IN_PX, TUCK_UP_PX } from "./anim";
import {
  SOLDIER_PACK as SOLDIER_SPRITE_PACK,
  soldierRunKey as spriteRunKey,
  soldierSpriteKey as spriteTextureKey,
} from "../render/soldier";

/** Animated soldier frame ids (one atlas card each). The fall card is
 * the committed soldier.fall art, shared with the hurt flinch: airborne
 * non-jetting players dangle instead of floating idle (issue #403). */
export const SOLDIER_FRAME_IDS = [
  "idle",
  "run-a",
  "run-b",
  "jet",
  "crouch",
  "fall",
  "dead",
] as const;

/** One animated soldier frame id. */
export type SoldierFrameId = (typeof SOLDIER_FRAME_IDS)[number];

/** Atlas card basename per soldier frame id. */
export const SOLDIER_FRAME_FILES: Record<SoldierFrameId, string> = {
  idle: "soldier-idle",
  "run-a": "soldier-run-a",
  "run-b": "soldier-run-b",
  jet: "soldier-jet",
  crouch: "soldier-crouch",
  fall: "soldier-fall",
  dead: "soldier-dead",
};

/**
 * Vendor atlas dot-name per soldier frame id (tools/build-atlas.js
 * manifest keys). The run pair rides run.0/run.1 so later sprite swaps
 * resolve through the manifest; no runtime file imports vendor art.
 */
export const SOLDIER_MANIFEST_FRAMES: Record<SoldierFrameId, string> = {
  idle: "soldier.idle",
  "run-a": "soldier.run.0",
  "run-b": "soldier.run.1",
  jet: "soldier.jet",
  crouch: "soldier.crouch",
  fall: "soldier.fall",
  dead: "soldier.dead",
};

/** Vendor pack backing the soldier frames (re-exported so probes and
 * menu art name the same `platformer-characters` source). */
export const SOLDIER_PACK = SOLDIER_SPRITE_PACK;

/**
 * Four-frame run-cycle texture for a leg phase (soldier.run.0..3 from
 * the `platformer-characters` Soldier walk/stand/skid cards). Pure.
 */
export function soldierRunTexture(legPhase: number): string {
  return spriteRunKey(legPhase);
}

/**
 * Manifest texture key for a pose (4-frame run, jet, crouch, hurt via
 * soldier.fall, death via soldier.dead). The run family always reads
 * `soldier.run.*` so canvas probes match on the prefix. Pure.
 */
export function soldierTextureFor(
  pose: SoldierPoseInput & { hurtFlash?: boolean },
): string {
  return spriteTextureKey(pose);
}

/** Vendor atlas dot-name for one soldier frame id. Pure. */
export function soldierManifestFrame(frame: SoldierFrameId): string {
  return SOLDIER_MANIFEST_FRAMES[frame] ?? SOLDIER_MANIFEST_FRAMES["idle"];
}

/** Downward speed in world px/s above which an airborne player dangles. */
export const FALLING_VY = 160;

/**
 * True while a live player dangles airborne: alive, off the ground,
 * not jetting, and falling faster than FALLING_VY. Drives the fall
 * frame at every selectSoldierFrame call site so the committed
 * soldier.fall card reads mid-match (issue #403). Pure: no DOM.
 */
export function isFallingPose(input: {
  alive?: boolean;
  onGround?: boolean;
  jetting?: boolean;
  vy?: number;
}): boolean {
  if (input.alive !== true || input.onGround !== false || input.jetting === true) {
    return false;
  }
  const vy = Number(input.vy);
  return Number.isFinite(vy) && vy > FALLING_VY;
}

/** Pose fields the frame selector reads (AnimPose-compatible). */
export interface SoldierPoseInput {
  /** Burst pose wins over every other frame. */
  deadPose?: boolean;
  /** Tucked legs while alive and jetting. */
  tuck?: boolean;
  /** Dangling legs while airborne and falling (not jetting). */
  falling?: boolean;
  /** Explicit crouch flag (describeFrame row). */
  crouching?: boolean;
  /** Vertical squash (crouch ratio, else 1); < 1 reads as crouch. */
  heightScale?: number;
  /** Wall-clock run-cycle phase in radians (run-a/b quadrant). */
  legPhase?: number;
  /** Signed leg offset in local px (|swing| < 0.5 reads as idle). */
  swing?: number;
}

/**
 * Select the soldier frame for a pose. Dead wins, then crouch, then the
 * jet tuck, then the airborne fall dangle, then run-a/run-b by
 * legPhase quadrant while the legs swing, else idle. Pure: no DOM,
 * no clock reads.
 */
export function selectSoldierFrame(pose: SoldierPoseInput): SoldierFrameId {
  if (pose.deadPose === true) {
    return "dead";
  }
  if (
    pose.crouching === true ||
    (pose.heightScale !== undefined && pose.heightScale < 1)
  ) {
    return "crouch";
  }
  if (pose.tuck === true) {
    return "jet";
  }
  if (pose.falling === true) {
    return "fall";
  }
  if (Math.abs(pose.swing ?? 0) < 0.5) {
    return "idle";
  }
  const quadrant = Math.floor((pose.legPhase ?? 0) / Math.PI) % 2;
  const norm = ((quadrant % 2) + 2) % 2;
  return norm === 0 ? "run-a" : "run-b";
}

/** Per-weapon in-hand gun geometry (pivot-relative, rest pose at +x). */
export interface WeaponDef {
  /** Muzzle distance from ARM_PIVOT in local px (drives the tracer tip). */
  length: number;
  /** Gun segment stroke width in local px. */
  width: number;
  /** Gun paint as a Pixi hex int. */
  color: number;
  /** Gun paint as CSS. */
  colorCss: string;
  /** Documented muzzle pixel on the in-hand icon well (equals length). */
  muzzleX: number;
}

/**
 * Per-weapon gun table. Lengths are visual alignment only (never damage
 * tuning); the pistol row tracks BARREL_LENGTH through access-time
 * getters (never a frozen literal), so the drawn gun segment and the tip
 * math stay single-sourced. Getters defer the BARREL_LENGTH read past
 * module top level: renderer/index.ts imports this module, so a top-level
 * read would TDZ-crash whichever entry point loads first (same idiom as
 * character.ts gunBarrel()).
 */
export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  pistol: {
    get length(): number {
      return BARREL_LENGTH;
    },
    width: 3,
    color: 0xf8fafc,
    colorCss: "#F8FAFC",
    get muzzleX(): number {
      return BARREL_LENGTH;
    },
  },
  smg: { length: 16, width: 3, color: 0xe2e8f0, colorCss: "#E2E8F0", muzzleX: 16 },
  rifle: { length: 18, width: 3, color: 0xfbbf24, colorCss: "#FBBF24", muzzleX: 18 },
  shotgun: { length: 19, width: 4, color: 0xfb923c, colorCss: "#FB923C", muzzleX: 19 },
  sniper: { length: 22, width: 2, color: 0x93c5fd, colorCss: "#93C5FD", muzzleX: 22 },
  rocket: { length: 21, width: 5, color: 0x94a3b8, colorCss: "#94A3B8", muzzleX: 21 },
};

/** Gun geometry row for a weapon id (unknown ids fall back to pistol). */
export function weaponDef(weapon: WeaponId): WeaponDef {
  return WEAPON_DEFS[weapon] ?? WEAPON_DEFS["pistol"];
}

/**
 * Muzzle distance from ARM_PIVOT for a weapon id. The pistol row reads
 * the shared BARREL_LENGTH at call time (TDZ-safe indirection, mirroring
 * character.ts gunBarrel()); unknown ids fall back to the pistol length.
 */
export function weaponLength(weapon: WeaponId): number {
  if (weapon === "pistol") {
    return BARREL_LENGTH;
  }
  return WEAPON_DEFS[weapon]?.length ?? BARREL_LENGTH;
}

/**
 * Weapon-aware muzzle tip in world coords for a body center and aim.
 * Delegates to the shared barrel math with the per-weapon length, so
 * the drawn gun tip, the muzzle flash, and the tracer origin coincide
 * by construction (never re-derive this).
 */
export function soldierMuzzleTip(
  centerX: number,
  centerY: number,
  aim: number,
  weapon: WeaponId = "pistol",
): { x: number; y: number } {
  return barrelEndpoint(centerX, centerY, aim, weaponLength(weapon));
}

/** Team CSS accent for a player index (palette swap of #00E5FF). */
export function soldierAccentFor(index: number): string {
  if (index === 0 && localAccentCss !== null) {
    return localAccentCss;
  }
  return teamCss(index);
}

/** Team Pixi-hex accent for a player index. */
export function soldierAccentHex(index: number): number {
  if (index === 0 && localAccentHex !== null) {
    return localAccentHex;
  }
  return teamColor(index);
}

/** Equipped locker palette for the local player (CSS, null when unset). */
let localAccentCss: string | null = null;
/** Equipped locker palette for the local player (Pixi hex, null when unset). */
let localAccentHex: number | null = null;

/** True for a verbatim #RRGGBB hex string (any palette, not just listed). */
function isHexPalette(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 7 || value[0] !== "#") {
    return false;
  }
  for (let i = 1; i < 7; i += 1) {
    const code = value.charCodeAt(i);
    const hex =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    if (!hex) {
      return false;
    }
  }
  return true;
}

/**
 * Equip the local-player soldier accent from a locker palette: any valid
 * #RRGGBB overrides index 0 (enemies keep their team colors), garbage
 * clears back to the team cyan. Never throws.
 */
export function setLocalAccent(css: unknown): void {
  try {
    if (isHexPalette(typeof css === "string" ? css.trim() : css)) {
      const key = (css as string).trim();
      // Preserve the authored casing for probe equality (upper/lower
      // both compare case-insensitively) while normalizing the hex.
      localAccentCss = key;
      localAccentHex = Number.parseInt(key.slice(1), 16);
      return;
    }
    // Bare 6-digit hex without the hash (harness shorthand) also equips.
    if (typeof css === "string" && /^[0-9a-fA-F]{6}$/.test(css.trim())) {
      const key = `#${css.trim()}`;
      localAccentCss = key;
      localAccentHex = Number.parseInt(key.slice(1), 16);
      return;
    }
    localAccentCss = null;
    localAccentHex = null;
  } catch {
    localAccentCss = null;
    localAccentHex = null;
  }
}

/** Clear the local-player accent back to the team cyan. Never throws. */
export function clearLocalAccent(): void {
  localAccentCss = null;
  localAccentHex = null;
}

/**
 * Clamp a blend weight into [0, 1] (non-finite readings take the fallback).
 */
function clampBlend(weight: number | undefined, fallback: number): number {
  if (weight === undefined || !Number.isFinite(weight)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, weight));
}

/**
 * Blended per-frame leg offset in local px for one side (-1 legL, +1 legR).
 * Starts from the soldierLegOffset result: the stride dy scales by the
 * gait blend while the air blend widens (dx) and lowers (dy) the stance,
 * so run-a/run-b stay mirrored opposites at any blend. Jet tuck and dead
 * splay ride at full weight (never thinned by the blends); gait 1 + air 0
 * returns the base offset exactly. Pure: no DOM, no clock reads.
 */
export function soldierLegOffsetBlended(
  frame: SoldierFrameId,
  swing: number,
  side: -1 | 1,
  gaitBlend?: number,
  airBlend?: number,
): { dx: number; dy: number } {
  const base = soldierLegOffset(frame, swing, side);
  if (frame === "dead" || frame === "jet" || frame === "fall") {
    return base;
  }
  const gait = clampBlend(gaitBlend, 1);
  const air = clampBlend(airBlend, 0);
  if (gait === 1 && air === 0) {
    return base;
  }
  return {
    dx: base.dx + side * air * 2,
    dy: base.dy * gait + air * 1,
  };
}

/**
 * Per-frame leg offset in local px for one side (-1 legL, +1 legR).
 * Mirrors the anim.ts tuck/dead constants both renderer backends pose
 * from; run-b mirrors run-a so the two run cards read as alternating
 * strides, crouch widens the stance while the squash handles height.
 */
export function soldierLegOffset(
  frame: SoldierFrameId,
  swing: number,
  side: -1 | 1,
): { dx: number; dy: number } {
  switch (frame) {
    case "dead":
      return { dx: side * DEAD_SPLAY_PX, dy: -DEAD_LIFT_PX };
    case "jet":
      return { dx: side * -TUCK_IN_PX, dy: -TUCK_UP_PX };
    case "fall":
      // Dangling legs: slight outward splay, trailing below the torso.
      return { dx: side * 2, dy: 3 };
    case "run-b":
      return { dx: 0, dy: -side * swing };
    case "crouch":
      return { dx: side * 2, dy: (side * swing) / 2 };
    case "run-a":
    default:
      return { dx: 0, dy: side * swing };
  }
}
