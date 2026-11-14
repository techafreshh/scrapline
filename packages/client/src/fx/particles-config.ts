// Pixi `pixi-v8-particles` (v8-native particle-emitter) configs for the
// six combat effects. Pure JSON (empty-string textures substitute
// Texture.WHITE inside the library), so unit tests import them under
// node without touching WebGL. The lazy factory lives in
// ./emitters.ts and dynamic-imports the library only on the Pixi path,
// keeping the canvas2d fallback and the initial main.js chunk free of
// the emitter code.
//
// Caps: every config carries maxParticles; the six emitters sum to 412
// live particles worst-case, inside the 512 pooled cap, so fill rate
// stays flat and the 1280x720 fps guardrail holds.

import type { EmitterConfigV3 } from "pixi-v8-particles";

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

/** Blank texture entry: the library substitutes Texture.WHITE. */
function whiteTexture(): { type: string; config: unknown } {
  return { type: "textureSingle", config: { texture: "" } };
}

/** Muzzle flash: one-shot bright burst at the barrel tip. */
export const MUZZLE_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.18, max: 0.3 },
  frequency: 0.01,
  spawnChance: 1,
  particlesPerWave: 6,
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
    whiteTexture(),
  ],
};

/** Impact sparks: surface-tinted burst (tint applied at spawn via color behavior override). */
export const IMPACT_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.15, max: 0.3 },
  frequency: 0.01,
  spawnChance: 1,
  particlesPerWave: 6,
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
    whiteTexture(),
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
    whiteTexture(),
  ],
};

/** Jet exhaust trail: continuous emission while thrusting. */
export const JET_EMITTER_CONFIG: EmitterConfigV3 = {
  lifetime: { min: 0.35, max: 0.55 },
  frequency: 0.016,
  spawnChance: 1,
  particlesPerWave: 2,
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
            { value: "f97316", time: 1 },
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
    whiteTexture(),
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
    whiteTexture(),
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
    whiteTexture(),
  ],
};
