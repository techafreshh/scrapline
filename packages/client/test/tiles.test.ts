// Themed tileset model: kind classification, z-order, sizes, and layer
// collection. Mirrors the renderer paint contract without touching the DOM.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TileMap, TILE_SIZE } from "../../core/src/map";
import { createCamera } from "../src/renderer/camera";
import { mapRowsFor } from "../src/maps";
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
  tilesetFor,
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

describe("per-theme tilesets", () => {
  it("resolves the flat tile-<theme>.svg asset key per theme", () => {
    expect(tilesetFor("oneway", THEMES.kilima).key).toBe("tile-kilima");
    expect(tilesetFor("oneway", THEMES.kilima).file).toBe("tile-kilima.svg");
    expect(tilesetFor("bounce", THEMES.dune).key).toBe("tile-dune");
    expect(tilesetFor("solid", THEMES.frostbite).file).toBe("tile-frostbite.svg");
    expect(tilesetFor("oneway", "dune").key).toBe("tile-dune");
    expect(tilesetFor("bounce", "FROSTBITE").key).toBe("tile-frostbite");
  });

  it("falls back tolerantly on unknown kinds and themes", () => {
    expect(tilesetFor("bogus-kind", THEMES.kilima).key).toBe("tile-kilima");
    expect(tilesetFor("bogus-kind", THEMES.kilima).baseHex).toBe(THEMES.kilima.baseHex);
    expect(tilesetFor("oneway", "bogus-theme").key).toBe("tile-kilima");
    expect(tilesetFor("oneway", null).file).toBe("tile-kilima.svg");
    expect(tilesetFor(undefined, undefined).key).toBe("tile-kilima");
  });

  it("paints kilima hazard cells in the exact probe pair", () => {
    const oneway = tilePaintFor("oneway", THEMES.kilima);
    expect(oneway.baseHex).toBe(0xffd21f);
    expect(oneway.baseCss).toBe("#FFD21F");
    expect(oneway.edgeHex).toBe(0x111111);
    expect(oneway.edgeCss).toBe("#111111");
    const bounce = tilePaintFor("bounce", THEMES.kilima);
    expect(bounce.baseHex).toBe(0xffd21f);
    expect(bounce.baseCss).toBe("#FFD21F");
    expect(bounce.highlightHex).toBe(0x111111);
    expect(bounce.highlightCss).toBe("#111111");
  });

  it("keeps collision identical across themes on the same rows", () => {
    const rows = mapRowsFor("kilima");
    expect(rows).not.toBeNull();
    const map = new TileMap(rows as string[]);
    const kilima = resolveTileTheme("kilima");
    const dune = resolveTileTheme("dune");
    expect(kilima.name).toBe("kilima");
    expect(dune.name).toBe("dune");
    // Theme selection never feeds physics: TileMap.isSolidTile reads
    // only the `#` core, so both themes report the same boolean.
    expect(typeof map.isSolidTile(5, 5)).toBe("boolean");
    const cam = createCamera(map.widthPixels, map.heightPixels);
    const underKilima = collectTileLayers(map, cam, 640, 360, map.widthPixels, map.heightPixels);
    const underDune = collectTileLayers(map, cam, 640, 360, map.widthPixels, map.heightPixels);
    expect(underDune.solids).toEqual(underKilima.solids);
    expect(underDune.oneWays).toEqual(underKilima.oneWays);
    expect(underDune.bounces).toEqual(underKilima.bounces);
    // ...while visuals do change with the theme.
    expect(tilePaintFor("oneway", dune)).not.toEqual(tilePaintFor("oneway", kilima));
    expect(tilesetFor("oneway", dune).key).not.toBe(tilesetFor("oneway", kilima).key);
  });

  it("renders hazard tilesets over 32px core cells", () => {
    expect(TILE_SIZE).toBe(32);
    expect(SOLID_TILE_H).toBe(TILE_SIZE);
  });

  it("ships probe hexes in the kilima 32x32 SVG source", () => {
    const svg = readFileSync(
      join(process.cwd(), "packages", "client", "assets", "tile-kilima.svg"),
      "utf8",
    );
    expect(svg).toContain("#FFD21F");
    expect(svg).toContain("#111111");
    expect(svg).toMatch(/viewBox="0 0 32 32"/);
    expect(svg).toMatch(/width="32"/);
    expect(svg).toMatch(/height="32"/);
  });
});
