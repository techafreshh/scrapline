// Gamepad support tests: standard-mapping decode, deadzone, the
// keyboard-primary merge, and the connect/swap edge detectors.
// Mirrors the input.test.ts style (small local builders, behavior
// assertions, no padding).
import { describe, expect, it } from "vitest";
import {
  BUTTON_FIRE,
  BUTTON_GRENADE,
  BUTTON_JET,
  BUTTON_RELOAD,
} from "../../core/src/world";
import { applyKeyEvent, createKeyState } from "../src/input";
import {
  createGamepadTracker,
  GAMEPAD_SWAP_DEBOUNCE_MS,
  mergeGamepad,
  readGamepad,
  trackConnected,
  trackSwap,
  type GamepadLike,
} from "../src/gamepad";

/** One structural button reading. */
function btn(pressed: boolean, value?: number): { pressed: boolean; value: number } {
  return { pressed, value: value ?? (pressed ? 1 : 0) };
}

/** Neutral 17-slot standard-mapping button table. */
function neutralButtons(): Array<{ pressed: boolean; value: number }> {
  return Array.from({ length: 17 }, () => btn(false));
}

/** Connected pad snapshot with overridable axes/buttons. */
function makePad(
  axes: number[] = [0, 0],
  buttons: Array<{ pressed: boolean; value: number }> = neutralButtons(),
  connected = true,
): GamepadLike {
  return { connected, axes, buttons };
}

describe("readGamepad stick mapping", () => {
  it("maps a full-right left stick to moveX 1", () => {
    expect(readGamepad(makePad([1, 0])).moveX).toBe(1);
  });

  it("maps a full-left left stick to moveX -1", () => {
    expect(readGamepad(makePad([-1, 0])).moveX).toBe(-1);
  });

  it("reads a centered stick inside the deadzone as 0", () => {
    expect(readGamepad(makePad([0, 0])).connected).toBe(true);
    expect(readGamepad(makePad([0, 0])).moveX).toBe(0);
    expect(readGamepad(makePad([0.1, 0])).moveX).toBe(0);
    expect(readGamepad(makePad([-0.15, 0])).moveX).toBe(0);
  });

  it("treats the deadzone boundary itself as centered", () => {
    expect(readGamepad(makePad([0.2, 0])).moveX).toBe(0);
    expect(readGamepad(makePad([-0.2, 0])).moveX).toBe(0);
  });

  it("rescales past the deadzone back to full range", () => {
    // (0.6 - 0.2) / 0.8 lands exactly on the 0.5 quantum.
    expect(readGamepad(makePad([0.6, 0])).moveX).toBe(0.5);
  });

  it("decodes null or disconnected snapshots to neutral", () => {
    for (const pad of [null, undefined, makePad([1, 0], neutralButtons(), false)]) {
      const state = readGamepad(pad);
      expect(state.connected).toBe(false);
      expect(state.moveX).toBe(0);
      expect(state.jet).toBe(false);
      expect(state.fire).toBe(false);
    }
  });
});

describe("readGamepad button mapping", () => {
  it("maps A/cross to jet", () => {
    const buttons = neutralButtons();
    buttons[0] = btn(true);
    const merged = mergeGamepad(createKeyState(), readGamepad(makePad([0, 0], buttons)));
    expect(merged.buttons & BUTTON_JET).toBe(BUTTON_JET);
  });

  it("maps an analog RT pull over threshold to fire without pressed", () => {
    const buttons = neutralButtons();
    buttons[7] = btn(false, 0.5);
    expect(readGamepad(makePad([0, 0], buttons)).fire).toBe(true);
    const merged = mergeGamepad(createKeyState(), readGamepad(makePad([0, 0], buttons)));
    expect(merged.buttons & BUTTON_FIRE).toBe(BUTTON_FIRE);
  });

  it("ignores sub-threshold analog trigger values", () => {
    const buttons = neutralButtons();
    buttons[7] = btn(false, 0.2);
    buttons[6] = btn(false, 0.1);
    const state = readGamepad(makePad([0, 0], buttons));
    expect(state.fire).toBe(false);
    expect(state.grenade).toBe(false);
  });

  it("maps LT to grenade and X to reload", () => {
    const buttons = neutralButtons();
    buttons[6] = btn(true);
    buttons[2] = btn(true);
    const merged = mergeGamepad(createKeyState(), readGamepad(makePad([0, 0], buttons)));
    expect(merged.buttons & BUTTON_GRENADE).toBe(BUTTON_GRENADE);
    expect(merged.buttons & BUTTON_RELOAD).toBe(BUTTON_RELOAD);
  });

  it("exposes the D-pad left/right swap level without sim bits", () => {
    const buttons = neutralButtons();
    buttons[14] = btn(true);
    const state = readGamepad(makePad([0, 0], buttons));
    expect(state.swapPressed).toBe(true);
    const merged = mergeGamepad(createKeyState(), state);
    expect(merged.moveX).toBe(0);
    expect(merged.buttons).toBe(0);
  });
});

describe("mergeGamepad keyboard priority", () => {
  it("lets a held ArrowRight win over a connected centered pad", () => {
    const keys = createKeyState();
    applyKeyEvent(keys, "ArrowRight", true);
    const merged = mergeGamepad(keys, readGamepad(makePad()));
    expect(merged.moveX).toBe(1);
  });

  it("keeps keyboard right winning while the stick pulls left", () => {
    const keys = createKeyState();
    applyKeyEvent(keys, "ArrowRight", true);
    const merged = mergeGamepad(keys, readGamepad(makePad([-1, 0])));
    expect(merged.moveX).toBe(1);
  });

  it("yields move 1 when keyboard and stick agree right", () => {
    const keys = createKeyState();
    applyKeyEvent(keys, "KeyD", true);
    const merged = mergeGamepad(keys, readGamepad(makePad([1, 0])));
    expect(merged.moveX).toBe(1);
  });

  it("drives movement from the stick alone when no key is held", () => {
    const merged = mergeGamepad(createKeyState(), readGamepad(makePad([1, 0])));
    expect(merged.moveX).toBe(1);
  });
});

describe("trackConnected", () => {
  it("fires once per plug-in and re-arms on disconnect", () => {
    const tracker = createGamepadTracker();
    expect(trackConnected(tracker, false)).toBe(false);
    expect(trackConnected(tracker, true)).toBe(true);
    expect(trackConnected(tracker, true)).toBe(false);
    expect(trackConnected(tracker, true)).toBe(false);
    expect(trackConnected(tracker, false)).toBe(false);
    expect(trackConnected(tracker, true)).toBe(true);
  });
});

describe("trackSwap", () => {
  it("debounces the D-pad left/right edge until release plus window", () => {
    const tracker = createGamepadTracker();
    expect(trackSwap(tracker, false, 0)).toBe(false);
    expect(trackSwap(tracker, true, 0)).toBe(true);
    expect(trackSwap(tracker, true, 50)).toBe(false);
    expect(trackSwap(tracker, false, 100)).toBe(false);
    expect(trackSwap(tracker, true, 100)).toBe(false);
    expect(trackSwap(tracker, false, 150)).toBe(false);
    expect(
      trackSwap(tracker, true, GAMEPAD_SWAP_DEBOUNCE_MS + 150),
    ).toBe(true);
  });
});
