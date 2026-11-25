// Sliced chrome art contract (issue #347): static proofs over the
// shipped stylesheets and atlas that every control rides new art with
// 9-slice-safe frames and whole-pixel fills. Pure file reads only
// (no DOM), mirroring the feed.test.ts style.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_FILES } from "../src/ui/chrome";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "..", "public");
const COMPONENTS = path.join(PUBLIC, "components");
const ATLAS = path.resolve(HERE, "..", "assets", "atlas");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ATLAS, "manifest.json"), "utf8"),
) as Record<string, { file?: unknown; w?: unknown; h?: unknown }>;

// Required kit from the issue contract: every vocabulary piece ships a
// manifest key so no surface can fall back to the stretched tiles.
const REQUIRED_KEYS = [
  "ui.panel",
  "ui.panel.elevated",
  "ui.panel.inset",
  "ui.panel.hazard",
  "ui.button",
  "ui.button.hover",
  "ui.button.pressed",
  "ui.button.disabled",
  "ui.button.focus",
  "ui.button.cta",
  "ui.button.secondary",
  "ui.chip",
  "ui.bar.track",
  "ui.bar.fill",
  "ui.slider.track",
  "ui.slider.thumb",
  "ui.toggle.off",
  "ui.toggle.on",
  "ui.checkbox",
  "ui.field",
  "ui.field.select",
  "ui.scrollbar",
  "ui.row",
  "ui.row.hover",
  "ui.row.selected",
  "ui.tooltip",
  "ui.toast",
  "ui.keycap",
  "ui.divider",
  "ui.bracket",
  "ui.header",
];

/** Every url() target in every components sheet. */
function stylesheetUrls(): string[] {
  const urls: string[] = [];
  for (const name of fs.readdirSync(COMPONENTS)) {
    if (!name.endsWith(".css")) {
      continue;
    }
    const source = fs.readFileSync(path.join(COMPONENTS, name), "utf8");
    const pattern = /url\("([^"]+)"\)/g;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(source)) !== null) {
      urls.push(found[1]);
    }
  }
  return urls;
}

interface SheetRule {
  file: string;
  selector: string;
  body: string;
}

/** Every rule block with its selector list across components sheets. */
function sheetRules(): SheetRule[] {
  const out: SheetRule[] = [];
  for (const name of fs.readdirSync(COMPONENTS)) {
    if (!name.endsWith(".css")) {
      continue;
    }
    const source = fs.readFileSync(path.join(COMPONENTS, name), "utf8");
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(source)) !== null) {
      out.push({ file: name, selector: found[1], body: found[2] });
    }
  }
  return out;
}

describe("chrome manifest kit", () => {
  it("ships every required control piece", () => {
    for (const key of REQUIRED_KEYS) {
      expect(MANIFEST[key]?.file, `manifest must ship ${key}`).toBeTruthy();
    }
  });

  it("ships no required piece as a stretched 16x16 tile", () => {
    for (const key of REQUIRED_KEYS) {
      expect(String(MANIFEST[key]?.file)).not.toMatch(/tile_/);
    }
  });

  it("keeps every mapped chrome file on disk with whole-pixel boxes", () => {
    for (const [key, file] of Object.entries(CHROME_FILES)) {
      expect(fs.existsSync(path.join(ATLAS, file))).toBe(true);
      const entry = MANIFEST[key] as { w?: unknown; h?: unknown };
      expect(Number.isInteger(entry?.w)).toBe(true);
      expect(Number.isInteger(entry?.h)).toBe(true);
    }
  });
});

