// Pure per-player animation math for the composed character sprite.
// DOM/Pixi-free: every helper takes plain numbers and every clock value
// arrives as an argument, so the whole module stays unit-testable under
// node. The renderer owns one AnimState per player, advances it with the
// wall-clock draw dt, and poses the Pixi/canvas2d backends from the
// returned AnimPose. No sim changes: all motion derives from existing
// sim fields (vx, onGround, jetting, crouching, hurtAt, alive, hp).
import {
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  RUN_SPEED,
  TICK_HZ,
} from "../../../core/src/constants";

/** Leg-cycle rate in radians per second at full RUN_SPEED. */
export const STRIDE_RATE = 14;
/** Peak leg-swing offset in local px at full RUN_SPEED. */
export const RUN_SWING_PX = 6;
/** Horizontal speed in world px/s above which the run cycle advances. */
export const RUN_PHASE_MIN_VX = 120;
/** White hurt-flash duration in ms after a hurt timestamp. */
export const HURT_FLASH_MS = 150;
/** Spawn-blink duration in ms after an alive false->true edge. */
export const SPAWN_BLINK_MS = 500;
/** Spawn-blink toggle rate in Hz (toggles every 50ms). */
export const SPAWN_BLINK_HZ = 10;
/** Spawn-blink toggle period in ms (half of the 10Hz full cycle). */
export const SPAWN_BLINK_PERIOD_MS = 1000 / SPAWN_BLINK_HZ / 2;
/** Spawn-blink dim opacity (matches the tick blink BLINK_DIM_ALPHA). */
export const SPAWN_BLINK_DIM = 0.25;
/** The forbidden rect-flicker flame never exists; probes read false. */
export const FLICKER_RECT_VISIBLE = false;
/** Tucked-leg lift in local px while jetting (legs shift up together). */
export const TUCK_UP_PX = 6;
/** Tucked-leg inward shift in local px while jetting (toward center). */
export const TUCK_IN_PX = 3;
/** Burst-pose outward splay in local px per leg while dead. */
export const DEAD_SPLAY_PX = 5;
/** Burst-pose lift in local px while dead (legs kick out and up). */
export const DEAD_LIFT_PX = 2;

/** Per-frame sim snapshot for one player (mapped from FramePlayer). */
export interface AnimInput {
  vx: number;
  onGround: boolean;
  jetting: boolean;
  crouching: boolean;
  alive: boolean;
  /** Dynamic hurt timestamp (perf-ms, Date-ms, or sim tick), else null. */
  hurtAt: number | null;
  hp: number;
}

/** Session clock anchors mapping foreign timestamps onto perf-ms. */
export interface AnimClock {
  /** performance.now() at the first draw of the session. */
  perfStartMs: number;
  /** Date.now() at the first draw of the session. */
  wallStartMs: number;
  /** performance.now() at the current draw. */
  nowMs: number;
  /** Date.now() at the current draw. */
  wallNowMs: number;
}

/** Accumulated per-player animation state (owned by the renderer). */
export interface AnimState {
  /** Wall-clock leg-cycle phase in radians (probed as legPhase). */
  legPhase: number;
  /** Freshest resolved hurt timestamp in perf-ms (null until first hit). */
  lastHurtAtMs: number | null;
  /** HP observed on the previous update (hp-drop edge source). */
  lastHp: number | null;
  /** Alive-edge timestamp in perf-ms for the 500ms spawn blink. */
  spawnAtMs: number | null;
  /** Alive flag on the previous update (false->true spawn edge). */
  wasAlive: boolean;
  /** True once the first update has latched hp/alive baselines. */
  started: boolean;
}

/** Per-frame pose derived for one player. */
export interface AnimPose {
  legPhase: number;
  /** Signed leg offset in local px (legL -swing, legR +swing). */
  swing: number;
  /** True while jetting alive (legs tuck, swing suppressed). */
  tuck: boolean;
  /** Vertical squash (crouch ratio, else 1). */
  heightScale: number;
  /** True while inside the 150ms white-flash window. */
  hurtFlash: boolean;
  /** Spawn-blink opacity (1 at rest). */
  spawnAlpha: number;
  /** True while dead (burst pose: legs splayed). */
  deadPose: boolean;
  /** True while alive and jetting (two-circle flame, never a rect). */
  flame: boolean;
}

/**
 * Wall-clock leg-phase increment in radians for one draw. Advances only
 * while grounded and running above RUN_PHASE_MIN_VX, scaling linearly
 * with |vx| so the probe delta grows with speed. Wall-clock (never
 * tick-derived) so the phase stays observable when rAF throttles or the
 * sim pauses between draws.
 */
export function legPhaseStep(
  vx: number,
  onGround: boolean,
  dtSec: number,
): number {
  if (!onGround || dtSec <= 0) {
    return 0;
  }
  const speed = Math.abs(vx);
  if (speed <= RUN_PHASE_MIN_VX) {
    return 0;
  }
  return dtSec * (speed / RUN_SPEED) * STRIDE_RATE;
}

/** Peak leg-swing offset in local px, scaling linearly with |vx|. */
export function swingAmplitude(vx: number): number {
  return Math.min(1, Math.abs(vx) / RUN_SPEED) * RUN_SWING_PX;
}

/** Vertical squash: the crouch height ratio while crouching, else 1. */
export function heightScaleFor(crouching: boolean): number {
  return crouching ? PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT : 1;
}

/**
 * True while nowMs sits inside [hurtAtMs, hurtAtMs + HURT_FLASH_MS).
 * A future-dated timestamp never flashes (guards clock skew).
 */
