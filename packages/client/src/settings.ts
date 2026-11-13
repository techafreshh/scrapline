// Settings model: persisted master volume plus a thin DOM binder for the
// settings overlay. Parsing is DOM-free (unit-testable under node like
// setup.ts); the binder grabs handles structurally (no DOM globals at
// module scope) so missing elements are no-ops and the same fake-doc
// style covers it under node without jsdom.

import type { SetupStorage } from "./setup";

/** localStorage key for the persisted master volume. */
export const SETTINGS_VOLUME_KEY = "scrapline.settings.volume";

/** localStorage key for the persisted fullscreen intent ("1" = ON). */
export const FULLSCREEN_KEY = "scrapline.fullscreen";

/** First-visit (and corrupt-storage) default master volume. */
export const DEFAULT_VOLUME = 0.8;

/**
 * Tolerantly normalize an unknown value into a 0–1 volume: numbers and
 * numeric strings clamp into range, everything else falls back to 0.8.
 */
export function parseVolume(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    if (value.trim() === "") {
      return DEFAULT_VOLUME;
    }
    n = Number(value);
  } else {
    return DEFAULT_VOLUME;
  }
  if (!Number.isFinite(n)) {
    return DEFAULT_VOLUME;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

/**
 * Tolerantly normalize an unknown value into a fullscreen intent:
 * "1"/"true"/"on" (any case, trimmed) plus 1/true mean ON, everything
 * else (missing, "0", corrupt) means OFF.
 */
export function parseFullscreen(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "1" || text === "true" || text === "on";
  }
  return false;
}

/** Null-safe read: storage errors (or absence) yield null. */
function safeGet(
  storage: SetupStorage | null | undefined,
  key: string,
): string | null {
  if (storage === null || storage === undefined) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Load the persisted master volume; missing, corrupt, or unreadable
 * values fall back to DEFAULT_VOLUME.
 */
export function loadVolume(
  storage: SetupStorage | null | undefined,
): number {
  const raw = safeGet(storage, SETTINGS_VOLUME_KEY);
  if (raw === null) {
    return DEFAULT_VOLUME;
  }
  return parseVolume(raw);
}

/** Persist the (normalized) master volume; storage errors are swallowed. */
export function saveVolume(
  storage: SetupStorage | null | undefined,
  volume: number,
): void {
  if (storage === null || storage === undefined) {
    return;
  }
  // Integers serialize with one decimal ("0.0", "1.0") so a muted
  // profile reads back from localStorage unambiguously; other values
  // keep their plain form ("0.5"). Both parse back via loadVolume.
  const normalized = parseVolume(volume);
  const text = Number.isInteger(normalized)
    ? normalized.toFixed(1)
    : String(normalized);
  try {
    storage.setItem(SETTINGS_VOLUME_KEY, text);
  } catch {
    // Private-mode storage: the menu still works, just not persisted.
  }
}

/**
 * Load the persisted fullscreen intent; missing, corrupt, or unreadable
 * values fall back to OFF (false). Never auto-enters fullscreen: the
 * intent only pre-renders the button label until a user gesture toggles.
 */
export function loadFullscreen(
  storage: SetupStorage | null | undefined,
): boolean {
  const raw = safeGet(storage, FULLSCREEN_KEY);
  if (raw === null) {
    return false;
  }
  return parseFullscreen(raw);
}

/** Persist the fullscreen intent as "1"/"0"; storage errors are swallowed. */
export function saveFullscreen(
  storage: SetupStorage | null | undefined,
  on: boolean,
): void {
  if (storage === null || storage === undefined) {
    return;
  }
  try {
    storage.setItem(FULLSCREEN_KEY, on ? "1" : "0");
  } catch {
    // Private-mode storage: the toggle still works, just not persisted.
  }
}

/** Live binder state returned by bindSettings. */
export interface SettingsBinder {
  /** Current master volume (updated by the slider). */
  volume: number;
  /** Current fullscreen intent (updated by the toggle). */
  fullscreen: boolean;
  /** Reveal the overlay, prefilling the slider and toggle from storage. */
  show(): void;
  /** Hide the overlay. */
  hide(): void;
  /** Flip the persisted fullscreen intent (shared button + F-key path). */
  toggleFullscreen(): Promise<boolean>;
}

/** Minimal slider surface; the real HTMLInputElement satisfies it. */
interface SliderLike {
  value: string;
  addEventListener(type: string, listener: () => void): void;
}

/** Minimal button surface; the real HTMLButtonElement satisfies it. */
interface ButtonLike {
  textContent: string | null;
  addEventListener(type: string, listener: () => void): void;
}

/** Narrow an unknown handle to the slider surface; else null (no-op). */
function asSlider(el: unknown): SliderLike | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as {
    value?: unknown;
    addEventListener?: unknown;
  };
  if (typeof candidate.value !== "string") {
    return null;
  }
  if (typeof candidate.addEventListener !== "function") {
    return null;
  }
  return candidate as SliderLike;
}

/** Narrow an unknown handle to the button surface; else null (no-op). */
function asButton(el: unknown): ButtonLike | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as {
    textContent?: unknown;
    addEventListener?: unknown;
  };
  if (
    typeof candidate.textContent !== "string" &&
    candidate.textContent !== null
  ) {
    return null;
  }
  if (typeof candidate.addEventListener !== "function") {
    return null;
  }
  return candidate as ButtonLike;
}

