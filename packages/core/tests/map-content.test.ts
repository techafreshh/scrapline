import { describe, expect, it } from "vitest";
import { BotBrain } from "../src/bots/brain";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../src/constants";
import { TILE_SIZE, parseMapSymbols, spawnConnectedCells } from "../src/map";
import { World } from "../src/world";

// Auto-discovering arena files (same glob idiom as map-reachability.test.ts
// so new arenas join the proof without a registry edit).
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

describe("map content", () => {
  it("every map holds 8+ pickups, 4+ props, 10+ platform tiles in the spawn-connected region", () => {
    expect(mapNames.length).toBeGreaterThanOrEqual(3);
    for (const name of mapNames) {
      const rows = rowsOf(name);
      const symbols = parseMapSymbols(rows);
      const world = new World({ seed: 7, map: rows });
      const region = spawnConnectedCells(symbols);
      const pickupsInRegion = world.pickups.filter((pickup) =>
        region.has(
          tileKey(
            Math.floor(pickup.x / TILE_SIZE),
            Math.floor(pickup.y / TILE_SIZE),
          ),
        ),
      );
      expect(pickupsInRegion.length).toBeGreaterThanOrEqual(8);
      const propsInRegion = world.props.filter((prop) =>
        region.has(
          tileKey(
            Math.floor((prop.x + prop.w / 2) / TILE_SIZE),
            Math.floor((prop.y + prop.h / 2) / TILE_SIZE),
          ),
        ),
      );
      expect(propsInRegion.length).toBeGreaterThanOrEqual(4);
      let platformTiles = 0;
      for (let y = 0; y < symbols.map.heightTiles; y += 1) {
        for (let x = 0; x < symbols.map.widthTiles; x += 1) {
          if (!symbols.map.isSolidTile(x, y)) {
            continue;
          }
          const touchesRegion =
            region.has(tileKey(x + 1, y)) ||
            region.has(tileKey(x - 1, y)) ||
            region.has(tileKey(x, y + 1)) ||
            region.has(tileKey(x, y - 1));
          if (touchesRegion) {
            platformTiles += 1;
          }
        }
      }
      expect(platformTiles).toBeGreaterThanOrEqual(10);
    }
  });

  it("every spawn reaches every pickup without leaving the solid-connected region", () => {
    expect(mapNames.length).toBeGreaterThanOrEqual(3);
    for (const name of mapNames) {
      const rows = rowsOf(name);
      const symbols = parseMapSymbols(rows);
      expect(symbols.spawns.length).toBe(12);
      const world = new World({ seed: 7, map: rows });
      expect(world.pickups.length).toBeGreaterThanOrEqual(8);
      const pickupTiles = world.pickups.map((pickup) => ({
        x: Math.floor(pickup.x / TILE_SIZE),
        y: Math.floor(pickup.y / TILE_SIZE),
      }));
      for (const spawn of symbols.spawns) {
        expect(symbols.map.isSolidTile(spawn.x, spawn.y)).toBe(false);
        const region = spawnConnectedCells({ spawns: [spawn] }, symbols.map);
        expect(region.has(tileKey(spawn.x, spawn.y))).toBe(true);
        for (const tile of pickupTiles) {
          expect(region.has(tileKey(tile.x, tile.y))).toBe(true);
        }
      }
    }
  });

  it("kilima holds 3+ jet-required pickups 96px+ above the lowest spawns", () => {
    const kilima = mapNames.find((name) => name.endsWith("kilima.txt"));
    expect(kilima).toBeDefined();
    const rows = rowsOf(kilima as string);
    const symbols = parseMapSymbols(rows);
    const world = new World({ seed: 7, map: rows });
    const lowestRow = Math.max(...symbols.spawns.map((spawn) => spawn.y));
    const footY = (lowestRow + 1) * TILE_SIZE;
    const fullRegion = spawnConnectedCells(symbols);
    // No-ascent BFS from the lowest spawns: the hop rises less than one
    // tile, so any ascent already needs the jetpack. Only lateral and
    // downward steps are allowed here.
    const flatRegion = new Set<string>();
    const queue = symbols.spawns
      .filter((spawn) => spawn.y === lowestRow)
      .map((spawn) => ({ x: spawn.x, y: spawn.y }));
    for (const spawn of queue) {
      flatRegion.add(tileKey(spawn.x, spawn.y));
    }
    const steps: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
    ];
    while (queue.length > 0) {
      const cur = queue.pop() as { x: number; y: number };
      for (const [dx, dy] of steps) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= symbols.map.widthTiles || ny >= symbols.map.heightTiles) {
          continue;
        }
        if (symbols.map.isSolidTile(nx, ny)) {
          continue;
        }
        const key = tileKey(nx, ny);
        if (flatRegion.has(key)) {
          continue;
        }
        flatRegion.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    let jetRequired = 0;
    for (const pickup of world.pickups) {
      if (footY - pickup.y < 96) {
        continue;
      }
      const tx = Math.floor(pickup.x / TILE_SIZE);
      const ty = Math.floor(pickup.y / TILE_SIZE);
      expect(fullRegion.has(tileKey(tx, ty))).toBe(true);
      if (!flatRegion.has(tileKey(tx, ty))) {
        jetRequired += 1;
      }
    }
    expect(jetRequired).toBeGreaterThanOrEqual(3);
  });

  it("kilima ground-spawn sightlines are mostly broken by walls", () => {
    const kilima = mapNames.find((name) => name.endsWith("kilima.txt"));
    expect(kilima).toBeDefined();
    const rows = rowsOf(kilima as string);
    const symbols = parseMapSymbols(rows);
    const lowestRow = Math.max(...symbols.spawns.map((spawn) => spawn.y));
    const ground = symbols.spawns.filter((spawn) => spawn.y === lowestRow);
    expect(ground.length).toBeGreaterThanOrEqual(2);
    let blocked = 0;
    let total = 0;
    for (let i = 0; i < ground.length; i += 1) {
      for (let j = i + 1; j < ground.length; j += 1) {
        const a = ground[i] as { x: number; y: number };
        const b = ground[j] as { x: number; y: number };
        const hit = symbols.map.raycast(
          a.x * TILE_SIZE + TILE_SIZE / 2,
          a.y * TILE_SIZE + TILE_SIZE / 2,
          b.x * TILE_SIZE + TILE_SIZE / 2,
          b.y * TILE_SIZE + TILE_SIZE / 2,
        );
        total += 1;
        if (hit.hit) {
          blocked += 1;
        }
      }
    }
    expect(blocked / total).toBeGreaterThanOrEqual(0.5);
  });

  it("a 60s kilima roam observes 3+ pickups inside the roamer viewport", () => {
    const kilima = mapNames.find((name) => name.endsWith("kilima.txt"));
    expect(kilima).toBeDefined();
    const rows = rowsOf(kilima as string);
    const symbols = parseMapSymbols(rows);
    const world = new World({ seed: 7, map: rows });
    const home = symbols.spawns[0] as { x: number; y: number };
    world.addPlayer({
      x: home.x * TILE_SIZE + TILE_SIZE / 2 - PLAYER_WIDTH / 2,
      y: (home.y + 1) * TILE_SIZE - PLAYER_HEIGHT,
    });
    const brain = new BotBrain({ tier: "normal", seed: 7 });
    let seen = false;
    for (let t = 0; t < 3600; t += 1) {
      const out = brain.tick(world, 0);
      world.step([out]);
      const roamer = world.players[0];
      if (roamer === undefined) {
        continue;
      }
      const cx = roamer.x + PLAYER_WIDTH / 2;
      const cy = roamer.y + PLAYER_HEIGHT / 2;
      let inside = 0;
      for (const pickup of world.pickups) {
        if (Math.abs(pickup.x - cx) <= 725 && Math.abs(pickup.y - cy) <= 425) {
          inside += 1;
        }
      }
      if (inside >= 3) {
        seen = true;
      }
    }
    expect(world.tick).toBe(3600);
    expect(seen).toBe(true);
  });
});
