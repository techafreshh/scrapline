// UI pixel-pack chrome tests (issue #270): `ui.*` key prefixes, pure
// selectors, snapshot shapes, the manifest file-map sync, and the
// fake-doc binders (panel/button stamping, hover swaps, tolerance).
// Fake elements only (no jsdom), mirroring feed.test.ts style.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AMMO_MODULE_KEY,
  applyHudChrome,
  bindMenuChrome,
  buildHudSnapshot,
  buildMenuSnapshot,
  CHROME_FILES,
  chromeBackgroundFor,
  chromeFileFor,
  HUD_BAR_KEY,
  HUD_FRAME_KEY,
  hudFrameKeyFor,
  MENU_BUTTON_HOVER_KEY,
  MENU_BUTTON_KEY,
  MENU_PANEL_KEY,
  menuButtonKeyFor,
  resetChromeHover,
  stampChrome,
  UI_PREFIX,
} from "../src/ui/chrome";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(
  HERE,
  "..",
  "assets",
  "atlas",
  "manifest.json",
);

/** Minimal fake element with attrs, a style bag, and listeners. */
interface FakeEl {
  tag: string;
  attrs: Map<string, string>;
  style: Record<string, string>;
  listeners: Map<string, Array<() => void>>;
  children: FakeEl[];
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
}

function makeEl(tag: string): FakeEl {
  const el: FakeEl = {
    tag,
    attrs: new Map<string, string>(),
    style: {},
    listeners: new Map<string, Array<() => void>>(),
    children: [],
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
    },
    getAttribute: (k: string): string | null => el.attrs.get(k) ?? null,
    addEventListener: (type: string, listener: () => void): void => {
      const list = el.listeners.get(type) ?? [];
      list.push(listener);
      el.listeners.set(type, list);
    },
    fire: (type: string): void => {
      for (const listener of el.listeners.get(type) ?? []) {
        listener();
      }
    },
  };
  return el;
}

