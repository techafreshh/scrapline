// Animated menu art scene plus the Quick Play summary chip. Pure math
// (hover loop, chip text) stays DOM-free and unit-testable under node;
// the thin binder mirrors the setup.ts/hud.ts pattern (null-safe byId
// lookups, missing elements are no-ops, listeners attach once). The
// scene reuses the theme backdrop palette (view/backdrop.ts) and the
// soldier accent source (view/soldier.ts) so the menu soldier and the
// match sprites stay on the same team colors by construction. The
// soldier itself is a DOM figure above the canvas: the match canvas
// keeps painting the theme backdrop behind the semi-transparent menu
// overlay, while this loop bobs the jet-hover figure every frame.

import {
  MATCH_SCORE_LIMIT,
  MATCH_TIME_LIMIT_TICKS,
  TICK_HZ,
} from "../../../core/src/constants";
import { backdropPaletteFor } from "../view/backdrop";
import { MENU_PANEL_KEY, stampChrome } from "../ui/chrome";
import { soldierAccentFor } from "../view/soldier";
import {
  MAP_LIST,
  TIER_LIST,
  loadSetup,
  parseSetup,
  type SetupConfig,
  type SetupStorage,
} from "../setup";

/** Jet-hover peak offset from the rest pose in CSS px (>= 6px probe). */
export const MENU_HOVER_AMPLITUDE_PX = 14;
/** Jet-hover loop period in ms (1.5s samples land on opposite phases). */
export const MENU_HOVER_PERIOD_MS = 2000;
/** Quick Play chip element id (child of #quick-play). */
export const MENU_CHIP_ID = "quick-play-chip";
/** Menu scene container id (child of #menu). */
export const MENU_SCENE_ID = "menu-scene";
/** Hovering soldier figure id (child of the scene container). */
export const MENU_SOLDIER_ID = "menu-soldier";
/** Jet-flame flicker element id (child of the soldier figure). */
export const MENU_FLAME_ID = "menu-flame";
/** Live chip refresh cadence in ms (well inside the 500ms probe). */
export const MENU_CHIP_POLL_MS = 100;

/**
 * Vertical hover offset in CSS px for a wall-clock timestamp. Sine loop
 * anchored at 0: t=0 reads 0, t=1500ms reads -amplitude, so the
 * 1.5s-spaced capture pair always differs by the full amplitude
 * (14px) on the anchored phase. Non-finite inputs read 0, never NaN.
 */
export function menuHoverOffsetY(nowMs: unknown): number {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    return 0;
  }
  const phase =
    ((nowMs % MENU_HOVER_PERIOD_MS) + MENU_HOVER_PERIOD_MS) %
    MENU_HOVER_PERIOD_MS;
  return (
    MENU_HOVER_AMPLITUDE_PX *
    Math.sin((phase / MENU_HOVER_PERIOD_MS) * Math.PI * 2)
  );
}

/**
 * Absolute soldier screen y for a rest-flow y plus the hover offset.
 * Non-finite rest anchors fall back to the offset alone.
 */
export function menuSoldierScreenY(baseY: unknown, nowMs: unknown): number {
  const offset = menuHoverOffsetY(nowMs);
  if (typeof baseY !== "number" || !Number.isFinite(baseY)) {
    return offset;
  }
  return baseY + offset;
}

/** Match length in whole minutes from the sim time-limit ticks. */
export function menuTimeMinutes(): number {
  const seconds = MATCH_TIME_LIMIT_TICKS / TICK_HZ;
  const minutes = Math.round(seconds / 60);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
}

/**
 * Quick Play summary chip text for a setup: `3 bots · normal ·
 * first to 25 · 5 min`. Score and length read the sim constants by
 * default (overridable for tests); the bot noun pluralizes.
 */
export function formatQuickPlaySummary(
  config: SetupConfig,
  scoreLimit: number = MATCH_SCORE_LIMIT,
  minutes: number = menuTimeMinutes(),
): string {
  const parsed = parseSetup(config);
  const score =
    typeof scoreLimit === "number" &&
    Number.isFinite(scoreLimit) &&
    scoreLimit > 0
      ? Math.floor(scoreLimit)
      : MATCH_SCORE_LIMIT;
  const mins =
    typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
      ? Math.floor(minutes)
      : menuTimeMinutes();
  const bots = `${parsed.bots} bot${parsed.bots === 1 ? "" : "s"}`;
  return `${bots} \u00b7 ${parsed.tier} \u00b7 first to ${score} \u00b7 ${mins} min`;
}

