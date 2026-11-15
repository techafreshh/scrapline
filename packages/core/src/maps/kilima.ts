// Kilima outpost dressing: static per-map decoration rects in world pixels
// (y-down, TILE_SIZE 32, arena 1280x640). Pure data: relative core imports
// only, JSON-serializable, deterministic order. All rects sit in the
// verified-empty sky band (rows 0-3) so no rect intersects a `#` solid tile.
import { generateScatterDecorations } from "./scatter";
export interface Decoration {
  /** Decoration kind key (resolved to a palette in client view/decor). */
  kind: string;
  /** Left edge in world px. */
  x: number;
  /** Top edge in world px. */
  y: number;
  /** Width in world px. */
  w: number;
  /** Height in world px. */
  h: number;
}

/** Kilima decorations: sandbags, antenna-mast, watchtower. */
export const decorations: Decoration[] = [
  { kind:"sandbags", x: 64, y: 64, w: 96, h: 24 },
  { kind:"antenna-mast", x: 960, y: 0, w: 16, h: 128 },
  { kind:"watchtower", x: 576, y: 32, w: 96, h: 64 },
];

/**
 * Static rects plus deterministic micro-scatter for `rows`/`seed`: the
 * static array is never mutated, so the 3-rect contract stays byte-stable.
 */
export function decorationsWithScatter(rows: string[] | string, seed: number): Decoration[] {
  return [...decorations, ...generateScatterDecorations("kilima", rows, seed)];
}
