// World parity for issue #403: the mid-match screen reads like HU-01
// through dense terrain-edge dressing, dangling fall poses, vendor flame
// cards on the jetpack, and mockup-density combat emission. Pure
// model/helper assertions (no DOM, no Pixi); the live 1280x720 capture
// and the written diff live in docs/benchmark/world-parity-403.md.
import { describe, expect, it } from "vitest";
import {
  IMPACT_COUNT,
  JET_PER_FRAME,
  MUZZLE_COUNT,
} from "../src/fx/particles";
import {
  FX_MANIFEST_FRAMES,
  IMPACT_EMITTER_CONFIG,
  JET_EMITTER_CONFIG,
  MUZZLE_EMITTER_CONFIG,
} from "../src/fx/particles-config";
import { decorations as duneStatics } from "../../core/src/maps/dune";
import { decorations as frostbiteStatics } from "../../core/src/maps/frostbite";
import { decorations as kilimaStatics } from "../../core/src/maps/kilima";
import {
  flameSpriteFile,
  flameSpriteKey,
  SPARKS_PER_HIT,
} from "../src/renderer/index";
import { soldierSpriteKey } from "../src/render/soldier";
import {
  FALLING_VY,
  isFallingPose,
  selectSoldierFrame,
  soldierLegOffset,
  soldierLegOffsetBlended,
} from "../src/view/soldier";
import { decorPaintFor, decorationsForMapSeeded } from "../src/view/decor";

const THEMES = ["kilima", "dune", "frostbite"] as const;
const PROBE_SEEDS = [123, 0, 1, 999];

