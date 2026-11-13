// Per-theme sky grade plus vignette contract: twin stops, channel
// inequalities with >=30 margin, vignette alpha window, null-safe
// lights handling, and full-canvas coverage. Mirrors decor.test.ts
// style without touching the DOM or Pixi.
import { afterEach, describe, expect, it } from "vitest";
import {
  SKY_GRADES,
  skyGradeFor,
} from "../src/view/theme";
import {
  SKY_STEPS,
  VIGNETTE_ALPHA,
  VIGNETTE_BANDS,
  isLightsRespected,
  lerpChannel,
  paintSky2D,
  paintSkyPixi,
  paintVignette2D,
  paintVignettePixi,
  skyColorAt,
  skyCoversViewport,
  skyTopRgb,
  type BackgroundPixiGraphics,
} from "../src/view/background";

/** Recording Pixi graphics stub (rect/fill only). */
function stubGraphics(): BackgroundPixiGraphics & {
  rects: { x: number; y: number; w: number; h: number }[];
  fills: (number | { color?: number; alpha?: number })[];
} {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const fills: (number | { color?: number; alpha?: number })[] = [];
  return {
    rects,
    fills,
    rect(x: number, y: number, w: number, h: number): unknown {
      rects.push({ x, y, w, h });
      return undefined;
    },
    fill(style: number | { color?: number; alpha?: number }): unknown {
      fills.push(style);
      return undefined;
    },
  };
}

/** Minimal 2D canvas stub (gradient + fillRect recording). */
function stubCtx(): {
  ctx: CanvasRenderingContext2D;
  rects: { x: number; y: number; w: number; h: number }[];
  stops: { offset: number; color: string }[];
  gradientArgs: number[] | null;
} {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const stops: { offset: number; color: string }[] = [];
  let gradientArgs: number[] | null = null;
  const ctx = {
    fillStyle: "#000000",
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): unknown {
      gradientArgs = [x0, y0, x1, y1];
      return {
        addColorStop(offset: number, color: string): void {
          stops.push({ offset, color });
        },
      };
    },
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    rects,
    stops,
    get gradientArgs(): number[] | null {
      return gradientArgs;
    },
  };
}

