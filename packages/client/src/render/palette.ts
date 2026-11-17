// Cohesion palette retint per theme (issue #268).
//
// Raw Kenney pack hues (green-heavy platformer tiles, saturated prop/pad
// cards) clash with the per-theme graded backdrops and sky grades, so
// tile/prop zones read as mismatched hue bands against the backdrop. This
// module is the single palette/grade pass that retints tile and prop
// sprites per theme (kilima dusk, dune golden, frostbite cold) at paint
// time in the canvas-2D overlay path, applied strictly *after*
// tileSpriteKey / propSpriteKey / padSpriteKey frame lookup. Grade targets
// read off the shipped backdrop/sky constants (kilima haze #8a9aa8 and sky
// top #5A6B7A pin hue 208, dune haze #e8b06a and sky top #D98A2B pin hue
// 33, frostbite haze #9fd4f0 and sky top #3A7DD5 pin hue ~207), so graded
// sprite pixels average within the 30-degree cohesion gate against the
// sampled backdrop zone by construction.
//
// DOM/Pixi-free: every helper takes plain numbers and strings, so the
// module stays unit-testable under node like render/soldier.ts. Image
// loading and canvas tinting live in renderer/index.ts; this module only
// names grade rows, atlas tint strengths, and the per-pixel grade math
// the tinted-tile/prop/pad caches drive.

/** Arena theme names carrying a palette grade (menu order). */
export const PALETTE_THEMES = ["kilima", "dune", "frostbite"] as const;

/** One arena theme carrying a palette grade. */
export type PaletteThemeName = (typeof PALETTE_THEMES)[number];

/**
 * Theme hue targets for the grade pass, read off the shipped
 * backdrop/sky constants (backdropPaletteFor haze + skyGradeFor tops in
 * view/theme.ts and view/backdrop.ts): kilima slate-dusk 208, dune
 * golden 33, frostbite cold 207.
 */
export const THEME_GRADE_HUES: Record<PaletteThemeName, number> = {
  kilima: 208,
  dune: 33,
  frostbite: 207,
};

/** Parametric grade row for one theme (the per-theme LUT entry). */
export interface ThemeGradeRow {
  /** Theme key (matches the arena file name). */
  name: PaletteThemeName;
  /** Hue every graded pixel pulls toward (0-360). */
  targetHue: number;
  /** Shortest-arc pull toward the target in [0, 1] (1 = full retint). */
  huePull: number;
  /** Saturation multiplier applied before the floor (keeps pack punch). */
  satMult: number;
  /** Saturation floor so near-gray pack pixels still read the theme hue. */
  satFloor: number;
  /** Lightness multiplier applied before the clamp. */
  lightMult: number;
  /** Lightness clamp floor (keeps hue-defining midtones). */
  lightMin: number;
  /** Lightness clamp ceiling (keeps hue-defining midtones). */
  lightMax: number;
}

/** kilima grade: full pull to slate-dusk 208 (matches haze #8a9aa8). */
const KILIMA_GRADE: ThemeGradeRow = {
  name: "kilima",
  targetHue: 208,
  huePull: 1,
  satMult: 1,
  satFloor: 0.55,
  lightMult: 1,
  lightMin: 0.32,
  lightMax: 0.72,
};

/** dune grade: full pull to golden 33 (matches haze #e8b06a). */
const DUNE_GRADE: ThemeGradeRow = {
  name: "dune",
  targetHue: 33,
  huePull: 1,
  satMult: 1,
  satFloor: 0.55,
  lightMult: 1,
  lightMin: 0.32,
  lightMax: 0.72,
};

/** frostbite grade: full pull to cold 207 (between haze and sky top). */
const FROSTBITE_GRADE: ThemeGradeRow = {
  name: "frostbite",
  targetHue: 207,
  huePull: 1,
  satMult: 1,
  satFloor: 0.55,
  lightMult: 1,
  lightMin: 0.32,
  lightMax: 0.72,
};

/** Pure grade LUT registry (never mutated by callers). */
export const THEME_GRADES: Record<PaletteThemeName, ThemeGradeRow> = {
  kilima: KILIMA_GRADE,
  dune: DUNE_GRADE,
  frostbite: FROSTBITE_GRADE,
};

/**
 * Manifest key prefix for the tile family (built without a quoted
 * dotted literal so the atlas reference scanner only sees full keys,
 * mirroring the TILE_PREFIX idiom in render/tiles.ts).
 */
const TILE_FAMILY = "tile" + ".";
/**
 * Manifest key prefix for the prop family (same scanner-safe idiom as
 * PROP_PREFIX in render/props.ts).
 */
const PROP_FAMILY = "prop" + ".";
/**
 * Manifest key prefix for the pad family (same scanner-safe idiom as
 * PAD_PREFIX in render/props.ts).
 */
const PAD_FAMILY = "pad" + ".";