/** Assign display on an unknown handle when it carries a style bag. */
function setDisplay(el: unknown, display: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const style = (el as { style?: unknown }).style;
  if (typeof style !== "object" || style === null) {
    return;
  }
  (style as Record<string, unknown>)["display"] = display;
}

/** Prefill the slider from the binder volume; missing slider is a no-op. */
function render(doc: Document, volume: number): void {
  const slider = asSlider(doc.getElementById("volume"));
  if (slider !== null) {
    slider.value = String(volume);
  }
}

/** Render the fullscreen button label; missing button is a no-op. */
function renderFullscreen(doc: Document, on: boolean): void {
  const button = asButton(doc.getElementById("btn-fullscreen"));
  if (button !== null) {
    button.textContent = on ? "Fullscreen: ON" : "Fullscreen: OFF";
  }
}

/** Swallow a Fullscreen API result that may be a promise (or thenable). */
function swallowFullscreenResult(result: unknown): void {
  if (result === null || result === undefined) {
    return;
  }
  try {
    if (result instanceof Promise) {
      result.catch(() => {
        // Headless denials: intent is already persisted + rendered.
      });
      return;
    }
    const thenable = result as { catch?: unknown };
    if (typeof thenable.catch === "function") {
      (thenable.catch as (onRejected: () => void) => void).call(
        result,
        () => {},
      );
    }
  } catch {
    // Non-promise shims: nothing to settle.
  }
}

/**
 * Shared fullscreen toggle: flip the persisted intent first (so headless
 * denials still persist + render), re-render the button label from the
 * intent immediately, then best-effort enter/exit fullscreen on
 * documentElement with all rejections swallowed. Resolves the new intent.
 */
export function toggleFullscreen(
  doc: Document,
  storage: SetupStorage | null | undefined,
): Promise<boolean> {
  const next = !loadFullscreen(storage);
  saveFullscreen(storage, next);
  renderFullscreen(doc, next);
  try {
    const surface = doc as unknown as {
      documentElement?: {
        requestFullscreen?: () => unknown;
      };
      exitFullscreen?: () => unknown;
    };
    if (next) {
      const request = surface.documentElement?.requestFullscreen;
      if (typeof request === "function") {
        swallowFullscreenResult(
          request.call(surface.documentElement as Element),
        );
      }
    } else {
      const exit = surface.exitFullscreen;
      if (typeof exit === "function") {
        swallowFullscreenResult(exit.call(doc as object));
      }
    }
  } catch {
    // Fullscreen API absent or throwing synchronously: intent stands.
  }
  return Promise.resolve(next);
}

/**
 * Wire the settings overlay: prefill the volume slider from storage,
 * persist every slider input, expose show/hide for the overlay. Missing
 * elements are no-ops; listeners attach once.
 */
export function bindSettings(
  doc: Document,
  storage: SetupStorage | null | undefined,
): SettingsBinder {
  const binder: SettingsBinder = {
    volume: loadVolume(storage),
    fullscreen: loadFullscreen(storage),
    show(): void {
      binder.volume = loadVolume(storage);
      render(doc, binder.volume);
      binder.fullscreen = loadFullscreen(storage);
      renderFullscreen(doc, binder.fullscreen);
      setDisplay(doc.getElementById("settings"), "");
    },
    hide(): void {
      setDisplay(doc.getElementById("settings"), "none");
    },
    toggleFullscreen(): Promise<boolean> {
      const result = toggleFullscreen(doc, storage);
      return result.then((next) => {
        binder.fullscreen = next;
        return next;
      });
    },
  };

  const slider = asSlider(doc.getElementById("volume"));
  if (slider !== null) {
    slider.value = String(binder.volume);
    slider.addEventListener("input", () => {
      binder.volume = parseVolume(slider.value);
      saveVolume(storage, binder.volume);
    });
  }

  const fullscreenButton = asButton(doc.getElementById("btn-fullscreen"));
  if (fullscreenButton !== null) {
    fullscreenButton.addEventListener("click", () => {
      void binder.toggleFullscreen();
    });
  }

  // Live-state sync: when real fullscreen state changes, the label
  // follows document.fullscreenElement. Fake docs without the property
  // keep the persisted intent (headless denials already render it).
  try {
    const addListener = (
      doc as unknown as { addEventListener?: unknown }
    ).addEventListener;
    if (typeof addListener === "function") {
      (
        doc as unknown as {
          addEventListener(type: string, listener: () => void): void;
        }
      ).addEventListener("fullscreenchange", () => {
        let current: unknown;
        try {
          current = (doc as unknown as Record<string, unknown>)[
            "fullscreenElement"
          ];
        } catch {
          return;
        }
        if (current === undefined) {
          return;
        }
        const on = current !== null;
        binder.fullscreen = on;
        renderFullscreen(doc, on);
      });
    }
  } catch {
    // Docs without addEventListener: the intent render stands.
  }

  render(doc, binder.volume);
  renderFullscreen(doc, binder.fullscreen);
  return binder;
}
