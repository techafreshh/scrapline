// Sliced icon kit (issue #351, act A6): shared `icon.*` frame keys,
// asset files, and pure selectors for the weapon/pickup/glyph/
// challenge/cosmetic/rank/status families sliced by
// tools/slice-icons.js from the IC-* sheets. Pure helpers stay DOM-free
// and unit-testable under node (the chrome.ts idiom); the manifest sync
// test pins ICON_FILES to the manifest `file` fields.

/** Manifest key prefix for the icon family (built with concatenation
 * so the build-atlas reference scanner never couples to the keys,
 * mirroring the WEAPON_PREFIX idiom in render/weapons.ts). */
export const ICON_PREFIX = "icon" + ".";

/** Weapon full-size keys (IC-01, 32px-class wells like #ammo-icon). */
export const WEAPON_ICON_PISTOL = ICON_PREFIX + "weapon" + "." + "pistol";
export const WEAPON_ICON_SMG = ICON_PREFIX + "weapon" + "." + "smg";
export const WEAPON_ICON_RIFLE = ICON_PREFIX + "weapon" + "." + "rifle";
export const WEAPON_ICON_SHOTGUN = ICON_PREFIX + "weapon" + "." + "shotgun";
export const WEAPON_ICON_SNIPER = ICON_PREFIX + "weapon" + "." + "sniper";
export const WEAPON_ICON_ROCKET = ICON_PREFIX + "weapon" + "." + "rocket";

/** Weapon 16px simplified keys (kill feed wells under 20px). */
export const WEAPON_ICON_PISTOL_SMALL = ICON_PREFIX + "weapon" + "." + "pistol" + "." + "small";
export const WEAPON_ICON_SMG_SMALL = ICON_PREFIX + "weapon" + "." + "smg" + "." + "small";
export const WEAPON_ICON_RIFLE_SMALL = ICON_PREFIX + "weapon" + "." + "rifle" + "." + "small";
export const WEAPON_ICON_SHOTGUN_SMALL = ICON_PREFIX + "weapon" + "." + "shotgun" + "." + "small";
export const WEAPON_ICON_SNIPER_SMALL = ICON_PREFIX + "weapon" + "." + "sniper" + "." + "small";
export const WEAPON_ICON_ROCKET_SMALL = ICON_PREFIX + "weapon" + "." + "rocket" + "." + "small";

/** Pickup keys (IC-02). */
export const PICKUP_ICON_HEALTH = ICON_PREFIX + "pickup" + "." + "health";
export const PICKUP_ICON_GRENADE = ICON_PREFIX + "pickup" + "." + "grenade";
export const PICKUP_ICON_SHIELD = ICON_PREFIX + "pickup" + "." + "shield";
export const PICKUP_ICON_AMMO = ICON_PREFIX + "pickup" + "." + "ammo";

/** Rank badge + star pips (IC-06). */
export const RANK_BADGE_KEY = ICON_PREFIX + "rank" + "." + "badge";
export const RANK_STAR_FILLED = ICON_PREFIX + "rank" + "." + "star-filled";
export const RANK_STAR_OUTLINE = ICON_PREFIX + "rank" + "." + "star-outline";
export const RANK_STAR_CRACKED = ICON_PREFIX + "rank" + "." + "star-cracked";

/**
 * Committed sliced-icon file per key, relative to the atlas dir
 * (mirrors the `file` fields of the `icon.*` entries in
 * assets/atlas/manifest.json; the icon sync test pins them equal).
 */
