// Display webfont plus bitmap HUD numbers (issue #151). Pure model plus a
// thin DOM binder: the OFL display family for titles/menu (bundled woff2
// under assets/fonts/) and a 3x5 bitmap digit renderer for HUD numbers
// that stays crisp at any zoom (axis-aligned rects, never anti-aliased
// vector text). DOM-free helpers stay unit-testable under node; the binder
// degrades to plain textContent on fake docs without a builder.

/** Bundled OFL display family for titles and menu headings. */
export const DISPLAY_FONT_FAMILY = "Orbitron";
/** Webfont file relative to the client root (copied to dist/assets/fonts/). */
export const DISPLAY_FONT_FILE = "assets/fonts/orbitron-700.woff2";
/** Webfont weight (the bundled latin-bold subset). */
export const DISPLAY_FONT_WEIGHT = 700;
/** License tag for the bundled display webfont (SIL Open Font License). */
export const DISPLAY_FONT_LICENSE = "OFL-1.1";
/** Bitmap HUD family name (in-house 3x5 rects, same OFL file entry). */
export const BITMAP_FONT_FAMILY = "Scrapline Bitmap";
/** Bitmap pixel size in CSS px per bitmap cell (integer, no smoothing). */
export const BITMAP_PIXEL_PX = 3;
/** Bitmap glyph width in cells. */
export const BITMAP_COLS = 3;
/** Bitmap glyph height in cells. */
export const BITMAP_ROWS = 5;
/** Gap between bitmap glyphs in CSS px (one pixel column). */
export const BITMAP_GAP_PX = 3;

/** 3x5 bitmap glyphs: "1" = filled cell, "0" = empty. Space is blank. */
export const BITMAP_GLYPHS: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ":": ["000", "010", "000", "010", "000"],
  "-": ["000", "000", "111", "000", "000"],
  " ": ["000", "000", "000", "000", "000"],
};

/** Canvas/HUD font manifest mirrored to window.__scraplineFonts at boot. */
export const FONT_MANIFEST = {
  display: {
    family: DISPLAY_FONT_FAMILY,
    file: DISPLAY_FONT_FILE,
    weight: DISPLAY_FONT_WEIGHT,
    license: DISPLAY_FONT_LICENSE,
  },
  bitmap: {
    family: BITMAP_FONT_FAMILY,
    kind: "3x5 pixel",
    license: DISPLAY_FONT_LICENSE,
    glyphs: Object.keys(BITMAP_GLYPHS).join(""),
  },
} as const;

/** True when every char in the text has a bitmap glyph. */
export function isBitmapText(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const ch of text) {
    if (BITMAP_GLYPHS[ch] === undefined) {
      return false;
    }
  }
  return true;
}

/** Glyph rows for one char; unknown chars read blank (never throws). */
export function bitmapGlyphFor(ch: string): readonly string[] {
  return BITMAP_GLYPHS[ch] ?? BITMAP_GLYPHS[" "] ?? ["000", "000", "000", "000", "000"];
}

/**
 * @font-face CSS for the bundled display webfont. The URL stays relative
 * to the document base (mirrors atlasUrl) so file://, served-at-/, and
 * subpath hosts all land on dist/assets/fonts/orbitron-700.woff2.
 */
export function displayFontFaceCss(): string {
  return (
    `@font-face{font-family:"${DISPLAY_FONT_FAMILY}";` +
    `src:url("./${DISPLAY_FONT_FILE}") format("woff2");` +
    `font-weight:${DISPLAY_FONT_WEIGHT};font-style:normal;font-display:swap}`
  );
}

/** Minimal element surface for the bitmap binder (real HTMLElements satisfy it). */
interface BitmapEl {
  textContent?: unknown;
  ownerDocument?: { createElement(tag: string): unknown } | null;
  appendChild?(child: unknown): void;
  setAttribute?(name: string, value: string): void;
  getAttribute?(name: string): string | null;
  classList?: { add(name: string): void };
}

/** Narrow an unknown value to the bitmap binder surface; else null. */
function asBitmapEl(el: unknown): BitmapEl | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  return el as BitmapEl;
}

