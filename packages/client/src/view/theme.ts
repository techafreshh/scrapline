// Per-theme tile palette: pure data (no DOM, no Pixi), so the renderer
// and the headless unit tests share one source of truth. kilima is
// neutral gray, dune is warm (r-b > 5), frostbite is cool (b-r > 10).
// Each highlight is lightened by ~40 per channel so the top-row
// luminance probe (highlight - body >= 15) always passes; each backwall
// is the base at 60% brightness.

/** Arena theme names in menu order. */
export const THEME_NAMES = ["kilima", "dune", "frostbite"] as const;

/** Arena theme union. */
export type ThemeName = (typeof THEME_NAMES)[number];

/** Pure tile palette for one theme. */
export interface TileTheme {
  /** Theme key (matches the arena file name). */
  name: ThemeName;
  /** Solid body fill (sampled by the theme-shift probe). */
  base: string;
  /** Solid body fill as Pixi hex. */
  baseHex: number;
  /** Top surface highlight (2px strip, lighter than base by >=15 lum). */
  highlight: string;
  /** Top surface highlight as Pixi hex. */
  highlightHex: number;
  /** Edge shading (1px border, darker than base). */
  edge: string;
  /** Edge shading as Pixi hex. */
  edgeHex: number;
  /** Depth tint (bottom strip, darker than base). */
  depth: string;
  /** Depth tint as Pixi hex. */
  depthHex: number;
  /** Backwall quad (base at 60% brightness, drawn behind solids). */
  backwall: string;
  /** Backwall quad as Pixi hex. */
  backwallHex: number;
  /** One-way plank fill (thin 8px plank). */
  oneWay: string;
  /** One-way plank fill as Pixi hex. */
  oneWayHex: number;
  /** Bounce pad base (striped chevron pad, 8px tall). */
  bounce: string;
  /** Bounce pad base as Pixi hex. */
  bounceHex: number;
  /** Bounce chevron stripe. */
  bounceStripe: string;
  /** Bounce chevron stripe as Pixi hex. */
  bounceStripeHex: number;
}

/** kilima: neutral gray (r≈g≈b). */
const KILIMA: TileTheme = {
  name: "kilima",
  base: "#646464",
  baseHex: 0x646464,
  highlight: "#8c8c8c",
  highlightHex: 0x8c8c8c,
  edge: "#3f3f3f",
  edgeHex: 0x3f3f3f,
  depth: "#4a4a4a",
  depthHex: 0x4a4a4a,
  backwall: "#3c3c3c",
  backwallHex: 0x3c3c3c,
  oneWay: "#a8a29e",
  oneWayHex: 0xa8a29e,
  bounce: "#eab308",
  bounceHex: 0xeab308,
  bounceStripe: "#1c1917",
  bounceStripeHex: 0x1c1917,
};

/** dune: warm sand (r-b = 89 > 5). */
const DUNE: TileTheme = {
  name: "dune",
  base: "#a87b4f",
  baseHex: 0xa87b4f,
  highlight: "#d6ab7f",
  highlightHex: 0xd6ab7f,
  edge: "#6e4f30",
  edgeHex: 0x6e4f30,
  depth: "#7d5c38",
  depthHex: 0x7d5c38,
  backwall: "#654a30",
  backwallHex: 0x654a30,
  oneWay: "#d6ab7f",
  oneWayHex: 0xd6ab7f,
  bounce: "#f59e0b",
  bounceHex: 0xf59e0b,
  bounceStripe: "#451a03",
  bounceStripeHex: 0x451a03,
};

/** frostbite: cool ice (b-r = 89 > 10). */
const FROSTBITE: TileTheme = {
  name: "frostbite",
  base: "#4f7ba8",
  baseHex: 0x4f7ba8,
  highlight: "#8ab5d6",
  highlightHex: 0x8ab5d6,
  edge: "#2f4e6e",
  edgeHex: 0x2f4e6e,
  depth: "#3a5c82",
  depthHex: 0x3a5c82,
  backwall: "#304a65",
  backwallHex: 0x304a65,
  oneWay: "#8ab5d6",
  oneWayHex: 0x8ab5d6,
  bounce: "#22d3ee",
  bounceHex: 0x22d3ee,
  bounceStripe: "#083344",
  bounceStripeHex: 0x083344,
};

