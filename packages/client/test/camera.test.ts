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
  fitScaleForArena,
  matchSpawnXs,
  MAX_SHAKE_PX,
  projectCamera,
  rocketLaunchedSince,
  TRAUMA_DECAY,
  updateCamera,
  viewSize,
  visibleTileRange,
  ZOOM_LEVELS,
  type Camera,
} from "../src/renderer/camera";

const ARENA_W = 40 * TILE_SIZE;
const ARENA_H = 20 * TILE_SIZE;
/** Large arena where the 640x360 view fits without the fit floor (zoom arithmetic decides). */
const WIDE_W = 80 * TILE_SIZE;
const WIDE_H = 40 * TILE_SIZE;

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
    // The fitted 1137x640 view exactly fills the 40x20 height, so the
    // vertical stays pinned; converge on a larger arena where the view
    // can travel toward an unclamped target.
    const wideW = 80 * TILE_SIZE;
    const wideH = 40 * TILE_SIZE;
    const cam = createCamera(wideW, wideH);
    const target = cameraTarget(1500, 700, 0);
    const startDx = Math.abs(target.x - cam.x);
    const startDy = Math.abs(target.y - cam.y);
    const startDist = Math.hypot(startDx, startDy);
    for (let i = 0; i < 30; i += 1) {
      updateCamera(cam, target.x, target.y, wideW, wideH);
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

  it("maps a known camera/viewport pair to exact logical px (issue #392)", () => {
    // Hand-built camera (independent of the createCamera fit floors):
    // the focus lands exactly on the canvas center, and the world
    // origin lands one scaled focus-offset up-left of it.
    const cam = { x: 100, y: 50, scale: 0.5 } as unknown as Camera;
    const center = projectCamera(cam, 640, 360, 100, 50);
    expect(center.x).toBe(320);
    expect(center.y).toBe(180);
    const origin = projectCamera(cam, 640, 360, 0, 0);
    expect(origin.x).toBeCloseTo(270, 9);
    expect(origin.y).toBeCloseTo(155, 9);
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
    // Wide arena: the fit floor (0.28) stays below the 0.8 zoom scale,
    // so the zoom arithmetic (not the small-arena fit) decides scale.
    const cam = createCamera(WIDE_W, WIDE_H);
    cycleZoom(cam);
    for (let i = 0; i < 36; i += 1) {
      updateCamera(cam, cam.x, cam.y, WIDE_W, WIDE_H, 1 / 60);
    }
    expect(cam.zoom).toBeCloseTo(0.8, 1);
    expect(cam.scale).toBeCloseTo(CAMERA_ZOOM * 0.8, 1);
    cycleZoom(cam);
    cycleZoom(cam);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, WIDE_W, WIDE_H, 1 / 60);
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

  it("shows at least 900 world px wide by default (fitted 1137x640, no overscan)", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    const view = viewSize(cam, 640, 360);
    expect(view.w).toBeGreaterThanOrEqual(900);
    // Fit floor for the default arena: max(640/1280, 360/640) = 0.5625.
    expect(cam.scale).toBeCloseTo(0.5625, 9);
    expect(view.w).toBeCloseTo(640 / 0.5625, 9);
    expect(view.h).toBeCloseTo(360 / 0.5625, 9);
    expect(view.w).toBeCloseTo(1137.7777777777778, 6);
    expect(view.h).toBeCloseTo(640, 9);
    // No overscan: the fitted view fits inside the default arena.
    expect(view.w).toBeLessThanOrEqual(ARENA_W);
    expect(view.h).toBeLessThanOrEqual(ARENA_H);
  });

  it("clamps the scale at the max-view floor when zoom dives below it", () => {
    // Wide arena: the fit floor (0.28) stays below minScale (0.30),
    // so the minScale branch (not the fit or 0.64x) decides the scale.
    const cam = createCamera(WIDE_W, WIDE_H);
    // Drive the target below any ZOOM_LEVELS entry so the minScale
    // branch (not the 0.64x arithmetic) decides the final scale.
    cam.targetZoom = 0.05;
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, WIDE_W, WIDE_H, 1 / 60);
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

  it("keeps the world-space offset constant across zoom levels", () => {
    // Wide arena so each zoom level resolves to a distinct scale
    // (the default arena fit floor would pin all three to 0.5625).
    const worlds: number[] = [];
    for (const level of ZOOM_LEVELS) {
      const cam = createCamera(WIDE_W, WIDE_H);
      cam.targetZoom = level;
      for (let i = 0; i < 120; i += 1) {
        updateCamera(cam, cam.x, cam.y, WIDE_W, WIDE_H, 1 / 60);
      }
      // Sample one quadrature frame at a fixed phase with no decay
      // so every zoom reads the same trauma-1 amplitude.
      cam.trauma = 1;
      cam.time = 1;
      updateCamera(cam, cam.x, cam.y, WIDE_W, WIDE_H, 0);
      // Screen px divided by scale is the world offset (see the
      // renderCam shaken copy in main.ts).
      worlds.push(Math.hypot(cam.shakeX, cam.shakeY) / cam.scale);
    }
    for (const world of worlds) {
      expect(world).toBeCloseTo(MAX_SHAKE_PX / CAMERA_ZOOM, 0);
      expect(Math.abs(world - (MAX_SHAKE_PX / CAMERA_ZOOM))).toBeLessThan(0.5);
    }
    expect(Math.max(...worlds) - Math.min(...worlds)).toBeLessThan(0.5);
  });

  it("preserves the reference screen amplitude at default zoom", () => {
    // Wide arena so the default zoom resolves to CAMERA_ZOOM exactly
    // (the default arena fit floor would read 0.5625 instead of 0.5).
    const cam = createCamera(WIDE_W, WIDE_H);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, WIDE_W, WIDE_H, 1 / 60);
    }
    cam.trauma = 1;
    cam.time = 1;
    updateCamera(cam, cam.x, cam.y, WIDE_W, WIDE_H, 0);
    expect(Math.hypot(cam.shakeX, cam.shakeY)).toBeCloseTo(MAX_SHAKE_PX, 0);
    expect(Math.abs(Math.hypot(cam.shakeX, cam.shakeY) - MAX_SHAKE_PX)).toBeLessThan(
      0.5,
    );
    expect(
      Math.hypot(cam.shakeX, cam.shakeY) / cam.scale,
    ).toBeCloseTo(MAX_SHAKE_PX / CAMERA_ZOOM, 0);
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

describe("small-arena fit (issue #341)", () => {
  it("fits the 640x360 view inside the 1280x640 default arena", () => {
    expect(fitScaleForArena(ARENA_W, ARENA_H)).toBeCloseTo(0.5625, 9);
    expect(fitScaleForArena(WIDE_W, WIDE_H)).toBeLessThan(0.31);
    expect(fitScaleForArena(0, 0)).toBe(0);
    expect(fitScaleForArena(Number.NaN, Number.NaN)).toBe(0);
  });

  it("starts centered at the fit scale with no vertical overscan", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    expect(cam.x).toBeCloseTo(ARENA_W / 2, 9);
    expect(cam.y).toBeCloseTo(ARENA_H / 2, 9);
    expect(cam.scale).toBeCloseTo(0.5625, 9);
    const view = viewSize(cam, 640, 360);
    expect(view.h).toBeCloseTo(ARENA_H, 9);
    expect(view.h).toBeLessThanOrEqual(ARENA_H);
    expect(view.w).toBeLessThanOrEqual(ARENA_W);
  });

  it("keeps the projected arena covering the full viewport (no sky bands)", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    // Fitted scale pins the height: arena top/bottom land on the
    // viewport edges instead of leaving 20px sky bands.
    expect(cam.scale).toBeCloseTo(0.5625, 9);
    const topLeft = projectCamera(cam, 640, 360, 0, 0);
    const bottomRight = projectCamera(cam, 640, 360, ARENA_W, ARENA_H);
    expect(topLeft.y).toBeCloseTo(0, 9);
    expect(bottomRight.y).toBeCloseTo(360, 9);
    expect(topLeft.x).toBeLessThanOrEqual(0);
    expect(bottomRight.x).toBeGreaterThanOrEqual(640);
  });

  it("holds the fit floor when zoomed out on the default arena", () => {
    const cam = createCamera(ARENA_W, ARENA_H);
    cycleZoom(cam);
    cycleZoom(cam);
    expect(cam.targetZoom).toBeCloseTo(0.64, 9);
    for (let i = 0; i < 120; i += 1) {
      updateCamera(cam, cam.x, cam.y, ARENA_W, ARENA_H, 1 / 60);
    }
    expect(cam.scale).toBeCloseTo(fitScaleForArena(ARENA_W, ARENA_H), 9);
    const view = viewSize(cam, 640, 360);
    expect(view.w).toBeLessThanOrEqual(ARENA_W);
    expect(view.h).toBeLessThanOrEqual(ARENA_H);
  });
});
