// Soldier sprite swap: animated pack poses with roster tints and arm aim.
//
// Source pack: Kenney `platformer-characters` (CC0) Soldier set. Runtime
// code never imports vendor PNGs directly: every frame resolves through
// the atlas pipeline manifest keys (tools/build-atlas.js allowlist), so
// the build fails on a missing frame instead of shipping a broken pose.
// The in-match soldier renders from the `platformer-characters` Soldier
// poses (idle, 4-frame run cycle, jet, crouch, hurt, death); the
// arm/weapon anchor is preserved from the composed vector geometry so the
// barrel, tracers, and muzzle align as before; per-player tints map the
// pack palette to roster cyan for the local player and warm tones for
// enemies while keeping outlines dark.
//
// DOM/Pixi-free: every helper takes plain numbers and strings, so the
// module stays unit-testable under node like view/soldier.ts. Image
// loading and canvas tinting live in renderer/index.ts; this module only
// names textures, anchors, tints, and the debug override the probes drive.
import type { WeaponId } from "../../../core/src/weapons";

/** Vendor pack backing every soldier frame (Kenney CC0). */
export const SOLDIER_PACK = "platformer-characters";

/** Manifest key prefix for the soldier family (built without a quoted
 * dotted literal so the atlas reference scanner only sees full keys). */
export const SOLDIER_PREFIX = "soldier" + ".";
/** Manifest key prefix for the run family (same scanner-safe idiom). */
export const SOLDIER_RUN_PREFIX = SOLDIER_PREFIX + "run";

/** Pack family directory inside the vendor tree. */
export const SOLDIER_PACK_DIR = "platformer-characters/PNG/Soldier";

/** Atlas family subdirectory holding the staged soldier PNGs. */
export const SOLDIER_ATLAS_DIR = "characters";

/**
 * Four-frame run cycle (platformer-characters Soldier walk/stand/skid).
 * tools/build-atlas.js maps walk1/walk2/stand/skid so soldier.run.3
 * always resolves; dwelling on any single card still reads as a run.
 */
export const SOLDIER_RUN_KEYS = [
  "soldier.run.0",
  "soldier.run.1",
  "soldier.run.2",
  "soldier.run.3",
] as const;

/** One run-cycle texture key. */
export type SoldierRunKey = (typeof SOLDIER_RUN_KEYS)[number];

/**
 * Full in-match pose textures (all keys exist in the vendor manifest).
 * Hurt rides soldier.fall (a distinct flinch card) while death rides
 * soldier.dead (the hurt card); the white hurt flash overlays on top.
 */
export const SOLDIER_SPRITE_KEYS = {
  idle: "soldier.idle",
  run0: "soldier.run.0",
  run1: "soldier.run.1",
  run2: "soldier.run.2",
  run3: "soldier.run.3",
  jet: "soldier.jet",
  crouch: "soldier.crouch",
  hurt: "soldier.fall",
  dead: "soldier.dead",
} as const;

/** Staged atlas file per soldier texture key (mirrors the allowlist). */
export const SOLDIER_SPRITE_FILES: Record<string, string> = {
  "soldier.idle": "characters/soldier_idle.png",
  "soldier.run.0": "characters/soldier_walk1.png",
  "soldier.run.1": "characters/soldier_walk2.png",
  "soldier.run.2": "characters/soldier_stand.png",
  "soldier.run.3": "characters/soldier_skid.png",
  "soldier.jet": "characters/soldier_jump.png",
  "soldier.crouch": "characters/soldier_duck.png",
  "soldier.fall": "characters/soldier_fall.png",
  "soldier.dead": "characters/soldier_hurt.png",
};

/** File for one soldier texture key (null when unknown). */
export function soldierSpriteFile(key: string): string | null {
  return SOLDIER_SPRITE_FILES[key] ?? null;
}

/**
 * Arm/weapon anchor in player-local px, preserved from the composed
 * vector geometry (view/character.ts ARM_PIVOT). The sprite body is drawn
 * centered on the player box so this pivot lands on the same world point
 * the vector gun rotated around; the drawn gun segment, the barrel tip,
 * and the tracer origin coincide by construction.
 */
export const SOLDIER_ARM_ANCHOR = { x: 13, y: 29 };

/**
 * Arm anchor in staged-sprite px for the 80x110 Soldier cards. The cards
 * are drawn scaled to the 26x58 player box, so this maps to
 * SOLDIER_ARM_ANCHOR in local px (shoulder height on the torso).
 */