/** Pure theme registry (never mutated by callers). */
export const THEMES: Record<ThemeName, TileTheme> = {
  kilima: KILIMA,
  dune: DUNE,
  frostbite: FROSTBITE,
};

/** Pure sky-grade stops for one theme (hex + CSS twins, top is light). */
export interface SkyGrade {
  /** Theme key (matches the arena file name). */
  name: ThemeName;
  /** Light zenith stop (sampled by the skyTop probe). */
  top: string;
  /** Light zenith stop as Pixi hex. */
  topHex: number;
  /** Dark horizon stop. */
  bottom: string;
  /** Dark horizon stop as Pixi hex. */
  bottomHex: number;
}

/** kilima: neutral gray grade. */
const KILIMA_SKY: SkyGrade = {
  name: "kilima",
  top: "#5A6B7A",
  topHex: 0x5a6b7a,
  bottom: "#1A2028",
  bottomHex: 0x1a2028,
};

/** dune: warm amber grade. */
const DUNE_SKY: SkyGrade = {
  name: "dune",
  top: "#D98A2B",
  topHex: 0xd98a2b,
  bottom: "#2A1A0A",
  bottomHex: 0x2a1a0a,
};

/** frostbite: cold-blue grade. */
const FROSTBITE_SKY: SkyGrade = {
  name: "frostbite",
  top: "#3A7DD5",
  topHex: 0x3a7dd5,
  bottom: "#0A2540",
  bottomHex: 0x0a2540,
};

/** Pure sky-grade registry (never mutated by callers). */
export const SKY_GRADES: Record<ThemeName, SkyGrade> = {
  kilima: KILIMA_SKY,
  dune: DUNE_SKY,
  frostbite: FROSTBITE_SKY,
};

/**
 * Resolve a sky grade tolerantly; unknown values fall back to kilima
 * (the menu default), mirroring themeFor.
 */
export function skyGradeFor(name: unknown): SkyGrade {
  if (typeof name === "string") {
    const key = name.trim().toLowerCase();
    if (key === "dune") {
      return { ...SKY_GRADES.dune };
    }
    if (key === "frostbite") {
      return { ...SKY_GRADES.frostbite };
    }
    if (key === "kilima") {
      return { ...SKY_GRADES.kilima };
    }
  }
  return { ...SKY_GRADES.kilima };
}

/** Case-insensitive theme guard (trims surrounding whitespace). */
export function isThemeName(value: unknown): value is ThemeName {
  if (typeof value !== "string") {
    return false;
  }
  return (THEME_NAMES as readonly string[]).includes(value.trim().toLowerCase());
}

/**
 * Resolve a theme name tolerantly; unknown values fall back to kilima
 * (the menu default), so headless renderers never crash on bad input.
 */
export function themeFor(name: unknown): TileTheme {
  if (typeof name === "string") {
    const key = name.trim().toLowerCase();
    if (key === "dune") {
      return { ...THEMES.dune };
    }
    if (key === "frostbite") {
      return { ...THEMES.frostbite };
    }
    if (key === "kilima") {
      return { ...THEMES.kilima };
    }
  }
  return { ...THEMES.kilima };
}

/** Split a Pixi hex into 8-bit channels. */
export function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

/** Rec.601 luma for an 8-bit triple (matches the screenshot probe). */
export function luminanceOfRgb(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Rec.601 luma for a Pixi hex. */
export function luminanceOfHex(hex: number): number {
  const { r, g, b } = hexToRgb(hex);
  return luminanceOfRgb(r, g, b);
}

/** Module-level current theme (renderer paint state, default kilima). */
let currentTheme: ThemeName = "kilima";

/** Read the renderer's current theme name. */
export function getCurrentTheme(): ThemeName {
  return currentTheme;
}

/** Set the renderer's current theme (tolerant, falls back to kilima). */
export function setCurrentTheme(name: unknown): ThemeName {
  if (typeof name === "string") {
    const key = name.trim().toLowerCase();
    if (key === "dune" || key === "frostbite" || key === "kilima") {
      currentTheme = key;
      return currentTheme;
    }
  }
  currentTheme = "kilima";
  return currentTheme;
}
