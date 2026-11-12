// Static arena registry: the three shipped maps inlined at build time
// via Vite `?raw` (same eager-query idiom as the core map-content tests),
// so the staged dist/ stays self-contained for file:// and subpath
// hosting — no HTTP fetch, no new server.js route.
import duneRaw from "../../core/src/maps/dune.txt?raw";
import frostbiteRaw from "../../core/src/maps/frostbite.txt?raw";
import kilimaRaw from "../../core/src/maps/kilima.txt?raw";

/** Arena names in menu order. */
export const MAP_NAMES = ["kilima", "dune", "frostbite"] as const;

/** Arena name union. */
export type MapName = (typeof MAP_NAMES)[number];

/** Trim/split normalizer matching the core map-content test rowsOf. */
function rowsOf(raw: string): string[] {
  return raw
    .trim()
    .split("\n")
    .map((row) => (row.endsWith("\r") ? row.slice(0, -1) : row));
}

const ROWS: Record<MapName, string[]> = {
  kilima: rowsOf(kilimaRaw),
  dune: rowsOf(duneRaw),
  frostbite: rowsOf(frostbiteRaw),
};

/** Case-insensitive arena-name guard (trims surrounding whitespace). */
export function isMapName(value: unknown): value is MapName {
  if (typeof value !== "string") {
    return false;
  }
  return (MAP_NAMES as readonly string[]).includes(value.trim().toLowerCase());
}

/**
 * ASCII rows for an arena name (case-insensitive, whitespace-tolerant);
 * null when unknown. Returns a copy so callers cannot mutate the cache.
 */
export function mapRowsFor(name: unknown): string[] | null {
  if (typeof name !== "string") {
    return null;
  }
  const key = name.trim().toLowerCase();
  if (!isMapName(key)) {
    return null;
  }
  return ROWS[key].slice();
}
