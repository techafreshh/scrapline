// Per-theme parallax backdrop contract: factors, wrapped offsets,
// luminance profile, painter coverage, and per-theme distinctness.
// Mirrors background.test.ts stub style without touching the DOM or Pixi.
import { afterEach, describe, expect, it } from "vitest";
import { luminanceOfHex, skyGradeFor } from "../src/view/theme";
import { skyTopRgb } from "../src/view/background";
import {
  BACKDROP_PALETTES,
  BACKDROP_SLICE_W,
  backdropOffsetX,
  backdropPaletteFor,
  backdropShiftX,
  backdropThemeFor,
  FAR_PARALLAX,
  FAR_PERIOD,
  HAZE_HEIGHT_FRACTION,
  HAZE_LIFT,
  HAZE_TOP_FRACTION,
  MID_PARALLAX,
  MID_PERIOD,
  TOP_RESERVE_FRACTION,
  backdropLuminanceProfile,
  hazeLiftPasses,
  paintBackdrop2D,
  paintBackdropPixi,
  type BackdropPixiGraphics,
} from "../src/view/backdrop";

/** Recording Pixi graphics stub (rect/fill only). */
function stubGraphics(): BackdropPixiGraphics & {
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

/** Minimal 2D canvas stub (fillRect + fillStyle recording). */
function stubCtx(): {
  ctx: CanvasRenderingContext2D;
  rects: { x: number; y: number; w: number; h: number }[];
  styles: string[];
} {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const styles: string[] = [];
  let current = "#000000";
  const ctx = {
    get fillStyle(): string {
      return current;
    },
    set fillStyle(value: string) {
      current = String(value);
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
      styles.push(current);
    },
    createLinearGradient(): unknown {
      return { addColorStop(): void {} };
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, styles };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("parallax factors and offsets", () => {
  it("pins the fractional camera rates", () => {
    expect(FAR_PARALLAX).toBe(0.2);
    expect(MID_PARALLAX).toBe(0.5);
    expect(HAZE_LIFT).toBe(1.1);
  });

  it("shifts 40px far and 100px mid for a 200px camera move", () => {
    expect(backdropShiftX(0, 200, FAR_PARALLAX, FAR_PERIOD)).toBeCloseTo(40, 10);
    expect(backdropShiftX(0, 200, MID_PARALLAX, MID_PERIOD)).toBeCloseTo(100, 10);
    // Ratios land in the acceptance windows.
    expect(40 / 200).toBeGreaterThanOrEqual(0.15);
    expect(40 / 200).toBeLessThanOrEqual(0.25);
    expect(100 / 200).toBeGreaterThanOrEqual(0.4);
    expect(100 / 200).toBeLessThanOrEqual(0.6);
  });

  it("wraps offsets by positive modulo", () => {
    expect(backdropOffsetX(0, FAR_PARALLAX, FAR_PERIOD)).toBe(0);
    // Negative cam side stays in [0, period).
    const neg = backdropOffsetX(-200, FAR_PARALLAX, FAR_PERIOD);
    expect(neg).toBeGreaterThanOrEqual(0);
    expect(neg).toBeLessThan(FAR_PERIOD);
    expect(neg).toBeCloseTo(40, 10);
    // Wrap seam: one full period of camera travel returns to the seam.
    const seam = backdropOffsetX(FAR_PERIOD / FAR_PARALLAX, FAR_PARALLAX, FAR_PERIOD);
    expect(seam).toBeCloseTo(0, 10);
    // Period-sized shift is seamless (minimal distance 0).
    expect(backdropShiftX(0, FAR_PERIOD / FAR_PARALLAX, FAR_PARALLAX, FAR_PERIOD)).toBeCloseTo(
      0,
      10,
    );
    // Non-finite inputs read 0, never NaN.
    expect(backdropOffsetX(Number.NaN, FAR_PARALLAX, FAR_PERIOD)).toBe(0);
    expect(backdropOffsetX(10, FAR_PARALLAX, 0)).toBe(0);
    expect(backdropOffsetX(10, FAR_PARALLAX, -4)).toBe(0);
  });
});

describe("luminance profile", () => {
  it("decreases top to mid then lifts the haze by >=10%", () => {
    for (const name of ["kilima", "dune", "frostbite"] as const) {
      const profile = backdropLuminanceProfile(name);
      expect(profile.theme).toBe(name);
      expect(profile.top).toBeGreaterThan(profile.far);
      expect(profile.far).toBeGreaterThan(profile.mid);
      expect(profile.haze / profile.mid).toBeGreaterThanOrEqual(HAZE_LIFT);
      expect(hazeLiftPasses(name)).toBe(true);
      // Spot-check the Rec.601 helper agrees with the palette entries.
      expect(profile.far).toBeCloseTo(luminanceOfHex(BACKDROP_PALETTES[name].farHex), 10);
      expect(profile.mid).toBeCloseTo(luminanceOfHex(BACKDROP_PALETTES[name].midHex), 10);
    }
  });

  it("keeps every haze lift above the 1.10 floor", () => {
    expect(hazeLiftPasses("kilima")).toBe(true);
    expect(hazeLiftPasses("dune")).toBe(true);
    expect(hazeLiftPasses("frostbite")).toBe(true);
  });
});

describe("theme resolution", () => {
  it("falls back to kilima tolerantly", () => {
    expect(backdropThemeFor("DUNE")).toBe("dune");
    expect(backdropThemeFor(" frostbite ")).toBe("frostbite");
    expect(backdropThemeFor("bogus")).toBe("kilima");
    expect(backdropThemeFor(undefined)).toBe("kilima");
    expect(backdropPaletteFor("bogus").name).toBe("kilima");
    expect(backdropPaletteFor(undefined).farHex).toBe(BACKDROP_PALETTES.kilima.farHex);
    const first = backdropPaletteFor("dune");
    const second = backdropPaletteFor("dune");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("ships distinct per-theme palettes and seeds", () => {
    expect(BACKDROP_PALETTES.frostbite.farHex).not.toBe(BACKDROP_PALETTES.kilima.farHex);
    expect(BACKDROP_PALETTES.frostbite.midHex).not.toBe(BACKDROP_PALETTES.kilima.midHex);
    expect(BACKDROP_PALETTES.frostbite.hazeHex).not.toBe(BACKDROP_PALETTES.kilima.hazeHex);
    expect(BACKDROP_PALETTES.frostbite.seed).not.toBe(BACKDROP_PALETTES.kilima.seed);
    expect(BACKDROP_PALETTES.dune.seed).not.toBe(BACKDROP_PALETTES.kilima.seed);
  });
});

describe("backdrop painters", () => {
  it("paints a full-width haze band at 62-72% height", () => {
    for (const name of ["kilima", "dune", "frostbite"] as const) {
      const graphics = stubGraphics();
      paintBackdropPixi(graphics, 0, 320, 640, 360, name);
      const palette = BACKDROP_PALETTES[name];
      const hazeIdx = graphics.fills.findIndex((fill) => fill === palette.hazeHex);
      expect(hazeIdx).toBeGreaterThanOrEqual(0);
      const hazeRect = graphics.rects[hazeIdx];
      expect(hazeRect.x).toBe(0);
      expect(hazeRect.w).toBe(640);
      expect(hazeRect.y).toBeCloseTo(360 * HAZE_TOP_FRACTION, 0);
      expect(hazeRect.h).toBeCloseTo(360 * HAZE_HEIGHT_FRACTION + 1, 0);
      expect(hazeRect.y / 360).toBeGreaterThanOrEqual(0.6);
      expect((hazeRect.y + hazeRect.h) / 360).toBeLessThanOrEqual(0.75);
    }
  });

  it("keeps the top strip as pure sky (first fill is the sky top stop)", () => {
    for (const name of ["kilima", "dune", "frostbite"] as const) {
      const graphics = stubGraphics();
      paintBackdropPixi(graphics, 0, 320, 640, 360, name);
      const top = skyTopRgb(name);
      const first = graphics.fills[0] as number;
      expect((first >> 16) & 0xff).toBe(top.r);
      expect((first >> 8) & 0xff).toBe(top.g);
      expect(first & 0xff).toBe(top.b);
      // No silhouette column starts inside the reserve (peaks below 15%).
      const reserve = 360 * TOP_RESERVE_FRACTION;
      const grade = skyGradeFor(name);
      void grade;
      for (let i = 0; i < graphics.rects.length; i += 1) {
        const fill = graphics.fills[i];
        const rect = graphics.rects[i];
        if (fill === BACKDROP_PALETTES[name].farHex || fill === BACKDROP_PALETTES[name].midHex) {
          expect(rect.y).toBeGreaterThanOrEqual(reserve - 1);
        }
      }
    }
  });

  it("tiles ridgelines across the canvas width", () => {
    const graphics = stubGraphics();
    paintBackdropPixi(graphics, 0, 320, 640, 360, "kilima");
    let covered = 0;
    for (const rect of graphics.rects) {
      covered = Math.max(covered, rect.x + rect.w);
    }
    expect(covered).toBeGreaterThanOrEqual(640);
    // Stepped columns use the slice lattice.
    const slices = graphics.rects.filter(
      (rect, i) =>
        graphics.fills[i] === BACKDROP_PALETTES.kilima.farHex && rect.w === BACKDROP_SLICE_W + 1,
    );
    expect(slices.length).toBeGreaterThan(0);
  });

  it("shifts far and mid columns with the camera", () => {
    const before = stubGraphics();
    const after = stubGraphics();
    paintBackdropPixi(before, 0, 320, 640, 360, "kilima");
    paintBackdropPixi(after, 200, 320, 640, 360, "kilima");
    const farBefore = before.rects
      .filter((rect, i) => before.fills[i] === BACKDROP_PALETTES.kilima.farHex)
      .map((rect) => `${rect.x}:${Math.round(rect.y)}:${Math.round(rect.h)}`);
    const farAfter = after.rects
      .filter((rect, i) => after.fills[i] === BACKDROP_PALETTES.kilima.farHex)
      .map((rect) => `${rect.x}:${Math.round(rect.y)}:${Math.round(rect.h)}`);
    expect(farBefore).not.toEqual(farAfter);
    const midBefore = before.rects
      .filter((rect, i) => before.fills[i] === BACKDROP_PALETTES.kilima.midHex)
      .map((rect) => `${rect.x}:${Math.round(rect.y)}:${Math.round(rect.h)}`);
    const midAfter = after.rects
      .filter((rect, i) => after.fills[i] === BACKDROP_PALETTES.kilima.midHex)
      .map((rect) => `${rect.x}:${Math.round(rect.y)}:${Math.round(rect.h)}`);
    expect(midBefore).not.toEqual(midAfter);
  });

  it("paints distinct fills per theme on both backends", () => {
    const kilimaPixi = stubGraphics();
    const frostPixi = stubGraphics();
    paintBackdropPixi(kilimaPixi, 0, 320, 640, 360, "kilima");
    paintBackdropPixi(frostPixi, 0, 320, 640, 360, "frostbite");
    expect(kilimaPixi.fills).not.toEqual(frostPixi.fills);
    const kilima2D = stubCtx();
    const frost2D = stubCtx();
    paintBackdrop2D(kilima2D.ctx, 0, 320, 640, 360, "kilima");
    paintBackdrop2D(frost2D.ctx, 0, 320, 640, 360, "frostbite");
    expect(kilima2D.styles).not.toEqual(frost2D.styles);
    // Haze fills differ across themes on both painters.
    expect(kilimaPixi.fills).toContain(BACKDROP_PALETTES.kilima.hazeHex);
    expect(frostPixi.fills).toContain(BACKDROP_PALETTES.frostbite.hazeHex);
    expect(kilima2D.styles).toContain(BACKDROP_PALETTES.kilima.hazeCss);
    expect(frost2D.styles).toContain(BACKDROP_PALETTES.frostbite.hazeCss);
  });

  it("paints the 2D haze band full-width at the expected fraction", () => {
    const stub = stubCtx();
    paintBackdrop2D(stub.ctx, 0, 320, 640, 360, "dune");
    const hazeIdx = stub.styles.findIndex((style) => style === BACKDROP_PALETTES.dune.hazeCss);
    expect(hazeIdx).toBeGreaterThanOrEqual(0);
    const hazeRect = stub.rects[hazeIdx];
    expect(hazeRect.x).toBe(0);
    expect(hazeRect.w).toBe(640);
    expect(hazeRect.y).toBeCloseTo(360 * HAZE_TOP_FRACTION, 0);
    // 2D painter restores the caller's fillStyle.
    expect(stub.ctx.fillStyle).toBe("#000000");
  });

  it("falls back to kilima fills for unknown themes", () => {
    const bogus = stubGraphics();
    const kilima = stubGraphics();
    paintBackdropPixi(bogus, 0, 320, 640, 360, "bogus-theme");
    paintBackdropPixi(kilima, 0, 320, 640, 360, "kilima");
    expect(bogus.fills).toEqual(kilima.fills);
    expect(bogus.rects).toEqual(kilima.rects);
  });

  it("no-ops on non-finite dims", () => {
    const graphics = stubGraphics();
    paintBackdropPixi(graphics, 0, 0, 0, 360, "kilima");
    paintBackdropPixi(graphics, 0, 0, Number.NaN, 360, "kilima");
    paintBackdropPixi(graphics, 0, 0, 640, -1, "kilima");
    expect(graphics.rects).toHaveLength(0);
    const stub = stubCtx();
    paintBackdrop2D(stub.ctx, 0, 0, 0, 360, "kilima");
    paintBackdrop2D(stub.ctx, 0, 0, 640, Number.NaN, "kilima");
    expect(stub.rects).toHaveLength(0);
  });
});
