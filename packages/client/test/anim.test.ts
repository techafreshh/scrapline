// Animation states driven from sim state: pure anim math, describeFrame
// passthrough, node posing, and probe merging. World-driven fixtures, no
// DOM (window is stubbed for the probe cases, mirroring character.test.ts).
import { afterEach, describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import { PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from "../../core/src/constants";
import {
  FLICKER_RECT_VISIBLE,
  HURT_FLASH_MS,
  SPAWN_BLINK_DIM,
  SPAWN_BLINK_HZ,
  SPAWN_BLINK_MS,
  SPAWN_BLINK_PERIOD_MS,
  createAnimState,
  heightScaleFor,
  hurtFlashActive,
  legPhaseStep,
  resolveHurtAtMs,
  spawnBlinkAlpha,
  swingAmplitude,
  updateAnimState,
  type AnimClock,
} from "../src/view/anim";
import { CROUCH_SQUASH } from "../src/view/character";
import {
  buildPlayerNode,
  publishGameProbes,
  syncPlayerNode,
  type GraphicsLike,
  type PixiFactory,
  type PlayerNode,
} from "../src/view/playerView";
import { describeFrame } from "../src/renderer/index";

function floorY(): number {
  // Default arena: 20 rows, floor top at row 18 => y=576; standing height 58.
  return 18 * 32 - PLAYER_HEIGHT;
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

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("legPhaseStep", () => {
  it("advances proportionally to |vx| only while grounded and running", () => {
    const dt = 1 / 60;
    expect(legPhaseStep(200, true, dt)).toBeGreaterThan(0);
    expect(legPhaseStep(-250, true, dt)).toBeGreaterThan(0);
    expect(legPhaseStep(200, true, dt)).toBeGreaterThan(
      legPhaseStep(150, true, dt),
    );
    expect(legPhaseStep(200, false, dt)).toBe(0);
    expect(legPhaseStep(0, true, dt)).toBe(0);
    expect(legPhaseStep(50, true, dt)).toBe(0);
    expect(legPhaseStep(200, true, 0)).toBe(0);
  });
});

describe("run-cycle phase accumulation", () => {
  it("grows legPhase by >0.3 rad over 200ms at |vx|=200 grounded", () => {
    const states = createAnimState(1);
    const base: Parameters<typeof updateAnimState>[1][number] = {
      vx: 200,
      onGround: true,
      jetting: false,
      crouching: false,
      alive: true,
      hurtAt: null,
      hp: 100,
    };
    updateAnimState(states, [base], clockAt(1000), 0);
    const start = states[0]?.legPhase ?? 0;
    let now = 1000;
    for (let k = 0; k < 12; k += 1) {
      now += 1000 / 60;
      updateAnimState(states, [base], clockAt(now), 1 / 60);
    }
    const delta = (states[0]?.legPhase ?? 0) - start;
    expect(delta).toBeGreaterThan(0.3);
  });

  it("holds legPhase fixed airborne and idle (World-driven inputs)", () => {
    const world = new World({ seed: 21 });
    world.addPlayer({ x: 100, y: floorY() });
    world.step([{}]);
    const frame = describeFrame(world.state, world.map);
    expect(frame.players[0]?.onGround).toBe(true);
    const states = createAnimState(1);
    const running = {
      vx: 200,
      onGround: true,
      jetting: false,
      crouching: false,
      alive: true,
      hurtAt: null,
      hp: 100,
    };
    updateAnimState(states, [running], clockAt(1000), 0);
    updateAnimState(states, [running], clockAt(1100), 0.1);
    const afterRun = states[0]?.legPhase ?? 0;
    expect(afterRun).toBeGreaterThan(0);
    const air = { ...running, onGround: false };
    updateAnimState(states, [air], clockAt(1300), 0.2);
    expect(states[0]?.legPhase ?? 0).toBe(afterRun);
    const idle = { ...running, vx: 0 };
    updateAnimState(states, [idle], clockAt(1500), 0.2);
    expect(states[0]?.legPhase ?? 0).toBe(afterRun);
  });
});

describe("swing amplitude", () => {
  it("scales with |vx| and rests at zero when still", () => {
    expect(swingAmplitude(0)).toBe(0);
    expect(swingAmplitude(100)).toBeGreaterThan(0);
    expect(swingAmplitude(290)).toBeGreaterThan(swingAmplitude(100));
    expect(swingAmplitude(-290)).toBe(swingAmplitude(290));
  });
});

describe("hurt flash", () => {
  it("is active inside 150ms and clear after 400ms", () => {
    expect(hurtFlashActive(1000, 900)).toBe(true);
    expect(hurtFlashActive(1000, 1000)).toBe(true);
    expect(hurtFlashActive(1000, 851)).toBe(true);
    expect(hurtFlashActive(1000, 850)).toBe(false);
    expect(hurtFlashActive(1400, 1000)).toBe(false);
    expect(hurtFlashActive(1000, null)).toBe(false);
    expect(hurtFlashActive(1000, 1200)).toBe(false);
  });

  it("resolves perf-ms, Date-ms, and tick bases onto the draw clock", () => {
    const clock = clockAt(5000);
    expect(HURT_FLASH_MS).toBe(150);
    // performance.now basis: hurt stamped at the current draw.
    expect(resolveHurtAtMs(4950, clock)).toBe(4950);
    // Date.now basis: wall timestamp mapped through the session anchors.
    expect(resolveHurtAtMs(clock.wallNowMs - 50, clock)).toBeCloseTo(
      4950,
      0,
    );
    // Sim-tick basis: tick 60 at 60Hz lands 1s after the session start.
    expect(resolveHurtAtMs(60, clock)).toBeCloseTo(2000, 0);
    expect(resolveHurtAtMs(null, clock)).toBe(null);
    expect(resolveHurtAtMs(Number.NaN, clock)).toBe(null);
  });

  it("latches hurt from damage details and hp-drop edges", () => {
    const states = createAnimState(1);
    const healthy = {
      vx: 0,
      onGround: true,
      jetting: false,
      crouching: false,
      alive: true,
      hurtAt: null,
      hp: 100,
    };
    const [rest] = updateAnimState(states, [healthy], clockAt(1000), 0);
    expect(rest?.hurtFlash).toBe(false);
    const [hit] = updateAnimState(states, [healthy], clockAt(1100), 0.1, [0]);
    expect(hit?.hurtFlash).toBe(true);
    const [late] = updateAnimState(states, [healthy], clockAt(1600), 0.1);
    expect(late?.hurtFlash).toBe(false);
    const wounded = { ...healthy, hp: 80 };
    const [edge] = updateAnimState(states, [wounded], clockAt(1700), 0.1);
    expect(edge?.hurtFlash).toBe(true);
  });
});

describe("crouch height scale", () => {
  it("reports the crouch ratio inside [0.6, 0.8] and 1 standing", () => {
    expect(PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT).toBe(CROUCH_SQUASH);
    expect(heightScaleFor(true)).toBeGreaterThanOrEqual(0.6);
    expect(heightScaleFor(true)).toBeLessThanOrEqual(0.8);
    expect(heightScaleFor(false)).toBe(1);
  });
});

describe("jet flame probes", () => {
  it("shows the flame only while alive and jetting, never a flicker rect", () => {
    expect(FLICKER_RECT_VISIBLE).toBe(false);
    const states = createAnimState(1);
    const base = {
      vx: 0,
      onGround: false,
      jetting: false,
      crouching: false,
      alive: true,
      hurtAt: null,
      hp: 100,
    };
    const [idle] = updateAnimState(states, [base], clockAt(1000), 0);
    expect(idle?.flame).toBe(false);
    expect(idle?.tuck).toBe(false);
    const [jet] = updateAnimState(
      states,
      [{ ...base, jetting: true }],
      clockAt(1100),
      0.1,
    );
    expect(jet?.flame).toBe(true);
    expect(jet?.tuck).toBe(true);
    expect(jet?.swing).toBe(0);
    const [deadJet] = updateAnimState(
      states,
      [{ ...base, jetting: true, alive: false }],
      clockAt(1200),
      0.1,
    );
    expect(deadJet?.flame).toBe(false);
    expect(deadJet?.deadPose).toBe(true);
  });
});

describe("spawn blink", () => {
  it("toggles at 10Hz for 500ms then rests at 1", () => {
    expect(SPAWN_BLINK_MS).toBe(500);
    expect(SPAWN_BLINK_HZ).toBe(10);
    expect(SPAWN_BLINK_PERIOD_MS).toBe(50);
    let toggles = 0;
    let prev = spawnBlinkAlpha(0, 0);
    for (let t = 10; t < 500; t += 10) {
      const next = spawnBlinkAlpha(t, 0);
      if (next !== prev) {
        toggles += 1;
      }
      prev = next;
    }
    expect(toggles).toBeGreaterThanOrEqual(4);
    expect(spawnBlinkAlpha(600, 0)).toBe(1);
    expect(spawnBlinkAlpha(100, null)).toBe(1);
    expect(new Set([spawnBlinkAlpha(0, 0), spawnBlinkAlpha(50, 0)])).toEqual(
      new Set([1, SPAWN_BLINK_DIM]),
    );
  });

  it("latches spawn on the alive false->true edge with a dimmer alpha", () => {
    const states = createAnimState(1);
    const dead = {
      vx: 0,
      onGround: true,
      jetting: false,
      crouching: false,
      alive: false,
      hurtAt: null,
      hp: 0,
    };
    const [d0] = updateAnimState(states, [dead], clockAt(1000), 0);
    expect(d0?.deadPose).toBe(true);
    expect(d0?.spawnAlpha).toBe(1);
    const alive = { ...dead, alive: true, hp: 100 };
    const [s0] = updateAnimState(states, [alive], clockAt(2000), 0.1);
    expect(s0?.deadPose).toBe(false);
    expect(s0?.spawnAlpha).toBe(1);
    const [s1] = updateAnimState(states, [alive], clockAt(2050), 0.05);
    expect(s1?.spawnAlpha).toBe(SPAWN_BLINK_DIM);
  });
});

describe("describeFrame animation passthrough", () => {
  it("maps vx, crouching, hurtAt, and hp from the sim player", () => {
    const world = new World({ seed: 31 });
    world.addPlayer({ x: 100, y: floorY() });
    world.step([{}]);
    const sim = world.players[0];
    if (sim === undefined) {
      throw new Error("expected a sim player");
    }
    sim.vx = 200;
    (sim as unknown as Record<string, unknown>)["hurtAt"] = 1234;
    const frame = describeFrame(world.state, world.map);
    expect(frame.players[0]).toMatchObject({
      vx: 200,
      crouching: false,
      hurtAt: 1234,
      hp: sim.hp,
    });
    world.step([{ crouch: true }]);
    const crouched = describeFrame(world.state, world.map);
    expect(crouched.players[0]?.crouching).toBe(true);
    expect(crouched.players[0]?.h).toBe(PLAYER_CROUCH_HEIGHT);
    const clean = describeFrame(world.state, world.map);
    void clean;
  });

  it("defaults hurtAt to null when the sim carries no timestamp", () => {
    const world = new World({ seed: 33 });
    world.addPlayer({ x: 100, y: floorY() });
    world.step([{}]);
    expect(describeFrame(world.state, world.map).players[0]?.hurtAt).toBe(
      null,
    );
  });
});

describe("syncPlayerNode animation posing", () => {
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

  function legPositions(node: PlayerNode): Record<string, { x: number; y: number }> {
    if (!("position" in node)) {
      throw new Error("expected a real container node");
    }
    const out: Record<string, { x: number; y: number }> = {};
    for (const child of node.children) {
      if (child.label === "legL" || child.label === "legR") {
        out[child.label] = { x: child.position.x, y: child.position.y };
      }
    }
    return out;
  }

  it("offsets the leg children in opposition for the run swing", () => {
    const node = buildPlayerNode(fakePixi(), 0);
    syncPlayerNode(node, {
      x: 0,
      y: 0,
      scale: 2,
      aim: 0,
      colorHex: 0x00e5ff,
      alpha: 1,
      squash: 1,
      visible: true,
      legSwing: 4,
    });
    const legs = legPositions(node);
    expect(legs["legL"]?.y).toBe(-4);
    expect(legs["legR"]?.y).toBe(4);
    expect(legs["legL"]?.x).toBe(0);
  });

  it("tucks both legs up and toward the center while jetting", () => {
    const node = buildPlayerNode(fakePixi(), 0);
    syncPlayerNode(node, {
      x: 0,
      y: 0,
      scale: 2,
      aim: 0,
      colorHex: 0x00e5ff,
      alpha: 1,
      squash: 1,
      visible: true,
      legSwing: 4,
      tuck: true,
    });
    const legs = legPositions(node);
    expect(legs["legL"]?.y).toBeLessThan(0);
    expect(legs["legR"]?.y).toBeLessThan(0);
    expect(legs["legL"]?.x).toBeGreaterThan(0);
    expect(legs["legR"]?.x).toBeLessThan(0);
  });

  it("splays the legs for the dead burst pose and flashes white on hurt", () => {
    const node = buildPlayerNode(fakePixi(), 0);
    syncPlayerNode(node, {
      x: 0,
      y: 0,
      scale: 2,
      aim: 0.3,
      colorHex: 0x00e5ff,
      alpha: 1,
      squash: 1,
      visible: true,
      deadPose: true,
      hurtFlash: true,
    });
    if (!("position" in node)) {
      throw new Error("expected a real container node");
    }
    const legs = legPositions(node);
    expect(legs["legL"]?.x).toBeLessThan(0);
    expect(legs["legR"]?.x).toBeGreaterThan(0);
    for (const child of node.children) {
      expect(child.tint).toBe(0xffffff);
    }
  });
});

describe("publishGameProbes animation globals", () => {
  it("merges legPhase, flame, height, and hurt flash without replacing tick/state", () => {
    installWindow();
    const game = readGame();
    game["tick"] = 41;
    game["state"] = "playing";
    const nodes: PlayerNode[] = [buildPlayerNode(null, 0)];
    publishGameProbes(
      nodes,
      [0],
      [{ color: 0x00e5ff, colorCss: "#00E5FF" }],
      { x: 1, y: 2 },
      { x: 1, y: 2 },
      {
        legPhase: 1.5,
        isFlameVisible: true,
        playerHeightScale: CROUCH_SQUASH,
        isHurtFlash: true,
      },
    );
    const after = readGame();
    expect(after["tick"]).toBe(41);
    expect(after["state"]).toBe("playing");
    expect(after["legPhase"]).toBe(1.5);
    expect(after["isFlameVisible"]).toBe(true);
    expect(after["isFlickerRectVisible"]).toBe(false);
    expect(after["playerHeightScale"]).toBeCloseTo(CROUCH_SQUASH, 10);
    expect(after["isHurtFlash"]).toBe(true);
  });

  it("seeds sane animation defaults when no anim values are passed", () => {
    installWindow();
    publishGameProbes([], [], [], { x: 0, y: 0 }, { x: 0, y: 0 });
    const after = readGame();
    expect(after["legPhase"]).toBe(0);
    expect(after["isFlameVisible"]).toBe(false);
    expect(after["isFlickerRectVisible"]).toBe(false);
    expect(after["playerHeightScale"]).toBe(1);
    expect(after["isHurtFlash"]).toBe(false);
  });
});
