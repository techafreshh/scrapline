// UI sliced chrome (issues #270, #347): shared `ui.*` frame keys, asset
// files, pure selectors/snapshots, and DOM binders for the HUD frame and
// menu chrome. Act A2 replaced the five stretched 16x16 tiles with
// properly sliced SH-01a/CH art (tools/slice-chrome.js); the five legacy
// key names stay so snapshots and binders keep working, only the files
// (and the added control keys below) changed. Pure helpers stay DOM-free
// and unit-testable under node (the feed.ts lookup/model idiom); the
// binders degrade to no-ops on fake docs without builders and never
// throw (the pushFeed binder idiom). Bitmap HUD digits stay owned by
// ui/fonts.ts — this module only stamps pixel-panel backgrounds and
// `data-frame` probe keys.

/**
 * Manifest key prefix for the ui-pack-pixel-adventure family. Built
 * with concatenation (never a quoted dotted literal) so the
 * tools/build-atlas.js reference scanner never couples to the keys,
 * mirroring the WEAPON_PREFIX idiom in render/weapons.ts.
 */
export const UI_PREFIX = "ui" + ".";

/** HUD outer frame key (the sliced CH-01 panel plate). */
export const HUD_FRAME_KEY = UI_PREFIX + "panel";
/** HUD fuel-bar fill key (the sliced CH-08 fill block). */
export const HUD_BAR_KEY = UI_PREFIX + "bar";
/** Bottom-right ammo module key (the sliced inset well). */
export const AMMO_MODULE_KEY = UI_PREFIX + "slot";
/** Menu overlay/panel key (same sliced panel as the HUD frame). */
export const MENU_PANEL_KEY = UI_PREFIX + "panel";
/** Menu/setup button resting key (SH-04 idle cell). */
export const MENU_BUTTON_KEY = UI_PREFIX + "button";
/** Menu/setup button hover key (SH-04 hover cell, same silhouette). */
export const MENU_BUTTON_HOVER_KEY = UI_PREFIX + "button" + "." + "hover";
/** Elevated panel variant key (CH-02 cell, modals over the menu). */
export const PANEL_ELEVATED_KEY = UI_PREFIX + "panel" + "." + "elevated";
/** Inset well key (CH-02 cell, standings/locker recess). */
export const PANEL_INSET_KEY = UI_PREFIX + "panel" + "." + "inset";
/** Hazard panel key (CH-02 cell, end-screen/death header bands). */
export const PANEL_HAZARD_KEY = UI_PREFIX + "panel" + "." + "hazard";
/** Wide banner panel key (CH-03 large plate, hero rows). */
export const PANEL_BANNER_KEY = UI_PREFIX + "panel" + "." + "banner";
/** Button pressed key (SH-04 cell, inverted bevel, same box). */
export const BUTTON_PRESSED_KEY = UI_PREFIX + "button" + "." + "pressed";
/** Button disabled key (SH-04 cell, desaturated, same box). */
export const BUTTON_DISABLED_KEY = UI_PREFIX + "button" + "." + "disabled";
/** Button focus key (SH-04 cell, pale rim, same box). */
export const BUTTON_FOCUS_KEY = UI_PREFIX + "button" + "." + "focus";
/** Button danger key (SH-04 cell, destructive actions). */
export const BUTTON_DANGER_KEY = UI_PREFIX + "button" + "." + "danger";
/** Primary CTA key (CH-04 dithered cyan-glass plate). */
export const BUTTON_CTA_KEY = UI_PREFIX + "button" + "." + "cta";
/** Secondary button key (CH-06 recessed row plate). */
export const BUTTON_SECONDARY_KEY = UI_PREFIX + "button" + "." + "secondary";
/** Icon button frame key (CH-05 square plate, glyphs separate). */
export const BUTTON_ICON_KEY = UI_PREFIX + "button" + "." + "icon";
/** Chip/badge key (CH-07 pill, accent nub tints in CSS). */
export const CHIP_KEY = UI_PREFIX + "chip";
/** Bar track key (CH-08 upper half, recessed groove). */
export const BAR_TRACK_KEY = UI_PREFIX + "bar" + "." + "track";
/** Bar fill key (CH-08 lower half, flat-ended block). */
export const BAR_FILL_KEY = UI_PREFIX + "bar" + "." + "fill";
/** Slider groove key (CH-09 assembled plate). */
export const SLIDER_TRACK_KEY = UI_PREFIX + "slider" + "." + "track";
/** Slider thumb key (CH-09 centred knob crop, same plate). */
export const SLIDER_THUMB_KEY = UI_PREFIX + "slider" + "." + "thumb";
/** Toggle off key (CH-10 left cell). */
export const TOGGLE_OFF_KEY = UI_PREFIX + "toggle" + "." + "off";
/** Toggle on key (CH-10 right cell, lit knob). */
export const TOGGLE_ON_KEY = UI_PREFIX + "toggle" + "." + "on";
/** Checkbox empty key (CH-11 left cell). */
export const CHECKBOX_KEY = UI_PREFIX + "checkbox";
/** Checkbox hover key (CH-11 middle cell, cyan frame). */
export const CHECKBOX_HOVER_KEY = UI_PREFIX + "checkbox" + "." + "hover";
/** Checkbox checked key (CH-11 right cell, chunky tick). */
export const CHECKBOX_CHECKED_KEY = UI_PREFIX + "checkbox" + "." + "checked";
/** Text field key (CH-12 recessed plate). */
export const FIELD_KEY = UI_PREFIX + "field";
/** Select key (CH-12 plate, chevron cavity drawn in CSS). */
export const FIELD_SELECT_KEY = UI_PREFIX + "field" + "." + "select";
/** Scrollbar key (CH-13 recessed track with thumb). */
export const SCROLLBAR_KEY = UI_PREFIX + "scrollbar";
/** List row default key (CH-14 upper band). */
export const ROW_KEY = UI_PREFIX + "row";
/** List row hover key (CH-14 middle band, same height). */
export const ROW_HOVER_KEY = UI_PREFIX + "row" + "." + "hover";
/** List row selected key (CH-14 lower band, cyan frame, same height). */
export const ROW_SELECTED_KEY = UI_PREFIX + "row" + "." + "selected";
/** Tooltip bubble key (CH-17 plate with tail). */
export const TOOLTIP_KEY = UI_PREFIX + "tooltip";
/** Toast strip key (CH-18 plate with status block). */
export const TOAST_KEY = UI_PREFIX + "toast";
/** Keycap key (CH-15 cap, label set in HTML). */
export const KEYCAP_KEY = UI_PREFIX + "keycap";
/** Divider rule key (CH-16 upper rule with centre diamond). */
export const DIVIDER_KEY = UI_PREFIX + "divider";
/** Corner bracket key (CH-16 lower-left arms). */
export const BRACKET_KEY = UI_PREFIX + "bracket";
/** Header strip key (CH-16 lower-right rail band). */
export const HEADER_KEY = UI_PREFIX + "header";

