// Ambient particle beds: per-theme emitters behind gameplay with a low
// quality guard. Pure bed model (no DOM, no Pixi), so vitest drives the
// issue #208 acceptance contract under node: frostbite snowfall holds
// >= 20 motes, low quality clears the bed, and a kilima bird crosses
// the screen mid-band within 5s.
import { describe, expect, it } from "vitest";
import {
  AMBIENT_BIRD_CAP,
  AMBIENT_MOTE_CAP,
  AMBIENT_SNOW_PER_DRAW,
  AURORA_SHIMMER_AMP,
  AURORA_SHIMMER_BASE,
  AURORA_SHIMMER_PERIOD_MS,
  ambientBirdCount,
  ambientEnabled,
  ambientHash01,
  ambientMoteCount,
  ambientThemeFor,
  auroraShimmerAlpha,
  createAmbientBed,
  paintAmbient2D,
  paintAmbientPixi,
  updateAmbientBed,
  type AmbientPixiGraphics,
  type AmbientProject,
} from "../src/ambient/beds";

/** Live camera view over a 640x360 backing store at zoom 2. */
const VIEW = { camX: 640, camY: 300, viewW: 320, viewH: 180 };

/** Screen projection for the fixed camera (mirrors projectCamera). */
function projectFor(camX: number, camY: number): AmbientProject {
  return (x: number, y: number) => ({
    x: (x - camX) * 2 + 320,
    y: (y - camY) * 2 + 180,
  });
}

/** Recording Pixi graphics stub (rect/fill). */
function stubGraphics(): AmbientPixiGraphics & {
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

/** Minimal 2D canvas stub (fillRect/fill recording). */
function stubCtx(): {
  ctx: CanvasRenderingContext2D;
  rects: { x: number; y: number; w: number; h: number }[];
} {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: "#000000",
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects };
}

function stepHigh(
  theme: "kilima" | "dune" | "frostbite",
  draws: number,
  cam = VIEW,
): ReturnType<typeof createAmbientBed> {
  const bed = createAmbientBed();
  for (let tick = 0; tick < draws; tick += 1) {
    updateAmbientBed(bed, {
      theme,
      quality: "high",
      tick,
      camX: cam.camX,
      camY: cam.camY,
      viewW: cam.viewW,
      viewH: cam.viewH,
    });
  }
  return bed;
}

describe("ambientThemeFor", () => {
  it("resolves the three arenas tolerantly and falls back to kilima", () => {
    expect(ambientThemeFor("frostbite")).toBe("frostbite");
    expect(ambientThemeFor("DUNE")).toBe("dune");
    expect(ambientThemeFor(" kilima ")).toBe("kilima");
    expect(ambientThemeFor("bogus")).toBe("kilima");
    expect(ambientThemeFor(undefined)).toBe("kilima");
    expect(ambientThemeFor(null)).toBe("kilima");
  });
});

describe("ambientEnabled", () => {
  it("reads low only on low variants, high everywhere else", () => {
    expect(ambientEnabled("low")).toBe(false);
    expect(ambientEnabled("LOW")).toBe(false);
    expect(ambientEnabled(" low ")).toBe(false);
    expect(ambientEnabled("high")).toBe(true);
    expect(ambientEnabled(undefined)).toBe(true);
    expect(ambientEnabled("bogus")).toBe(true);
  });
});

