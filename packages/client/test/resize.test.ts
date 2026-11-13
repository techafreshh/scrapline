// Letterbox-fit math tests: computeLetterboxFit stays 16:9 inside the
// viewport, clampRendererResolution grades DPR into [1, 2], and
// applyLetterbox writes exact px sizes (or no-ops on nulls). Mirrors
// the packages/client/test/camera.test.ts builder style (small local
// builders, behavior assertions, no jsdom).
import { describe, expect, it } from "vitest";
import {
  applyLetterbox,
  BASE_H,
  BASE_W,
  clampRendererResolution,
  computeLetterboxFit,
} from "../src/view/resize";

const ASPECT = 16 / 9;

function aspectOf(size: { width: number; height: number }): number {
  return size.width / size.height;
}

describe("computeLetterboxFit", () => {
  it("fills 1920x1080 exactly", () => {
    expect(computeLetterboxFit(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("fits 800x600 inside the viewport at 16:9", () => {
    const size = computeLetterboxFit(800, 600);
    expect(size).toEqual({ width: 800, height: 450 });
    expect(size.width).toBeLessThanOrEqual(800);
    expect(size.height).toBeLessThanOrEqual(600);
    expect(Math.abs(aspectOf(size) - ASPECT)).toBeLessThan(0.02);
  });

  it("letterboxes a portrait 390x844 viewport at 16:9", () => {
    const size = computeLetterboxFit(390, 844);
    expect(size.width).toBe(390);
    expect(Math.abs(aspectOf(size) - ASPECT)).toBeLessThan(0.02);
    expect(size.height).toBeLessThanOrEqual(844);
  });

  it("fits a square 500x500 viewport at 16:9", () => {
    const size = computeLetterboxFit(500, 500);
    expect(size.width).toBeLessThanOrEqual(500);
    expect(size.height).toBeLessThanOrEqual(500);
    expect(Math.abs(aspectOf(size) - ASPECT)).toBeLessThan(0.02);
  });

  it("stays finite at >= 1px for zero/negative viewports", () => {
    for (const size of [
      computeLetterboxFit(0, 0),
      computeLetterboxFit(-800, -600),
      computeLetterboxFit(NaN, 600),
    ]) {
      expect(Number.isFinite(size.width)).toBe(true);
      expect(Number.isFinite(size.height)).toBe(true);
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
    }
  });

  it("exposes the 640x360 logical base", () => {
    expect(BASE_W).toBe(640);
    expect(BASE_H).toBe(360);
  });
});

describe("clampRendererResolution", () => {
  it.each([
    { dpr: 1, expected: 1 },
    { dpr: 2, expected: 2 },
    { dpr: 3, expected: 2 },
    { dpr: 0.5, expected: 1 },
    { dpr: NaN, expected: 1 },
    { dpr: 0, expected: 1 },
  ])("maps $dpr to $expected", ({ dpr, expected }) => {
    expect(clampRendererResolution(dpr)).toBe(expected);
  });
});

describe("applyLetterbox", () => {
  function fakeEl(): { style: Record<string, unknown> } {
    return { style: {} };
  }

  it("writes exact px sizes to canvas and stage", () => {
    const canvas = fakeEl();
    const stage = fakeEl();
    applyLetterbox(canvas, stage, { width: 800, height: 450 });
    expect(canvas.style["width"]).toBe("800px");
    expect(canvas.style["height"]).toBe("450px");
    expect(stage.style["width"]).toBe("800px");
    expect(stage.style["height"]).toBe("450px");
  });

  it("no-ops on null handles", () => {
    expect(() =>
      applyLetterbox(null, undefined, { width: 800, height: 450 }),
    ).not.toThrow();
  });
});
