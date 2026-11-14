// Display webfont plus bitmap HUD numbers (issue #151): the bundled OFL
// family name, the 3x5 bitmap glyphs, and the crisp bitmap binder that
// preserves textContent for value probes while rendering hard rects.
import { describe, expect, it } from "vitest";
import {
  BITMAP_GLYPHS,
  BITMAP_PIXEL_PX,
  BITMAP_FONT_FAMILY,
  DISPLAY_FONT_FAMILY,
  DISPLAY_FONT_FILE,
  DISPLAY_FONT_LICENSE,
  FONT_MANIFEST,
  bitmapGlyphFor,
  displayFontFaceCss,
  isBitmapText,
  publishFonts,
  setBitmapText,
} from "../src/ui/fonts";

describe("display webfont", () => {
  it("names the bundled Orbitron display family", () => {
    expect(DISPLAY_FONT_FAMILY).toBe("Orbitron");
    expect(FONT_MANIFEST.display.family).toBe("Orbitron");
  });

  it("points at a fonts/ asset file", () => {
    expect(DISPLAY_FONT_FILE).toBe("assets/fonts/orbitron-700.woff2");
    expect(FONT_MANIFEST.display.file).toBe(DISPLAY_FONT_FILE);
  });

  it("carries the OFL license tag", () => {
    expect(DISPLAY_FONT_LICENSE).toMatch(/OFL/);
    expect(FONT_MANIFEST.display.license).toMatch(/OFL/);
    expect(FONT_MANIFEST.bitmap.license).toMatch(/OFL/);
  });

  it("emits an @font-face rule naming the family and file", () => {
    const css = displayFontFaceCss();
    expect(css).toMatch(/Orbitron/);
    expect(css).toMatch(/orbitron-700\.woff2/);
    expect(css).toMatch(/@font-face/);
  });

  it("publishes the manifest on window without throwing headless", () => {
    expect(() => publishFonts()).not.toThrow();
  });
});

describe("bitmap glyphs", () => {
  it("covers digits 0-9 plus colon, dash, and space", () => {
    for (const digit of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      expect(BITMAP_GLYPHS[digit]).toHaveLength(5);
      for (const row of BITMAP_GLYPHS[digit] as string[]) {
        expect(row).toMatch(/^[01]{3}$/);
      }
    }
    expect(BITMAP_GLYPHS[":"]).toHaveLength(5);
    expect(BITMAP_GLYPHS["-"]).toHaveLength(5);
  });

  it("uses an integer pixel size so scaling never smooths", () => {
    expect(Number.isInteger(BITMAP_PIXEL_PX)).toBe(true);
    expect(BITMAP_PIXEL_PX).toBeGreaterThanOrEqual(2);
  });

  it("accepts HP/timer strings and rejects weapon names", () => {
    expect(isBitmapText("100")).toBe(true);
    expect(isBitmapText("5:00")).toBe(true);
    expect(isBitmapText("3")).toBe(true);
    expect(isBitmapText("Pistol 7")).toBe(false);
    expect(isBitmapText("")).toBe(false);
  });

  it("falls back to blank glyphs for unknown chars", () => {
    expect(bitmapGlyphFor("A")).toEqual(["000", "000", "000", "000", "000"]);
  });
});

describe("setBitmapText", () => {
  function fakeEl(): {
    textContent: string | null;
    attrs: Map<string, string>;
    classes: string[];
    children: unknown[];
    ownerDocument: {
      createElement(tag: string): {
        textContent: string | null;
        attrs: Map<string, string>;
        children: unknown[];
        style: Record<string, string>;
        setAttribute(k: string, v: string): void;
        appendChild(c: unknown): void;
      };
    };
    setAttribute(k: string, v: string): void;
    getAttribute(k: string): string | null;
    appendChild(c: unknown): void;
    classList: { add(c: string): void };
  } {
    const el: {
      textContent: string | null;
      attrs: Map<string, string>;
      classes: string[];
      children: unknown[];
      ownerDocument: {
        createElement(tag: string): {
          textContent: string | null;
          attrs: Map<string, string>;
          children: unknown[];
          style: Record<string, string>;
          setAttribute(k: string, v: string): void;
          appendChild(c: unknown): void;
        };
      };
      setAttribute(k: string, v: string): void;
      getAttribute(k: string): string | null;
      appendChild(c: unknown): void;
      classList: { add(c: string): void };
    } = {
      textContent: "",
      attrs: new Map(),
      classes: [],
      children: [],
      ownerDocument: {
        createElement() {
          const node = {
            textContent: null as string | null,
            attrs: new Map<string, string>(),
            children: [] as unknown[],
            style: {} as Record<string, string>,
            setAttribute(k: string, v: string): void {
              node.attrs.set(k, v);
            },
            appendChild(c: unknown): void {
              node.children.push(c);
            },
          };
          return node;
        },
      },
      setAttribute(k: string, v: string): void {
        el.attrs.set(k, v);
      },
      getAttribute(k: string): string | null {
        return el.attrs.get(k) ?? null;
      },
      appendChild(c: unknown): void {
        el.children.push(c);
      },
      classList: {
        add(c: string): void {
          el.classes.push(c);
        },
      },
    };
    return el;
  }

  it("renders HP digits as gfx rects while textContent keeps the value", () => {
    const el = fakeEl();
    setBitmapText(el as unknown, "100");
    // Value preserved for probes via textContent (hidden label) and data-value.
    expect(el.attrs.get("data-value")).toBe("100");
    expect(el.classes).toContain("hud-bitmap");
    // Walk the gfx tree: 3 digits x 15 cells = 45 pixel rects.
    let pxCount = 0;
    let sawValue = false;
    const visit = (node: unknown): void => {
      const n = node as {
        textContent?: unknown;
        attrs?: Map<string, string>;
        children?: unknown[];
      };
      if (n === null || typeof n !== "object") {
        return;
      }
      if (n.textContent === "100") {
        sawValue = true;
      }
      const cls = n.attrs?.get("class") ?? "";
      if (cls.includes("hud-px")) {
        pxCount += 1;
      }
      for (const child of n.children ?? []) {
        visit(child);
      }
    };
    for (const child of el.children) {
      visit(child);
    }
    expect(sawValue).toBe(true);
    expect(pxCount).toBe(45);
  });

  it("skips rebuilds when the value already matches", () => {
    const el = fakeEl();
    setBitmapText(el as unknown, "42");
    const firstCount = el.children.length;
    setBitmapText(el as unknown, "42");
    expect(el.children.length).toBe(firstCount);
  });

  it("falls back to plain text for unsupported strings", () => {
    const el = fakeEl();
    setBitmapText(el as unknown, "Pistol 7");
    expect(el.textContent).toBe("Pistol 7");
  });

  it("is null-safe and builder-less-safe", () => {
    expect(() => setBitmapText(null, "100")).not.toThrow();
    expect(() => setBitmapText({ textContent: "" } as unknown, "100")).not.toThrow();
    const bare = { textContent: "" } as { textContent: string };
    setBitmapText(bare as unknown, "100");
    expect(bare.textContent).toBe("100");
  });

  it("names the bitmap family distinctly from the display family", () => {
    expect(BITMAP_FONT_FAMILY).not.toBe(DISPLAY_FONT_FAMILY);
    expect(BITMAP_FONT_FAMILY).toMatch(/Bitmap/);
  });
});
