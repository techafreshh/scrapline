import { describe, expect, it } from "vitest";
import { BotBrain } from "../src/bots/brain";
import { WEAPONS } from "../src/weapons";
import { World } from "../src/world";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

describe("bot smoke", () => {
  it("elite bot scores >=1 kill vs a stationary dummy in 3600 ticks", () => {
    const world = new World({ seed: 11 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 500, y });
    const bot = world.players[0];
    if (bot === undefined) {
      throw new Error("expected bot player");
    }
    bot.weapon = "rifle";
    bot.magAmmo = WEAPONS.rifle.mag;
    const brain = new BotBrain({ tier: "elite", weapon: "rifle", seed: 11 });
    let kills = 0;
    for (let t = 0; t < 3600; t += 1) {
      const out = brain.tick(world, 0);
      const events = world.step([out, {}]);
      for (const event of events) {
        if (event === "kill") {
          kills += 1;
        }
      }
    }
    expect(world.tick).toBe(3600);
    expect(kills).toBeGreaterThanOrEqual(1);
    expect(world.scores[0] ?? 0).toBeGreaterThanOrEqual(1);
    expect(world.hash()).toMatch(/^[0-9a-f]{8}$/);
  });
});
