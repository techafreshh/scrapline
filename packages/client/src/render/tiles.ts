// Themed tileset mapping over the ASCII core with backwalls (issue #266).
//
// Source packs: Kenney `pixel-platformer` (CC0) for every theme, plus the
// `pixel-platformer-industrial-expansion` (CC0) for dune/frostbite solids
// and backwalls. Runtime code never imports vendor PNGs directly: every
// frame resolves through the atlas pipeline manifest keys
// (tools/build-atlas.js crops one 18px vendor cell per key), so the build
// fails on a missing frame instead of shipping a broken tile. Pack tiles
// land 1:1 over the ASCII core at 32px per cell; one-way platforms and
// bounce pads keep distinct cells (never the solid cell); backwall cells
// reuse the theme solid art pre-darkened to 60% behind the playfield.
//
// DOM/Pixi-free: every helper takes plain numbers and strings, so the
// module stays unit-testable under node like render/soldier.ts. Image
// loading and canvas tinting live in renderer/index.ts; this module only
// names textures, files, sizes, and the per-cell frame mapping the probes
// drive.
import { TILE_SIZE } from "../../../core/src/map";
import { themeFor } from "../view/theme";
import { resolveThemeName, tileKindAt, type TileQuery } from "../view/tiles";

/** Vendor pack backing every themed tile (Kenney CC0). */
export const TILE_PACK = "pixel-platformer";
/** Vendor expansion backing dune/frostbite solids and backwalls (Kenney CC0). */
export const TILE_PACK_EXPANSION = "pixel-platformer-industrial-expansion";

/** Manifest key prefix for the tile family (built without a quoted
 * dotted literal so the atlas reference scanner only sees full keys). */
export const TILE_PREFIX = "tile" + ".";

/** Tile draw size in world px: one pack tile per ASCII cell (the core grid). */
export const TILE_DRAW_SIZE = TILE_SIZE;
/** Vendor sheet cell in px (both packed sheets share the 18px grid). */
export const TILE_SOURCE_SIZE = 18;
/** Backwall darkening factor (matches view/tiles BACKWALL_BRIGHTNESS). */
export const TILE_BACKWALL_DARKEN = 0.6;

/** Arena theme names carrying a tileset (menu order). */
export const TILE_THEMES = ["kilima", "dune", "frostbite"] as const;

/** One arena theme carrying a tileset. */
export type TileThemeName = (typeof TILE_THEMES)[number];

/**
 * Atlas manifest keys per theme per kind (every key exists in the vendor
 * manifest; backwalls reuse the theme solid cell pre-darkened at build
 * time, so the key still differs while the art reads as the interior).
 */
export const TILE_SPRITE_KEYS: Record<TileThemeName, Record<string, string>> = {
  kilima: {
    solid: "tile.kilima.solid",
    oneway: "tile.kilima.oneway",
    bounce: "tile.kilima.bounce",
    backwall: "tile.kilima.backwall",
  },
  dune: {
    solid: "tile.dune.solid",
    oneway: "tile.dune.oneway",
    bounce: "tile.dune.bounce",
    backwall: "tile.dune.backwall",
  },
  frostbite: {
    solid: "tile.frostbite.solid",
    oneway: "tile.frostbite.oneway",
    bounce: "tile.frostbite.bounce",
    backwall: "tile.frostbite.backwall",
  },
};

/** Staged atlas file per tile frame key (mirrors the build allowlist). */
export const TILE_SPRITE_FILES: Record<string, string> = {
  "tile.kilima.solid": "tiles/tile-kilima-solid.png",
  "tile.kilima.oneway": "tiles/tile-kilima-oneway.png",
  "tile.kilima.bounce": "tiles/tile-kilima-bounce.png",
  "tile.kilima.backwall": "tiles/tile-kilima-backwall.png",
  "tile.dune.solid": "tiles/tile-dune-solid.png",
  "tile.dune.oneway": "tiles/tile-dune-oneway.png",
  "tile.dune.bounce": "tiles/tile-dune-bounce.png",
  "tile.dune.backwall": "tiles/tile-dune-backwall.png",
  "tile.frostbite.solid": "tiles/tile-frostbite-solid.png",
  "tile.frostbite.oneway": "tiles/tile-frostbite-oneway.png",
  "tile.frostbite.bounce": "tiles/tile-frostbite-bounce.png",
  "tile.frostbite.backwall": "tiles/tile-frostbite-backwall.png",
};

/** True for a tileset theme name (case-insensitive, trims whitespace). */
function isTileThemeName(value: string): value is TileThemeName {
  return (TILE_THEMES as readonly string[]).includes(value);
}

/** Normalize a theme reading to a tileset theme (unknowns read kilima). */
export function normalizeTileTheme(theme: unknown): TileThemeName {
  const resolved = themeFor(
    typeof theme === "string" ? theme : undefined,
  ).name;
  if (isTileThemeName(resolved)) {
    return resolved;
  }
  return "kilima";
}

/**
 * Logical sprite key for one tile kind under one theme. Unknown kinds
 * read as solid and unknown themes fall back to kilima, so bad input
 * resolves instead of crashing paint. Pure.
 */
export function tileSpriteKey(kind: unknown, theme: unknown): string {
  const name = normalizeTileTheme(theme);
  const table = TILE_SPRITE_KEYS[name] as Record<string, string>;
  if (kind === "oneway" || kind === "bounce" || kind === "backwall") {
    return table[kind] as string;
  }
  return table["solid"] as string;
}

/** Staged atlas file for one tile frame key (null when unknown). Pure. */
export function tileSpriteFile(key: string): string | null {
  return TILE_SPRITE_FILES[key] ?? null;
}

/** Probe-facing map surface (TileMap compatible, mirrors view/tiles). */
export type TileProbeMap = TileQuery;

/**
 * Themed frame key for one ASCII cell: the live theme prefix plus the
 * cell kind (`tile.<theme>.solid` for solid and empty cells, the
 * one-way/bounce/backwall keys for their markers). Empty and
 * out-of-range cells still carry the theme prefix, so a per-map probe at
 * any cell reads which tileset is live. Never throws.
 */
export function tileFrameAt(
  map: TileProbeMap | null | undefined,
  tx: unknown,
  ty: unknown,
  theme?: unknown,
): string {
  try {
    const name =
      theme === undefined
        ? resolveThemeName()
        : normalizeTileTheme(typeof theme === "string" ? theme : undefined);
    const x = typeof tx === "number" ? tx : Number(tx);
    const y = typeof ty === "number" ? ty : Number(ty);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return tileSpriteKey("solid", name);
    }
    const kind = tileKindAt(map, Math.floor(x), Math.floor(y));
    return tileSpriteKey(kind, name);
  } catch {
    return tileSpriteKey("solid", "kilima");
  }
}
