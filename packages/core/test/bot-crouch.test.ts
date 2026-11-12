import { describe, expect, it } from "vitest";
import { TileMap } from "../src/map";
import { BUTTON_CROUCH, World } from "../src/world";
import { BotBrain } from "../src/bots/brain";

function openArena(): TileMap {
  const rows: string[] = [];
  for (let y = 0; y < 20; y += 1) {
    rows.push(y < 18 ? ".".repeat(40) : "#".repeat(40));
  }
  return new TileMap(rows);
}

const GROUND_Y = 18 * 32 - 58;

function duelSnapshot(tick: number, weapon = "shotgun") {
  return {
    self: { id: 0, x: 100, y: GROUND_Y, hp: 100, weapon },
    enemies: [{ id: 1, x: 500, y: GROUND_Y, hp: 100 }],
    map: openArena(),
    tick,
  };
}

describe("bot fight-stance crouch", () => {
  it("crouches in a fight within 12 ticks on the duel fixture", () => {
    const brain = new BotBrain({ tier: "normal", weapon: "shotgun", seed: 11 });
    let seenFight = false;
    let seenCrouch = false;
    for (let t = 0; t < 12; t += 1) {
      const out = brain.tick(duelSnapshot(t));
      expect(out.crouch).toBe((out.buttons & BUTTON_CROUCH) !== 0);
      if (out.goal === "fight") {
        seenFight = true;
        if (out.crouch === true && (out.buttons & BUTTON_CROUCH) !== 0) {
          seenCrouch = true;
        }
      }
    }
    expect(seenFight).toBe(true);
    expect(seenCrouch).toBe(true);
  });

  it("stays upright in roam and grenade-evade", () => {
    const roamer = new BotBrain({ tier: "normal", weapon: "shotgun", seed: 11 });
    for (let t = 0; t < 12; t += 1) {
      const out = roamer.tick({
        self: { id: 0, x: 100, y: GROUND_Y, hp: 100, weapon: "shotgun" },
        enemies: [],
        map: openArena(),
        tick: t,
      });
      expect(out.goal).toBe("roam");
      expect(out.crouch).toBe(false);
      expect(out.buttons & BUTTON_CROUCH).toBe(0);
    }

    const evader = new BotBrain({ tier: "normal", weapon: "rifle", seed: 9 });
    for (let t = 0; t < 12; t += 1) {
      const out = evader.tick({
        self: { id: 0, x: 100, y: GROUND_Y, hp: 100, weapon: "rifle" },
        enemies: [],
        projectiles: [{ kind: "grenade", x: 200, y: GROUND_Y, lifeTicks: 100 }],
        map: openArena(),
        tick: t,
      });
      expect(out.goal).toBe("evade");
      expect(out.crouch).toBe(false);
      expect(out.buttons & BUTTON_CROUCH).toBe(0);
    }
  });

  it("replays identical crouch sequences for the same seed", () => {
    const run = (seed: number): string => {
      const brain = new BotBrain({ tier: "normal", weapon: "shotgun", seed });
      const trace: string[] = [];
      for (let t = 0; t < 120; t += 1) {
        const out = brain.tick(duelSnapshot(t));
        trace.push(`${out.goal}:${out.crouch}:${out.buttons & BUTTON_CROUCH}`);
      }
      return trace.join("|");
    };
    expect(run(11)).toBe(run(11));
  });

  it("stepping a crouching brain output flips player.crouching", () => {
    const brain = new BotBrain({ tier: "normal", weapon: "shotgun", seed: 11 });
    let out = brain.tick(duelSnapshot(0));
    for (let t = 1; t < 12 && out.crouch !== true; t += 1) {
      out = brain.tick(duelSnapshot(t));
    }
    expect(out.crouch).toBe(true);
    const world = new World({});
    world.addPlayer({ x: 100, y: GROUND_Y });
    world.step([out]);
    expect(world.players[0]?.crouching).toBe(true);
  });
});
