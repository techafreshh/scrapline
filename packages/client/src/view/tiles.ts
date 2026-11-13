// Themed tileset model: tile kinds, per-kind paint, and layer
// collection. Pure (no DOM, no Pixi) so headless tests drive the same
// classification the renderer paints. Kinds: `#` solid full tile,
// `=` one-way thin 8px plank, `^` (plus legacy `B`) bounce pad as a
// striped 8px chevron, `:` backwall darker quad behind the playfield.
import { TILE_SIZE } from "../../../core/src/map";
import { visibleTileRange, type Camera } from "../renderer/camera";
import { themeFor, type ThemeName, type TileTheme } from "./theme";

/** Top surface highlight height in world px. */
export const HIGHLIGHT_PX = 2;
/** One-way plank height in world px (thin, distinct from full solid). */
export const ONEWAY_PLANK_H = 8;
/** Bounce pad height in world px (in [6,12], distinct from solid). */
export const BOUNCE_PAD_H = 8;
/** Backwall brightness as a fraction of the solid base (60%). */
export const BACKWALL_BRIGHTNESS = 0.6;
/** Backwall render order (drawn behind the playfield). */
export const BACKWALL_Z = 0;
/** Solid render order (drawn above the backwall). */
export const SOLID_Z = 1;
/** One-way plank render order (above solids). */
export const ONEWAY_Z = 2;
/** Bounce pad render order (above solids). */
export const BOUNCE_Z = 2;
/** Solid tile height in world px (full tile, distinct from pads). */
export const SOLID_TILE_H = TILE_SIZE;

/** Tile kinds understood by the themed renderer. */
export type TileKind = "solid" | "oneway" | "bounce" | "backwall" | "empty";

/** Minimal map surface the classifier reads (TileMap compatible). */
export interface TileQuery {
  isSolidTile(tx: number, ty: number): boolean;
  tileChar?(tx: number, ty: number): string;
  isOneWayTile?(tx: number, ty: number): boolean;
  isBounceTile?(tx: number, ty: number): boolean;
  isBackwallTile?(tx: number, ty: number): boolean;
  readonly widthTiles?: number;
  readonly heightTiles?: number;
}

/** One tile cell to paint. */
export interface TileCell {
  tx: number;
  ty: number;
}

/** Classified tile layers for one frame. */
export interface TileLayers {
  /** Visible solid tiles to paint with highlight/edge/depth. */
  solids: TileCell[];
  /** Visible one-way planks (thin 8px). */
  oneWays: TileCell[];
  /** Visible bounce pads (striped 8px chevrons). */
  bounces: TileCell[];
  /** Visible backwall quads (darker, behind solids). */
  backwalls: TileCell[];
  /** Visible tiles drawn this frame (all kinds). */
  tilesDrawn: number;
  /** Alias of tilesDrawn (harness probe name). */
  tileDrawCalls: number;
  /** Total bounce pads in the map (probe, >=1 when `^` present). */
  bouncePadCount: number;
  /** Total backwall tiles in the map (probe, >=1 when `:` present). */
  backwallCount: number;
  /** Total one-way planks in the map. */
  oneWayCount: number;
}

/**
 * Classify one ASCII char. `#` is the only solid; `=` is the one-way
 * plank, `^` (and legacy `B`) is the bounce pad, `:` is the backwall;
 * everything else (including markers S/P/H/G and `.`) is empty.
 */
export function tileKindForChar(ch: unknown): TileKind {
  if (typeof ch !== "string" || ch.length === 0) {
    return "empty";
  }
  const c = ch[0];
  if (c === "#") {
    return "solid";
  }
  if (c === "=") {
    return "oneway";
  }
  if (c === "^" || c === "B") {
    return "bounce";
  }
  if (c === ":") {
    return "backwall";
  }
  return "empty";
}

/** Read one char from a rows-like map surface (null when unavailable). */
function charFromRowsLike(map: TileQuery, tx: number, ty: number): string | null {
  const rec = map as unknown as Record<string, unknown>;
  const rows = rec["rows"];
  if (Array.isArray(rows)) {
    const row = rows[ty];
    if (typeof row === "string") {
      if (tx < 0 || tx >= row.length) {
        return ".";
      }
      return row[tx] ?? ".";
    }
  }
  const grid = rec["grid"];
  if (Array.isArray(grid)) {
    const row = (grid as unknown[])[ty];
    if (typeof row === "string") {
      if (tx < 0 || tx >= row.length) {
        return ".";
      }
      return row[tx] ?? ".";
    }
  }
  return null;
}

