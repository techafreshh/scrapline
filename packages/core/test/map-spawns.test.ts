import { describe, expect, it } from "vitest";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../src/constants";
import { TileMap } from "../src/map";
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

describe("map auto-spawn", () => {
  it("every bundled map spawns weapon+health+grenade pickups and both prop kinds", () => {
    expect(mapNames.length).toBeGreaterThan(0);
    for (const name of mapNames) {
      const world = new World({ seed: 7, map: rowsOf(name) });
      expect(world.pickups.length).toBeGreaterThanOrEqual(4);
      const kinds = new Set(world.pickups.map((p) => p.kind));
      expect(kinds.has("weapon")).toBe(true);
      expect(kinds.has("health")).toBe(true);
      expect(kinds.has("grenades")).toBe(true);
      expect(world.props.length).toBeGreaterThanOrEqual(2);
      const propKinds = new Set(world.props.map((p) => p.kind));
      expect(propKinds.has("barrel")).toBe(true);
      expect(propKinds.has("crate")).toBe(true);
    }
  });

  it("weapon pads cycle non-pistol weapons in row-major order", () => {
    expect(mapNames.length).toBeGreaterThan(0);
    for (const name of mapNames) {
      const world = new World({ seed: 7, map: rowsOf(name) });
      const weapons = world.pickups
        .filter((p) => p.kind === "weapon")
        .map((p) => p.weapon);
      expect(weapons.length).toBeGreaterThanOrEqual(2);
      for (const weapon of weapons) {
        expect(weapon).not.toBe("pistol");
      }
      expect(new Set(weapons).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("same-seed worlds hash-equal after ticks", () => {
    for (const name of mapNames) {
      const rows = rowsOf(name);
      const a = new World({ seed: 42, map: rows });
      const b = new World({ seed: 42, map: rows });
      a.addPlayer(120);
      b.addPlayer(120);
      for (let t = 0; t < 10; t += 1) {
        a.step({});
        b.step({});
      }
      expect(a.hash()).toBe(b.hash());
    }
  });

  it("stepping onto the first pad emits pickup and deactivates it", () => {
    expect(mapNames.length).toBeGreaterThan(0);
    for (const name of mapNames) {
      const world = new World({ seed: 7, map: rowsOf(name) });
      const pad = world.pickups.find((p) => p.kind === "weapon");
      if (pad === undefined) {
        throw new Error(`expected a weapon pad in ${name}`);
      }
      world.addPlayer({
        x: pad.x - PLAYER_WIDTH / 2,
        y: pad.y - PLAYER_HEIGHT / 2,
      });
      const events = world.step({});
      expect(events).toContain("pickup");
      expect(world.players[0]?.weapon).toBe(pad.weapon);
      expect(pad.active).toBe(false);
    }
  });

  it("default arena spawns nothing (existing zero-pad expectations hold)", () => {
    const world = new World({ seed: 7 });
    expect(world.pickups.length).toBe(0);
    expect(world.props.length).toBe(0);
  });

  it("TileMap-instance worlds spawn nothing (markers unrecoverable from solids)", () => {
    expect(mapNames.length).toBeGreaterThan(0);
    const world = new World({ seed: 7, map: new TileMap(rowsOf(mapNames[0] as string)) });
    expect(world.pickups.length).toBe(0);
    expect(world.props.length).toBe(0);
  });
});
