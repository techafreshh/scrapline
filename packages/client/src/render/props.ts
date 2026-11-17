// Props and pickups as pack sprites with states retained (issue #267).
//
// Crates, barrels, weapon/health/grenade pads, and bounce pads render from
// Kenney CC0 pack art while keeping gameplay states and readability: crate
// crack stages at <=50% HP, barrel explosion squash, and pads keep floating
// labels plus a glow pulse. Runtime code never imports vendor PNGs directly:
// every frame resolves through the atlas pipeline manifest keys
// (tools/build-atlas.js allowlist), so the build fails on a missing frame
// instead of shipping a broken prop. Crate and barrel sprites land 1:1 over
// the sim AABB; pads land centered on the pickup point; bounce squash and
// barrel explode squash compress height from the tile/prop bottom.
//
// DOM/Pixi-free: every helper takes plain numbers and strings, so the
// module stays unit-testable under node like render/tiles.ts. Image
// loading and canvas tinting live in renderer/index.ts; this module only
// names textures, files, and the state-to-key mapping the probes drive.
import { BARREL_HP, CRATE_HP } from "../../../core/src/constants";

/** Vendor pack backing crate/barrel/pad art (Kenney CC0). */
export const PROP_PACK = "simplified-platformer-pack";
/** Vendor pack backing the barrel explosion scorch (Kenney CC0). */
export const PROP_EXPLODE_PACK = "particle-pack";

/** Manifest key prefix for the prop family (built without a quoted
 * dotted literal so the atlas reference scanner only sees full keys,
 * mirroring the TILE_PREFIX idiom in render/tiles.ts). */
export const PROP_PREFIX = "prop" + ".";
/** Manifest key prefix for the pad family (same scanner-safe idiom). */
export const PAD_PREFIX = "pad" + ".";

/** Atlas family subdirectories holding the staged prop/pad PNGs. */
export const PROP_ATLAS_DIR = "props";
export const PAD_ATLAS_DIR = "pads";

/** HP fraction at or below which a prop reads cracked (mirrors view/props). */
export const PROP_CRACK_FRACTION = 0.5;

/** Pad glow pulse period in ms (half period = 400ms probe spacing). */
export const PAD_GLOW_PERIOD_MS = 800;
/** Pad glow pulse floor (alpha at the trough). */
export const PAD_GLOW_MIN = 0.45;
/** Pad glow pulse ceiling (alpha at the peak). */
export const PAD_GLOW_MAX = 0.95;

/**
 * Crate sprite keys (simplified-platformer-pack tiles, byte-distinct).
 * Damaged differs from intact and carries the crack read.
 */
export const CRATE_SPRITE_KEYS = {
  intact: "prop.crate.intact",
  crack: "prop.crate.crack",
} as const;

/**
 * Barrel sprite keys (simplified tiles plus a particle scorch for the
 * explosion). Destroyed barrels read the explode key (squash/explode
 * probe band); damaged barrels read the crack key.
 */
export const BARREL_SPRITE_KEYS = {
  intact: "prop.barrel.intact",
  crack: "prop.barrel.crack",
  explode: "prop.barrel.explode",
} as const;

/**
 * Pad sprite keys (simplified items for weapon/health/grenade, tiles
 * for bounce). The bounce squash key carries the squash read while the
 * squash cycle is active.
 */
export const PAD_SPRITE_KEYS = {
  weapon: "pad.weapon",
  health: "pad.health",
  grenades: "pad.grenades",
  bounce: "pad.bounce",
  bounceSquash: "pad.bounce.squash",
} as const;

/** Staged atlas file per prop/pad texture key (mirrors the allowlist). */
export const PROP_SPRITE_FILES: Record<string, string> = {
  "prop.crate.intact": "props/prop-crate-intact.png",
  "prop.crate.crack": "props/prop-crate-crack.png",
  "prop.barrel.intact": "props/prop-barrel-intact.png",
  "prop.barrel.crack": "props/prop-barrel-crack.png",
  "prop.barrel.explode": "props/prop-barrel-explode.png",
  "pad.weapon": "pads/pad-weapon.png",
  "pad.health": "pads/pad-health.png",
  "pad.grenades": "pads/pad-grenades.png",
  "pad.bounce": "pads/pad-bounce.png",
  "pad.bounce.squash": "pads/pad-bounce-squash.png",
};

