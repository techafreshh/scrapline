// Dune refinery dressing: static per-map decoration rects in world pixels
// (y-down, TILE_SIZE 32, arena 1280x640). Pure data: no imports of any kind,
// JSON-serializable, deterministic order. All rects sit in the verified-empty
// sky band (rows 0-2, center-free columns) so no rect intersects a `#` solid.
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

/** Dune decorations: pipes, vats, catwalk-rails. */
export const decorations: Decoration[] = [
  { kind:"pipes", x: 384, y: 32, w: 160, h: 24 },
  { kind:"vats", x: 576, y: 32, w: 64, h: 64 },
  { kind:"catwalk-rails", x: 768, y: 64, w: 160, h: 16 },
];