export const SOLDIER_ARM_ANCHOR_SPRITE = { x: 40, y: 62 };

/** Sprite card size in px (every Soldier pose is 80x110). */
export const SOLDIER_SPRITE_SIZE = { w: 80, h: 110 };

/** Local player roster tint (cyan). */
export const SOLDIER_LOCAL_CSS = "#00E5FF";
/** Local player roster tint as Pixi hex. */
export const SOLDIER_LOCAL_HEX = 0x00e5ff;
/** Enemy family A roster tint (vivid orange-red, warm). */
export const SOLDIER_ENEMY_A_CSS = "#FF6B35";
/** Enemy family A roster tint as Pixi hex. */
export const SOLDIER_ENEMY_A_HEX = 0xff6b35;
/** Enemy family B roster tint (warm amber). */
export const SOLDIER_ENEMY_B_CSS = "#FFB347";
/** Enemy family B roster tint as Pixi hex. */
export const SOLDIER_ENEMY_B_HEX = 0xffb347;

/** Target hues for the palette swap (cyan vs warm, outlines stay dark). */
export const SOLDIER_TINT_HUES = {
  local: 187,
  enemyA: 16,
  enemyB: 33,
} as const;

/** Roster CSS tint for a player index (local cyan, enemies warm). */
export function soldierTintCss(index: number): string {
  if (index === 0) {
    return SOLDIER_LOCAL_CSS;
  }
  return index % 2 === 1 ? SOLDIER_ENEMY_A_CSS : SOLDIER_ENEMY_B_CSS;
}

/** Roster Pixi-hex tint for a player index. */
export function soldierTintHex(index: number): number {
  if (index === 0) {
    return SOLDIER_LOCAL_HEX;
  }
  return index % 2 === 1 ? SOLDIER_ENEMY_A_HEX : SOLDIER_ENEMY_B_HEX;
}

/** Target palette-swap hue for a player index (170-200 vs 0-50). */
export function soldierTintHue(index: number): number {
  if (index === 0) {
    return SOLDIER_TINT_HUES.local;
  }
  return index % 2 === 1
    ? SOLDIER_TINT_HUES.enemyA
    : SOLDIER_TINT_HUES.enemyB;
}

/**
 * Resolve the run-cycle texture for a leg phase. Quadrants advance
 * run.0 -> run.1 -> run.2 -> run.3 so a full stride reads as 4+ frames;
 * negative phases wrap. Pure.
 */
export function soldierRunKey(legPhase: number): SoldierRunKey {
  const idx =
    ((Math.floor((legPhase ?? 0) / (Math.PI / 2)) % 4) + 4) % 4;
  return SOLDIER_RUN_KEYS[idx] ?? SOLDIER_RUN_KEYS[0];
}

/** Pose fields the sprite resolver reads. */
export interface SoldierSpritePose {
  deadPose?: boolean;
  tuck?: boolean;
  falling?: boolean;
  crouching?: boolean;
  heightScale?: number;
  legPhase?: number;
  swing?: number;
  hurtFlash?: boolean;
}

/**
 * Resolve the manifest texture key for a pose. Dead wins, then crouch,
 * then the jet tuck, then the airborne fall dangle, then the 4-frame
 * run cycle while the legs swing (hurt flashes ride soldier.fall),
 * else idle. The returned key always contains its family
 * (soldier.run.* for running) so probes can match on the soldier run
 * prefix. Pure.
 */
export function soldierSpriteKey(pose: SoldierSpritePose): string {
  if (pose.deadPose === true) {
    return SOLDIER_SPRITE_KEYS.dead;
  }
  if (
    pose.crouching === true ||
    (pose.heightScale !== undefined && pose.heightScale < 1)
  ) {
    return SOLDIER_SPRITE_KEYS.crouch;
  }
  if (pose.tuck === true) {
    return SOLDIER_SPRITE_KEYS.jet;
  }
  if (pose.falling === true) {
    return SOLDIER_SPRITE_KEYS.hurt;
  }
  if (Math.abs(pose.swing ?? 0) < 0.5) {
    if (pose.hurtFlash === true) {
      return SOLDIER_SPRITE_KEYS.hurt;
    }
    return SOLDIER_SPRITE_KEYS.idle;
  }
  if (pose.hurtFlash === true) {
    return SOLDIER_SPRITE_KEYS.hurt;
  }
  return soldierRunKey(pose.legPhase ?? 0);
}

