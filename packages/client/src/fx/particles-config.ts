// Pixi `pixi-v8-particle-emitter` (v8-native particle-emitter) configs for the
// six combat effects. Textures resolve through the committed particle-pack
// vendor atlas (tools/build-atlas.js `particle-pack` manifest keys), so
// unit tests import them under node without touching WebGL. The lazy
// factory lives in ./emitters.ts and dynamic-imports the library only on
// the Pixi path, keeping the canvas2d fallback and the initial main.js
// chunk free of the emitter code.
//
// Caps: every config carries maxParticles; the six emitters sum to 412
// live particles worst-case, inside the 512 pooled cap, so fill rate
// stays flat and the 1280x720 fps guardrail holds.

import type { EmitterConfigV3 } from "pixi-v8-particles";

/**
 * Vendor atlas dot-names per effect family (tools/build-atlas.js
 * `particle-pack` manifest keys) for the vendor-sprite swap: emitters
 * resolve textures through the manifest; no runtime file imports vendor
 * art. Families cover muzzle flash, impact sparks, explosion smoke,
 * explosion debris (fire), jet flame, plus the issue #269 flash (blast
 * core), trail (jet exhaust streaks), and sparkle (pickup glints) runs
 * so `fx.muzzle.1`, `fx.spark.1`, `fx.smoke.2`, `fx.flash.1`,
 * `fx.trail.1`, and `fx.sparkle.1` all resolve in-manifest.
 */
export const FX_MANIFEST_FRAMES: Record<string, readonly string[]> = Object.freeze({
  smoke: Object.freeze(["fx.smoke.0", "fx.smoke.1", "fx.smoke.2", "fx.smoke.3"]),
  muzzle: Object.freeze(["fx.muzzle.0", "fx.muzzle.1", "fx.muzzle.2"]),
  spark: Object.freeze(["fx.spark.0", "fx.spark.1"]),
  fire: Object.freeze(["fx.fire.0", "fx.fire.1"]),
  flame: Object.freeze(["fx.flame.0", "fx.flame.1"]),
  flash: Object.freeze(["fx.flash.0", "fx.flash.1"]),
  trail: Object.freeze(["fx.trail.0", "fx.trail.1"]),
  sparkle: Object.freeze(["fx.sparkle.0", "fx.sparkle.1"]),
});

/**
 * Vendor atlas dot-name for one effect frame (family plus cycle index,
 * wrapping around the family run). Unknown families and non-finite
 * indexes fall back to the first smoke frame. Pure, never throws.
 */
export function fxManifestFrame(family: unknown, index: unknown): string {
  try {
    const run =
      typeof family === "string" ? FX_MANIFEST_FRAMES[family.trim().toLowerCase()] : undefined;
    const frames = run ?? FX_MANIFEST_FRAMES["smoke"];
    const step = typeof index === "number" && Number.isFinite(index) ? Math.floor(index) : 0;
    const at = ((step % frames.length) + frames.length) % frames.length;
    return frames[at] ?? "fx.smoke.0";
  } catch {
    return "fx.smoke.0";
  }
}

/** Per-emitter `particle-pack` texture for one effect (manifest dot-name). */
export const FX_EMITTER_TEXTURES = Object.freeze({
  muzzle: "fx.muzzle.1",
  impact: "fx.spark.1",
  explosionFlash: "fx.flash.1",
  explosionSmoke: "fx.smoke.2",
  explosionDebris: "fx.fire.0",
  jet: "fx.trail.1",
  death: "fx.fire.1",
  pickup: "fx.sparkle.1",
});
/** Per-emitter live-particle caps (perf: six emitters sum to 412). */
export const FX_EMITTER_CAPS = Object.freeze({
  muzzle: 32,
  impact: 96,
  explosion: 128,
  jet: 60,
  death: 64,
  pickup: 32,
});

/** Shared additive-blend alpha fade for short flashes. */
function alphaFade(): { type: string; config: unknown } {
  return {
    type: "alpha",
    config: {
      alpha: {
        list: [
          { value: 1, time: 0 },
          { value: 0, time: 1 },
        ],
      },
    },
  };
}

