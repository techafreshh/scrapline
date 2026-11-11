import { describe, expect, it } from "vitest";
import { PLAYER_WIDTH } from "../src/constants";
import { WEAPONS } from "../src/weapons";
import { World } from "../src/world";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function centerOf(x: number, y: number): [number, number] {
  // Standing player center: x + width/2, y + height/2.
  return [x + PLAYER_WIDTH / 2, y + 58 / 2];
}

function playerAtPickup(seed = 1): { world: World; x: number; y: number } {
  const world = new World({ seed });
  const x = 100;
  const y = floorY();
  world.addPlayer({ x, y });
  return { world, x, y };
}

describe("pickups weapon pads", () => {
  it("rifle pad grants rifle with a full mag and deactivates in one tick", () => {
    const { world, x, y } = playerAtPickup();
    const [cx, cy] = centerOf(x, y);
    const pad = world.addPickup("weapon", cx, cy, "rifle");
    expect(world.players[0]?.weapon).toBe("pistol");
    const events = world.step({});
    expect(events).toContain("pickup");
    expect(world.players[0]?.weapon).toBe("rifle");
    expect(world.players[0]?.magAmmo).toBe(WEAPONS.rifle.mag);
    expect(pad.active).toBe(false);
  });

  it("weapon pad without an explicit weapon defaults to rifle", () => {
    const { world, x, y } = playerAtPickup();
    const [cx, cy] = centerOf(x, y);
    const pad = world.addPickup("weapon", cx, cy);
    world.step({});
    expect(world.players[0]?.weapon).toBe("rifle");
    expect(pad.active).toBe(false);
  });

  it("weapon pad beyond 22px does not collect", () => {
    const { world, x, y } = playerAtPickup();
    const [cx, cy] = centerOf(x, y);
    const pad = world.addPickup("weapon", cx + 30, cy, "rifle");
    const events = world.step({});
    expect(events).not.toContain("pickup");
    expect(world.players[0]?.weapon).toBe("pistol");
    expect(pad.active).toBe(true);
  });

  it("consumed weapon pad reactivates after 900 ticks", () => {
    const { world, x, y } = playerAtPickup();
    const [cx, cy] = centerOf(x, y);
    const pad = world.addPickup("weapon", cx, cy, "smg");
    world.step({});
    expect(pad.active).toBe(false);
    // Walk the player off the pad so reactivation is observable.
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected player");
    }
    player.x += 200;
    for (let t = 0; t < 898; t += 1) {
      world.step({});
    }
    expect(pad.active).toBe(false);
    world.step({});
    expect(pad.active).toBe(true);
  });
});

describe("pickups sustain", () => {
  it("health pack heals +50 and reactivates after 1200 ticks", () => {
    const { world, x, y } = playerAtPickup();
    const [cx, cy] = centerOf(x, y);
    const pad = world.addPickup("health", cx, cy);
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected player");
    }
    player.hp = 30;
    player.ticksSinceDamage = 0;
    const events = world.step({});
    expect(events).toContain("pickup");
    expect(player.hp).toBe(80);
    expect(pad.active).toBe(false);
    player.x += 200;
    for (let t = 0; t < 1198; t += 1) {
      world.step({});
    }
    expect(pad.active).toBe(false);
    world.step({});
    expect(pad.active).toBe(true);
  });

  it("health pack caps at 100 and full-hp players do not consume it", () => {
    const { world, x, y } = playerAtPickup();
    const [cx, cy] = centerOf(x, y);
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected player");
    }
    player.hp = 80;
    player.ticksSinceDamage = 0;
    const pad = world.addPickup("health", cx, cy);
    world.step({});
    expect(player.hp).toBe(100);
    expect(pad.active).toBe(false);
    // Fresh full-hp player leaves a new pack untouched.
    const world2 = new World({ seed: 2 });
    world2.addPlayer({ x, y });
    const [cx2, cy2] = centerOf(x, y);
    const pad2 = world2.addPickup("health", cx2, cy2);
    const events = world2.step({});
    expect(events).not.toContain("pickup");
    expect(pad2.active).toBe(true);
  });

  it("grenade pack grants +2 capped at 3 and is skipped when full", () => {
    const { world, x, y } = playerAtPickup();
    const [cx, cy] = centerOf(x, y);
    const player = world.players[0];
    if (player === undefined) {
      throw new Error("expected player");
    }
    player.grenades = 1;
    const pad = world.addPickup("grenades", cx, cy);
    const events = world.step({});
    expect(events).toContain("pickup");
    expect(player.grenades).toBe(3);
    expect(pad.active).toBe(false);
    // Full stock leaves a new pack untouched.
    const world2 = new World({ seed: 3 });
    world2.addPlayer({ x, y });
    const [cx2, cy2] = centerOf(x, y);
    const pad2 = world2.addPickup("grenades", cx2, cy2);
    const events2 = world2.step({});
    expect(events2).not.toContain("pickup");
    expect(pad2.active).toBe(true);
  });
});

