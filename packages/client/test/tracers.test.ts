// Hitscan tracer/muzzle fx: pure spawn fidelity, fading opacity,
// TTL expiry to zero, cap bound, and shotgun segment count.
import { describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import { WEAPONS } from "../../core/src/weapons";
import type { ShotDetail } from "../../core/src/events";
import {
  MUZZLE_TTL,
  MAX_MUZZLES,
  MAX_TRACERS,
  TRACER_TTL,
  ageFx,
  describeFrame,
  spawnShots,
  tracerOpacity,
  type Frame,
  type Muzzle,
  type Tracer,
} from "../src/renderer/index";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function rifleShot(): { frame: Frame; details: ShotDetail[] } {
  const world = new World({ seed: 1 });
  world.addPlayer({ x: 100, y: floorY() });
  world.players[0].weapon = "rifle";
  world.players[0].magAmmo = WEAPONS.rifle.mag;
  world.step([{ fire: true, aim: 0 }]);
  const details = world.drainShotDetails();
  expect(details).toHaveLength(1);
  return { frame: describeFrame(world.state, world.map), details };
}

function shotgunShots(): { frame: Frame; details: ShotDetail[] } {
  const world = new World({ seed: 3 });
  world.addPlayer({ x: 100, y: floorY() });
  world.players[0].weapon = "shotgun";
  world.players[0].magAmmo = WEAPONS.shotgun.mag;
  world.step([{ fire: true, aim: -0.15 }]);
  const details = world.drainShotDetails();
  expect(details).toHaveLength(WEAPONS.shotgun.pellets);
  return { frame: describeFrame(world.state, world.map), details };
}

describe("spawnShots", () => {
  it("spawns one tracer per pellet with verbatim endpoints", () => {
    const { frame, details } = shotgunShots();
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    expect(tracers).toHaveLength(details.length);
    for (let i = 0; i < details.length; i += 1) {
      const tracer = tracers[i];
      const detail = details[i];
      expect(tracer.x1).toBe(detail.ox);
      expect(tracer.y1).toBe(detail.oy);
      expect(tracer.x2).toBe(detail.x);
      expect(tracer.y2).toBe(detail.y);
      expect(tracer.ttl).toBe(TRACER_TTL);
      expect(tracer.width).toBeGreaterThanOrEqual(1);
      expect(tracer.width).toBeLessThanOrEqual(2);
    }
  });

  it("rifle fire spawns one tracer and one muzzle at the barrel tip", () => {
    const { frame, details } = rifleShot();
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    expect(tracers).toHaveLength(1);
    expect(muzzles).toHaveLength(1);
    const tip = frame.players[details[0].shooter].barrel;
    expect(muzzles[0].x).toBe(tip.x);
    expect(muzzles[0].y).toBe(tip.y);
    expect(muzzles[0].ttl).toBe(MUZZLE_TTL);
  });

  it("shotgun fire spawns eight segments sharing one muzzle entry", () => {
    const { frame, details } = shotgunShots();
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    expect(tracers).toHaveLength(8);
    expect(muzzles).toHaveLength(1);
  });

  it("falls back to the shot origin when the shooter left the frame", () => {
    const { details } = rifleShot();
    const empty: Frame = {
      tick: 0,
      players: [],
      projectiles: [],
      pickups: [],
      props: [],
      arena: { width: 1280, height: 640 },
    };
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, empty, details);
    expect(tracers).toHaveLength(1);
    expect(muzzles).toHaveLength(1);
    expect(muzzles[0].x).toBe(details[0].ox);
    expect(muzzles[0].y).toBe(details[0].oy);
  });
});

describe("tracer fading", () => {
  it("opacity is below 1 after one age tick and strictly decreases", () => {
    const { frame, details } = rifleShot();
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    ageFx(tracers, muzzles);
    const first = tracerOpacity(tracers[0]);
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThan(0);
    ageFx(tracers, muzzles);
    const second = tracerOpacity(tracers[0]);
    expect(second).toBeLessThan(first);
  });

  it("thirty age ticks drain every tracer and muzzle to zero", () => {
    const { frame, details } = shotgunShots();
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    expect(tracers.length).toBeGreaterThan(0);
    expect(muzzles.length).toBeGreaterThan(0);
    for (let i = 0; i < 30; i += 1) {
      ageFx(tracers, muzzles);
    }
    expect(tracers).toHaveLength(0);
    expect(muzzles).toHaveLength(0);
  });

  it("muzzle entries expire within two draws", () => {
    const { frame, details } = rifleShot();
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    expect(muzzles).toHaveLength(1);
    ageFx(tracers, muzzles);
    expect(muzzles).toHaveLength(1);
    ageFx(tracers, muzzles);
    expect(muzzles).toHaveLength(0);
  });

  it("sustained fire never exceeds the caps", () => {
    const { frame, details } = rifleShot();
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    const detail = details[0];
    const volley: ShotDetail[] = [];
    for (let i = 0; i < 100; i += 1) {
      volley.push({ ...detail });
    }
    spawnShots(tracers, muzzles, frame, volley);
    expect(tracers.length).toBeLessThanOrEqual(MAX_TRACERS);
    expect(tracers).toHaveLength(MAX_TRACERS);
    expect(muzzles.length).toBeLessThanOrEqual(MAX_MUZZLES);
    // Oldest dropped first: the survivors are the tail of the volley.
    expect(tracers[0].x2).toBe(detail.x);
    ageFx(tracers, muzzles);
    expect(tracers.length).toBeLessThanOrEqual(MAX_TRACERS);
  });
});