export const ICON_FILES: Record<string, string> = {
  [WEAPON_ICON_PISTOL]: "icons/weapon-pistol.png",
  [WEAPON_ICON_PISTOL_SMALL]: "icons/weapon-pistol-small.png",
  [WEAPON_ICON_SMG]: "icons/weapon-smg.png",
  [WEAPON_ICON_SMG_SMALL]: "icons/weapon-smg-small.png",
  [WEAPON_ICON_RIFLE]: "icons/weapon-rifle.png",
  [WEAPON_ICON_RIFLE_SMALL]: "icons/weapon-rifle-small.png",
  [WEAPON_ICON_SHOTGUN]: "icons/weapon-shotgun.png",
  [WEAPON_ICON_SHOTGUN_SMALL]: "icons/weapon-shotgun-small.png",
  [WEAPON_ICON_SNIPER]: "icons/weapon-sniper.png",
  [WEAPON_ICON_SNIPER_SMALL]: "icons/weapon-sniper-small.png",
  [WEAPON_ICON_ROCKET]: "icons/weapon-rocket.png",
  [WEAPON_ICON_ROCKET_SMALL]: "icons/weapon-rocket-small.png",
  [PICKUP_ICON_HEALTH]: "icons/pickup-health.png",
  [PICKUP_ICON_GRENADE]: "icons/pickup-grenade.png",
  [PICKUP_ICON_SHIELD]: "icons/pickup-shield.png",
  [PICKUP_ICON_AMMO]: "icons/pickup-ammo.png",
  [ICON_PREFIX + "glyph" + "." + "close"]: "icons/glyph-close.png",
  [ICON_PREFIX + "glyph" + "." + "chev-left"]: "icons/glyph-chev-left.png",
  [ICON_PREFIX + "glyph" + "." + "chev-right"]: "icons/glyph-chev-right.png",
  [ICON_PREFIX + "glyph" + "." + "chev-up"]: "icons/glyph-chev-up.png",
  [ICON_PREFIX + "glyph" + "." + "chev-down"]: "icons/glyph-chev-down.png",
  [ICON_PREFIX + "glyph" + "." + "check"]: "icons/glyph-check.png",
  [ICON_PREFIX + "glyph" + "." + "lock"]: "icons/glyph-lock.png",
  [ICON_PREFIX + "glyph" + "." + "speaker"]: "icons/glyph-speaker.png",
  [ICON_PREFIX + "glyph" + "." + "note"]: "icons/glyph-note.png",
  [ICON_PREFIX + "glyph" + "." + "expand"]: "icons/glyph-expand.png",
  [ICON_PREFIX + "glyph" + "." + "contract"]: "icons/glyph-contract.png",
  [ICON_PREFIX + "glyph" + "." + "monitor"]: "icons/glyph-monitor.png",
  [ICON_PREFIX + "glyph" + "." + "rank-tag"]: "icons/glyph-rank-tag.png",
  [ICON_PREFIX + "glyph" + "." + "magnifier"]: "icons/glyph-magnifier.png",
  [ICON_PREFIX + "glyph" + "." + "menu"]: "icons/glyph-menu.png",
  [ICON_PREFIX + "glyph" + "." + "gamepad"]: "icons/glyph-gamepad.png",
  [ICON_PREFIX + "glyph" + "." + "refresh"]: "icons/glyph-refresh.png",
  [ICON_PREFIX + "glyph" + "." + "clipboard"]: "icons/glyph-clipboard.png",
  [ICON_PREFIX + "glyph" + "." + "star"]: "icons/glyph-star.png",
  [ICON_PREFIX + "glyph" + "." + "info"]: "icons/glyph-info.png",
  [ICON_PREFIX + "challenge" + "." + "headshot"]: "icons/challenge-headshot.png",
  [ICON_PREFIX + "challenge" + "." + "streak"]: "icons/challenge-streak.png",
  [ICON_PREFIX + "challenge" + "." + "jetpack"]: "icons/challenge-jetpack.png",
  [ICON_PREFIX + "challenge" + "." + "trophy"]: "icons/challenge-trophy.png",
  [ICON_PREFIX + "challenge" + "." + "grenade-arc"]: "icons/challenge-grenade-arc.png",
  [ICON_PREFIX + "challenge" + "." + "damage"]: "icons/challenge-damage.png",
  [ICON_PREFIX + "challenge" + "." + "target"]: "icons/challenge-target.png",
  [ICON_PREFIX + "challenge" + "." + "stopwatch"]: "icons/challenge-stopwatch.png",
  [ICON_PREFIX + "cosmetic" + "." + "helmet"]: "icons/cosmetic-helmet.png",
  [ICON_PREFIX + "cosmetic" + "." + "visor"]: "icons/cosmetic-visor.png",
  [ICON_PREFIX + "cosmetic" + "." + "palette"]: "icons/cosmetic-palette.png",
  [RANK_BADGE_KEY]: "icons/rank-badge.png",
  [RANK_STAR_FILLED]: "icons/rank-star-filled.png",
  [RANK_STAR_OUTLINE]: "icons/rank-star-outline.png",
  [RANK_STAR_CRACKED]: "icons/rank-star-cracked.png",
  [ICON_PREFIX + "status" + "." + "skull"]: "icons/status-skull.png",
  [ICON_PREFIX + "status" + "." + "shield-check"]: "icons/status-shield-check.png",
  [ICON_PREFIX + "status" + "." + "bolt"]: "icons/status-bolt.png",
  [ICON_PREFIX + "status" + "." + "shield-broken"]: "icons/status-shield-broken.png",
  [ICON_PREFIX + "status" + "." + "crown"]: "icons/status-crown.png",
  [ICON_PREFIX + "status" + "." + "crosshair"]: "icons/status-crosshair.png",
};

/** Atlas file for an icon key (null for unknown keys). Pure. */
export function iconFileFor(key: unknown): string | null {
  if (typeof key !== "string") {
    return null;
  }
  if (!Object.hasOwn(ICON_FILES, key)) {
    return null;
  }
  return ICON_FILES[key] as string;
}

/**
 * CSS background value for an icon key: client-root-relative so
 * file:// and subpath hosts resolve (the chromeBackgroundFor idiom).
 * Null for unknown keys. Pure.
 */
export function iconBackgroundFor(key: unknown): string | null {
  const file = iconFileFor(key);
  if (file === null) {
    return null;
  }
  return `url("./assets/atlas/${file}")`;
}

/**
 * Client-root-relative <img> src for an icon key (the ammo iconFor
 * asset URL idiom). Null for unknown keys. Pure.
 */
export function iconSrcFor(key: unknown): string | null {
  const file = iconFileFor(key);
  if (file === null) {
    return null;
  }
  return `./assets/atlas/${file}`;
}

