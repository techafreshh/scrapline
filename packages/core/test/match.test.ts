import { describe, expect, it } from "vitest";
import { World } from "../src/world";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function twoPlayers200(seed = 1): World {
  const world = new World({ seed });
  const y = floorY();
  world.addPlayer({ x: 100, y });
  world.addPlayer({ x: 300, y });
  return world;
}

describe("match score limit", () => {
  it("scoreLimit 2 with two kills for player 0 ends match with player 0 on top", () => {
    const world = new World({ seed: 1, mode: "ffa", scoreLimit: 2 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 300, y });
    expect(world.standings()).toEqual([0, 1]);
    world.registerKill(0);
    expect(world.matchOver).toBe(false);
    world.registerKill(0);
    expect(world.matchOver).toBe(true);
    expect(world.standings()[0]).toBe(0);
  });
});

describe("match hash", () => {
  it("hash is stable and 8 lowercase hex chars after 100 ticks", () => {
    const world = twoPlayers200(7);
    for (let t = 0; t < 100; t += 1) {
      world.step([{}, {}]);
    }
    const first = world.hash();
    const second = world.hash();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("match state", () => {
  it("JSON state round-trips players, tick, and scores", () => {
    const world = twoPlayers200(7);
    world.step([{}, {}]);
    const parsed = JSON.parse(JSON.stringify(world.state)) as {
      players?: unknown;
      tick?: unknown;
      scores?: unknown;
    };
    expect(parsed).toHaveProperty("players");
    expect(parsed).toHaveProperty("tick");
    expect(parsed).toHaveProperty("scores");
  });
});

describe("match time limit", () => {
  it("time cap ends match and emits matchEnd once", () => {
    const world = new World({ seed: 1, timeLimitTicks: 10 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 300, y });
    let sawMatchEnd = false;
    for (let t = 0; t < 10; t += 1) {
      const events = world.step([{}, {}]);
      if (events.includes("matchEnd")) {
        sawMatchEnd = true;
      }
    }
    expect(world.matchOver).toBe(true);
    expect(sawMatchEnd).toBe(true);
    expect(world.step([{}, {}]).includes("matchEnd")).toBe(false);
  });
});

describe("match splash credit", () => {
  it("splash kill credits the owner and orders standings", () => {
    const world = twoPlayers200(9);
    const victim = world.players[1];
    if (victim === undefined) {
      throw new Error("expected victim");
    }
    world.projectiles.push({
      id: 900,
      kind: "grenade",
      x: victim.x + 13,
      y: victim.y + 29,
      vx: 0,
      vy: 0,
      damage: 115,
      ownerId: 0,
      lifeTicks: 1,
    });
    const events = world.step([{}, {}]);
    expect(events).toContain("explode");
    expect(events).toContain("kill");
    expect(world.scores[0]).toBe(1);
    expect(world.scores[1]).toBe(0);
    expect(world.standings()).toEqual([0, 1]);
  });
});

describe("match determinism", () => {
  it("same-seed replay with kills hash-equals", () => {
    const a = twoPlayers200(42);
    const b = twoPlayers200(42);
    for (let t = 0; t < 10; t += 1) {
      a.step([{ fire: t === 0, aim: 0 }, {}]);
      b.step([{ fire: t === 0, aim: 0 }, {}]);
    }
    a.registerKill(0);
    b.registerKill(0);
    expect(a.hash()).toBe(b.hash());
  });
});