describe("chrome stylesheets", () => {
  it("points every art url at a shipped atlas file, never a tile", () => {
    const urls = stylesheetUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toMatch(/tile_/);
      const disk = path.resolve(PUBLIC, "..", url.replace(/^\.\.\//, ""));
      expect(fs.existsSync(disk), `${url} must exist`).toBe(true);
    }
  });

  it("uses 9-slice widths that are multiples of 4px", () => {
    for (const rule of sheetRules()) {
      const pattern = /border-image-(?:slice|width)\s*:\s*([^;]+);/g;
      let found: RegExpExecArray | null;
      while ((found = pattern.exec(rule.body)) !== null) {
        for (const token of found[1].replace(/fill/g, "").trim().split(/\s+/)) {
          const px = Number(token.replace("px", ""));
          expect(Number.isInteger(px)).toBe(true);
          expect(px % 4).toBe(0);
        }
      }
    }
  });

  it("pairs every fixed background with pixelated whole-pixel sizing", () => {
    for (const rule of sheetRules()) {
      if (!/background-image\s*:/.test(rule.body)) {
        continue;
      }
      // State overrides restate only the image; the idle rule in the
      // same family owns the rendering contract.
      const rest = rule.body.replace(/background-image\s*:[^;]+;?/g, "");
      if (/^\s*$/.test(rest)) {
        continue;
      }
      expect(rule.body, `${rule.selector} must be pixelated`).toMatch(
        /image-rendering\s*:\s*pixelated/,
      );
      expect(rule.body, `${rule.selector} must not repeat`).not.toMatch(
        /background-repeat\s*:\s*repeat\b/,
      );
      const size = /background-size\s*:\s*([^;]+);/.exec(rule.body);
      expect(size, `${rule.selector} must size whole pixels`).not.toBe(null);
      expect(size?.[1].trim()).toMatch(/^\d+px( \d+px)?$/);
    }
  });

  it("keeps button boxes identical across states (no hover shift)", () => {
    const source = fs.readFileSync(path.join(COMPONENTS, "button.css"), "utf8");
    const block = (selector: string): string => {
      const start = source.indexOf(selector);
      expect(start, `${selector} must exist`).not.toBe(-1);
      const open = source.indexOf("{", start);
      const close = source.indexOf("}", open);
      return source.slice(open + 1, close);
    };
    const pick = (body: string, prop: string): string | null => {
      const found = new RegExp(`${prop}\\s*:\\s*([^;]+);?`).exec(body);
      return found === null ? null : found[1].trim();
    };
    // The base frame family: every state restates the same 8px frame,
    // so lighting and bevel swap without moving the box.
    const idle = block(".sl-btn {");
    for (const selector of [
      ".sl-btn:hover",
      ".sl-btn:active",
      ".sl-btn:focus-visible",
      ".sl-btn:disabled",
    ]) {
      const body = block(selector);
      expect(pick(body, "border")).toBe(pick(idle, "border"));
      expect(pick(body, "border-image-width")).toBe(
        pick(idle, "border-image-width"),
      );
      // Sizing rides the base rule alone: states must not restate it.
      expect(pick(body, "min-height")).toBe(null);
      expect(pick(body, "padding")).toBe(null);
    }
    // CTA and secondary families pin their own wider frames the same
    // way: hover restates the idle border instead of changing it.
    const chrome = fs.readFileSync(path.join(COMPONENTS, "chrome.css"), "utf8");
    const chromeBlock = (selector: string): string => {
      const start = chrome.indexOf(selector);
      expect(start, `${selector} must exist`).not.toBe(-1);
      const open = chrome.indexOf("{", start);
      const close = chrome.indexOf("}", open);
      return chrome.slice(open + 1, close);
    };
    for (const [idleSel, hoverSel] of [
      [".sl-btn.menu-cta {", ".sl-btn.menu-cta:hover {"],
      [".sl-btn.menu-secondary,", ".sl-btn.menu-secondary:hover,"],
    ] as const) {
      const idleBody = chromeBlock(idleSel);
      const hoverBody = chromeBlock(hoverSel);
      expect(pick(hoverBody, "border")).toBe(pick(idleBody, "border"));
      expect(pick(hoverBody, "border-image-width")).toBe(
        pick(idleBody, "border-image-width"),
      );
    }
  });

  it("keeps panels on translucent token fills without tiled images", () => {
    for (const rule of sheetRules()) {
      // Pseudo-elements carry ornaments (brackets), not panel faces.
      if (rule.selector.includes("::")) {
        continue;
      }
      if (!rule.selector.includes(".sl-panel")) {
        continue;
      }
      expect(rule.body).not.toMatch(/background-image/);
    }
  });
});
