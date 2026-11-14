// Gamepad support: standard-mapping Gamepad API polling merged into the
// existing keyboard/mouse input mirror (keyboard stays primary). Pure,
// DOM-free helpers so the mapping stays unit-testable under node; the
// browser only supplies `navigator.getGamepads()` snapshots. The sim is
// sacred: this module reuses the core button bits and the moveX
// quantizer (never redefines them) so a stick drives the identical
// 60 Hz core with no sim divergence.

import {
  BUTTON_FIRE,
  BUTTON_GRENADE,
  BUTTON_JET,
  BUTTON_RELOAD,
  quantizeMoveX,
} from "../../core/src/world";
import { stateButtons, stateMoveX, type KeyState } from "./input";

/** Standard-mapping A/cross button: hop-jet. */
export const GAMEPAD_BUTTON_JET = 0;
/** Standard-mapping X/square button: reload. */
export const GAMEPAD_BUTTON_RELOAD = 2;
/** Standard-mapping left-trigger button: grenade. */
export const GAMEPAD_BUTTON_GRENADE_LT = 6;
/** Standard-mapping right-trigger button: fire. */
export const GAMEPAD_BUTTON_FIRE_RT = 7;
/** Standard-mapping D-pad up index. */
export const GAMEPAD_DPAD_UP = 12;
/** Standard-mapping D-pad down index. */
export const GAMEPAD_DPAD_DOWN = 13;
/** Standard-mapping D-pad left index: weapon-swap edge (exposed only). */
export const GAMEPAD_DPAD_LEFT = 14;
/** Standard-mapping D-pad right index: weapon-swap edge (exposed only). */
export const GAMEPAD_DPAD_RIGHT = 15;
/** Left-stick deadzone: smaller deflections read as centered. */
export const GAMEPAD_DEADZONE = 0.2;
/** Analog trigger threshold: `value` above this reads as pressed. */
export const GAMEPAD_TRIGGER_THRESHOLD = 0.3;
/** D-pad swap-edge debounce window in ms. */
export const GAMEPAD_SWAP_DEBOUNCE_MS = 400;

/** Structural button reading (mirrors the DOM GamepadButton shape). */
export interface GamepadButtonLike {
  pressed: boolean;
  value: number;
}

/**
 * Structural pad snapshot (mirrors the DOM Gamepad shape without
 * importing it, so tests run under node and late-installed virtual-pad
 * mocks are accepted as long as they quack the same way).
 */
export interface GamepadLike {
  connected: boolean;
  axes: readonly unknown[] | null | undefined;
  buttons: readonly unknown[] | null | undefined;
}

/** Per-frame decoded pad intent; plain data, no DOM touched. */
export interface GamepadState {
  /** True when a pad snapshot was present and marked connected. */
  connected: boolean;
  /** Quantized lateral intent from the left stick (deadzone applied). */
  moveX: number;
  /** A/cross held. */
  jet: boolean;
  /** Right trigger beyond the analog threshold. */
  fire: boolean;
  /** Left trigger beyond the analog threshold. */
  grenade: boolean;
  /** X/square held. */
  reload: boolean;
  /** Raw D-pad left/right level (the debounced edge lives in the tracker). */
  swapPressed: boolean;
  /** D-pad up held. */
  dpadUp: boolean;
  /** D-pad down held. */
  dpadDown: boolean;
  /** D-pad left held. */
  dpadLeft: boolean;
  /** D-pad right held. */
  dpadRight: boolean;
}

/** Fresh neutral (disconnected) pad state. */
export function createGamepadState(): GamepadState {
  return {
    connected: false,
    moveX: 0,
    jet: false,
    fire: false,
    grenade: false,
    reload: false,
    swapPressed: false,
    dpadUp: false,
    dpadDown: false,
    dpadLeft: false,
    dpadRight: false,
  };
}

/** Read one button slot: `pressed` or an analog value over threshold. */
function buttonHeld(buttons: readonly unknown[] | null | undefined, index: number): boolean {
  if (buttons === null || buttons === undefined) {
    return false;
  }
  const slot = buttons[index] as
    | { pressed?: unknown; value?: unknown }
    | null
    | undefined;
  if (slot === null || slot === undefined || typeof slot !== "object") {
    return false;
  }
  if (slot.pressed === true) {
    return true;
  }
  return typeof slot.value === "number" && slot.value > GAMEPAD_TRIGGER_THRESHOLD;
}

