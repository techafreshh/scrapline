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
/** Gait-blend walk reference in world px/s (at or below this reads as a stand). */
export const GAIT_WALK_VX = 0;
/** Air-blend floor in world px/s (rising this fast reads stand/streamline). */
export const AIR_VY_MIN = -500;
/** Air-blend ceiling in world px/s (falling this fast reads crouch/brace). */
export const AIR_VY_MAX = 500;
/** Aim-smoothing cap in rad/s (shortest-arc, never snaps on a ±π crossing). */
export const AIM_SMOOTH_RAD_PER_SEC = 12;
/** Landing-squash dip length in draws (frames 0-4, recovered by frame 4). */
export const LAND_SQUASH_FRAMES = 4;
/** Landing-squash minimum at touchdown (inside the 0.85-0.95 probe band). */
export const LAND_SQUASH_MIN = 0.9;
/** Spawn-ease ramp in ms (same window as the spawn blink). */
export const SPAWN_EASE_MS = 500;
/** Death-ease ramp in ms. */
export const DEATH_EASE_MS = 300;

/** Per-frame sim snapshot for one player (mapped from FramePlayer). */
export interface AnimInput {
  vx: number;
  /** Vertical velocity in world px/s (drives the air blend, defaults to 0). */
  vy?: number;
  /** Aim angle in radians (drives the smoothed aim, defaults to 0). */
  aim?: number;
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
  /** Smoothed aim in radians (shortest-arc capped, null until latched). */
  smoothedAim: number | null;
  /** True while the last update saw the player airborne. */
  airborne: boolean;
  /** Draws since the onGround false->true edge (null outside the dip). */
  framesSinceLand: number | null;
  /** Alive-edge timestamp in perf-ms starting the spawn ease ramp. */
  spawnEaseStartMs: number | null;
  /** Death-edge timestamp in perf-ms starting the death ease ramp. */
  deathEaseStartMs: number | null;
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
  /** Walk↔sprint blend in [0, 1] (|vx| / RUN_SPEED, intermediate, never a snap). */
  gaitBlend: number;
  /** Stand↔crouch air blend in [0, 1] (monotonic increasing with vy). */
  airBlend: number;
  /** Alias of airBlend (crouch weight while airborne). */
  crouchWeight: number;
  /** Smoothed aim in radians (shortest-arc capped, no ±π snap). */
  aimSmoothed: number;
  /** Landing squash (0.90 dip at touchdown, exactly 1.0 outside frames 0-4). */
  landSquash: number;
  /** Spawn ease in [0, 1] (smoothstep over SPAWN_EASE_MS, rests at 1). */
  spawnEase: number;
  /** Death ease in [0, 1] (smoothstep over DEATH_EASE_MS, rests at 1). */
  deathEase: number;
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

/**
 * Walk↔sprint blend in [0, 1]: |vx| / RUN_SPEED clamped, so an
 * intermediate speed yields an intermediate factor (never a 0/1 snap).
 * Non-finite readings blend to a stand (0). Pure: no DOM, no clock.
 */
export function gaitBlendFor(vx: number): number {
  const speed = Math.abs(vx);
  if (!Number.isFinite(speed)) {
    return 0;
  }
  return Math.min(1, Math.max(0, speed / RUN_SPEED));
}

/**
 * Stand↔crouch air blend in [0, 1]: (vy + 500) / 1000 clamped, so the
 * crouch weight rises monotonically with vy (rising -500 reads
 * stand/streamline, falling +500 reads crouch/brace). Non-finite
 * readings blend to a stand (0). Pure: no DOM, no clock.
 */
export function airBlendFor(vy: number): number {
  if (!Number.isFinite(vy)) {
    return 0;
  }
  return Math.min(1, Math.max(0, (vy - AIR_VY_MIN) / (AIR_VY_MAX - AIR_VY_MIN)));
}

/** Alias of airBlendFor (crouch weight while airborne). */
export function airCrouchWeightFor(vy: number): number {
  return airBlendFor(vy);
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
 * Shortest signed arc from one aim angle to another, wrapped into
 * [-π, π] so smoothing takes the short way across the ±π seam.
 * Non-finite readings hold (0). Pure: no DOM, no clock.
 */
export function shortestArcDelta(from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return 0;
  }
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

/**
 * One capped aim-smoothing step: advances prev toward target along the
 * shortest arc by at most AIM_SMOOTH_RAD_PER_SEC * dtSec, so the arm
 * never snaps (even across ±π). Non-positive or non-finite dtSec holds
 * the previous aim; a non-finite prev snaps to a finite target (latch).
 * Pure: the clock arrives as dtSec, no DOM reads.
 */
export function smoothAimStep(prev: number, target: number, dtSec: number): number {
  if (!Number.isFinite(prev)) {
    return Number.isFinite(target) ? target : 0;
  }
  if (!Number.isFinite(target)) {
    return prev;
  }
  if (!Number.isFinite(dtSec) || dtSec <= 0) {
    return prev;
  }
  const delta = shortestArcDelta(prev, target);
  const maxStep = AIM_SMOOTH_RAD_PER_SEC * dtSec;
  if (delta > maxStep) {
    return prev + maxStep;
  }
  if (delta < -maxStep) {
    return prev - maxStep;
  }
  return prev + delta;
}

/**
 * Landing squash for a draws-since-touchdown reading: a half-cosine dip
 * to LAND_SQUASH_MIN at frame 0 easing back to exactly 1.0 by frame
 * LAND_SQUASH_FRAMES, holding 1 outside the window. Non-finite, null,
 * or negative readings rest at 1. Pure: no DOM, no clock reads.
 */
export function landingSquashAt(framesSinceLand: number | null | undefined): number {
  if (framesSinceLand === null || framesSinceLand === undefined) {
    return 1;
  }
  const frames = Number(framesSinceLand);
  if (!Number.isFinite(frames) || frames < 0 || frames >= LAND_SQUASH_FRAMES) {
    return 1;
  }
  return 1 - (1 - LAND_SQUASH_MIN) * Math.cos((frames / LAND_SQUASH_FRAMES) * (Math.PI / 2));
}

/** Unit smoothstep in [0, 1] (ease shared by the spawn/death ramps). */
function smoothstep01(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Spawn ease in [0, 1]: smoothstep 0→1 over SPAWN_EASE_MS (same window
 * as the blink), resting at 1 before/after. Non-finite readings rest
 * at 1. Pure: no DOM, no clock reads.
 */
export function spawnEaseAt(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) {
    return 1;
  }
  return smoothstep01(elapsedMs / SPAWN_EASE_MS);
}

/**
 * Death ease in [0, 1]: smoothstep 0→1 over DEATH_EASE_MS, resting at 1
 * before/after. Non-finite readings rest at 1. Pure: no DOM, no clock.
 */
export function deathEaseAt(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) {
    return 1;
  }
  return smoothstep01(elapsedMs / DEATH_EASE_MS);
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
      smoothedAim: null,
      airborne: false,
      framesSinceLand: null,
      spawnEaseStartMs: null,
      deathEaseStartMs: null,
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
      smoothedAim: null,
      airborne: false,
      framesSinceLand: null,
      spawnEaseStartMs: null,
      deathEaseStartMs: null,
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
      state.smoothedAim =
        typeof input.aim === "number" && Number.isFinite(input.aim)
          ? input.aim
          : 0;
      state.airborne = !input.onGround;
      state.framesSinceLand = null;
      state.spawnEaseStartMs = input.alive ? clock.nowMs : null;
      state.deathEaseStartMs = null;
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
      state.spawnEaseStartMs = clock.nowMs;
      state.deathEaseStartMs = null;
    }
    if (!input.alive && state.wasAlive) {
      state.deathEaseStartMs = clock.nowMs;
    }
    state.wasAlive = input.alive;
    // Landing edge: the airborne false->true onGround transition starts
    // the 4-frame squash dip; the counter ages one draw per update and
    // clears at LAND_SQUASH_FRAMES so the pose rests at exactly 1.0.
    if (state.airborne && input.onGround) {
      state.airborne = false;
      state.framesSinceLand = 0;
    } else {
      if (!input.onGround) {
        state.airborne = true;
      }
      if (state.framesSinceLand !== null) {
        state.framesSinceLand += 1;
        if (state.framesSinceLand >= LAND_SQUASH_FRAMES) {
          state.framesSinceLand = null;
        }
      }
    }
    // Continuous blends from already-available sim fields: gait from
    // |vx|, air from vy, and shortest-arc-capped aim smoothing.
    const vy =
      typeof input.vy === "number" && Number.isFinite(input.vy)
        ? input.vy
        : 0;
    const gaitBlend = gaitBlendFor(input.vx);
    const airBlend = airBlendFor(vy);
    const targetAim =
      typeof input.aim === "number" && Number.isFinite(input.aim)
        ? input.aim
        : (state.smoothedAim ?? 0);
    state.smoothedAim = smoothAimStep(
      state.smoothedAim ?? targetAim,
      targetAim,
      dtSec,
    );
    const landSquash = landingSquashAt(state.framesSinceLand);
    const spawnEase =
      !input.alive || state.spawnEaseStartMs === null
        ? 1
        : spawnEaseAt(clock.nowMs - state.spawnEaseStartMs);
    const deathEase =
      input.alive || state.deathEaseStartMs === null
        ? 1
        : deathEaseAt(clock.nowMs - state.deathEaseStartMs);
    const tuck = input.jetting && input.alive;
    const deadPose = !input.alive;
    const swing =
      tuck || deadPose
        ? 0
        : Math.sin(state.legPhase) * RUN_SWING_PX * gaitBlend;
    poses.push({
      legPhase: state.legPhase,
      swing,
      tuck,
      heightScale: heightScaleFor(input.crouching) * landSquash,
      hurtFlash: hurtFlashActive(clock.nowMs, state.lastHurtAtMs),
      spawnAlpha: spawnBlinkAlpha(clock.nowMs, state.spawnAtMs),
      deadPose,
      flame: input.alive && input.jetting,
      gaitBlend,
      airBlend,
      crouchWeight: airBlend,
      aimSmoothed: state.smoothedAim ?? targetAim,
      landSquash,
      spawnEase,
      deathEase,
    });
  }
  return poses;
}