/** Read data-value without throwing on fake docs. */
function readDataValue(el: BitmapEl): string | null {
  try {
    if (typeof el.getAttribute === "function") {
      return el.getAttribute("data-value");
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Render a text string as crisp bitmap rects inside `el`, preserving the
 * value for probes: a visually-hidden label span keeps `textContent`
 * equal to the digits while the visible gfx span carries only rects
 * (no text), so screenshots see hard edges and textContent reads stay
 * exact. Unsupported chars fall back to plain vector textContent.
 * Null-safe: missing elements or builder-less fake docs set textContent
 * only and never throw.
 */
export function setBitmapText(el: unknown, text: string): void {
  const target = asBitmapEl(el);
  if (target === null) {
    return;
  }
  const value = String(text);
  if (!isBitmapText(value)) {
    try {
      target.textContent = value;
    } catch {
      // Fake docs without a textContent setter: value is still carried
      // via data-value below when setAttribute exists.
    }
    return;
  }
  // Skip rebuilds when the value already matches (20 Hz HUD mirror).
  if (readDataValue(target) === value) {
    return;
  }
  const doc =
    target.ownerDocument !== undefined && target.ownerDocument !== null
      ? target.ownerDocument
      : typeof document !== "undefined"
        ? document
        : null;
  const canBuild =
    doc !== null &&
    typeof (doc as { createElement?: unknown }).createElement === "function" &&
    typeof target.appendChild === "function";
  if (!canBuild) {
    try {
      target.textContent = value;
    } catch {
      // Builder-less fakes: nothing else to render into.
    }
    try {
      target.setAttribute?.("data-value", value);
    } catch {
      // Attribute-less fakes: textContent above still carries the value.
    }
    return;
  }
  try {
    target.textContent = "";
  } catch {
    // Read-only textContent shims: continue to the gfx build anyway.
  }
  try {
    target.setAttribute?.("data-value", value);
  } catch {
    // Attribute-less docs: the label text below still carries the value.
  }
  try {
    target.classList?.add("hud-bitmap");
  } catch {
    // Class-less fakes: the inline pixel styles below still render.
  }
  try {
    const create = (doc as unknown as { createElement(tag: string): HTMLElement }).createElement.bind(
      doc as object,
    );
    const label = create("span");
    label.textContent = value;
    try {
      label.setAttribute("class", "hud-bitmap-label");
    } catch {
      // Class-less shims: the clip CSS below is best-effort only.
    }
    target.appendChild?.(label);
    const gfx = create("span");
    try {
      gfx.setAttribute("class", "hud-bitmap-gfx");
      gfx.setAttribute("aria-hidden", "true");
    } catch {
      // Attribute-less shims: the rects below still render.
    }
    for (const ch of value) {
      const glyph = create("span");
      try {
        glyph.setAttribute("class", "hud-glyph");
      } catch {
        // Keep the glyph even when classes cannot attach.
      }
      const rows = bitmapGlyphFor(ch);
      for (const row of rows) {
        for (const cell of row) {
          const px = create("i");
          try {
            px.setAttribute("class", cell === "1" ? "hud-px on" : "hud-px");
          } catch {
            // Keep the cell even when classes cannot attach.
          }
          const style = (px as unknown as { style?: Record<string, string> }).style;
          if (style !== undefined && typeof style === "object") {
            style.display = "block";
            style.width = `${BITMAP_PIXEL_PX}px`;
            style.height = `${BITMAP_PIXEL_PX}px`;
            style.background = cell === "1" ? "#e2e8f0" : "transparent";
          }
          (glyph as unknown as { appendChild(c: unknown): void }).appendChild(px);
        }
      }
      (gfx as unknown as { appendChild(c: unknown): void }).appendChild(glyph);
    }
    target.appendChild?.(gfx);
  } catch {
    // Half-built docs (throwing createElement/appendChild): fall back
    // to the plain value so the HUD never goes blank.
    try {
      target.textContent = value;
    } catch {
      // Nothing else to try on hostile shims.
    }
  }
}

/** Publish the font manifest for canvas/computed-font probes. */
export function publishFonts(): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    (window as unknown as Record<string, unknown>)["__scraplineFonts"] = {
      displayFamily: DISPLAY_FONT_FAMILY,
      displayFile: DISPLAY_FONT_FILE,
      displayLicense: DISPLAY_FONT_LICENSE,
      bitmapFamily: BITMAP_FONT_FAMILY,
      manifest: FONT_MANIFEST,
      css: displayFontFaceCss(),
    };
  } catch {
    // Shorn harnesses without a window: the CSS/bundle paths still prove
    // the family, and the fonts.json manifest still carries the OFL tag.
  }
}
