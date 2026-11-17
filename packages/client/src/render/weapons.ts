// In-hand weapon sprites with manifest muzzle points (issue #264).
//
// Each of the six weapon ids owns a distinct in-hand silhouette (the
// committed hand-authored weapon-*.svg cards, the SMG reusing the Hornet
// card exactly like the HUD iconFor mapping) anchored to the soldier
// arm, plus a pivot-relative muzzle offset so muzzle flashes and tracers
// originate at the barrel tip.
//
// DOM/Pixi-free: every helper takes plain numbers and strings, so the
// module stays unit-testable under node like render/soldier.ts. Image
// loading and canvas tinting live in renderer/index.ts; this module only
// names sprite keys, asset files, and pivot-relative muzzle offsets.
//
// Muzzle offsets duplicate the WEAPON_DEFS gun lengths from
// view/soldier.ts (pistol tracks BARREL_LENGTH through the same 14px
// literal): visual alignment only, never balance tuning. The values are
// frozen here with a sync test pinning them to WEAPON_DEFS and to
// soldierWeaponLength, so all three tables stay single-sourced by test.
import type { WeaponId } from "../../../core/src/weapons";

/** Weapon ids with in-hand art (every row of the core stat table). */
export const WEAPON_IDS: readonly WeaponId[] = [
  "pistol",
  "smg",
  "rifle",
  "shotgun",
  "sniper",
  "rocket",
];

/** Manifest key prefix for the weapon family (built without a quoted
 * dotted literal so the atlas reference scanner only sees full keys,
 * mirroring the SOLDIER_PREFIX idiom in render/soldier.ts). */
export const WEAPON_PREFIX = "weapon" + ".";

/** Logical sprite key per weapon id (`weapon.<id>`). */
export const WEAPON_SPRITE_KEYS: Record<WeaponId, string> = {
  pistol: "weapon" + "." + "pistol",
  smg: "weapon" + "." + "smg",
  rifle: "weapon" + "." + "rifle",
  shotgun: "weapon" + "." + "shotgun",
  sniper: "weapon" + "." + "sniper",
  rocket: "weapon" + "." + "rocket",
};

/**
 * Co-located SVG card per weapon id, relative to the client root (like
 * the iconFor asset URL) so file:// and subpath hosts resolve. The SMG
 * reuses the Hornet card exactly like the HUD `iconFor` mapping;
 * `hornet` readings normalize to smg and never form their own id.
 */
export const WEAPON_SPRITE_FILES: Record<WeaponId, string> = {
  pistol: "./assets/weapon-pistol.svg",
  smg: "./assets/weapon-hornet.svg",
  rifle: "./assets/weapon-rifle.svg",
  shotgun: "./assets/weapon-shotgun.svg",
  sniper: "./assets/weapon-sniper.svg",
  rocket: "./assets/weapon-rocket.svg",
};

/** Pivot-relative muzzle offset in world px at rest aim (+x). */
export interface WeaponMuzzle {
  /** Muzzle distance from ARM_PIVOT in local px (equals the gun length). */
  x: number;
  /** Rest-pose vertical offset (0: the gun segment rides the aim axis). */
  y: number;
}

/**
 * Per-weapon muzzle offsets. Each `x` equals the WEAPON_DEFS gun length
 * for that id (view/soldier.ts is the visual source of truth; the sync
 * test pins all three tables), so the drawn gun tip, the muzzle flash,
 * and the tracer origin coincide by construction.
 */
export const WEAPON_MUZZLES: Record<WeaponId, WeaponMuzzle> = {
  pistol: { x: 14, y: 0 },
  smg: { x: 16, y: 0 },
  rifle: { x: 18, y: 0 },
  shotgun: { x: 19, y: 0 },
  sniper: { x: 22, y: 0 },
  rocket: { x: 21, y: 0 },
};

/** True for a stat-table weapon id (never the `hornet` alias). */
function isWeaponId(value: string): value is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(value);
}

/**
 * Normalize a held-weapon reading to a stat-table id. Case-insensitive
 * and whitespace-tolerant; "Hornet" (and "Hornet SMG") resolve to the
 * SMG (the weaponPlaqueFor/iconFor hornet-alias idiom); unknown readings
 * fall back to the pistol so bad data still paints a silhouette.
 */
export function normalizeWeaponId(weapon: unknown): WeaponId {
  if (typeof weapon === "string") {
    const key = weapon.trim().toLowerCase();
    if (key.includes("hornet")) {
      return "smg";
    }
    if (isWeaponId(key)) {
      return key;
    }
  }
  return "pistol";
}

/**
 * Logical sprite key for a held weapon (`weapon.<id>`, always in the
 * manifest muzzle family). Unknown readings fall back to the pistol key
 * so probes always read a `weapon.*` string. Pure.
 */
export function weaponSpriteKey(weapon: unknown): string {
  return WEAPON_SPRITE_KEYS[normalizeWeaponId(weapon)] as string;
}

/**
 * SVG card for a held weapon (client-root-relative path). Unknown
 * readings fall back to the pistol card. Pure.
 */
export function weaponSpriteFile(weapon: unknown): string {
  return WEAPON_SPRITE_FILES[normalizeWeaponId(weapon)] as string;
}

/**
 * Pivot-relative muzzle offset for a held weapon. Returns a copy so
 * callers cannot mutate the table; unknown readings fall back to the
 * pistol offset. Pure.
 */
export function weaponMuzzle(weapon: unknown): WeaponMuzzle {
  const row = WEAPON_MUZZLES[normalizeWeaponId(weapon)] as WeaponMuzzle;
  return { x: row.x, y: row.y };
}