/**
 * Classify one tile through duck-typing: explicit `tileChar` first,
 * then per-kind queries, then `rows`/`grid` char reads, finally the
 * solid query (non-solid without other info reads empty). Out-of-range
 * coordinates defer to `isSolidTile` (TileMap reports OOB solid).
 */
export function tileKindAt(map: TileQuery | null | undefined, tx: number, ty: number): TileKind {
  if (map === null || map === undefined) {
    return "empty";
  }
  try {
    const rec = map as unknown as Record<string, unknown>;
    if (typeof rec["tileChar"] === "function") {
      const raw = (rec["tileChar"] as (x: number, y: number) => unknown).call(map, tx, ty);
      const kind = tileKindForChar(typeof raw === "string" ? raw : ".");
      if (kind !== "empty") {
        return kind;
      }
      if (typeof rec["isSolidTile"] === "function") {
        const solid = (rec["isSolidTile"] as (x: number, y: number) => unknown).call(map, tx, ty);
        return solid === true ? "solid" : "empty";
      }
      return "empty";
    }
    if (typeof rec["isBackwallTile"] === "function") {
      try {
        if ((rec["isBackwallTile"] as (x: number, y: number) => unknown).call(map, tx, ty) === true) {
          return "backwall";
        }
      } catch {
        // Fall through to the next classifier.
      }
    }
    if (typeof rec["isOneWayTile"] === "function") {
      try {
        if ((rec["isOneWayTile"] as (x: number, y: number) => unknown).call(map, tx, ty) === true) {
          return "oneway";
        }
      } catch {
        // Fall through to the next classifier.
      }
    }
    if (typeof rec["isBounceTile"] === "function") {
      try {
        if ((rec["isBounceTile"] as (x: number, y: number) => unknown).call(map, tx, ty) === true) {
          return "bounce";
        }
      } catch {
        // Fall through to the solid fallback.
      }
    }
    const rowChar = charFromRowsLike(map, tx, ty);
    if (rowChar !== null) {
      const kind = tileKindForChar(rowChar);
      if (kind !== "empty") {
        return kind;
      }
    }
    if (typeof rec["isSolidTile"] === "function") {
      const solid = (rec["isSolidTile"] as (x: number, y: number) => unknown).call(map, tx, ty);
      return solid === true ? "solid" : "empty";
    }
  } catch {
    return "empty";
  }
  return "empty";
}

/**
 * Resolve the active theme name: explicit override first (main.ts sets
 * it on startMatch), then the window mirrors (`__game.theme`,
 * `__matchConfig.map`) so a harness theme switch takes effect on the
 * next draw, then the module default (kilima). Never throws.
 */
export function resolveThemeName(override?: unknown): ThemeName {
  if (typeof override === "string") {
    const key = override.trim().toLowerCase();
    if (key === "dune" || key === "frostbite" || key === "kilima") {
      return key;
    }
  }
  try {
    const g = (globalThis as unknown as Record<string, unknown>)["window"] as
      | Record<string, unknown>
      | undefined;
    const game = g?.["__game"] as Record<string, unknown> | undefined;
    const fromGame = game?.["theme"];
    if (typeof fromGame === "string") {
      const key = fromGame.trim().toLowerCase();
      if (key === "dune" || key === "frostbite" || key === "kilima") {
        return key;
      }
    }
    const matchConfig = g?.["__matchConfig"] as Record<string, unknown> | undefined;
    const fromMatch = matchConfig?.["map"];
    if (typeof fromMatch === "string") {
      const key = fromMatch.trim().toLowerCase();
      if (key === "dune" || key === "frostbite" || key === "kilima") {
        return key;
      }
    }
  } catch {
    // Non-DOM harnesses: fall through to kilima.
  }
  return "kilima";
}

/**
 * Resolve the active tile theme object (same precedence as
 * resolveThemeName). Pure apart from the window read.
 */
export function resolveTileTheme(override?: unknown): TileTheme {
  return themeFor(resolveThemeName(override));
}

/** Per-kind paint for one theme (hex + CSS twins). */
export interface TilePaint {
  baseHex: number;
  baseCss: string;
  highlightHex: number;
  highlightCss: string;
  edgeHex: number;
  edgeCss: string;
}

