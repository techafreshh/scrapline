// Glow/shockwave/hurt-pulse effect models: shockwave expansion timing,
// halo geometry, hurt-pulse windowing, and low-quality chromatic
// suppression. Pure module (no DOM, no Pixi), so vitest drives it under
// node like particles.test.ts.
import { describe, expect, it } from "vitest";
import {
  CHROMATIC_ALPHA,
  GLOW_CORE_ALPHA,
  GLOW_HALO_ALPHA,
  GLOW_HALO_OUTER_PX,
  GLOW_HALO_PX,
  HURT_PULSE_MS,
  SHOCKWAVE_MS,
  SHOCKWAVE_R0,
  SHOCKWAVE_R1,
  haloCoreRadius,
  haloOuterRadius,
  haloRadii,
  hurtPulseStrength,
  paintChromaticPulse2D,
  paintChromaticPulsePixi,
  paintGlowHalo2D,
  paintGlowHaloPixi,
  paintShockwaveRing2D,
  paintShockwaveRingPixi,
  shockwaveAlive,
  shockwaveAlphaAt,
  shockwaveRadiusAt,
  spawnShockwave,
  updateShockwaves,
  type FilterPixiGraphics,
  type Shockwave,
} from "../src/fx/filters";

/** Recording Pixi graphics stub (circle/rect/fill/stroke). */
function stubGraphics(): FilterPixiGraphics & {
  circles: { x: number; y: number; r: number }[];
  rects: { x: number; y: number; w: number; h: number }[];
  fills: (number | { color?: number; alpha?: number })[];
  strokes: ({ width?: number; color?: number; alpha?: number } | undefined)[];
} {
  const circles: { x: number; y: number; r: number }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const fills: (number | { color?: number; alpha?: number })[] = [];
  const strokes: ({ width?: number; color?: number; alpha?: number } | undefined)[] = [];
  return {
    circles,
    rects,
    fills,
    strokes,
    circle(x: number, y: number, r: number): unknown {
      circles.push({ x, y, r });
      return undefined;
    },
    rect(x: number, y: number, w: number, h: number): unknown {
      rects.push({ x, y, w, h });
      return undefined;
    },
    fill(style: number | { color?: number; alpha?: number }): unknown {
      fills.push(style);
      return undefined;
    },
    moveTo(): unknown {
      return undefined;
    },
    lineTo(): unknown {
      return undefined;
    },
    stroke(style?: { width?: number; color?: number; alpha?: number }): unknown {
      strokes.push(style);
      return undefined;
    },
  };
}

/** Minimal 2D canvas stub (fill/stroke recording). */
function stubCtx(): {
  ctx: CanvasRenderingContext2D;
  rects: { x: number; y: number; w: number; h: number }[];
  arcs: { x: number; y: number; r: number }[];
  strokes: number;
} {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const arcs: { x: number; y: number; r: number }[] = [];
  let strokes = 0;
  const ctx = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    globalAlpha: 1,
    lineWidth: 1,
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
    },
    beginPath(): void {},
    arc(x: number, y: number, r: number): void {
      arcs.push({ x, y, r });
    },
    fill(): void {},
    stroke(): void {
      strokes += 1;
    },
    moveTo(): void {},
    lineTo(): void {},
  } as unknown as CanvasRenderingContext2D & { strokes: number };
  return {
    ctx,
    rects,
    arcs,
    get strokes(): number {
      return strokes;
    },
  };
}

