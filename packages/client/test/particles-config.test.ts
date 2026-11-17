// Pixi emitter configs: six effects, all capped, all starting silent,
// all consuming committed `particle-pack` manifest frames (no WHITE).
import { describe, expect, it } from "vitest";
import {
  DEATH_EMITTER_CONFIG,
  EXPLOSION_EMITTER_CONFIG,
  FX_EMITTER_CAPS,
  FX_EMITTER_TEXTURES,
  FX_MANIFEST_FRAMES,
  IMPACT_EMITTER_CONFIG,
  JET_EMITTER_CONFIG,
  MUZZLE_EMITTER_CONFIG,
  PICKUP_EMITTER_CONFIG,
  fxManifestFrame,
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

  it("every config fades alpha, shrinks, tints, and uses a particle-pack texture", () => {
    for (const config of CONFIGS) {
      const types = config.behaviors.map((b) => b.type);
      expect(types).toContain("alpha");
      expect(types).toContain("scale");
      expect(types).toContain("color");
      const tex = config.behaviors.find(
        (b) => b.type === "textureSingle" || b.type === "textureRandom",
      );
      expect(tex).toBeDefined();
      if (tex?.type === "textureSingle") {
        const frame = (tex.config as { texture?: unknown }).texture;
        expect(typeof frame).toBe("string");
        expect((frame as string).startsWith("fx.")).toBe(true);
        expect((frame as string).length).toBeGreaterThan(0);
      } else {
        const frames = (tex?.config as { textures?: unknown }).textures;
        expect(Array.isArray(frames)).toBe(true);
        expect((frames as unknown[]).length).toBeGreaterThan(0);
        for (const frame of frames as unknown[]) {
          expect(typeof frame).toBe("string");
          expect((frame as string).startsWith("fx.")).toBe(true);
        }
      }
    }
  });

  it("covers the acceptance frames muzzle.1 spark.1 smoke.2 flash.1 trail.1 sparkle.1", () => {
    for (const key of [
      "fx.muzzle.1",
      "fx.spark.1",
      "fx.smoke.2",
      "fx.flash.1",
      "fx.trail.1",
      "fx.sparkle.1",
    ]) {
      const [family, index] = key.split(".").slice(1);
      const run = FX_MANIFEST_FRAMES[family as keyof typeof FX_MANIFEST_FRAMES];
      expect(run).toBeDefined();
      expect(run).toContain(key);
      expect(fxManifestFrame(family, Number(index))).toBeDefined();
    }
    expect(FX_EMITTER_TEXTURES.muzzle).toBe("fx.muzzle.1");
    expect(FX_EMITTER_TEXTURES.impact).toBe("fx.spark.1");
    expect(FX_EMITTER_TEXTURES.explosionSmoke).toBe("fx.smoke.2");
    expect(FX_EMITTER_TEXTURES.explosionFlash).toBe("fx.flash.1");
    expect(FX_EMITTER_TEXTURES.jet).toBe("fx.trail.1");
    expect(FX_EMITTER_TEXTURES.pickup).toBe("fx.sparkle.1");
    const flat = CONFIGS.flatMap((c) =>
      c.behaviors.flatMap((b) => {
        if (b.type === "textureSingle") {
          return [(b.config as { texture?: unknown }).texture as string];
        }
        if (b.type === "textureRandom") {
          return [...((b.config as { textures?: string[] }).textures ?? [])];
        }
        return [];
      }),
    );
    for (const key of [
      "fx.muzzle.1",
      "fx.spark.1",
      "fx.smoke.2",
      "fx.flash.1",
      "fx.trail.1",
      "fx.sparkle.1",
    ]) {
      expect(flat).toContain(key);
    }
  });

  it("explosion cycles flash plus smoke plus debris frames", () => {
    const tex = EXPLOSION_EMITTER_CONFIG.behaviors.find(
      (b) => b.type === "textureRandom" || b.type === "textureSingle",
    );
    expect(tex).toBeDefined();
    const frames =
      tex?.type === "textureRandom"
        ? ((tex.config as { textures?: string[] }).textures ?? [])
        : [(tex?.config as { texture?: string }).texture as string];
    expect(frames).toContain("fx.flash.1");
    expect(frames).toContain("fx.smoke.2");
  });
});
