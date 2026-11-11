// Deterministic 60 Hz simulation stub — the seed of packages/core.
//
// The sim is sacred: this module imports nothing and touches no DOM, Node,
// clock, or Math.random APIs. All entropy flows through the seeded PRNG below.

import { AIM_STEPS, MOVE_X_QUANT } from "./constants";

export { TICK_HZ, AIM_STEPS, MOVE_X_QUANT } from "./constants";

export interface WorldInput {
  moveX?: number;
  aim?: number;
  buttons?: number;
}

export interface WorldOptions {
  seed?: number;
}

// The ONLY randomness source in the sim: mulberry32 with derived streams.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  private readonly prng: () => number;

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? 0;
    this.prng = mulberry32(this.seed);
    // Prove the seed flows into state: drawn once, covered by hash().
    this.marker = Math.floor(this.prng() * 0xffffffff);
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
