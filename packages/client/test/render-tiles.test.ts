// Themed tilesets over the ASCII core (issue #266): pack wiring, per-cell
// frame mapping, 32px draw size, and the atlas manifest wiring. DOM-free.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TileMap, TILE_SIZE } from "../../core/src/map";
import { BACKWALL_BRIGHTNESS, tileManifestKey } from "../src/view/tiles";
import {
  TILE_BACKWALL_DARKEN,
  TILE_DRAW_SIZE,
  TILE_PACK,
  TILE_PACK_EXPANSION,
  TILE_SOURCE_SIZE,
  TILE_SPRITE_FILES,
  TILE_SPRITE_KEYS,
  TILE_THEMES,
  normalizeTileTheme,
  tileFrameAt,
  tileSpriteFile,
  tileSpriteKey,
} from "../src/render/tiles";
import { isAtlasManifest, manifestFrame } from "../src/atlas";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATLAS_DIR = path.resolve(HERE, "..", "assets", "atlas");

function readManifest(): Record<string, { file: string; atlas: string; w: number; h: number }> {
  const raw = fs.readFileSync(path.join(ATLAS_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw) as Record<string, { file: string; atlas: string; w: number; h: number }>;
}

describe("themed tileset pack wiring", () => {
  it("names the pixel-platformer packs in the module", () => {
    expect(TILE_PACK).toBe("pixel-platformer");
    expect(TILE_PACK_EXPANSION).toBe("pixel-platformer-industrial-expansion");
    const source = readFileSync(
      join(__dirname, "..", "src", "render", "tiles.ts"),
      "utf8",
    );
    expect(source).toContain("pixel-platformer");
    expect(source).toContain("industrial");
  });

  it("never references vendor art directly", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "render", "tiles.ts"),
      "utf8",
    );
    expect(source.includes("vendor/")).toBe(false);
  });

  it("paints one pack tile per ASCII cell at 32px from 18px sheet cells", () => {
    expect(TILE_DRAW_SIZE).toBe(32);
    expect(TILE_DRAW_SIZE).toBe(TILE_SIZE);
    expect(TILE_SOURCE_SIZE).toBe(18);
    expect(TILE_BACKWALL_DARKEN).toBeCloseTo(BACKWALL_BRIGHTNESS, 5);
    expect(TILE_BACKWALL_DARKEN).toBeCloseTo(0.6, 5);
  });

  it("covers kilima/dune/frostbite with four kinds each", () => {
    expect([...TILE_THEMES]).toEqual(["kilima", "dune", "frostbite"]);
    for (const theme of TILE_THEMES) {
      const table = TILE_SPRITE_KEYS[theme] as Record<string, string>;
      expect(Object.keys(table).sort()).toEqual(
        ["backwall", "bounce", "oneway", "solid"],
      );
      for (const kind of ["solid", "oneway", "bounce", "backwall"] as const) {
        expect(table[kind]).toBe(`tile.${theme}.${kind}`);
        expect(tileSpriteFile(table[kind])).not.toBeNull();
      }
      // One-way and bounce cells never alias the solid cell or each other.
      expect(table["oneway"]).not.toBe(table["solid"]);
      expect(table["bounce"]).not.toBe(table["solid"]);
      expect(table["bounce"]).not.toBe(table["oneway"]);
      expect(table["backwall"]).not.toBe(table["solid"]);
    }
  });

  it("resolves sprite keys tolerantly with a kilima/solid fallback", () => {
    expect(tileSpriteKey("solid", "kilima")).toBe("tile.kilima.solid");
    expect(tileSpriteKey("oneway", "dune")).toBe("tile.dune.oneway");
    expect(tileSpriteKey("bounce", "FROSTBITE")).toBe("tile.frostbite.bounce");
    expect(tileSpriteKey("backwall", "  dune ")).toBe("tile.dune.backwall");
    expect(tileSpriteKey("bogus-kind", "kilima")).toBe("tile.kilima.solid");
    expect(tileSpriteKey("bounce", "bogus-theme")).toBe("tile.kilima.bounce");
    expect(tileSpriteKey(undefined, undefined)).toBe("tile.kilima.solid");
    expect(tileSpriteKey(null, null)).toBe("tile.kilima.solid");
    expect(normalizeTileTheme("dune")).toBe("dune");
    expect(normalizeTileTheme("bogus")).toBe("kilima");
  });

  it("stays in sync with the view tileManifestKey table", () => {
    for (const theme of TILE_THEMES) {
      for (const kind of ["solid", "oneway", "bounce", "backwall"] as const) {
        expect(tileSpriteKey(kind, theme)).toBe(tileManifestKey(kind, theme));
      }
    }
  });
});

