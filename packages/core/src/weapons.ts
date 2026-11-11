// Weapon stat table — the single tunable surface for weapon tuning.
//
// The sim is sacred: this module is pure data (export const literals only,
// no imports, no functions) so tuning never leaks DOM, Node, clock, or
// Math.random behavior into packages/core. Cooldown ticks match the
// WEAPON_*_INTERVAL_TICKS constants in constants.ts; reload is in ticks
// at 60 Hz, spread in radians, range in pixels.

/** Weapon ids in the stat table. */
export type WeaponId = "pistol" | "smg" | "rifle" | "shotgun" | "sniper" | "rocket";

/** Tunable per-weapon stats. */
export interface WeaponStat {
  /** Damage per hit (per pellet for shotgun, direct hit for rocket). */
  damage: number;
  /** Ticks between shots at 60 Hz. */
  cooldownTicks: number;
  /** Magazine capacity. */
  mag: number;
  /** Reload time in ticks at 60 Hz. */
  reload: number;
  /** Spread in radians. */
  spread: number;
  /** Effective range in pixels. */
  range: number;
  /** Projectiles per shot (8 for shotgun, 1 otherwise). */
  pellets: number;
  /** Hitscan or projectile delivery. */
  kind: "hitscan" | "projectile";
  /** Display name. */
  name: string;
  /** Fixed headshot multiplier applied in the top 15px band. */
  headshotMult: number;
  /** Splash radius in pixels (rocket only). */
  splashRadius?: number;
  /** Splash damage (rocket only). */
  splashDamage?: number;
}

/** Frozen six-weapon stat table. */
export const WEAPONS: Record<WeaponId, WeaponStat> = Object.freeze({
  pistol: Object.freeze({
    damage: 20,
    cooldownTicks: 14,
    mag: 12,
    reload: 60,
    spread: 0.022,
    range: 950,
    pellets: 1,
    kind: "hitscan",
    name: "Pistol",
    headshotMult: 1.5,
  }),
  smg: Object.freeze({
    damage: 11,
    cooldownTicks: 5,
    mag: 32,
    reload: 90,
    spread: 0.07,
    range: 760,
    pellets: 1,
    kind: "hitscan",
    name: "SMG",
    headshotMult: 1.3,
  }),
  rifle: Object.freeze({
    damage: 17,
    cooldownTicks: 7,
    mag: 30,
    reload: 90,
    spread: 0.034,
    range: 1150,
    pellets: 1,
    kind: "hitscan",
    name: "Rifle",
    headshotMult: 1.5,
  }),
  shotgun: Object.freeze({
    damage: 9,
    cooldownTicks: 30,
    mag: 5,
    reload: 120,
    spread: 0.09,
    range: 560,
    pellets: 8,
    kind: "hitscan",
    name: "Shotgun",
    headshotMult: 1.3,
  }),
  sniper: Object.freeze({
    damage: 95,
    cooldownTicks: 60,
    mag: 5,
    reload: 150,
    spread: 0.004,
    range: 2600,
    pellets: 1,
    kind: "hitscan",
    name: "Sniper",
    headshotMult: 1.6,
  }),
  rocket: Object.freeze({
    damage: 110,
    cooldownTicks: 54,
    mag: 2,
    reload: 150,
    spread: 0.01,
    range: 3000,
    pellets: 1,
    kind: "projectile",
    name: "Rocket",
    headshotMult: 1.0,
    splashRadius: 150,
    splashDamage: 110,
  }),
} as Record<WeaponId, WeaponStat>);
