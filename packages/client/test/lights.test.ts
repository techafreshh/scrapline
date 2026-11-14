// Static additive light pools: per-theme anchors, steady-vs-flicker
// alpha, quality caps, camera culling, and twin Pixi/canvas2d painters.
// Mirrors decor.test.ts/filters.test.ts style with stub graphics/canvas
// contexts (no DOM, no WebGL).
import { describe, expect, it } from "vitest";
import { createCamera } from "../src/renderer/camera";
import {
  LIGHT_CORE_ALPHA,
  LIGHT_FLICKER_MS,
  LIGHT_MID_ALPHA,
  LIGHT_OUTER_ALPHA,
  LIGHT_RADIUS_WORLD,
  LOW_LIGHT_CAP,
  culledLights,
  lightAlphaAt,
  lightsForMap,
  lightsForQuality,
  paintLights2D,
  paintLightsPixi,
  type Light,
  type LightPixiGraphics,
} from "../src/view/lights";

const ARENA_W = 40 * 32;
const ARENA_H = 20 * 32;

/** Warm-pool luminance used to map an alpha swing onto screen luminance. */
const WARM_LUM = 0.299 * 255 + 0.587 * 180 + 0.114 * 107;

/** Recording Pixi graphics stub (circle/fill only). */
function stubGraphics(): LightPixiGraphics & {
  circles: { x: number; y: number; r: number }[];
  fills: { color?: number; alpha?: number }[];
} {
  const circles: { x: number; y: number; r: number }[] = [];
  const fills: { color?: number; alpha?: number }[] = [];
  return {
    circles,
    fills,
    circle(x: number, y: number, r: number): unknown {
      circles.push({ x, y, r });
      return undefined;
    },
    fill(style: number | { color?: number; alpha?: number }): unknown {
      fills.push(typeof style === "number" ? { color: style } : { ...style });
      return undefined;
    },
  };
}

/** Minimal 2D canvas stub (gradient stops, arcs, composite state). */
function stubCtx(): {
  ctx: CanvasRenderingContext2D;
  stops: { offset: number; color: string }[][];
  arcs: { x: number; y: number; r: number }[];
} {
  const stops: { offset: number; color: string }[][] = [];
  const arcs: { x: number; y: number; r: number }[] = [];
  const ctx = {
    fillStyle: "#000000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    createRadialGradient() {
      const gradientStops: { offset: number; color: string }[] = [];
      stops.push(gradientStops);
      return {
        addColorStop(offset: number, color: string): void {
          gradientStops.push({ offset, color });
        },
      };
    },
    beginPath(): void {},
    arc(x: number, y: number, r: number): void {
      arcs.push({ x, y, r });
    },
    fill(): void {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, stops, arcs };
}

/** Alpha channel parsed out of an rgba() stop color. */
function stopAlpha(color: string): number {
  const match = /rgba\(\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\)/.exec(color);
  return match?.[1] === undefined ? Number.NaN : Number(match[1]);
}

const identity =
  (axis: "x" | "y") =>
  (v: number): number =>
    axis === "x" ? v * 2 : v * 2;

describe("static light anchors", () => {
  it("resolves a warm pool set per theme with a copy-on-return registry", () => {
    expect(lightsForMap("kilima")).toHaveLength(4);
    expect(lightsForMap("dune")).toHaveLength(2);
    expect(lightsForMap("frostbite")).toHaveLength(3);
    const first = lightsForMap("kilima");
    const second = lightsForMap("kilima");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    for (const light of [...first, ...lightsForMap("dune"), ...lightsForMap("frostbite")]) {
      expect(light.radiusWorld).toBe(LIGHT_RADIUS_WORLD);
      expect(light.warmCss).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Number.isFinite(light.x)).toBe(true);
      expect(Number.isFinite(light.y)).toBe(true);
    }
  });

  it("keeps kilima/dune steady while frostbite windows flicker", () => {
    for (const light of lightsForMap("kilima")) {
      expect(light.flicker).toBe(false);
    }
    for (const light of lightsForMap("dune")) {
      expect(light.flicker).toBe(false);
    }
    const frostbite = lightsForMap("frostbite");
    expect(frostbite.some((light) => light.flicker)).toBe(true);
  });

  it("falls back to kilima for unknown map names", () => {
    expect(lightsForMap("bogus")).toEqual(lightsForMap("kilima"));
    expect(lightsForMap("  ")).toEqual(lightsForMap("kilima"));
    expect(lightsForMap(undefined)).toEqual(lightsForMap("kilima"));
    expect(lightsForMap(" DUNE ")).toHaveLength(2);
    expect(lightsForMap("FROSTBITE")).toHaveLength(3);
  });
});

