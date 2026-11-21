// Gait and pose blending: continuous walk↔sprint, air, aim, landing,
// and spawn/death easing on top of the stable frame/selector contract.
// World-driven fixtures, no DOM (window stubbed for the probe cases,
// mirroring anim.test.ts).
import { afterEach, describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import {
  AIM_SMOOTH_RAD_PER_SEC,
  AIR_VY_MAX,
  AIR_VY_MIN,
  DEATH_EASE_MS,
  LAND_SQUASH_FRAMES,
  LAND_SQUASH_MIN,
  SPAWN_EASE_MS,
  airBlendFor,
  airCrouchWeightFor,
  createAnimState,
  deathEaseAt,
  gaitBlendFor,
  landingSquashAt,
  shortestArcDelta,
  smoothAimStep,
  spawnEaseAt,
  updateAnimState,
  type AnimClock,
} from "../src/view/anim";
import { RUN_SPEED, PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from "../../core/src/constants";
import {
  buildPlayerNode,
  publishGameProbes,
  syncPlayerNode,
  type GraphicsLike,
  type PixiFactory,
  type PlayerNode,
} from "../src/view/playerView";
import {
  selectSoldierFrame,
  soldierLegOffset,
  soldierLegOffsetBlended,
} from "../src/view/soldier";
import { describeFrame } from "../src/renderer/index";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - 58;
}

function clockAt(nowMs: number): AnimClock {
  return { perfStartMs: 1000, wallStartMs: 1700000000000, nowMs, wallNowMs: 1700000000000 + (nowMs - 1000) };
}

function installWindow(): void {
  (globalThis as unknown as Record<string, unknown>)["window"] = {
    __game: {},
  };
}

function readGame(): Record<string, unknown> {
  const w = (globalThis as unknown as Record<string, unknown>)[
    "window"
  ] as Record<string, unknown>;
  return w["__game"] as Record<string, unknown>;
}

function baseInput(): Parameters<typeof updateAnimState>[1][number] {
  return {
    vx: 0,
    vy: 0,
    aim: 0,
    onGround: true,
    jetting: false,
    crouching: false,
    alive: true,
    hurtAt: null,
    hp: 100,
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("gaitBlendFor", () => {
  it("rests at 0, spans to 1 at RUN_SPEED, and clamps beyond it", () => {
    expect(gaitBlendFor(0)).toBe(0);
    expect(gaitBlendFor(RUN_SPEED)).toBe(1);
    expect(gaitBlendFor(-RUN_SPEED)).toBe(1);
    expect(gaitBlendFor(RUN_SPEED * 3)).toBe(1);
  });

  it("lands strictly inside (0, 1) at intermediate speeds", () => {
    const mid = gaitBlendFor(RUN_SPEED / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(0.5, 10);
    expect(gaitBlendFor(RUN_SPEED / 4)).toBeLessThan(mid);
    expect(gaitBlendFor((3 * RUN_SPEED) / 4)).toBeGreaterThan(mid);
  });

  it("treats non-finite speeds as a stand", () => {
    expect(gaitBlendFor(Number.NaN)).toBe(0);
    expect(gaitBlendFor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("gait-scaled swing", () => {
  it("yields an intermediate swing strictly between standstill and sprint", () => {
    const atPhase = (vx: number): number => {
      const states = createAnimState(1);
      states[0].legPhase = Math.PI / 2;
      const [pose] = updateAnimState(states, [{ ...baseInput(), vx }], clockAt(1000), 0);
      return pose?.swing ?? Number.NaN;
    };
    const still = atPhase(0);
    const mid = atPhase(RUN_SPEED / 2);
    const full = atPhase(RUN_SPEED);
    expect(still).toBe(0);
    expect(full).toBeCloseTo(6, 10);
    expect(mid).toBeGreaterThan(still);
    expect(mid).toBeLessThan(full);
    expect(mid).toBeCloseTo(3, 10);
  });

  it("exposes the intermediate blend factor on the pose (no 0/1 snap)", () => {
    const states = createAnimState(1);
    const [pose] = updateAnimState(
      states,
      [{ ...baseInput(), vx: RUN_SPEED / 2 }],
      clockAt(1000),
      1 / 60,
    );
    expect(pose?.gaitBlend).toBeGreaterThan(0);
    expect(pose?.gaitBlend).toBeLessThan(1);
    expect(pose?.gaitBlend).toBeCloseTo(0.5, 10);
  });
});

describe("airBlendFor", () => {
  it("maps rising -500 to stand and falling +500 to crouch", () => {
    expect(AIR_VY_MIN).toBe(-500);
    expect(AIR_VY_MAX).toBe(500);
    expect(airBlendFor(-500)).toBe(0);
    expect(airBlendFor(500)).toBe(1);
    expect(airBlendFor(0)).toBeCloseTo(0.5, 10);
  });

  it("rises monotonically across the -500 to +500 band", () => {
    const samples = [-500, -250, 0, 250, 500].map(airBlendFor);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1] as number);
    }
  });

  it("aliases the crouch weight and clamps outside the band", () => {
    expect(airCrouchWeightFor(123)).toBe(airBlendFor(123));
    expect(airBlendFor(-5000)).toBe(0);
    expect(airBlendFor(5000)).toBe(1);
    expect(airBlendFor(Number.NaN)).toBe(0);
  });

  it("carries the air blend onto the pose from the frame vy", () => {
    const states = createAnimState(1);
    const [pose] = updateAnimState(
      states,
      [{ ...baseInput(), vy: -250, onGround: false }],
      clockAt(1000),
      1 / 60,
    );
    expect(pose?.airBlend).toBeCloseTo(0.25, 10);
    expect(pose?.crouchWeight).toBe(pose?.airBlend);
  });
});

describe("smoothAimStep", () => {
  it("caps each step at 12 rad/s and converges on the target", () => {
    expect(AIM_SMOOTH_RAD_PER_SEC).toBe(12);
    const step = smoothAimStep(0, Math.PI, 1 / 60);
    expect(step).toBeCloseTo(12 / 60, 10);
    expect(Math.abs(step - 0)).toBeLessThanOrEqual(12 / 60 + 1e-9);
    let aim = 0;
    for (let k = 0; k < 30; k += 1) {
      aim = smoothAimStep(aim, Math.PI, 1 / 60);
    }
    expect(aim).toBeCloseTo(Math.PI, 6);
  });

  it("takes the short way across the ±π seam without snapping", () => {
    const from = Math.PI - 0.05;
    const to = -Math.PI + 0.05;
    expect(shortestArcDelta(from, to)).toBeCloseTo(0.1, 10);
    const stepped = smoothAimStep(from, to, 1);
    expect(stepped).toBeGreaterThan(from);
    expect(Math.abs(shortestArcDelta(stepped, to))).toBeLessThan(0.1);
  });

  it("holds on non-positive dt and latches a non-finite start", () => {
    expect(smoothAimStep(1, 2, 0)).toBe(1);
    expect(smoothAimStep(1, 2, -1)).toBe(1);
    expect(smoothAimStep(Number.NaN, 0.5, 1 / 60)).toBe(0.5);
  });

  it("smooths the pose aim toward jumps instead of snapping", () => {
    const states = createAnimState(1);
    updateAnimState(states, [baseInput()], clockAt(1000), 0);
    const [pose] = updateAnimState(
      states,
      [{ ...baseInput(), aim: Math.PI }],
      clockAt(1016),
      1 / 60,
    );
    expect(pose?.aimSmoothed).toBeCloseTo(12 / 60, 10);
    expect(pose?.aimSmoothed).not.toBe(Math.PI);
  });
});

describe("landingSquashAt", () => {
  it("dips into [0.85, 0.95] at frame 0 and recovers to exactly 1.0", () => {
    expect(LAND_SQUASH_FRAMES).toBe(4);
    expect(LAND_SQUASH_MIN).toBeGreaterThanOrEqual(0.85);
    expect(LAND_SQUASH_MIN).toBeLessThanOrEqual(0.95);
    expect(landingSquashAt(0)).toBeGreaterThanOrEqual(0.85);
    expect(landingSquashAt(0)).toBeLessThanOrEqual(0.95);
    expect(landingSquashAt(4)).toBe(1);
    expect(landingSquashAt(99)).toBe(1);
    expect(landingSquashAt(null)).toBe(1);
    expect(landingSquashAt(-1)).toBe(1);
  });

  it("recovers monotonically across frames 0-4", () => {
    const samples = [0, 1, 2, 3, 4].map(landingSquashAt);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1] as number);
    }
    expect(samples[4]).toBe(1);
  });

  it("dips and recovers on the onGround false->true edge", () => {
    const states = createAnimState(1);
    const air = { ...baseInput(), onGround: false, vy: 300 };
    const ground = { ...baseInput(), onGround: true, vy: 0 };
    updateAnimState(states, [air], clockAt(1000), 1 / 60);
    const [landed] = updateAnimState(states, [ground], clockAt(1016), 1 / 60);
    expect(landed?.landSquash).toBeGreaterThanOrEqual(0.85);
    expect(landed?.landSquash).toBeLessThanOrEqual(0.95);
    expect(landed?.heightScale).toBeCloseTo(landed?.landSquash ?? 0, 10);
    let pose = landed;
    let now = 1016;
    for (let k = 0; k < 5; k += 1) {
      now += 16;
      [pose] = updateAnimState(states, [ground], clockAt(now), 1 / 60);
    }
    expect(pose?.landSquash).toBe(1);
    expect(pose?.heightScale).toBe(1);
  });

  it("multiplies the crouch squash by the landing dip", () => {
    const states = createAnimState(1);
    const air = { ...baseInput(), onGround: false, vy: 300 };
    updateAnimState(states, [air], clockAt(1000), 1 / 60);
    const [landed] = updateAnimState(
      states,
      [{ ...baseInput(), onGround: true, crouching: true }],
      clockAt(1016),
      1 / 60,
    );
    expect(landed?.heightScale).toBeLessThan(1);
    expect(landed?.heightScale).toBeCloseTo(
      (PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT) * (landed?.landSquash ?? 1),
      10,
    );
  });
});

describe("spawn and death ease", () => {
  it("ramps spawn ease 0→1 over 500ms and death ease over 300ms", () => {
    expect(SPAWN_EASE_MS).toBe(500);
    expect(DEATH_EASE_MS).toBe(300);
    expect(spawnEaseAt(0)).toBe(0);
    expect(spawnEaseAt(500)).toBe(1);
    expect(spawnEaseAt(9999)).toBe(1);
    expect(deathEaseAt(0)).toBe(0);
    expect(deathEaseAt(300)).toBe(1);
    expect(deathEaseAt(9999)).toBe(1);
    const spawn = [0, 125, 250, 375, 500].map(spawnEaseAt);
    for (let i = 1; i < spawn.length; i += 1) {
      expect(spawn[i]).toBeGreaterThan(spawn[i - 1] as number);
    }
    expect(spawnEaseAt(Number.NaN)).toBe(1);
    expect(deathEaseAt(Number.NaN)).toBe(1);
  });

  it("eases spawn on the alive edge while the blink toggle still applies", () => {
    const states = createAnimState(1);
    const dead = { ...baseInput(), alive: false, hp: 0 };
    updateAnimState(states, [dead], clockAt(1000), 0);
    const alive = { ...baseInput(), alive: true, hp: 100 };
    const [s0] = updateAnimState(states, [alive], clockAt(2000), 0.1);
    expect(s0?.spawnEase).toBe(0);
    const [s1] = updateAnimState(states, [alive], clockAt(2250), 0.05);
    expect(s1?.spawnEase).toBeGreaterThan(0);
    expect(s1?.spawnEase).toBeLessThan(1);
    const [s2] = updateAnimState(states, [alive], clockAt(2600), 0.05);
    expect(s2?.spawnEase).toBe(1);
    expect(s2?.spawnAlpha).toBe(1);
  });

  it("eases death on the true->false edge", () => {
    const states = createAnimState(1);
    updateAnimState(states, [baseInput()], clockAt(1000), 0);
    const dead = { ...baseInput(), alive: false, hp: 0 };
    const [d0] = updateAnimState(states, [dead], clockAt(1100), 0.1);
    expect(d0?.deathEase).toBe(0);
    expect(d0?.deadPose).toBe(true);
    const [d1] = updateAnimState(states, [dead], clockAt(1250), 0.05);
    expect(d1?.deathEase).toBeGreaterThan(0);
    expect(d1?.deathEase).toBeLessThan(1);
    const [d2] = updateAnimState(states, [dead], clockAt(1500), 0.05);
    expect(d2?.deathEase).toBe(1);
  });
});

describe("soldierLegOffsetBlended", () => {
  it("returns the base offset exactly at gait 1 and air 0", () => {
    const frames = ["idle", "run-a", "run-b", "jet", "crouch", "dead"] as const;
    for (const frame of frames) {
      for (const side of [-1, 1] as const) {
        expect(soldierLegOffsetBlended(frame, 4, side, 1, 0)).toEqual(
          soldierLegOffset(frame, 4, side),
        );
        expect(soldierLegOffsetBlended(frame, 4, side)).toEqual(
          soldierLegOffset(frame, 4, side),
        );
      }
    }
  });

  it("keeps jet tuck and dead splay at full weight under any blend", () => {
    expect(soldierLegOffsetBlended("dead", 4, -1, 0.2, 0.8)).toEqual(
      soldierLegOffset("dead", 4, -1),
    );
    expect(soldierLegOffsetBlended("jet", 4, 1, 0.2, 0.8)).toEqual(
      soldierLegOffset("jet", 4, 1),
    );
  });

  it("keeps run-a/run-b mirrored while scaling the stride by gait", () => {
    const a = soldierLegOffsetBlended("run-a", 4, 1, 0.5, 0);
    const b = soldierLegOffsetBlended("run-b", 4, 1, 0.5, 0);
    expect(a.dy).toBeCloseTo(2, 10);
    expect(b.dy).toBeCloseTo(-2, 10);
    expect(a.dy).toBe(-b.dy);
  });

  it("widens and lowers the stance with the air blend", () => {
    const grounded = soldierLegOffsetBlended("run-a", 4, 1, 1, 0);
    const air = soldierLegOffsetBlended("run-a", 4, 1, 1, 0.5);
    expect(Math.abs(air.dx)).toBeGreaterThan(Math.abs(grounded.dx));
    expect(air.dy).toBeGreaterThan(grounded.dy);
    const left = soldierLegOffsetBlended("run-a", 4, -1, 1, 0.5);
    expect(left.dx).toBe(-air.dx);
  });
});

describe("describeFrame vertical velocity", () => {
  it("threads sim vy through the frame pipe beside vx", () => {
    const world = new World({ seed: 7 });
    world.addPlayer({ x: 100, y: floorY() });
    world.step([{}]);
    const sim = world.players[0];
    if (sim === undefined) {
      throw new Error("expected a sim player");
    }
    sim.vy = 320;
    sim.vx = 145;
    const frame = describeFrame(world.state, world.map);
    expect(frame.players[0]).toMatchObject({ vx: 145, vy: 320 });
  });
});

describe("frame selection stability", () => {
  it("keeps the discrete selector on the pose flags alone", () => {
    expect(selectSoldierFrame({ deadPose: true, swing: 6 })).toBe("dead");
    expect(selectSoldierFrame({ tuck: true, swing: 6 })).toBe("jet");
    expect(selectSoldierFrame({ legPhase: 0, swing: 3 })).toBe("run-a");
    expect(selectSoldierFrame({ legPhase: Math.PI, swing: 3 })).toBe("run-b");
    expect(selectSoldierFrame({})).toBe("idle");
  });
});

describe("blended node posing and probes", () => {
  function fakePixi(): PixiFactory {
    class FakePoint {
      x = 0;
      y = 0;
      set(x: number, y: number): void {
        this.x = x;
        this.y = y;
      }
    }
    class FakeGraphics implements GraphicsLike {
      label = "";
      position = new FakePoint();
      rotation = 0;
      tint: number | string = 0xffffff;
      rect(): unknown {
        return undefined;
      }
      circle(): unknown {
        return undefined;
      }
      moveTo(): unknown {
        return undefined;
      }
      lineTo(): unknown {
        return undefined;
      }
      stroke(): unknown {
        return undefined;
      }
      fill(): unknown {
        return undefined;
      }
    }
    class FakeContainer {
      label = "";
      alpha = 1;
      visible = true;
      position = new FakePoint();
      scale = new FakePoint();
      children: FakeGraphics[] = [];
      addChild(child: FakeGraphics): FakeGraphics {
        this.children.push(child);
        return child;
      }
    }
    return {
      Container: FakeContainer,
      Graphics: FakeGraphics,
    };
  }

  it("rotates arms by the smoothed aim and dips scale.y on landing", () => {
    const node = buildPlayerNode(fakePixi(), 0);
    syncPlayerNode(node, {
      x: 0,
      y: 0,
      scale: 2,
      aim: 1,
      aimSmoothed: 0.5,
      colorHex: 0x00e5ff,
      alpha: 1,
      squash: 1,
      landSquash: 0.9,
      visible: true,
      legSwing: 4,
    });
    if (!("position" in node)) {
      throw new Error("expected a real container node");
    }
    expect(node.scale.y).toBeCloseTo(1.8, 10);
    const arms = node.children.filter(
      (child) => child.label === "armL" || child.label === "armR",
    );
    expect(arms.length).toBeGreaterThan(0);
    for (const arm of arms) {
      expect(arm.rotation).toBe(0.5);
    }
  });

  it("falls back to the raw aim and full scale without blend fields", () => {
    const node = buildPlayerNode(fakePixi(), 0);
    syncPlayerNode(node, {
      x: 0,
      y: 0,
      scale: 2,
      aim: 1,
      colorHex: 0x00e5ff,
      alpha: 1,
      squash: 1,
      visible: true,
    });
    if (!("position" in node)) {
      throw new Error("expected a real container node");
    }
    expect(node.scale.y).toBe(2);
    const arm = node.children.find((child) => child.label === "armR");
    expect(arm?.rotation).toBe(1);
  });

  it("merges additive blend defaults without replacing tick/state", () => {
    installWindow();
    const game = readGame();
    game["tick"] = 7;
    game["state"] = "playing";
    const nodes: PlayerNode[] = [buildPlayerNode(null, 0)];
    publishGameProbes(
      nodes,
      [0],
      [{ color: 0x00e5ff, colorCss: "#00E5FF" }],
      { x: 1, y: 2 },
      { x: 1, y: 2 },
    );
    const after = readGame();
    expect(after["tick"]).toBe(7);
    expect(after["gaitBlend"]).toBe(0);
    expect(after["airBlend"]).toBe(0);
    expect(after["crouchWeight"]).toBe(0);
    expect(after["aimSmoothed"]).toBe(0);
    expect(after["landSquash"]).toBe(1);
    expect(after["scaleY"]).toBe(1);
    expect(after["spawnEase"]).toBe(1);
    expect(after["deathEase"]).toBe(1);
  });

  it("publishes per-player blend fields beside frame and weapon", () => {
    installWindow();
    const nodes: PlayerNode[] = [buildPlayerNode(null, 0)];
    publishGameProbes(
      nodes,
      [0],
      [{ color: 0x00e5ff, colorCss: "#00E5FF" }],
      { x: 1, y: 2 },
      { x: 1, y: 2 },
      {
        legPhase: 1,
        isFlameVisible: false,
        playerHeightScale: 1,
        isHurtFlash: false,
        gaitBlend: 0.5,
        airBlend: 0.25,
        aimSmoothed: 0.3,
        landSquash: 0.9,
        spawnEase: 0.4,
        deathEase: 1,
      },
      [
        {
          frame: "run-a",
          weapon: "rifle",
          gaitBlend: 0.5,
          airBlend: 0.25,
          crouchWeight: 0.25,
          aimSmoothed: 0.3,
          landSquash: 0.9,
          spawnEase: 0.4,
          deathEase: 1,
        },
      ],
    );
    const after = readGame();
    expect(after["gaitBlend"]).toBe(0.5);
    expect(after["airBlend"]).toBe(0.25);
    expect(after["crouchWeight"]).toBe(0.25);
    expect(after["aimSmoothed"]).toBe(0.3);
    expect(after["landSquash"]).toBe(0.9);
    expect(after["scaleY"]).toBe(0.9);
    expect(after["spawnEase"]).toBe(0.4);
    const players = after["players"] as Record<string, unknown>[];
    expect(players[0]).toMatchObject({
      frame: "run-a",
      weapon: "rifle",
      gaitBlend: 0.5,
      airBlend: 0.25,
      landSquash: 0.9,
    });
  });
});
