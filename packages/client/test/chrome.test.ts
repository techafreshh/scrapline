// Sliced chrome tests (issues #270, #347): `ui.*` key prefixes, pure
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
  BAR_FILL_KEY,
  BAR_TRACK_KEY,
  bindMenuChrome,
  BRACKET_KEY,
  buildHudSnapshot,
  buildMenuSnapshot,
  BUTTON_CTA_KEY,
  BUTTON_DANGER_KEY,
  BUTTON_DISABLED_KEY,
  BUTTON_FOCUS_KEY,
  BUTTON_ICON_KEY,
  BUTTON_PRESSED_KEY,
  BUTTON_SECONDARY_KEY,
  CHECKBOX_CHECKED_KEY,
  CHECKBOX_HOVER_KEY,
  CHECKBOX_KEY,
  CHIP_KEY,
  CHROME_FILES,
  chromeBackgroundFor,
  chromeFileFor,
  clearChrome,
  DIVIDER_KEY,
  FIELD_KEY,
  FIELD_SELECT_KEY,
  HEADER_KEY,
  HUD_BAR_KEY,
  HUD_FRAME_KEY,
  hudFrameKeyFor,
  KEYCAP_KEY,
  MENU_BUTTON_HOVER_KEY,
  MENU_BUTTON_KEY,
  MENU_PANEL_KEY,
  menuButtonKeyFor,
  PANEL_BANNER_KEY,
  PANEL_ELEVATED_KEY,
  PANEL_HAZARD_KEY,
  PANEL_INSET_KEY,
  resetChromeHover,
  ROW_HOVER_KEY,
  ROW_KEY,
  ROW_SELECTED_KEY,
  SCROLLBAR_KEY,
  SLIDER_THUMB_KEY,
  SLIDER_TRACK_KEY,
  stampChrome,
  stampFrame,
  TOAST_KEY,
  TOGGLE_OFF_KEY,
  TOGGLE_ON_KEY,
  TOOLTIP_KEY,
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
  classes: string[];
  style: Record<string, string>;
  listeners: Map<string, Array<() => void>>;
  children: FakeEl[];
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  addEventListener(type: string, listener: () => void): void;
  querySelector(sel: string): FakeEl | null;
  appendChild(child: FakeEl): void;
  fire(type: string): void;
}

function makeEl(tag: string): FakeEl {
  const el: FakeEl = {
    tag,
    attrs: new Map<string, string>(),
    classes: [],
    style: {},
    listeners: new Map<string, Array<() => void>>(),
    children: [],
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
    },
    getAttribute: (k: string): string | null => el.attrs.get(k) ?? null,
    removeAttribute: (k: string): void => {
      el.attrs.delete(k);
    },
    addEventListener: (type: string, listener: () => void): void => {
      const list = el.listeners.get(type) ?? [];
      list.push(listener);
      el.listeners.set(type, list);
    },
    querySelector: (sel: string): FakeEl | null => {
      if (sel === ".sl-panel") {
        return el.children.find((c) => c.classes.includes("sl-panel")) ?? null;
      }
      return null;
    },
    appendChild: (child: FakeEl): void => {
      el.children.push(child);
    },
    fire: (type: string): void => {
      for (const listener of el.listeners.get(type) ?? []) {
        listener();
      }
    },
  };
  return el;
}

/** Overlay roots stamped by the menu chrome (full-screen scrims). */
const PANEL_IDS = ["menu", "setup", "settings", "howto", "end-screen"];

/** Fake overlay root with a constrained inner `.sl-panel` card. */
function makePanelRoot(): FakeEl {
  const root = makeEl("div");
  const card = makeEl("div");
  card.classes.push("sl-panel");
  root.appendChild(card);
  return root;
}

