import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";

describe("World run", () => {
  it("displaces 270-310px over 60 ticks holding moveX=1 on flat ground", () => {
    const world = new World({});
    world.step();
    expect(world.players.length).toBe(1);
    const startX = world.players[0]?.x ?? 0;
    for (let t = 0; t < 60; t += 1) {
      world.step({ moveX: 1 });
    }
    const dx = (world.players[0]?.x ?? 0) - startX;
    expect(dx).toBeGreaterThanOrEqual(270);
    expect(dx).toBeLessThanOrEqual(310);
  });

  it("accepts array inputs and stays on the floor while running", () => {
    const world = new World({});
    world.step();
    for (let t = 0; t < 60; t += 1) {
      world.step([{ moveX: 1 }]);
    }
    const player = world.players[0];
    expect(player?.onGround).toBe(true);
    expect(world.tick).toBe(61);
  });
});

describe("World jetpack", () => {
  it("rises at least 200px over 60 jet ticks with fuel between 60 and 70", () => {
    const world = new World({});
    world.step();
    const startY = world.players[0]?.y ?? 0;
    for (let t = 0; t < 60; t += 1) {
      world.step({ buttons: 1 });
    }
    const player = world.players[0];
    const rise = startY - (player?.y ?? 0);
    expect(rise).toBeGreaterThanOrEqual(200);
    expect(player?.fuel ?? 0).toBeGreaterThanOrEqual(60);
    expect(player?.fuel ?? 0).toBeLessThanOrEqual(70);
  });

  it("hops off the ground on the JET rising edge", () => {
    const world = new World({});
    world.step();
    expect(world.players[0]?.onGround).toBe(true);
    world.step({ buttons: 1 });
    expect(world.players[0]?.vy ?? 0).toBeLessThan(0);
  });
});

describe("World fuel gate", () => {
  it("applies no thrust with fuel 0 airborne (vy never decreases)", () => {
    const world = new World({});
    world.step();
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected auto-spawned player");
    }
    player.fuel = 0;
    player.y -= 100;
    player.vy = 0;
    player.onGround = false;
    const before = player.vy;
    for (let t = 0; t < 10; t += 1) {
      world.step({ buttons: 1 });
    }
    expect(world.players[0]?.vy ?? -1).toBeGreaterThanOrEqual(before);
    expect(world.players[0]?.fuel ?? -1).toBeGreaterThanOrEqual(0);
  });
});

describe("World crouch", () => {
  it("moves slower crouching than running upright", () => {
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
      crawler.step({ moveX: 1, buttons: 2 });
    }
    const crouchDx = (crawler.players[0]?.x ?? 0) - startCrouch;

    expect(crouchDx).toBeGreaterThan(0);
    expect(crouchDx).toBeLessThan(runDx);
    expect(crawler.players[0]?.crouching).toBe(true);
  });
});

describe("World determinism", () => {
  it("replays identical hashes for identical seeds and inputs", () => {
    const a = new World({ seed: 7 });
    const b = new World({ seed: 7 });
    for (let t = 0; t < 30; t += 1) {
      const input = t < 10 ? { moveX: 1 } : { buttons: 1 };
      a.step(input);
      b.step(input);
    }
    expect(a.hash()).toBe(b.hash());
    expect(a.tick).toBe(b.tick);
  });

  it("cooldown-only difference changes the hash", () => {
    const a = new World({ seed: 7 });
    const b = new World({ seed: 7 });
    a.step();
    b.step();
    a.players[0]!.cooldownTicks = 0;
    b.players[0]!.cooldownTicks = WEAPONS.pistol.cooldownTicks;
    expect(a.hash()).not.toBe(b.hash());
  });

  it("reload-only difference changes the hash", () => {
    const a = new World({ seed: 7 });
    const b = new World({ seed: 7 });
    a.step();
    b.step();
    a.players[0]!.reloadTicks = 0;
    b.players[0]!.reloadTicks = WEAPONS.pistol.reload;
    expect(a.hash()).not.toBe(b.hash());
  });

  it("ticksSinceDamage-only difference changes the hash", () => {
    const a = new World({ seed: 7 });
    const b = new World({ seed: 7 });
    a.step();
    b.step();
    a.players[0]!.ticksSinceDamage = 0;
    b.players[0]!.ticksSinceDamage = 9999;
    expect(a.hash()).not.toBe(b.hash());
  });

  it("identical stepped worlds with firing hash equal, stable, and 8 hex chars", () => {
    const a = new World({ seed: 7 });
    const b = new World({ seed: 7 });
    for (let t = 0; t < 30; t += 1) {
      const input = t < 10 ? { moveX: 1 } : { buttons: 4 };
      a.step(input);
      b.step(input);
    }
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).toBe(a.hash());
    expect(a.hash()).toMatch(/^[0-9a-f]{8}$/);
  });
});