/**
 * Paint for one tile kind under one theme. Solids use the theme base
 * with its lighter highlight and darker edge; planks reuse the one-way
 * fill; pads use the bounce base plus its chevron stripe; backwalls
 * are the flat 60% quad (no highlight/edge).
 */
export function tilePaintFor(kind: TileKind, theme: TileTheme): TilePaint {
  if (kind === "oneway") {
    return {
      baseHex: theme.oneWayHex,
      baseCss: theme.oneWay,
      highlightHex: theme.highlightHex,
      highlightCss: theme.highlight,
      edgeHex: theme.edgeHex,
      edgeCss: theme.edge,
    };
  }
  if (kind === "bounce") {
    return {
      baseHex: theme.bounceHex,
      baseCss: theme.bounce,
      highlightHex: theme.bounceStripeHex,
      highlightCss: theme.bounceStripe,
      edgeHex: theme.edgeHex,
      edgeCss: theme.edge,
    };
  }
  if (kind === "backwall") {
    return {
      baseHex: theme.backwallHex,
      baseCss: theme.backwall,
      highlightHex: theme.backwallHex,
      highlightCss: theme.backwall,
      edgeHex: theme.backwallHex,
      edgeCss: theme.backwall,
    };
  }
  return {
    baseHex: theme.baseHex,
    baseCss: theme.base,
    highlightHex: theme.highlightHex,
    highlightCss: theme.highlight,
    edgeHex: theme.edgeHex,
    edgeCss: theme.edge,
  };
}

/**
 * Cull classified tiles to the camera view and count map totals. The
 * visible lists drive paint (backwalls first for the z-order probe);
 * the totals drive the `bouncePadCount`/`backwallCount` probes so a
 * present marker counts even when the camera starts elsewhere. Without
 * tile dims (bare splash map) only the visible pass runs.
 */
export function collectTileLayers(
  map: TileQuery | null | undefined,
  cam: Camera,
  canvasWidth: number,
  canvasHeight: number,
  arenaWidth: number,
  arenaHeight: number,
): TileLayers {
  const solids: TileCell[] = [];
  const oneWays: TileCell[] = [];
  const bounces: TileCell[] = [];
  const backwalls: TileCell[] = [];
  if (map !== null && map !== undefined) {
    const range = visibleTileRange(cam, canvasWidth, canvasHeight, arenaWidth, arenaHeight);
    for (let ty = range.y0; ty <= range.y1; ty += 1) {
      for (let tx = range.x0; tx <= range.x1; tx += 1) {
        const kind = tileKindAt(map, tx, ty);
        if (kind === "solid") {
          solids.push({ tx, ty });
        } else if (kind === "oneway") {
          oneWays.push({ tx, ty });
        } else if (kind === "bounce") {
          bounces.push({ tx, ty });
        } else if (kind === "backwall") {
          backwalls.push({ tx, ty });
        }
      }
    }
    const width = Math.floor(Number(map.widthTiles ?? NaN));
    const height = Math.floor(Number(map.heightTiles ?? NaN));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= 256 && height <= 256) {
      let totalBounce = 0;
      let totalBackwall = 0;
      let totalOneWay = 0;
      for (let ty = 0; ty < height; ty += 1) {
        for (let tx = 0; tx < width; tx += 1) {
          const kind = tileKindAt(map, tx, ty);
          if (kind === "bounce") {
            totalBounce += 1;
          } else if (kind === "backwall") {
            totalBackwall += 1;
          } else if (kind === "oneway") {
            totalOneWay += 1;
          }
        }
      }
      const tilesDrawn = solids.length + oneWays.length + bounces.length + backwalls.length;
      return {
        solids,
        oneWays,
        bounces,
        backwalls,
        tilesDrawn,
        tileDrawCalls: tilesDrawn,
        bouncePadCount: totalBounce,
        backwallCount: totalBackwall,
        oneWayCount: totalOneWay,
      };
    }
  }
  const tilesDrawn = solids.length + oneWays.length + bounces.length + backwalls.length;
  return {
    solids,
    oneWays,
    bounces,
    backwalls,
    tilesDrawn,
    tileDrawCalls: tilesDrawn,
    bouncePadCount: bounces.length,
    backwallCount: backwalls.length,
    oneWayCount: oneWays.length,
  };
}
