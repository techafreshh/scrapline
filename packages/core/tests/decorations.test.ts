// Per-map decoration data: JSON-serializable, deterministic order, >=3 per
// map, and zero overlap with `#` solid tiles on the real arena rows.
import { describe, expect, it } from "vitest";
import { TILE_SIZE, parseMapSymbols } from "../src/map";
import { decorations as kilimaDecorations } from "../src/maps/kilima";
import { decorations as duneDecorations } from "../src/maps/dune";
import { decorations as frostbiteDecorations } from "../src/maps/frostbite";

interface Decoration {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const BY_MAP: Record<string, Decoration[]> = {
  kilima: kilimaDecorations as Decoration[],
  dune: duneDecorations as Decoration[],
  frostbite: frostbiteDecorations as Decoration[],
};

// Same eager `?raw` arena loading idiom as map-content.test.ts.
const mapModules = import.meta.glob<string>("../src/maps/*.txt", {
  eager: true,
  query: "?raw",
  import: "default",
});

function rowsOf(name: string): string[] {
  const raw = mapModules[name] as unknown as string;
  return raw
    .trim()
    .split("\n")
    .map((r) => (r.endsWith("\r") ? r.slice(0, -1) : r));
}

/** True when the rect touches any `#` solid tile (exclusive bottom/right). */
function intersectsSolid(
  decor: Decoration,
  isSolidTile: (tx: number, ty: number) => boolean,
): boolean {
  if (!(decor.w > 0 && decor.h > 0)) {
    return false;
  }
  const tx0 = Math.floor(decor.x / TILE_SIZE);
  const tx1 = Math.floor((decor.x + decor.w - 1) / TILE_SIZE);
  const ty0 = Math.floor(decor.y / TILE_SIZE);
  const ty1 = Math.floor((decor.y + decor.h - 1) / TILE_SIZE);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (isSolidTile(tx, ty)) {
        return true;
      }
    }
  }
  return false;
}

describe("map decorations", () => {
  it("every map carries >=3 decorations", () => {
    for (const name of Object.keys(BY_MAP).sort()) {
      expect((BY_MAP[name] as Decoration[]).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("decorations are JSON-serializable with deterministic order across two loads", () => {
    for (const name of Object.keys(BY_MAP).sort()) {
      const decors = BY_MAP[name] as Decoration[];
      const roundTrip = JSON.parse(JSON.stringify(decors)) as unknown;
      expect(roundTrip).toEqual(decors);
      expect(JSON.stringify(decors)).toBe(JSON.stringify(decors));
    }
  });

  it("no decoration rect intersects a `#` solid tile", () => {
    for (const key of Object.keys(mapModules).sort()) {
      const base = key.split("/").pop()?.replace(/\.txt$/, "") ?? "";
      const decors = BY_MAP[base];
      expect(decors).toBeDefined();
      const rows = rowsOf(key);
      const symbols = parseMapSymbols(rows);
      for (const decor of decors as Decoration[]) {
        expect(
          intersectsSolid(decor, (tx, ty) => symbols.map.isSolidTile(tx, ty)),
          `${base}:${decor.kind} overlaps solid`,
        ).toBe(false);
      }
    }
  });
});
