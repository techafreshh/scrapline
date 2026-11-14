// Lazy Pixi-side factory for the six `pixi-v8-particles` emitters whose
// configs live in ./particles-config.ts. Dynamic-imports the library only
// on the Pixi path, keeping the canvas2d fallback and the initial
// main.js chunk free of the emitter code. The pooled circles in
// ./particles.ts stay the probe-visible path on both backends; these
// emitters paint additive glow on top when WebGL survives.

import type { EmitterConfigV3 } from "pixi-v8-particles";
import {
  DEATH_EMITTER_CONFIG,
  EXPLOSION_EMITTER_CONFIG,
  IMPACT_EMITTER_CONFIG,
  JET_EMITTER_CONFIG,
  MUZZLE_EMITTER_CONFIG,
  PICKUP_EMITTER_CONFIG,
} from "./particles-config";

/** Minimal Pixi container surface (structural, no static pixi.js import). */
export interface FxContainerLike {
  addChild(child: unknown): unknown;
}

/** Minimal emitter surface the renderer drives per frame. */
export interface FxEmitterLike {
  update(delta: number): void;
  emit: boolean;
  updateOwnerPos(x: number, y: number): void;
  emitNow(): void;
}

/** Live Pixi-side emitter set (one per effect). */
export interface FxEmitters {
  muzzle: FxEmitterLike;
  impact: FxEmitterLike;
  explosion: FxEmitterLike;
  jet: FxEmitterLike;
  death: FxEmitterLike;
  pickup: FxEmitterLike;
  update(dt: number): void;
}

/**
 * Build the six Pixi emitters under one parent container. Dynamic-imports
 * `pixi-v8-particles` so the canvas2d fallback and node unit tests never
 * pay the import cost; registers every behavior once, then constructs one
 * Emitter per config. Failures reject so the caller keeps the manual pool
 * as the sole path (probes stay green either way).
 */
export async function createFxEmitters(parent: FxContainerLike): Promise<FxEmitters> {
  const lib = await import("pixi-v8-particles");
  const registerAll = (lib as unknown as { registerAllBehaviors?: () => void })
    .registerAllBehaviors;
  if (typeof registerAll === "function") {
    registerAll();
  }
  const EmitterCtor = (lib as unknown as { Emitter: new (p: unknown, c: unknown) => FxEmitterLike })
    .Emitter;
  const make = (config: EmitterConfigV3): FxEmitterLike => {
    const emitter = new EmitterCtor(parent, config);
    emitter.emit = false;
    return emitter;
  };
  const muzzle = make(MUZZLE_EMITTER_CONFIG);
  const impact = make(IMPACT_EMITTER_CONFIG);
  const explosion = make(EXPLOSION_EMITTER_CONFIG);
  const jet = make(JET_EMITTER_CONFIG);
  const death = make(DEATH_EMITTER_CONFIG);
  const pickup = make(PICKUP_EMITTER_CONFIG);
  return {
    muzzle,
    impact,
    explosion,
    jet,
    death,
    pickup,
    update(dt: number): void {
      muzzle.update(dt);
      impact.update(dt);
      explosion.update(dt);
      jet.update(dt);
      death.update(dt);
      pickup.update(dt);
    },
  };
}
