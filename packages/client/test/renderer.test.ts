// Renderer view-model tests: describeFrame stays pure (no browser needed)
// and reports correct player boxes, arena dims, and empty-state safety.
import { describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import { TILE_SIZE } from "../../core/src/map";
import { describeFrame } from "../src/renderer/index";
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