/**
 * Committed sliced-chrome file per key, relative to the atlas dir
 * (mirrors the `file` fields of the `ui.*` entries in
 * assets/atlas/manifest.json; the chrome sync test pins them equal).
 * The five legacy keys keep their names and only change files; every
 * other key ships the required control piece from the same kit.
 */
export const CHROME_FILES: Record<string, string> = {
  [HUD_FRAME_KEY]: "ui/panel.png",
  [MENU_BUTTON_KEY]: "ui/button.png",
  [MENU_BUTTON_HOVER_KEY]: "ui/button.hover.png",
  [AMMO_MODULE_KEY]: "ui/panel.inset.png",
  [HUD_BAR_KEY]: "ui/bar.fill.png",
  [PANEL_ELEVATED_KEY]: "ui/panel.elevated.png",
  [PANEL_INSET_KEY]: "ui/panel.inset.png",
  [PANEL_HAZARD_KEY]: "ui/panel.hazard.png",
  [PANEL_BANNER_KEY]: "ui/panel.banner.png",
  [BUTTON_PRESSED_KEY]: "ui/button.pressed.png",
  [BUTTON_DISABLED_KEY]: "ui/button.disabled.png",
  [BUTTON_FOCUS_KEY]: "ui/button.focus.png",
  [BUTTON_DANGER_KEY]: "ui/button.danger.png",
  [BUTTON_CTA_KEY]: "ui/button.cta.png",
  [BUTTON_SECONDARY_KEY]: "ui/button.secondary.png",
  [BUTTON_ICON_KEY]: "ui/button.icon.png",
  [CHIP_KEY]: "ui/chip.png",
  [BAR_TRACK_KEY]: "ui/bar.track.png",
  [BAR_FILL_KEY]: "ui/bar.fill.png",
  [SLIDER_TRACK_KEY]: "ui/slider.track.png",
  [SLIDER_THUMB_KEY]: "ui/slider.thumb.png",
  [TOGGLE_OFF_KEY]: "ui/toggle.off.png",
  [TOGGLE_ON_KEY]: "ui/toggle.on.png",
  [CHECKBOX_KEY]: "ui/checkbox.png",
  [CHECKBOX_HOVER_KEY]: "ui/checkbox.hover.png",
  [CHECKBOX_CHECKED_KEY]: "ui/checkbox.checked.png",
  [FIELD_KEY]: "ui/field.png",
  [FIELD_SELECT_KEY]: "ui/field.select.png",
  [SCROLLBAR_KEY]: "ui/scrollbar.png",
  [ROW_KEY]: "ui/row.png",
  [ROW_HOVER_KEY]: "ui/row.hover.png",
  [ROW_SELECTED_KEY]: "ui/row.selected.png",
  [TOOLTIP_KEY]: "ui/tooltip.png",
  [TOAST_KEY]: "ui/toast.png",
  [KEYCAP_KEY]: "ui/keycap.png",
  [DIVIDER_KEY]: "ui/divider.png",
  [BRACKET_KEY]: "ui/bracket.png",
  [HEADER_KEY]: "ui/header.png",
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
 * Stamp one element with a chrome probe key plus its sliced art as a
 * single plate (`background-repeat: no-repeat` with a full-bleed size
 * so a 256px riveted panel never tiles across a wide container; issue
 * #359). `image-rendering: pixelated` keeps the plates crisp at any
 * camera/browser zoom. Change-guarded so the 20 Hz HUD mirror stays
 * cheap; null-safe and never throws. Surfaces whose frame comes from
 * CSS 9-slice (`border-image`) should use stampFrame instead so the
 * inline plate cannot double the frame.
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
      // Single-plate guard (issue #359): wide containers must never
      // repeat the art; the plate fills its module exactly once.
      if (bag["backgroundRepeat"] !== "no-repeat") {
        bag["backgroundRepeat"] = "no-repeat";
      }
      if (bag["backgroundSize"] !== "100% 100%") {
        bag["backgroundSize"] = "100% 100%";
      }
      if (bag["backgroundPosition"] !== "center") {
        bag["backgroundPosition"] = "center";
      }
      if (bag["imageRendering"] !== "pixelated") {
        bag["imageRendering"] = "pixelated";
      }
    }
  } catch {
    // Style-less fakes: the data-frame above still carries the key.
  }
}