/**
 * Per-family atlas tint strengths in [0, 1]: scales the row hue pull
 * for the `tile.` / `prop.` / `pad.` families. Tiles carry the full
 * retint (they tile the whole playfield); props and pads keep a breath
 * of pack identity while still landing inside the cohesion gate.
 */
export const ATLAS_TINT: Record<string, number> = {
  [TILE_FAMILY]: 1,
  [PROP_FAMILY]: 0.95,
  [PAD_FAMILY]: 0.95,
};

/** Grade strength for one atlas frame key (1 for unknown families). */
export function atlasTintFor(key: unknown): number {
  if (typeof key === "string") {
    if (key.startsWith(PROP_FAMILY)) {
      return ATLAS_TINT[PROP_FAMILY] ?? 1;
    }
    if (key.startsWith(PAD_FAMILY)) {
      return ATLAS_TINT[PAD_FAMILY] ?? 1;
    }
    if (key.startsWith(TILE_FAMILY)) {
      return ATLAS_TINT[TILE_FAMILY] ?? 1;
    }
  }
  return 1;
}

/** True for a palette theme name (case-insensitive, trims whitespace). */
function isPaletteThemeName(value: string): value is PaletteThemeName {
  return (PALETTE_THEMES as readonly string[]).includes(value);
}

/**
 * Normalize a theme reading to a palette theme (unknowns read kilima,
 * mirroring normalizeTileTheme and skyGradeFor).
 */
export function normalizePaletteTheme(theme: unknown): PaletteThemeName {
  if (typeof theme === "string") {
    const key = theme.trim().toLowerCase();
    if (isPaletteThemeName(key)) {
      return key;
    }
  }
  return "kilima";
}

/**
 * Grade LUT row for a theme reading (unknowns read the kilima row).
 * Returns a copy so callers cannot mutate the registry.
 */
export function gradeLutFor(theme: unknown): ThemeGradeRow {
  const name = normalizePaletteTheme(theme);
  if (name === "dune") {
    return { ...THEME_GRADES.dune };
  }
  if (name === "frostbite") {
    return { ...THEME_GRADES.frostbite };
  }
  if (name === "kilima") {
    return { ...THEME_GRADES.kilima };
  }
  return { ...THEME_GRADES.kilima };
}

/**
 * RGB (0-255) to HSL (h 0-360, s/l 0-1). Pure (mirrors render/soldier.ts).
 */
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60;
  } else {
    h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, l };
}

/**
 * HSL (h 0-360, s/l 0-1) to RGB (0-255). Pure (mirrors render/soldier.ts).
 */
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * Shortest-arc hue distance in degrees (0-180). Pure.
 */
export function hueDistance(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/**
 * Grade one sprite pixel toward a theme row: transparent pixels
 * (alpha under 16) and near-black outlines (max channel under 48) pass
 * through untouched, mirroring tintSoldierPixel; everything else pulls
 * along the shortest hue arc toward the row target (full retint at pull
 * 1) with the saturation floor and lightness clamp keeping the hue read
 * well-defined. Pure.
 */
export function gradePixelWithRow(
  r: number,
  g: number,
  b: number,
  a: number,
  row: ThemeGradeRow,
  strength = 1,
): [number, number, number, number] {
  if (a < 16) {
    return [r, g, b, a];
  }
  if (Math.max(r, g, b) < 48) {
    return [r, g, b, a];
  }
  const pull = Math.min(1, Math.max(0, row.huePull * strength));
  const { h, s, l } = rgbToHsl(r, g, b);
  // Shortest-arc offset from the source hue to the target hue.
  const arc = ((((row.targetHue - h) % 360) + 540) % 360) - 180;
  const gradedHue = (((h + arc * pull) % 360) + 360) % 360;
  const gradedSat = Math.min(1, Math.max(s * row.satMult, row.satFloor));
  const gradedLight = Math.min(
    row.lightMax,
    Math.max(row.lightMin, l * row.lightMult),
  );
  const [nr, ng, nb] = hslToRgb(gradedHue, gradedSat, gradedLight);
  return [nr, ng, nb, a];
}

/**
 * Grade one pack sprite pixel for a theme: the single palette/grade
 * pass over tile/prop/pad art, applied at paint time after
 * tileSpriteKey / propSpriteKey / padSpriteKey frame lookup. Unknown or
 * blank themes fall back to kilima. Pure.
 */
export function applyThemeGrade(
  r: number,
  g: number,
  b: number,
  a: number,
  theme: unknown,
  strength = 1,
): [number, number, number, number] {
  const name = normalizePaletteTheme(theme);
  if (name === "kilima") {
    return gradePixelWithRow(r, g, b, a, THEME_GRADES.kilima, strength);
  }
  if (name === "dune") {
    return gradePixelWithRow(r, g, b, a, THEME_GRADES.dune, strength);
  }
  if (name === "frostbite") {
    return gradePixelWithRow(r, g, b, a, THEME_GRADES.frostbite, strength);
  }
  return gradePixelWithRow(r, g, b, a, THEME_GRADES.kilima, strength);
}
