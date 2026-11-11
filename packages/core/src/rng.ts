// Seeded PRNG — the single entropy source for the sim.
//
// The sim is sacred: this module is pure (no DOM, Node, clock, or
// Math.random). All simulation entropy flows through createRng below.

export interface Rng {
  /** Canonical uint32 draw in [0, 2^32); advances state by exactly one step. */
  nextUint32(): number;
  /** Same-draw alias for nextUint32. */
  nextU32(): number;
  /** Float draw in [0, 1) from the same single step. */
  next(): number;
  /** Derived child stream for a label; pure and order-independent. */
  fork(label: string): Rng;
}

function fnv1a32(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const rootSeed = seed >>> 0;
  let a = rootSeed;

  function step(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) >>> 0;
  }

  const rng: Rng = {
    nextUint32(): number {
      return step();
    },
    nextU32(): number {
      return step();
    },
    next(): number {
      return step() / 4294967296;
    },
    fork(label: string): Rng {
      const childSeed = Math.imul(rootSeed ^ fnv1a32(label), 0x01000193) >>> 0;
      return createRng(childSeed);
    },
  };
  return rng;
}