/** Read one axis slot as a finite number, defaulting to centered. */
function axisValue(axes: readonly unknown[] | null | undefined, index: number): number {
  if (axes === null || axes === undefined) {
    return 0;
  }
  const raw = axes[index];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * Decode a pad snapshot: left-stick X through the deadzone (rescaled to
 * full range, then quantized via the core) plus the standard button
 * mapping (A jet, RT fire, LT grenade, X reload, D-pad levels). Null,
 * undefined, or disconnected snapshots decode to neutral.
 */
export function readGamepad(pad: GamepadLike | null | undefined): GamepadState {
  const state = createGamepadState();
  if (pad === null || pad === undefined || pad.connected !== true) {
    return state;
  }
  state.connected = true;
  const raw = axisValue(pad.axes, 0);
  const magnitude = Math.abs(raw);
  if (magnitude > GAMEPAD_DEADZONE) {
    const sign = raw > 0 ? 1 : -1;
    const rescaled = ((magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE)) * sign;
    state.moveX = quantizeMoveX(rescaled);
  }
  state.jet = buttonHeld(pad.buttons, GAMEPAD_BUTTON_JET);
  state.fire = buttonHeld(pad.buttons, GAMEPAD_BUTTON_FIRE_RT);
  state.grenade = buttonHeld(pad.buttons, GAMEPAD_BUTTON_GRENADE_LT);
  state.reload = buttonHeld(pad.buttons, GAMEPAD_BUTTON_RELOAD);
  state.dpadUp = buttonHeld(pad.buttons, GAMEPAD_DPAD_UP);
  state.dpadDown = buttonHeld(pad.buttons, GAMEPAD_DPAD_DOWN);
  state.dpadLeft = buttonHeld(pad.buttons, GAMEPAD_DPAD_LEFT);
  state.dpadRight = buttonHeld(pad.buttons, GAMEPAD_DPAD_RIGHT);
  state.swapPressed = state.dpadLeft || state.dpadRight;
  return state;
}

/**
 * Merge pad intent under the live keyboard state: keyboard wins lateral
 * movement (any held key overrides the stick), button bits are OR-ed so
 * either surface fires, jets, lobs, or reloads.
 */
export function mergeGamepad(
  keys: KeyState,
  pad: GamepadState,
): { moveX: number; buttons: number } {
  const keyMove = stateMoveX(keys);
  const moveX = keyMove !== 0 ? keyMove : pad.moveX;
  let buttons = stateButtons(keys);
  if (pad.jet) {
    buttons |= BUTTON_JET;
  }
  if (pad.fire) {
    buttons |= BUTTON_FIRE;
  }
  if (pad.grenade) {
    buttons |= BUTTON_GRENADE;
  }
  if (pad.reload) {
    buttons |= BUTTON_RELOAD;
  }
  return { moveX, buttons };
}

/** Edge-tracker memory: connect latch plus the swap debounce arm. */
export interface GamepadTracker {
  /** Last frame's connected reading (drives the disconnected→edge). */
  wasConnected: boolean;
  /** True once the D-pad level has released and a new edge may fire. */
  swapArmed: boolean;
  /** Timestamp ms of the last accepted swap edge (debounce anchor). */
  lastSwapMs: number;
}

/** Fresh tracker: disconnected, swap armed, debounce window elapsed. */
export function createGamepadTracker(): GamepadTracker {
  return {
    wasConnected: false,
    swapArmed: true,
    lastSwapMs: -GAMEPAD_SWAP_DEBOUNCE_MS,
  };
}

/**
 * Connect-edge detector: true only on the disconnected→connected
 * transition (re-arms on disconnect), so the toast fires once per
 * plug-in no matter how many frames the pad stays connected.
 */
export function trackConnected(tracker: GamepadTracker, connected: boolean): boolean {
  const edge = connected && !tracker.wasConnected;
  tracker.wasConnected = connected;
  return edge;
}

/**
 * Swap-edge detector: true on the D-pad left/right rising level while
 * the debounce window since the last accepted edge has elapsed; the
 * level release re-arms it. Exposed for the future inventory slice —
 * the single-slot core performs no sim mutation on this edge.
 */
export function trackSwap(
  tracker: GamepadTracker,
  swapPressed: boolean,
  nowMs: number,
): boolean {
  if (!swapPressed) {
    tracker.swapArmed = true;
    return false;
  }
  if (!tracker.swapArmed) {
    return false;
  }
  if (nowMs - tracker.lastSwapMs < GAMEPAD_SWAP_DEBOUNCE_MS) {
    return false;
  }
  tracker.swapArmed = false;
  tracker.lastSwapMs = nowMs;
  return true;
}