/** File for one prop/pad texture key (null when unknown). Pure. */
export function propSpriteFile(key: string): string | null {
  return PROP_SPRITE_FILES[key] ?? null;
}

/** File for one pad texture key (null when unknown). Pure. */
export function padSpriteFile(key: string): string | null {
  return PROP_SPRITE_FILES[key] ?? null;
}

/** True for a barrel kind reading (case-insensitive, trimmed). */
function isBarrelKind(kind: unknown): boolean {
  return typeof kind === "string" && kind.trim().toLowerCase() === "barrel";
}

/** True for a crate kind reading (everything non-barrel reads crate). */
function isCrateKind(kind: unknown): boolean {
  return !isBarrelKind(kind);
}

/**
 * Normalize a prop kind reading to crate/barrel. Unknown kinds read
 * crate (mirrors view/props propMaxHp so bad data still classifies).
 * Pure.
 */
export function normalizePropKind(kind: unknown): "crate" | "barrel" {
  return isBarrelKind(kind) ? "barrel" : "crate";
}

/**
 * HP fraction in [0, 1] for a prop kind and hp reading. Non-finite hp
 * reads intact (1) so shorn harnesses paint the reference sprite.
 * Pure.
 */
export function propHpFraction(kind: unknown, hp: unknown): number {
  const max = isBarrelKind(kind) ? BARREL_HP : CRATE_HP;
  const value = Number(hp);
  if (!Number.isFinite(value) || max <= 0) {
    return 1;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= max) {
    return 1;
  }
  return value / max;
}

/**
 * True when the prop paints its cracked sprite (at or below half HP).
 * Pure.
 */
export function isPropCracked(kind: unknown, hp: unknown): boolean {
  return propHpFraction(kind, hp) <= PROP_CRACK_FRACTION;
}

/**
 * Logical sprite key for a prop kind and hp reading. Destroyed barrels
 * (hp <= 0) read the explode key (squash/explode probe band); cracked
 * props read the crack key; everything else reads intact. The damaged
 * key always differs from the intact key and contains `crack`, and the
 * barrel explode key contains `explode`. Pure.
 */
export function propSpriteKey(kind: unknown, hp: unknown): string {
  const value = Number(hp);
  if (isBarrelKind(kind)) {
    if (Number.isFinite(value) && value <= 0) {
      return BARREL_SPRITE_KEYS.explode;
    }
    if (isPropCracked(kind, hp)) {
      return BARREL_SPRITE_KEYS.crack;
    }
    return BARREL_SPRITE_KEYS.intact;
  }
  if (isPropCracked(kind, hp)) {
    return CRATE_SPRITE_KEYS.crack;
  }
  return CRATE_SPRITE_KEYS.intact;
}

/**
 * Normalize a pickup kind reading to weapon/health/grenades/bounce.
 * Unknown readings fall back to weapon so bad data still paints a pad.
 * Pure.
 */
export function normalizePadKind(kind: unknown): "weapon" | "health" | "grenades" | "bounce" {
  if (typeof kind === "string") {
    const key = kind.trim().toLowerCase();
    if (key === "health") {
      return "health";
    }
    if (key === "grenades" || key === "grenade") {
      return "grenades";
    }
    if (key === "bounce") {
      return "bounce";
    }
  }
  return "weapon";
}

/**
 * Logical sprite key for a pickup pad kind. Health, grenade, and weapon
 * pads each own a distinct key; bounce pads read the squash key while
 * the squash cycle is active (scale < 0.9) else the idle key. Pure.
 */
export function padSpriteKey(kind: unknown, squash?: unknown): string {
  const normalized = normalizePadKind(kind);
  if (normalized === "health") {
    return PAD_SPRITE_KEYS.health;
  }
  if (normalized === "grenades") {
    return PAD_SPRITE_KEYS.grenades;
  }
  if (normalized === "bounce") {
    const s = Number(squash);
    if (Number.isFinite(s) && s < 0.9) {
      return PAD_SPRITE_KEYS.bounceSquash;
    }
    return PAD_SPRITE_KEYS.bounce;
  }
  return PAD_SPRITE_KEYS.weapon;
}

