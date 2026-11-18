// UI pixel-pack chrome (issue #270): shared `ui.*` frame keys, asset
// files, pure selectors/snapshots, and DOM binders for the HUD frame and
// menu chrome. Pure helpers stay DOM-free and unit-testable under node
// (the feed.ts lookup/model idiom); the binders degrade to no-ops on
// fake docs without builders and never throw (the pushFeed binder
// idiom). Bitmap HUD digits stay owned by ui/fonts.ts — this module
// only stamps pixel-panel backgrounds and `data-frame` probe keys.

/**
 * Manifest key prefix for the ui-pack-pixel-adventure family. Built
 * with concatenation (never a quoted dotted literal) so the
 * tools/build-atlas.js reference scanner never couples to the keys,
 * mirroring the WEAPON_PREFIX idiom in render/weapons.ts.
 */
export const UI_PREFIX = "ui" + ".";

/** HUD outer frame key (the 16px pixel panel tile). */
export const HUD_FRAME_KEY = UI_PREFIX + "panel";
/** HUD fuel-bar fill key (the 16px bar tile). */
export const HUD_BAR_KEY = UI_PREFIX + "bar";
/** Bottom-right ammo module key (the 16px slot tile). */
export const AMMO_MODULE_KEY = UI_PREFIX + "slot";
/** Menu overlay/panel key (same pixel panel as the HUD frame). */
export const MENU_PANEL_KEY = UI_PREFIX + "panel";
/** Menu/setup button resting key. */
export const MENU_BUTTON_KEY = UI_PREFIX + "button";
/** Menu/setup button hover/pressed key. */
export const MENU_BUTTON_HOVER_KEY = UI_PREFIX + "button" + "." + "hover";

/**
 * Committed tile file per chrome key, relative to the atlas dir
 * (mirrors the `file` fields of the `ui.*` entries in
 * assets/atlas/manifest.json; the chrome sync test pins them equal).
 */
export const CHROME_FILES: Record<string, string> = {
  [HUD_FRAME_KEY]: "ui/tile_0000.png",
  [MENU_BUTTON_KEY]: "ui/tile_0001.png",
  [MENU_BUTTON_HOVER_KEY]: "ui/tile_0002.png",
  [AMMO_MODULE_KEY]: "ui/tile_0003.png",
  [HUD_BAR_KEY]: "ui/tile_0004.png",
};

/** Tile file for a chrome key (null for unknown keys). Pure. */
export function chromeFileFor(key: unknown): string | null {
  if (typeof key !== "string") {
    return null;
  }
  if (!Object.hasOwn(CHROME_FILES, key)) {
    return null;
  }
  return CHROME_FILES[key] as string;
}

/**
 * CSS background value for a chrome key: client-root-relative so
 * file:// and subpath hosts resolve (the iconFor asset URL idiom).
 * Null for unknown keys. Pure.
 */
export function chromeBackgroundFor(key: unknown): string | null {
  const file = chromeFileFor(key);
  if (file === null) {
    return null;
  }
  return `url("./assets/atlas/${file}")`;
}

/** HUD frame key selector (pure; the probe reads it via the snapshot). */
export function hudFrameKeyFor(): string {
  return HUD_FRAME_KEY;
}

/**
 * Menu button key selector: the hover tile while hovered or focused,
 * the resting tile otherwise. Pure.
 */
export function menuButtonKeyFor(hovered: unknown): string {
  return hovered === true ? MENU_BUTTON_HOVER_KEY : MENU_BUTTON_KEY;
}

/** Live HUD chrome values the snapshot exposes to probes. */
export interface HudChromeSnapshot {
  /** Ceiled HP digits (`"75"`, mag-only like the legacy bitmap write). */
  healthText: string;
  /** Clamped mag digits (`"12"`, never the `12/96` display shape). */
  ammoText: string;
  /** HUD pixel frame key (always carries the `ui.` prefix). */
  hudFrameKey: string;
}

/**
 * Build the HUD snapshot: HP ceils (matching the setBitmapText write),
 * mag clamps at 0 (the formatAmmoCounts idiom); non-finite readings
 * render 0 so half-built snapshots never blank. Pure.
 */
export function buildHudSnapshot(hp: unknown, magAmmo: unknown): HudChromeSnapshot {
  const hpNum = Number(hp);
  const healthText = String(
    Number.isFinite(hpNum) ? Math.max(0, Math.ceil(hpNum)) : 0,
  );
  const magNum = Number(magAmmo);
  const ammoText = String(
    Number.isFinite(magNum) ? Math.max(0, Math.floor(magNum)) : 0,
  );
  return { healthText, ammoText, hudFrameKey: hudFrameKeyFor() };
}

