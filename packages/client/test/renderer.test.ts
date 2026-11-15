// Renderer view-model tests: describeFrame stays pure (no browser needed)
// and reports correct player boxes, arena dims, and empty-state safety.
import { describe, expect, it } from "vitest";
import { TileMap, TILE_SIZE } from "../../core/src/map";
import { World } from "../../core/src/world";
import { BARREL_LENGTH, barrelEndpoint, describeFrame } from "../src/renderer/index";
import { collectTileLayers } from "../src/view/tiles";
import { createCamera as createTileCamera } from "../src/renderer/camera";
import {
  cameraTarget,
  createCamera,
  updateCamera,
  visibleTileRange,
} from "../src/renderer/camera";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

describe("describeFrame", () => {
  it("maps a two-player world state after one step", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 300, y });
    world.step([{}, {}]);
    const frame = describeFrame(world.state, world.map);
    expect(frame.tick).toBe(1);
    expect(frame.players).toHaveLength(2);
    expect(frame.players[0]).toMatchObject({ w: 26, h: 58, alive: true });
    expect(frame.players[1]).toMatchObject({ w: 26, h: 58, alive: true });
    expect(frame.arena.width).toBe(world.map.widthPixels);
    expect(frame.arena.height).toBe(world.map.heightPixels);
    expect(frame.arena.width).toBe(40 * TILE_SIZE);
    expect(frame.arena.height).toBe(20 * TILE_SIZE);
  });

  it("reports crouch height for crouching players", () => {
    const world = new World({ seed: 1 });
    world.addPlayer({ x: 100 });
    world.step([{ crouch: true }]);
    const frame = describeFrame(world.state, world.map);
    expect(frame.players[0]).toMatchObject({ w: 26, h: 40 });
  });

  it("yields a populated frame with a tile range of at least 4 tiles", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.step([{}]);
    const frame = describeFrame(world.state, world.map);
    expect(frame.players).toHaveLength(1);
    expect(frame.players[0]).toMatchObject({ w: 26, h: 58 });
    const player = frame.players[0];
    const cam = createCamera(world.map.widthPixels, world.map.heightPixels);
    const target = cameraTarget(player.x + player.w / 2, player.y + player.h / 2, 0);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, target.x, target.y, world.map.widthPixels, world.map.heightPixels);
    }
    const range = visibleTileRange(
      cam,
      640,
      360,
      world.map.widthPixels,
      world.map.heightPixels,
    );
    const cells = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    expect(cells).toBeGreaterThanOrEqual(4);
  });

  it("preserves stable sim pickup ids for frame-driven keying", () => {
    const world = new World({ seed: 1 });
    world.addPickup("weapon", 100, 200, "rifle");
    world.addPickup("health", 300, 200);
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.step([{}]);
    const frame = describeFrame(world.state, world.map);
    expect(frame.pickups.length).toBe(world.state.pickups.length);
    expect(frame.pickups.length).toBeGreaterThan(0);
    for (let i = 0; i < frame.pickups.length; i += 1) {
      expect(frame.pickups[i].id).toBe(world.state.pickups[i].id);
    }
    world.step([{}]);
    const next = describeFrame(world.state, world.map);
    for (let i = 0; i < next.pickups.length; i += 1) {
      expect(next.pickups[i].id).toBe(world.state.pickups[i].id);
    }
  });

  it("is safe on an empty state with default arena dims", () => {
    const frame = describeFrame({
      tick: 0,
      players: [],
      projectiles: [],
      pickups: [],
      props: [],
    });
    expect(frame.players).toEqual([]);
    expect(frame.projectiles).toEqual([]);
    expect(frame.arena.width).toBe(40 * TILE_SIZE);
    expect(frame.arena.height).toBe(20 * TILE_SIZE);
  });
});

describe("barrelEndpoint", () => {
  const cx = 100;
  const cy = 200;
  it.each([
    { aim: 0, ex: cx + BARREL_LENGTH, ey: cy },
    { aim: Math.PI / 2, ex: cx, ey: cy + BARREL_LENGTH },
    { aim: Math.PI, ex: cx - BARREL_LENGTH, ey: cy },
    { aim: -Math.PI / 2, ex: cx, ey: cy - BARREL_LENGTH },
  ])("aim $aim lands at pos + dir(aim) * length", ({ aim, ex, ey }) => {
    const tip = barrelEndpoint(cx, cy, aim);
    expect(tip.x).toBeCloseTo(ex, 10);
    expect(tip.y).toBeCloseTo(ey, 10);
  });

  it("wires the enemy barrel tip through describeFrame", () => {
    const world = new World({ seed: 1 });
    const y = floorY();
    world.addPlayer({ x: 100, y });
    world.addPlayer({ x: 300, y });
    world.step([{}, {}]);
    const frame = describeFrame(world.state, world.map);
    const enemy = frame.players[1];
    const sim = world.state.players[1];
    const expected = barrelEndpoint(
      enemy.x + enemy.w / 2,
      enemy.y + enemy.h / 2,
      sim.aim,
    );
    expect(enemy.barrel.x).toBeCloseTo(expected.x, 10);
    expect(enemy.barrel.y).toBeCloseTo(expected.y, 10);
    const length = Math.hypot(
      enemy.barrel.x - (enemy.x + enemy.w / 2),
      enemy.barrel.y - (enemy.y + enemy.h / 2),
    );
    expect(length).toBeCloseTo(BARREL_LENGTH, 10);
  });
});

describe("terrain edge blending", () => {
  it("merges two adjacent solids with no internal edge", () => {
    const map = new TileMap(["##", ".."]);
    const cam = createTileCamera(map.widthPixels, map.heightPixels);
    const layers = collectTileLayers(map, cam, 640, 360, map.widthPixels, map.heightPixels);
    expect(layers.solids).toHaveLength(2);
    const left = layers.solids.find((cell) => cell.tx === 0 && cell.ty === 0);
    const right = layers.solids.find((cell) => cell.tx === 1 && cell.ty === 0);
    expect(left?.exposed).toBeDefined();
    expect(right?.exposed).toBeDefined();
    // Shared join exposes no edge on either side: zero-seam probe.
    expect(left?.exposed?.right).toBe(false);
    expect(right?.exposed?.left).toBe(false);
    // Top row stays sky-exposed so the highlight cap keeps painting.
    expect(left?.exposed?.top).toBe(true);
    expect(right?.exposed?.top).toBe(true);
  });
});
