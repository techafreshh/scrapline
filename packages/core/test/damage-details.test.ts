// Damage/kill detail readout: per-hit spark positions with victim and
// shooter identity plus per-kill death positions, drained per step, with
// zero impact on events, RNG flow, or the state hash.
import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import { WEAPONS } from "../src/weapons";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../src/constants";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function duel(seed = 1): World {
  const world = new World({ seed });
  world.addPlayer({ x: 100, y: floorY() });
  world.addPlayer({ x: 300, y: floorY() });
  world.players[0].weapon = "pistol";
  world.players[0].magAmmo = WEAPONS.pistol.mag;
  return world;
}

describe("damage details", () => {
  it("pistol hit records one damage detail at the pellet endpoint", () => {
    const world = duel();
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("damage");
    const details = world.drainDamageDetails();
    expect(details).toHaveLength(1);
    const detail = details[0];
    // Victim identity plus local shooter attribution for the hitmarker.
    expect(detail.victim).toBe(1);
    expect(detail.victimId).toBe(world.players[1].id);
    expect(detail.shooter).toBe(0);
    expect(detail.shooterId).toBe(world.players[0].id);
    // Pellet endpoint: the victim box entry, level with the shooter center.
    const mx = world.players[0].x + PLAYER_WIDTH / 2;
    const my = world.players[0].y + PLAYER_HEIGHT / 2;
    expect(detail.x).toBeGreaterThanOrEqual(world.players[1].x - 1);
    expect(detail.x).toBeLessThanOrEqual(world.players[1].x + PLAYER_WIDTH);
    // Level aim: pellet spread (±0.022 rad) keeps the hit near center height.
    expect(detail.y).toBeCloseTo(my, -1);
    expect(detail.x).toBeGreaterThan(mx);
    // Draining twice yields nothing the second time.
    expect(world.drainDamageDetails()).toHaveLength(0);
  });

  it("lethal hit records damage plus a kill detail at the victim center", () => {
    const world = duel();
    world.players[1].hp = 5;
    const events = world.step([{ fire: true, aim: 0 }, {}]);
    expect(events).toContain("kill");
    expect(world.drainDamageDetails()).toHaveLength(1);
    const kills = world.drainKillDetails();
    expect(kills).toHaveLength(1);
    const kill = kills[0];
    expect(kill.victim).toBe(1);
    expect(kill.victimId).toBe(world.players[1].id);
    expect(kill.killerId).toBe(world.players[0].id);
    expect(kill.x).toBeCloseTo(world.players[1].x + PLAYER_WIDTH / 2, 10);
    expect(kill.y).toBeCloseTo(world.players[1].y + PLAYER_HEIGHT / 2, 10);
  });

  it("sleeper deaths record a kill detail with a null killer", () => {
    const world = duel();
    world.players[1].hp = 0;
    const events = world.step([{}, {}]);
    expect(events).toContain("kill");
    expect(world.drainDamageDetails()).toHaveLength(0);
    const kills = world.drainKillDetails();
    expect(kills).toHaveLength(1);
    expect(kills[0].victim).toBe(1);
    expect(kills[0].killerId).toBe(null);
  });

  it("splash damage records victim-center details with the owner as shooter", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 170, y });
    world.players[0].weapon = "rocket";
    world.players[0].magAmmo = WEAPONS.rocket.mag;
    world.step([{ fire: true, aim: 0 }, {}]);
    // The rocket crosses the 70px gap in a few ticks, then its splash
    // (radius 150) catches both adjacent players.
    let exploded = false;
    for (let i = 0; i < 30 && !exploded; i += 1) {
      exploded = world.step([{}, {}]).includes("explode");
    }
    expect(exploded).toBe(true);
    const damages = world.drainDamageDetails();
    expect(damages.length).toBeGreaterThanOrEqual(2);
    for (const detail of damages) {
      expect(detail.shooterId).toBe(world.players[0].id);
      expect(detail.shooter).toBe(0);
      const victim = world.players[detail.victim];
      expect(detail.x).toBeCloseTo(victim.x + PLAYER_WIDTH / 2, 6);
      expect(detail.y).toBeCloseTo(victim.y + PLAYER_HEIGHT / 2, 6);
    }
  });

  it("undrained leftovers die on the next step", () => {
    const world = duel();
    world.step([{ fire: true, aim: 0 }, {}]);
    expect(world.drainDamageDetails()).toHaveLength(1);
    // Cooldown blocks a second shot, so the queue stays empty.
    world.step([{}, {}]);
    expect(world.drainDamageDetails()).toHaveLength(0);
    expect(world.drainKillDetails()).toHaveLength(0);
  });

  it("identical seeds keep identical detail streams and hashes", () => {
    const setup = (): World => {
      const world = new World({ seed: 7 });
      const y = floorY();
      world.addPlayer({ x: 100, y });
      world.addPlayer({ x: 300, y });
      world.players[0].weapon = "pistol";
      world.players[0].magAmmo = WEAPONS.pistol.mag;
      return world;
    };
    const a = setup();
    const b = setup();
    const eventsA = a.step([{ fire: true, aim: 0 }, {}]);
    const eventsB = b.step([{ fire: true, aim: 0 }, {}]);
    expect(eventsA).toEqual(eventsB);
    expect(a.drainDamageDetails()).toEqual(b.drainDamageDetails());
    expect(a.drainKillDetails()).toEqual(b.drainKillDetails());
    expect(a.hash()).toBe(b.hash());
  });

  it("draining leaves the state hash untouched", () => {
    const world = duel();
    world.step([{ fire: true, aim: 0 }, {}]);
    const before = world.hash();
    world.drainDamageDetails();
    world.drainKillDetails();
    expect(world.hash()).toBe(before);
  });
});
