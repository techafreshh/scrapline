import { describe, expect, it } from "vitest";
import { TILE_SIZE, TileMap, findPath } from "../src/map";

// Canonical rows mirroring packages/core/test/test-map.txt: columns 0-2
// empty, column 3+ solid on the top two rows.
const ROWS = ["...#####", "...#####", "........", "........"];

function openGrid(blockedAt: { x: number; y: number } | null = { x: 5, y: 5 }): number[][] {
  const grid: number[][] = [];
  for (let y = 0; y < 10; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < 10; x += 1) {
      row.push(blockedAt !== null && x === blockedAt.x && y === blockedAt.y ? 1 : 0);
    }
    grid.push(row);
  }
  return grid;
}

describe("TileMap isSolidAt", () => {
  it("returns true inside the wall and false in empty space", () => {
    const map = new TileMap(ROWS);
    expect(TILE_SIZE).toBe(32);
    expect(map.isSolidAt(100, 16)).toBe(true);
    expect(map.isSolidAt(16, 16)).toBe(false);
  });

  it("treats out-of-bounds tiles and pixels as solid", () => {
    const map = new TileMap(ROWS);
    expect(map.isSolidTile(-1, 0)).toBe(true);
    expect(map.isSolidTile(0, -1)).toBe(true);
    expect(map.isSolidTile(100, 100)).toBe(true);
    expect(map.isSolidAt(-1, 16)).toBe(true);
    expect(map.isSolidAt(10000, 10000)).toBe(true);
  });
});

describe("TileMap raycast", () => {
  it("hits the wall with fraction 0.4-0.7 and hit x 80-96", () => {
    const map = new TileMap(ROWS);
    const hit = map.raycast(16, 16, 160, 16);
    expect(hit.hit).toBe(true);
    expect(hit.fraction).toBeGreaterThanOrEqual(0.4);
    expect(hit.fraction).toBeLessThanOrEqual(0.7);
    expect(hit.x).toBeGreaterThanOrEqual(80);
    expect(hit.x).toBeLessThanOrEqual(96);
    expect(hit.t).toBe(hit.fraction);
    expect(hit.point.x).toBe(hit.x);
    expect(hit.point.y).toBe(hit.y);
  });

  it("reports a miss with t 1 at the endpoint in empty space", () => {
    const map = new TileMap(["........", "........", "........", "........"]);
    const miss = map.raycast(8, 80, 200, 80);
    expect(miss.hit).toBe(false);
    expect(miss.t).toBe(1);
    expect(miss.fraction).toBe(1);
    expect(miss.x).toBe(200);
    expect(miss.y).toBe(80);
  });

  it("reports t 0 when starting inside a solid tile", () => {
    const map = new TileMap(ROWS);
    const hit = map.raycast(100, 16, 200, 16);
    expect(hit.hit).toBe(true);
    expect(hit.t).toBe(0);
    expect(hit.fraction).toBe(0);
  });
});

describe("TileMap collideBox", () => {
  it("stops flush against a wall and never overlaps solid", () => {
    const map = new TileMap(ROWS);
    const res = map.collideBox(50, 0, 26, 58, 50, 0);
    expect(res.hitX).toBe(true);
    expect(res.hitY).toBe(false);
    expect(res.collided).toBe(true);
    expect(res.x).toBe(96 - 26);
    const corners = [
      [res.x, res.y],
      [res.x + 26 - 0.5, res.y],
      [res.x, res.y + 58 - 0.5],
      [res.x + 26 - 0.5, res.y + 58 - 0.5],
    ];
    for (const [px, py] of corners) {
      expect(map.isSolidAt(px, py)).toBe(false);
    }
  });

  it("falls flush onto a floor row", () => {
    const map = new TileMap(["....", "....", "####"]);
    const res = map.collideBox(0, 0, 26, 30, 0, 60);
    expect(res.hitY).toBe(true);
    expect(res.y).toBe(64 - 30);
  });
});

describe("findPath A-star", () => {
  it("routes around one blocked cell with length > 10 (jet off and on)", () => {
    for (const jet of [false, true]) {
      const path = findPath(openGrid(), { x: 0, y: 0 }, { x: 9, y: 9 }, { jet });
      expect(path.length).toBeGreaterThan(10);
      expect(path.some((p) => p.x === 5 && p.y === 5)).toBe(false);
      expect(path[0]).toEqual({ x: 0, y: 0 });
      expect(path[path.length - 1]).toEqual({ x: 9, y: 9 });
    }
  });

  it("accepts tuple endpoints and stays deterministic", () => {
    const grid = openGrid();
    const a = findPath(grid, [0, 0], [9, 9]);
    const b = findPath(grid, [0, 0], [9, 9]);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
    for (let i = 1; i < a.length; i += 1) {
      const dx = Math.abs((a[i] as { x: number }).x - (a[i - 1] as { x: number }).x);
      const dy = Math.abs((a[i] as { y: number }).y - (a[i - 1] as { y: number }).y);
      expect(dx + dy).toBe(1);
    }
  });

  it("returns [] when the goal is unreachable", () => {
    const grid = ["#####", "#####", "#####"];
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([]);
  });

  it("TileMap method finds a valid path on its own tiles", () => {
    const map = new TileMap([
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
    ]);
    for (const jet of [false, true]) {
      const path = map.findPath(0, 0, 9, 9, { jet });
      expect(path.length).toBeGreaterThan(10);
    }
  });
});
