import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng";

describe("createRng determinism", () => {
  it("produces byte-identical 1000-draw sequences for identical seeds", () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 1000; i += 1) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it("produces differing first draws for different seeds", () => {
    expect(createRng(1234).nextUint32()).not.toBe(createRng(999).nextUint32());
  });
});

describe("fork derived streams", () => {
  it("matches for the same label and diverges for different labels", () => {
    const parentA = createRng(1234);
    const parentB = createRng(1234);
    const botA = parentA.fork("bot");
    const botB = parentB.fork("bot");
    const fx = parentA.fork("fx");
    let differs = false;
    for (let i = 0; i < 100; i += 1) {
      const x = botA.nextUint32();
      const y = botB.nextUint32();
      expect(x).toBe(y);
      if (fx.nextUint32() !== x) {
        differs = true;
      }
    }
    expect(differs).toBe(true);
  });

  it("leaves the parent sequence unchanged across fork calls", () => {
    const plain = createRng(1234);
    const forking = createRng(1234);
    for (let i = 0; i < 50; i += 1) {
      forking.fork("bot");
      forking.fork("fx");
      expect(forking.nextUint32()).toBe(plain.nextUint32());
    }
    expect(forking.fork("bot").nextUint32()).toBe(forking.fork("bot").nextUint32());
  });
});