describe("light alpha", () => {
  it("holds steady pools at full alpha (zero 1.5s swing)", () => {
    const steady: Light = {
      x: 0,
      y: 0,
      radiusWorld: LIGHT_RADIUS_WORLD,
      warmHex: 0xffb46b,
      warmCss: "#ffb46b",
      flicker: false,
    };
    expect(lightAlphaAt(steady, 0)).toBe(1);
    expect(lightAlphaAt(steady, 1500)).toBe(1);
    expect(Math.abs(lightAlphaAt(steady, 1500) - lightAlphaAt(steady, 0))).toBe(0);
  });

  it("swings flicker pools across a >=8 luminance band between 0/1500ms", () => {
    expect(LIGHT_FLICKER_MS).toBe(2000);
    const flicker: Light = {
      x: 0,
      y: 0,
      radiusWorld: LIGHT_RADIUS_WORLD,
      warmHex: 0xffb46b,
      warmCss: "#ffb46b",
      flicker: true,
    };
    const at0 = lightAlphaAt(flicker, 0);
    const at1500 = lightAlphaAt(flicker, 1500);
    expect(at0).toBeCloseTo(0.55, 10);
    expect(at1500).toBeCloseTo(0.1, 10);
    // Additive swing mapped onto screen luminance clears the flicker floor.
    expect(Math.abs(at1500 - at0) * WARM_LUM).toBeGreaterThanOrEqual(8);
    // Kilima steadiness stays far inside the steady ceiling.
    expect(0 * WARM_LUM).toBeLessThanOrEqual(5);
  });

  it("reads 1 for missing lights and non-finite clocks", () => {
    const flicker: Light = {
      x: 0,
      y: 0,
      radiusWorld: LIGHT_RADIUS_WORLD,
      warmHex: 0xffb46b,
      warmCss: "#ffb46b",
      flicker: true,
    };
    expect(lightAlphaAt(flicker, Number.NaN)).toBe(1);
    expect(lightAlphaAt(null, 500)).toBe(1);
    expect(lightAlphaAt(undefined, 500)).toBe(1);
  });
});

describe("quality cap", () => {
  it("caps low quality at LOW_LIGHT_CAP while high paints all", () => {
    expect(LOW_LIGHT_CAP).toBe(2);
    for (const name of ["kilima", "dune", "frostbite"]) {
      const all = lightsForMap(name);
      expect(lightsForQuality(all, "high")).toHaveLength(all.length);
      expect(lightsForQuality(all, "low")).toHaveLength(Math.min(LOW_LIGHT_CAP, all.length));
      expect(lightsForQuality(all, "low").length).toBeLessThanOrEqual(
        lightsForQuality(all, "high").length,
      );
    }
  });

  it("treats only low variants as low (parseQuality tolerance)", () => {
    const all = lightsForMap("kilima");
    expect(lightsForQuality(all, " LOW ").length).toBe(LOW_LIGHT_CAP);
    expect(lightsForQuality(all, "bogus").length).toBe(all.length);
    expect(lightsForQuality(all, undefined).length).toBe(all.length);
    expect(lightsForQuality(null, "low")).toEqual([]);
  });
});