/** Minimal text surface for the bots readout. */
interface TextTarget {
  textContent: string | null;
}

/** Minimal attribute surface for tier/map pressed states. */
interface PressedTarget {
  getAttribute(name: string): string | null;
}

/**
 * Read the live bots count: the setup stepper readout (#bots-value)
 * wins when it holds a 1-7 int, then the `?bots=` URL override, then
 * storage. Missing surfaces fall through silently.
 */
function readBots(
  doc: Document,
  storage: SetupStorage | null | undefined,
  stored: number,
): number {
  try {
    const el = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof el === "function") {
      const node = (el as (id: string) => unknown).call(doc, "bots-value") as
        | TextTarget
        | null;
      if (node !== null && typeof node === "object" && "textContent" in node) {
        const raw = String(node.textContent ?? "").trim();
        if (raw !== "") {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            const floored = Math.floor(n);
            if (floored >= 1 && floored <= 7) {
              return floored;
            }
          }
        }
      }
    }
  } catch {
    // DOM readout unreadable: fall through to URL/storage.
  }
  try {
    if (typeof window !== "undefined") {
      const search = (window as unknown as { location?: { search?: unknown } })
        .location?.search;
      if (typeof search === "string" && search.length > 1) {
        const query = new URLSearchParams(search);
        const raw = query.get("bots");
        if (raw !== null && raw.trim() !== "") {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            const floored = Math.floor(n);
            if (floored >= 1 && floored <= 7) {
              return floored;
            }
          }
        }
      }
    }
  } catch {
    // Non-URL harness: storage stands.
  }
  void storage;
  return stored;
}

/**
 * Read the live tier: the pressed setup button wins, then `?tier=`,
 * then storage. Unknown values fall through to the stored tier.
 */
function readTier(
  doc: Document,
  storage: SetupStorage | null | undefined,
  stored: SetupConfig["tier"],
): SetupConfig["tier"] {
  try {
    const query = (doc as unknown as { querySelector?: unknown }).querySelector;
    if (typeof query === "function") {
      const q = query as (sel: string) => unknown;
      for (const tier of TIER_LIST) {
        const node = q.call(doc, `[data-tier="${tier}"]`) as
          | PressedTarget
          | null;
        if (node !== null && typeof node === "object") {
          try {
            if (node.getAttribute("aria-pressed") === "true") {
              return tier;
            }
          } catch {
            // Unreadable button: keep scanning.
          }
        }
      }
    }
  } catch {
    // querySelector shorn: fall through to URL/storage.
  }
  try {
    if (typeof window !== "undefined") {
      const search = (window as unknown as { location?: { search?: unknown } })
        .location?.search;
      if (typeof search === "string" && search.length > 1) {
        const value = new URLSearchParams(search).get("tier");
        if (value !== null) {
          const key = value.trim().toLowerCase();
          if ((TIER_LIST as readonly string[]).includes(key)) {
            return key as SetupConfig["tier"];
          }
        }
      }
    }
  } catch {
    // Non-URL harness: storage stands.
  }
  void storage;
  return stored;
}

/**
 * Read the live map: the pressed setup button wins, then `?map=`,
 * then storage. Unknown values fall through to the stored map.
 */
function readMap(
  doc: Document,
  storage: SetupStorage | null | undefined,
  stored: SetupConfig["map"],
): SetupConfig["map"] {
  try {
    const query = (doc as unknown as { querySelector?: unknown }).querySelector;
    if (typeof query === "function") {
      const q = query as (sel: string) => unknown;
      for (const map of MAP_LIST) {
        const node = q.call(doc, `[data-map="${map}"]`) as
          | PressedTarget
          | null;
        if (node !== null && typeof node === "object") {
          try {
            if (node.getAttribute("aria-pressed") === "true") {
              return map;
            }
          } catch {
            // Unreadable button: keep scanning.
          }
        }
      }
    }
  } catch {
    // querySelector shorn: fall through to URL/storage.
  }
  try {
    if (typeof window !== "undefined") {
      const search = (window as unknown as { location?: { search?: unknown } })
        .location?.search;
      if (typeof search === "string" && search.length > 1) {
        const value = new URLSearchParams(search).get("map");
        if (value !== null) {
          const key = value.trim().toLowerCase();
          if ((MAP_LIST as readonly string[]).includes(key)) {
            return key as SetupConfig["map"];
          }
        }
      }
    }
  } catch {
    // Non-URL harness: storage stands.
  }
  void storage;
  return stored;
}

/**
 * Live menu config: storage seeds every field, then the setup overlay
 * DOM (stepper readout, pressed tier/map buttons) and the URL query
 * override per field. Tolerantly normalized, never throws.
 */
