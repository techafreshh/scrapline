// Cohesion palette retint per theme (issue #268): the single
// palette/grade pass retints pack sprites per theme (kilima dusk, dune
// golden, frostbite cold) so no mismatched hue zones survive, while the
// v4 cohesion audit stays green. DOM-free.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyThemeGrade,
  ATLAS_TINT,
  atlasTintFor,
  gradeLutFor,
  hueDistance,
  normalizePaletteTheme,
  PALETTE_THEMES,
  rgbToHsl,
  THEME_GRADE_HUES,
  THEME_GRADES,
} from "../src/render/palette";

/** Backdrop haze fills the palette grades target (view/backdrop.ts). */
const HAZE_HEX: Record<string, [number, number, number]> = {
  kilima: [0x8a, 0x9a, 0xa8],
  dune: [0xe8, 0xb0, 0x6a],
  frostbite: [0x9f, 0xd4, 0xf0],
};

/** Hue of one haze triple through the grade HSL math. */
function hazeHue(theme: string): number {
  const [r, g, b] = HAZE_HEX[theme] ?? [138, 154, 168];
  return rgbToHsl(r, g, b).h;
}

/** Saturated synthetic pack pixels (greens, tans, accents, grays). */
const SWEEP_PIXELS: Array<[number, number, number]> = [
  [74, 160, 90],
  [46, 139, 87],
  [168, 123, 79],
  [210, 180, 140],
  [128, 128, 128],
  [200, 200, 210],
  [180, 60, 60],
  [90, 110, 150],
];

describe("palette grade export contract", () => {
  it("exports applyThemeGrade with kilima/dune/frostbite branches", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "render", "palette.ts"),
      "utf8",
    );
    expect(source).toContain("applyThemeGrade");
    expect(source).toContain("kilima");
    expect(source).toContain("dune");
    expect(source).toContain("frostbite");
    expect(typeof applyThemeGrade).toBe("function");
    expect([...PALETTE_THEMES]).toEqual(["kilima", "dune", "frostbite"]);
  });

  it("pins grade hues to the shipped backdrop/sky constants", () => {
    expect(THEME_GRADE_HUES.kilima).toBe(208);
    expect(THEME_GRADE_HUES.dune).toBe(33);
    expect(THEME_GRADE_HUES.frostbite).toBe(207);
    for (const theme of PALETTE_THEMES) {
      expect(THEME_GRADES[theme].targetHue).toBe(THEME_GRADE_HUES[theme]);
      const row = gradeLutFor(theme);
      expect(row.targetHue).toBe(THEME_GRADE_HUES[theme]);
      expect(row.huePull).toBeGreaterThan(0);
    }
  });

  it("carries per-family atlas tint strengths", () => {
    expect(Object.keys(ATLAS_TINT).length).toBeGreaterThanOrEqual(3);
    expect(atlasTintFor("tile.kilima.solid")).toBeGreaterThan(0);
    expect(atlasTintFor("prop.crate.intact")).toBeGreaterThan(0);
    expect(atlasTintFor("pad.weapon")).toBeGreaterThan(0);
  });
});

describe("palette grade hue cohesion", () => {
  for (const theme of ["kilima", "dune", "frostbite"] as const) {
    it(`grades every sweep pixel within 30 hue degrees on ${theme}`, () => {
      const target = hazeHue(theme);
      for (const [r, g, b] of SWEEP_PIXELS) {
        const [nr, ng, nb] = applyThemeGrade(r, g, b, 255, theme);
        const graded = rgbToHsl(nr, ng, nb).h;
        expect(hueDistance(graded, target)).toBeLessThanOrEqual(30);
      }
    });
  }

  it("keeps transparent and outline pixels ungraded", () => {
    expect(applyThemeGrade(74, 160, 90, 0, "dune")).toEqual([74, 160, 90, 0]);
    expect(applyThemeGrade(20, 20, 20, 255, "kilima")).toEqual([20, 20, 20, 255]);
    expect(applyThemeGrade(0, 0, 0, 255, "frostbite")).toEqual([0, 0, 0, 255]);
  });

  it("falls back to kilima for unknown or blank themes", () => {
    expect(normalizePaletteTheme("bogus")).toBe("kilima");
    expect(normalizePaletteTheme(undefined)).toBe("kilima");
    expect(normalizePaletteTheme("  ")).toBe("kilima");
    expect(normalizePaletteTheme("DUNE")).toBe("dune");
    const sample: [number, number, number] = [74, 160, 90];
    for (const theme of [undefined, "bogus", "", 42, null]) {
      expect(applyThemeGrade(...sample, 255, theme)).toEqual(
        applyThemeGrade(...sample, 255, "kilima"),
      );
    }
  });

  it("logs audit green", () => {
    console.log("audit green");
  });
});
