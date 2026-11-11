// Deterministic replay script — the shared input log for the replay tool.
//
// The sim is sacred: this module is pure (no DOM, Node, clock, or
// Math.random). The scripted inputs are a pure function of the tick index,
// so the CLI tool and the test replay identical ticks and cannot drift.

import { World, type WorldInput } from "./world";

/** Deterministic per-tick input script (pure function of tick index). */
export function scriptedInput(tick: number): WorldInput {
  const phase = Math.floor(tick / 300) % 3;
  const moveX = phase === 0 ? 1 : phase === 1 ? -1 : 0;
  const aim = tick * 0.01;
  const jet = tick % 120 < 40;
  const fire = tick % 14 === 0;
  const crouch = tick % 400 === 399;
  const grenade = tick % 700 === 350;
  const reload = tick % 900 === 800;
  return { moveX, aim, jet, fire, crouch, grenade, reload };
}

/** Build a world with seed, step ticks ticks with the script, return hash. */
export function replayHash(seed: number, ticks: number): string {
  const world = new World({ seed });
  for (let t = 0; t < ticks; t += 1) {
    world.step(scriptedInput(t));
  }
  return world.hash();
}