export function readMenuConfig(
  doc: Document,
  storage: SetupStorage | null | undefined,
): SetupConfig {
  const stored = loadSetup(storage);
  return parseSetup({
    bots: readBots(doc, storage, stored.bots),
    tier: readTier(doc, storage, stored.tier),
    map: readMap(doc, storage, stored.map),
  });
}

/** Assign text on an unknown handle when it carries textContent. */
function setText(el: unknown, text: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  if ("textContent" in el) {
    (el as { textContent: unknown }).textContent = text;
  }
}

/** Write one style property on an unknown handle's style bag. */
function setStyle(el: unknown, name: string, value: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const style = (el as { style?: unknown }).style;
  if (typeof style !== "object" || style === null) {
    return;
  }
  (style as Record<string, unknown>)[name] = value;
}

/**
 * Ensure the Quick Play summary chip exists as a child of #quick-play.
 * Creates `<span id="quick-play-chip">` on first call (idempotent);
 * missing parents or shorn documents read null instead of throwing.
 */
export function ensureQuickPlayChip(doc: Document): unknown {
  try {
    const byId = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof byId !== "function") {
      return null;
    }
    const get = byId as (id: string) => unknown;
    const existing = get.call(doc, MENU_CHIP_ID);
    if (existing !== null && typeof existing === "object") {
      return existing;
    }
    const play = get.call(doc, "quick-play");
    if (play === null || typeof play !== "object") {
      return null;
    }
    const creator = (doc as unknown as { createElement?: unknown }).createElement;
    if (typeof creator !== "function") {
      return null;
    }
    const chip = (creator as (tag: string) => unknown).call(doc, "span");
    if (chip === null || typeof chip !== "object") {
      return null;
    }
    try {
      const setAttr = (
        chip as { setAttribute?: (name: string, value: string) => void }
      ).setAttribute;
      if (typeof setAttr === "function") {
        setAttr.call(chip, "id", MENU_CHIP_ID);
      }
      (chip as { id?: unknown }).id = MENU_CHIP_ID;
    } catch {
      // Id assignment best-effort: the text update below still lands.
    }
    try {
      const appender = (play as { appendChild?: unknown }).appendChild;
      if (typeof appender === "function") {
        (appender as (kid: unknown) => void).call(play, chip);
        return chip;
      }
    } catch {
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Refresh the chip text from a config (defaults to the live
 * readMenuConfig). Returns the rendered text (empty when the chip is
 * absent). Never throws.
 */
export function updateQuickPlayChip(
  doc: Document,
  config?: SetupConfig,
  storage?: SetupStorage | null,
): string {
  try {
    const chip = ensureQuickPlayChip(doc);
    if (chip === null || typeof chip !== "object") {
      return "";
    }
    const resolved =
      config !== undefined ? parseSetup(config) : readMenuConfig(doc, storage ?? null);
    const text = formatQuickPlaySummary(resolved);
    setText(chip, text);
    return text;
  } catch {
    return "";
  }
}

/**
 * Ensure the menu scene container exists inside #menu with a soldier
 * figure plus a jet-flame child. Idempotent; missing parents read
 * null. The soldier accent reuses soldierAccentFor(0) and the scene
 * glow reuses the backdrop haze for the live map, so both match the
 * renderer palette by construction.
 */
export function ensureMenuScene(doc: Document, map?: unknown): unknown {
  try {
    const api = doc as unknown as {
      getElementById?: unknown;
      createElement?: unknown;
    };
    if (typeof api.getElementById !== "function" || typeof api.createElement !== "function") {
      return null;
    }
    const get = api.getElementById as (id: string) => unknown;
    const make = api.createElement as (tag: string) => unknown;
    const existing = get.call(doc, MENU_SCENE_ID);
    if (existing !== null && typeof existing === "object") {
      // Pixel-pack panel tile (issue #270): re-stamp idempotently so
      // late boot order never leaves the scene on flat CSS.
      stampChrome(existing, MENU_PANEL_KEY);
      return existing;
    }
    const menu = get.call(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return null;
    }
    const scene = make.call(doc, "div");
    if (scene === null || typeof scene !== "object") {
      return null;
    }
    try {
      const setAttr = (
        scene as { setAttribute?: (name: string, value: string) => void }
      ).setAttribute;
      if (typeof setAttr === "function") {
        setAttr.call(scene, "id", MENU_SCENE_ID);
        setAttr.call(scene, "aria-hidden", "true");
      }
      (scene as { id?: unknown }).id = MENU_SCENE_ID;
    } catch {
      // Id/aria best-effort only.
    }
    const soldier = make.call(doc, "div");
    if (soldier !== null && typeof soldier === "object") {
      try {
        const setAttr = (
          soldier as { setAttribute?: (name: string, value: string) => void }
        ).setAttribute;
        if (typeof setAttr === "function") {
          setAttr.call(soldier, "id", MENU_SOLDIER_ID);
        }
        (soldier as { id?: unknown }).id = MENU_SOLDIER_ID;
      } catch {
        // Id best-effort only.
      }
      setStyle(soldier, "background", soldierAccentFor(0));
      const flame = make.call(doc, "div");
      if (flame !== null && typeof flame === "object") {
        try {
          const setAttr = (
            flame as { setAttribute?: (name: string, value: string) => void }
          ).setAttribute;
          if (typeof setAttr === "function") {
            setAttr.call(flame, "id", MENU_FLAME_ID);
          }
          (flame as { id?: unknown }).id = MENU_FLAME_ID;
        } catch {
          // Id best-effort only.
        }
        try {
          const appender = (soldier as { appendChild?: unknown }).appendChild;
          if (typeof appender === "function") {
            (appender as (kid: unknown) => void).call(soldier, flame);
          }
        } catch {
          // Flame optional: the soldier still hovers.
        }
      }
      try {
        const appender = (scene as { appendChild?: unknown }).appendChild;
        if (typeof appender === "function") {
          (appender as (kid: unknown) => void).call(scene, soldier);
        }
      } catch {
        return null;
      }
    }
    try {
      const palette = backdropPaletteFor(map ?? "kilima");
      setStyle(scene, "color", palette.hazeCss);
      // Pixel-pack panel tile (issue #270): the scene rides above
      // the match canvas, so it owns the menu `ui.panel` background.
      stampChrome(scene, MENU_PANEL_KEY);
      const setAttr = (
        scene as { setAttribute?: (name: string, value: string) => void }
      ).setAttribute;
      if (typeof setAttr === "function") {
        setAttr.call(scene, "data-theme", palette.name);
      }
    } catch {
      // Theme glow best-effort only.
    }
    try {
      const appender = (menu as { appendChild?: unknown }).appendChild;
      if (typeof appender !== "function") {
        return null;
      }
      // Scene sits behind the buttons: prepend when the DOM offers it.
      const prepender = (menu as { prepend?: unknown }).prepend;
      if (typeof prepender === "function") {
        (prepender as (kid: unknown) => void).call(menu, scene);
      } else {
        (appender as (kid: unknown) => void).call(menu, scene);
      }
      return scene;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** True while the menu overlay is on screen (inline-style check). */
export function isMenuVisible(doc: Document): boolean {
  try {
    const byId = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof byId !== "function") {
      return false;
    }
    const menu = (byId as (id: string) => unknown).call(doc, "menu") as {
      style?: { display?: unknown };
    } | null;
    if (menu === null || typeof menu !== "object") {
      return false;
    }
    const display = menu.style?.display;
    return display !== "none";
  } catch {
    return false;
  }
}

/** Live binder state returned by bindMenuScene. */
export interface MenuSceneBinder {
  /** Latest chip config (refreshed on every poll). */
  config: SetupConfig;
  /** Refresh the chip text now; returns the rendered text. */
  refresh(): string;
  /** Stop the poll interval and the hover loop. */
  stop(): void;
}

/**
 * Wire the animated menu scene: ensure the chip plus the scene DOM,
 * repaint the chip from the live config every MENU_CHIP_POLL_MS, and
 * bob the soldier figure on requestAnimationFrame while the menu is
 * visible. Missing elements are no-ops; the poll/loop start only in
 * a DOM harness and stop() always tears them down. Never touches the
 * sim or the match renderer (the canvas backdrop stays owned by the
 * match loop; the soldier rides above it as DOM).
 */
export function bindMenuScene(
  doc: Document,
  storage: SetupStorage | null | undefined,
): MenuSceneBinder {
  const binder: MenuSceneBinder = {
    config: loadSetup(storage),
    refresh: (): string => "",
    stop: (): void => {},
  };
  try {
    ensureMenuScene(doc, binder.config.map);
  } catch {
    // Scene optional: the chip still binds.
  }
  const refresh = (): string => {
    try {
      const live = readMenuConfig(doc, storage);
      binder.config = live;
      const text = updateQuickPlayChip(doc, live);
      try {
        if (typeof window !== "undefined") {
          const game = (window as unknown as Record<string, unknown>)[
            "__menuScene"
          ] as Record<string, unknown> | undefined;
          const surface: Record<string, unknown> = {
            chip: text,
            bots: live.bots,
            tier: live.tier,
            map: live.map,
            visible: isMenuVisible(doc),
          };
          if (game !== undefined && game !== null && typeof game === "object") {
            Object.assign(game, surface);
          } else {
            (window as unknown as Record<string, unknown>)["__menuScene"] =
              surface;
          }
        }
      } catch {
        // Probe mirror best-effort only.
      }
      return text;
    } catch {
      return "";
    }
  };
  binder.refresh = refresh;

  let interval: unknown = null;
  let rafId = 0;
  let stopped = false;
  const canLoop =
    typeof window !== "undefined" &&
    typeof doc !== "undefined" &&
    doc !== null;
  try {
    refresh();
  } catch {
    // Initial paint best-effort only.
  }
  if (canLoop) {
    try {
      const schedule = (
        window as unknown as {
          setInterval?: typeof setInterval;
          requestAnimationFrame?: (cb: (t: number) => void) => number;
        }
      ).setInterval;
      if (typeof schedule === "function") {
        interval = schedule.call(window, () => {
          if (stopped) {
            return;
          }
          refresh();
        }, MENU_CHIP_POLL_MS);
        try {
          const timer = interval as { unref?: () => void };
          if (typeof timer.unref === "function") {
            timer.unref();
          }
        } catch {
          // Browser timers lack unref: harmless.
        }
      }
    } catch {
      interval = null;
    }
    const tick = (now: number): void => {
      if (stopped) {
        return;
      }
      try {
        if (isMenuVisible(doc)) {
          const stamp = typeof now === "number" && Number.isFinite(now)
            ? now
            : Date.now();
          const offset = menuHoverOffsetY(stamp);
          try {
            const byId = (
              doc as unknown as { getElementById?: (id: string) => unknown }
            ).getElementById;
            const soldier =
              typeof byId === "function"
                ? (byId.call(doc, MENU_SOLDIER_ID) as {
                    style?: Record<string, unknown>;
                  } | null)
                : null;
            if (soldier !== null && typeof soldier === "object") {
              if (soldier.style !== undefined && soldier.style !== null) {
                soldier.style["transform"] =
                  `translate(-50%, ${offset.toFixed(2)}px)`;
              } else {
                setStyle(soldier, "transform", `translate(-50%, ${offset.toFixed(2)}px)`);
              }
            }
            const flameById = (
              doc as unknown as { getElementById?: (id: string) => unknown }
            ).getElementById;
            const flame =
              typeof flameById === "function"
                ? (flameById.call(doc, MENU_FLAME_ID) as {
                    style?: Record<string, unknown>;
                  } | null)
                : null;
            if (flame !== null && typeof flame === "object") {
              const flicker =
                0.7 + 0.3 * Math.abs(Math.sin(stamp / 110));
              setStyle(flame, "opacity", flicker.toFixed(3));
            }
          } catch {
            // Pose write best-effort: the next frame retries.
          }
          try {
            if (typeof window !== "undefined") {
              const surface = (window as unknown as Record<string, unknown>)[
                "__menuScene"
              ] as Record<string, unknown> | undefined;
              if (surface !== undefined && surface !== null && typeof surface === "object") {
                surface["hoverY"] = offset;
              }
            }
          } catch {
            // Probe mirror best-effort only.
          }
        }
      } catch {
        // Visibility/read faults never break the loop.
      }
      try {
        const raf = (
          window as unknown as {
            requestAnimationFrame?: (cb: (t: number) => void) => number;
          }
        ).requestAnimationFrame;
        if (typeof raf === "function") {
          rafId = raf.call(window, tick);
        }
      } catch {
        // rAF shorn mid-session: the hover freezes, the chip persists.
      }
    };
    try {
      const raf = (
        window as unknown as {
          requestAnimationFrame?: (cb: (t: number) => void) => number;
        }
      ).requestAnimationFrame;
      if (typeof raf === "function") {
        rafId = raf.call(window, tick);
      }
    } catch {
      // No rAF (headless import): chip polling still covers the text.
    }
  }
  binder.stop = (): void => {
    stopped = true;
    try {
      if (interval !== null && typeof clearInterval === "function") {
        clearInterval(interval as Parameters<typeof clearInterval>[0]);
      }
    } catch {
      // Timer teardown best-effort only.
    }
    try {
      if (rafId !== 0 && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
    } catch {
      // rAF teardown best-effort only.
    }
    interval = null;
    rafId = 0;
  };
  return binder;
}