/**
 * Stamp only the `data-frame` probe key, leaving the visuals to the
 * CSS 9-slice frame (`border-image`). Menu panels and buttons ride
 * their frames from panel.css/button.css/chrome.css; an inline plate
 * on top would double the frame and tile (issue #359). Change-guarded,
 * null-safe, never throws.
 */
export function stampFrame(el: unknown, key: string): void {
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
      // Read-only shims: nothing else to land.
    }
  }
  // Frame-owned surfaces must not carry an inline plate: clear any
  // stale tiled background so the CSS 9-slice reads exactly once.
  try {
    const style = target.style;
    if (typeof style === "object" && style !== null) {
      const bag = style as Record<string, unknown>;
      if (
        typeof bag["backgroundImage"] === "string" &&
        bag["backgroundImage"] !== "none"
      ) {
        bag["backgroundImage"] = "none";
      }
    }
  } catch {
    // Style-less fakes: the data-frame above still carries the key.
  }
}

/**
 * Clear a chrome stamp: drop the `data-frame` key and reset the
 * inline plate to `none` so wide containers (`#hud`, `#menu`) read
 * `background-image: none` (issue #359). Null-safe, never throws.
 */
export function clearChrome(el: unknown): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const target = el as {
    removeAttribute?: unknown;
    style?: unknown;
  };
  try {
    if (typeof target.removeAttribute === "function") {
      (target.removeAttribute as (name: string) => void).call(
        target,
        "data-frame",
      );
    }
  } catch {
    // Attribute-less fakes: the style reset below still lands.
  }
  try {
    const style = target.style;
    if (typeof style === "object" && style !== null) {
      const bag = style as Record<string, unknown>;
      if (bag["backgroundImage"] !== "none") {
        bag["backgroundImage"] = "none";
      }
    }
  } catch {
    // Style-less fakes: nothing else to clear.
  }
}

