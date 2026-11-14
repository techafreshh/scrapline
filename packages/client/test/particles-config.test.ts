// Pixi emitter configs: six effects, all capped, all starting silent,
// all sharing the instantly-available WHITE texture (empty string).
import { describe, expect, it } from "vitest";
import {
  DEATH_EMITTER_CONFIG,
  EXPLOSION_EMITTER_CONFIG,
  FX_EMITTER_CAPS,
  IMPACT_EMITTER_CONFIG,
  JET_EMITTER_CONFIG,
  MUZZLE_EMITTER_CONFIG,
  PICKUP_EMITTER_CONFIG,
} from "../src/fx/particles-config";
import { MAX_PARTICLES } from "../src/fx/particles";

const CONFIGS = [
  MUZZLE_EMITTER_CONFIG,
  IMPACT_EMITTER_CONFIG,
  EXPLOSION_EMITTER_CONFIG,
  JET_EMITTER_CONFIG,
  DEATH_EMITTER_CONFIG,
  PICKUP_EMITTER_CONFIG,
];

describe("fx emitter configs", () => {
  it("covers muzzle, impact, explosion, jet, death, and pickup", () => {
    expect(CONFIGS).toHaveLength(6);
  });

  it("caps every emitter and sums inside the pooled cap", () => {
    const caps = Object.values(FX_EMITTER_CAPS);
    expect(caps).toHaveLength(6);
    for (const cap of caps) {
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(128);
    }
    const total = caps.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(MAX_PARTICLES);
    for (const config of CONFIGS) {
      expect(config.maxParticles).toBeGreaterThan(0);
      expect(config.emit).toBe(false);
    }
  });

  it("drives one-shot bursts plus one continuous jet trail", () => {
    expect(JET_EMITTER_CONFIG.emitterLifetime).toBe(-1);
    for (const config of [
      MUZZLE_EMITTER_CONFIG,
      IMPACT_EMITTER_CONFIG,
      EXPLOSION_EMITTER_CONFIG,
      DEATH_EMITTER_CONFIG,
      PICKUP_EMITTER_CONFIG,
    ]) {
      expect(config.emitterLifetime).toBeGreaterThan(0);
    }
  });

  it("every config fades alpha, shrinks, tints, and uses the WHITE texture", () => {
    for (const config of CONFIGS) {
      const types = config.behaviors.map((b) => b.type);
      expect(types).toContain("alpha");
      expect(types).toContain("scale");
      expect(types).toContain("color");
      expect(types).toContain("textureSingle");
      const white = config.behaviors.find((b) => b.type === "textureSingle");
      expect((white?.config as { texture?: unknown }).texture).toBe("");
    }
  });
});
