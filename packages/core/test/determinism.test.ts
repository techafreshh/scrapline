import { describe, expect, it } from "vitest";
import { replayHash } from "../src/replay";

describe("determinism", () => {
  it("replays 3600 ticks with seed 42 to identical hashes", () => {
    const first = replayHash(42, 3600);
    const second = replayHash(42, 3600);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
  });

  it("replays 3600 ticks with seed 43 to a different hash", () => {
    const base = replayHash(42, 3600);
    const other = replayHash(43, 3600);
    expect(other).toMatch(/^[0-9a-f]{8}$/);
    expect(other).not.toBe(base);
  });
});