describe("frostbite snowfall", () => {
  it("holds >= 20 motes after 2s (120 draws) of high-quality snow", () => {
    const bed = stepHigh("frostbite", 120);
    expect(ambientMoteCount(bed)).toBeGreaterThanOrEqual(20);
  });

  it("spawns near-white flakes that stay inside the mote cap", () => {
    const bed = stepHigh("frostbite", 200);
    expect(ambientMoteCount(bed)).toBeLessThanOrEqual(AMBIENT_MOTE_CAP);
    expect(ambientMoteCount(bed)).toBeGreaterThan(100);
    for (const mote of bed.motes) {
      expect(mote.kind).toBe("snow");
      expect(mote.css).toBe("#f8fafc");
      expect(mote.ttl).toBeGreaterThan(0);
    }
  });

  it("falls downward and reaches steady state within the 2s window", () => {
    const early = stepHigh("frostbite", 30);
    const late = stepHigh("frostbite", 120);
    expect(ambientMoteCount(late)).toBeGreaterThanOrEqual(
      ambientMoteCount(early),
    );
    const bed = createAmbientBed();
    updateAmbientBed(bed, { theme: "frostbite", quality: "high", tick: 0, ...VIEW });
    const first = bed.motes[0];
    expect(first?.vy).toBeGreaterThan(0);
    void AMBIENT_SNOW_PER_DRAW;
  });
});

describe("kilima dust and birds", () => {
  it("drifts dust motes on high quality", () => {
    const bed = stepHigh("kilima", 120);
    expect(ambientMoteCount(bed)).toBeGreaterThan(0);
    for (const mote of bed.motes) {
      expect(mote.kind).toBe("dust");
    }
  });

  it("cruises a bird pair that crosses the screen mid-band within 5s", () => {
    const bed = createAmbientBed();
    const project = projectFor(VIEW.camX, VIEW.camY);
    let minX = Infinity;
    let maxX = -Infinity;
    let midBandY = false;
    for (let tick = 0; tick < 300; tick += 1) {
      updateAmbientBed(bed, {
        theme: "kilima",
        quality: "high",
        tick,
        ...VIEW,
      });
      expect(ambientBirdCount(bed)).toBeLessThanOrEqual(AMBIENT_BIRD_CAP);
      for (const bird of bed.birds) {
        const s = project(bird.x, bird.y);
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        // Mid-band: middle third of the 640x360 backing store.
        if (s.y >= 120 && s.y <= 240) {
          midBandY = true;
        }
      }
    }
    expect(ambientBirdCount(bed)).toBeGreaterThanOrEqual(1);
    // At least one bird swept across the horizontal center (x = 320).
    expect(minX).toBeLessThan(320);
    expect(maxX).toBeGreaterThan(320);
    expect(midBandY).toBe(true);
  });

  it("paints birds as dark paired ticks on both backends", () => {
    const bed = stepHigh("kilima", 10);
    expect(ambientBirdCount(bed)).toBeGreaterThan(0);
    const project = projectFor(VIEW.camX, VIEW.camY);
    const g = stubGraphics();
    paintAmbientPixi(g, bed, "kilima", project, 640, 360, 0, "high");
    expect(g.rects.length).toBeGreaterThan(0);
    const { ctx, rects } = stubCtx();
    paintAmbient2D(ctx, bed, "kilima", project, 640, 360, 0, "high");
    expect(rects.length).toBe(g.rects.length);
  });
});

describe("dune shimmer and streaks", () => {
  it("lifts shimmer plus sand streaks on high quality", () => {
    const bed = stepHigh("dune", 120);
    expect(ambientMoteCount(bed)).toBeGreaterThanOrEqual(20);
    const kinds = new Set(bed.motes.map((mote) => mote.kind));
    expect(kinds.has("shimmer")).toBe(true);
    expect(kinds.has("streak")).toBe(true);
  });

  it("paints streaks elongated and shimmer faint", () => {
    const bed = stepHigh("dune", 10);
    const project = projectFor(VIEW.camX, VIEW.camY);
    const g = stubGraphics();
    paintAmbientPixi(g, bed, "dune", project, 640, 360, 0, "high");
    const wide = g.rects.filter((r) => r.w === 12 && r.h === 2);
    expect(wide.length).toBeGreaterThan(0);
  });
});

