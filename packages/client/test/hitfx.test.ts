// Hit-feedback fx: spark/burst spawn counts, caps, TTL expiry, victim
// tint helpers, kill-feed flash, and the crosshair hitmarker. Pure
// spawner/aging helpers plus fake-doc DOM checks (node, no jsdom).
import { describe, expect, it } from "vitest";
import type { DamageDetail, KillDetail } from "../../core/src/events";
import {
  BURST_PER_KILL,
  MAX_BURSTS,
  MAX_SPARKS,
  SPARKS_PER_HIT,
  SPARK_TTL,
  VICTIM_TTL,
  VICTIM_TINT,
  VICTIM_TINT_CSS,
  ageHitFx,
  burstPosition,
  playerPaintColor,
  playerPaintCss,
  spawnBursts,
  spawnSparks,
  tracerOpacity,
  type Burst,
  type Spark,
} from "../src/renderer/index";
import {
  CROSSHAIR_HIT_MS as CROSSHAIR_MS,
  KILLFEED_FLASH_MS as KILLFEED_MS,
  flashCrosshair as flashCrosshairHud,
  pushKillfeed as pushKillfeedHud,
  type HudHandles,
} from "../src/hud/hud";

function damageAt(x: number, y: number): DamageDetail {
  return { victim: 1, victimId: 1, x, y, shooter: 0, shooterId: 0 };
}

function killAt(x: number, y: number): KillDetail {
  return { victim: 1, victimId: 1, killerId: 0, weapon: null, x, y };
}

describe("spawnSparks", () => {
  it("spawns SPARKS_PER_HIT sparks within 24px of the hit point", () => {
    expect(SPARKS_PER_HIT).toBeGreaterThanOrEqual(3);
    const sparks: Spark[] = [];
    spawnSparks(sparks, [damageAt(100, 200)]);
    expect(sparks).toHaveLength(SPARKS_PER_HIT);
    for (const spark of sparks) {
      expect(Math.hypot(spark.x - 100, spark.y - 200)).toBeLessThanOrEqual(24);
      expect(spark.ttl).toBe(SPARK_TTL);
      expect(spark.life).toBe(SPARK_TTL);
    }
  });

  it("caps sustained damage at MAX_SPARKS, oldest dropped first", () => {
    const sparks: Spark[] = [];
    const damages: DamageDetail[] = [];
    for (let i = 0; i < 40; i += 1) {
      damages.push(damageAt(i, 0));
    }
    spawnSparks(sparks, damages);
    expect(sparks).toHaveLength(MAX_SPARKS);
  });

  it("fades sparks through tracerOpacity to zero", () => {
    const sparks: Spark[] = [];
    spawnSparks(sparks, [damageAt(0, 0)]);
    // One draw ages the fresh spark (the trackDraw spawn-then-age order).
    ageHitFx(sparks, [], new Map());
    const first = sparks[0];
    expect(tracerOpacity(first)).toBeLessThan(1);
    expect(tracerOpacity(first)).toBeGreaterThan(0);
  });
});

describe("spawnBursts", () => {
  it("spawns BURST_PER_KILL particles per kill detail", () => {
    expect(BURST_PER_KILL).toBeGreaterThanOrEqual(8);
    const bursts: Burst[] = [];
    spawnBursts(bursts, [killAt(50, 60)]);
    expect(bursts).toHaveLength(BURST_PER_KILL);
    for (const burst of bursts) {
      expect(burst.x).toBe(50);
      expect(burst.y).toBe(60);
      expect(burst.ttl).toBeGreaterThan(0);
    }
  });

  it("integrates radial velocity into the draw position over time", () => {
    const bursts: Burst[] = [];
    spawnBursts(bursts, [killAt(50, 60)]);
    const burst = bursts[0];
    const start = burstPosition(burst);
    expect(start.x).toBe(50);
    expect(start.y).toBe(60);
    burst.ttl -= 1;
    const moved = burstPosition(burst);
    expect(Math.hypot(moved.x - 50, moved.y - 60)).toBeGreaterThan(0);
  });

  it("caps kill bursts at MAX_BURSTS", () => {
    const bursts: Burst[] = [];
    const kills: KillDetail[] = [];
    for (let i = 0; i < 20; i += 1) {
      kills.push(killAt(i, 0));
    }
    spawnBursts(bursts, kills);
    expect(bursts).toHaveLength(MAX_BURSTS);
  });
});

