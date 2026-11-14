// Rotating menu tips: one small line under the menu buttons teaches
// mechanics (shield pickups, spawn protection, jet fuel, grenades)
// without blocking play. Pure helpers (tip text, index math) stay
// DOM-free and unit-testable under node; the thin binder mirrors the
// scene.ts idiom (null-safe lookups, missing elements are no-ops,
// `window.__menuTips` probe mirror, `stop()` tears down timers).
import { isMenuVisible } from "./scene";

/** Tip line element id (child of #menu). */
export const MENU_TIP_ID = "menu-tip";
/** Rotation cadence in ms (one new tip every 10 s). */
export const MENU_TIP_INTERVAL_MS = 10000;
/** Fade half/whole duration in ms (matches the killfeed 0.5s idiom). */
export const MENU_TIP_FADE_MS = 500;

/**
 * Rotating tips in display order. Every entry names a mechanic in
 * player language so the menu keyword probe (`shield|spawn|jet|fuel|
 * grenade`, case-insensitive) matches each one individually.
 */
export const MENU_TIPS: readonly string[] = [
  "Grab a shield pickup to survive an extra hit.",
  "Spawn protection shields you for a few seconds \u2014 push early.",
  "Watch your jet fuel \u2014 feather the jets to stay airborne.",
  "Cook a grenade with G, but don't hold it too long.",
];

/** Half-fade delay before the text swap (opacity hits 0 mid-fade). */
const SWAP_DELAY_MS = MENU_TIP_FADE_MS / 2;

/**
 * Tip text for an index. Modulo-normalized (negative and huge inputs
 * wrap); non-finite inputs read the first tip. Never throws, never
 * returns empty.
 */
