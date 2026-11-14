// Animated CC0 soldier sprites: pose-frame selection, per-weapon gun and
// muzzle geometry, palette-swap tint families, and tracer-muzzle
// coincidence. World-driven fixtures (mirroring tracers.test.ts), no DOM.
import { describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import { WEAPONS, type WeaponId } from "../../core/src/weapons";
import type { ShotDetail } from "../../core/src/events";
import {
  BARREL_LENGTH,
  barrelEndpoint,
  describeFrame,
  spawnShots,
  type Frame,
  type Muzzle,
  type Tracer,
} from "../src/renderer/index";
import { characterMuzzleFor } from "../src/view/character";
import {
  SOLDIER_FRAME_FILES,
  SOLDIER_FRAME_IDS,
  selectSoldierFrame,
  soldierAccentFor,
  soldierAccentHex,
  soldierLegOffset,
  soldierMuzzleTip,
  weaponDef,
  weaponLength,
  WEAPON_DEFS,
} from "../src/view/soldier";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function fireOnce(weapon: WeaponId): { frame: Frame; details: ShotDetail[] } {
  const world = new World({ seed: 5 });
  world.addPlayer({ x: 100, y: floorY() });
  world.players[0].weapon = weapon;
  world.players[0].magAmmo = WEAPONS[weapon].mag;
  world.step([{ fire: true, aim: 0 }]);
  const details = world.drainShotDetails();
  expect(details.length).toBeGreaterThan(0);
  return { frame: describeFrame(world.state, world.map), details };
}

describe("frame selector", () => {
  it("lists six frames with one atlas card each", () => {
    expect([...SOLDIER_FRAME_IDS]).toEqual([
      "idle",
      "run-a",
      "run-b",
      "jet",
      "crouch",
      "dead",
    ]);
    for (const id of SOLDIER_FRAME_IDS) {
      expect(SOLDIER_FRAME_FILES[id]).toMatch(/^soldier-/);
    }
    expect(SOLDIER_FRAME_FILES["crouch"]).toBe("soldier-crouch");
    expect(SOLDIER_FRAME_FILES["dead"]).toBe("soldier-dead");
  });

  it("selects dead over every other pose flag", () => {
    expect(
      selectSoldierFrame({ deadPose: true, tuck: true, swing: 6, legPhase: 3 }),
    ).toBe("dead");
    expect(selectSoldierFrame({ deadPose: true })).toBe("dead");
  });

  it("selects crouch from the explicit flag or a squashed height scale", () => {
    expect(selectSoldierFrame({ crouching: true })).toBe("crouch");
    expect(selectSoldierFrame({ crouching: true, swing: 6 })).toBe("crouch");
    expect(selectSoldierFrame({ heightScale: 40 / 58 })).toBe("crouch");
    expect(selectSoldierFrame({ heightScale: 1 })).toBe("idle");
  });

  it("selects jet while tucked", () => {
    expect(selectSoldierFrame({ tuck: true })).toBe("jet");
    expect(selectSoldierFrame({ tuck: true, swing: 6, legPhase: 9 })).toBe(
      "jet",
    );
  });

  it("alternates run-a/run-b by legPhase quadrant while swinging", () => {
    expect(selectSoldierFrame({ legPhase: 0, swing: 3 })).toBe("run-a");
    expect(selectSoldierFrame({ legPhase: Math.PI / 2, swing: 3 })).toBe(
      "run-a",
    );
    expect(selectSoldierFrame({ legPhase: Math.PI, swing: 3 })).toBe("run-b");
    expect(
      selectSoldierFrame({ legPhase: (3 * Math.PI) / 2, swing: 3 }),
    ).toBe("run-b");
    expect(selectSoldierFrame({ legPhase: 2 * Math.PI, swing: -3 })).toBe(
      "run-a",
    );
  });

  it("falls back to idle without leg swing", () => {
    expect(selectSoldierFrame({})).toBe("idle");
    expect(selectSoldierFrame({ legPhase: 7, swing: 0 })).toBe("idle");
    expect(selectSoldierFrame({ legPhase: 7, swing: 0.4 })).toBe("idle");
  });

  it("offsets run-a/run-b legs in mirrored opposition", () => {
    const a = soldierLegOffset("run-a", 4, 1);
    const b = soldierLegOffset("run-b", 4, 1);
    expect(a.dy).toBe(4);
    expect(b.dy).toBe(-4);
    expect(a.dx).toBe(0);
    const dead = soldierLegOffset("dead", 0, -1);
    expect(dead.dx).toBeLessThan(0);
    expect(dead.dy).toBeLessThan(0);
    const jet = soldierLegOffset("jet", 0, 1);
    expect(jet.dy).toBeLessThan(0);
  });
});

describe("per-weapon muzzle table", () => {
  it("keeps the pistol row on the canonical BARREL_LENGTH", () => {
    expect(BARREL_LENGTH).toBe(8);
    expect(WEAPON_DEFS["pistol"].length).toBe(BARREL_LENGTH);
    expect(weaponLength("pistol")).toBe(BARREL_LENGTH);
    expect(WEAPON_DEFS["pistol"].muzzleX).toBe(BARREL_LENGTH);
  });

  it("covers every weapon id with a positive length and width", () => {
    const ids = Object.keys(WEAPONS) as WeaponId[];
    expect(ids).toHaveLength(6);
    for (const id of ids) {
      const def = weaponDef(id);
      expect(def.length).toBeGreaterThan(0);
      expect(def.width).toBeGreaterThanOrEqual(2);
      expect(def.muzzleX).toBe(def.length);
      expect(def.colorCss).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("lies on the aim ray at the documented length for every weapon", () => {
    const ids = Object.keys(WEAPONS) as WeaponId[];
    for (const id of ids) {
      const length = WEAPON_DEFS[id].length;
      for (const aim of [0, 0.7, Math.PI / 2, Math.PI, -Math.PI / 2, -2.1]) {
        const tip = soldierMuzzleTip(100, 100, aim, id);
        expect(Math.hypot(tip.x - 100, tip.y - 100)).toBeCloseTo(length, 10);
        expect(tip.x - 100).toBeCloseTo(Math.cos(aim) * length, 10);
        expect(tip.y - 100).toBeCloseTo(Math.sin(aim) * length, 10);
      }
    }
  });

  it("matches barrelEndpoint for the pistol default via both aliases", () => {
    for (const aim of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      expect(soldierMuzzleTip(100, 100, aim)).toEqual(
        barrelEndpoint(100, 100, aim),
      );
      expect(characterMuzzleFor(100, 100, aim)).toEqual(
        barrelEndpoint(100, 100, aim),
      );
      expect(characterMuzzleFor(100, 100, aim, "pistol")).toEqual(
        barrelEndpoint(100, 100, aim),
      );
    }
  });

  it("extends the rifle tip past the pistol tip on a shared aim", () => {
    const pistol = soldierMuzzleTip(100, 100, 0, "pistol");
    const rifle = soldierMuzzleTip(100, 100, 0, "rifle");
    expect(rifle.x).toBeGreaterThan(pistol.x);
    expect(rifle.y).toBe(pistol.y);
    expect(rifle.x - 100).toBeCloseTo(WEAPON_DEFS["rifle"].length, 10);
  });
});

describe("describeFrame weapon plumbing", () => {
  it("defaults to the pistol and reports the pistol-length barrel", () => {
    const world = new World({ seed: 9 });
    world.addPlayer({ x: 100, y: floorY() });
    const frame = describeFrame(world.state, world.map);
    expect(frame.players[0].weapon).toBe("pistol");
    const p = frame.players[0];
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    expect(Math.hypot(p.barrel.x - cx, p.barrel.y - cy)).toBeCloseTo(
      BARREL_LENGTH,
      10,
    );
  });

  it("carries the equipped rifle into a 12px barrel tip", () => {
    const world = new World({ seed: 12 });
    world.addPlayer({ x: 100, y: floorY() });
    world.players[0].weapon = "rifle";
    world.players[0].aim = 0;
    const frame = describeFrame(world.state, world.map);
    expect(frame.players[0].weapon).toBe("rifle");
    const p = frame.players[0];
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    expect(p.barrel.x).toBeCloseTo(cx + WEAPON_DEFS["rifle"].length, 10);
    expect(p.barrel.y).toBeCloseTo(cy, 10);
  });
});

describe("tracer-muzzle coincidence", () => {
  it("rifle tracer origins equal the shooter barrel tip", () => {
    const { frame, details } = fireOnce("rifle");
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    expect(tracers).toHaveLength(1);
    expect(muzzles).toHaveLength(1);
    const tip = frame.players[details[0].shooter].barrel;
    expect(tracers[0].x1).toBe(tip.x);
    expect(tracers[0].y1).toBe(tip.y);
    expect(muzzles[0].x).toBe(tip.x);
    expect(muzzles[0].y).toBe(tip.y);
    // Hit endpoints stay verbatim from the sim detail.
    expect(tracers[0].x2).toBe(details[0].x);
    expect(tracers[0].y2).toBe(details[0].y);
  });

  it("shotgun tracer origins share the single muzzle entry", () => {
    const { frame, details } = fireOnce("shotgun");
    expect(details).toHaveLength(WEAPONS["shotgun"].pellets);
    const tracers: Tracer[] = [];
    const muzzles: Muzzle[] = [];
    spawnShots(tracers, muzzles, frame, details);
    expect(tracers).toHaveLength(8);
    expect(muzzles).toHaveLength(1);
    for (const tracer of tracers) {
      expect(tracer.x1).toBe(muzzles[0].x);
      expect(tracer.y1).toBe(muzzles[0].y);
    }
  });
});

describe("tint families", () => {
  it("returns the cyan local and warm enemy families for indices 0/1/2", () => {
    expect(soldierAccentFor(0)).toBe("#00E5FF");
    expect(soldierAccentFor(1)).toBe("#FF6B35");
    expect(soldierAccentFor(2)).toBe("#FFB347");
    expect(soldierAccentHex(0)).toBe(0x00e5ff);
    expect(soldierAccentHex(1)).toBe(0xff6b35);
    expect(soldierAccentHex(2)).toBe(0xffb347);
  });

  it("keeps at least two distinct hues across three players", () => {
    const hues = new Set(
      [0, 1, 2].map((index) =>
        soldierAccentFor(index).toLowerCase(),
      ),
    );
    expect(hues.size).toBeGreaterThanOrEqual(2);
  });
});