/** Element handles owned by the HUD chrome; nulls make updates no-op.
 * Only the four `.hud-module` clusters carry plates (issue #359): the
 * full-width `#hud` container is cleared, never stamped. New cluster
 * handles stay optional so older two-handle shapes keep compiling. */
export interface HudChromeHandles {
  hud: unknown;
  ammoModule: unknown;
  status?: unknown;
  center?: unknown;
  killfeed?: unknown;
}

/**
 * Stamp one plate per HUD cluster (issue #359): status, score/timer,
 * kill feed, and ammo module. The full-width `#hud` container is
 * cleared to `background-image: none` so the 256px riveted panel can
 * no longer tile across the top. Change-guarded per element so the
 * every-frame mirror stays cheap; null-safe and never throws.
 */
export function applyHudChrome(
  handles: HudChromeHandles | null | undefined,
): void {
  if (handles === null || handles === undefined) {
    return;
  }
  // The container never carries art (issue #359): clear any stale
  // tiled plate so `#hud` reads `background-image: none`.
  try {
    clearChrome(handles.hud);
  } catch {
    // Hostile shims: the module stamps below still land.
  }
  try {
    if (handles.status !== undefined && handles.status !== null) {
      stampChrome(handles.status, HUD_FRAME_KEY);
    }
  } catch {
    // Hostile shims: the remaining modules still land.
  }
  try {
    if (handles.center !== undefined && handles.center !== null) {
      stampChrome(handles.center, HUD_FRAME_KEY);
    }
  } catch {
    // Hostile shims: the remaining modules still land.
  }
  try {
    if (handles.killfeed !== undefined && handles.killfeed !== null) {
      stampChrome(handles.killfeed, HUD_FRAME_KEY);
    }
  } catch {
    // Hostile shims: the ammo module below still lands.
  }
  try {
    stampChrome(handles.ammoModule, AMMO_MODULE_KEY);
  } catch {
    // Hostile shims: the cluster stamps above already landed.
  }
}

