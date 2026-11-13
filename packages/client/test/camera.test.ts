// Follow-camera tests: look-ahead sign, smoothing convergence, arena
// clamp, projection centering, and tile-range culling. Mirrors the
// packages/client/test/renderer.test.ts builder style (small local
// builders, behavior assertions, no padding).
import { describe, expect, it } from "vitest";
import { TILE_SIZE } from "../../core/src/map";
import { World } from "../../core/src/world";
import { WEAPONS } from "../../core/src/weapons";
import {
  addTrauma,
  CAMERA_LOOKAHEAD,
  CAMERA_ZOOM,
  cameraTarget,
  createCamera,
  cycleZoom,
  matchSpawnXs,
  projectCamera,
  rocketLaunchedSince,
  TRAUMA_DECAY,
  updateCamera,
  viewSize,
  visibleTileRange,
} from "../src/renderer/camera";

const ARENA_W = 40 * TILE_SIZE;
const ARENA_H = 20 * TILE_SIZE;

describe("cameraTarget", () => {
  it("pushes the target right of the player when aiming right", () => {
    const target = cameraTarget(100, 500, 0);
    expect(target.x).toBeGreaterThan(100);
    expect(target.x).toBeCloseTo(100 + CAMERA_LOOKAHEAD, 9);
    expect(target.y).toBeCloseTo(500, 9);
  });

  it("pushes the target left of the player when aiming left", () => {
    const target = cameraTarget(100, 500, Math.PI);
    expect(target.x).toBeLessThan(100);
    expect(target.x).toBeCloseTo(100 - CAMERA_LOOKAHEAD, 9);
  });
});

describe("updateCamera", () => {
  it("converges from across the arena within 30 steps", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    const target = cameraTarget(100, 500, 0);
    const startDx = Math.abs(target.x - cam.x);
    const startDy = Math.abs(target.y - cam.y);
    const startDist = Math.hypot(startDx, startDy);
    for (let i = 0; i < 30; i += 1) {
      updateCamera(cam, target.x, target.y, ARENA_W, ARENA_H);
    }
    const endDist = Math.hypot(target.x - cam.x, target.y - cam.y);
    expect(endDist).toBeLessThan(startDist * 0.05);
  });

  it("keeps the clamped camera inside the arena bounds", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    for (let i = 0; i < 200; i += 1) {
      updateCamera(cam, -5000, -5000, ARENA_W, ARENA_H);
    }
    expect(cam.x).toBeGreaterThanOrEqual(0);
    expect(cam.y).toBeGreaterThanOrEqual(0);
    expect(cam.x).toBeLessThanOrEqual(ARENA_W);
    expect(cam.y).toBeLessThanOrEqual(ARENA_H);
    for (let i = 0; i < 200; i += 1) {
      updateCamera(cam, 99999, 99999, ARENA_W, ARENA_H);
    }
    expect(cam.x).toBeGreaterThanOrEqual(0);
    expect(cam.y).toBeGreaterThanOrEqual(0);
    expect(cam.x).toBeLessThanOrEqual(ARENA_W);
    expect(cam.y).toBeLessThanOrEqual(ARENA_H);
  });
});

describe("projectCamera", () => {
  it("centers the camera target on the canvas center", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    const screen = projectCamera(cam, 640, 360, cam.x, cam.y);
    expect(screen.x).toBeCloseTo(320, 9);
    expect(screen.y).toBeCloseTo(180, 9);
  });
});

describe("zoom cycle", () => {
  it("cycles 1 -> 0.8 -> 0.64 -> 1", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    expect(cam.zoom).toBeCloseTo(1, 9);
    cycleZoom(cam);
    expect(cam.targetZoom).toBeCloseTo(0.8, 9);
    cycleZoom(cam);
    expect(cam.targetZoom).toBeCloseTo(0.64, 9);
    cycleZoom(cam);
    expect(cam.targetZoom).toBeCloseTo(1, 9);
  });

  it("converges to 0.8 within 600ms and returns to 1 after a full cycle", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    cycleZoom(cam);
    for (let i = 0; i < 36; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    expect(cam.zoom).toBeCloseTo(0.8, 1);
    expect(cam.scale).toBeCloseTo(CAMERA_ZOOM * 0.8, 1);
    cycleZoom(cam);
    cycleZoom(cam);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    expect(cam.zoom).toBeCloseTo(1, 2);
  });

  it("keeps the fully zoomed-out view within 2100x1280 world px", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    cycleZoom(cam);
    cycleZoom(cam);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    const view = viewSize(cam, 640, 360);
    expect(view.w).toBeLessThanOrEqual(2100);
    expect(view.h).toBeLessThanOrEqual(1280);
  });

  it("clamps the scale at the max-view floor when zoom dives below it", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    // Drive the target below any ZOOM_LEVELS entry so the minScale
    // branch (not the 0.64x arithmetic) decides the final scale.
    cam.targetZoom = 0.05;
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    const minScale = Math.max(640 / 2100, 360 / 1280);
    expect(CAMERA_ZOOM * cam.zoom).toBeLessThan(minScale);
    expect(cam.scale).toBeCloseTo(minScale, 9);
    const view = viewSize(cam, 640, 360);
    expect(view.w).toBeLessThanOrEqual(2100);
    expect(view.h).toBeLessThanOrEqual(1280);
  });
});