describe("shockwave expansion", () => {
  it("holds the 10->60px band edges", () => {
    expect(SHOCKWAVE_R0).toBe(10);
    expect(SHOCKWAVE_R1).toBe(60);
    expect(SHOCKWAVE_MS).toBe(500);
  });

  it("expands linearly 10/35/60 at 0/250/500ms, clamped outside", () => {
    const sw: Shockwave = { x: 100, y: 200, startedMs: 1000 };
    expect(shockwaveRadiusAt(sw, 1000)).toBe(10);
    expect(shockwaveRadiusAt(sw, 1250)).toBe(35);
    expect(shockwaveRadiusAt(sw, 1500)).toBe(60);
    // Clamped before spawn and after expiry.
    expect(shockwaveRadiusAt(sw, 900)).toBe(10);
    expect(shockwaveRadiusAt(sw, 1600)).toBe(60);
    expect(shockwaveRadiusAt(sw, Number.NaN)).toBe(10);
  });

  it("is alive only inside the 500ms window", () => {
    const sw: Shockwave = { x: 0, y: 0, startedMs: 500 };
    expect(shockwaveAlive(sw, 499)).toBe(false);
    expect(shockwaveAlive(sw, 500)).toBe(true);
    expect(shockwaveAlive(sw, 999)).toBe(true);
    expect(shockwaveAlive(sw, 1000)).toBe(false);
  });

  it("fades alpha 1->0.4 across the window", () => {
    const sw: Shockwave = { x: 0, y: 0, startedMs: 0 };
    expect(shockwaveAlphaAt(sw, 0)).toBe(1);
    expect(shockwaveAlphaAt(sw, 250)).toBeCloseTo(0.7, 10);
    expect(shockwaveAlphaAt(sw, 500)).toBe(0);
    expect(shockwaveAlphaAt(sw, 600)).toBe(0);
  });

  it("spawns entries and drops them after expiry", () => {
    const out: Shockwave[] = [];
    spawnShockwave(out, 10, 20, 1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ x: 10, y: 20, startedMs: 1000 });
    updateShockwaves(out, 1200);
    expect(out).toHaveLength(1);
    updateShockwaves(out, 1600);
    expect(out).toHaveLength(0);
  });
});

describe("halo geometry", () => {
  it("reaches 6px past the sprite edge with an outer margin", () => {
    expect(GLOW_HALO_PX).toBe(6);
    expect(GLOW_HALO_OUTER_PX).toBeGreaterThan(GLOW_HALO_PX);
    expect(haloCoreRadius(20)).toBe(26);
    expect(haloOuterRadius(20)).toBe(20 + GLOW_HALO_OUTER_PX);
    expect(haloOuterRadius(20)).toBeGreaterThan(haloCoreRadius(20));
  });

  it("scales world-px margins by cam.scale in screen space", () => {
    expect(haloRadii(40, 2)).toEqual({ core: 40 + 12, outer: 40 + 24 });
    expect(haloRadii(40, 1)).toEqual({ core: 46, outer: 52 });
    expect(haloRadii(40, Number.NaN)).toEqual({ core: 46, outer: 52 });
  });

  it("paints a per-kind outer halo over a white-hot core (Pixi)", () => {
    const graphics = stubGraphics();
    paintGlowHaloPixi(graphics, 100, 100, 40, 2, 0x22d3ee);
    expect(graphics.circles).toHaveLength(2);
    // Outer band first (edge color), then the white core.
    expect(graphics.circles[0]?.r).toBeGreaterThan(graphics.circles[1]?.r ?? 0);
    expect(graphics.fills[0]).toMatchObject({
      color: 0x22d3ee,
      alpha: GLOW_HALO_ALPHA,
    });
    expect(graphics.fills[1]).toMatchObject({
      color: 0xffffff,
      alpha: GLOW_CORE_ALPHA,
    });
    // The 6px sample point sits inside the core.
    const core = graphics.circles[1] as { r: number };
    expect(core.r).toBe(40 + GLOW_HALO_PX * 2);
  });

  it("paints the mirrored two-layer halo on canvas2d", () => {
    const stub = stubCtx();
    paintGlowHalo2D(stub.ctx, 100, 100, 40, 2, "#22d3ee");
    expect(stub.arcs).toHaveLength(2);
    expect(stub.arcs[0]?.r).toBeGreaterThan(stub.arcs[1]?.r ?? 0);
    expect(stub.arcs[1]?.r).toBe(40 + GLOW_HALO_PX * 2);
    expect(stub.ctx.globalAlpha).toBe(1);
  });

  it("no-ops on non-finite geometry", () => {
    const graphics = stubGraphics();
    paintGlowHaloPixi(graphics, Number.NaN, 0, 40, 2, 0xffffff);
    paintGlowHaloPixi(graphics, 0, 0, -1, 2, 0xffffff);
    expect(graphics.circles).toHaveLength(0);
    const stub = stubCtx();
    paintGlowHalo2D(stub.ctx, 0, 0, Number.NaN, 2, "#fff");
    expect(stub.arcs).toHaveLength(0);
  });
});

