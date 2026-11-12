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

/** Action schema version (primary contract; mirrors SCHEMA_VERSION). */
export const ACTION_VERSION = "1.0";

/** moveX quantum mirrored from the core (1/64); guarded below. */
export const MOVE_X_STEP = 0.015625;

if (MOVE_X_STEP !== MOVE_X_QUANT) {
  throw new Error("scrapline-env: MOVE_X_STEP drifted from core MOVE_X_QUANT");
}

/** Aim delta applied per dim-1 step away from center, in radians. */
export const AIM_STEP = 0.12;

/**
 * Frozen MultiDiscrete action dims: moveX in {0,1,2}, aim delta in
 * {0..8}, then binary crouch/jet/fire/grenade/reload plus a swap slot
 * that is validated and ignored.
 */
export const ACTION_DIMS = Object.freeze([3, 9, 2, 2, 2, 2, 2, 2] as const);

/** Action vector length. */
export const ACTION_LENGTH = 8;

/**
 * Map an 8-int MultiDiscrete action into a WorldInput, carrying aim
 * forward: dim1 steps `(idx - 4) * AIM_STEP` accumulate onto `prevAim`
 * and dim0 `{0,1,2}` maps to `{-1,0,+1}`. Dims 2-6 set the crouch, jet,
 * fire, grenade, and reload booleans plus the matching button bits;
 * dim7 is the swap slot: validated as 0/1 and ignored. Every entry must
 * be an integer in `[0, ACTION_DIMS[i])`, else this throws.
 */
export function actionToInput(action: unknown, prevAim = 0): WorldInput {
  if (!Array.isArray(action) || action.length !== ACTION_LENGTH) {
    throw new Error(
      `scrapline-env: invalid action: expected an array of length ${ACTION_LENGTH}`,
    );
  }
  const idx: number[] = [];
  for (let i = 0; i < ACTION_LENGTH; i += 1) {
    const value = action[i];
    const size = ACTION_DIMS[i] as number;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= size
    ) {
      throw new Error(
        `scrapline-env: invalid action: entry ${i} must be an integer in [0, ${size})`,
      );
    }
    idx.push(value);
  }
  const base =
    typeof prevAim === "number" && Number.isFinite(prevAim) ? prevAim : 0;
  const moveX = quantizeMoveX((idx[0] as number) - 1);
  const aim = quantizeAim(base + ((idx[1] as number) - 4) * AIM_STEP);
  const crouch = (idx[2] as number) === 1;
  const jet = (idx[3] as number) === 1;
  const fire = (idx[4] as number) === 1;
  const grenade = (idx[5] as number) === 1;
  const reload = (idx[6] as number) === 1;
  let buttons = 0;
  if (crouch) {
    buttons |= BUTTON_CROUCH;
  }
  if (jet) {
    buttons |= BUTTON_JET;
  }
  if (fire) {
    buttons |= BUTTON_FIRE;
  }
  if (grenade) {
    buttons |= BUTTON_GRENADE;
  }
  if (reload) {
    buttons |= BUTTON_RELOAD;
  }
  return { moveX, aim, buttons, crouch, jet, fire, grenade, reload };
}

/**
 * Deprecated alias of actionToInput; kept so older callers keep compiling.
 */
export function decodeAction(action: unknown, prevAim = 0): WorldInput {
  return actionToInput(action, prevAim);
}
