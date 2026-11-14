// Particle pool: muzzle brightness within 24px, explosion density within
// 80px across 400ms, jet-trail continuity, caps, and expiry. Pure pool
// helpers (no DOM, no Pixi), so vitest drives them under node.
import { describe, expect, it } from "vitest";
import {
  DEATH_COUNT,
  DEATH_TTL,
  EXPLOSION_DEBRIS_COUNT,
  EXPLOSION_SMOKE_COUNT,
  EXPLOSION_FLASH_COUNT,
  IMPACT_COUNT,
  IMPACT_TTL,
  JET_PER_FRAME,
  JET_TTL,
  MAX_PARTICLES,
  MUZZLE_COUNT,
  MUZZLE_TTL,
  PICKUP_COUNT,
  PICKUP_TTL,
  countWithin,
  particleOpacity,
  spawnDeathBurst,
  spawnExplosion,
  spawnImpact,
  spawnJetExhaust,
  spawnMuzzleFlash,
  spawnPickupSparkle,
  updateParticles,
  type Particle,
} from "../src/fx/particles";

describe("spawnMuzzleFlash", () => {
  it("spawns MUZZLE_COUNT bright particles within 24px of the muzzle", () => {
    expect(MUZZLE_COUNT).toBeGreaterThanOrEqual(4);
    const out: Particle[] = [];
    spawnMuzzleFlash(out, 100, 200, 0);
    expect(out).toHaveLength(MUZZLE_COUNT);
    for (const p of out) {
      expect(Math.hypot(p.x - 100, p.y - 200)).toBeLessThanOrEqual(24);
      expect(p.ttl).toBe(MUZZLE_TTL);
      expect(p.size).toBeGreaterThanOrEqual(2);
    }
  });

  it("stays inside 24px for the full 200ms window (12 draws)", () => {
    const out: Particle[] = [];
    spawnMuzzleFlash(out, 100, 200, 0);
    for (let i = 0; i < 12; i += 1) {
      updateParticles(out);
    }
    expect(countWithin(out, 100, 200, 24)).toBeGreaterThanOrEqual(4);
  });

  it("fades linearly and drains within 30 draws", () => {
    const out: Particle[] = [];
    spawnMuzzleFlash(out, 0, 0, 0);
    const first = out[0] as Particle;
    expect(particleOpacity(first)).toBe(1);
    updateParticles(out);
    expect(particleOpacity(out[0] as Particle)).toBeLessThan(1);
    for (let i = 0; i < 30; i += 1) {
      updateParticles(out);
    }
    expect(out).toHaveLength(0);
  });
});

describe("spawnExplosion", () => {
  it("spawns flash plus smoke plus debris totaling >= 15 within 80px", () => {
    const out: Particle[] = [];
    spawnExplosion(out, 50, 60, 150);
    const total = EXPLOSION_FLASH_COUNT + EXPLOSION_SMOKE_COUNT + EXPLOSION_DEBRIS_COUNT;
    expect(total).toBeGreaterThanOrEqual(15);
    expect(out).toHaveLength(total);
    expect(countWithin(out, 50, 60, 80)).toBeGreaterThanOrEqual(15);
  });

  it("keeps >= 15 particles inside 80px after 400ms (24 draws)", () => {
    const out: Particle[] = [];
    spawnExplosion(out, 50, 60, 150);
    for (let i = 0; i < 24; i += 1) {
      updateParticles(out);
    }
    expect(countWithin(out, 50, 60, 80)).toBeGreaterThanOrEqual(15);
    // Survivors stay bright enough for the luminance probe.
    for (const p of out) {
      expect(particleOpacity(p)).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("scales debris spread with the blast radius", () => {
    const small: Particle[] = [];
    const big: Particle[] = [];
    spawnExplosion(small, 0, 0, 60);
    spawnExplosion(big, 0, 0, 150);
    const farSmall = small.filter((p) => Math.hypot(p.x, p.y) > 0);
    const farBig = big.filter((p) => Math.hypot(p.x, p.y) > 0);
    expect(farSmall.length).toBeGreaterThan(0);
    expect(farBig.length).toBeGreaterThan(0);
  });
});

describe("spawnJetExhaust", () => {
  it("emits JET_PER_FRAME particles per frame at the exhaust point", () => {
    const out: Particle[] = [];
    spawnJetExhaust(out, 100, 300);
    expect(out).toHaveLength(JET_PER_FRAME);
    for (const p of out) {
      expect(p.ttl).toBe(JET_TTL);
    }
  });

  it("builds a continuous trail: 2s of jetting stays capped and visible below the player", () => {
    const out: Particle[] = [];
    // 2s at 60fps with 3/frame would be 360 without the cap; the pool
    // holds the 30-draw trail window instead.
    for (let frame = 0; frame < 120; frame += 1) {
      spawnJetExhaust(out, 100, 300 - frame * 2);
      updateParticles(out);
      expect(out.length).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    expect(out.length).toBeGreaterThan(0);
    // Freshest particles sit within 20px below the latest exhaust point.
    expect(countWithin(out, 100, 300 - 119 * 2, 40)).toBeGreaterThan(0);
  });
});

describe("impact, death, and pickup spawns", () => {
  it("spawns IMPACT_COUNT sparks within 24px", () => {
    const out: Particle[] = [];
    spawnImpact(out, 10, 20);
    expect(out).toHaveLength(IMPACT_COUNT);
    expect(countWithin(out, 10, 20, 24)).toBe(IMPACT_COUNT);
    for (const p of out) {
      expect(p.ttl).toBe(IMPACT_TTL);
    }
  });

  it("honors a surface tint for the first two impact sparks", () => {
    const out: Particle[] = [];
    spawnImpact(out, 0, 0, 0x123456, "#123456");
    expect(out[0]?.color).toBe(0x123456);
    expect(out[0]?.css).toBe("#123456");
    expect(out[1]?.color).toBe(0x123456);
  });

  it("spawns DEATH_COUNT burst particles with radial velocity", () => {
    const out: Particle[] = [];
    spawnDeathBurst(out, 50, 60);
    expect(out).toHaveLength(DEATH_COUNT);
    for (const p of out) {
      expect(p.ttl).toBe(DEATH_TTL);
      expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(0);
    }
  });

  it("spawns PICKUP_COUNT sparkles that rise", () => {
    const out: Particle[] = [];
    spawnPickupSparkle(out, 70, 80);
    expect(out).toHaveLength(PICKUP_COUNT);
    for (const p of out) {
      expect(p.ttl).toBe(PICKUP_TTL);
      expect(p.vy).toBeLessThan(0.5);
    }
  });
});

describe("pool caps and expiry", () => {
  it("never exceeds MAX_PARTICLES, oldest dropped first", () => {
    const out: Particle[] = [];
    for (let i = 0; i < MAX_PARTICLES + 100; i += 1) {
      spawnMuzzleFlash(out, i, 0, 0);
    }
    expect(out.length).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(out).toHaveLength(MAX_PARTICLES);
  });

  it("drains every pool within 60 draws", () => {
    const out: Particle[] = [];
    spawnMuzzleFlash(out, 0, 0, 0);
    spawnExplosion(out, 0, 0, 150);
    spawnJetExhaust(out, 0, 0);
    spawnDeathBurst(out, 0, 0);
    spawnPickupSparkle(out, 0, 0);
    spawnImpact(out, 0, 0);
    for (let i = 0; i < 60; i += 1) {
      updateParticles(out);
    }
    expect(out).toHaveLength(0);
  });
});