describe("hurt pulse", () => {
  it("holds the 150ms window", () => {
    expect(HURT_PULSE_MS).toBe(150);
  });

  it("is nonzero inside the window and zero outside", () => {
    expect(hurtPulseStrength(1000, 1000)).toBe(1);
    expect(hurtPulseStrength(1074, 1000)).toBeGreaterThan(0);
    expect(hurtPulseStrength(1149, 1000)).toBeGreaterThan(0);
    expect(hurtPulseStrength(1150, 1000)).toBe(0);
    expect(hurtPulseStrength(2000, 1000)).toBe(0);
    expect(hurtPulseStrength(999, 1000)).toBe(0);
    expect(hurtPulseStrength(1000, null)).toBe(0);
    expect(hurtPulseStrength(1000, undefined)).toBe(0);
    expect(hurtPulseStrength(1000, Number.NaN)).toBe(0);
  });

  it("paints the fullscreen wash on high quality only (Pixi)", () => {
    const graphics = stubGraphics();
    expect(paintChromaticPulsePixi(graphics, 640, 360, 1, "high")).toBe(true);
    expect(graphics.rects).toHaveLength(1);
    expect(graphics.rects[0]).toEqual({ x: 0, y: 0, w: 640, h: 360 });
    const painted = graphics.fills[0] as { alpha?: number };
    expect(painted.alpha).toBeCloseTo(CHROMATIC_ALPHA, 10);
    const low = stubGraphics();
    expect(paintChromaticPulsePixi(low, 640, 360, 1, "low")).toBe(false);
    expect(low.rects).toHaveLength(0);
    const spent = stubGraphics();
    expect(paintChromaticPulsePixi(spent, 640, 360, 0, "high")).toBe(false);
    expect(spent.rects).toHaveLength(0);
  });

  it("paints the mirrored wash on canvas2d, nothing on low quality", () => {
    const stub = stubCtx();
    expect(paintChromaticPulse2D(stub.ctx, 640, 360, 1, "high")).toBe(true);
    expect(stub.rects).toHaveLength(1);
    expect(stub.rects[0]).toEqual({ x: 0, y: 0, w: 640, h: 360 });
    expect(stub.ctx.globalAlpha).toBe(1);
    const low = stubCtx();
    expect(paintChromaticPulse2D(low.ctx, 640, 360, 1, "low")).toBe(false);
    expect(low.rects).toHaveLength(0);
    const spent = stubCtx();
    expect(paintChromaticPulse2D(spent.ctx, 640, 360, 0, "high")).toBe(false);
    expect(spent.rects).toHaveLength(0);
  });
});

describe("shockwave ring painters", () => {
  it("strokes a ring on both backends, scaled by cam.scale", () => {
    const graphics = stubGraphics();
    paintShockwaveRingPixi(graphics, 50, 60, 70, 2, 0.8);
    expect(graphics.circles).toHaveLength(1);
    expect(graphics.circles[0]).toEqual({ x: 50, y: 60, r: 70 });
    expect(graphics.strokes).toHaveLength(1);
    expect(graphics.strokes[0]?.width).toBe(6);
    const stub = stubCtx();
    paintShockwaveRing2D(stub.ctx, 50, 60, 70, 2, 0.8);
    expect(stub.arcs).toHaveLength(1);
    expect(stub.arcs[0]).toMatchObject({ x: 50, y: 60, r: 70 });
    expect(stub.strokes).toBe(1);
    expect(stub.ctx.globalAlpha).toBe(1);
  });

  it("no-ops on dead rings and bad geometry", () => {
    const graphics = stubGraphics();
    paintShockwaveRingPixi(graphics, 0, 0, 30, 2, 0);
    paintShockwaveRingPixi(graphics, 0, 0, -5, 2, 1);
    expect(graphics.circles).toHaveLength(0);
    const stub = stubCtx();
    paintShockwaveRing2D(stub.ctx, 0, 0, 30, 2, 0);
    expect(stub.arcs).toHaveLength(0);
  });
});
