// Dune refinery dressing: static per-map decoration rects in world pixels
// (y-down, TILE_SIZE 32, arena 1280x640). Pure data: relative core imports
// only, JSON-serializable, deterministic order. All rects sit in the
// verified-empty sky band (rows 0-2, center-free columns) so no rect
// intersects a `#` solid.
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

/** Dune decorations: pipes, vats, catwalk-rails, plus scrub foliage
 * and hanging vines filling the refinery sky band (rows 0-2) at mockup
 * edge density (issue #403). */
export const decorations: Decoration[] = [
  { kind:"pipes", x: 384, y: 32, w: 160, h: 24 },
  { kind:"vats", x: 576, y: 32, w: 64, h: 64 },
  { kind:"catwalk-rails", x: 768, y: 64, w: 160, h: 16 },
  { kind:"foliage", x: 128, y: 16, w: 64, h: 32 },
  { kind:"vines", x: 1088, y: 8, w: 24, h: 48 },
  { kind:"foliage", x: 480, y: 64, w: 64, h: 24 },
  { kind:"vines", x: 64, y: 64, w: 24, h: 32 },
];

/**
 * Static rects plus deterministic micro-scatter for `rows`/`seed`: the
 * static array is never mutated, so the 7-rect contract stays byte-stable.
 */
export function decorationsWithScatter(rows: string[] | string, seed: number): Decoration[] {
  return [...decorations, ...generateScatterDecorations("dune", rows, seed)];
}