/** Minimal fake document with id lookup plus button queries. */
interface FakeDoc {
  byId: Map<string, FakeEl>;
  buttons: FakeEl[];
  getElementById(id: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
}

function makeDoc(ids: string[], buttons: FakeEl[] = []): FakeDoc {
  const byId = new Map<string, FakeEl>();
  for (const id of ids) {
    byId.set(id, makeEl("div"));
  }
  const doc: FakeDoc = {
    byId,
    buttons,
    getElementById: (id: string): FakeEl | null => byId.get(id) ?? null,
    querySelectorAll: (sel: string): FakeEl[] =>
      sel === "button" ? buttons : [],
  };
  return doc;
}

describe("chrome keys", () => {
  it("every key carries the `ui.` prefix", () => {
    expect(UI_PREFIX).toBe("ui.");
    for (const key of [
      HUD_FRAME_KEY,
      HUD_BAR_KEY,
      AMMO_MODULE_KEY,
      MENU_PANEL_KEY,
      MENU_BUTTON_KEY,
      MENU_BUTTON_HOVER_KEY,
    ]) {
      expect(key.startsWith("ui.")).toBe(true);
    }
  });

  it("the HUD frame and menu panel share the panel tile", () => {
    expect(HUD_FRAME_KEY).toBe("ui.panel");
    expect(MENU_PANEL_KEY).toBe("ui.panel");
    expect(hudFrameKeyFor()).toBe("ui.panel");
  });

  it("the hover key differs from the resting button key", () => {
    expect(MENU_BUTTON_KEY).toBe("ui.button");
    expect(MENU_BUTTON_HOVER_KEY).toBe("ui.button.hover");
    expect(menuButtonKeyFor(false)).toBe(MENU_BUTTON_KEY);
    expect(menuButtonKeyFor(true)).toBe(MENU_BUTTON_HOVER_KEY);
    expect(menuButtonKeyFor(null)).toBe(MENU_BUTTON_KEY);
  });
});

describe("buildHudSnapshot", () => {
  it("yields health/ammo digits plus the `ui.` frame key for 75/12", () => {
    const snapshot = buildHudSnapshot(75, 12);
    expect(snapshot.healthText).toBe("75");
    expect(snapshot.ammoText).toBe("12");
    expect(snapshot.hudFrameKey).toContain("ui.");
  });

  it("ceils fractional HP and clamps the mag at 0", () => {
    expect(buildHudSnapshot(74.2, 3.9).healthText).toBe("75");
    expect(buildHudSnapshot(74.2, 3.9).ammoText).toBe("3");
    expect(buildHudSnapshot(100, -2).ammoText).toBe("0");
    expect(buildHudSnapshot("75", "12")).toMatchObject({
      healthText: "75",
      ammoText: "12",
    });
  });

  it("renders non-finite readings as 0 instead of blanking", () => {
    expect(buildHudSnapshot(NaN, null)).toMatchObject({
      healthText: "0",
      ammoText: "0",
    });
  });
});

describe("chrome files", () => {
  it("maps each key to its committed tile file", () => {
    expect(chromeFileFor(HUD_FRAME_KEY)).toBe("ui/tile_0000.png");
    expect(chromeFileFor(MENU_BUTTON_KEY)).toBe("ui/tile_0001.png");
    expect(chromeFileFor(MENU_BUTTON_HOVER_KEY)).toBe("ui/tile_0002.png");
    expect(chromeFileFor(AMMO_MODULE_KEY)).toBe("ui/tile_0003.png");
    expect(chromeFileFor(HUD_BAR_KEY)).toBe("ui/tile_0004.png");
    expect(chromeFileFor("ui.nope")).toBe(null);
    expect(chromeFileFor(null)).toBe(null);
  });

  it("builds client-root-relative atlas URLs for the staged files", () => {
    expect(chromeBackgroundFor(HUD_FRAME_KEY)).toBe(
      'url("./assets/atlas/ui/tile_0000.png")',
    );
    expect(chromeBackgroundFor("ui.nope")).toBe(null);
  });

  it("every mapped file exists on disk", () => {
    const assets = path.resolve(HERE, "..", "assets", "atlas");
    for (const file of Object.values(CHROME_FILES)) {
      expect(fs.existsSync(path.join(assets, file))).toBe(true);
    }
  });

  it("the file map equals the manifest `ui.*` entries", () => {
    const manifest = JSON.parse(
      fs.readFileSync(MANIFEST_PATH, "utf8"),
    ) as Record<string, { file?: unknown }>;
    for (const [key, file] of Object.entries(CHROME_FILES)) {
      expect(manifest[key]?.file).toBe(file);
    }
  });
});

describe("stampChrome", () => {
  it("stamps data-frame plus the pixelated tile background", () => {
    const el = makeEl("div");
    stampChrome(el, HUD_FRAME_KEY);
    expect(el.getAttribute("data-frame")).toBe("ui.panel");
    expect(el.style["backgroundImage"]).toBe(
      'url("./assets/atlas/ui/tile_0000.png")',
    );
    expect(el.style["imageRendering"]).toBe("pixelated");
  });

  it("ignores unknown keys and hostile handles", () => {
    const el = makeEl("div");
    stampChrome(el, "ui.nope");
    expect(el.getAttribute("data-frame")).toBe(null);
    expect(() => stampChrome(null, HUD_FRAME_KEY)).not.toThrow();
    expect(() => stampChrome(undefined, HUD_FRAME_KEY)).not.toThrow();
  });
});

describe("applyHudChrome", () => {
  it("stamps the HUD frame plus the ammo module tiles", () => {
    const hud = makeEl("div");
    const ammoModule = makeEl("div");
    applyHudChrome({ hud, ammoModule });
    expect(hud.getAttribute("data-frame")).toBe("ui.panel");
    expect(hud.style["backgroundImage"]).toBe(
      'url("./assets/atlas/ui/tile_0000.png")',
    );
    expect(ammoModule.getAttribute("data-frame")).toBe("ui.slot");
    expect(ammoModule.style["backgroundImage"]).toBe(
      'url("./assets/atlas/ui/tile_0003.png")',
    );
  });

  it("no-ops on null handles", () => {
    expect(() => applyHudChrome(null)).not.toThrow();
    expect(() => applyHudChrome(undefined)).not.toThrow();
    expect(() =>
      applyHudChrome({ hud: null, ammoModule: null }),
    ).not.toThrow();
  });
});

describe("bindMenuChrome", () => {
  it("stamps panels and buttons with their tiles", () => {
    const button = makeEl("button");
    const doc = makeDoc(
      ["menu", "setup", "settings", "howto", "end-screen", "quick-play"],
      [button],
    );
    bindMenuChrome(doc as unknown as Document);
    for (const id of ["menu", "setup", "settings", "howto", "end-screen"]) {
      expect(doc.byId.get(id)?.getAttribute("data-frame")).toBe("ui.panel");
    }
    expect(doc.byId.get("quick-play")?.getAttribute("data-frame")).toBe(
      "ui.button",
    );
    expect(button.getAttribute("data-frame")).toBe("ui.button");
  });

  it("swaps the button tile on hover and restores it on leave", () => {
    resetChromeHover();
    const button = makeEl("button");
    const doc = makeDoc(["menu"], [button]);
    bindMenuChrome(doc as unknown as Document);
    expect(buildMenuSnapshot().buttonFrameKey).toBe("ui.button");
    button.fire("mouseenter");
    expect(button.getAttribute("data-frame")).toBe("ui.button.hover");
    expect(buildMenuSnapshot().buttonFrameKey).toBe("ui.button.hover");
    expect(buildMenuSnapshot().panelFrameKey).toBe("ui.panel");
    button.fire("mouseleave");
    expect(button.getAttribute("data-frame")).toBe("ui.button");
    expect(buildMenuSnapshot().buttonFrameKey).toBe("ui.button");
    resetChromeHover();
  });

  it("tracks focus/blur the same as hover", () => {
    resetChromeHover();
    const button = makeEl("button");
    const doc = makeDoc(["menu"], [button]);
    bindMenuChrome(doc as unknown as Document);
    button.fire("focus");
    expect(buildMenuSnapshot().buttonFrameKey).toBe("ui.button.hover");
    button.fire("blur");
    expect(buildMenuSnapshot().buttonFrameKey).toBe("ui.button");
    resetChromeHover();
  });

  it("no-ops on builder-less docs", () => {
    resetChromeHover();
    expect(() => bindMenuChrome(null)).not.toThrow();
    expect(() => bindMenuChrome(undefined)).not.toThrow();
    expect(() => bindMenuChrome({})).not.toThrow();
    resetChromeHover();
  });
});
