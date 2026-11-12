import { describe, expect, it } from "vitest";
import { PLAYER_WIDTH } from "../src/constants";
import { World } from "../src/world";
import { BotBrain } from "../src/bots/brain";
import {
  TIERS,
  getTier,
  lerpTier,
  type TierName,
} from "../src/bots/tiers";

const GROUND_Y = 18 * 32 - 58;

describe("bot aim error model", () => {
  it("exposes angleError as an alias of aimErrorRad with easy above elite", () => {
    expect(TIERS.easy.angleError).toBe(0.018);
    expect(TIERS.elite.angleError).toBe(0.011);
    expect(TIERS.easy.angleError).toBeGreaterThan(TIERS.elite.angleError);
    const order: TierName[] = ["easy", "normal", "hard", "elite"];
    for (const name of order) {
      expect(getTier(name).angleError).toBe(getTier(name).aimErrorRad);
      expect(TIERS[name].angleError).toBe(TIERS[name].aimErrorRad);
    }
  });
});

describe("bot match ramp", () => {
  it("lerpTier(easy, 10 matches) lands within 0.05 of normal reaction", () => {
    const ramped = lerpTier("easy", 10);
    expect(ramped.reactionSec).toBeCloseTo(TIERS.normal.reactionSec, 10);
    expect(Math.abs(ramped.reactionSec - TIERS.normal.reactionSec)).toBeLessThanOrEqual(
      0.05,
    );
    expect(Math.abs(ramped.reactionSec - 0.3)).toBeLessThanOrEqual(0.05);
  });

  it("ramps partially and monotonically, capping elite at elite", () => {
    const half = lerpTier("easy", 5);
    expect(half.reactionSec).toBeLessThan(TIERS.easy.reactionSec);
    expect(half.reactionSec).toBeGreaterThan(TIERS.normal.reactionSec);
    expect(half.angleError).toBeLessThan(TIERS.easy.angleError);
    expect(half.angleError).toBeGreaterThan(TIERS.normal.angleError);
    const none = lerpTier("easy", 0);
    expect(none.reactionSec).toBe(TIERS.easy.reactionSec);
    const capped = lerpTier("elite", 999);
    expect(capped.reactionSec).toBe(TIERS.elite.reactionSec);
    expect(capped.angleError).toBe(TIERS.elite.angleError);
    expect(lerpTier("unknown-tier", 10).reactionSec).toBe(
      lerpTier("normal", 10).reactionSec,
    );
  });

  it("wires match count through the brain while keeping the base tier name", () => {
    const ramped = new BotBrain({ tier: "easy", ramp: 10 });
    expect(ramped.tierName).toBe("easy");
    expect(
      Math.abs(ramped.profile.reactionSec - TIERS.normal.reactionSec),
    ).toBeLessThanOrEqual(0.05);
    const fresh = new BotBrain({ tier: "easy" });
    expect(fresh.tierName).toBe("easy");
    expect(fresh.profile).toBe(TIERS.easy);
  });
});

describe("bot map weapon pickup", () => {
  it("pistol bot walking over a sniper pad takes it within 300 ticks", () => {
    const world = new World({});
    const bot = world.addPlayer({ x: 100, y: GROUND_Y });
    bot.weapon = "pistol";
    const cx = bot.x + PLAYER_WIDTH / 2;
    const cy = bot.y + 58 / 2;
    world.addPickup("weapon", cx + 300, cy, "sniper");
    const brain = new BotBrain({ tier: "easy", seed: 1 });
    let took = -1;
    for (let t = 0; t < 300; t += 1) {
      const out = brain.tick(world, 0);
      world.step([out, {}]);
      if (world.players[0]?.weapon === "sniper") {
        took = t;
        break;
      }
    }
    expect(took).toBeGreaterThanOrEqual(0);
    expect(world.players[0]?.weapon).toBe("sniper");
  });
});
