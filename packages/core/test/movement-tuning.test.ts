import { describe, expect, it } from "vitest";
import { World } from "../src/world";
import {
  AIR_ACCEL,
  AIR_DRAG,
  CROUCH_SPEED,
  GROUND_ACCEL,
  GROUND_FRICTION,
  RUN_SPEED,
} from "../src/constants";

// Playtest proof for issue #338: the retuned run/accel pair must feel
// controllable — full run crosses a ~900px view in 3-4s (180-240 ticks)
// with perceptible weight, and crouch stays strictly slower than run.
describe("movement tuning", () => {
  it("pins the retuned run/crouch/accel/friction/drag literals", () => {
    expect(RUN_SPEED).toBe(240);
    expect(CROUCH_SPEED).toBe(100);
    expect(GROUND_ACCEL).toBe(1000);
    expect(GROUND_FRICTION).toBe(900);
    expect(AIR_ACCEL).toBe(650);
    expect(AIR_DRAG).toBe(120);
  });

  it("crosses 900px of travel within 180-240 ticks from standstill", () => {
    const world = new World({});
    world.step();
    const startX = world.players[0]?.x ?? 0;
    let crossedAt = -1;
    for (let t = 0; t < 400; t += 1) {
      world.step({ moveX: 1 });
      if ((world.players[0]?.x ?? 0) - startX >= 900) {
        crossedAt = t + 1;
        break;
      }
    }
    expect(crossedAt).toBeGreaterThanOrEqual(180);
    expect(crossedAt).toBeLessThanOrEqual(240);
  });

  it("moves crouching strictly slower than running upright", () => {
    const runner = new World({});
    runner.step();
    const startRun = runner.players[0]?.x ?? 0;
    for (let t = 0; t < 60; t += 1) {
      runner.step({ moveX: 1 });
    }
    const runDx = (runner.players[0]?.x ?? 0) - startRun;

    const crawler = new World({});
    crawler.step();
    const startCrouch = crawler.players[0]?.x ?? 0;
    for (let t = 0; t < 60; t += 1) {
      crawler.step({ moveX: 1, buttons: 2 });
    }
    const crouchDx = (crawler.players[0]?.x ?? 0) - startCrouch;

    expect(crouchDx).toBeGreaterThan(0);
    expect(crouchDx).toBeLessThan(runDx);
  });

  it("ramps with weight: well below top speed at 6 ticks, at top by 30", () => {
    const early = new World({});
    early.step();
    for (let t = 0; t < 6; t += 1) {
      early.step({ moveX: 1 });
    }
    const vx6 = Math.abs(early.players[0]?.vx ?? 0);
    expect(vx6).toBeGreaterThan(0);
    expect(vx6).toBeLessThan(RUN_SPEED / 2);

    const settled = new World({});
    settled.step();
    for (let t = 0; t < 30; t += 1) {
      settled.step({ moveX: 1 });
    }
    expect(Math.abs(settled.players[0]?.vx ?? 0)).toBeCloseTo(RUN_SPEED, 0);
  });

  it("accelerates slower airborne than on the ground", () => {
    const air = new World({});
    air.step();
    const floater = air.players[0];
    if (floater === undefined) {
      throw new Error("expected auto-spawned player");
    }
    floater.y -= 200;
    floater.vy = 0;
    floater.vx = 0;
    floater.onGround = false;
    for (let t = 0; t < 6; t += 1) {
      air.step({ moveX: 1 });
    }
    const airVx6 = Math.abs(air.players[0]?.vx ?? 0);

    const ground = new World({});
    ground.step();
    for (let t = 0; t < 6; t += 1) {
      ground.step({ moveX: 1 });
    }
    const groundVx6 = Math.abs(ground.players[0]?.vx ?? 0);

    expect(airVx6).toBeGreaterThan(0);
    expect(airVx6).toBeLessThan(groundVx6);
  });
});
