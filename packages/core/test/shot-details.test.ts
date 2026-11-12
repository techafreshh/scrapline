// Hitscan shot-detail readout: one detail per fired pellet with
// sim-verbatim origin/hit coordinates, drained per step, with zero
// impact on damage events, RNG flow, or the state hash.
import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../src/constants";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function armedRifle(seed = 1): World {
  const world = new World({ seed });
  world.addPlayer({ x: 100, y: floorY() });
  const player = world.players[0];
  player.weapon = "rifle";
  player.magAmmo = WEAPONS.rifle.mag;
  return world;
}

function shooterCenter(world: World): { x: number; y: number } {
  const player = world.players[0];
  return {
    x: player.x + PLAYER_WIDTH / 2,
    y: player.y + PLAYER_HEIGHT / 2,
  };
}

describe("shot details", () => {
  it("rifle fire yields one detail from the shooter center to full range", () => {
    const world = armedRifle();
    // Aim level across open air: no player/prop/wall blocks, so the
    // endpoint lands exactly at range on the pellet ray.
    const events = world.step([{ fire: true, aim: 0 }]);
    expect(events).toContain("shot");
    const details = world.drainShotDetails();
    expect(details).toHaveLength(1);
    const detail = details[0];
    const center = shooterCenter(world);
    expect(detail.ox).toBeCloseTo(center.x, 10);
    expect(detail.oy).toBeCloseTo(center.y, 10);
    const length = Math.hypot(detail.x - detail.ox, detail.y - detail.oy);
    expect(length).toBeCloseTo(WEAPONS.rifle.range, 6);
    expect(detail.weapon).toBe("rifle");
    expect(detail.shooterId).toBe(world.players[0].id);
    expect(detail.shooter).toBe(0);
    expect(detail.tick).toBe(0);
  });

  it("a downward shot into the floor resolves a short tracer", () => {
    const world = armedRifle();
    world.step([{ fire: true, aim: Math.PI / 2 }]);
    const details = world.drainShotDetails();
    expect(details).toHaveLength(1);
    const detail = details[0];
    const length = Math.hypot(detail.x - detail.ox, detail.y - detail.oy);
    expect(length).toBeLessThan(WEAPONS.rifle.range);
    expect(length).toBeGreaterThan(0);
  });

  it("shotgun fire yields eight fanned details with spread over 4px", () => {
    const world = armedRifle();
    const player = world.players[0];
    player.weapon = "shotgun";
    player.magAmmo = WEAPONS.shotgun.mag;
    // Aim slightly up so the whole fan stays airborne at full range.
    world.step([{ fire: true, aim: -0.15 }]);
    const details = world.drainShotDetails();
    expect(details).toHaveLength(WEAPONS.shotgun.pellets);
    const center = shooterCenter(world);
    for (const detail of details) {
      expect(detail.ox).toBeCloseTo(center.x, 10);
      expect(detail.oy).toBeCloseTo(center.y, 10);
    }
    const keys = new Set(details.map((d) => `${d.x.toFixed(4)},${d.y.toFixed(4)}`));
    expect(keys.size).toBeGreaterThanOrEqual(3);
    let spread = 0;
    for (let a = 0; a < details.length; a += 1) {
      for (let b = a + 1; b < details.length; b += 1) {
        spread = Math.max(
          spread,
          Math.hypot(details[a].x - details[b].x, details[a].y - details[b].y),
        );
      }
    }
    expect(spread).toBeGreaterThan(4);
  });

  it("rocket fire records no details", () => {
    const world = armedRifle();
    const player = world.players[0];
    player.weapon = "rocket";
    player.magAmmo = WEAPONS.rocket.mag;
    const events = world.step([{ fire: true, aim: 0 }]);
    expect(events).toContain("shot");
    expect(world.drainShotDetails()).toHaveLength(0);
  });

  it("drain empties the queue and the next step starts empty", () => {
    const world = armedRifle();
    world.step([{ fire: true, aim: 0 }]);
    expect(world.drainShotDetails()).toHaveLength(1);
    expect(world.drainShotDetails()).toHaveLength(0);
    // Cooldown blocks a second shot, so the queue stays empty.
    world.step([{}]);
    expect(world.drainShotDetails()).toHaveLength(0);
    world.step([{}]);
    expect(world.drainShotDetails()).toHaveLength(0);
  });

  it("identical seeds keep identical hashes, events, and details", () => {
    const setup = (): World => {
      const world = new World({ seed: 7 });
      const y = floorY();
      world.addPlayer({ x: 100, y });
      world.addPlayer({ x: 300, y });
      world.players[0].weapon = "rifle";
      world.players[0].magAmmo = WEAPONS.rifle.mag;
      return world;
    };
    const a = setup();
    const b = setup();
    const eventsA = a.step([{ fire: true, aim: 0 }, {}]);
    const eventsB = b.step([{ fire: true, aim: 0 }, {}]);
    expect(eventsA).toEqual(eventsB);
    expect(a.drainShotDetails()).toEqual(b.drainShotDetails());
    expect(a.hash()).toBe(b.hash());
  });
});
