// Per-map decoration dressing: counts, non-occlusion, z-order, culling,
// and tolerant name resolution. Mirrors tiles.test.ts style without
// touching the DOM.
import { afterEach, describe, expect, it } from "vitest";
import { TileMap } from "../../core/src/map";
import { createCamera } from "../src/renderer/camera";
import { decorationsFor, mapRowsFor } from "../src/maps";
import {
  DECOR_Z,
  countOccludedTiles,
  decorPaintFor,
  decorationsForMap,
  visibleDecorations,
} from "../src/view/decor";
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
});