/** Weapon ids with a full-size icon (mirrors the ammo KNOWN_IDS list). */
const WEAPON_IDS = ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket"] as const;

/** Normalize a weapon reading to a stat-table id (the ammo idiom). */
function normalizeWeaponId(weapon: unknown): string {
  if (typeof weapon === "string") {
    const key = weapon.trim().toLowerCase();
    if (key.includes("hornet")) {
      return "smg";
    }
    if ((WEAPON_IDS as readonly string[]).includes(key)) {
      return key;
    }
  }
  return "pistol";
}

/**
 * Full-size weapon icon key for a held weapon (`icon.weapon.<id>`).
 * Unknown readings fall back to the pistol key. Pure.
 */
export function weaponIconKeyFor(weapon: unknown): string {
  return ICON_PREFIX + "weapon" + "." + normalizeWeaponId(weapon);
}

/**
 * 16px simplified weapon icon key for a held weapon
 * (`icon.weapon.<id>.small`). Unknown readings fall back to the
 * pistol small key. Pure.
 */
export function weaponIconSmallKeyFor(weapon: unknown): string {
  return ICON_PREFIX + "weapon" + "." + normalizeWeaponId(weapon) + "." + "small";
}

/**
 * Full-size weapon icon src for a held weapon (ammo module wells over
 * 20px). Unknown readings fall back to the pistol card. Pure.
 */
export function weaponIconSrcFor(weapon: unknown): string {
  return (iconSrcFor(weaponIconKeyFor(weapon)) ?? "./assets/atlas/icons/weapon-pistol.png") as string;
}

/**
 * 16px simplified weapon icon src for a held weapon (kill feed wells
 * under 20px). Unknown readings fall back to the pistol small icon.
 * Pure.
 */
export function weaponIconSmallSrcFor(weapon: unknown): string {
  return (iconSrcFor(weaponIconSmallKeyFor(weapon)) ?? "./assets/atlas/icons/weapon-pistol-small.png") as string;
}

/**
 * Pickup icon key for a pad kind: health, grenades/grenade, shield,
 * weapon/ammo map to their IC-02 wells; unknown kinds fall back to
 * the ammo crate so bad data still paints an icon. Pure.
 */
export function pickupIconKeyFor(kind: unknown): string {
  if (typeof kind === "string") {
    const key = kind.trim().toLowerCase();
    if (key === "health") {
      return PICKUP_ICON_HEALTH;
    }
    if (key === "grenades" || key === "grenade") {
      return PICKUP_ICON_GRENADE;
    }
    if (key === "shield") {
      return PICKUP_ICON_SHIELD;
    }
    if (key === "weapon" || key === "ammo") {
      return PICKUP_ICON_AMMO;
    }
  }
  return PICKUP_ICON_AMMO;
}

/** Pickup icon src for a pad kind (pad labels + pickup toasts). Pure. */
export function pickupIconSrcFor(kind: unknown): string {
  return (iconSrcFor(pickupIconKeyFor(kind)) ?? "./assets/atlas/icons/pickup-ammo.png") as string;
}

/**
 * Challenge icon key for a challenge row id: rifle rows read the
 * headshot well, grenade rows the grenade-arc well, shotgun rows the
 * streak well, both win rows the trophy well, unknown ids the target
 * well so bad data still paints a challenge icon. Pure.
 */
export function challengeIconKeyFor(id: unknown): string {
  const base = ICON_PREFIX + "challenge" + ".";
  if (typeof id !== "string") {
    return `${base}target`;
  }
  const key = id.trim().toLowerCase();
  if (key === "rifle-5") {
    return `${base}headshot`;
  }
  if (key === "grenade-2") {
    return `${base}grenade-arc`;
  }
  if (key === "shotgun-3") {
    return `${base}streak`;
  }
  if (key === "win-dune-1" || key === "win-kilima-1") {
    return `${base}trophy`;
  }
  return `${base}target`;
}

/** Challenge icon src for a row id. Pure. */
export function challengeIconSrcFor(id: unknown): string {
  return (iconSrcFor(challengeIconKeyFor(id)) ?? "./assets/atlas/icons/challenge-target.png") as string;
}

/**
 * Cosmetic icon key for a locker row: the helmet well reflects the
 * row helmet family (cap/beret read helmet, hood reads visor, bandana
 * reads palette) so each locker row carries a distinct set icon.
 * Unknown helmets fall back to the helmet well. Pure.
 */
export function cosmeticIconKeyFor(helmet: unknown): string {
  const base = ICON_PREFIX + "cosmetic" + ".";
  if (typeof helmet === "string") {
    const key = helmet.trim().toLowerCase();
    if (key === "hood") {
      return `${base}visor`;
    }
    if (key === "bandana") {
      return `${base}palette`;
    }
  }
  return `${base}helmet`;
}

/** Cosmetic icon src for a locker helmet value. Pure. */
export function cosmeticIconSrcFor(helmet: unknown): string {
  return (iconSrcFor(cosmeticIconKeyFor(helmet)) ?? "./assets/atlas/icons/cosmetic-helmet.png") as string;
}
