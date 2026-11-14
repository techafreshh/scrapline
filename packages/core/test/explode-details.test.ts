// Explosion and pickup detail readout: sim-space blast centers plus pad
// positions, drained per step, with zero impact on events, RNG flow, or
// the state hash (the renderer fix for wall-hit explosions with no
// victims and for pickup sparkles).
import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../src/constants";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

describe("explode details", () => {
  it("rocket wall hit records one blast center at the impact point", () => {
    const world = new World({ seed: 1 });
    world.addPlayer({ x: 100, y: floorY() });
    world.players[0].weapon = "rocket";
    world.players[0].magAmmo = WEAPONS.rocket.mag;
    world.step([{ fire: true, aim: Math.PI / 2 }]);
    // Straight down: the rocket crosses ~30px to the floor quickly.
    let blasts = world.drainExplodeDetails();
    let guard = 0;
    while (blasts.length === 0 && guard < 30) {
      world.step([{}]);
      blasts = world.drainExplodeDetails();
      guard += 1;
    }
    expect(blasts.length).toBeGreaterThanOrEqual(1);
    const blast = blasts[0];
    expect(Number.isFinite(blast.x)).toBe(true);
    expect(Number.isFinite(blast.y)).toBe(true);
    expect(blast.radius).toBe(WEAPONS.rocket.splashRadius);
    // Blast sits near the floor under the shooter, not on the player.
    expect(Math.abs(blast.x - (100 + PLAYER_WIDTH / 2))).toBeLessThan(60);
    expect(blast.y).toBeGreaterThan(floorY());
    // Draining twice yields nothing the second time.
    expect(world.drainExplodeDetails()).toHaveLength(0);
  });

  it("grenade fuse records a blast with the grenade radius", () => {
    const world = new World({ seed: 2 });
    world.addPlayer({ x: 200, y: floorY() });
    world.step([{ grenade: true, aim: 0 }]);
    expect(world.projectiles.length).toBeGreaterThanOrEqual(1);
    let blasts: ReturnType<World["drainExplodeDetails"]> = [];
    for (let i = 0; i < 200 && blasts.length === 0; i += 1) {
      world.step([{}]);
      blasts = world.drainExplodeDetails();
    }
    expect(blasts.length).toBeGreaterThanOrEqual(1);
    expect(blasts[0].radius).toBeGreaterThan(0);
  });

  it("undrained blast leftovers die on the next step", () => {
    const world = new World({ seed: 3 });
    world.addPlayer({ x: 100, y: floorY() });
    world.players[0].weapon = "rocket";
    world.players[0].magAmmo = WEAPONS.rocket.mag;
    world.step([{ fire: true, aim: Math.PI / 2 }]);
    for (let i = 0; i < 30; i += 1) {
      world.step([{}]);
    }
    // Drain once, then the next step clears the queue.
    world.drainExplodeDetails();
    world.step([{}]);
    expect(world.drainExplodeDetails()).toHaveLength(0);
  });

  it("blast recording never perturbs the state hash", () => {
    const setup = (): World => {
      const world = new World({ seed: 7 });
      world.addPlayer({ x: 100, y: floorY() });
      world.players[0].weapon = "rocket";
      world.players[0].magAmmo = WEAPONS.rocket.mag;
      return world;
    };
    const a = setup();
    const b = setup();
    a.step([{ fire: true, aim: 0 }]);
    b.step([{ fire: true, aim: 0 }]);
    // Only one side drains: hashes must still match (pendings unhashed).
    a.drainExplodeDetails();
    expect(a.hash()).toBe(b.hash());
  });
});

describe("pickup details", () => {
  it("weapon pad collection records the pad position and player", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    const pad = world.addPickup("weapon", 100 + PLAYER_WIDTH / 2, y + PLAYER_HEIGHT / 2, "rifle");
    world.players[0].weapon = "pistol";
    const events = world.step([{}]);
    expect(events).toContain("pickup");
    const details = world.drainPickupDetails();
    expect(details).toHaveLength(1);
    expect(details[0].x).toBe(pad.x);
    expect(details[0].y).toBe(pad.y);
    expect(details[0].kind).toBe("weapon");
    expect(details[0].player).toBe(0);
    expect(world.players[0].weapon).toBe("rifle");
  });

  it("health pad at full hp records nothing", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPickup("health", 100 + PLAYER_WIDTH / 2, y + PLAYER_HEIGHT / 2);
    const events = world.step([{}]);
    expect(events).not.toContain("pickup");
    expect(world.drainPickupDetails()).toHaveLength(0);
  });

  it("damaged player collecting health records a health detail", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.players[0].hp = 40;
    world.addPickup("health", 100 + PLAYER_WIDTH / 2, y + PLAYER_HEIGHT / 2);
    const events = world.step([{}]);
    expect(events).toContain("pickup");
    const details = world.drainPickupDetails();
    expect(details).toHaveLength(1);
    expect(details[0].kind).toBe("health");
  });
});
