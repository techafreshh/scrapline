// Shared entity shapes for the sim.
//
// The sim is sacred: this module is type-only (no imports, no runtime
// code) so sim, bots, and renderers share shapes without coupling.
// All fields are serializable scalars (no Date, no methods, no classes).

import type { WeaponId } from "./weapons";

/** Delivery kind for a weapon. */
export type WeaponKind = "hitscan" | "projectile";

/** Projectile kinds: every weapon plus thrown grenades. */
export type ProjectileKind = WeaponId | "grenade";

/** Pickup kinds. */
export type PickupKind = "weapon" | "health" | "grenades";

/** Prop kinds. */
export type PropKind = "barrel" | "crate";

/** A player in the sim. */
export interface Player {
  /** Unique player id. */
  id: number;
  /** Position x in pixels. */
  x: number;
  /** Position y in pixels. */
  y: number;
  /** Velocity x in pixels per second. */
  vx: number;
  /** Velocity y in pixels per second. */
  vy: number;
  /** Health points. */
  hp: number;
  /** Jetpack fuel. */
  fuel: number;
  /** Aim angle. */
  aim: number;
  /** Equipped weapon. */
  weapon: WeaponId;
  /** True when standing on ground. */
  onGround: boolean;
  /** True when crouching. */
  crouching: boolean;
  /** True when alive. */
  alive: boolean;
  /** Rounds in the magazine. */
  magAmmo: number;
  /** Rounds in reserve. */
  reserveAmmo: number;
  /** True while reloading. */
  reloading: boolean;
  /** Ticks until respawn (0 when alive). */
  respawnTicks: number;
  /** Grenade slots remaining (max 3, backfilled for pre-lap players). */
  grenades?: number;
  /** Ticks until the next grenade throw is allowed. */
  grenadeCooldownTicks?: number;
  /** Ticks of spawn protection left (damage ignored while > 0). */
  protectionTicks?: number;
  /** Ticks until the next shot is allowed. */
  cooldownTicks?: number;
  /** Ticks left in the active reload (0 when not reloading). */
  reloadTicks?: number;
  /** Ticks since last damage taken (regen delay gate). */
  ticksSinceDamage?: number;
  /** Spawn x recorded at addPlayer (respawn target). */
  spawnX?: number;
  /** Spawn y recorded at addPlayer (respawn target). */
  spawnY?: number;
}

/** A projectile in flight. */
export interface Projectile {
  /** Unique projectile id. */
  id: number;
  /** Projectile kind. */
  kind: ProjectileKind;
  /** Position x in pixels. */
  x: number;
  /** Position y in pixels. */
  y: number;
  /** Velocity x in pixels per second. */
  vx: number;
  /** Velocity y in pixels per second. */
  vy: number;
  /** Damage on direct hit. */
  damage: number;
  /** Owning player id. */
  ownerId: number;
  /** Ticks remaining before expiry. */
  lifeTicks: number;
}

/** A pickup on the map. */
export interface Pickup {
  /** Unique pickup id. */
  id: number;
  /** Pickup kind. */
  kind: PickupKind;
  /** Position x in pixels. */
  x: number;
  /** Position y in pixels. */
  y: number;
  /** Weapon granted (weapon pickups only). */
  weapon?: WeaponId;
  /** Amount granted (health/grenades). */
  amount: number;
  /** True when collectible. */
  active: boolean;
  /** Ticks until respawn after collection. */
  respawnTicks: number;
}

/** A destructible prop on the map. */
export interface Prop {
  /** Unique prop id. */
  id: number;
  /** Prop kind. */
  kind: PropKind;
  /** Position x in pixels. */
  x: number;
  /** Position y in pixels. */
  y: number;
  /** Width in pixels. */
  w: number;
  /** Height in pixels. */
  h: number;
  /** Health points. */
  hp: number;
  /** True when intact. */
  alive: boolean;
  /** Ticks until respawn after destruction. */
  respawnTicks: number;
}