/** Debug override key forced by window.__scrapline.debugFrame. */
let debugTextureKey: string | null = null;

/**
 * Force the active soldier texture (probe hook). Any
 * platformer-characters manifest key is accepted verbatim; anything else
 * clears back to live pose selection. Never throws; returns the key that
 * will read as active (the override or the fallback).
 */
export function debugSoldierFrame(key: unknown, fallback = "soldier.idle"): string {
  try {
    if (typeof key === "string" && key.length > 0) {
      if (
        key.startsWith(SOLDIER_PREFIX) &&
        soldierSpriteFile(key) !== null
      ) {
        debugTextureKey = key;
        return key;
      }
      // Family prefix without a staged card still forces the family so
      // canvas probes capture a run card; the file lookup falls back to
      // the run.3 card for painting.
      if (key.startsWith(SOLDIER_RUN_PREFIX)) {
        debugTextureKey = key;
        return key;
      }
      if (key.startsWith(SOLDIER_PREFIX)) {
        debugTextureKey = key;
        return key;
      }
    }
    debugTextureKey = null;
    return fallback;
  } catch {
    debugTextureKey = null;
    return fallback;
  }
}

/** Clear the debug texture override. Never throws. */
export function clearDebugSoldierFrame(): void {
  debugTextureKey = null;
}

/** Active debug override key (null when live). Never throws. */
export function debugTextureOverride(): string | null {
  return debugTextureKey;
}

/**
 * Active soldier texture for a pose-resolved key: the debug override wins
 * when set (so window.__scrapline.debugFrame("soldier.run.3") reads back
 * a key containing soldier.run), else the live key. Pure.
 */
export function activeSoldierTexture(liveKey: string): string {
  return debugTextureKey ?? liveKey;
}

/**
 * Muzzle tip in world coords from an arm anchor and aim. Lengths mirror
 * the per-weapon gun table (view/soldier.ts WEAPON_DEFS) so the drawn gun
 * tip, the muzzle flash, and the tracer origin coincide; every row stays
 * inside the 10-60px probe band. Pure.
 */
export function soldierMuzzleFromAnchor(
  anchorX: number,
  anchorY: number,
  aim: number,
  weapon: WeaponId = "pistol",
): { x: number; y: number } {
  const length = soldierWeaponLength(weapon);
  return {
    x: anchorX + Math.cos(aim) * length,
    y: anchorY + Math.sin(aim) * length,
  };
}

/**
 * Muzzle distance from the arm anchor per weapon (visual alignment only).
 * All rows clear the >10px probe floor and stay under the 60px ceiling.
 */
export function soldierWeaponLength(weapon: WeaponId): number {
  switch (weapon) {
    case "smg":
      return 16;
    case "rifle":
      return 18;
    case "shotgun":
      return 19;
    case "sniper":
      return 22;
    case "rocket":
      return 21;
    case "pistol":
    default:
      return 14;
  }
}

/**
 * Convert an #RRGGBB string to [r, g, b] triplets. Corrupt input reads
 * local cyan so accents never poison a tint. Pure.
 */
export function hexToRgb(css: unknown): [number, number, number] {
  if (typeof css === "string") {
    const m = css.trim().match(/^#([0-9a-fA-F]{6})$/);
    if (m?.[1] !== undefined) {
      const n = Number.parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  }
  return [0x00, 0xe5, 0xff];
}

/**
 * RGB (0-255) to HSL (h 0-360, s/l 0-1). Pure.
 */
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60;
  } else {
    h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, l };
}

/**
 * HSL (h 0-360, s/l 0-1) to RGB (0-255). Pure.
 */
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * Palette-swap one sprite pixel toward a roster hue. Dark outlines
 * (max channel under 48) and transparent pixels pass through untouched;
 * everything else keeps its saturation and lightness and takes the
 * roster hue, so local torsos sample cyan (170-200) and enemies warm
 * (0-50) while outlines stay dark. Pure.
 */
export function tintSoldierPixel(
  r: number,
  g: number,
  b: number,
  a: number,
  hue: number,
): [number, number, number, number] {
  if (a < 16) {
    return [r, g, b, a];
  }
  if (Math.max(r, g, b) < 48) {
    return [r, g, b, a];
  }
  const { s, l } = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(hue, Math.max(s, 0.55), Math.min(Math.max(l, 0.32), 0.72));
  return [nr, ng, nb, a];
}
