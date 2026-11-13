// Settings model: persisted master volume plus a thin DOM binder for the
// settings overlay. Parsing is DOM-free (unit-testable under node like
// setup.ts); the binder grabs handles structurally (no DOM globals at
// module scope) so missing elements are no-ops and the same fake-doc
// style covers it under node without jsdom.

import type { SetupStorage } from "./setup";

/** localStorage key for the persisted master volume. */
export const SETTINGS_VOLUME_KEY = "scrapline.settings.volume";

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

/** Live binder state returned by bindSettings. */
export interface SettingsBinder {
  /** Current master volume (updated by the slider). */
  volume: number;
  /** Reveal the overlay, prefilling the slider from storage. */
  show(): void;
  /** Hide the overlay. */
  hide(): void;
}

/** Minimal slider surface; the real HTMLInputElement satisfies it. */
interface SliderLike {
  value: string;
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
    show(): void {
      binder.volume = loadVolume(storage);
      render(doc, binder.volume);
      setDisplay(doc.getElementById("settings"), "");
    },
    hide(): void {
      setDisplay(doc.getElementById("settings"), "none");
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

  render(doc, binder.volume);
  return binder;
}