describe("aurora shimmer", () => {
  it("breathes around the base alpha on a 2.6s loop", () => {
    expect(auroraShimmerAlpha(0, 0)).toBeCloseTo(AURORA_SHIMMER_BASE, 5);
    expect(auroraShimmerAlpha(AURORA_SHIMMER_PERIOD_MS / 4, 0)).toBeCloseTo(
      AURORA_SHIMMER_BASE + AURORA_SHIMMER_AMP,
      5,
    );
    expect(auroraShimmerAlpha(0, 0)).not.toBe(
      auroraShimmerAlpha(AURORA_SHIMMER_PERIOD_MS / 4, 0),
    );
    expect(auroraShimmerAlpha(Number.NaN, 0)).toBe(AURORA_SHIMMER_BASE);
  });

  it("paints full-width bands on frostbite and nothing elsewhere", () => {
    const bed = stepHigh("frostbite", 10);
    const project = projectFor(VIEW.camX, VIEW.camY);
    const frost = stubGraphics();
    paintAmbientPixi(frost, bed, "frostbite", project, 640, 360, 500, "high");
    const bands = frost.rects.filter((r) => r.w === 640);
    expect(bands.length).toBe(2);
    const kilima = stubGraphics();
    paintAmbientPixi(kilima, bed, "kilima", project, 640, 360, 500, "high");
    expect(kilima.rects.filter((r) => r.w === 640)).toHaveLength(0);
  });
});

describe("low quality guard", () => {
  it("emits nothing on low and clears a running bed", () => {
    const bed = stepHigh("frostbite", 120);
    expect(ambientMoteCount(bed)).toBeGreaterThanOrEqual(20);
    updateAmbientBed(bed, { theme: "frostbite", quality: "low", tick: 121, ...VIEW });
    expect(ambientMoteCount(bed)).toBe(0);
    updateAmbientBed(bed, { theme: "frostbite", quality: "low", tick: 122, ...VIEW });
    expect(ambientMoteCount(bed)).toBe(0);
    const birds = stepHigh("kilima", 60);
    expect(ambientBirdCount(birds)).toBeGreaterThan(0);
    updateAmbientBed(birds, { theme: "kilima", quality: "low", tick: 61, ...VIEW });
    expect(ambientBirdCount(birds)).toBe(0);
  });

  it("paints nothing on low quality on either backend", () => {
    const bed = stepHigh("frostbite", 60);
    const project = projectFor(VIEW.camX, VIEW.camY);
    const g = stubGraphics();
    paintAmbientPixi(g, bed, "frostbite", project, 640, 360, 500, "low");
    expect(g.rects).toHaveLength(0);
    const { ctx, rects } = stubCtx();
    paintAmbient2D(ctx, bed, "frostbite", project, 640, 360, 500, "low");
    expect(rects).toHaveLength(0);
  });

  it("resumes cleanly when quality flips back to high", () => {
    const bed = stepHigh("frostbite", 60);
    updateAmbientBed(bed, { theme: "frostbite", quality: "low", tick: 61, ...VIEW });
    expect(ambientMoteCount(bed)).toBe(0);
    updateAmbientBed(bed, { theme: "frostbite", quality: "high", tick: 62, ...VIEW });
    expect(ambientMoteCount(bed)).toBe(AMBIENT_SNOW_PER_DRAW);
  });
});

describe("ambient determinism and safety", () => {
  it("hashes uniformly into [0, 1) and tolerates bad beds", () => {
    for (let n = 0; n < 50; n += 1) {
      const h = ambientHash01(n);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    expect(ambientHash01(Number.NaN)).toBe(0);
    expect(ambientMoteCount(null)).toBe(0);
    expect(ambientBirdCount(undefined)).toBe(0);
    expect(() =>
      updateAmbientBed(null, { theme: "kilima", quality: "high", tick: 0, ...VIEW }),
    ).not.toThrow();
    const empty = createAmbientBed();
    const g = stubGraphics();
    expect(() =>
      paintAmbientPixi(g, empty, "kilima", projectFor(0, 0), 640, 360, 0, "high"),
    ).not.toThrow();
  });
});
