import { describe, expect, it } from "vitest";
import {
  TileMap,
  assertMapReachable,
  findPath,
  parseMapSymbols,
  spawnConnectedCells,
  validateMapReachable,
} from "../src/map";
import { World } from "../src/world";

// Auto-discovering arena files: one ASCII file per map, no registry to
// update when a tinkerer drops in a new arena. Raw-text glob keeps this
// test free of Node imports so core lint bans stay green.
const mapModules = import.meta.glob<string>("../src/maps/*.txt", {
  eager: true,
  query: "?raw",
  import: "default",
});
const mapNames = Object.keys(mapModules).sort();

function rowsOf(name: string): string[] {
  const raw = mapModules[name] as unknown as string;
  return raw
    .trim()
    .split("\n")
    .map((r) => (r.endsWith("\r") ? r.slice(0, -1) : r));
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function farthestSpawnPair(spawns: { x: number; y: number }[]): [
  { x: number; y: number },
  { x: number; y: number },
] {
  let best: [{ x: number; y: number }, { x: number; y: number }] | null = null;
  let bestDist = -1;
  for (let i = 0; i < spawns.length; i += 1) {
    for (let j = i + 1; j < spawns.length; j += 1) {
      const a = spawns[i] as { x: number; y: number };
      const b = spawns[j] as { x: number; y: number };
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (dist > bestDist) {
        bestDist = dist;
        best = [a, b];
      }
    }
  }
  if (best === null) {
    throw new Error("expected at least two spawns");
  }
  return best;
}

describe("map files", () => {
  it("ships at least three ASCII arenas", () => {
    expect(mapNames.length).toBeGreaterThanOrEqual(3);
  });

  it("every arena is a 40x20 grid using only .#SPHGB=^:", () => {
    expect(mapNames.length).toBeGreaterThan(0);
    for (const name of mapNames) {
      const rows = rowsOf(name);
      expect(rows.length).toBe(20);
      for (const row of rows) {
        expect(row.length).toBe(40);
        expect(row).toMatch(/^[.#SPHGB=^:]+$/);
      }
    }
  });

  it("every arena marks spawns (S) and weapon pads (P)", () => {
    expect(mapNames.length).toBeGreaterThan(0);
    for (const name of mapNames) {
      const raw = mapModules[name] as unknown as string;
      expect(raw).toContain("S");
      expect(raw).toContain("P");
    }
  });

  it("every arena has 2+ spawns, 2+ pads, a health and a grenade crate", () => {
    for (const name of mapNames) {
      const symbols = parseMapSymbols(rowsOf(name));
      expect(symbols.spawns.length).toBeGreaterThanOrEqual(2);
      expect(symbols.pads.length).toBeGreaterThanOrEqual(2);
      expect(symbols.health.length).toBeGreaterThanOrEqual(1);
      expect(symbols.grenades.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("map reachability", () => {
  it("every spawn reaches every weapon pad via A-star", () => {
    expect(mapNames.length).toBeGreaterThan(0);
    for (const name of mapNames) {
      const symbols = parseMapSymbols(rowsOf(name));
      expect(validateMapReachable(symbols)).toBe(true);
      expect(() => assertMapReachable(symbols)).not.toThrow();
      for (const from of symbols.spawns) {
        for (const to of symbols.pads) {
          expect(findPath(symbols.map, from, to).length).toBeGreaterThan(0);
          expect(symbols.map.findPath(from, to).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("kilima farthest spawns connect via findPath", () => {
    const kilima = mapNames.find((name) => name.endsWith("kilima.txt"));
    expect(kilima).toBeDefined();
    const symbols = parseMapSymbols(rowsOf(kilima as string));
    expect(symbols.spawns.length).toBeGreaterThanOrEqual(2);
    const [a, b] = farthestSpawnPair(symbols.spawns);
    const path = findPath(symbols.map, a, b);
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual({ x: a.x, y: a.y });
    expect(path[path.length - 1]).toEqual({ x: b.x, y: b.y });
    const methodPath = symbols.map.findPath(a, b);
    expect(methodPath.length).toBeGreaterThan(0);
  });

  it("kilima outpost arena meets the count and weapon-coverage contract", () => {
    const kilima = mapNames.find((name) => name.endsWith("kilima.txt"));
    expect(kilima).toBeDefined();
    const rows = rowsOf(kilima as string);
    const symbols = parseMapSymbols(rows);
    expect(symbols.spawns.length).toBe(12);
    expect(symbols.pads.length).toBeGreaterThanOrEqual(5);
    expect(symbols.health.length).toBeGreaterThanOrEqual(2);
    expect(symbols.grenades.length).toBeGreaterThanOrEqual(1);
    const bouncePads = rows.join("").split("").filter((ch) => ch === "B").length;
    expect(bouncePads).toBeGreaterThanOrEqual(1);
    const world = new World({ seed: 7, map: rows });
    const weapons = new Set(
      world.pickups.filter((pickup) => pickup.kind === "weapon").map((pickup) => pickup.weapon),
    );
    for (const required of ["rifle", "shotgun", "sniper", "rocket"] as const) {
      expect(weapons.has(required)).toBe(true);
    }
    for (const spawn of symbols.spawns) {
      expect(symbols.map.isSolidTile(spawn.x, spawn.y)).toBe(false);
    }
    const region = spawnConnectedCells(symbols);
    let platformTiles = 0;
    for (let y = 0; y < symbols.map.heightTiles; y += 1) {
      for (let x = 0; x < symbols.map.widthTiles; x += 1) {
        if (!symbols.map.isSolidTile(x, y)) {
          continue;
        }
        if (
          region.has(tileKey(x + 1, y)) ||
          region.has(tileKey(x - 1, y)) ||
          region.has(tileKey(x, y + 1)) ||
          region.has(tileKey(x, y - 1))
        ) {
          platformTiles += 1;
        }
      }
    }
    expect(platformTiles).toBeGreaterThanOrEqual(10);
  });

  it("TileMap treats markers as free tiles and # as solid", () => {
    const symbols = parseMapSymbols(rowsOf(mapNames[0] as string));
    const map: TileMap = symbols.map;
    for (const tile of [...symbols.spawns, ...symbols.pads, ...symbols.health, ...symbols.grenades]) {
      expect(map.isSolidTile(tile.x, tile.y)).toBe(false);
    }
  });
});
