// Per-map decoration dressing: counts, non-occlusion, z-order, culling,
// and tolerant name resolution. Mirrors tiles.test.ts style without
// touching the DOM.
import { afterEach, describe, expect, it } from "vitest";
import { TileMap } from "../../core/src/map";
import { createCamera } from "../src/renderer/camera";
import { decorationsFor, decorationsForSeeded, mapRowsFor } from "../src/maps";
import {
  DECOR_Z,
  countOccludedTiles,
  decorPaintFor,
  decorationsForMap,
  decorationsForMapSeeded,
  paintDecor2D,
  paintDecorPixi,
  visibleDecorations,
} from "../src/view/decor";

/** Recording Pixi graphics stub (rects/circles/lines). */
function stubGraphics(): {
  rect(x: number, y: number, w: number, h: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
  circle(x: number, y: number, r: number): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(style?: { width?: number; color?: number; alpha?: number }): unknown;
  calls: number;
} {
  const stub = {
    calls: 0,
    rect(): unknown {
      stub.calls += 1;
      return undefined;
    },
    fill(): unknown {
      stub.calls += 1;
      return undefined;
    },
    circle(): unknown {
      stub.calls += 1;
      return undefined;
    },
    moveTo(): unknown {
      stub.calls += 1;
      return undefined;
    },
    lineTo(): unknown {
      stub.calls += 1;
      return undefined;
    },
    stroke(): unknown {
      stub.calls += 1;
      return undefined;
    },
  };
  return stub;
}

/** Minimal 2D canvas stub covering every decor painter op. */
function stubCtx(): { ctx: CanvasRenderingContext2D; calls: { count: number } } {
  const calls = { count: 0 };
  const ctx = {
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    fillRect(): void {
      calls.count += 1;
    },
    beginPath(): void {
      calls.count += 1;
    },
    arc(): void {
      calls.count += 1;
    },
    fill(): void {
      calls.count += 1;
    },
    moveTo(): void {
      calls.count += 1;
    },
    lineTo(): void {
      calls.count += 1;
    },
    stroke(): void {
      calls.count += 1;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
import { SOLID_Z } from "../src/view/tiles";

const ARENA_W = 40 * 32;
const ARENA_H = 20 * 32;

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("map decorations", () => {
  it("resolves >=3 decorations per map with a copy-on-return registry", () => {
    for (const name of ["kilima", "dune", "frostbite"]) {
      const decors = decorationsFor(name);
      expect(decors).not.toBeNull();
      expect((decors ?? []).length).toBeGreaterThanOrEqual(3);
      expect(decorationsForMap(name).length).toBeGreaterThanOrEqual(3);
    }
    const first = decorationsFor("kilima") ?? [];
    const second = decorationsFor("kilima") ?? [];
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(decorationsFor("bogus")).toBeNull();
  });

  it("counts zero occluded tiles against the real arena rows", () => {
    for (const name of ["kilima", "dune", "frostbite"]) {
      const rows = mapRowsFor(name) ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(20);
      const map = new TileMap(rows);
      const decors = decorationsForMap(name);
      expect(countOccludedTiles(decors, map)).toBe(0);
    }
  });

  it("paints decorations below solids", () => {
    expect(DECOR_Z).toBeLessThan(SOLID_Z);
  });

  it("culls to the camera while the whole-arena view keeps the full set", () => {
    for (const name of ["kilima", "dune", "frostbite"]) {
      const decors = decorationsForMap(name);
      const total = decors.length;
      const corner = { ...createCamera(ARENA_W, ARENA_H), x: 160, y: 90 };
      const culled = visibleDecorations(decors, corner, 640, 360, ARENA_W, ARENA_H);
      expect(culled.length).toBeLessThan(total);
      const wide = { ...createCamera(ARENA_W, ARENA_H), scale: 0.5 };
      expect(visibleDecorations(decors, wide, 640, 360, ARENA_W, ARENA_H)).toHaveLength(total);
    }
  });

  it("falls back to kilima for unknown map names", () => {
    expect(decorationsForMap("bogus")).toEqual(decorationsFor("kilima"));
    expect(decorationsForMap("  ")).toEqual(decorationsFor("kilima"));
    expect(decorationsForMap(undefined)).toEqual(decorationsFor("kilima"));
    expect(decorationsForMap(" DUNE ").length).toBeGreaterThanOrEqual(3);
  });

  it("resolves a hex/CSS palette per kind with a neutral fallback", () => {
    const sandbags = decorPaintFor("sandbags");
    expect(sandbags.fillHex).toBeGreaterThan(0);
    expect(sandbags.fillCss).toMatch(/^#/);
    expect(sandbags.accentCss).toMatch(/^#/);
    expect(decorPaintFor("bogus-kind").fillCss).toBe("#64748b");
  });

  it("resolves seeded scatter deterministically with a copy-on-return registry", () => {
    for (const name of ["kilima", "dune", "frostbite"]) {
      const first = decorationsForSeeded(name, 123);
      const second = decorationsForSeeded(name, 123);
      expect(first).not.toBeNull();
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect((first ?? []).length).toBeGreaterThanOrEqual(15);
      expect((first ?? []).length).toBeLessThanOrEqual(200);
      expect(decorationsForMapSeeded(name, 123)).toEqual(first);
      // Mutating one call never leaks into the next (fresh scatter rects).
      (first ?? []).push({ kind: "rock", x: 0, y: 0, w: 8, h: 8 });
      expect(decorationsForSeeded(name, 123)).toEqual(second);
    }
    expect(decorationsForSeeded("bogus", 123)).toBeNull();
    expect(decorationsForSeeded("kilima", 123)).not.toEqual(decorationsForSeeded("kilima", 999));
  });

  it("counts zero seeded occlusions against the real arena rows", () => {
    for (const name of ["kilima", "dune", "frostbite"]) {
      const rows = mapRowsFor(name) ?? [];
      const map = new TileMap(rows);
      for (const seed of [123, 0, 999]) {
        expect(countOccludedTiles(decorationsForMapSeeded(name, seed), map)).toBe(0);
      }
    }
  });

  it("falls back to kilima scatter for unknown map names", () => {
    expect(decorationsForMapSeeded("bogus", 123)).toEqual(decorationsForMapSeeded("kilima", 123));
    expect(decorationsForMapSeeded(undefined, 123)).toEqual(decorationsForMapSeeded("kilima", 123));
    expect(decorationsForMapSeeded(" DUNE ", 123).length).toBeGreaterThanOrEqual(15);
  });

  it("resolves a hex/CSS palette for every micro scatter kind", () => {
    for (const kind of ["grass-tuft", "rock", "valve", "antenna"]) {
      const paint = decorPaintFor(kind);
      expect(paint.fillHex).toBeGreaterThan(0);
      expect(paint.fillCss).toMatch(/^#/);
      expect(paint.accentHex).toBeGreaterThan(0);
      expect(paint.accentCss).toMatch(/^#/);
      expect(paint.fillCss).not.toBe("#64748b");
    }
  });

  it("paints every scatter kind on both backends without throwing", () => {
    const decors = [
      { kind: "grass-tuft", x: 64, y: 64, w: 16, h: 12 },
      { kind: "rock", x: 96, y: 64, w: 20, h: 14 },
      { kind: "valve", x: 128, y: 64, w: 12, h: 18 },
      { kind: "antenna", x: 160, y: 64, w: 10, h: 24 },
      { kind: "sandbags", x: 192, y: 64, w: 24, h: 12 },
    ];
    const graphics = stubGraphics();
    expect(() =>
      paintDecorPixi(graphics, (x) => x, (y) => y, 1, decors),
    ).not.toThrow();
    expect(graphics.calls).toBeGreaterThan(0);
    const { ctx, calls } = stubCtx();
    expect(() =>
      paintDecor2D(ctx, (x) => x, (y) => y, 1, decors),
    ).not.toThrow();
    expect(calls.count).toBeGreaterThan(0);
  });
});