describe("per-cell frame mapping", () => {
  it("maps every ASCII kind through a live TileMap", () => {
    const map = new TileMap(["#=^", ":B.", "S.."]);
    expect(tileFrameAt(map, 0, 0, "kilima")).toBe("tile.kilima.solid");
    expect(tileFrameAt(map, 1, 0, "kilima")).toBe("tile.kilima.oneway");
    expect(tileFrameAt(map, 2, 0, "kilima")).toBe("tile.kilima.bounce");
    expect(tileFrameAt(map, 0, 1, "kilima")).toBe("tile.kilima.backwall");
    expect(tileFrameAt(map, 1, 1, "kilima")).toBe("tile.kilima.bounce");
    expect(tileFrameAt(map, 0, 2, "kilima")).toBe("tile.kilima.solid");
  });

  it("prefixes the frame with the active theme on any cell", () => {
    const map = new TileMap(["...", "..."]);
    for (const theme of TILE_THEMES) {
      expect(tileFrameAt(map, 2, 2, theme).startsWith(`tile.${theme}.`)).toBe(true);
    }
    // Null map and out-of-range coords still carry the theme prefix.
    expect(tileFrameAt(null, 2, 2, "dune")).toBe("tile.dune.solid");
    expect(tileFrameAt(undefined, 2, 2, "frostbite")).toBe("tile.frostbite.solid");
    expect(tileFrameAt(map, 99, 99, "kilima").startsWith("tile.kilima.")).toBe(true);
    expect(tileFrameAt(map, NaN, 0, "kilima")).toBe("tile.kilima.solid");
  });

  it("follows the default theme without an explicit override", () => {
    const map = new TileMap(["#"]);
    expect(tileFrameAt(map, 0, 0)).toBe("tile.kilima.solid");
  });
});

describe("tile atlas manifest wiring", () => {
  it("ships all twelve tile frames with on-disk 18px art", () => {
    const manifest = readManifest();
    expect(isAtlasManifest(manifest)).toBe(true);
    for (const theme of TILE_THEMES) {
      for (const kind of ["solid", "oneway", "bounce", "backwall"] as const) {
        const name = `tile.${theme}.${kind}`;
        const entry = manifestFrame(manifest, name);
        expect(entry, name).not.toBeNull();
        expect(entry?.w).toBe(TILE_SOURCE_SIZE);
        expect(entry?.h).toBe(TILE_SOURCE_SIZE);
        expect(fs.existsSync(path.join(ATLAS_DIR, entry?.file ?? ""))).toBe(true);
        expect(entry?.file).toBe(TILE_SPRITE_FILES[name]);
      }
    }
  });

  it("keeps every staged tile file byte-distinct (backwalls pre-darkened)", () => {
    const seen = new Map<string, string>();
    for (const [name, file] of Object.entries(TILE_SPRITE_FILES)) {
      const buf = fs.readFileSync(path.join(ATLAS_DIR, file));
      const hex = buf.toString("hex");
      expect(seen.has(hex), `${name} duplicates staged art`).toBe(false);
      seen.set(hex, name);
    }
  });
});
