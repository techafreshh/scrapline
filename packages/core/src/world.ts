// Deterministic 60 Hz simulation stub — the seed of packages/core.
//
// The sim is sacred: this module imports only relative sim modules and
// touches no DOM, Node, clock, or Math.random APIs. All entropy flows
// through the seeded PRNG in ./rng.

import { AIM_STEPS, MOVE_X_QUANT } from "./constants";
import { createRng } from "./rng";

export { TICK_HZ, AIM_STEPS, MOVE_X_QUANT } from "./constants";

export interface WorldInput {
  moveX?: number;
  aim?: number;
  buttons?: number;
}

export interface WorldOptions {
  seed?: number;
}

// The ONLY randomness source in the sim lives in ./rng (createRng).

export function quantizeMoveX(value: number): number {
  const clamped = Math.min(1, Math.max(-1, value));
  return Math.round(clamped / MOVE_X_QUANT) * MOVE_X_QUANT;
}

export function quantizeAim(radians: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = ((radians % twoPi) + twoPi) % twoPi;
  const step = Math.round((wrapped / twoPi) * AIM_STEPS) % AIM_STEPS;
  return (step / AIM_STEPS) * twoPi;
}

export class World {
  tick = 0;
  readonly seed: number;
  private x = 0;
  private readonly marker: number;
  private readonly rng: ReturnType<typeof createRng>;

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? 0;
    this.rng = createRng(this.seed);
    // Prove the seed flows into state: drawn once, covered by hash().
    this.marker = this.rng.nextUint32();
  }

  step(inputs: WorldInput[] = []): string[] {
    const events: string[] = [];
    for (const input of inputs) {
      this.x += quantizeMoveX(input.moveX ?? 0);
    }
    this.tick += 1;
    return events;
  }

  hash(): string {
    const text = `${this.seed}:${this.tick}:${this.x}:${this.marker}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}