export function hurtFlashActive(
  nowMs: number,
  hurtAtMs: number | null,
): boolean {
  if (hurtAtMs === null) {
    return false;
  }
  const elapsed = nowMs - hurtAtMs;
  return elapsed >= 0 && elapsed < HURT_FLASH_MS;
}

/**
 * Resolve a foreign hurt timestamp onto the perf-ms clock. Accepts three
 * bases and keeps the most recent plausible reading: a
 * performance.now()-basis value as-is, a Date.now()-basis value mapped
 * through the session anchors, or a sim-tick count (<1e6) mapped via
 * tick * 1000/TICK_HZ from the session start. Returns null for
 * non-finite values or readings entirely outside the session window.
 */
export function resolveHurtAtMs(
  hurtAt: number | null | undefined,
  clock: AnimClock,
): number | null {
  if (typeof hurtAt !== "number" || !Number.isFinite(hurtAt)) {
    return null;
  }
  const cands: number[] = [];
  if (hurtAt >= 0 && hurtAt <= clock.nowMs + 50) {
    cands.push(hurtAt);
  }
  const fromWall = clock.perfStartMs + (hurtAt - clock.wallStartMs);
  if (fromWall >= 0 && fromWall <= clock.nowMs + 50) {
    cands.push(fromWall);
  }
  if (hurtAt >= 0 && hurtAt < 1e6) {
    const fromTick = clock.perfStartMs + (hurtAt * 1000) / TICK_HZ;
    if (fromTick >= 0 && fromTick <= clock.nowMs + 50) {
      cands.push(fromTick);
    }
  }
  if (cands.length === 0) {
    return null;
  }
  return Math.max(...cands);
}

/**
 * Spawn-blink opacity: 10Hz toggles between 1 and SPAWN_BLINK_DIM for
 * SPAWN_BLINK_MS after spawnAtMs, resting at 1 before/after (null
 * spawnAtMs or a future stamp also rest at 1).
 */
export function spawnBlinkAlpha(
  nowMs: number,
  spawnAtMs: number | null,
): number {
  if (spawnAtMs === null) {
    return 1;
  }
  const elapsed = nowMs - spawnAtMs;
  if (elapsed < 0 || elapsed >= SPAWN_BLINK_MS) {
    return 1;
  }
  return Math.floor(elapsed / SPAWN_BLINK_PERIOD_MS) % 2 === 0
    ? 1
    : SPAWN_BLINK_DIM;
}

/** Fresh per-player animation states (all phases at rest). */
export function createAnimState(count: number): AnimState[] {
  const states: AnimState[] = [];
  for (let i = 0; i < count; i += 1) {
    states.push({
      legPhase: 0,
      lastHurtAtMs: null,
      lastHp: null,
      spawnAtMs: null,
      wasAlive: false,
      started: false,
    });
  }
  return states;
}

/** Grow a state store to the live player count (fresh states at rest). */
export function ensureAnimState(store: AnimState[], count: number): void {
  while (store.length < count) {
    store.push({
      legPhase: 0,
      lastHurtAtMs: null,
      lastHp: null,
      spawnAtMs: null,
      wasAlive: false,
      started: false,
    });
  }
}

/**
 * Advance every per-player state one draw and derive its pose. Latches
 * hurt from three sources in priority order: a finite dynamic hurtAt on
 * the sim player (any clock basis), a damage detail for that victim
 * index this draw, or an hp-drop edge. Latches spawnAtMs on the first
 * sight of an alive player and on every alive false->true transition.
 * Pure apart from the caller-supplied clock: no DOM, no direct clock
 * reads, capped arrays untouched (damage indices arrive pre-mapped).
 */
export function updateAnimState(
  store: AnimState[],
  inputs: readonly AnimInput[],
  clock: AnimClock,
  dtSec: number,
  damageVictims?: readonly number[],
): AnimPose[] {
  ensureAnimState(store, inputs.length);
  const poses: AnimPose[] = [];
  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i] as AnimInput;
    const state = store[i] as AnimState;
    if (!state.started) {
      state.lastHp = input.hp;
      state.wasAlive = input.alive;
      state.spawnAtMs = input.alive ? clock.nowMs : null;
      state.started = true;
    }
    state.legPhase += legPhaseStep(input.vx, input.onGround, dtSec);
    const resolved = resolveHurtAtMs(input.hurtAt, clock);
    if (resolved !== null) {
      state.lastHurtAtMs =
        state.lastHurtAtMs === null
          ? resolved
          : Math.max(state.lastHurtAtMs, resolved);
    }
    if (damageVictims !== undefined && damageVictims.includes(i)) {
      state.lastHurtAtMs =
        state.lastHurtAtMs === null
          ? clock.nowMs
          : Math.max(state.lastHurtAtMs, clock.nowMs);
    }
    if (state.lastHp !== null && input.hp < state.lastHp) {
      state.lastHurtAtMs =
        state.lastHurtAtMs === null
          ? clock.nowMs
          : Math.max(state.lastHurtAtMs, clock.nowMs);
    }
    state.lastHp = input.hp;
    if (input.alive && !state.wasAlive) {
      state.spawnAtMs = clock.nowMs;
    }
    state.wasAlive = input.alive;
    const tuck = input.jetting && input.alive;
    const deadPose = !input.alive;
    const swing =
      tuck || deadPose
        ? 0
        : Math.sin(state.legPhase) * swingAmplitude(input.vx);
    poses.push({
      legPhase: state.legPhase,
      swing,
      tuck,
      heightScale: heightScaleFor(input.crouching),
      hurtFlash: hurtFlashActive(clock.nowMs, state.lastHurtAtMs),
      spawnAlpha: spawnBlinkAlpha(clock.nowMs, state.spawnAtMs),
      deadPose,
      flame: input.alive && input.jetting,
    });
  }
  return poses;
}
