// Per-theme palette contract: neutral kilima, warm dune, cool frostbite,
// highlight luminance lift >=15, and 60% backwall brightness.
import { describe, expect, it } from "vitest";
import {
  THEMES,
  getCurrentTheme,
  hexToRgb,
  isThemeName,
  luminanceOfHex,
  setCurrentTheme,
  themeFor,
} from "../src/view/theme";

describe("tile themes", () => {
  it("ships kilima, dune, and frostbite palettes", () => {
    expect(Object.keys(THEMES).sort()).toEqual(["dune", "frostbite", "kilima"]);
    expect(THEMES.kilima.name).toBe("kilima");
    expect(THEMES.dune.name).toBe("dune");
    expect(THEMES.frostbite.name).toBe("frostbite");
  });

  it("shifts warm on dune (r-b>5) and cool on frostbite (b-r>10)", () => {
    const dune = hexToRgb(THEMES.dune.baseHex);
    expect(dune.r - dune.b).toBeGreaterThan(5);
    const frost = hexToRgb(THEMES.frostbite.baseHex);
    expect(frost.b - frost.r).toBeGreaterThan(10);
  });

  it("lifts the top highlight by >=15 luminance on every theme", () => {
    for (const theme of Object.values(THEMES)) {
      const lift = luminanceOfHex(theme.highlightHex) - luminanceOfHex(theme.baseHex);
      expect(lift).toBeGreaterThanOrEqual(15);
    }
  });

  it("renders backwalls at 60% brightness", () => {
    for (const theme of Object.values(THEMES)) {
      const base = hexToRgb(theme.baseHex);
      const back = hexToRgb(theme.backwallHex);
      expect(back.r).toBeGreaterThanOrEqual(Math.round(base.r * 0.6) - 2);
      expect(back.r).toBeLessThanOrEqual(Math.round(base.r * 0.6) + 2);
      expect(back.g).toBeGreaterThanOrEqual(Math.round(base.g * 0.6) - 2);
      expect(back.g).toBeLessThanOrEqual(Math.round(base.g * 0.6) + 2);
      expect(back.b).toBeGreaterThanOrEqual(Math.round(base.b * 0.6) - 2);
      expect(back.b).toBeLessThanOrEqual(Math.round(base.b * 0.6) + 2);
    }
  });

  it("resolves names tolerantly and guards case-insensitively", () => {
    expect(themeFor("DUNE").name).toBe("dune");
    expect(themeFor(" frostbite ").name).toBe("frostbite");
    expect(themeFor("unknown").name).toBe("kilima");
    expect(isThemeName("kilima")).toBe(true);
    expect(isThemeName("DUNE")).toBe(true);
    expect(isThemeName("nope")).toBe(false);
  });

  it("tracks the renderer current theme with a kilima default", () => {
    setCurrentTheme("kilima");
    expect(getCurrentTheme()).toBe("kilima");
    expect(setCurrentTheme("frostbite")).toBe("frostbite");
    expect(getCurrentTheme()).toBe("frostbite");
    expect(setCurrentTheme("bogus")).toBe("kilima");
    setCurrentTheme("kilima");
  });
});