describe("trauma shake", () => {
  it("offsets more than 2px right after trauma and under 1px after 1.5s", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    addTrauma(cam, 0.5);
    updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    expect(Math.hypot(cam.shakeX, cam.shakeY)).toBeGreaterThan(2);
    for (let i = 0; i < 90; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    expect(Math.hypot(cam.shakeX, cam.shakeY)).toBeLessThan(1);
  });

  it("clamps trauma to [0, 1]", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    addTrauma(cam, 5);
    expect(cam.trauma).toBeLessThanOrEqual(1);
    addTrauma(cam, -5);
    expect(cam.trauma).toBeGreaterThanOrEqual(0);
  });
});

describe("rocket launch shake", () => {
  it("detects player 0 firing the rocket and raises camera trauma", () => {
    const sim = new World({ seed: 7 });
    sim.addPlayer({ x: 100 });
    sim.addPlayer({ x: 500 });
    const local = sim.players[0];
    if (local === undefined) {
      throw new Error("test: local player missing");
    }
    local.weapon = "rocket";
    local.magAmmo = WEAPONS.rocket.mag;
    const before = new Set<number>(sim.projectiles.map((p) => p.id));
    const events = sim.step([{ fire: true }, {}]);
    expect(events).toContain("shot");
    // Projectile fire emits no ShotDetails: the drain stays empty.
    expect(sim.drainShotDetails()).toHaveLength(0);
    expect(rocketLaunchedSince(before, sim.projectiles, 0)).toBe(true);
    const cam = createCamera(ARENA_W, ARENA_H);
    if (rocketLaunchedSince(before, sim.projectiles, 0)) {
      addTrauma(cam, 0.25);
    }
    expect(cam.trauma).toBeCloseTo(0.25, 9);
    updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    expect(cam.trauma).toBeCloseTo(0.25 - TRAUMA_DECAY / 60, 9);
    expect(Math.hypot(cam.shakeX, cam.shakeY)).toBeGreaterThan(0);
  });

  it("ignores bot rockets and pre-existing projectiles", () => {
    const sim = new World({ seed: 7 });
    sim.addPlayer({ x: 100 });
    sim.addPlayer({ x: 500 });
    const bot = sim.players[1];
    if (bot === undefined) {
      throw new Error("test: bot player missing");
    }
    bot.weapon = "rocket";
    bot.magAmmo = WEAPONS.rocket.mag;
    const before = new Set<number>(sim.projectiles.map((p) => p.id));
    sim.step([{}, { fire: true }]);
    expect(rocketLaunchedSince(before, sim.projectiles, 0)).toBe(false);
    const after = new Set<number>(sim.projectiles.map((p) => p.id));
    sim.step([{}, {}]);
    expect(rocketLaunchedSince(after, sim.projectiles, 1)).toBe(false);
  });
});

describe("matchSpawnXs", () => {
  it("returns four spawns clustered near the arena center", () => {
    const xs = matchSpawnXs(ARENA_W);
    expect(xs).toHaveLength(4);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(ARENA_W);
    }
    const mid = ARENA_W / 2;
    const halfView = 640 / (2 * CAMERA_ZOOM);
    for (const x of xs) {
      expect(Math.abs(x - mid)).toBeLessThanOrEqual(halfView);
    }
  });

  it("keeps every bot within one camera half-view of the local spawn", () => {
    const xs = matchSpawnXs(ARENA_W);
    const halfView = 640 / (2 * CAMERA_ZOOM);
    for (const x of xs.slice(1)) {
      expect(Math.abs(x - xs[0])).toBeLessThanOrEqual(halfView);
    }
  });

  it("anchors the local spawn first (leftmost of the cluster)", () => {
    const xs = matchSpawnXs(ARENA_W);
    expect(xs[0]).toBe(Math.min(...xs));
  });
});

describe("visibleTileRange", () => {
  it("covers the default arena floor rows and stays in map bounds", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    const floor = cameraTarget(100, 18 * TILE_SIZE - 29, 0);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, floor.x, floor.y, ARENA_W, ARENA_H);
    }
    const range = visibleTileRange(cam, 640, 360, ARENA_W, ARENA_H);
    expect(range.x0).toBeGreaterThanOrEqual(0);
    expect(range.y0).toBeGreaterThanOrEqual(0);
    expect(range.x1).toBeLessThanOrEqual(39);
    expect(range.y1).toBeLessThanOrEqual(19);
    expect(range.y0).toBeLessThanOrEqual(18);
    expect(range.y1).toEqual(19);
    const cells = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    expect(cells).toBeGreaterThanOrEqual(4);
  });
});
