// Browser input mapping: keyboard/mouse state quantized to the exact
// deterministic core intent. The sim is sacred: this module reuses the
// core quantizers and button bits (never redefines constants or angles)
// so the browser drives the identical 60 Hz core with no sim divergence.

import {
  BUTTON_CROUCH,
  BUTTON_FIRE,
  BUTTON_GRENADE,
  BUTTON_JET,
  BUTTON_RELOAD,
  MOVE_X_QUANT,
  quantizeAim,
  quantizeMoveX,
} from "../../core/src/world";

/** moveX quantum mirrored from the core (1/64); guarded below. */
export const MOVE_X_STEP = 0.015625;

if (MOVE_X_STEP !== MOVE_X_QUANT) {
  throw new Error("scrapline: MOVE_X_STEP drifted from core MOVE_X_QUANT");
}

/** Live keyboard/mouse state; plain data, no DOM touched at import time. */
export interface KeyState {
  left: boolean;
  right: boolean;
  jet: boolean;
  crouch: boolean;
  grenadeKey: boolean;
  reload: boolean;
  fireMouse: boolean;
  grenadeMouse: boolean;
  /** Mouse x in canvas CSS pixels (clientX - rect.left). */
  mouseX: number;
  /** Mouse y in canvas CSS pixels (clientY - rect.top). */
  mouseY: number;
  /** True once a mousemove has been observed. */
  hasMouse: boolean;
}

/** Fresh neutral keyboard/mouse state. */
export function createKeyState(): KeyState {
  return {
    left: false,
    right: false,
    jet: false,
    crouch: false,
    grenadeKey: false,
    reload: false,
    fireMouse: false,
    grenadeMouse: false,
    mouseX: 0,
    mouseY: 0,
    hasMouse: false,
  };
}

/**
 * Feed a key event into the state. ArrowRight/KeyD drive right,
 * ArrowLeft/KeyA drive left, ArrowUp/KeyW/Space jet, ArrowDown/KeyS
 * crouch, KeyG grenade, KeyR reload. Single-char `key` spellings are
 * accepted too, so synthetic events carrying only `key` (empty `code`)
 * map the same way.
 */
export function applyKeyEvent(state: KeyState, code: string, down: boolean): void {
  switch (code) {
    case "ArrowLeft":
    case "KeyA":
    case "a":
    case "A":
      state.left = down;
      break;
    case "ArrowRight":
    case "KeyD":
    case "d":
    case "D":
      state.right = down;
      break;
    case "ArrowUp":
    case "KeyW":
    case "w":
    case "W":
    case "Space":
    case " ":
      state.jet = down;
      break;
    case "ArrowDown":
    case "KeyS":
    case "s":
    case "S":
      state.crouch = down;
      break;
    case "KeyG":
    case "g":
    case "G":
      state.grenadeKey = down;
      break;
    case "KeyR":
    case "r":
    case "R":
      state.reload = down;
      break;
    default:
      break;
  }
}

/** Bounding-box shape accepted by applyMouseMove (DOMRect compatible). */
export interface MouseRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Store the mouse position in canvas CSS pixels. */
export function applyMouseMove(
  state: KeyState,
  clientX: number,
  clientY: number,
  rect: MouseRect,
): void {
  state.mouseX = clientX - rect.left;
  state.mouseY = clientY - rect.top;
  state.hasMouse = true;
}

/** Feed a mouse button event into the state (0 = fire, 2 = grenade). */
export function applyMouseButton(state: KeyState, button: number, down: boolean): void {
  if (button === 0) {
    state.fireMouse = down;
  } else if (button === 2) {
    state.grenadeMouse = down;
  }
}

/** Unquantized lateral intent from the held keys: right minus left. */
export function stateMoveX(state: KeyState): number {
  return (state.right ? 1 : 0) - (state.left ? 1 : 0);
}

/** Button bitmask assembled from the held keys and mouse buttons. */
export function stateButtons(state: KeyState): number {
  let buttons = 0;
  if (state.jet) {
    buttons |= BUTTON_JET;
  }
  if (state.crouch) {
    buttons |= BUTTON_CROUCH;
  }
  if (state.fireMouse) {
    buttons |= BUTTON_FIRE;
  }
  if (state.grenadeKey || state.grenadeMouse) {
    buttons |= BUTTON_GRENADE;
  }
  if (state.reload) {
    buttons |= BUTTON_RELOAD;
  }
  return buttons;
}

/**
 * Aim angle from an origin (canvas CSS pixels) toward the stored mouse
 * point. Neutral 0 until the first mousemove.
 */
export function stateAim(state: KeyState, originX: number, originY: number): number {
  if (!state.hasMouse) {
    return 0;
  }
  return Math.atan2(state.mouseY - originY, state.mouseX - originX);
}

/** Quantized per-tick intent, mirrored to window.__scraplineInput. */
export interface InputMirror {
  moveX: number;
  aim: number;
  buttons: number;
}

/**
 * Quantize a raw intent to the deterministic core input: moveX snaps to
 * multiples of 0.015625 (1/64), aim snaps to 4096 steps around the circle.
 */
export function toInput(raw: {
  moveX?: number;
  aim?: number;
  buttons?: number;
}): InputMirror {
  return {
    moveX: quantizeMoveX(raw.moveX ?? 0),
    aim: quantizeAim(raw.aim ?? 0),
    buttons: raw.buttons ?? 0,
  };
}
