// Combat event names — the string-union readout of World.step().
//
// The sim is sacred: this module is pure data (type plus frozen list,
// no imports, no functions) so tuning never leaks DOM, Node, clock, or
// Math.random behavior into packages/core. World.step() keeps returning
// string[]; these literals are the members it may emit.

/** Every event World.step() may emit. */
export type WorldEvent = "shot" | "damage" | "kill" | "hop" | "land";

/** Frozen list of every event name (probe/iteration order). */
export const WORLD_EVENTS: readonly WorldEvent[] = Object.freeze([
  "shot",
  "damage",
  "kill",
  "hop",
  "land",
]);
