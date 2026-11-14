// Animated CC0 soldier sprite layer: pose-frame selection, per-weapon gun
// geometry, and muzzle-tip math — the single source of truth both
// renderer backends (Pixi containers in playerView.ts and the canvas2d
// fallback in renderer/index.ts) consume. DOM/Pixi-free: every helper
// takes plain numbers and strings and every clock value arrives as an
// argument, so the whole module stays unit-testable under node like
// anim.ts/character.ts. Tinting stays a client-side palette swap of the
// authored #00E5FF accent onto the existing teamCss families, so
// mid-match screenshots keep >= 2 distinct hues across players.
import { BARREL_LENGTH, barrelEndpoint } from "../renderer/index";
import { teamColor, teamCss } from "./character";
import type { WeaponId } from "../../../core/src/weapons";
import { DEAD_LIFT_PX, DEAD_SPLAY_PX, TUCK_IN_PX, TUCK_UP_PX } from "./anim";

/** Animated soldier frame ids (one atlas card each). */
export const SOLDIER_FRAME_IDS = [
  "idle",
  "run-a",
  "run-b",
  "jet",
  "crouch",
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
  dead: "soldier-dead",
};

/** Pose fields the frame selector reads (AnimPose-compatible). */
export interface SoldierPoseInput {
  /** Burst pose wins over every other frame. */
  deadPose?: boolean;
  /** Tucked legs while alive and jetting. */
  tuck?: boolean;
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
 * jet tuck, then run-a/run-b by legPhase quadrant while the legs swing,
 * else idle. Pure: no DOM, no clock reads.
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
  /** Documented muzzle pixel on the weapon-*.svg card (equals length). */
  muzzleX: number;
}

/**
 * Per-weapon gun table. Lengths are visual alignment only (never damage
 * tuning); the pistol row matches BARREL_LENGTH exactly so the pistol
 * stays the canonical default and the barrel-convention guard keeps
 * passing. Read via weaponLength()/weaponDef() so the pistol row tracks
 * the shared constant at call time instead of freezing it at module top
 * level (renderer/index.ts imports this module, so a top-level read
 * would TDZ-crash whichever entry point loads first).
 */
export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = {
  pistol: { length: 8, width: 3, color: 0xf8fafc, colorCss: "#F8FAFC", muzzleX: 8 },
  smg: { length: 10, width: 3, color: 0xe2e8f0, colorCss: "#E2E8F0", muzzleX: 10 },
  rifle: { length: 12, width: 3, color: 0xfbbf24, colorCss: "#FBBF24", muzzleX: 12 },
  shotgun: { length: 13, width: 4, color: 0xfb923c, colorCss: "#FB923C", muzzleX: 13 },
  sniper: { length: 16, width: 2, color: 0x93c5fd, colorCss: "#93C5FD", muzzleX: 16 },
  rocket: { length: 15, width: 5, color: 0x94a3b8, colorCss: "#94A3B8", muzzleX: 15 },
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
  return teamCss(index);
}

/** Team Pixi-hex accent for a player index. */
export function soldierAccentHex(index: number): number {
  return teamColor(index);
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
    case "run-b":
      return { dx: 0, dy: -side * swing };
    case "crouch":
      return { dx: side * 2, dy: (side * swing) / 2 };
    case "run-a":
    default:
      return { dx: 0, dy: side * swing };
  }
}
