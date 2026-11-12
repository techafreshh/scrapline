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
