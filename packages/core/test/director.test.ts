import { describe, expect, it } from "vitest";
import { TileMap } from "../src/map";
import {
  DIRECTOR_DEFAULT_HEIGHT_PX,
  DIRECTOR_DEFAULT_WIDTH_PX,
  Director,
  GRENADE_PERIOD_TICKS,
  MAX_ATTACKERS_PER_VICTIM,
  type BotView,
  type VictimView,
} from "../src/bots/director";

function makeBots(count: number): BotView[] {
  const bots: BotView[] = [];
  for (let i = 0; i < count; i += 1) {
    bots.push({ id: i, x: 100 + i * 40, y: 300, alive: true });
  }
  return bots;
}

function makeVictim(id: number): VictimView {
  return { id, x: 900, y: 300, alive: true };
}

function openArena(): TileMap {
  const rows: string[] = [];
  for (let y = 0; y < 20; y += 1) {
    rows.push(y < 18 ? ".".repeat(40) : "#".repeat(40));
  }
  return new TileMap(rows);
}

describe("director export shape", () => {
  it("exports Director with assignTargets", () => {
    expect(typeof Director).toBe("function");
    expect(typeof Director.prototype.assignTargets).toBe("function");
  });
});

describe("director attack tokens", () => {
  it("caps simultaneous attackers at 2 for 4 bots vs 1 victim", () => {
    const director = new Director(7);
    const bots = makeBots(4);
    director.assignTargets(bots, [makeVictim(99)]);
    const holders = bots.filter((bot) => bot.attackToken === 99);
    expect(holders.length).toBeLessThanOrEqual(2);
    expect(holders.length).toBeLessThanOrEqual(MAX_ATTACKERS_PER_VICTIM);
    for (const bot of bots) {
      expect(bot.attackToken === 99 || bot.attackToken === null).toBe(true);
    }
  });

  it("spreads attackers across victims without breaking the cap", () => {
    const director = new Director(7);
    const bots = makeBots(6);
    const players = [makeVictim(50), makeVictim(51), makeVictim(52)];
    director.assignTargets(bots, players);
    for (const victim of [50, 51, 52]) {
      const holders = bots.filter((bot) => bot.attackToken === victim);
      expect(holders.length).toBeLessThanOrEqual(MAX_ATTACKERS_PER_VICTIM);
    }
  });

  it("never assigns a bot a token for itself", () => {
    const director = new Director(3);
    const bots = makeBots(2);
    const players: VictimView[] = [
      { id: 0, x: 100, y: 300, alive: true },
      { id: 1, x: 140, y: 300, alive: true },
      makeVictim(99),
    ];
    director.assignTargets(bots, players);
    for (const bot of bots) {
      expect(bot.attackToken).not.toBe(bot.id);
    }
  });

  it("skips dead victims while any live victim exists", () => {
    const director = new Director(9);
    const bots = makeBots(3);
    director.assignTargets(bots, [
      { id: 40, x: 200, y: 300, alive: false },
      makeVictim(41),
    ]);
    expect(bots.filter((bot) => bot.attackToken === 40).length).toBe(0);
    expect(bots.filter((bot) => bot.attackToken === 41).length).toBeLessThanOrEqual(2);
  });
});

describe("director roam points", () => {
  it("keeps every roamPoint non-null and in bounds across 60 updates", () => {
    const director = new Director(1234);
    const bots = makeBots(4);
    const players = [makeVictim(99)];
    for (let t = 0; t < 60; t += 1) {
      director.update(bots, players);
      for (const bot of bots) {
        expect(bot.roamPoint).not.toBeNull();
        expect(bot.roamPoint).not.toBeUndefined();
      }
    }
    for (const bot of bots) {
      const point = bot.roamPoint;
      if (point === null || point === undefined) {
        throw new Error("expected roamPoint after 60 updates");
      }
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(DIRECTOR_DEFAULT_WIDTH_PX);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(DIRECTOR_DEFAULT_HEIGHT_PX);
    }
  });

  it("samples free tiles when a TileMap is known", () => {
    const map = openArena();
    const director = new Director({ seed: 5, map });
    const bots = makeBots(4);
    const players = [makeVictim(99)];
    for (let t = 0; t < 60; t += 1) {
      director.assignTargets(bots, players, map);
    }
    for (const bot of bots) {
      const point = bot.roamPoint;
      if (point === null || point === undefined) {
        throw new Error("expected roamPoint with a TileMap");
      }
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(map.widthPixels);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(map.heightPixels);
      expect(map.isSolidAt(point.x, point.y)).toBe(false);
    }
  });

  it("honors custom pixel bounds from options", () => {
    const director = new Director({ seed: 1, widthPixels: 800, heightPixels: 400 });
    const bots = makeBots(3);
    for (let t = 0; t < 60; t += 1) {
      director.assignTargets(bots, [makeVictim(77)]);
    }
    for (const bot of bots) {
      const point = bot.roamPoint;
      if (point === null || point === undefined) {
        throw new Error("expected roamPoint with custom bounds");
      }
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(800);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(400);
    }
  });
});

describe("director grenade windows", () => {
  it("opens windows for at most half the squad at once, per bot over a period", () => {
    const director = new Director(21);
    const bots = makeBots(4);
    const players = [makeVictim(99)];
    const opened = [false, false, false, false];
    for (let t = 0; t < GRENADE_PERIOD_TICKS; t += 1) {
      director.assignTargets(bots, players);
      const allowed = bots.filter((bot) => bot.grenadeAllowed === true);
      expect(allowed.length).toBeLessThanOrEqual(bots.length / 2);
      bots.forEach((bot, i) => {
        if (bot.grenadeAllowed === true) {
          opened[i] = true;
        }
        expect(director.canThrowGrenade(bot)).toBe(bot.grenadeAllowed);
        expect(director.isGrenadeAllowed(bot)).toBe(bot.grenadeAllowed);
        expect(bot.canGrenade).toBe(bot.grenadeAllowed);
      });
    }
    for (const seen of opened) {
      expect(seen).toBe(true);
    }
  });

  it("replays identically for the same seed", () => {
    const run = (seed: number): BotView[] => {
      const director = new Director(seed);
      const bots = makeBots(4);
      const players = [makeVictim(50), makeVictim(51)];
      for (let t = 0; t < 60; t += 1) {
        director.update(bots, players);
      }
      return bots;
    };
    expect(JSON.stringify(run(11))).toBe(JSON.stringify(run(11)));
  });

  it("accepts every constructor shape without crashing", () => {
    const map = openArena();
    const variants: Director[] = [
      new Director(),
      new Director(5),
      new Director(map),
      new Director({ seed: 2, widthPixels: 640, heightPixels: 320 }),
    ];
    for (const director of variants) {
      const bots = makeBots(2);
      director.assignTargets(bots, [makeVictim(60)]);
      for (const bot of bots) {
        expect(bot.roamPoint).not.toBeNull();
        expect(typeof bot.grenadeAllowed).toBe("boolean");
      }
    }
  });
});
