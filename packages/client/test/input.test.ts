// Input mapping tests: quantization to the deterministic core intent plus
// keyboard/mouse state helpers. Mirrors packages/core/test helper style
// (small local builders, behavior assertions, no padding).
import { describe, expect, it } from "vitest";
import {
  BUTTON_CROUCH,
  BUTTON_FIRE,
  BUTTON_GRENADE,
  BUTTON_JET,
  BUTTON_RELOAD,
  quantizeAim,
} from "../../core/src/world";
import {
  MOVE_X_STEP,
  applyKeyEvent,
  applyMouseButton,
  applyMouseMove,
  createKeyState,
  stateAim,
  stateButtons,
  stateMoveX,
  toInput,
} from "../src/input";

describe("toInput moveX quantization", () => {
  it("exposes the 1/64 step literal", () => {
    expect(MOVE_X_STEP).toBe(0.015625);
  });

  it("snaps arbitrary analog input to multiples of 0.015625", () => {
    const quantized = toInput({ moveX: 0.33, aim: 0, buttons: 0 });
    expect(typeof quantized.moveX).toBe("number");
    expect(Number.isInteger((quantized.moveX as number) * 64)).toBe(true);
  });

  it("passes clean fractions through and clamps the range", () => {
    expect(toInput({ moveX: 0.5 }).moveX).toBe(0.5);
    expect(toInput({ moveX: 1 }).moveX).toBe(1);
    expect(toInput({ moveX: -1 }).moveX).toBe(-1);
    expect(toInput({ moveX: 2 }).moveX).toBe(1);
    expect(toInput({ moveX: -2 }).moveX).toBe(-1);
  });
});

describe("toInput aim quantization", () => {
  it("snaps angles to 4096 steps around the circle", () => {
    const twoPi = Math.PI * 2;
    for (const angle of [0, 1, -1, 10, Math.PI * 3.7, -Math.PI * 9.25]) {
      const aim = toInput({ aim: angle }).aim as number;
      const steps = (aim / twoPi) * 4096;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
      expect(aim).toBe(quantizeAim(angle));
    }
  });
});

describe("key/mouse helpers", () => {
  it("maps ArrowRight press and release to moveX 1 then 0", () => {
    const state = createKeyState();
    applyKeyEvent(state, "ArrowRight", true);
    expect(toInput({ moveX: stateMoveX(state) }).moveX).toBe(1);
    applyKeyEvent(state, "ArrowRight", false);
    expect(toInput({ moveX: stateMoveX(state) }).moveX).toBe(0);
  });

  it("accepts bare key spellings when code is empty", () => {
    const state = createKeyState();
    applyKeyEvent(state, "d", true);
    expect(toInput({ moveX: stateMoveX(state) }).moveX).toBe(1);
    applyKeyEvent(state, " ", true);
    expect(stateButtons(state) & BUTTON_JET).toBe(BUTTON_JET);
  });

  it("combines left and right into a signed intent", () => {
    const state = createKeyState();
    applyKeyEvent(state, "KeyA", true);
    expect(stateMoveX(state)).toBe(-1);
    applyKeyEvent(state, "KeyD", true);
    expect(stateMoveX(state)).toBe(0);
  });

  it("maps keys and mouse buttons to the core button bits", () => {
    expect(BUTTON_JET).toBe(1);
    expect(BUTTON_CROUCH).toBe(2);
    expect(BUTTON_FIRE).toBe(4);
    expect(BUTTON_GRENADE).toBe(8);
    expect(BUTTON_RELOAD).toBe(32);
    const state = createKeyState();
    expect(stateButtons(state)).toBe(0);
    applyKeyEvent(state, "Space", true);
    expect(stateButtons(state) & BUTTON_JET).toBe(BUTTON_JET);
    applyKeyEvent(state, "ArrowDown", true);
    expect(stateButtons(state) & BUTTON_CROUCH).toBe(BUTTON_CROUCH);
    applyMouseButton(state, 0, true);
    expect(stateButtons(state) & BUTTON_FIRE).toBe(BUTTON_FIRE);
    applyMouseButton(state, 2, true);
    expect(stateButtons(state) & BUTTON_GRENADE).toBe(BUTTON_GRENADE);
    applyKeyEvent(state, "KeyR", true);
    expect(stateButtons(state) & BUTTON_RELOAD).toBe(BUTTON_RELOAD);
    applyMouseButton(state, 0, false);
    expect(stateButtons(state) & BUTTON_FIRE).toBe(0);
  });

  it("aim stays neutral until the mouse moves, then follows it", () => {
    const state = createKeyState();
    expect(stateAim(state, 320, 180)).toBe(0);
    applyMouseMove(state, 320, 100, { left: 0, top: 0, width: 640, height: 360 });
    const aim = toInput({ aim: stateAim(state, 320, 180) }).aim as number;
    expect(aim).not.toBe(0);
  });
});
