// Headless action mapping: MultiDiscrete [3,9,2,2,2,2,2,2] to WorldInput.
//
// This module is a thin shell over the core sim: it reuses the core
// quantizers and button bits (never redefines constants or angles) so
// the RL gateway drives the identical 60 Hz core with no divergence.

import {
  BUTTON_CROUCH,
  BUTTON_FIRE,
  BUTTON_GRENADE,
  BUTTON_JET,
  BUTTON_RELOAD,
  MOVE_X_QUANT,
  quantizeAim,
  quantizeMoveX,
  type WorldInput,
} from "../../core/src/world";

/** moveX quantum mirrored from the core (1/64); guarded below. */
export const MOVE_X_STEP = 0.015625;

if (MOVE_X_STEP !== MOVE_X_QUANT) {
  throw new Error("scrapline-env: MOVE_X_STEP drifted from core MOVE_X_QUANT");
}

/** Aim delta applied per dim-1 step away from center, in radians. */
export const AIM_STEP = 0.12;

/**
 * Frozen MultiDiscrete action dims: moveX in {0,1,2}, aim delta in
 * {0..8}, then binary jet/crouch/fire/grenade/reload plus a swap slot
 * that is accepted and ignored.
 */
export const ACTION_DIMS = Object.freeze([3, 9, 2, 2, 2, 2, 2, 2] as const);

/** Action vector length. */
export const ACTION_LENGTH = 8;

/** Clamp an unknown value to a valid index in [0, size). */
function clampIndex(value: unknown, size: number): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  if (n < 0) {
    return 0;
  }
  if (n > size - 1) {
    return size - 1;
  }
  return n;
}

/**
 * Decode an 8-int MultiDiscrete action into a WorldInput, carrying aim
 * forward: dim1 steps `(idx - 4) * AIM_STEP` accumulate onto `prevAim`
 * and dim0 `{0,1,2}` maps to `{-1,0,+1}`. Dims 2-6 set the matching
 * button bits; dim7 is the swap slot and stays a no-op. Out-of-range
 * entries clamp, missing entries read 0, and nothing throws.
 */
export function decodeAction(action: unknown, prevAim = 0): WorldInput {
  const list = Array.isArray(action) ? action : [];
  const moveIdx = clampIndex(list[0], 3);
  const aimIdx = clampIndex(list[1], 9);
  const base =
    typeof prevAim === "number" && Number.isFinite(prevAim) ? prevAim : 0;
  const moveX = quantizeMoveX(moveIdx - 1);
  const aim = quantizeAim(base + (aimIdx - 4) * AIM_STEP);
  let buttons = 0;
  if (clampIndex(list[2], 2) === 1) {
    buttons |= BUTTON_JET;
  }
  if (clampIndex(list[3], 2) === 1) {
    buttons |= BUTTON_CROUCH;
  }
  if (clampIndex(list[4], 2) === 1) {
    buttons |= BUTTON_FIRE;
  }
  if (clampIndex(list[5], 2) === 1) {
    buttons |= BUTTON_GRENADE;
  }
  if (clampIndex(list[6], 2) === 1) {
    buttons |= BUTTON_RELOAD;
  }
  return { moveX, aim, buttons };
}