/** Panel ids stamped with the menu panel tile on boot. */
const MENU_PANEL_IDS: readonly string[] = [
  "menu",
  "setup",
  "settings",
  "howto",
  "challenges",
  "locker",
  "end-screen",
  "net-status",
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
  "setup-close",
  "settings-close",
  "howto-close",
  "btn-fullscreen",
  "btn-quality",
  "btn-nametags",
  "restart",
  "end-menu",
  "end-close",
  "bots-minus",
  "bots-plus",
  "settings-done",
  "settings-reset",
  "howto-done",
  "challenges-done",
  "locker-equip",
  "net-cancel",
  "net-retry",
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
 * True for menu-art-owned controls (issue #348): carousel cards,
 * arrows, and page dots ride their own chrome.css plates (ME-04/ME-05),
 * never the shared button tile. Skipped by bindButton so the inline
 * resting-tile stamp cannot cover the art. Reads attributes first
 * (fake-doc friendly), then the live classList. Never throws.
 */
export function isMenuArtButton(el: unknown): boolean {
  try {
    if (typeof el !== "object" || el === null) {
      return false;
    }
    const get = (el as { getAttribute?: unknown }).getAttribute;
    if (typeof get === "function") {
      const call = (name: string): string | null => {
        try {
          const value = (get as (n: string) => unknown).call(el, name);
          return typeof value === "string" ? value : null;
        } catch {
          return null;
        }
      };
      if (call("data-map-card") !== null) {
        return true;
      }
      if (call("data-carousel-dot") !== null) {
        return true;
      }
      if (call("id") === "carousel-prev" || call("id") === "carousel-next") {
        return true;
      }
      const cls = call("class");
      if (
        typeof cls === "string" &&
        /(^|\s)(map-card|carousel-arrow|carousel-dot)(\s|$)/.test(cls)
      ) {
        return true;
      }
    }
    const list = (el as { classList?: unknown }).classList as
      | { contains?: unknown }
      | undefined;
    if (list !== undefined && list !== null && typeof list.contains === "function") {
      for (const name of ["map-card", "carousel-arrow", "carousel-dot"]) {
        try {
          if ((list.contains as (n: string) => unknown).call(list, name) === true) {
            return true;
          }
        } catch {
          // Unreadable token: keep scanning.
        }
      }
    }
  } catch {
    // Shorn handle: not menu art.
  }
  return false;
}

/**
 * Wire one menu button: the CSS 9-slice frame owns the visuals, so
 * only the `data-frame` probe key swaps here (resting now, hover tile
 * on `mouseenter`/`focus`, resting back on `mouseleave`/`blur`). No
 * inline plate is stamped, so the shared tile can no longer double the
 * CSS frame or tile across the button (issue #359). Synchronous swaps
 * land far inside the 200ms probe budget. The module hover set drives
 * buildMenuSnapshot; listeners attach once per element. Never throws.
 */
function bindButton(button: unknown): void {
  if (button === null || button === undefined) {
    return;
  }
  if (isMenuArtButton(button)) {
    return;
  }
  try {
    stampFrame(button, MENU_BUTTON_KEY);
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
      stampFrame(button, MENU_BUTTON_HOVER_KEY);
    } catch {
      // Hover paint best-effort: the snapshot set above already landed.
    }
  };
  const leave = (): void => {
    try {
      hoveredButtons.delete(button);
      stampFrame(button, MENU_BUTTON_KEY);
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
 * Stamp every menu panel's probe key plus all menu/setup buttons and
 * wire the hover swaps. Panels and buttons ride their CSS 9-slice
 * frames, so only the `data-frame` key is stamped here (never an
 * inline plate that could double the frame or tile; issue #359).
 * Missing builders, throwing lookups, and listener-less shims are
 * no-ops; never throws.
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
        // Full-screen overlay roots never carry the art themselves:
        // the sliced panel frame lives in CSS on the constrained
        // inner `.sl-panel` card (border-image), so only the probe key
        // is stamped and roots without one stay unstamped (issue #313).
        // No inline plate: it would double the CSS frame (issue #359).
        const root = lookup(id);
        const inner = panelChild(root);
        if (inner !== null) {
          stampFrame(inner, MENU_PANEL_KEY);
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
