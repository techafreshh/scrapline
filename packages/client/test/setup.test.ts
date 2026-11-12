// Setup model tests: defaults, clamping/fallbacks, storage round-trip,
// and query-string serialization. Mirrors packages/client/test/input.test.ts
// (small local builders, behavior assertions, no padding, no DOM needed).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETUP,
  SETUP_KEYS,
  loadSetup,
  parseSetup,
  saveSetup,
  setupSearchParams,
  type SetupStorage,
} from "../src/setup";

/** In-memory stand-in for localStorage. */
function fakeStorage(entries?: Record<string, string>): SetupStorage {
  const backing = new Map<string, string>(Object.entries(entries ?? {}));
  return {
    getItem: (key: string): string | null =>
      backing.has(key) ? (backing.get(key) as string) : null,
    setItem: (key: string, value: string): void => {
      backing.set(key, value);
    },
  };
}

describe("parseSetup", () => {
  it("falls back to defaults on empty or missing input", () => {
    expect(parseSetup(undefined)).toEqual(DEFAULT_SETUP);
    expect(parseSetup(null)).toEqual(DEFAULT_SETUP);
    expect(parseSetup({})).toEqual(DEFAULT_SETUP);
  });

  it("clamps bot counts into the 1-7 stepper range", () => {
    expect(parseSetup({ bots: 0 }).bots).toBe(1);
    expect(parseSetup({ bots: 8 }).bots).toBe(7);
    expect(parseSetup({ bots: -3 }).bots).toBe(1);
    expect(parseSetup({ bots: 100 }).bots).toBe(7);
    expect(parseSetup({ bots: 5 }).bots).toBe(5);
  });

  it("falls back to 3 bots on non-integer or non-numeric input", () => {
    expect(parseSetup({ bots: Number.NaN }).bots).toBe(3);
    expect(parseSetup({ bots: "5" }).bots).toBe(3);
    expect(parseSetup({ bots: 4.9 }).bots).toBe(4);
  });

  it("falls back to normal/kilima on unknown tier/map strings", () => {
    expect(parseSetup({ tier: "impossible" }).tier).toBe("normal");
    expect(parseSetup({ map: "mars" }).map).toBe("kilima");
    expect(parseSetup({ tier: " HARD ", map: " Dune " })).toEqual({
      bots: 3,
      tier: "hard",
      map: "dune",
    });
  });
});

describe("loadSetup/saveSetup", () => {
  it("returns defaults when storage is empty or absent", () => {
    expect(loadSetup(fakeStorage())).toEqual(DEFAULT_SETUP);
    expect(loadSetup(null)).toEqual(DEFAULT_SETUP);
    expect(loadSetup(undefined)).toEqual(DEFAULT_SETUP);
  });

  it("round-trips the dune hard-5 selection through the three keys", () => {
    const storage = fakeStorage();
    saveSetup(storage, { bots: 5, tier: "hard", map: "dune" });
    expect(storage.getItem(SETUP_KEYS.bots)).toBe("5");
    expect(storage.getItem(SETUP_KEYS.tier)).toBe("hard");
    expect(storage.getItem(SETUP_KEYS.map)).toBe("dune");
    expect(loadSetup(storage)).toEqual({
      bots: 5,
      tier: "hard",
      map: "dune",
    });
  });

  it("ignores corrupt stored values field by field", () => {
    const storage = fakeStorage({
      [SETUP_KEYS.bots]: "banana",
      [SETUP_KEYS.tier]: "hard",
      [SETUP_KEYS.map]: "nowhere",
    });
    expect(loadSetup(storage)).toEqual({
      bots: 3,
      tier: "hard",
      map: "kilima",
    });
  });
});

describe("setupSearchParams", () => {
  it("serializes the chosen config as bots/tier/map query", () => {
    expect(
      setupSearchParams({ bots: 5, tier: "hard", map: "dune" }),
    ).toBe("bots=5&tier=hard&map=dune");
  });
});
