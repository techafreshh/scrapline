import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";

function floorY(): number {
  return 18 * 32 - 58;
}

function twoPlayers200(seed = 1): World {
  const world = new World({ seed });
  const y = floorY();
  world.addPlayer({ x: 100, y });
  world.addPlayer({ x: 300, y });
  return world;
}

describe("ammo reserve removal", () => {
  it("addPlayer result has no own reserveAmmo property", () => {
    const world = new World({ seed: 1 });
    const player = world.addPlayer({ x: 100, y: floorY() });
    expect("reserveAmmo" in player).toBe(false);
  });

  it("stepped players never gain a reserveAmmo property", () => {
    const world = twoPlayers200();
    for (let t = 0; t < 10; t += 1) {
      world.step([{}, {}]);
    }
    for (const player of world.players) {
      expect("reserveAmmo" in player).toBe(false);
    }
  });

  it("empty-mag auto-reload still refills magAmmo from WEAPONS", () => {
    const world = twoPlayers200();
    const shooter = world.players[0];
    if (shooter === undefined) {
      throw new Error("expected shooter");
    }
    shooter.magAmmo = 1;
    shooter.cooldownTicks = 0;
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(shooter.magAmmo).toBe(0);
    expect(shooter.reloading).toBe(true);
    for (let t = 0; t < WEAPONS.pistol.reload; t += 1) {
      world.step([{}, {}]);
    }
    expect(shooter.reloading).toBe(false);
    expect(shooter.magAmmo).toBe(WEAPONS.pistol.mag);
  });

  it("manual reload of a partial mag still refills to full", () => {
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
    world.step([{ reload: true }, {}]);
    expect(shooter.reloading).toBe(true);
    for (let t = 0; t < WEAPONS.pistol.reload; t += 1) {
      world.step([{}, {}]);
    }
    expect(shooter.magAmmo).toBe(WEAPONS.pistol.mag);
  });
});
