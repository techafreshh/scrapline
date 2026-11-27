// Deterministic micro-decoration scatter: seeded rejection sampler over
// free tiles. Pure (no DOM, Node, clock, or Math.random): every draw flows
// through `createRng(seed).fork("decor:<map>")` in fixed order (count, then
// per-item kind/tile/size/offset), so the same seed and map rows always
// produce byte-identical output. Rects are small (8-28px), axis-aligned,
// integer px in y-down world coords, clamped into the arena and rejected
// when they touch a `#` solid tile, so gameplay tiles are never occluded.
// Sorted by (kind, x, y) for a canonical JSON order.
import { TILE_SIZE, TileMap } from "../map";
import { createRng } from "../rng";

/** Scattered decoration rect in world px (structural twin of map data). */
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

/** Shipped arena names carrying a scatter pool (all others fall back). */
const KNOWN_MAPS = ["kilima", "dune", "frostbite"] as const;

/** Per-map micro-kind pools (small w/h ranges below, all 8-28px).
 * Foliage clusters and hanging vines fill the terrain edges on every
 * theme at mockup density (issue #403); kilima leans lush while dune
 * and frostbite mix scrub with their industrial dressing. */
const KIND_POOLS: Record<string, string[]> = {
  kilima: ["grass-tuft", "rock", "valve", "antenna", "foliage", "vines"],
  dune: ["rock", "valve", "antenna", "foliage", "vines"],
  frostbite: ["rock", "valve", "antenna", "foliage", "vines"],
};

/** Inclusive [minW, maxW, minH, maxH] px size range per scatter kind. */
const SIZE_RANGES: Record<string, [number, number, number, number]> = {
  "grass-tuft": [12, 24, 8, 16],
  rock: [10, 24, 8, 18],
  valve: [8, 16, 10, 20],
  antenna: [8, 12, 16, 28],
  foliage: [16, 28, 12, 24],
  vines: [8, 16, 16, 28],
};

/** Fallback size range for kinds outside the pool (keeps 8-28px). */
const DEFAULT_SIZE_RANGE: [number, number, number, number] = [8, 16, 8, 16];

/** Normalize an arena name; unknown values fall back to kilima. */
function normalizeMapName(value: unknown): string {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if ((KNOWN_MAPS as readonly string[]).includes(key)) {
      return key;
    }
  }
  return "kilima";
}

/** Finite seeds floor to an int; anything else reads as seed 0. */
export function toSeedInt(seed: unknown): number {
  const n = typeof seed === "number" ? seed : Number(seed);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.floor(n);
}

/** Scatter kind pool for an arena name (copy; unknown names read kilima). */
export function scatterKindsFor(mapName: unknown): string[] {
  const name = normalizeMapName(mapName);
  return (KIND_POOLS[name] ?? KIND_POOLS["kilima"] as string[]).slice();
}

/** True when the rect touches any `#` solid tile (exclusive bottom/right). */
function intersectsSolid(
  x: number,
  y: number,
  w: number,
  h: number,
  isSolidTile: (tx: number, ty: number) => boolean,
): boolean {
  if (!(w > 0 && h > 0)) {
    return false;
  }
  const tx0 = Math.floor(x / TILE_SIZE);
  const tx1 = Math.floor((x + w - 1) / TILE_SIZE);
  const ty0 = Math.floor(y / TILE_SIZE);
  const ty1 = Math.floor((y + h - 1) / TILE_SIZE);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (isSolidTile(tx, ty)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Deterministic scatter rects for an arena: static-map companion to the
 * per-map `decorations` arrays. Draws a per-map count in 90-180 (safely
 * inside the 15-200 acceptance band) at mockup foliage density
 * (issue #403) from the forked stream, then samples
 * free tiles with rejection on solid overlap. Returns plain
 * JSON-serializable rects sorted by (kind, x, y).
 */
export function generateScatterDecorations(
  mapName: unknown,
  rows: string[] | string,
  seed: unknown,
): Decoration[] {
  const name = normalizeMapName(mapName);
  const list =
    typeof rows === "string"
      ? rows.split("\n")
      : Array.isArray(rows)
        ? (rows as string[]).slice()
        : [];
  const map = new TileMap(list);
  if (map.widthTiles <= 0 || map.heightTiles <= 0) {
    return [];
  }
  const rng = createRng(toSeedInt(seed)).fork(`decor:${name}`);
  const pool = KIND_POOLS[name] ?? (KIND_POOLS["kilima"] as string[]);
  const free: Array<{ x: number; y: number }> = [];
  for (let ty = 0; ty < map.heightTiles; ty += 1) {
    for (let tx = 0; tx < map.widthTiles; tx += 1) {
      if (!map.isSolidTile(tx, ty)) {
        free.push({ x: tx, y: ty });
      }
    }
  }
  if (free.length === 0) {
    return [];
  }
  const target = 90 + Math.floor(rng.next() * 91);
  const arenaW = map.widthTiles * TILE_SIZE;
  const arenaH = map.heightTiles * TILE_SIZE;
  const seen = new Set<string>();
  const out: Decoration[] = [];
  const maxAttempts = target * 25 + 100;
  let attempts = 0;
  while (out.length < target && attempts < maxAttempts) {
    attempts += 1;
    const kind = pool[Math.floor(rng.next() * pool.length)] as string;
    const tile = free[Math.floor(rng.next() * free.length)] as { x: number; y: number };
    const range = SIZE_RANGES[kind] ?? DEFAULT_SIZE_RANGE;
    const w = range[0] + Math.floor(rng.next() * (range[1] - range[0] + 1));
    const h = range[2] + Math.floor(rng.next() * (range[3] - range[2] + 1));
    // Offsets stay inside the chosen free tile so the rect can never
    // spill onto a neighboring solid tile; the exclusion test below is
    // the backstop (plus the arena clamp for short-row padding edges).
    const ox = Math.floor(rng.next() * (TILE_SIZE - w + 1));
    const oy = Math.floor(rng.next() * (TILE_SIZE - h + 1));
    const x = Math.min(Math.max(tile.x * TILE_SIZE + ox, 0), Math.max(0, arenaW - w));
    const y = Math.min(Math.max(tile.y * TILE_SIZE + oy, 0), Math.max(0, arenaH - h));
    if (intersectsSolid(x, y, w, h, (tx, ty) => map.isSolidTile(tx, ty))) {
      continue;
    }
    const key = `${kind}:${x},${y},${w},${h}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ kind, x, y, w, h });
  }
  out.sort((a, b) => {
    if (a.kind < b.kind) {
      return -1;
    }
    if (a.kind > b.kind) {
      return 1;
    }
    if (a.x !== b.x) {
      return a.x - b.x;
    }
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    if (a.w !== b.w) {
      return a.w - b.w;
    }
    return a.h - b.h;
  });
  return out;
}