/** True when a recorded rect contains a point. */
function contains(
  rect: { x: number; y: number; w: number; h: number },
  px: number,
  py: number,
): boolean {
  return px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("sky grades", () => {
  it("ships per-theme twin stops (top light, bottom dark)", () => {
    expect(SKY_GRADES.frostbite.top).toBe("#3A7DD5");
    expect(SKY_GRADES.frostbite.bottom).toBe("#0A2540");
    expect(SKY_GRADES.dune.top).toBe("#D98A2B");
    expect(SKY_GRADES.dune.bottom).toBe("#2A1A0A");
    expect(SKY_GRADES.kilima.top).toBe("#5A6B7A");
    expect(SKY_GRADES.kilima.bottom).toBe("#1A2028");
    for (const grade of Object.values(SKY_GRADES)) {
      expect(grade.topHex).toBeGreaterThan(0);
      expect(grade.bottomHex).toBeGreaterThan(0);
      expect(grade.top.toLowerCase()).toBe(
        `#${grade.topHex.toString(16).padStart(6, "0")}`,
      );
      expect(grade.bottom.toLowerCase()).toBe(
        `#${grade.bottomHex.toString(16).padStart(6, "0")}`,
      );
    }
  });

  it("resolves grades tolerantly with a kilima fallback", () => {
    expect(skyGradeFor("DUNE").name).toBe("dune");
    expect(skyGradeFor(" frostbite ").name).toBe("frostbite");
    expect(skyGradeFor("kilima").name).toBe("kilima");
    expect(skyGradeFor("unknown").name).toBe("kilima");
    expect(skyGradeFor(undefined).name).toBe("kilima");
    const first = skyGradeFor("dune");
    const second = skyGradeFor("dune");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("reads a cold-blue frostbite top with >=30 margin", () => {
    const top = skyTopRgb("frostbite");
    expect(top.b).toBeGreaterThan(100);
    expect(top.b).toBeGreaterThan(top.r);
    expect(top.b - top.r).toBeGreaterThanOrEqual(30);
    expect(top.b - 100).toBeGreaterThanOrEqual(30);
  });

  it("reads a warm dune top with >=30 margin", () => {
    const top = skyTopRgb("dune");
    expect(top.r).toBeGreaterThan(150);
    expect(top.r).toBeGreaterThan(top.b);
    expect(top.r - top.b).toBeGreaterThanOrEqual(30);
    expect(top.r - 150).toBeGreaterThanOrEqual(30);
  });

  it("reads a neutral kilima top", () => {
    const top = skyTopRgb("kilima");
    expect(Math.abs(top.r - top.g)).toBeLessThanOrEqual(40);
    expect(Math.abs(top.g - top.b)).toBeLessThanOrEqual(40);
    expect(skyTopRgb("bogus")).toEqual(top);
  });

  it("interpolates top to bottom across t in [0, 1]", () => {
    const grade = skyGradeFor("frostbite");
    expect(skyColorAt(grade, 0)).toEqual(skyTopRgb("frostbite"));
    const bottom = skyColorAt(grade, 1);
    expect(bottom).toEqual({ r: 0x0a, g: 0x25, b: 0x40 });
    const mid = skyColorAt(grade, 0.5);
    expect(mid.r).toBeGreaterThan(bottom.r);
    expect(mid.r).toBeLessThan(skyTopRgb("frostbite").r);
    expect(lerpChannel(0, 100, 0.5)).toBe(50);
    expect(lerpChannel(10, 20, 0)).toBe(10);
    expect(lerpChannel(10, 20, 1)).toBe(20);
  });
});

describe("vignette and lights probes", () => {
  it("holds the rim alpha inside [0.15, 0.35]", () => {
    expect(VIGNETTE_ALPHA).toBe(0.25);
    expect(VIGNETTE_ALPHA).toBeGreaterThanOrEqual(0.15);
    expect(VIGNETTE_ALPHA).toBeLessThanOrEqual(0.35);
  });

  it("respects lights for null, empty, and bogus map shapes", () => {
    expect(isLightsRespected(null)).toBe(true);
    expect(isLightsRespected(undefined)).toBe(true);
    expect(isLightsRespected({})).toBe(true);
    expect(isLightsRespected({ lights: [{ x: 1 }] })).toBe(true);
    expect(isLightsRespected({ decoration: null, decorations: "bogus" })).toBe(true);
    expect(isLightsRespected(42)).toBe(true);
  });

  it("covers the viewport at 640x360 and 1280x720", () => {
    expect(skyCoversViewport(640, 360)).toBe(true);
    expect(skyCoversViewport(1280, 720)).toBe(true);
    expect(skyCoversViewport(0, 360)).toBe(false);
    expect(skyCoversViewport(640, Number.NaN)).toBe(false);
    expect(skyCoversViewport(-1, 720)).toBe(false);
  });
});

describe("sky and vignette painters", () => {
  it("paints SKY_STEPS full-width bands covering 0..h in theme top color", () => {
    for (const name of ["kilima", "dune", "frostbite"] as const) {
      const graphics = stubGraphics();
      paintSkyPixi(graphics, 640, 360, name);
      expect(graphics.rects).toHaveLength(SKY_STEPS);
      let covered = 0;
      for (const rect of graphics.rects) {
        expect(rect.x).toBe(0);
        expect(rect.w).toBe(640);
        covered = Math.max(covered, rect.y + rect.h);
      }
      expect(covered).toBeGreaterThanOrEqual(360);
      const top = skyTopRgb(name);
      const first = graphics.fills[0] as number;
      expect((first >> 16) & 0xff).toBe(top.r);
      expect((first >> 8) & 0xff).toBe(top.g);
      expect(first & 0xff).toBe(top.b);
    }
  });

  it("paints the 2D sky as a top-to-bottom linear gradient", () => {
    const stub = stubCtx();
    paintSky2D(stub.ctx, 640, 360, "dune");
    expect(stub.gradientArgs).toEqual([0, 0, 0, 360]);
    expect(stub.stops).toHaveLength(2);
    expect(stub.stops[0]).toMatchObject({ offset: 0, color: "#D98A2B" });
    expect(stub.stops[1]).toMatchObject({ offset: 1, color: "#2A1A0A" });
    const full = stub.rects.some(
      (rect) => rect.x === 0 && rect.y === 0 && rect.w === 640 && rect.h === 360,
    );
    expect(full).toBe(true);
  });

  it("ramps the vignette to VIGNETTE_ALPHA at the rim, center untouched", () => {
    const graphics = stubGraphics();
    paintVignettePixi(graphics, 640, 360);
    expect(graphics.rects.length).toBeGreaterThan(0);
    const alphas = graphics.fills.map((fill) =>
      typeof fill === "number" ? 1 : (fill.alpha ?? 1),
    );
    expect(Math.max(...alphas)).toBeCloseTo(VIGNETTE_ALPHA, 10);
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...alphas)).toBeLessThan(VIGNETTE_ALPHA);
    // VIGNETTE_BANDS inset bands per side (top/bottom/left/right).
    expect(graphics.rects).toHaveLength(VIGNETTE_BANDS * 4);
    const cx = 320;
    const cy = 180;
    for (const rect of graphics.rects) {
      expect(contains(rect, cx, cy)).toBe(false);
    }
  });

  it("paints the 2D vignette as edge bands with the rim alpha", () => {
    const stub = stubCtx();
    paintVignette2D(stub.ctx, 640, 360);
    expect(stub.rects).toHaveLength(VIGNETTE_BANDS * 4);
    expect(stub.ctx.globalAlpha).toBe(1);
    const cx = 320;
    const cy = 180;
    for (const rect of stub.rects) {
      expect(contains(rect, cx, cy)).toBe(false);
    }
  });

  it("no-ops on non-finite dims", () => {
    const graphics = stubGraphics();
    paintSkyPixi(graphics, 0, 360, "kilima");
    paintSkyPixi(graphics, Number.NaN, 360, "kilima");
    paintVignettePixi(graphics, 640, -1);
    expect(graphics.rects).toHaveLength(0);
    const stub = stubCtx();
    paintSky2D(stub.ctx, 0, 360, "kilima");
    paintVignette2D(stub.ctx, 640, Number.NaN);
    expect(stub.rects).toHaveLength(0);
  });
});
