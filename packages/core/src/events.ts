// Combat event names — the string-union readout of World.step().
//
// The sim is sacred: this module is pure data (type plus frozen list,
// no imports, no functions) so tuning never leaks DOM, Node, clock, or
// Math.random behavior into packages/core. World.step() keeps returning
// string[]; these literals are the members it may emit.

/** Every event World.step() may emit. */
export type WorldEvent = "shot" | "damage" | "kill" | "hop" | "land" | "explode" | "bounce" | "pickup" | "matchEnd";

/**
 * Per-pellet hitscan shot detail: sim-space tracer endpoints for one
 * fired pellet. Recorded inside World.step's hitscan block (no extra
 * RNG draws, no damage/hash impact); the renderer consumes these
 * verbatim so tracer endpoints match the sim with zero error.
 */
export interface ShotDetail {
  /** Muzzle origin x in world px (shooter body center). */
  ox: number;
  /** Muzzle origin y in world px (shooter body center). */
  oy: number;
  /** Resolved hit-point x: nearest of player/prop/wall, else range end. */
  x: number;
  /** Resolved hit-point y: nearest of player/prop/wall, else range end. */
  y: number;
  /** Weapon id that fired the pellet. */
  weapon: string;
  /** Shooter player id. */
  shooterId: number;
  /** Shooter index in the player array (muzzle-tip lookup). */
  shooter: number;
  /** Sim tick the shot fired on. */
  tick: number;
}

/**
 * Per-hit damage detail: sim-space hit position plus victim and
 * shooter identity for one damaged victim/prop-hit. Recorded inside
 * World.step's damage sites (no extra RNG draws, no damage/hash
 * impact); the renderer consumes these to spawn impact sparks and the
 * client fires the crosshair hitmarker from the shooter id.
 */
export interface DamageDetail {
  /** Victim index in the player array (-1 for prop hits). */
  victim: number;
  /** Victim player id (-1 for prop hits). */
  victimId: number;
  /** Hit-point x in world px (pellet endpoint or victim center). */
  x: number;
  /** Hit-point y in world px (pellet endpoint or victim center). */
  y: number;
  /** Shooter index in the player array. */
  shooter: number;
  /** Shooter player id. */
  shooterId: number;
}

/**
 * Per-kill detail: victim identity plus death position for one kill.
 * Recorded at every site that emits "kill" (no extra RNG draws, no
 * hash impact); the renderer spawns a death burst at the position.
 * The weapon is the killing blow's weapon id (hitscan weapon, "rocket"
 * or "grenade" splash), null for unattributed deaths (record-only).
 */
export interface KillDetail {
  /** Victim index in the player array. */
  victim: number;
  /** Victim player id. */
  victimId: number;
  /** Killer player id (null for unattributed deaths). */
  killerId: number | null;
  /** Killing weapon id ("rocket"/"grenade" for splash, null when unattributed). */
  weapon: string | null;
  /** Death-position x in world px (victim body center). */
  x: number;
  /** Death-position y in world px (victim body center). */
  y: number;
}

/**
 * Per-explosion detail: sim-space blast center plus radius for one
 * explode() call. Recorded for every rocket/grenade/barrel blast (no
 * extra RNG draws, no damage/hash impact); the renderer spawns the
 * explosion flash plus smoke plus debris at the position. Without this
 * the renderer anchored "explode" flashes on the local player and
 * wall hits with no victims left zero particles behind.
 */
export interface ExplodeDetail {
  /** Blast-center x in world px. */
  x: number;
  /** Blast-center y in world px. */
  y: number;
  /** Splash radius in world px (drives debris spread). */
  radius: number;
}

/**
 * Per-pickup detail: pad position plus collecting player for one
 * pickup. Recorded in collectPickups (no extra RNG draws, no
 * damage/hash impact); the renderer spawns the pickup sparkle at the
 * pad position.
 */
export interface PickupDetail {
  /** Pad-center x in world px. */
  x: number;
  /** Pad-center y in world px. */
  y: number;
  /** Pickup kind (weapon | health | grenades). */
  kind: string;
  /** Collecting player index in the player array. */
  player: number;
  /** Collecting player id. */
  playerId: number;
}

/** Frozen list of every event name (probe/iteration order). */
export const WORLD_EVENTS: readonly WorldEvent[] = Object.freeze([
  "shot",
  "damage",
  "kill",
  "hop",
  "land",
  "explode",
  "bounce",
  "pickup",
  "matchEnd",
]);
