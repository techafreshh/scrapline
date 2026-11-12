import { describe, expect, it } from "vitest";
import { TileMap } from "../src/map";
import { World } from "../src/world";
import { BotBrain } from "../src/bots/brain";
import {
  COMBAT_BANDS,
  REPLAN_HZ,
} from "../src/bots/brain";
import { TIERS, getTier, lerpTier, type TierName } from "../src/bots/tiers";

function openArena(): TileMap {
  const rows: string[] = [];
  for (let y = 0; y < 20; y += 1) {
    rows.push(y < 18 ? ".".repeat(40) : "#".repeat(40));
  }
  return new TileMap(rows);
}

function walledArena(): TileMap {
  const rows: string[] = [];
  for (let y = 0; y < 20; y += 1) {
    let row = ".".repeat(40);
    if (y < 18) {
      row = `${".".repeat(9)}#${".".repeat(30)}`;
    }
    rows.push(row);
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

describe("tier table", () => {
  it("orders reaction/dodge/grenadeUse strictly easy to elite", () => {
    const order: TierName[] = ["easy", "normal", "hard", "elite"];
    const reactions = order.map((t) => getTier(t).reactionSec);
    const dodges = order.map((t) => getTier(t).dodge);
    const grenades = order.map((t) => getTier(t).grenadeUse);
    for (let i = 1; i < order.length; i += 1) {
      expect(reactions[i]).toBeLessThan(reactions[i - 1] as number);
      expect(dodges[i]).toBeGreaterThan(dodges[i - 1] as number);
      expect(grenades[i]).toBeGreaterThan(grenades[i - 1] as number);
    }
    expect(getTier("elite").reactionSec).toBeLessThan(
      getTier("easy").reactionSec,
    );
  });

  it("falls back to normal for unknown tiers and is case-insensitive", () => {
    expect(getTier("EASY")).toBe(TIERS.easy);
    expect(getTier("Elite")).toBe(TIERS.elite);
    expect(getTier("unknown")).toBe(TIERS.normal);
    expect(getTier(undefined)).toBe(TIERS.normal);
    expect(getTier(42)).toBe(TIERS.normal);
  });

  it("lerps profiles between tiers", () => {
    const mid = lerpTier(TIERS.easy, TIERS.elite, 0.5);
    expect(mid.reactionSec).toBeCloseTo(
      (TIERS.easy.reactionSec + TIERS.elite.reactionSec) / 2,
      10,
    );
    expect(mid.strafePeriodTicks).toBe(
      Math.round(
        (TIERS.easy.strafePeriodTicks + TIERS.elite.strafePeriodTicks) / 2,
      ),
    );
    expect(lerpTier(TIERS.easy, TIERS.elite, 0).reactionSec).toBe(
      TIERS.easy.reactionSec,
    );
    expect(lerpTier(TIERS.easy, TIERS.elite, 1).dodge).toBe(TIERS.elite.dodge);
  });

  it("holds sane combat bands with shotgun close and sniper far", () => {
    for (const band of Object.values(COMBAT_BANDS)) {
      expect(band.min).toBeLessThan(band.ideal);
      expect(band.ideal).toBeLessThan(band.max);
    }
    expect(COMBAT_BANDS.shotgun).toEqual({ min: 80, ideal: 150, max: 250 });
    expect(COMBAT_BANDS.sniper).toEqual({ min: 600, ideal: 780, max: 950 });
    expect(REPLAN_HZ).toBe(12);
  });
});

describe("brain elite fire", () => {
  for (const weapon of ["pistol", "shotgun", "sniper", "rifle"]) {
    it(`elite 400px open sight fires at least once in 12 ticks (${weapon})`, () => {
      const brain = new BotBrain({ tier: "elite", weapon, seed: 11 });
      let fired = 0;
      let buttoned = 0;
      for (let t = 0; t < 12; t += 1) {
        const out = brain.tick(duelSnapshot(t, weapon));
        if (t >= 3) {
          expect(out.goal).toBe("fight");
        }
        if (out.fire === true) {
          fired += 1;
        }
        if ((out.buttons & 4) !== 0) {
          buttoned += 1;
        }
      }
      expect(fired).toBeGreaterThanOrEqual(1);
      expect(buttoned).toBeGreaterThanOrEqual(1);
    });
  }

  it("wall-blocked contact never fires across 12 ticks", () => {
    const brain = new BotBrain({ tier: "elite", weapon: "shotgun", seed: 11 });
    for (let t = 0; t < 12; t += 1) {
      const out = brain.tick({
        self: { id: 0, x: 100, y: GROUND_Y, hp: 100, weapon: "shotgun" },
        enemies: [{ id: 1, x: 500, y: GROUND_Y, hp: 100 }],
        map: walledArena(),
        tick: t,
      });
      expect(out.fire).toBe(false);
      expect(out.buttons & 4).toBe(0);
    }
  });
});

describe("brain goal chain", () => {
  it("hp 20 with visible health picks health over an open fight", () => {
    const brain = new BotBrain({ tier: "normal", weapon: "shotgun", seed: 3 });
    const out = brain.tick({
      self: { id: 0, x: 100, y: GROUND_Y, hp: 20, weapon: "shotgun" },
      enemies: [{ id: 1, x: 500, y: GROUND_Y, hp: 100 }],
      pickups: [{ kind: "health", x: 200, y: GROUND_Y, active: true }],
      map: openArena(),
      tick: 0,
    });
    expect(out.goal).toBe("health");
    expect(out.currentGoal).toBe("health");
  });

  it("full hp with a visible enemy picks fight", () => {
    const brain = new BotBrain({ tier: "normal", weapon: "shotgun", seed: 3 });
    let out = brain.tick(duelSnapshot(0));
    for (let t = 1; t <= 5; t += 1) {
      out = brain.tick(duelSnapshot(t));
    }
    expect(out.goal).toBe("fight");
    expect(out.currentGoal).toBe("fight");
  });

  it("goal flips within 2 ticks when a health pack appears and disappears", () => {
    const brain = new BotBrain({ tier: "hard", weapon: "shotgun", seed: 5 });
    const base = {
      self: { id: 0, x: 100, y: GROUND_Y, hp: 30, weapon: "shotgun" },
      enemies: [{ id: 1, x: 500, y: GROUND_Y, hp: 100 }],
      map: openArena(),
    };
    brain.tick({ ...base, tick: 0 });
    brain.tick({ ...base, tick: 1 });
    brain.tick({ ...base, tick: 2 });
    expect(brain.tick({ ...base, tick: 3 }).goal).toBe("fight");
    const withPack = {
      ...base,
      pickups: [{ kind: "health", x: 200, y: GROUND_Y, active: true }],
      tick: 1,
    };
    expect(brain.tick(withPack).goal).toBe("health");
    expect(brain.tick({ ...withPack, tick: 2 }).goal).toBe("health");
    const removed = { ...base, tick: 3 };
    const first = brain.tick(removed);
    const second = brain.tick({ ...base, tick: 4 });
    expect([first.goal, second.goal]).toContain("fight");
  });

  it("evades an incoming grenade inside 200px", () => {
    const brain = new BotBrain({ tier: "normal", weapon: "rifle", seed: 9 });
    const out = brain.tick({
      self: { id: 0, x: 100, y: GROUND_Y, hp: 100, weapon: "rifle" },
      enemies: [],
      projectiles: [{ kind: "grenade", x: 200, y: GROUND_Y, lifeTicks: 100 }],
      map: openArena(),
      tick: 0,
    });
    expect(out.goal).toBe("evade");
  });
});

describe("brain shotgun band", () => {
  it("holds 80-250px for 60 consecutive ticks at least once in 10s", () => {
    const world = new World({});
    const bot = world.addPlayer({ x: 80 });
    bot.weapon = "shotgun";
    bot.magAmmo = 5;
    world.addPlayer({ x: 480, hp: 100000 });
    const brain = new BotBrain({ tier: "normal", weapon: "shotgun", seed: 42 });
    const distances: number[] = [];
    for (let t = 0; t < 600; t += 1) {
      const out = brain.tick(world, 0);
      world.step([out, {}]);
      const a = world.players[0];
      const b = world.players[1];
      distances.push(
        Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0)),
      );
    }
    let best = 0;
    let run = 0;
    for (const d of distances) {
      if (d >= 80 && d <= 250) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    expect(best).toBeGreaterThanOrEqual(60);
  });

  it("advances from 400px and retreats from 50px", () => {
    const approaching = new BotBrain({
      tier: "normal",
      weapon: "shotgun",
      seed: 42,
    });
    let first = approaching.tick(duelSnapshot(0));
    for (let t = 1; t <= 5; t += 1) {
      first = approaching.tick(duelSnapshot(t));
    }
    expect(first.goal).toBe("fight");
    expect(first.moveX).toBe(1);

    const retreating = new BotBrain({
      tier: "normal",
      weapon: "shotgun",
      seed: 42,
    });
    const near = {
      self: { id: 0, x: 400, y: GROUND_Y, hp: 100, weapon: "shotgun" },
      enemies: [{ id: 1, x: 450, y: GROUND_Y, hp: 100 }],
      map: openArena(),
    };
    for (let t = 0; t < 5; t += 1) {
      retreating.tick({ ...near, tick: t });
    }
    const close = retreating.tick({ ...near, tick: 5 });
    expect(close.goal).toBe("fight");
    expect(close.moveX).toBe(-1);
  });

  it("strafes with nonzero moveX while settled in the band", () => {
    const brain = new BotBrain({ tier: "elite", weapon: "shotgun", seed: 42 });
    let nonzero = 0;
    for (let t = 0; t < 200; t += 1) {
      const out = brain.tick({
        self: { id: 0, x: 350, y: GROUND_Y, hp: 100, weapon: "shotgun" },
        enemies: [{ id: 1, x: 500, y: GROUND_Y, hp: 100 }],
        map: openArena(),
        tick: t,
      });
      if (out.moveX !== 0) {
        nonzero += 1;
      }
    }
    expect(nonzero).toBeGreaterThan(100);
  });
});

describe("brain tier ordering and determinism", () => {
  it("elite fires no less often than hard, normal, easy on one fixture", () => {
    const counts: number[] = [];
    const tiers: TierName[] = ["easy", "normal", "hard", "elite"];
    for (const tier of tiers) {
      const brain = new BotBrain({ tier, weapon: "rifle", seed: 7 });
      let fired = 0;
      for (let t = 0; t < 120; t += 1) {
        if (brain.tick(duelSnapshot(t, "rifle")).fire === true) {
          fired += 1;
        }
      }
      counts.push(fired);
    }
    const [easy, normal, hard, elite] = counts as [
      number,
      number,
      number,
      number,
    ];
    expect(elite).toBeGreaterThanOrEqual(hard as number);
    expect(hard).toBeGreaterThanOrEqual(normal as number);
    expect(normal).toBeGreaterThanOrEqual(easy as number);
    expect(elite as number).toBeGreaterThan(0);
  });

  it("replays identically for the same seed and script", () => {
    const run = (seed: number): string => {
      const brain = new BotBrain({ tier: "hard", weapon: "shotgun", seed });
      const trace: string[] = [];
      for (let t = 0; t < 120; t += 1) {
        const enemyX = 500 - (t % 60);
        const out = brain.tick({
          self: { id: 0, x: 100, y: GROUND_Y, hp: 100, weapon: "shotgun" },
          enemies: [{ id: 1, x: enemyX, y: GROUND_Y, hp: 100 }],
          map: openArena(),
          tick: t,
        });
        trace.push(
          `${out.goal}:${out.moveX}:${out.fire}:${out.aim.toFixed(6)}`,
        );
      }
      return trace.join("|");
    };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });
});

describe("brain harness tolerance", () => {
  it("accepts every constructor shape and tick alias", () => {
    const brains: BotBrain[] = [
      new BotBrain(),
      new BotBrain("elite"),
      new BotBrain(5),
      new BotBrain({ tier: "hard", seed: 2, weapon: "sniper", id: 7 }),
      new BotBrain(openArena()),
    ];
    for (const brain of brains) {
      const aliases = [
        brain.tick(duelSnapshot(0)),
        brain.update(duelSnapshot(1)),
        brain.decide(duelSnapshot(2)),
        brain.think(duelSnapshot(3)),
        brain.step(duelSnapshot(4)),
        brain.getInput(duelSnapshot(5)),
        brain.next(duelSnapshot(6)),
      ];
      for (const out of aliases) {
        expect(typeof out.moveX).toBe("number");
        expect(typeof out.aim).toBe("number");
        expect(typeof out.buttons).toBe("number");
        expect(typeof out.fire).toBe("boolean");
        expect(typeof out.goal).toBe("string");
      }
    }
  });

  it("drives a live World through the (world, botIndex) form", () => {
    const world = new World({});
    world.addPlayer({ x: 80 });
    world.addPlayer({ x: 480, hp: 100000 });
    const brain = new BotBrain({ tier: "elite", weapon: "sniper", seed: 1 });
    for (let t = 0; t < 30; t += 1) {
      const out = brain.tick(world, 0);
      expect(typeof out.goal).toBe("string");
      world.step([out, {}]);
    }
    expect(world.tick).toBe(30);
  });
});