/** Shared shrink fade. */
function scaleFade(from: number, to: number): { type: string; config: unknown } {
  return {
    type: "scale",
    config: {
      scale: {
        list: [
          { value: from, time: 0 },
          { value: to, time: 1 },
        ],
      },
    },
  };
}

/** Pack-texture entry: one `particle-pack` manifest frame per emitter.
 *  The string resolves through ParticleUtils.GetTextureFromString once the
 *  atlas family loads; headless unit tests never resolve it. */
function packTexture(frame: string): { type: string; config: unknown } {
  return { type: "textureSingle", config: { texture: frame } };
}

/** Pack-texture roulette for the explosion core: flash plus smoke plus
 *  debris frames cycle per particle (pixi `textureRandom` with the
 *  manifest dot-names), so one config still paints all three bands. */
function packTextureRandom(frames: readonly string[]): { type: string; config: unknown } {
  return { type: "textureRandom", config: { textures: [...frames] } };
}

/** Muzzle flash: one-shot bright burst at the barrel tip (`particle-pack` muzzle). */
export const MUZZLE_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.18, max: 0.3 },
  frequency: 0.01,
  spawnChance: 1,
  particlesPerWave: 10,
  emitterLifetime: 0.12,
  maxParticles: FX_EMITTER_CAPS.muzzle,
  pos: { x: 0, y: 0 },
  addAtBack: false,
  emit: false,
  behaviors: [
    alphaFade(),
    scaleFade(1, 0.2),
    {
      type: "color",
      config: {
        color: {
          list: [
            { value: "fff7cc", time: 0 },
            { value: "fde047", time: 1 },
          ],
        },
      },
    },
    {
      type: "moveSpeed",
      config: { speed: { list: [{ value: 120, time: 0 }, { value: 20, time: 1 }] } },
    },
    { type: "rotationStatic", config: { min: 0, max: 360 } },
    { type: "spawnShape", config: { type: "point", data: { x: 0, y: 0 } } },
    packTexture("fx.muzzle.1"),
  ],
};

/** Impact sparks: surface-tinted burst (tint applied at spawn via color behavior override). */
export const IMPACT_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.15, max: 0.3 },
  frequency: 0.01,
  spawnChance: 1,
  particlesPerWave: 10,
  emitterLifetime: 0.15,
  maxParticles: FX_EMITTER_CAPS.impact,
  pos: { x: 0, y: 0 },
  addAtBack: false,
  emit: false,
  behaviors: [
    alphaFade(),
    scaleFade(0.9, 0.1),
    {
      type: "color",
      config: {
        color: {
          list: [
            { value: "fef08a", time: 0 },
            { value: "fbbf24", time: 1 },
          ],
        },
      },
    },
    {
      type: "moveSpeed",
      config: { speed: { list: [{ value: 220, time: 0 }, { value: 40, time: 1 }] } },
    },
    { type: "rotationStatic", config: { min: 0, max: 360 } },
    { type: "spawnShape", config: { type: "point", data: { x: 0, y: 0 } } },
    packTexture("fx.spark.1"),
  ],
};

/** Explosion: flash plus smoke plus debris (single config, three speed bands via spread). */
export const EXPLOSION_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.4, max: 0.8 },
  frequency: 0.008,
  spawnChance: 1,
  particlesPerWave: 8,
  emitterLifetime: 0.25,
  maxParticles: FX_EMITTER_CAPS.explosion,
  pos: { x: 0, y: 0 },
  addAtBack: false,
  emit: false,
  behaviors: [
    alphaFade(),
    scaleFade(1.4, 0.3),
    {
      type: "color",
      config: {
        color: {
          list: [
            { value: "fef3c7", time: 0 },
            { value: "f97316", time: 0.4 },
            { value: "9ca3af", time: 1 },
          ],
        },
      },
    },
    {
      type: "moveSpeed",
      config: { speed: { list: [{ value: 260, time: 0 }, { value: 30, time: 1 }] } },
    },
    { type: "rotationStatic", config: { min: 0, max: 360 } },
    {
      type: "spawnShape",
      config: { type: "torus", data: { x: 0, y: 0, radius: 6 } },
    },
    packTextureRandom(["fx.flash.1", "fx.smoke.2", "fx.fire.0"]),
  ],
};

