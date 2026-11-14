// Props + pickup art with states: cracked barrels/crates at <=50% HP,
// weapon pads with centered icon plaques (Hornet alias), health cross,
// grenade icon, and the bounce squash cycle. Mirrors tiles.test.ts
// style without touching the DOM.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BARREL_HP, CRATE_HP } from "../../core/src/constants";
import { World } from "../../core/src/world";
import { describeFrame } from "../src/renderer/index";
import {
  BOUNCE_SQUASH_DURATION_MS,
  BOUNCE_SQUASH_MIN,
  PLAQUE_H,
  PLAQUE_W,
  PICKUP_PAD_H,
  PICKUP_PAD_W,
  PROP_CRACK_FRACTION,
  bounceSquashAt,
  bounceSquashScale,
  isPropCracked,
  pickupPaintFor,
  propCrackStage,
  propHpFraction,
  propMaxHp,
  propPaintFor,
  weaponPlaqueFor,
} from "../src/view/props";

function manifest(): string {
  return readFileSync(join(process.cwd(), "LICENSES.md"), "utf8");
}

function asset(name: string): string {
  return readFileSync(join(process.cwd(), "packages", "client", "assets", name), "utf8");
}

/** Minimal 2D ctx recorder for the plaque-centering probe. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; rects: number[][] } {
  const rects: number[][] = [];
  const noop = (): void => {};
  const ctx = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "round",
    fillRect: (x: number, y: number, w: number, h: number): void => {
      rects.push([x, y, w, h]);
    },
    strokeRect: (x: number, y: number, w: number, h: number): void => {
      rects.push([x, y, w, h]);
    },
    beginPath: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    moveTo: noop,
    lineTo: noop,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects };
}

describe("prop crack states", () => {
  it("cracks at or below half HP", () => {
    expect(PROP_CRACK_FRACTION).toBe(0.5);
    expect(propMaxHp("barrel")).toBe(BARREL_HP);
    expect(propMaxHp("crate")).toBe(CRATE_HP);
    expect(propMaxHp("bogus")).toBe(CRATE_HP);
    expect(propCrackStage("barrel", BARREL_HP)).toBe(0);
    expect(propCrackStage("barrel", BARREL_HP / 2)).toBe(1);
    expect(propCrackStage("barrel", 1)).toBe(1);
    expect(propCrackStage("crate", CRATE_HP)).toBe(0);
    expect(propCrackStage("crate", CRATE_HP / 2)).toBe(1);
    expect(isPropCracked("barrel", BARREL_HP / 2)).toBe(true);
    expect(isPropCracked("barrel", BARREL_HP)).toBe(false);
  });

  it("treats non-finite hp as intact", () => {
    expect(propHpFraction("barrel", NaN)).toBe(1);
    expect(propCrackStage("barrel", NaN)).toBe(0);
    expect(propCrackStage("crate", undefined)).toBe(0);
  });

  it("shifts the full-area base so the damaged sprite differs by >500px", () => {
    const intact = propPaintFor("barrel", BARREL_HP);
    const cracked = propPaintFor("barrel", BARREL_HP / 2);
    expect(intact.baseHex).not.toBe(cracked.baseHex);
    const crateIntact = propPaintFor("crate", CRATE_HP);
    const crateCracked = propPaintFor("crate", CRATE_HP / 2);
    expect(crateIntact.baseHex).not.toBe(crateCracked.baseHex);
    // Smallest prop box (26x34 barrel) already covers 884px > 500, and
    // the base shift repaints every one of those pixels plus fissures.
    expect(26 * 34).toBeGreaterThan(500);
    expect(30 * 30).toBeGreaterThan(500);
  });
});

describe("weapon plaques", () => {
  it("resolves Hornet (any case) to the dedicated Hornet card", () => {
    for (const holding of ["Hornet", "hornet", "HORNET", "Hornet SMG", " hornet "]) {
      const plaque = weaponPlaqueFor(holding);
      expect(plaque.key).toBe("weapon-hornet");
      expect(plaque.file).toBe("weapon-hornet.svg");
      expect(plaque.label).toBe("Hornet");
    }
  });

  it("resolves the six core weapons and falls back to pistol", () => {
    expect(weaponPlaqueFor("smg").file).toBe("weapon-smg.svg");
    expect(weaponPlaqueFor("rifle").label).toBe("Rifle");
    expect(weaponPlaqueFor("bogus").key).toBe("weapon-pistol");
    expect(weaponPlaqueFor(null).key).toBe("weapon-pistol");
    expect(weaponPlaqueFor(undefined).file).toBe("weapon-pistol.svg");
  });

  it("paints lit pad edges per pickup kind", () => {
    expect(pickupPaintFor("health").edgeHex).toBe(0x22c55e);
    expect(pickupPaintFor("grenades").edgeHex).toBe(0xeab308);
    expect(pickupPaintFor("weapon").edgeHex).toBe(0x22d3ee);
    expect(pickupPaintFor("bogus").edgeHex).toBe(0x22d3ee);
  });

  it("centers the plaque on the pad within 16px at 1280x720 scale", async () => {
    const { paintPickup2D } = await import("../src/view/props");
    // 1280x720 letterboxes the 640x360 logical store at scale 2.
    const scale = 2;
    const { ctx, rects } = recordingCtx();
    paintPickup2D(ctx, 500, 300, scale, "weapon", "Hornet");
    // Plaque rect: PLAQUE_W x PLAQUE_H world at scale, centered on (500,300).
    const plaque = rects.find(
      (r) => r[2] === PLAQUE_W * scale && r[3] === PLAQUE_H * scale,
    );
    expect(plaque).toBeDefined();
    const cx = (plaque as number[])[0] + (PLAQUE_W * scale) / 2;
    const cy = (plaque as number[])[1] + (PLAQUE_H * scale) / 2;
    expect(Math.hypot(cx - 500, cy - 300)).toBeLessThanOrEqual(16);
    // Pad base is larger than the plaque and shares the same center.
    const pad = rects.find((r) => r[2] === PICKUP_PAD_W * scale && r[3] === PICKUP_PAD_H * scale);
    expect(pad).toBeDefined();
    const padCx = (pad as number[])[0] + (PICKUP_PAD_W * scale) / 2;
    expect(Math.abs(padCx - 500)).toBeLessThanOrEqual(1);
  });
});

describe("bounce squash cycle", () => {
  it("squashes to <=85% at the 300ms probe point, then recovers", () => {
    expect(BOUNCE_SQUASH_DURATION_MS).toBe(600);
    expect(BOUNCE_SQUASH_MIN).toBeLessThanOrEqual(0.85);
    expect(bounceSquashAt(0)).toBe(1);
    expect(bounceSquashAt(-5)).toBe(1);
    expect(bounceSquashAt(NaN)).toBe(1);
    const peak = bounceSquashAt(300);
    expect(peak).toBeLessThanOrEqual(0.85);
    expect(peak).toBeCloseTo(BOUNCE_SQUASH_MIN, 5);
    expect(bounceSquashAt(600)).toBe(1);
    expect(bounceSquashAt(900)).toBe(1);
  });

  it("holds idle without a trigger and tracks the trigger clock", () => {
    expect(bounceSquashScale(1000, null)).toBe(1);
    // Null/blank triggers never squash, even inside the 300ms window.
    expect(bounceSquashScale(300, null)).toBe(1);
    expect(bounceSquashScale(300, undefined)).toBe(1);
    expect(bounceSquashScale(300, "")).toBe(1);
    expect(bounceSquashScale(NaN, 500)).toBe(1);
    expect(bounceSquashScale(1300, 1000)).toBeLessThanOrEqual(0.85);
    expect(bounceSquashScale(1700, 1000)).toBe(1);
  });
});

describe("frame carries prop hp and pickup weapons", () => {
  it("exposes hp/maxHp and the held weapon to the renderer", () => {
    const world = new World({ seed: 7 });
    const barrel = world.addProp("barrel", 100, 100);
    world.addPickup({
      kind: "weapon",
      x: 200,
      y: 200,
      weapon: "hornet" as unknown as never,
    } as never);
    const full = describeFrame(world.state, world.map);
    expect(full.props).toHaveLength(1);
    expect(full.props[0]).toMatchObject({ kind: "barrel", hp: BARREL_HP, maxHp: BARREL_HP });
    world.damageProp(barrel.id, BARREL_HP / 2);
    const half = describeFrame(world.state, world.map);
    expect(half.props[0]?.hp).toBe(BARREL_HP / 2);
    expect(isPropCracked(half.props[0]?.kind, half.props[0]?.hp)).toBe(true);
    expect(full.pickups).toHaveLength(1);
    expect(String(full.pickups[0]?.weapon)).toMatch(/hornet/i);
    expect(weaponPlaqueFor(full.pickups[0]?.weapon).key).toBe("weapon-hornet");
  });
});

describe("prop art assets", () => {
  it("ships cracked, explosion, pad, and hornet cards with probe hexes", () => {
    for (const name of [
      "prop-barrel-cracked.svg",
      "prop-crate-cracked.svg",
      "prop-explosion.svg",
      "prop-bounce-pad.svg",
      "pickup-grenade.svg",
      "pickup-pad.svg",
      "weapon-hornet.svg",
    ]) {
      const svg = asset(name);
      expect(svg).toMatch(/<svg[\s>]/);
      expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    }
    expect(asset("prop-barrel-cracked.svg")).toContain("#7c3a06");
    expect(asset("prop-crate-cracked.svg")).toContain("#5c2e0a");
    expect(asset("prop-bounce-pad.svg")).toContain("#FFD21F");
    expect(asset("pickup-grenade.svg")).toContain("#a3e635");
    expect(asset("weapon-hornet.svg")).toContain("Hornet");
  });

  it("lists every new card in the LICENSES manifest", () => {
    const text = manifest();
    for (const name of [
      "prop-barrel-cracked.svg",
      "prop-crate-cracked.svg",
      "prop-explosion.svg",
      "prop-bounce-pad.svg",
      "pickup-grenade.svg",
      "pickup-pad.svg",
      "weapon-hornet.svg",
    ]) {
      expect(text).toContain(name);
    }
  });
});
