// Themed tileset model: kind classification, z-order, sizes, and layer
// collection. Mirrors the renderer paint contract without touching the DOM.
import { afterEach, describe, expect, it } from "vitest";
import { TileMap, TILE_SIZE } from "../../core/src/map";
import { createCamera } from "../src/renderer/camera";
import {
  BACKWALL_BRIGHTNESS,
  BACKWALL_Z,
  BOUNCE_PAD_H,
  HIGHLIGHT_PX,
  ONEWAY_PLANK_H,
  SOLID_TILE_H,
  SOLID_Z,
  collectTileLayers,
  resolveThemeName,
  resolveTileTheme,
  tileKindAt,
  tileKindForChar,
  tilePaintFor,
} from "../src/view/tiles";
import { THEMES } from "../src/view/theme";

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("tile kinds", () => {
  it("classifies every map char", () => {
    expect(tileKindForChar("#")).toBe("solid");
    expect(tileKindForChar("=")).toBe("oneway");
    expect(tileKindForChar("^")).toBe("bounce");
    expect(tileKindForChar("B")).toBe("bounce");
    expect(tileKindForChar(":")).toBe("backwall");
    expect(tileKindForChar(".")).toBe("empty");
    expect(tileKindForChar("S")).toBe("empty");
    expect(tileKindForChar("")).toBe("empty");
  });

  it("exposes the themed size and z-order contract", () => {
    expect(HIGHLIGHT_PX).toBe(2);
    expect(ONEWAY_PLANK_H).toBe(8);
    expect(BOUNCE_PAD_H).toBeGreaterThanOrEqual(6);
    expect(BOUNCE_PAD_H).toBeLessThanOrEqual(12);
    expect(BOUNCE_PAD_H).not.toBe(SOLID_TILE_H);
    expect(SOLID_TILE_H).toBe(TILE_SIZE);
    expect(BACKWALL_BRIGHTNESS).toBeCloseTo(0.6, 5);
    expect(BACKWALL_Z).toBeLessThan(SOLID_Z);
  });

  it("reads kinds through TileMap char storage", () => {
    const map = new TileMap(["#=^", ":B.", "S.."]);
    expect(tileKindAt(map, 0, 0)).toBe("solid");
    expect(tileKindAt(map, 1, 0)).toBe("oneway");
    expect(tileKindAt(map, 2, 0)).toBe("bounce");
    expect(tileKindAt(map, 0, 1)).toBe("backwall");
    expect(tileKindAt(map, 1, 1)).toBe("bounce");
    expect(tileKindAt(map, 0, 2)).toBe("empty");
    expect(map.isOneWayTile(1, 0)).toBe(true);
    expect(map.isBounceTile(2, 0)).toBe(true);
    expect(map.isBounceTile(1, 1)).toBe(true);
    expect(map.isBackwallTile(0, 1)).toBe(true);
    expect(map.isSolidTile(0, 0)).toBe(true);
    expect(map.isSolidTile(1, 0)).toBe(false);
  });
});

describe("tile layers", () => {
  it("culls to the camera while counting map totals", () => {
    const map = new TileMap([
      "########################################",
      "#..................=^:..................#",
      "#......................................#",
      "########################################",
    ]);
    const cam = createCamera(map.widthPixels, map.heightPixels);
    const layers = collectTileLayers(map, cam, 640, 360, map.widthPixels, map.heightPixels);
    expect(layers.bouncePadCount).toBeGreaterThanOrEqual(1);
    expect(layers.backwallCount).toBeGreaterThanOrEqual(1);
    expect(layers.oneWayCount).toBeGreaterThanOrEqual(1);
    expect(layers.tileDrawCalls).toBe(layers.tilesDrawn);
    expect(layers.tilesDrawn).toBeGreaterThan(0);
    expect(layers.backwalls.length + layers.solids.length + layers.oneWays.length + layers.bounces.length).toBe(
      layers.tilesDrawn,
    );
  });

  it("paints solids from the theme base with a lighter highlight", () => {
    const paint = tilePaintFor("solid", THEMES.kilima);
    expect(paint.baseHex).toBe(THEMES.kilima.baseHex);
    expect(paint.highlightHex).toBe(THEMES.kilima.highlightHex);
  });
});

describe("theme resolution", () => {
  it("defaults to kilima without a window", () => {
    expect(resolveThemeName()).toBe("kilima");
    expect(resolveTileTheme().name).toBe("kilima");
  });

  it("follows window.__game.theme then __matchConfig.map", () => {
    (globalThis as unknown as Record<string, unknown>)["window"] = {
      __game: { theme: "frostbite" },
      __matchConfig: { map: "dune" },
    };
    expect(resolveThemeName()).toBe("frostbite");
    const w = (globalThis as unknown as Record<string, unknown>)["window"] as Record<
      string,
      unknown
    >;
    (w["__game"] as Record<string, unknown>)["theme"] = "bogus";
    expect(resolveThemeName()).toBe("dune");
  });

  it("prefers the non-kilima mirror when they disagree", () => {
    (globalThis as unknown as Record<string, unknown>)["window"] = {
      __game: { theme: "kilima" },
      __matchConfig: { map: "dune" },
    };
    expect(resolveThemeName()).toBe("dune");
    expect(resolveTileTheme().name).toBe("dune");
    (globalThis as unknown as Record<string, unknown>)["window"] = {
      __game: { theme: "kilima" },
      __matchConfig: { map: "frostbite" },
    };
    expect(resolveThemeName()).toBe("frostbite");
    (globalThis as unknown as Record<string, unknown>)["window"] = {
      __game: { theme: "frostbite" },
      __matchConfig: { map: "kilima" },
    };
    expect(resolveThemeName()).toBe("frostbite");
  });
});