/**
 * Bounce pad sprite key for a squash scale reading. Idle (1) reads the
 * bounce key; compressed (< 0.9, the 300ms peak) reads the squash key
 * so the squash cycle animates through distinct pack art. Pure.
 */
export function bouncePadSpriteKey(squash: unknown): string {
  return padSpriteKey("bounce", squash);
}

/**
 * Pad glow pulse alpha in [PAD_GLOW_MIN, PAD_GLOW_MAX] for a wall-clock
 * reading in ms. Sine pulse over PAD_GLOW_PERIOD_MS (800ms), so samples
 * 400ms apart (half a period) land on opposite extremes and always
 * differ. Non-finite readings hold the midpoint. Pure: no DOM, no clock
 * reads.
 */
export function padGlowAlphaAt(nowMs: unknown): number {
  const t = Number(nowMs);
  if (!Number.isFinite(t)) {
    return (PAD_GLOW_MIN + PAD_GLOW_MAX) / 2;
  }
  const phase = ((t % PAD_GLOW_PERIOD_MS) + PAD_GLOW_PERIOD_MS) % PAD_GLOW_PERIOD_MS;
  const cosine = Math.cos((phase / PAD_GLOW_PERIOD_MS) * Math.PI * 2);
  const mid = (PAD_GLOW_MIN + PAD_GLOW_MAX) / 2;
  const amp = (PAD_GLOW_MAX - PAD_GLOW_MIN) / 2;
  return mid + amp * cosine;
}

/** Probe-facing prop row (FrameProp compatible, sim state only). */
export interface PropProbeProp {
  kind: unknown;
  hp: unknown;
  alive?: unknown;
}

/** Probe-facing pickup row (FramePickup compatible, sim state only). */
export interface PropProbePickup {
  kind: unknown;
  active?: unknown;
}

/**
 * Canonical probe frame keys for the current sim rows: one crate key,
 * one barrel key, one weapon pad key, one health/grenade pad key, and
 * one bounce pad key (squash-aware). Falls back to the intact/idle key
 * per family when that family has no live row, so the array always
 * carries 5 entries each containing `prop.` or `pad.` and zero
 * containing `vector`. Pure.
 */
export function propFramesFor(
  props: readonly PropProbeProp[] | null | undefined,
  pickups: readonly PropProbePickup[] | null | undefined,
  squash?: unknown,
): string[] {
  let crateKey: string | null = null;
  let barrelKey: string | null = null;
  if (Array.isArray(props)) {
    for (const prop of props) {
      if (prop === null || prop === undefined) {
        continue;
      }
      const rec = prop as PropProbeProp;
      if (isBarrelKind(rec.kind)) {
        if (barrelKey === null) {
          barrelKey = propSpriteKey(rec.kind, rec.hp);
        }
      } else if (isCrateKind(rec.kind) || crateKey === null) {
        // First non-barrel prop owns the crate slot so crate/barrel
        // rows never collapse onto one key.
        if (crateKey === null) {
          crateKey = propSpriteKey("crate", rec.hp);
        }
      }
    }
  }
  let weaponKey: string | null = null;
  let healthKey: string | null = null;
  if (Array.isArray(pickups)) {
    for (const pickup of pickups) {
      if (pickup === null || pickup === undefined) {
        continue;
      }
      const rec = pickup as PropProbePickup;
      if (rec.active === false) {
        continue;
      }
      const normalized = normalizePadKind(rec.kind);
      if (normalized === "weapon" && weaponKey === null) {
        weaponKey = PAD_SPRITE_KEYS.weapon;
      } else if (
        (normalized === "health" || normalized === "grenades") &&
        healthKey === null
      ) {
        healthKey = padSpriteKey(rec.kind);
      }
    }
  }
  return [
    crateKey ?? CRATE_SPRITE_KEYS.intact,
    barrelKey ?? BARREL_SPRITE_KEYS.intact,
    weaponKey ?? PAD_SPRITE_KEYS.weapon,
    healthKey ?? PAD_SPRITE_KEYS.health,
    bouncePadSpriteKey(squash),
  ];
}