export function tipTextFor(index: unknown): string {
  const fallback = MENU_TIPS[0] ?? "";
  try {
    if (typeof index !== "number" || !Number.isFinite(index)) {
      return fallback;
    }
    const count = MENU_TIPS.length;
    if (count <= 0) {
      return "";
    }
    const at = ((Math.floor(index) % count) + count) % count;
    return MENU_TIPS[at] ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Next tip index, modulo the tip count. Non-finite inputs restart at
 * the first rotation step.
 */
export function nextTipIndex(current: unknown): number {
  try {
    const count = MENU_TIPS.length;
    if (count <= 0) {
      return 0;
    }
    const base =
      typeof current === "number" && Number.isFinite(current)
        ? Math.floor(current)
        : -1;
    return (((base + 1) % count) + count) % count;
  } catch {
    return 0;
  }
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

/** Read one style property from an unknown handle's style bag. */
function getStyle(el: unknown, name: string): string {
  try {
    if (typeof el !== "object" || el === null) {
      return "";
    }
    const style = (el as { style?: unknown }).style;
    if (typeof style !== "object" || style === null) {
      return "";
    }
    const value = (style as Record<string, unknown>)[name];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** Resolve the interval scheduler (window stub in tests, global here). */
function scheduleInterval(fn: () => void, ms: number): unknown {
  try {
    if (typeof window !== "undefined") {
      const schedule = (
        window as unknown as { setInterval?: typeof setInterval }
      ).setInterval;
      if (typeof schedule === "function") {
        const id = schedule.call(window, fn, ms);
        try {
          const timer = id as unknown as { unref?: () => void };
          if (typeof timer.unref === "function") {
            timer.unref();
          }
        } catch {
          // Browser timers lack unref: harmless.
        }
        return id;
      }
    }
  } catch {
    // Shorn window: fall through to the global scheduler.
  }
  try {
    return setInterval(fn, ms);
  } catch {
    return null;
  }
}

/** Resolve the one-shot scheduler (window stub in tests, global here). */
function scheduleTimeout(fn: () => void, ms: number): unknown {
  try {
    if (typeof window !== "undefined") {
      const schedule = (
        window as unknown as { setTimeout?: typeof setTimeout }
      ).setTimeout;
      if (typeof schedule === "function") {
        return schedule.call(window, fn, ms);
      }
    }
  } catch {
    // Shorn window: fall through to the global scheduler.
  }
  try {
    return setTimeout(fn, ms);
  } catch {
    return null;
  }
}

/** Clear an interval id on the matching surface (best-effort). */
function clearScheduledInterval(id: unknown): void {
  if (id === null || id === undefined) {
    return;
  }
  try {
    if (typeof window !== "undefined") {
      const clear = (window as unknown as { clearInterval?: typeof clearInterval })
        .clearInterval;
      if (typeof clear === "function") {
        clear.call(window, id as Parameters<typeof clearInterval>[0]);
        return;
      }
    }
  } catch {
    // Fall through to the global clearer.
  }
  try {
    clearInterval(id as Parameters<typeof clearInterval>[0]);
  } catch {
    // Teardown best-effort only.
  }
}

/** Clear a timeout id on the matching surface (best-effort). */
function clearScheduledTimeout(id: unknown): void {
  if (id === null || id === undefined) {
    return;
  }
  try {
    if (typeof window !== "undefined") {
      const clear = (window as unknown as { clearTimeout?: typeof clearTimeout })
        .clearTimeout;
      if (typeof clear === "function") {
        clear.call(window, id as Parameters<typeof clearTimeout>[0]);
        return;
      }
    }
  } catch {
    // Fall through to the global clearer.
  }
  try {
    clearTimeout(id as Parameters<typeof clearTimeout>[0]);
  } catch {
    // Teardown best-effort only.
  }
}

/**
 * Ensure the tip line exists inside #menu, pre-filled with the first
 * tip at full opacity. Returns the existing node when present
 * (idempotent); null (never throws) when #menu is missing.
 */
export function ensureMenuTip(doc: Document): unknown {
  try {
    const api = doc as unknown as {
      getElementById?: unknown;
      createElement?: unknown;
    };
    if (
      typeof api.getElementById !== "function" ||
      typeof api.createElement !== "function"
    ) {
      return null;
    }
    const get = api.getElementById as (id: string) => unknown;
    const make = api.createElement as (tag: string) => unknown;
    const existing = get.call(doc, MENU_TIP_ID);
    if (existing !== null && typeof existing === "object") {
      return existing;
    }
    const menu = get.call(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return null;
    }
    const tip = make.call(doc, "div");
    if (tip === null || typeof tip !== "object") {
      return null;
    }
    try {
      const setAttr = (
        tip as { setAttribute?: (name: string, value: string) => void }
      ).setAttribute;
      if (typeof setAttr === "function") {
        setAttr.call(tip, "id", MENU_TIP_ID);
        setAttr.call(tip, "aria-live", "polite");
      }
      (tip as { id?: unknown }).id = MENU_TIP_ID;
    } catch {
      // Id best-effort only.
    }
    setText(tip, tipTextFor(0));
    if (getStyle(tip, "opacity") === "") {
      setStyle(tip, "opacity", "1");
    }
    try {
      const appender = (menu as { appendChild?: unknown }).appendChild;
      if (typeof appender !== "function") {
        return null;
      }
      (appender as (kid: unknown) => void).call(menu, tip);
      return tip;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** Mirror the live tip onto window.__menuTips (best-effort). */
function mirrorTip(index: number, text: string, doc: Document): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    const surface: Record<string, unknown> = {
      index,
      text,
      visible: isMenuVisible(doc),
    };
    const game = (window as unknown as Record<string, unknown>)[
      "__menuTips"
    ] as Record<string, unknown> | undefined;
    if (game !== undefined && game !== null && typeof game === "object") {
      Object.assign(game, surface);
    } else {
      (window as unknown as Record<string, unknown>)["__menuTips"] = surface;
    }
  } catch {
    // Probe mirror best-effort only.
  }
}

/** Live binder state returned by bindMenuTips. */
export interface MenuTipsBinder {
  /** Index of the currently displayed tip. */
  index: number;
  /** Text of the currently displayed tip (pre-swap while fading). */
  text: string;
  /** Advance one step now (same two-phase fade as the interval). */
  next(): string;
  /** Tear down the interval and any pending text swap. */
  stop(): void;
}

/**
 * Wire the rotating tip line: synchronous initial paint of the first
 * tip, then a MENU_TIP_INTERVAL_MS interval that skips the tick while
 * the menu is hidden (the index never advances under cover) and
 * otherwise runs a two-phase fade (opacity to "0", text swap plus
 * opacity back to "1" at half MENU_TIP_FADE_MS). Missing elements are
 * no-ops; stop() always tears the timers down. Never touches the sim,
 * the renderer, or the setup paths.
 */
export function bindMenuTips(doc: Document): MenuTipsBinder {
  const binder: MenuTipsBinder = {
    index: 0,
    text: tipTextFor(0),
    next: (): string => binder.text,
    stop: (): void => {},
  };
  let stopped = false;
  let interval: unknown = null;
  let pending: unknown = null;

  const paint = (index: number): string => {
    const text = tipTextFor(index);
    binder.index = index;
    binder.text = text;
    try {
      const byId = (doc as unknown as { getElementById?: unknown })
        .getElementById;
      if (typeof byId === "function") {
        const tip = (byId as (id: string) => unknown).call(doc, MENU_TIP_ID);
        if (tip !== null && typeof tip === "object") {
          setText(tip, text);
        }
      }
    } catch {
      // Paint best-effort: the mirror still updates.
    }
    mirrorTip(index, text, doc);
    return text;
  };

  const advance = (): void => {
    if (stopped) {
      return;
    }
    const next = nextTipIndex(binder.index);
    try {
      const byId = (doc as unknown as { getElementById?: unknown })
        .getElementById;
      if (typeof byId === "function") {
        const tip = (byId as (id: string) => unknown).call(doc, MENU_TIP_ID);
        if (tip !== null && typeof tip === "object") {
          // Fade out under the CSS `opacity 0.5s` transition: the
          // computed opacity dips below 0.5 mid-transition by
          // construction, then the swap restores full opacity.
          setStyle(tip, "opacity", "0");
        }
      }
    } catch {
      // Fade-out best-effort: the swap still lands.
    }
    try {
      if (pending !== null) {
        clearScheduledTimeout(pending);
        pending = null;
      }
    } catch {
      // Stale swap best-effort only.
    }
    pending = scheduleTimeout(() => {
      pending = null;
      if (stopped) {
        return;
      }
      const text = paint(next);
      try {
        const byId = (doc as unknown as { getElementById?: unknown })
          .getElementById;
        if (typeof byId === "function") {
          const tip = (byId as (id: string) => unknown).call(doc, MENU_TIP_ID);
          if (tip !== null && typeof tip === "object") {
            setStyle(tip, "opacity", "1");
          }
        }
      } catch {
        // Fade-in best-effort: the text already swapped.
      }
      void text;
    }, SWAP_DELAY_MS);
  };

  binder.next = (): string => {
    try {
      advance();
    } catch {
      // Manual step best-effort only.
    }
    return binder.text;
  };

  try {
    ensureMenuTip(doc);
  } catch {
    // Static skeleton suffices: the interval still paints.
  }
  try {
    paint(0);
  } catch {
    // Initial paint best-effort only.
  }
  try {
    interval = scheduleInterval(() => {
      if (stopped) {
        return;
      }
      try {
        // Hidden menu pauses rotation: the index never advances
        // under cover (no catch-up burst on return).
        if (!isMenuVisible(doc)) {
          return;
        }
      } catch {
        return;
      }
      advance();
    }, MENU_TIP_INTERVAL_MS);
  } catch {
    interval = null;
  }
  binder.stop = (): void => {
    stopped = true;
    try {
      clearScheduledInterval(interval);
    } catch {
      // Timer teardown best-effort only.
    }
    try {
      clearScheduledTimeout(pending);
    } catch {
      // Swap teardown best-effort only.
    }
    interval = null;
    pending = null;
  };
  return binder;
}