/**
 * Jet exhaust trail: continuous emission while thrusting. The orange
 * head (fde047 -> f97316) carries the flame body; the trailing gray
 * stop documents the low-fuel smoke wisps the pooled path (spawnJetSmoke)
 * paints at fuelRatio < 0.25, so the Pixi twin reads consistently when
 * the tail fades. The texture roulette wires the committed `particle-pack`
 * flame cards into the jetpack (issue #403); caps and the silent initial
 * state are untouched.
 */
export const JET_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.35, max: 0.55 },
  frequency: 0.016,
  spawnChance: 1,
  particlesPerWave: 3,
  emitterLifetime: -1,
  maxParticles: FX_EMITTER_CAPS.jet,
  pos: { x: 0, y: 0 },
  addAtBack: true,
  emit: false,
  behaviors: [
    alphaFade(),
    scaleFade(1, 0.25),
    {
      type: "color",
      config: {
        color: {
          list: [
            { value: "fde047", time: 0 },
            { value: "f97316", time: 0.6 },
            { value: "9ca3af", time: 1 },
          ],
        },
      },
    },
    {
      type: "moveSpeed",
      config: { speed: { list: [{ value: 130, time: 0 }, { value: 60, time: 1 }] } },
    },
    { type: "rotationStatic", config: { min: 240, max: 300 } },
    { type: "spawnShape", config: { type: "rect", data: { x: -3, y: 0, w: 6, h: 2 } } },
    packTextureRandom(["fx.trail.1", "fx.flame.0", "fx.flame.1"]),
  ],
};

/** Death burst: radial red/orange pop. */
export const DEATH_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.3, max: 0.5 },
  frequency: 0.01,
  spawnChance: 1,
  particlesPerWave: 8,
  emitterLifetime: 0.2,
  maxParticles: FX_EMITTER_CAPS.death,
  pos: { x: 0, y: 0 },
  addAtBack: false,
  emit: false,
  behaviors: [
    alphaFade(),
    scaleFade(1, 0.2),
    {
      type: "color",
      config: {
        color: {
          list: [
            { value: "ffffff", time: 0 },
            { value: "ef4444", time: 0.5 },
            { value: "f97316", time: 1 },
          ],
        },
      },
    },
    {
      type: "moveSpeed",
      config: { speed: { list: [{ value: 240, time: 0 }, { value: 40, time: 1 }] } },
    },
    { type: "rotationStatic", config: { min: 0, max: 360 } },
    { type: "spawnShape", config: { type: "point", data: { x: 0, y: 0 } } },
    packTexture("fx.fire.1"),
  ],
};

/** Pickup sparkle: rising cyan glints. */
export const PICKUP_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.4, max: 0.6 },
  frequency: 0.02,
  spawnChance: 1,
  particlesPerWave: 3,
  emitterLifetime: 0.3,
  maxParticles: FX_EMITTER_CAPS.pickup,
  pos: { x: 0, y: 0 },
  addAtBack: false,
  emit: false,
  behaviors: [
    alphaFade(),
    scaleFade(0.8, 0.1),
    {
      type: "color",
      config: {
        color: {
          list: [
            { value: "ffffff", time: 0 },
            { value: "67e8f9", time: 1 },
          ],
        },
      },
    },
    {
      type: "moveSpeed",
      config: { speed: { list: [{ value: 90, time: 0 }, { value: 20, time: 1 }] } },
    },
    { type: "rotationStatic", config: { min: 0, max: 360 } },
    { type: "spawnShape", config: { type: "point", data: { x: 0, y: 0 } } },
    packTexture("fx.sparkle.1"),
  ],
};