describe("props solidity and destruction", () => {
  it("live crate is solid, hp=0 crate dies next tick and turns non-solid", () => {
    const world = new World({ seed: 1 });
    world.step();
    const crate = world.addProp("crate", 200, 300);
    expect(world.isSolidAt(215, 315)).toBe(true);
    crate.hp = 0;
    world.step({});
    expect(crate.alive).toBe(false);
    expect(world.isSolidAt(215, 315)).toBe(false);
  });

  it("damageProp deals 60 to a crate and kills it", () => {
    const world = new World({ seed: 1 });
    world.step();
    const crate = world.addProp("crate", 200, 300);
    world.damageProp(crate, 20);
    expect(crate.hp).toBe(40);
    expect(crate.alive).toBe(true);
    world.damageProp(crate.id, 60);
    expect(crate.hp).toBe(0);
    expect(crate.alive).toBe(false);
    expect(world.isSolidAt(215, 315)).toBe(false);
  });

  it("live crate blocks movement, dead crate lets the player through", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    // Crate flush with the floor in the player's path.
    const crate = world.addProp("crate", 200, 18 * 32 - 30);
    for (let t = 0; t < 60; t += 1) {
      world.step({ moveX: 1 });
    }
    const blocked = world.players[0];
    if (blocked === undefined) {
      throw new Error("expected player");
    }
    expect(blocked.x + PLAYER_WIDTH).toBeLessThanOrEqual(200 + 1e-6);
    expect(blocked.x).toBeGreaterThan(100);
    world.damageProp(crate, 60);
    for (let t = 0; t < 60; t += 1) {
      world.step({ moveX: 1 });
    }
    expect(world.players[0]?.x ?? 0).toBeGreaterThan(200);
  });

  it("crate cover blocks a pistol shot and soaks 20 damage", () => {
    const world = new World({ seed: 5 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 300, y });
    // Crate straddling the chest-high ray between shooter and victim.
    const crate = world.addProp("crate", 200, y + 29 - 15);
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("shot");
    expect(events).toContain("damage");
    expect(world.players[1]?.hp).toBe(100);
    expect(crate.hp).toBe(40);
  });
});

describe("pickups determinism", () => {
  it("same-seed pickup/prop replay hash-equals", () => {
    const make = (): World => {
      const world = new World({ seed: 42 });
      const y = floorY();
      world.addPlayer({ x: 100, y });
      const [cx, cy] = centerOf(100, y);
      world.addPickup("weapon", cx, cy, "rifle");
      world.addPickup({ kind: "health", x: cx, y: cy });
      world.addProp("crate", 400, 300);
      return world;
    };
    const a = make();
    const b = make();
    for (let t = 0; t < 10; t += 1) {
      a.step({});
      b.step({});
    }
    expect(a.hash()).toBe(b.hash());
  });
});