describe("ageHitFx", () => {
  it("drains every spark and burst within 30 draws", () => {
    const sparks: Spark[] = [];
    const bursts: Burst[] = [];
    spawnSparks(sparks, [damageAt(0, 0)]);
    spawnBursts(bursts, [killAt(0, 0)]);
    const victimFlash = new Map<number, number>([[1, VICTIM_TTL]]);
    for (let i = 0; i < 30; i += 1) {
      ageHitFx(sparks, bursts, victimFlash);
    }
    expect(sparks).toHaveLength(0);
    expect(bursts).toHaveLength(0);
    expect(victimFlash.has(1)).toBe(false);
  });

  it("ticks victim tint down and drops it after VICTIM_TTL draws", () => {
    const victimFlash = new Map<number, number>([[1, VICTIM_TTL]]);
    for (let i = 0; i < VICTIM_TTL - 1; i += 1) {
      ageHitFx([], [], victimFlash);
      expect(victimFlash.has(1)).toBe(true);
    }
    ageHitFx([], [], victimFlash);
    expect(victimFlash.has(1)).toBe(false);
  });
});

describe("victim tint", () => {
  it("reads 0xFF0000 while flashing and restores after expiry", () => {
    expect(VICTIM_TINT).toBe(0xff0000);
    expect(VICTIM_TINT_CSS).toBe("#ff0000");
    expect(playerPaintColor(1, true, true)).toBe(0xff0000);
    expect(playerPaintCss(1, true, true)).toBe("#ff0000");
    // Unflashed players keep their role colors.
    expect(playerPaintColor(0, true, false)).not.toBe(0xff0000);
    expect(playerPaintColor(1, true, false)).not.toBe(0xff0000);
    expect(playerPaintCss(1, true, false)).not.toBe("#ff0000");
  });
});

/** Minimal fake killfeed entry tracking its class list. */
function fakeEntry(): {
  el: {
    classNames: Set<string>;
    textContent: string;
    classList: { remove(c: string): void };
    setAttribute(k: string, v: string): void;
  };
} {
  const classNames = new Set<string>();
  return {
    el: {
      classNames,
      textContent: "",
      classList: {
        remove(c: string): void {
          classNames.delete(c);
        },
      },
      setAttribute(k: string, v: string): void {
        if (k === "class") {
          for (const part of v.split(" ")) {
            classNames.add(part);
          }
        }
      },
    },
  };
}

describe("pushKillfeed flash", () => {
  it("latest entry carries flash, removed on the timer under 1s", () => {
    expect(KILLFEED_MS).toBeLessThan(1000);
    const timers: Array<() => void> = [];
    const entries: Array<ReturnType<typeof fakeEntry>["el"]> = [];
    const feed = {
      ownerDocument: {
        defaultView: {
          setTimeout: (fn: () => void): number => {
            timers.push(fn);
            return timers.length;
          },
        },
        createElement: (): ReturnType<typeof fakeEntry>["el"] => {
          const entry = fakeEntry().el;
          return entry;
        },
      },
      children: entries,
      appendChild(e: ReturnType<typeof fakeEntry>["el"]): void {
        entries.push(e);
      },
      removeChild(e: ReturnType<typeof fakeEntry>["el"]): void {
        entries.splice(entries.indexOf(e), 1);
      },
    };
    const handles = { killfeed: feed } as unknown as HudHandles;
    pushKillfeedHud(handles, "You", "Bot 1");
    expect(entries).toHaveLength(1);
    expect(entries[0].classNames.has("flash")).toBe(true);
    expect(entries[0].classNames.has("kill-entry")).toBe(true);
    // Flash pop, 6s hold, then fade + removal: three timers per entry.
    expect(timers).toHaveLength(3);
    timers[0]();
    expect(entries[0].classNames.has("flash")).toBe(false);
    expect(entries[0].classNames.has("kill-entry")).toBe(true);
    expect(entries).toHaveLength(1);
    timers[1]();
    timers[2]();
    expect(entries).toHaveLength(0);
  });
});

describe("flashCrosshair", () => {
  it("adds hit and removes it on the timer (default 100-400ms)", () => {
    expect(CROSSHAIR_MS).toBeGreaterThanOrEqual(100);
    expect(CROSSHAIR_MS).toBeLessThanOrEqual(400);
    const classNames = new Set<string>();
    const timers: Array<() => void> = [];
    const doc = {
      getElementById: (): unknown => ({
        classList: {
          add: (c: string): void => {
            classNames.add(c);
          },
          remove: (c: string): void => {
            classNames.delete(c);
          },
        },
      }),
      defaultView: {
        setTimeout: (fn: () => void): number => {
          timers.push(fn);
          return timers.length;
        },
      },
    } as unknown as Document;
    flashCrosshairHud(doc);
    expect(classNames.has("hit")).toBe(true);
    expect(timers).toHaveLength(1);
    for (const timer of timers) {
      timer();
    }
    expect(classNames.has("hit")).toBe(false);
  });

  it("is a no-op without a crosshair element", () => {
    const doc = {
      getElementById: (): unknown => null,
      defaultView: null,
    } as unknown as Document;
    expect(() => flashCrosshairHud(doc)).not.toThrow();
  });
});
