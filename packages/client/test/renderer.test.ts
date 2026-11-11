// Renderer view-model tests: describeFrame stays pure (no browser needed)
// and reports correct player boxes, arena dims, and empty-state safety.
import { describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import { TILE_SIZE } from "../../core/src/map";
import { describeFrame } from "../src/renderer/index";

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
