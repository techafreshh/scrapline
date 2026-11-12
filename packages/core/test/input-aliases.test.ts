import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";

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

describe("input aliases truthy equivalence", () => {
  it("fire: 1 fires like fire: true", () => {
    const world = twoPlayers200();
    const events = world.step([{ fire: 1 as unknown as boolean, aim: 0 }, {}]);
    expect(events).toContain("shot");
    expect(world.players[1]?.hp).toBe(80);
  });

  it("reload: 1 starts reloading like reload: true", () => {
    const world = twoPlayers200();
    const shooter = world.players[0];
    if (shooter === undefined) {
      throw new Error("expected shooter");
    }
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(shooter.magAmmo).toBe(WEAPONS.pistol.mag - 1);
    for (let t = 0; t < 14; t += 1) {
      world.step([{}, {}]);
    }
    world.step([{ reload: 1 as unknown as boolean }, {}]);
    expect(shooter.reloading).toBe(true);
  });

  it("jet: 1 hops like the buttons-bitmask hop", () => {
    const world = new World({});
    world.step();
    expect(world.players[0]?.onGround).toBe(true);
    const events = world.step({ jet: 1 as unknown as boolean });
    expect(events).toContain("hop");
    expect(world.players[0]?.vy ?? 0).toBeLessThan(0);
  });

  it("crouch: 1 crouches and runs slower than upright", () => {
    const runner = new World({});
    runner.step();
    const startRun = runner.players[0]?.x ?? 0;
    for (let t = 0; t < 60; t += 1) {
      runner.step({ moveX: 1 });
    }
    const runDx = (runner.players[0]?.x ?? 0) - startRun;

    const crawler = new World({});
    crawler.step();
    const startCrouch = crawler.players[0]?.x ?? 0;
    for (let t = 0; t < 60; t += 1) {
      crawler.step({ moveX: 1, crouch: 1 as unknown as boolean });
    }
    const crouchDx = (crawler.players[0]?.x ?? 0) - startCrouch;

    expect(crawler.players[0]?.crouching).toBe(true);
    expect(crouchDx).toBeGreaterThan(0);
    expect(crouchDx).toBeLessThan(runDx);
  });

  it("grenade: 1 throws like grenade: true", () => {
    const world = twoPlayers200(9);
    world.step([{ grenade: 1 as unknown as boolean, aim: 0 }, {}]);
    expect(world.players[0]?.grenades).toBe(2);
    expect(world.projectiles.length).toBe(1);
  });

  it("throw: 1 throws like the buttons-bitmask grenade", () => {
    const world = twoPlayers200(9);
    world.step([{ throw: 1 as unknown as boolean, aim: 0 }, {}]);
    expect(world.players[0]?.grenades).toBe(2);
    expect(world.projectiles.length).toBe(1);
  });
});
