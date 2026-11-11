// Follow-camera tests: look-ahead sign, smoothing convergence, arena
// clamp, projection centering, and tile-range culling. Mirrors the
// packages/client/test/renderer.test.ts builder style (small local
// builders, behavior assertions, no padding).
import { describe, expect, it } from "vitest";
import { TILE_SIZE } from "../../core/src/map";
import {
  CAMERA_LOOKAHEAD,
  cameraTarget,
  createCamera,
  projectCamera,
  updateCamera,
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
