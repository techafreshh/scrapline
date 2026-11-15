// Jet flame density dynamics: burn-linked flicker, low-fuel smoke wisps,
// and fast-ascent core brightening. Pure pool/helpers plus the
// describeFrame fuel pipe, so vitest drives them under node.
import { describe, expect, it } from "vitest";
import { JETPACK_FUEL_MAX } from "../../core/src/constants";
import { World } from "../../core/src/world";
import {
  JET_SMOKE_COUNT,
  JET_SMOKE_TTL,
  MAX_PARTICLES,
  spawnJetSmoke,
  updateParticles,
  type Particle,
} from "../src/fx/particles";
import {
  describeFrame,
  flameAlpha,
  flameScale,
  jetCoreBoostFor,
  jetCoreCssFor,
  jetCoreHexFor,
  jetSmokeGateFor,
} from "../src/renderer/index";

/** Default arena: 20 rows, floor top at row 18, standing height 58. */
function floorY(): number {
  return 18 * 32 - 58;
}

/** Gray smoke-tinted paints (disjoint from the orange flame palette). */
const SMOKE_CSS = new Set(["#d1d5db", "#9ca3af", "#e5e7eb"]);

/** 60 draws of gated smoke emission at one exhaust point (no flame). */
function smokeDrift(fuelRatio: number, draws = 60): Particle[] {
  const out: Particle[] = [];
  for (let tick = 0; tick < draws; tick += 1) {
    if (jetSmokeGateFor(fuelRatio, tick, 0)) {
      spawnJetSmoke(out, 100, 300);
    }
    updateParticles(out);
    expect(out.length).toBeLessThanOrEqual(MAX_PARTICLES);
  }
  return out;
}

function smokeCount(out: readonly Particle[]): number {
  return out.filter((p) => SMOKE_CSS.has(p.css)).length;
}

function variance(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
}

describe("jet smoke wisps", () => {
  it("emits a single gray slow-rising wisp per gate hit", () => {
    const out: Particle[] = [];
    spawnJetSmoke(out, 50, 60);
    expect(out).toHaveLength(JET_SMOKE_COUNT);
    const wisp = out[0] as Particle;
    expect(SMOKE_CSS.has(wisp.css)).toBe(true);
    expect(wisp.vy).toBeLessThan(0);
    expect(wisp.ttl).toBe(JET_SMOKE_TTL);
  });

  it("yields >=5 smoke at low fuel and <=2 at full fuel over 60 draws", () => {
    expect(smokeCount(smokeDrift(0.15))).toBeGreaterThanOrEqual(5);
    expect(smokeCount(smokeDrift(1.0))).toBeLessThanOrEqual(2);
  });

  it("gates smoke to dry tanks: silent at full, periodic when dry", () => {
    let lowHits = 0;
    for (let tick = 0; tick < 60; tick += 1) {
      if (jetSmokeGateFor(0.15, tick, 0)) {
        lowHits += 1;
      }
      expect(jetSmokeGateFor(1.0, tick, 0)).toBe(false);
      expect(jetSmokeGateFor(0.9, tick, 0)).toBe(false);
      expect(jetSmokeGateFor(0.25, tick, 0)).toBe(false);
    }
    expect(lowHits).toBeGreaterThanOrEqual(5);
  });
});

describe("jet core boost", () => {
  it("rests at 1x on hover and reaches the afterburner band at vy=-800", () => {
    expect(jetCoreBoostFor(0)).toBe(1);
    expect(jetCoreBoostFor(200)).toBe(1);
    expect(jetCoreBoostFor(-400)).toBeCloseTo(1.2, 5);
    expect(jetCoreBoostFor(-800)).toBeGreaterThanOrEqual(1.35);
    expect(jetCoreBoostFor(-800) / jetCoreBoostFor(0)).toBeGreaterThan(1.2);
  });

  it("never clamps to sim limits: faster climbs hold the top band", () => {
    expect(jetCoreBoostFor(-2000)).toBe(jetCoreBoostFor(-800));
    expect(jetCoreBoostFor(Number.NaN)).toBe(1);
  });

  it("whitens the core paint past the boost bands", () => {
    expect(jetCoreHexFor(1)).toBe(0xfde047);
    expect(jetCoreCssFor(1)).toBe("#fde047");
    expect(jetCoreHexFor(1.25)).toBe(0xfff7cc);
    expect(jetCoreCssFor(1.25)).toBe("#fff7cc");
    expect(jetCoreHexFor(1.4)).toBe(0xffffff);
    expect(jetCoreCssFor(1.4)).toBe("#ffffff");
  });
});

describe("burn-linked flicker", () => {
  it("keeps the legacy full-burn band with default args", () => {
    for (let tick = 0; tick < 20; tick += 1) {
      const scale = flameScale(tick, 0);
      expect(scale).toBeGreaterThanOrEqual(0.7);
      expect(scale).toBeLessThanOrEqual(1.4);
      const alpha = flameAlpha(tick, 0);
      expect(alpha).toBeGreaterThanOrEqual(0.65);
      expect(alpha).toBeLessThanOrEqual(0.99);
    }
  });

  it("flickers with variance > 0 over 60 frames at full and low fuel", () => {
    for (const fuel of [1, 0.15]) {
      const scales: number[] = [];
      const alphas: number[] = [];
      for (let tick = 0; tick < 60; tick += 1) {
        scales.push(flameScale(tick, 0, fuel));
        alphas.push(flameAlpha(tick, 0, fuel));
      }
      expect(variance(scales)).toBeGreaterThan(0);
      expect(variance(alphas)).toBeGreaterThan(0);
    }
  });
});

describe("describeFrame fuel threading", () => {
  it("maps sim fuel onto fuelRatio through JETPACK_FUEL_MAX", () => {
    const world = new World({ seed: 7 });
    world.addPlayer({ x: 100, y: floorY(), fuel: 15 });
    const low = describeFrame(world.state, world.map);
    expect(low.players[0]?.fuelRatio).toBeCloseTo(15 / JETPACK_FUEL_MAX, 5);
    expect(low.players[0]?.vy).toBe(world.players[0]?.vy ?? 0);
  });

  it("clamps fuelRatio into [0, 1] and defaults bad readings to full", () => {
    const world = new World({ seed: 7 });
    world.addPlayer({ x: 100, y: floorY(), fuel: JETPACK_FUEL_MAX });
    expect(describeFrame(world.state, world.map).players[0]?.fuelRatio).toBe(1);
    const sim = world.players[0];
    if (sim === undefined) {
      throw new Error("expected a sim player");
    }
    sim.fuel = JETPACK_FUEL_MAX * 2;
    expect(describeFrame(world.state, world.map).players[0]?.fuelRatio).toBe(1);
    sim.fuel = -5;
    expect(describeFrame(world.state, world.map).players[0]?.fuelRatio).toBe(0);
    sim.fuel = Number.NaN;
    expect(describeFrame(world.state, world.map).players[0]?.fuelRatio).toBe(1);
  });
});
