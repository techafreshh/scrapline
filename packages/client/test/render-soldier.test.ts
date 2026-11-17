// Soldier sprite swap (issue #263): platformer-characters textures,
// roster tints, arm aim, and the debugFrame probe hook. DOM-free.
import { describe, expect, it } from "vitest";
import {
  SOLDIER_ARM_ANCHOR,
  SOLDIER_PACK,
  SOLDIER_RUN_KEYS,
  activeSoldierTexture,
  clearDebugSoldierFrame,
  debugSoldierFrame,
  debugTextureOverride,
  hslToRgb,
  rgbToHsl,
  soldierRunKey,
  soldierSpriteFile,
  soldierSpriteKey,
  soldierTintCss,
  soldierTintHex,
  soldierTintHue,
  soldierWeaponLength,
  tintSoldierPixel,
} from "../src/render/soldier";
import {
  soldierTextureFor,
  soldierRunTexture,
  SOLDIER_PACK as VIEW_PACK,
} from "../src/view/soldier";
import { ARM_PIVOT } from "../src/view/character";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("platformer-characters pack wiring", () => {
  it("names the platformer-characters pack in both soldier modules", () => {
    expect(SOLDIER_PACK).toBe("platformer-characters");
    expect(VIEW_PACK).toBe("platformer-characters");
    const renderFile = readFileSync(
      join(__dirname, "..", "src", "render", "soldier.ts"),
      "utf8",
    );
    expect(renderFile).toContain("platformer-characters");
    const viewFile = readFileSync(
      join(__dirname, "..", "src", "view", "soldier.ts"),
      "utf8",
    );
    expect(viewFile).toContain("platformer-characters");
  });

  it("exposes a 4+ frame run cycle through the atlas manifest", () => {
    expect(SOLDIER_RUN_KEYS).toHaveLength(4);
    for (const key of SOLDIER_RUN_KEYS) {
      expect(key.startsWith("soldier.run")).toBe(true);
      expect(soldierSpriteFile(key)).not.toBeNull();
    }
    const seen = new Set(
      [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((phase) =>
        soldierRunKey(phase),
      ),
    );
    expect(seen.size).toBe(4);
  });

  it("resolves idle, jet, crouch, hurt, and death textures", () => {
    expect(soldierSpriteKey({})).toBe("soldier.idle");
    expect(soldierSpriteKey({ tuck: true })).toBe("soldier.jet");
    expect(soldierSpriteKey({ crouching: true })).toBe("soldier.crouch");
    expect(soldierSpriteKey({ heightScale: 0.7 })).toBe("soldier.crouch");
    expect(soldierSpriteKey({ deadPose: true })).toBe("soldier.dead");
    expect(soldierSpriteKey({ hurtFlash: true })).toBe("soldier.fall");
    expect(soldierSpriteKey({ swing: 4, legPhase: 0 })).toContain(
      "soldier.run",
    );
    expect(soldierTextureFor({ swing: 4, legPhase: Math.PI })).toContain(
      "soldier.run",
    );
    expect(soldierRunTexture(0)).toContain("soldier.run");
  });

  it("keeps the arm anchor on the preserved pivot", () => {
    expect(SOLDIER_ARM_ANCHOR).toEqual(ARM_PIVOT);
    expect(SOLDIER_ARM_ANCHOR).toEqual({ x: 13, y: 29 });
  });
});

describe("roster tints", () => {
  it("maps local to cyan and enemies to warm tones", () => {
    expect(soldierTintCss(0)).toBe("#00E5FF");
    expect(soldierTintCss(1)).toBe("#FF6B35");
    expect(soldierTintCss(2)).toBe("#FFB347");
    expect(soldierTintHex(0)).toBe(0x00e5ff);
    expect(soldierTintHex(1)).toBe(0xff6b35);
    expect(soldierTintHex(2)).toBe(0xffb347);
  });

  it("targets cyan hues for local and warm hues for enemies", () => {
    const local = soldierTintHue(0);
    expect(local).toBeGreaterThanOrEqual(170);
    expect(local).toBeLessThanOrEqual(200);
    for (const index of [1, 2, 3, 4]) {
      const hue = soldierTintHue(index);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(50);
    }
  });

  it("keeps outlines dark while shifting midtones to the roster hue", () => {
    const [r, g, b] = hslToRgb(soldierTintHue(0), 0.8, 0.5);
    expect(rgbToHsl(r, g, b).h).toBeGreaterThanOrEqual(170);
    expect(rgbToHsl(r, g, b).h).toBeLessThanOrEqual(200);
    // Near-black outline pixels pass through untouched.
    expect(tintSoldierPixel(20, 20, 20, 255, 187)).toEqual([20, 20, 20, 255]);
    expect(tintSoldierPixel(0, 0, 0, 255, 16)).toEqual([0, 0, 0, 255]);
    // Opaque tan midtone shifts into the roster hue band.
    const [tr, tg, tb] = tintSoldierPixel(149, 117, 68, 255, 187);
    const hue = rgbToHsl(tr, tg, tb).h;
    expect(hue).toBeGreaterThanOrEqual(170);
    expect(hue).toBeLessThanOrEqual(200);
    const [er, eg, eb] = tintSoldierPixel(149, 117, 68, 255, 16);
    const enemyHue = rgbToHsl(er, eg, eb).h;
    expect(enemyHue).toBeGreaterThanOrEqual(0);
    expect(enemyHue).toBeLessThanOrEqual(50);
  });
});

describe("arm aim and muzzle coincidence", () => {
  it("keeps every weapon muzzle inside the 10-60px probe band", () => {
    const weapons = ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket"] as const;
    for (const weapon of weapons) {
      const length = soldierWeaponLength(weapon);
      expect(length).toBeGreaterThan(10);
      expect(length).toBeLessThan(60);
    }
  });

  it("forces the debug texture to a soldier.run key", () => {
    clearDebugSoldierFrame();
    expect(debugTextureOverride()).toBeNull();
    const forced = debugSoldierFrame("soldier.run.3", "soldier.idle");
    expect(forced).toContain("soldier.run");
    expect(debugTextureOverride()).toContain("soldier.run");
    expect(activeSoldierTexture("soldier.idle")).toContain("soldier.run");
    clearDebugSoldierFrame();
    expect(activeSoldierTexture("soldier.idle")).toBe("soldier.idle");
  });
});
