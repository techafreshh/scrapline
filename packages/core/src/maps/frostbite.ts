// Frostbite station dressing: static per-map decoration rects in world pixels
// (y-down, TILE_SIZE 32, arena 1280x640). Pure data: no imports of any kind,
// JSON-serializable, deterministic order. All rects sit in the verified-empty
// sky band (rows 0-2, center columns) so no rect intersects a `#` solid.
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

/** Frostbite decorations: ice-sheen, antenna-dishes, window-lights. */
export const decorations: Decoration[] = [
  { kind:"ice-sheen", x: 448, y: 32, w: 192, h: 24 },
  { kind:"antenna-dishes", x: 672, y: 0, w: 64, h: 64 },
  { kind:"window-lights", x: 768, y: 32, w: 128, h: 24 },
];
