// Per-map decoration data: JSON-serializable, deterministic order, >=3 per
// map, and zero overlap with `#` solid tiles on the real arena rows.
import { describe, expect, it } from "vitest";
import { TILE_SIZE, parseMapSymbols } from "../src/map";
import { decorations as kilimaDecorations, decorationsWithScatter as kilimaWithScatter } from "../src/maps/kilima";
import { decorations as duneDecorations, decorationsWithScatter as duneWithScatter } from "../src/maps/dune";
import { decorations as frostbiteDecorations, decorationsWithScatter as frostbiteWithScatter } from "../src/maps/frostbite";
import { generateScatterDecorations, scatterKindsFor, toSeedInt } from "../src/maps/scatter";

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

  it("seed=123 kilima scatter is byte-identical across two generations", () => {
    const kilimaKey = Object.keys(mapModules).find((key) => key.endsWith("/kilima.txt")) as string;
    const rows = rowsOf(kilimaKey);
    const first = generateScatterDecorations("kilima", rows, 123);
    const second = generateScatterDecorations("kilima", rows, 123);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.length).toBeGreaterThan(0);
  });

  it("scatter keeps 15-200 decorations per map across probe seeds", () => {
    for (const key of Object.keys(mapModules).sort()) {
      const base = key.split("/").pop()?.replace(/\.txt$/, "") ?? "";
      const rows = rowsOf(key);
      for (const seed of [123, 0, 1, 999]) {
        const scatter = generateScatterDecorations(base, rows, seed);
        expect(
          scatter.length,
          `${base} seed=${seed} count ${scatter.length}`,
        ).toBeGreaterThanOrEqual(15);
        expect(
          scatter.length,
          `${base} seed=${seed} count ${scatter.length}`,
        ).toBeLessThanOrEqual(200);
      }
    }
  });

  it("zero scatter rects intersect `#` solids on the real rows", () => {
    for (const key of Object.keys(mapModules).sort()) {
      const base = key.split("/").pop()?.replace(/\.txt$/, "") ?? "";
      const rows = rowsOf(key);
      const symbols = parseMapSymbols(rows);
      for (const seed of [123, 0, 999]) {
        const scatter = generateScatterDecorations(base, rows, seed);
        for (const decor of scatter) {
          expect(
            intersectsSolid(decor, (tx, ty) => symbols.map.isSolidTile(tx, ty)),
            `${base} seed=${seed} ${decor.kind}@${decor.x},${decor.y} overlaps solid`,
          ).toBe(false);
          expect(decor.w).toBeGreaterThanOrEqual(8);
          expect(decor.w).toBeLessThanOrEqual(28);
          expect(decor.h).toBeGreaterThanOrEqual(8);
          expect(decor.h).toBeLessThanOrEqual(28);
        }
      }
    }
  });

  it("scatter output is sorted by (kind, x, y) with per-map kind pools", () => {
    expect(scatterKindsFor("kilima")).toEqual([
      "grass-tuft",
      "rock",
      "valve",
      "antenna",
      "foliage",
      "vines",
    ]);
    expect(scatterKindsFor("dune")).toEqual(["rock", "valve", "antenna", "foliage", "vines"]);
    expect(scatterKindsFor("frostbite")).toEqual([
      "rock",
      "valve",
      "antenna",
      "foliage",
      "vines",
    ]);
    expect(scatterKindsFor("bogus")).toEqual(scatterKindsFor("kilima"));
    for (const key of Object.keys(mapModules).sort()) {
      const base = key.split("/").pop()?.replace(/\.txt$/, "") ?? "";
      const pool = scatterKindsFor(base);
      const scatter = generateScatterDecorations(base, rowsOf(key), 123);
      for (let i = 1; i < scatter.length; i += 1) {
        const prev = scatter[i - 1] as Decoration;
        const cur = scatter[i] as Decoration;
        const order =
          prev.kind < cur.kind ? -1 : prev.kind > cur.kind ? 1 : prev.x - cur.x || prev.y - cur.y;
        expect(order, `${base} scatter out of (kind, x, y) order at ${i}`).toBeLessThanOrEqual(0);
      }
      for (const decor of scatter) {
        expect(pool).toContain(decor.kind);
      }
    }
  });

  it("decorationsWithScatter keeps the static array untouched and additive", () => {
    const byMap = {
      kilima: { static: kilimaDecorations, withScatter: kilimaWithScatter },
      dune: { static: duneDecorations, withScatter: duneWithScatter },
      frostbite: { static: frostbiteDecorations, withScatter: frostbiteWithScatter },
    } as const;
    for (const key of Object.keys(mapModules).sort()) {
      const base = (key.split("/").pop()?.replace(/\.txt$/, "") ?? "") as keyof typeof byMap;
      const rows = rowsOf(key);
      const before = JSON.stringify(byMap[base].static);
      const combined = byMap[base].withScatter(rows, 123);
      expect(JSON.stringify(byMap[base].static)).toBe(before);
      expect(combined.length).toBeGreaterThanOrEqual(15);
      expect(combined.length).toBeLessThanOrEqual(203);
      expect(combined.slice(0, byMap[base].static.length)).toEqual([...byMap[base].static]);
      const again = byMap[base].withScatter(rows, 123);
      expect(JSON.stringify(combined)).toBe(JSON.stringify(again));
    }
  });

  it("toSeedInt coerces present seeds exactly like Number() with a 0 fallback", () => {
    expect(toSeedInt(123)).toBe(123);
    expect(toSeedInt("123")).toBe(123);
    expect(toSeedInt(" 123 ")).toBe(123);
    expect(toSeedInt(123.9)).toBe(123);
    expect(toSeedInt("123.9")).toBe(123);
    expect(toSeedInt(undefined)).toBe(0);
    expect(toSeedInt(null)).toBe(0);
    expect(toSeedInt(NaN)).toBe(0);
    expect(toSeedInt("abc")).toBe(0);
    expect(toSeedInt(Infinity)).toBe(0);
  });

  it("string seeds paint byte-identical scatter to the same numeric seed", () => {
    for (const key of Object.keys(mapModules).sort()) {
      const base = key.split("/").pop()?.replace(/\.txt$/, "") ?? "";
      const rows = rowsOf(key);
      expect(JSON.stringify(generateScatterDecorations(base, rows, "123"))).toBe(
        JSON.stringify(generateScatterDecorations(base, rows, 123)),
      );
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