/** Minimal fake document with id lookup plus button queries. */
interface FakeDoc {
  byId: Map<string, FakeEl>;
  buttons: FakeEl[];
  getElementById(id: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
}

function makeDoc(
  ids: string[],
  buttons: FakeEl[] = [],
  panels = true,
): FakeDoc {
  const byId = new Map<string, FakeEl>();
  for (const id of ids) {
    // Overlay roots carry a constrained inner `.sl-panel` card like the
    // real index.html markup, so the tile lands on the card (issue #313).
    byId.set(id, panels && PANEL_IDS.includes(id) ? makePanelRoot() : makeEl("div"));
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

  it("every mapped chrome key carries the `ui.` prefix", () => {
    for (const key of Object.keys(CHROME_FILES)) {
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
  it("maps each legacy key to its sliced chrome file", () => {
    expect(chromeFileFor(HUD_FRAME_KEY)).toBe("ui/panel.png");
    expect(chromeFileFor(MENU_BUTTON_KEY)).toBe("ui/button.png");
    expect(chromeFileFor(MENU_BUTTON_HOVER_KEY)).toBe("ui/button.hover.png");
    expect(chromeFileFor(AMMO_MODULE_KEY)).toBe("ui/panel.inset.png");
    expect(chromeFileFor(HUD_BAR_KEY)).toBe("ui/bar.fill.png");
    expect(chromeFileFor("ui.nope")).toBe(null);
    expect(chromeFileFor(null)).toBe(null);
  });

  it("maps every required control piece to its sliced file", () => {
    expect(chromeFileFor(PANEL_ELEVATED_KEY)).toBe("ui/panel.elevated.png");
    expect(chromeFileFor(PANEL_INSET_KEY)).toBe("ui/panel.inset.png");
    expect(chromeFileFor(PANEL_HAZARD_KEY)).toBe("ui/panel.hazard.png");
    expect(chromeFileFor(PANEL_BANNER_KEY)).toBe("ui/panel.banner.png");
    expect(chromeFileFor(BUTTON_PRESSED_KEY)).toBe("ui/button.pressed.png");
    expect(chromeFileFor(BUTTON_DISABLED_KEY)).toBe("ui/button.disabled.png");
    expect(chromeFileFor(BUTTON_FOCUS_KEY)).toBe("ui/button.focus.png");
    expect(chromeFileFor(BUTTON_DANGER_KEY)).toBe("ui/button.danger.png");
    expect(chromeFileFor(BUTTON_CTA_KEY)).toBe("ui/button.cta.png");
    expect(chromeFileFor(BUTTON_SECONDARY_KEY)).toBe("ui/button.secondary.png");
    expect(chromeFileFor(BUTTON_ICON_KEY)).toBe("ui/button.icon.png");
    expect(chromeFileFor(CHIP_KEY)).toBe("ui/chip.png");
    expect(chromeFileFor(BAR_TRACK_KEY)).toBe("ui/bar.track.png");
    expect(chromeFileFor(BAR_FILL_KEY)).toBe("ui/bar.fill.png");
    expect(chromeFileFor(SLIDER_TRACK_KEY)).toBe("ui/slider.track.png");
    expect(chromeFileFor(SLIDER_THUMB_KEY)).toBe("ui/slider.thumb.png");
    expect(chromeFileFor(TOGGLE_OFF_KEY)).toBe("ui/toggle.off.png");
    expect(chromeFileFor(TOGGLE_ON_KEY)).toBe("ui/toggle.on.png");
    expect(chromeFileFor(CHECKBOX_KEY)).toBe("ui/checkbox.png");
    expect(chromeFileFor(CHECKBOX_HOVER_KEY)).toBe("ui/checkbox.hover.png");
    expect(chromeFileFor(CHECKBOX_CHECKED_KEY)).toBe("ui/checkbox.checked.png");
    expect(chromeFileFor(FIELD_KEY)).toBe("ui/field.png");
    expect(chromeFileFor(FIELD_SELECT_KEY)).toBe("ui/field.select.png");
    expect(chromeFileFor(SCROLLBAR_KEY)).toBe("ui/scrollbar.png");
    expect(chromeFileFor(ROW_KEY)).toBe("ui/row.png");
    expect(chromeFileFor(ROW_HOVER_KEY)).toBe("ui/row.hover.png");
    expect(chromeFileFor(ROW_SELECTED_KEY)).toBe("ui/row.selected.png");
    expect(chromeFileFor(TOOLTIP_KEY)).toBe("ui/tooltip.png");
    expect(chromeFileFor(TOAST_KEY)).toBe("ui/toast.png");
    expect(chromeFileFor(KEYCAP_KEY)).toBe("ui/keycap.png");
    expect(chromeFileFor(DIVIDER_KEY)).toBe("ui/divider.png");
    expect(chromeFileFor(BRACKET_KEY)).toBe("ui/bracket.png");
    expect(chromeFileFor(HEADER_KEY)).toBe("ui/header.png");
  });

  it("no mapped file falls back to the stretched 16x16 tiles", () => {
    for (const file of Object.values(CHROME_FILES)) {
      expect(file.startsWith("ui/tile_")).toBe(false);
    }
  });

  it("idle and hover art share one box so states never shift layout", () => {
    const manifest = JSON.parse(
      fs.readFileSync(MANIFEST_PATH, "utf8"),
    ) as Record<string, { w?: unknown; h?: unknown }>;
    for (const [idle, hover] of [
      [MENU_BUTTON_KEY, MENU_BUTTON_HOVER_KEY],
      [ROW_KEY, ROW_HOVER_KEY],
      [ROW_KEY, ROW_SELECTED_KEY],
      [CHECKBOX_KEY, CHECKBOX_HOVER_KEY],
      [TOGGLE_OFF_KEY, TOGGLE_ON_KEY],
    ] as const) {
      expect(manifest[idle]?.w).toBe(manifest[hover]?.w);
      expect(manifest[idle]?.h).toBe(manifest[hover]?.h);
    }
  });

  it("builds client-root-relative atlas URLs for the staged files", () => {
    expect(chromeBackgroundFor(HUD_FRAME_KEY)).toBe(
      'url("./assets/atlas/ui/panel.png")',
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
  it("stamps data-frame plus a single-plate pixelated background", () => {
    const el = makeEl("div");
    stampChrome(el, HUD_FRAME_KEY);
    expect(el.getAttribute("data-frame")).toBe("ui.panel");
    expect(el.style["backgroundImage"]).toBe(
      'url("./assets/atlas/ui/panel.png")',
    );
    expect(el.style["imageRendering"]).toBe("pixelated");
  });

  it("never tiles the plate across a wide container (issue #359)", () => {
    const el = makeEl("div");
    stampChrome(el, HUD_FRAME_KEY);
    expect(el.style["backgroundRepeat"]).toBe("no-repeat");
    expect(el.style["backgroundSize"]).toBe("100% 100%");
    expect(el.style["backgroundPosition"]).toBe("center");
  });

  it("ignores unknown keys and hostile handles", () => {
    const el = makeEl("div");
    stampChrome(el, "ui.nope");
    expect(el.getAttribute("data-frame")).toBe(null);
    expect(() => stampChrome(null, HUD_FRAME_KEY)).not.toThrow();
    expect(() => stampChrome(undefined, HUD_FRAME_KEY)).not.toThrow();
  });
});

describe("stampFrame/clearChrome", () => {
  it("stamps the probe key with no inline plate (single CSS frame)", () => {
    const el = makeEl("button");
    stampFrame(el, MENU_BUTTON_KEY);
    expect(el.getAttribute("data-frame")).toBe("ui.button");
    expect(el.style["backgroundImage"] ?? "none").toBe("none");
  });

  it("clears stale plates so containers read background-image none", () => {
    const el = makeEl("div");
    stampChrome(el, HUD_FRAME_KEY);
    expect(el.style["backgroundImage"]).not.toBe("none");
    clearChrome(el);
    expect(el.getAttribute("data-frame")).toBe(null);
    expect(el.style["backgroundImage"]).toBe("none");
  });

  it("ignores unknown keys and hostile handles", () => {
    const el = makeEl("div");
    stampFrame(el, "ui.nope");
    expect(el.getAttribute("data-frame")).toBe(null);
    expect(() => stampFrame(null, MENU_BUTTON_KEY)).not.toThrow();
    expect(() => clearChrome(null)).not.toThrow();
    expect(() => clearChrome(undefined)).not.toThrow();
  });
});

describe("applyHudChrome", () => {
  it("stamps one plate per cluster and clears the wide container", () => {
    const hud = makeEl("div");
    const status = makeEl("div");
    const center = makeEl("div");
    const killfeed = makeEl("div");
    const ammoModule = makeEl("div");
    applyHudChrome({ hud, status, center, killfeed, ammoModule });
    // The full-width container never carries art (issue #359).
    expect(hud.getAttribute("data-frame")).toBe(null);
    expect(hud.style["backgroundImage"]).toBe("none");
    for (const module of [status, center, killfeed]) {
      expect(module.getAttribute("data-frame")).toBe("ui.panel");
      expect(module.style["backgroundImage"]).toBe(
        'url("./assets/atlas/ui/panel.png")',
      );
      expect(module.style["backgroundRepeat"]).toBe("no-repeat");
    }
    expect(ammoModule.getAttribute("data-frame")).toBe("ui.slot");
    expect(ammoModule.style["backgroundImage"]).toBe(
      'url("./assets/atlas/ui/panel.inset.png")',
    );
    expect(ammoModule.style["backgroundRepeat"]).toBe("no-repeat");
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
  it("stamps inner cards with the panel tile, never the fullscreen root", () => {
    const button = makeEl("button");
    const doc = makeDoc(
      ["menu", "setup", "settings", "howto", "end-screen", "quick-play"],
      [button],
    );
    bindMenuChrome(doc as unknown as Document);
    for (const id of PANEL_IDS) {
      const root = doc.byId.get(id);
      expect(root?.getAttribute("data-frame")).toBe(null);
      expect(root?.style["backgroundImage"]).toBe(undefined);
      // Panels ride the CSS 9-slice frame: only the probe key is
      // stamped, never an inline plate that could double it (#359).
      const card = root?.querySelector(".sl-panel");
      expect(card?.getAttribute("data-frame")).toBe("ui.panel");
      expect(card?.style["backgroundImage"] ?? "none").toBe("none");
    }
    expect(doc.byId.get("quick-play")?.getAttribute("data-frame")).toBe(
      "ui.button",
    );
    expect(button.getAttribute("data-frame")).toBe("ui.button");
    // Buttons ride the CSS 9-slice frame: no inline plate (issue #359).
    expect(button.style["backgroundImage"] ?? "none").toBe("none");
  });

  it("leaves roots without an inner card unstamped", () => {
    const doc = makeDoc(
      ["menu", "setup", "settings", "howto", "end-screen"],
      [],
      false,
    );
    bindMenuChrome(doc as unknown as Document);
    for (const id of PANEL_IDS) {
      const root = doc.byId.get(id);
      expect(root?.getAttribute("data-frame")).toBe(null);
      expect(root?.style["backgroundImage"]).toBe(undefined);
    }
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