describe("dressing density at mockup scale", () => {
  it("carries 7 static terrain-edge rects per theme", () => {
    expect(kilimaStatics).toHaveLength(7);
    expect(duneStatics).toHaveLength(7);
    expect(frostbiteStatics).toHaveLength(7);
  });

  it("paints 100+ decorations per screen on every theme across probe seeds", () => {
    for (const theme of THEMES) {
      for (const seed of PROBE_SEEDS) {
        const decors = decorationsForMapSeeded(theme, seed);
        expect(decors.length, `${theme} seed=${seed}`).toBeGreaterThanOrEqual(100);
        expect(decors.length, `${theme} seed=${seed}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it("mixes foliage and vines into every theme at seed 123", () => {
    for (const theme of THEMES) {
      const kinds = new Set(
        decorationsForMapSeeded(theme, 123).map((d) => d.kind),
      );
      expect(kinds.has("foliage"), `${theme} missing foliage`).toBe(true);
      expect(kinds.has("vines"), `${theme} missing vines`).toBe(true);
    }
  });

  it("resolves distinct foliage/vine palettes (never the neutral fallback)", () => {
    for (const kind of ["foliage", "vines"] as const) {
      const paint = decorPaintFor(kind);
      expect(paint.fillCss).not.toBe("#64748b");
      expect(paint.accentCss).not.toBe("#64748b");
      expect(paint.fillCss).not.toBe(paint.accentCss);
    }
  });
});

describe("airborne fall presence", () => {
  it("gates the dangle on alive + airborne + non-jetting + fast fall", () => {
    expect(FALLING_VY).toBe(160);
    const falling = { alive: true, onGround: false, jetting: false, vy: 400 };
    expect(isFallingPose(falling)).toBe(true);
    expect(isFallingPose({ ...falling, alive: false })).toBe(false);
    expect(isFallingPose({ ...falling, onGround: true })).toBe(false);
    expect(isFallingPose({ ...falling, jetting: true })).toBe(false);
    expect(isFallingPose({ ...falling, vy: 100 })).toBe(false);
    expect(isFallingPose({ ...falling, vy: NaN })).toBe(false);
    expect(isFallingPose({})).toBe(false);
  });

  it("selects fall below jet/crouch/dead and above run/idle", () => {
    expect(selectSoldierFrame({ falling: true })).toBe("fall");
    expect(selectSoldierFrame({ falling: true, swing: 4, legPhase: 2 })).toBe("fall");
    expect(selectSoldierFrame({ tuck: true, falling: true })).toBe("jet");
    expect(selectSoldierFrame({ crouching: true, falling: true })).toBe("crouch");
    expect(selectSoldierFrame({ deadPose: true, falling: true })).toBe("dead");
    expect(selectSoldierFrame({ swing: 4, legPhase: 0 })).toBe("run-a");
    expect(selectSoldierFrame({})).toBe("idle");
  });

  it("resolves the committed soldier.fall card while falling", () => {
    expect(soldierSpriteKey({ falling: true })).toBe("soldier.fall");
    expect(soldierSpriteKey({ tuck: true, falling: true })).toBe("soldier.jet");
    expect(soldierSpriteKey({ falling: true, swing: 4, legPhase: 1 })).toBe(
      "soldier.fall",
    );
  });

  it("dangles both legs below the torso with a slight outward splay", () => {
    const left = soldierLegOffset("fall", 0, -1);
    const right = soldierLegOffset("fall", 0, 1);
    expect(left.dy).toBeGreaterThan(0);
    expect(right.dy).toBeGreaterThan(0);
    expect(left.dx).toBeLessThan(0);
    expect(right.dx).toBeGreaterThan(0);
    expect(soldierLegOffsetBlended("fall", 4, 1, 0.2, 0.9)).toEqual(
      soldierLegOffset("fall", 4, 1),
    );
  });
});

describe("jetpack vendor flame", () => {
  it("maps both flame cards to staged particle-pack files", () => {
    expect(flameSpriteFile("fx.flame.0")).toBe("particles/flame_01.png");
    expect(flameSpriteFile("fx.flame.1")).toBe("particles/flame_02.png");
    expect(flameSpriteFile("fx.bogus")).toBeNull();
  });

  it("alternates the flame cards over ticks (offset per player)", () => {
    expect(flameSpriteKey(0, 0)).toBe("fx.flame.0");
    expect(flameSpriteKey(6, 0)).toBe("fx.flame.1");
    expect(flameSpriteKey(12, 0)).toBe("fx.flame.0");
    expect(flameSpriteKey(0, 1)).toBe("fx.flame.1");
    expect(flameSpriteKey(NaN, NaN)).toBe("fx.flame.0");
  });

  it("lists both flame cards in the vendor manifest run", () => {
    expect([...(FX_MANIFEST_FRAMES["flame"] ?? [])]).toEqual([
      "fx.flame.0",
      "fx.flame.1",
    ]);
  });

  it("wires the flame cards into the Pixi jet trail roulette", () => {
    const tex = JET_EMITTER_CONFIG.behaviors.find(
      (b) => b.type === "textureRandom" || b.type === "textureSingle",
    );
    expect(tex?.type).toBe("textureRandom");
    const frames =
      tex?.type === "textureRandom"
        ? ((tex.config as { textures?: string[] }).textures ?? [])
        : [];
    expect(frames).toContain("fx.trail.1");
    expect(frames).toContain("fx.flame.0");
    expect(frames).toContain("fx.flame.1");
  });
});

describe("mockup effect density", () => {
  it("raises pooled emission to mockup density", () => {
    expect(MUZZLE_COUNT).toBe(10);
    expect(IMPACT_COUNT).toBe(10);
    expect(JET_PER_FRAME).toBe(5);
    expect(SPARKS_PER_HIT).toBe(10);
  });

  it("matches the raised pooled counts in the Pixi one-shot waves", () => {
    expect(MUZZLE_EMITTER_CONFIG.particlesPerWave).toBe(MUZZLE_COUNT);
    expect(IMPACT_EMITTER_CONFIG.particlesPerWave).toBe(IMPACT_COUNT);
    expect(JET_EMITTER_CONFIG.particlesPerWave).toBeGreaterThanOrEqual(3);
  });
});
