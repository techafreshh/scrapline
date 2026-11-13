// Vector player styling: crouch/stand heights, jetting mapping, flame
// flicker/vanish, spawn-blink toggles, cyan-vs-warm color families,
// and the barrel-length convention guard. World-driven fixtures, no DOM.
import { describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import { PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from "../../core/src/constants";
import {
  BARREL_LENGTH,
  barrelEndpoint,
  blinkAlpha,
  describeFrame,
  flameAlpha,
  flameScale,
  gunMidpoint,
  playerPaintColor,
  playerPaintCss,
} from "../src/renderer/index";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - PLAYER_HEIGHT;
}

function hexToRgb(css: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(css.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

describe("crouch body height", () => {
  it("uses the 58/40 stand/crouch constants with a ratio in [0.6, 0.8]", () => {
    expect(PLAYER_HEIGHT).toBe(58);
    expect(PLAYER_CROUCH_HEIGHT).toBe(40);
    const ratio = PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT;
    expect(ratio).toBeGreaterThanOrEqual(0.6);
    expect(ratio).toBeLessThanOrEqual(0.8);
  });

  it("describeFrame reports the crouch height after a crouch step", () => {
    const world = new World({ seed: 7 });
    world.addPlayer({ x: 100, y: floorY() });
    world.step([{ crouch: true }]);
    const frame = describeFrame(world.state, world.map);
    expect(frame.players[0].h).toBe(PLAYER_CROUCH_HEIGHT);
    world.step([{}]);
    const stood = describeFrame(world.state, world.map);
    expect(stood.players[0].h).toBe(PLAYER_HEIGHT);
  });
});

describe("jetting mapping", () => {
  it("maps jetting true while thrusting with full fuel, false after release", () => {
    const world = new World({ seed: 11 });
    world.addPlayer({ x: 100, y: floorY() });
    expect(world.players[0].fuel).toBeGreaterThan(0);
    world.step([{ jet: true }]);
    expect(world.players[0].jetting).toBe(true);
    expect(describeFrame(world.state, world.map).players[0].jetting).toBe(true);
    world.step([{}]);
    expect(world.players[0].jetting).toBe(false);
    expect(describeFrame(world.state, world.map).players[0].jetting).toBe(false);
  });

  it("maps spawn protection from protectionTicks", () => {
    const world = new World({ seed: 13 });
    world.addPlayer({ x: 100, y: floorY() });
    world.players[0].protectionTicks = 30;
    expect(describeFrame(world.state, world.map).players[0].protected).toBe(true);
    world.players[0].protectionTicks = 0;
    expect(describeFrame(world.state, world.map).players[0].protected).toBe(false);
  });
});

describe("flame flicker", () => {
  it("takes at least two distinct scales over any three consecutive ticks", () => {
    for (let tick = 0; tick < 40; tick += 1) {
      const scales = new Set([
        flameScale(tick, 0),
        flameScale(tick + 1, 0),
        flameScale(tick + 2, 0),
      ]);
      expect(scales.size).toBeGreaterThanOrEqual(2);
    }
  });

  it("takes at least two distinct alphas over any three consecutive ticks", () => {
    for (let tick = 0; tick < 40; tick += 1) {
      const alphas = new Set([
        flameAlpha(tick, 0),
        flameAlpha(tick + 1, 0),
        flameAlpha(tick + 2, 0),
      ]);
      expect(alphas.size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("spawn blink", () => {
  it("toggles at least four times over 36 protected ticks", () => {
    let toggles = 0;
    let prev = blinkAlpha(0, true);
    for (let tick = 1; tick < 36; tick += 1) {
      const next = blinkAlpha(tick, true);
      if (next !== prev) {
        toggles += 1;
      }
      prev = next;
    }
    expect(toggles).toBeGreaterThanOrEqual(4);
  });

  it("stays constant at 1 without protection", () => {
    for (let tick = 0; tick < 36; tick += 1) {
      expect(blinkAlpha(tick, false)).toBe(1);
    }
  });

  it("blinks between full and dim opacity", () => {
    const values = new Set<number>();
    for (let tick = 0; tick < 24; tick += 1) {
      values.add(blinkAlpha(tick, true));
    }
    expect(values.has(1)).toBe(true);
    expect(values.has(0.25)).toBe(true);
  });
});

describe("team colors", () => {
  it("paints the local player cyan in the #00E5FF family", () => {
    expect(playerPaintColor(0, true, false)).toBe(0x00e5ff);
    expect(playerPaintCss(0, true, false)).toBe("#00E5FF");
    const rgb = hexToRgb(playerPaintCss(0, true, false));
    expect(rgb.g).toBeGreaterThanOrEqual(0xe0);
    expect(rgb.b).toBe(0xff);
    expect(rgb.r).toBeLessThanOrEqual(0x10);
  });

  it("paints odd enemies vivid orange-red and even enemies warm amber", () => {
    expect(playerPaintCss(1, true, false)).toBe("#FF6B35");
    expect(playerPaintColor(1, true, false)).toBe(0xff6b35);
    expect(playerPaintCss(2, true, false)).toBe("#FFB347");
    expect(playerPaintColor(2, true, false)).toBe(0xffb347);
    expect(playerPaintCss(3, true, false)).toBe("#FF6B35");
    for (const css of [playerPaintCss(1, true, false), playerPaintCss(2, true, false)]) {
      expect(css).toMatch(/^#FF(6B35|B347)$/);
      const rgb = hexToRgb(css);
      expect(rgb.r).toBe(0xff);
      expect(rgb.b).toBeLessThanOrEqual(0x60);
    }
  });
});

describe("barrel convention guard", () => {
  it("keeps BARREL_LENGTH at 8 world px on all four cardinal aims", () => {
    expect(BARREL_LENGTH).toBe(8);
    for (const aim of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const tip = barrelEndpoint(100, 100, aim);
      const dist = Math.hypot(tip.x - 100, tip.y - 100);
      expect(dist).toBeCloseTo(8, 10);
    }
  });

  it("places the gun silhouette inside the barrel at 55% length", () => {
    const mid = gunMidpoint(100, 100, 0);
    expect(mid.x).toBeCloseTo(100 + BARREL_LENGTH * 0.55, 10);
    expect(mid.y).toBeCloseTo(100, 10);
    const tip = barrelEndpoint(100, 100, 0);
    expect(tip.x).toBeCloseTo(108, 10);
  });
});
