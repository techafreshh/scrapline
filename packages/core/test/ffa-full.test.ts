import { describe, expect, it } from "vitest";
import { BotBrain } from "../src/bots/brain";
import { createRng } from "../src/rng";
import type { WorldInput } from "../src/world";
import { World } from "../src/world";

// Full 5-minute FFA regression: the local player (seeded random inputs)
// plus 3 normal-tier bots fight on the default arena with pickups and
// props live for the whole MATCH_TIME_LIMIT_TICKS budget. The match must
// end (time cap when no score cap lands first), scores must move, and the
// loop must finish tick-exact with no exception.
describe("ffa full match", () => {
  it("18000 ticks end with matchOver, exact tick count, and >= 1 kill", () => {
    const seed = 7;
    const world = new World({ seed });
    world.addPlayer({ x: 100 });
    world.addPlayer({ x: 400 });
    world.addPlayer({ x: 700 });
    world.addPlayer({ x: 1000 });
    world.addPickup("weapon", 300, 540);
    world.addPickup("health", 600, 540);
    world.addPickup("grenades", 900, 540);
    world.addProp("barrel", 500, 542);
    world.addProp("crate", 800, 546);

    const brains = [1, 2, 3].map(
      (index) => new BotBrain({ tier: "normal", seed: seed + index }),
    );
    let cached: WorldInput[] = [{}, {}, {}];
    const rng = createRng(seed);
    for (let t = 0; t < 18000; t += 1) {
      if (t % 5 === 0) {
        cached = brains.map((brain, k) => brain.tick(world, k + 1));
      }
      const agent: WorldInput = {
        moveX: rng.next() * 2 - 1,
        aim: rng.next() * Math.PI * 2,
        buttons: Math.floor(rng.next() * 64),
      };
      world.step([agent, cached[0] as WorldInput, cached[1] as WorldInput, cached[2] as WorldInput]);
    }

    expect(world.tick).toBe(18000);
    expect(world.matchOver).toBe(true);
    const total = world.scores.reduce((sum, score) => sum + score, 0);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(world.hash()).toMatch(/^[0-9a-f]{8}$/);
  });
});