describe("light culling", () => {
  it("shrinks under a corner camera and keeps the full set when wide", () => {
    for (const name of ["kilima", "dune", "frostbite"]) {
      const all = lightsForMap(name);
      const corner = { ...createCamera(ARENA_W, ARENA_H), x: 160, y: 90 };
      const culled = culledLights(all, corner, 640, 360, ARENA_W, ARENA_H);
      expect(culled.length).toBeLessThan(all.length);
      const wide = { ...createCamera(ARENA_W, ARENA_H), scale: 0.5 };
      expect(culledLights(all, wide, 640, 360, ARENA_W, ARENA_H)).toHaveLength(all.length);
    }
  });

  it("drops non-finite geometry and tolerates missing lists", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    expect(culledLights(null, cam, 640, 360, ARENA_W, ARENA_H)).toEqual([]);
    const bad: Light[] = [
      { x: Number.NaN, y: 0, radiusWorld: 40, warmHex: 0, warmCss: "#ffb46b", flicker: false },
      { x: 640, y: 320, radiusWorld: -1, warmHex: 0, warmCss: "#ffb46b", flicker: false },
    ];
    expect(culledLights(bad, cam, 640, 360, ARENA_W, ARENA_H)).toEqual([]);
  });
});

describe("light painters", () => {
  it("paints core+outer layered circles in Pixi with falling alphas", () => {
    const graphics = stubGraphics();
    const [steady] = lightsForMap("kilima");
    paintLightsPixi(graphics, identity("x"), identity("y"), 2, [steady as Light], 0);
    expect(graphics.circles).toHaveLength(3);
    // Outer pool first, then mid, then the hot core (radii shrink).
    expect(graphics.circles[0]?.r).toBe(LIGHT_RADIUS_WORLD * 2);
    expect(graphics.circles[2]?.r).toBeLessThan(graphics.circles[0]?.r ?? 0);
    const alphas = graphics.fills.map((fill) => fill.alpha ?? 0);
    expect(alphas).toEqual([LIGHT_OUTER_ALPHA, LIGHT_MID_ALPHA, LIGHT_CORE_ALPHA]);
    // A 10px-outside-center sample still sits inside the hot core.
    expect((graphics.circles[2]?.r ?? 0)).toBeGreaterThan(10);
    // An 80px-away sample sits outside the outer pool.
    expect(graphics.circles[0]?.r).toBe(80);
  });

  it("scales flicker alpha into the Pixi fills", () => {
    const graphics = stubGraphics();
    const [window] = lightsForMap("frostbite");
    paintLightsPixi(graphics, identity("x"), identity("y"), 2, [window as Light], 1500);
    expect(graphics.fills[0]?.alpha).toBeCloseTo(LIGHT_OUTER_ALPHA * 0.1, 10);
  });

  it("paints additive radial gradients on canvas2d and restores state", () => {
    const stub = stubCtx();
    const [steady] = lightsForMap("kilima");
    paintLights2D(stub.ctx, identity("x"), identity("y"), 2, [steady as Light], 0);
    expect(stub.arcs).toHaveLength(1);
    expect(stub.arcs[0]?.r).toBe(LIGHT_RADIUS_WORLD * 2);
    expect(stub.stops).toHaveLength(1);
    const gradient = stub.stops[0] ?? [];
    expect(gradient).toHaveLength(3);
    // Near-core stop reads hotter than the mid stop; the edge is clear.
    expect(stopAlpha(gradient[0]?.color ?? "")).toBeGreaterThan(
      stopAlpha(gradient[1]?.color ?? ""),
    );
    expect(stopAlpha(gradient[2]?.color ?? "")).toBe(0);
    expect(stub.ctx.globalCompositeOperation).toBe("source-over");
    expect(stub.ctx.globalAlpha).toBe(1);
  });

  it("no-ops on empty or non-finite input", () => {
    const graphics = stubGraphics();
    paintLightsPixi(graphics, identity("x"), identity("y"), 2, [], 0);
    paintLightsPixi(graphics, identity("x"), identity("y"), 2, null, 0);
    paintLightsPixi(
      graphics,
      identity("x"),
      identity("y"),
      2,
      [{ x: Number.NaN, y: 0, radiusWorld: 40, warmHex: 0, warmCss: "#ffb46b", flicker: false }],
      0,
    );
    expect(graphics.circles).toHaveLength(0);
    const stub = stubCtx();
    paintLights2D(stub.ctx, identity("x"), identity("y"), 2, [], 0);
    paintLights2D(stub.ctx, identity("x"), identity("y"), 2, null, 0);
    expect(stub.arcs).toHaveLength(0);
    expect(stub.ctx.globalCompositeOperation).toBe("source-over");
  });
});