/** Live menu chrome values the snapshot exposes to probes. */
export interface MenuChromeSnapshot {
  /** Menu panel pixel frame key (always carries the `ui.` prefix). */
  panelFrameKey: string;
  /** Menu button pixel frame key (hover tile while any button hovers). */
  buttonFrameKey: string;
}

/** Buttons currently hovered/focused (the snapshot hover source). */
const hoveredButtons = new Set<unknown>();

/** Test seam: drop all hover tracking (unit-test isolation only). */
export function resetChromeHover(): void {
  hoveredButtons.clear();
}

/** Build the menu snapshot: the hover tile while any button hovers. Pure. */
export function buildMenuSnapshot(): MenuChromeSnapshot {
  return {
    panelFrameKey: MENU_PANEL_KEY,
    buttonFrameKey: menuButtonKeyFor(hoveredButtons.size > 0),
  };
}

/** Read a string attribute without throwing on hostile shims. */
function readFrameAttr(el: {
  getAttribute?: unknown;
}): string | null {
  try {
    if (typeof el.getAttribute === "function") {
      const value = (el.getAttribute as (name: string) => unknown).call(
        el,
        "data-frame",
      );
      return typeof value === "string" ? value : null;
    }
  } catch {
    // Attribute-less fakes: the style write below still lands.
  }
  return null;
}

/**
 * Stamp one element with a chrome key: `data-frame` plus the pixel
 * tile background (`image-rendering: pixelated` so the 16px tiles stay
 * crisp at any camera/browser zoom). Change-guarded so the 20 Hz HUD
 * mirror stays cheap; null-safe and never throws.
 */
export function stampChrome(el: unknown, key: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  if (chromeFileFor(key) === null) {
    return;
  }
  const target = el as {
    setAttribute?: unknown;
    getAttribute?: unknown;
    style?: unknown;
  };
  if (readFrameAttr(target) !== key) {
    try {
      if (typeof target.setAttribute === "function") {
        (target.setAttribute as (name: string, value: string) => void).call(
          target,
          "data-frame",
          key,
        );
      }
    } catch {
      // Read-only shims: the style writes below still land.
    }
  }
  const background = chromeBackgroundFor(key);
  try {
    const style = target.style;
    if (typeof style === "object" && style !== null) {
      const bag = style as Record<string, unknown>;
      if (bag["backgroundImage"] !== background) {
        bag["backgroundImage"] = background;
      }
      if (bag["imageRendering"] !== "pixelated") {
        bag["imageRendering"] = "pixelated";
      }
    }
  } catch {
    // Style-less fakes: the data-frame above still carries the key.
  }
}

/** Element handles owned by the HUD chrome; nulls make updates no-op. */
export interface HudChromeHandles {
  hud: unknown;
  ammoModule: unknown;
}

/**
 * Stamp the HUD frame plus the ammo module with their pixel tiles.
 * Change-guarded per element so the every-frame mirror stays cheap;
 * null-safe and never throws.
 */
export function applyHudChrome(
  handles: HudChromeHandles | null | undefined,
): void {
  if (handles === null || handles === undefined) {
    return;
  }
  try {
    stampChrome(handles.hud, HUD_FRAME_KEY);
  } catch {
    // Hostile shims: the module stamp below still lands.
  }
  try {
    stampChrome(handles.ammoModule, AMMO_MODULE_KEY);
  } catch {
    // Hostile shims: the frame stamp above already landed.
  }
}

/** Panel ids stamped with the menu panel tile on boot. */
const MENU_PANEL_IDS: readonly string[] = [
  "menu",
  "setup",
  "settings",
  "howto",
  "end-screen",
];

/** Known menu/setup buttons for docs without querySelectorAll. */
const MENU_BUTTON_IDS: readonly string[] = [
  "quick-play",
  "play-online",
  "play",
  "settings-open",
  "howto-open",
  "challenges-open",
  "locker-open",
  "btn-start",
  "settings-close",
  "howto-close",
  "btn-fullscreen",
  "btn-quality",
  "btn-nametags",
  "restart",
  "end-menu",
  "bots-minus",
  "bots-plus",
];

/** Minimal listener surface (the setup.ts asClickable idiom). */
interface Hoverable {
  addEventListener(type: string, listener: () => void): void;
}

/** Narrow an unknown handle to the listener surface; else null. */
function asHoverable(el: unknown): Hoverable | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as { addEventListener?: unknown };
  if (typeof candidate.addEventListener !== "function") {
    return null;
  }
  return candidate as Hoverable;
}

/** True once the chrome binder owns the element (listeners attach once). */
function isBound(el: unknown): boolean {
  if (typeof el !== "object" || el === null) {
    return false;
  }
  try {
    const get = (el as { getAttribute?: unknown }).getAttribute;
    if (typeof get === "function") {
      return (
        (get as (name: string) => unknown).call(el, "data-chrome-bound") ===
        "true"
      );
    }
  } catch {
    return false;
  }
  return false;
}

