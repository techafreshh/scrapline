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

  it("returns fresh copies that callers can mutate safely", () => {
    const first = themeFor("dune");
    const second = themeFor("dune");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first).not.toBe(THEMES.dune);
    const fallbackFirst = themeFor("unknown");
    const fallbackSecond = themeFor("bogus");
    expect(fallbackFirst).not.toBe(THEMES.kilima);
    expect(fallbackFirst).not.toBe(fallbackSecond);
    expect(fallbackFirst).toEqual(THEMES.kilima);
    first.base = "#000000";
    first.baseHex = 0xdeadbeef;
    expect(THEMES.dune.base).not.toBe("#000000");
    expect(THEMES.dune.baseHex).not.toBe(0xdeadbeef);
    expect(themeFor("dune")).toEqual(THEMES.dune);
  });

  it("exposes a distinct flat tileset asset key per theme", () => {
    expect(THEMES.kilima.tileset).toBe("tile-kilima");
    expect(THEMES.dune.tileset).toBe("tile-dune");
    expect(THEMES.frostbite.tileset).toBe("tile-frostbite");
    expect(themeFor("unknown").tileset).toBe("tile-kilima");
  });

  it("pins the kilima hazard pair to the probe hexes", () => {
    expect(THEMES.kilima.hazardHex).toBe(0xffd21f);
    expect(THEMES.kilima.hazardCss).toBe("#FFD21F");
    expect(THEMES.kilima.hazard).toBe("#FFD21F");
    expect(THEMES.kilima.hazardStripeHex).toBe(0x111111);
    expect(THEMES.kilima.hazardStripeCss).toBe("#111111");
    expect(THEMES.kilima.hazardStripe).toBe("#111111");
  });

  it("gives dune and frostbite theme-distinct hazard pairs", () => {
    for (const name of ["dune", "frostbite"] as const) {
      expect(THEMES[name].hazardHex).not.toBe(THEMES.kilima.hazardHex);
      expect(THEMES[name].hazardCss).not.toBe(THEMES.kilima.hazardCss);
    }
    expect(THEMES.dune.hazardHex).not.toBe(THEMES.frostbite.hazardHex);
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