/** Mark the element binder-owned (best-effort, never throws). */
function markBound(el: unknown): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  try {
    const set = (el as { setAttribute?: unknown }).setAttribute;
    if (typeof set === "function") {
      (set as (name: string, value: string) => void).call(
        el,
        "data-chrome-bound",
        "true",
      );
    }
  } catch {
    // Attribute-less fakes: double-binding just re-stamps the same key.
  }
}

/**
 * Wire one menu button: resting tile now, hover tile on
 * `mouseenter`/`focus`, resting tile back on `mouseleave`/`blur`.
 * Synchronous swaps land far inside the 200ms probe budget. The
 * module hover set drives buildMenuSnapshot; listeners attach once
 * per element. Never throws.
 */
function bindButton(button: unknown): void {
  if (button === null || button === undefined) {
    return;
  }
  try {
    stampChrome(button, MENU_BUTTON_KEY);
  } catch {
    // Unstampable shims: listeners still attach below.
  }
  if (isBound(button)) {
    return;
  }
  const hoverable = asHoverable(button);
  if (hoverable === null) {
    return;
  }
  markBound(button);
  const enter = (): void => {
    try {
      if (!hoveredButtons.has(button)) {
        hoveredButtons.add(button);
      }
      stampChrome(button, MENU_BUTTON_HOVER_KEY);
    } catch {
      // Hover paint best-effort: the snapshot set above already landed.
    }
  };
  const leave = (): void => {
    try {
      hoveredButtons.delete(button);
      stampChrome(button, MENU_BUTTON_KEY);
    } catch {
      // Resting paint best-effort: the snapshot set above already landed.
    }
  };
  try {
    hoverable.addEventListener("mouseenter", enter);
  } catch {
    // Listener-less fakes: the resting tile above still shows.
  }
  try {
    hoverable.addEventListener("mouseleave", leave);
  } catch {
    // Listener-less fakes: the resting tile above still shows.
  }
  try {
    hoverable.addEventListener("focus", enter);
  } catch {
    // Listener-less fakes: mouse hover still swaps.
  }
  try {
    hoverable.addEventListener("blur", leave);
  } catch {
    // Listener-less fakes: mouse leave still restores.
  }
}

/** Overlay roots that stay unstamped: full-screen scrims never tile. */
const FULLSCREEN_PANEL_IDS: ReadonlySet<string> = new Set(MENU_PANEL_IDS);

/** Inner `.sl-panel` card of an overlay root; null when absent. */
function panelChild(el: unknown): unknown {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  try {
    const query = (el as { querySelector?: unknown }).querySelector;
    if (typeof query !== "function") {
      return null;
    }
    const child = (query as (sel: string) => unknown).call(el, ".sl-panel");
    return child ?? null;
  } catch {
    return null;
  }
}

/**
 * Stamp every menu panel plus all menu/setup buttons with their pixel
 * tiles and wire the hover swaps. Missing builders, throwing lookups,
 * and listener-less shims are no-ops; never throws.
 */
export function bindMenuChrome(doc: unknown): void {
  if (typeof doc !== "object" || doc === null) {
    return;
  }
  const api = doc as {
    getElementById?: unknown;
    querySelectorAll?: unknown;
  };
  const lookup =
    typeof api.getElementById === "function"
      ? (api.getElementById as (id: string) => unknown).bind(doc)
      : null;
  if (lookup !== null) {
    for (const id of MENU_PANEL_IDS) {
      try {
        // Full-screen overlay roots never carry the tile themselves:
        // the 16px panel stamps the constrained inner `.sl-panel`
        // card, and roots without one stay unstamped (issue #313).
        const root = lookup(id);
        const inner = panelChild(root);
        if (inner !== null) {
          stampChrome(inner, MENU_PANEL_KEY);
        } else if (!FULLSCREEN_PANEL_IDS.has(id)) {
          stampChrome(root, MENU_PANEL_KEY);
        }
      } catch {
        // Unstampable panels: the remaining panels still land.
      }
    }
    for (const id of MENU_BUTTON_IDS) {
      try {
        bindButton(lookup(id));
      } catch {
        // Missing buttons: the remaining buttons still bind.
      }
    }
  }
  try {
    if (typeof api.querySelectorAll === "function") {
      const found = (
        api.querySelectorAll as (sel: string) => unknown
      ).call(doc, "button");
      const list = found as { length?: unknown; [index: number]: unknown };
      const length = typeof list?.length === "number" ? list.length : 0;
      for (let i = 0; i < length; i += 1) {
        try {
          bindButton(list[i]);
        } catch {
          // Unbindable buttons: the remaining buttons still bind.
        }
      }
    }
  } catch {
    // Query-less docs: the known-id pass above still bound the menu.
  }
}
